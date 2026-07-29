//! Account sign-in for the desktop client.
//!
//! OAuth via **Supabase Auth** using Authorization Code + **PKCE** with a
//! **loopback redirect** (RFC 8252) — no client secret ships in the binary; the
//! provider secret lives only in Supabase. The system browser handles the IdP,
//! so we never touch the user's Google/LinkedIn/Facebook credentials.
//!
//! Tokens live in the OS keyring (the same vault as provider API keys, service
//! `conva`); non-secret session metadata (email, expiry) is cached in app-data
//! so the UI can show "signed in as…" offline. Design: `conva_core`'s
//! `docs/platform/01-auth.md`.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::path::Path;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use base64::Engine;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

// The project's base URL. The anon ("publishable") key is public and safe to
// embed; fill `DEFAULT_ANON_KEY` from Supabase → Project Settings → API → anon
// public. Both are overridable via env for dev / a second project.
const DEFAULT_SUPABASE_URL: &str = "https://hbxftjyooblxiiapaeei.supabase.co";
const DEFAULT_ANON_KEY: &str = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhieGZ0anlvb2JseGlpYXBhZWVpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUyNTQ3MzksImV4cCI6MjEwMDgzMDczOX0.KkvrtUOubjv8DUym7Qj_W_YyYezkVtueKdg9LyQGqQU";

/// Fixed loopback ports for the OAuth redirect (first free wins). Fixed rather
/// than random because Supabase's redirect allow-list can't wildcard the port —
/// each of these must be added as `http://127.0.0.1:<port>/callback`.
const LOOPBACK_PORTS: &[u16] = &[8765, 8766, 8767];

const KEYRING_SERVICE: &str = "conva";
const KR_REFRESH: &str = "auth-refresh-token";
const KR_ACCESS: &str = "auth-access-token";
const META_FILE: &str = "auth.json";

fn supabase_url() -> String {
    std::env::var("CONVA_SUPABASE_URL").unwrap_or_else(|_| DEFAULT_SUPABASE_URL.to_string())
}

fn anon_key() -> String {
    std::env::var("CONVA_SUPABASE_ANON_KEY").unwrap_or_else(|_| DEFAULT_ANON_KEY.to_string())
}

/// Command-facing sign-in state (mirrored in `src/lib/ipc.ts` as `AuthStatus`).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AuthStatus {
    pub signed_in: bool,
    pub email: Option<String>,
    pub user_id: Option<String>,
    pub expires_at_unix: Option<i64>,
    /// False when no anon key is compiled/env-configured — the UI can then
    /// explain sign-in is unavailable instead of failing opaquely.
    pub configured: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct SessionMeta {
    user_id: Option<String>,
    email: Option<String>,
    expires_at_unix: Option<i64>,
}

#[derive(Debug, Deserialize)]
struct TokenResponse {
    access_token: String,
    refresh_token: String,
    expires_in: Option<i64>,
    expires_at: Option<i64>,
    user: Option<UserObj>,
}

#[derive(Debug, Deserialize)]
struct UserObj {
    id: String,
    email: Option<String>,
}

// ------------------------------------------------------------------- keyring

fn kr(user: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYRING_SERVICE, user).map_err(|e| e.to_string())
}

fn kr_set(user: &str, val: &str) -> Result<(), String> {
    kr(user)?.set_password(val).map_err(|e| e.to_string())
}

fn kr_get(user: &str) -> Result<Option<String>, String> {
    match kr(user)?.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

fn kr_del(user: &str) -> Result<(), String> {
    match kr(user)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

// ---------------------------------------------------------------------- PKCE

fn b64url(bytes: &[u8]) -> String {
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

/// 32 bytes of OS randomness, base64url — used for both the PKCE verifier and
/// the CSRF `state`.
fn random_token() -> String {
    let mut buf = [0u8; 32];
    use rand::RngCore;
    rand::thread_rng().fill_bytes(&mut buf);
    b64url(&buf)
}

/// S256 challenge = base64url(sha256(verifier)).
fn challenge_of(verifier: &str) -> String {
    b64url(&Sha256::digest(verifier.as_bytes()))
}

// -------------------------------------------------------------- browser open

fn open_browser(url: &str) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", "", url])
            .spawn()
            .map(|_| ())
            .map_err(|e| e.to_string())
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(url)
            .spawn()
            .map(|_| ())
            .map_err(|e| e.to_string())
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        std::process::Command::new("xdg-open")
            .arg(url)
            .spawn()
            .map(|_| ())
            .map_err(|e| e.to_string())
    }
}

// ---------------------------------------------------------------- loopback cb

fn parse_query(target: &str) -> HashMap<String, String> {
    let mut map = HashMap::new();
    if let Some((_, q)) = target.split_once('?') {
        for pair in q.split('&') {
            if let Some((k, v)) = pair.split_once('=') {
                let val = urlencoding::decode(v)
                    .map(|c| c.into_owned())
                    .unwrap_or_else(|_| v.to_string());
                map.insert(k.to_string(), val);
            }
        }
    }
    map
}

/// Wait (up to 5 min) for the single browser redirect to the loopback port,
/// validate `state`, and return the authorization `code`.
fn wait_for_code(listener: &TcpListener, expected_state: &str) -> Result<String, String> {
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    let deadline = Instant::now() + Duration::from_secs(300);
    loop {
        match listener.accept() {
            Ok((mut stream, _)) => {
                stream.set_read_timeout(Some(Duration::from_secs(5))).ok();
                let mut buf = [0u8; 4096];
                let n = stream.read(&mut buf).unwrap_or(0);
                let req = String::from_utf8_lossy(&buf[..n]);
                let target = req
                    .lines()
                    .next()
                    .and_then(|l| l.split_whitespace().nth(1))
                    .unwrap_or("");
                let params = parse_query(target);

                let ok_body = "<!doctype html><meta charset=utf-8><title>conva</title>\
<body style=\"font:16px system-ui;padding:3rem;text-align:center\">\
<h2>Signed in to conva ✓</h2><p>You can close this tab and return to the app.</p>";
                let resp = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{}",
                    ok_body.len(),
                    ok_body
                );
                let _ = stream.write_all(resp.as_bytes());

                if let Some(err) = params.get("error") {
                    let desc = params.get("error_description").cloned().unwrap_or_default();
                    return Err(format!("oauth_error: {err} {desc}").trim().to_string());
                }
                if params.get("state").map(String::as_str) != Some(expected_state) {
                    return Err("state_mismatch".to_string());
                }
                return params
                    .get("code")
                    .cloned()
                    .ok_or_else(|| "no_code".to_string());
            }
            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                if Instant::now() > deadline {
                    return Err("timeout waiting for sign-in".to_string());
                }
                std::thread::sleep(Duration::from_millis(120));
            }
            Err(e) => return Err(e.to_string()),
        }
    }
}

// ------------------------------------------------------------- token exchange

/// Turn a `ureq` failure into a human-readable message. On an HTTP error status
/// Supabase returns a JSON body (`error_description` / `msg` / `message`); pull
/// that out so the UI can show "Invalid login credentials" rather than "400".
fn friendly_err(e: ureq::Error) -> String {
    match e {
        ureq::Error::Status(code, resp) => {
            let body = resp.into_string().unwrap_or_default();
            serde_json::from_str::<serde_json::Value>(&body)
                .ok()
                .and_then(|v| {
                    v.get("error_description")
                        .or_else(|| v.get("msg"))
                        .or_else(|| v.get("message"))
                        .and_then(|m| m.as_str().map(str::to_string))
                })
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| format!("request failed ({code})"))
        }
        ureq::Error::Transport(t) => t.to_string(),
    }
}

fn exchange_code(
    base: &str,
    key: &str,
    code: &str,
    verifier: &str,
) -> Result<TokenResponse, String> {
    let url = format!("{base}/auth/v1/token?grant_type=pkce");
    ureq::post(&url)
        .set("apikey", key)
        .set("Content-Type", "application/json")
        .send_json(serde_json::json!({ "auth_code": code, "code_verifier": verifier }))
        .map_err(|e| e.to_string())?
        .into_json::<TokenResponse>()
        .map_err(|e| e.to_string())
}

// ---------------------------------------------------------------- persistence

fn meta_path(auth_dir: &Path) -> std::path::PathBuf {
    auth_dir.join(META_FILE)
}

fn now_unix() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn persist(t: &TokenResponse, auth_dir: &Path) -> Result<(), String> {
    kr_set(KR_REFRESH, &t.refresh_token)?;
    kr_set(KR_ACCESS, &t.access_token)?;
    let expires_at = t
        .expires_at
        .or_else(|| t.expires_in.map(|s| now_unix() + s));
    let meta = SessionMeta {
        user_id: t.user.as_ref().map(|u| u.id.clone()),
        email: t.user.as_ref().and_then(|u| u.email.clone()),
        expires_at_unix: expires_at,
    };
    let json = serde_json::to_string_pretty(&meta).map_err(|e| e.to_string())?;
    std::fs::write(meta_path(auth_dir), json).map_err(|e| e.to_string())
}

fn read_meta(auth_dir: &Path) -> Option<SessionMeta> {
    let raw = std::fs::read_to_string(meta_path(auth_dir)).ok()?;
    serde_json::from_str(&raw).ok()
}

// --------------------------------------------------------------------- public

/// Run the interactive sign-in. Blocking (opens the browser and waits on the
/// loopback) — call from `spawn_blocking`, never the UI thread.
pub fn sign_in(provider: &str, auth_dir: &Path) -> Result<AuthStatus, String> {
    let base = supabase_url();
    let key = anon_key();
    if key.is_empty() {
        return Err("supabase_not_configured".to_string());
    }

    // Supabase's redirect allow-list does NOT match a wildcard port, so a
    // random loopback port falls back to the Site URL. Bind a fixed port
    // instead (first free of a small set) so the redirect is one of a handful
    // of exact URLs the owner can allow-list. Add all of these in Supabase →
    // Auth → URL Configuration → Redirect URLs:
    //   http://127.0.0.1:8765/callback  (…:8766, …:8767)
    let listener = LOOPBACK_PORTS
        .iter()
        .find_map(|&p| TcpListener::bind(("127.0.0.1", p)).ok())
        .ok_or_else(|| {
            format!(
                "no free loopback port (tried {LOOPBACK_PORTS:?}); close whatever is using them and retry"
            )
        })?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let redirect = format!("http://127.0.0.1:{port}/callback");

    let verifier = random_token();
    let challenge = challenge_of(&verifier);
    let state = random_token();

    let authorize = format!(
        "{base}/auth/v1/authorize?provider={provider}&redirect_to={redirect}\
&code_challenge={challenge}&code_challenge_method=s256&state={state}",
        redirect = urlencoding::encode(&redirect),
    );
    open_browser(&authorize)?;

    let code = wait_for_code(&listener, &state)?;
    let tokens = exchange_code(&base, &key, &code, &verifier)?;
    persist(&tokens, auth_dir)?;
    Ok(status(auth_dir))
}

/// Sign in with an email + password (Supabase `grant_type=password`). Blocking —
/// call from `spawn_blocking`. The account is the *same* identity used for
/// Google / the website, so a user who signed up either way can sign in here.
pub fn sign_in_password(email: &str, password: &str, auth_dir: &Path) -> Result<AuthStatus, String> {
    let base = supabase_url();
    let key = anon_key();
    if key.is_empty() {
        return Err("supabase_not_configured".to_string());
    }
    let url = format!("{base}/auth/v1/token?grant_type=password");
    let tokens = ureq::post(&url)
        .set("apikey", &key)
        .set("Content-Type", "application/json")
        .send_json(serde_json::json!({ "email": email, "password": password }))
        .map_err(friendly_err)?
        .into_json::<TokenResponse>()
        .map_err(|e| e.to_string())?;
    persist(&tokens, auth_dir)?;
    Ok(status(auth_dir))
}

/// Create an account with an email + password (Supabase `/signup`). If the
/// project requires email confirmation, no session is returned yet — surface
/// `email_confirmation_required` so the UI can tell the user to confirm, then
/// sign in. Blocking — call from `spawn_blocking`.
pub fn sign_up_password(email: &str, password: &str, auth_dir: &Path) -> Result<AuthStatus, String> {
    let base = supabase_url();
    let key = anon_key();
    if key.is_empty() {
        return Err("supabase_not_configured".to_string());
    }
    let url = format!("{base}/auth/v1/signup");
    let val: serde_json::Value = ureq::post(&url)
        .set("apikey", &key)
        .set("Content-Type", "application/json")
        .send_json(serde_json::json!({ "email": email, "password": password }))
        .map_err(friendly_err)?
        .into_json()
        .map_err(|e| e.to_string())?;

    // A session (access_token) is present only when email confirmation is off.
    if val.get("access_token").and_then(|v| v.as_str()).is_some() {
        let tokens: TokenResponse = serde_json::from_value(val).map_err(|e| e.to_string())?;
        persist(&tokens, auth_dir)?;
        Ok(status(auth_dir))
    } else {
        Err("email_confirmation_required".to_string())
    }
}

/// Renew the access/refresh pair from the stored refresh token. Wired into the
/// entitlement/API layer in M1 (see conva_core `docs/platform/09-implementation-plan.md`);
/// allow(dead_code) until then so CI's `-D warnings` stays green.
#[allow(dead_code)]
pub fn refresh(auth_dir: &Path) -> Result<AuthStatus, String> {
    let base = supabase_url();
    let key = anon_key();
    if key.is_empty() {
        return Err("supabase_not_configured".to_string());
    }
    let rt = kr_get(KR_REFRESH)?.ok_or_else(|| "not_signed_in".to_string())?;
    let url = format!("{base}/auth/v1/token?grant_type=refresh_token");
    let tokens = ureq::post(&url)
        .set("apikey", &key)
        .set("Content-Type", "application/json")
        .send_json(serde_json::json!({ "refresh_token": rt }))
        .map_err(|e| e.to_string())?
        .into_json::<TokenResponse>()
        .map_err(|e| e.to_string())?;
    persist(&tokens, auth_dir)?;
    Ok(status(auth_dir))
}

/// Non-secret, offline snapshot of the session.
pub fn status(auth_dir: &Path) -> AuthStatus {
    let configured = !anon_key().is_empty();
    let has_refresh = kr_get(KR_REFRESH).ok().flatten().is_some();
    let meta = read_meta(auth_dir);
    AuthStatus {
        signed_in: has_refresh && meta.is_some(),
        email: meta.as_ref().and_then(|m| m.email.clone()),
        user_id: meta.as_ref().and_then(|m| m.user_id.clone()),
        expires_at_unix: meta.as_ref().and_then(|m| m.expires_at_unix),
        configured,
    }
}

/// Revoke server-side (best-effort) and clear all local tokens + metadata.
pub fn sign_out(auth_dir: &Path) -> Result<(), String> {
    let key = anon_key();
    if let Some(access) = kr_get(KR_ACCESS).ok().flatten() {
        if !key.is_empty() {
            let url = format!("{}/auth/v1/logout", supabase_url());
            let _ = ureq::post(&url)
                .set("apikey", &key)
                .set("Authorization", &format!("Bearer {access}"))
                .call();
        }
    }
    let _ = kr_del(KR_REFRESH);
    let _ = kr_del(KR_ACCESS);
    let _ = std::fs::remove_file(meta_path(auth_dir));
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pkce_challenge_matches_rfc7636_vector() {
        // RFC 7636 Appendix B.
        let verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
        assert_eq!(
            challenge_of(verifier),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
    }

    #[test]
    fn parse_query_decodes_pairs() {
        let q = parse_query("/callback?code=abc%20123&state=xyz");
        assert_eq!(q.get("code").map(String::as_str), Some("abc 123"));
        assert_eq!(q.get("state").map(String::as_str), Some("xyz"));
    }

    #[test]
    fn random_token_is_urlsafe_and_unique() {
        let a = random_token();
        let b = random_token();
        assert_ne!(a, b);
        assert!(!a.contains('+') && !a.contains('/') && !a.contains('='));
    }
}

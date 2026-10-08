//! Background flush loop for the local telemetry queue (docs/platform/
//! 15-events-implementation.md §6, §9): drains `telemetry_events.rs`'s
//! durable queue and POSTs batches to the desktop bearer-JWT route,
//! `POST {web_api_base}/api/events` (conva_web's `src/bearer/gateway.js`).
//!
//! Runs on its own dedicated named thread on a fixed interval — never the
//! UI/audio thread, per architecture rule 5 (blocking `ureq` off the hot
//! path). Best-effort throughout, mirroring the queue's own philosophy:
//! telemetry must never break anything else. A signed-out user, an offline
//! machine, or a server error just leaves the cursor where it is; the next
//! tick retries the same unflushed events.

use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::AppHandle;

use crate::{auth, auth_dir, telemetry_events};

/// Mirrors the server's own `events.js` `FLUSH_INTERVAL_S` (echoed back in
/// every accepted response's `config.flush_interval_s`, so this is a
/// starting point, not a contract — a server-side bump doesn't require a
/// client release).
const FLUSH_INTERVAL_S: u64 = 60;
/// Mirrors the server's `MAX_EVENTS_PER_BATCH` — a bigger batch is refused
/// whole, so there is no point reading more than this per attempt.
const BATCH_LIMIT: usize = 50;

/// How long a fetched beta flag is trusted before it is asked for again while
/// signed in. A revoked seat unlocks the switch within this window.
const REQUIRED_SYNC_INTERVAL: Duration = Duration::from_secs(60 * 60);
/// Timeout for the entitlements read — it runs on the flush thread and right
/// after sign-in, so a stalled connection must not hold either for long.
const REQUIRED_SYNC_TIMEOUT: Duration = Duration::from_secs(15);

/// Who the beta flag was last fetched for, and when. Shared by the flush loop
/// and the post-sign-in call so one fetch serves both.
static LAST_SYNC: Mutex<Option<(String, Instant)>> = Mutex::new(None);

/// Base URL of the conva_web Worker this desktop build reports to. Same
/// three-tier precedence as `auth::supabase_url()`: a runtime env var (local
/// `tauri dev` against any deployment) beats a compile-time one (CI can bake
/// a dev installer to point at dev.getconva.com the same way it bakes
/// `CONVA_SUPABASE_URL`), beats the default of live production.
pub(crate) fn web_api_base() -> String {
    std::env::var("CONVA_WEB_API_URL")
        .ok()
        .filter(|s| !s.trim().is_empty())
        .or_else(|| {
            option_env!("CONVA_WEB_API_URL")
                .filter(|s| !s.trim().is_empty())
                .map(str::to_string)
        })
        .unwrap_or_else(|| "https://getconva.com".to_string())
}

/// Is a fresh read of the beta flag due? True for a user it has not been read
/// for yet (first launch, a new sign-in, a different account) and once the
/// last read is older than `interval`.
fn sync_due(last: Option<(&str, Duration)>, uid: &str, interval: Duration) -> bool {
    match last {
        Some((last_uid, age)) => last_uid != uid || age >= interval,
        None => true,
    }
}

/// Ask the server whether the signed-in account's beta terms make usage data
/// required, and apply the answer. Returns whether the server answered.
///
/// This is what closes the hole where the flag was only learned from the first
/// `/api/events` reply: a tester who switched usage data off before that first
/// flush never sent an event, so was never locked. It runs at sign-in and from
/// the flush loop, and deliberately BEFORE the "is collection on" check, so it
/// works with the switch off. Silent when signed out; a failure is logged and
/// retried on the next tick, leaving the stored flag as it was.
pub(crate) fn sync_required(app: &AppHandle) -> bool {
    let Ok(dir) = auth_dir(app) else {
        return false;
    };
    let Some(uid) = auth::status(&dir).user_id else {
        return false;
    };
    let Ok(token) = auth::access_token(&dir) else {
        return false;
    };
    let url = format!("{}/api/entitlements", web_api_base());
    let body = match ureq::get(&url)
        .set("Authorization", &format!("Bearer {token}"))
        .timeout(REQUIRED_SYNC_TIMEOUT)
        .call()
    {
        Ok(resp) => resp.into_json::<serde_json::Value>().ok(),
        Err(ureq::Error::Status(code, _)) => {
            eprintln!("[telemetry] entitlements read rejected ({code})");
            return false;
        }
        Err(ureq::Error::Transport(t)) => {
            eprintln!("[telemetry] entitlements read: transport error: {t}");
            return false;
        }
    };
    // Answered, but with nothing to say (no entitlements row yet): keep the
    // stored flag and try again later rather than guessing "not required".
    if let Some(required) = body.as_ref().and_then(entitlements_required_flag) {
        telemetry_events::set_required(app, &uid, required);
    }
    *LAST_SYNC.lock().expect("sync lock") = Some((uid, Instant::now()));
    true
}

/// [`sync_required`] on its own thread, for the sign-in paths: the answer is
/// not needed to finish signing in, so a slow server must not hold it up.
pub(crate) fn sync_required_in_background(app: &AppHandle) {
    let app = app.clone();
    let spawned = std::thread::Builder::new()
        .name("telemetry-required-sync".into())
        .spawn(move || {
            sync_required(&app);
        });
    if let Err(e) = spawned {
        eprintln!("[telemetry] could not start the entitlements read: {e}");
    }
}

/// [`sync_required`] unless the flag for this user is still fresh.
fn sync_required_if_due(app: &AppHandle) {
    let Ok(dir) = auth_dir(app) else {
        return;
    };
    let Some(uid) = auth::status(&dir).user_id else {
        return;
    };
    let due = {
        let last = LAST_SYNC.lock().expect("sync lock");
        let last = last.as_ref().map(|(u, at)| (u.as_str(), at.elapsed()));
        sync_due(last, &uid, REQUIRED_SYNC_INTERVAL)
    };
    if due {
        sync_required(app);
    }
}

/// One flush attempt: read up to `BATCH_LIMIT` unflushed events, POST them,
/// advance the cursor only once the server has confirmed them. Never panics,
/// never propagates — every failure is logged and left for the next tick.
fn flush_once(app: &AppHandle) {
    // The beta flag first: with the switch off there is nothing to flush, but
    // the lock must still be learned.
    sync_required_if_due(app);
    // Switched off (and not required by beta terms): send nothing.
    if !telemetry_events::collecting(app) {
        return;
    }
    let dir = match auth_dir(app) {
        Ok(d) => d,
        Err(e) => {
            eprintln!("[telemetry] flush: no app config dir: {e}");
            return;
        }
    };
    // Nothing to authenticate the POST with when signed out — this is the
    // common case (not an error), so stay quiet and just try again later.
    let token = match auth::access_token(&dir) {
        Ok(t) => t,
        Err(_) => return,
    };

    let batch = telemetry_events::read_batch(app, BATCH_LIMIT);
    if batch.is_empty() {
        return;
    }
    let Some(last_seq) = batch.iter().map(|e| e.seq).max() else {
        return;
    };
    let device_id = telemetry_events::device_id(app);
    let url = format!("{}/api/events", web_api_base());
    let body = serde_json::json!({ "device_id": device_id, "events": batch });

    match ureq::post(&url)
        .set("Authorization", &format!("Bearer {token}"))
        .set("Content-Type", "application/json")
        .send_json(body)
    {
        Ok(resp) => {
            telemetry_events::advance_cursor(app, last_seq);
            // The server may say this account's beta terms require usage
            // data (`config.telemetry_required`); absent = no change.
            if let Some(required) = resp
                .into_json::<serde_json::Value>()
                .ok()
                .as_ref()
                .and_then(required_flag)
            {
                if let Some(uid) = auth::status(&dir).user_id {
                    telemetry_events::set_required(app, &uid, required);
                }
            }
        }
        Err(ureq::Error::Status(code, resp)) => {
            let hint = resp.into_string().unwrap_or_default();
            eprintln!("[telemetry] flush rejected ({code}): {hint}");
        }
        Err(ureq::Error::Transport(t)) => {
            eprintln!("[telemetry] flush: transport error: {t}");
        }
    }
}

/// `config.telemetry_required` from an accepted `/api/events` reply, if the
/// server sent it as a boolean.
fn required_flag(body: &serde_json::Value) -> Option<bool> {
    body.get("config")?.get("telemetry_required")?.as_bool()
}

/// `telemetry_required` from a `GET /api/entitlements` body (top level, unlike
/// the events reply where it sits under `config`), if sent as a boolean.
fn entitlements_required_flag(body: &serde_json::Value) -> Option<bool> {
    body.get("telemetry_required")?.as_bool()
}

/// Start the flush loop on a dedicated background thread. Call once, after
/// `AppState` (and therefore the telemetry queue) is managed. Flushes
/// immediately on start (so events queued by a previous, offline run go out
/// as soon as the network/sign-in allow it) and then every
/// `FLUSH_INTERVAL_S`.
pub fn spawn(app: AppHandle) {
    let spawned = std::thread::Builder::new()
        .name("telemetry-flush".into())
        .spawn(move || loop {
            flush_once(&app);
            std::thread::sleep(Duration::from_secs(FLUSH_INTERVAL_S));
        });
    if let Err(e) = spawned {
        eprintln!("[telemetry] could not start the flush thread: {e}");
    }
}

#[cfg(test)]
mod tests {
    use super::{entitlements_required_flag, required_flag, sync_due, web_api_base};
    use std::time::Duration;

    #[test]
    fn required_flag_reads_only_a_boolean_under_config() {
        let j = |s: &str| serde_json::from_str::<serde_json::Value>(s).unwrap();
        assert_eq!(
            required_flag(&j(r#"{"config":{"telemetry_required":true}}"#)),
            Some(true)
        );
        assert_eq!(
            required_flag(&j(r#"{"config":{"telemetry_required":false}}"#)),
            Some(false)
        );
        assert_eq!(
            required_flag(&j(r#"{"config":{"flush_interval_s":60}}"#)),
            None
        );
        assert_eq!(
            required_flag(&j(r#"{"config":{"telemetry_required":"yes"}}"#)),
            None
        );
        assert_eq!(required_flag(&j(r#"{}"#)), None);
    }

    #[test]
    fn entitlements_flag_is_top_level_and_boolean_only() {
        let j = |s: &str| serde_json::from_str::<serde_json::Value>(s).unwrap();
        assert_eq!(
            entitlements_required_flag(&j(r#"{"plan":"beta","telemetry_required":true}"#)),
            Some(true)
        );
        assert_eq!(
            entitlements_required_flag(&j(r#"{"plan":"none","telemetry_required":false}"#)),
            Some(false)
        );
        // No entitlements row yet: the server omits the field — no change.
        assert_eq!(entitlements_required_flag(&j(r#"{"plan":"none"}"#)), None);
        assert_eq!(
            entitlements_required_flag(&j(r#"{"telemetry_required":"yes"}"#)),
            None
        );
        // The events reply's nesting is NOT this endpoint's shape.
        assert_eq!(
            entitlements_required_flag(&j(r#"{"config":{"telemetry_required":true}}"#)),
            None
        );
    }

    #[test]
    fn sync_is_due_for_a_new_user_and_when_stale() {
        let hour = Duration::from_secs(3600);
        // Never read: due.
        assert!(sync_due(None, "u1", hour));
        // Same user, fresh: not due.
        assert!(!sync_due(Some(("u1", Duration::from_secs(10))), "u1", hour));
        // Same user, at or past the interval: due.
        assert!(sync_due(Some(("u1", hour)), "u1", hour));
        // A different account signed in: due however fresh the old read is.
        assert!(sync_due(Some(("u1", Duration::from_secs(1))), "u2", hour));
    }

    // One test, not three: `cargo test` runs tests in parallel threads within
    // the same process, and this env var is process-global — interleaved
    // set_var/remove_var calls from separate tests would race. Keeping every
    // assertion in one function makes the sequence deterministic.
    #[test]
    fn web_api_base_precedence() {
        std::env::remove_var("CONVA_WEB_API_URL");
        assert_eq!(web_api_base(), "https://getconva.com");

        std::env::set_var("CONVA_WEB_API_URL", "https://dev.getconva.com");
        assert_eq!(web_api_base(), "https://dev.getconva.com");

        std::env::set_var("CONVA_WEB_API_URL", "   ");
        assert_eq!(web_api_base(), "https://getconva.com");

        std::env::remove_var("CONVA_WEB_API_URL");
    }
}

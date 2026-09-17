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

use std::time::Duration;

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

/// Base URL of the conva_web Worker this desktop build reports to. Same
/// three-tier precedence as `auth::supabase_url()`: a runtime env var (local
/// `tauri dev` against any deployment) beats a compile-time one (CI can bake
/// a dev installer to point at dev.getconva.com the same way it bakes
/// `CONVA_SUPABASE_URL`), beats the default of live production.
fn web_api_base() -> String {
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

/// One flush attempt: read up to `BATCH_LIMIT` unflushed events, POST them,
/// advance the cursor only once the server has confirmed them. Never panics,
/// never propagates — every failure is logged and left for the next tick.
fn flush_once(app: &AppHandle) {
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
        Ok(_) => telemetry_events::advance_cursor(app, last_seq),
        Err(ureq::Error::Status(code, resp)) => {
            let hint = resp.into_string().unwrap_or_default();
            eprintln!("[telemetry] flush rejected ({code}): {hint}");
        }
        Err(ureq::Error::Transport(t)) => {
            eprintln!("[telemetry] flush: transport error: {t}");
        }
    }
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
    use super::web_api_base;

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

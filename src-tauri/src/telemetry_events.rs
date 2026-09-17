//! Local durable event queue — the desktop half of `/events`
//! (conva_core docs/platform/15-events-implementation.md §6, §9).
//!
//! Each metering call site (crates/conva-core via metering.rs) also appends
//! one taxonomy event here after recording locally. A future flush loop
//! drains it (cursor-based, oldest-unflushed-first) and POSTs batches to
//! `/api/events` with the signed-in user's bearer token — not wired yet;
//! this module is the durable, inspectable local half only.
//!
//! `<app-data>/telemetry/events.jsonl` is a deliberately plaintext,
//! append-only log — the user's own honest, inspectable copy of exactly
//! what would be sent (11's "Transparency": *"a log the user can inspect is
//! the cheapest possible proof of the content-free claim"*). It is never
//! read back by anything except a flush and the (future) Settings panel —
//! Settings → Usage reads `usage.json`, a different file, for the rolled-up
//! ledger; this file exists only for the network flush and local inspection.
//!
//! Everything here is best-effort: telemetry must never break a feature, so
//! a failed write is logged, not propagated (mirrors metering.rs's own
//! philosophy). `next_seq`/`device_id` live in `AppState` behind a `Mutex` so
//! concurrent call sites (LLM streams on different threads, research/TTS at
//! the same time) never race on the same sequence number.

use std::fs;
use std::io::{BufRead, Write};
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use conva_core::telemetry_events::{validate_event, TelemetryEvent, EVENTS_SCHEMA_VERSION};

use crate::session::now_unix_ms;
use crate::AppState;

/// Above this size the queue is pruned (oldest lines dropped) rather than
/// left to grow unbounded — a flush loop that's behind (offline, signed out)
/// must not fill the disk. A `log_dropped` event records how much was lost.
const MAX_QUEUE_BYTES: u64 = 5 * 1024 * 1024;
const KEEP_LINES_ON_PRUNE: usize = 5_000;

fn telemetry_dir(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join("telemetry"))
}
fn events_path(app: &AppHandle) -> Option<PathBuf> {
    telemetry_dir(app).map(|d| d.join("events.jsonl"))
}
fn cursor_path(app: &AppHandle) -> Option<PathBuf> {
    telemetry_dir(app).map(|d| d.join("cursor.json"))
}
fn state_path(app: &AppHandle) -> Option<PathBuf> {
    telemetry_dir(app).map(|d| d.join("state.json"))
}

/// The queue's own bookkeeping — held in `AppState` behind a `Mutex`, loaded
/// once at startup and persisted to `state.json` after every append.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueueState {
    next_seq: u64,
    device_id: String,
}

fn new_device_id() -> String {
    use rand::RngCore;
    let mut b = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut b);
    b[6] = (b[6] & 0x0f) | 0x40; // version 4
    b[8] = (b[8] & 0x3f) | 0x80; // variant 10xx
    format!(
        "{:02x}{:02x}{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}",
        b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7], b[8], b[9], b[10], b[11], b[12], b[13], b[14], b[15]
    )
}

/// Read the persisted queue state at startup; a fresh device id + seq 1 when
/// there is none yet (first run, or a corrupt file).
pub fn load_state(app: &AppHandle) -> QueueState {
    if let Some(path) = state_path(app) {
        if let Ok(s) = fs::read_to_string(&path) {
            if let Ok(qs) = serde_json::from_str::<QueueState>(&s) {
                return qs;
            }
        }
    }
    QueueState {
        next_seq: 1,
        device_id: new_device_id(),
    }
}

fn persist_state(app: &AppHandle, qs: &QueueState) {
    let Some(path) = state_path(app) else { return };
    if let Some(dir) = path.parent() {
        let _ = fs::create_dir_all(dir);
    }
    match serde_json::to_string(qs) {
        Ok(json) => {
            if let Err(e) = fs::write(&path, json) {
                eprintln!("[telemetry] could not write state.json: {e}");
            }
        }
        Err(e) => eprintln!("[telemetry] could not serialize queue state: {e}"),
    }
}

/// This device's persisted id (a locally generated UUID v4 — 15 §6; never
/// coupled to a hosted-inference instance serial, which does not exist yet).
pub fn device_id(app: &AppHandle) -> String {
    let state = app.state::<AppState>();
    let id = state
        .telemetry
        .lock()
        .expect("telemetry lock")
        .device_id
        .clone();
    id
}

/// Append one taxonomy event to the queue. Best-effort: a validation failure
/// or I/O error is logged and the call returns without side effects — the
/// caller (a metering call site) must never be broken by this.
pub fn append(app: &AppHandle, ev: &str, fields: serde_json::Value, session_id: Option<String>) {
    let event = TelemetryEvent {
        ev: ev.to_string(),
        seq: 0, // assigned below, once we hold the lock
        t: now_unix_ms(),
        schema_v: EVENTS_SCHEMA_VERSION,
        session_id,
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        platform: "desktop".to_string(),
        fields,
    };
    if let Err(violations) = validate_event(&event) {
        eprintln!("[telemetry] refusing to enqueue malformed '{ev}' event: {violations:?}");
        return;
    }

    let state = app.state::<AppState>();
    let mut qs = state.telemetry.lock().expect("telemetry lock");
    let mut event = event;
    event.seq = qs.next_seq;

    let Some(path) = events_path(app) else { return };
    if let Some(dir) = path.parent() {
        let _ = fs::create_dir_all(dir);
    }
    let line = match serde_json::to_string(&event) {
        Ok(l) => l,
        Err(e) => {
            eprintln!("[telemetry] could not serialize event: {e}");
            return;
        }
    };
    match fs::OpenOptions::new().create(true).append(true).open(&path) {
        Ok(mut file) => {
            if let Err(e) = writeln!(file, "{line}") {
                eprintln!("[telemetry] could not append event: {e}");
                return;
            }
        }
        Err(e) => {
            eprintln!("[telemetry] could not open events.jsonl: {e}");
            return;
        }
    }
    qs.next_seq += 1;
    persist_state(app, &qs);
    drop(qs);
    prune_if_needed(app);
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct Cursor {
    flushed_through_seq: u64,
}

fn load_cursor(app: &AppHandle) -> Cursor {
    cursor_path(app)
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

/// The next up-to-`limit` events strictly after the last flushed cursor,
/// oldest first. A future flush loop posts these to `/api/events`, then
/// calls [`advance_cursor`] only once the server has confirmed them —
/// the cursor is the client's own durability boundary, not the seq counter.
pub fn read_batch(app: &AppHandle, limit: usize) -> Vec<TelemetryEvent> {
    let cursor = load_cursor(app);
    let Some(path) = events_path(app) else {
        return Vec::new();
    };
    let Ok(file) = fs::File::open(&path) else {
        return Vec::new();
    };
    let reader = std::io::BufReader::new(file);
    let mut out = Vec::new();
    for line in reader.lines().map_while(Result::ok) {
        if line.trim().is_empty() {
            continue;
        }
        if let Ok(ev) = serde_json::from_str::<TelemetryEvent>(&line) {
            if ev.seq > cursor.flushed_through_seq {
                out.push(ev);
                if out.len() >= limit {
                    break;
                }
            }
        }
    }
    out
}

/// Mark everything through `through_seq` as durably flushed. Idempotent —
/// setting the same or an older value than what's stored is a no-op in
/// effect (a future read still starts after the higher-water mark).
pub fn advance_cursor(app: &AppHandle, through_seq: u64) {
    let current = load_cursor(app).flushed_through_seq;
    if through_seq <= current {
        return;
    }
    let Some(path) = cursor_path(app) else { return };
    if let Some(dir) = path.parent() {
        let _ = fs::create_dir_all(dir);
    }
    match serde_json::to_string(&Cursor {
        flushed_through_seq: through_seq,
    }) {
        Ok(json) => {
            if let Err(e) = fs::write(&path, json) {
                eprintln!("[telemetry] could not write cursor.json: {e}");
            }
        }
        Err(e) => eprintln!("[telemetry] could not serialize cursor: {e}"),
    }
}

/// Keep the queue bounded when a flush loop has been unable to drain it
/// (offline, signed out) for a long time — drop the oldest lines and record
/// exactly how many via the taxonomy's own `log_dropped` event.
fn prune_if_needed(app: &AppHandle) {
    let Some(path) = events_path(app) else { return };
    let Ok(meta) = fs::metadata(&path) else {
        return;
    };
    if meta.len() <= MAX_QUEUE_BYTES {
        return;
    }
    let Ok(content) = fs::read_to_string(&path) else {
        return;
    };
    let lines: Vec<&str> = content.lines().filter(|l| !l.trim().is_empty()).collect();
    if lines.len() <= KEEP_LINES_ON_PRUNE {
        return;
    }
    let dropped = lines.len() - KEEP_LINES_ON_PRUNE;
    let kept = lines[dropped..].join("\n") + "\n";
    if fs::write(&path, kept).is_err() {
        return;
    }
    eprintln!(
        "[telemetry] queue exceeded {MAX_QUEUE_BYTES} bytes; dropped {dropped} oldest events"
    );
    // Recurses into append(), but the file is now well under the cap, so
    // this cannot loop.
    append(
        app,
        "log_dropped",
        serde_json::json!({ "count": dropped }),
        None,
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn device_id_is_a_lowercase_v4_uuid_shape() {
        let id = new_device_id();
        assert_eq!(id.len(), 36);
        assert_eq!(id.chars().nth(14), Some('4'));
        assert!(id
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-'));
    }
}

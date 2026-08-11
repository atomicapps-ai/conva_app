//! Lightweight performance tracing for the conversation pipeline.
//!
//! Each timed stage emits one JSONL record — `[perf] {...}` to stderr for live
//! visibility, and a line to `<app-data>/perf.jsonl` for offline metrics. The
//! stages cover the whole path: `stt` (whisper decode), `rag` (retrieval),
//! `llm` (Ally / persona / tracker, with first-token + total + tokens), and
//! `tts` (Aura synth + playback). Records carry `t` (epoch ms), `stage`, `ms`,
//! plus stage-specific fields, so a session can be reconstructed and latency
//! percentiles computed after the fact.
//!
//! Always on and cheap (one small serialize + append per event). Delete
//! `perf.jsonl` to reset. Shell-only — no IPC/UI; this is raw trace data.

use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;

use serde_json::json;

use conva_core::llm::ProviderId;

use crate::session::now_unix_ms;

static PERF_FILE: Mutex<Option<File>> = Mutex::new(None);

/// The provider's snake_case label (e.g. "anthropic") for a trace field.
pub fn provider_label(provider: ProviderId) -> String {
    serde_json::to_value(provider)
        .ok()
        .and_then(|v| v.as_str().map(str::to_string))
        .unwrap_or_default()
}

/// Open (append) the perf log. Called once at startup.
pub fn init(path: PathBuf) {
    match OpenOptions::new().create(true).append(true).open(&path) {
        Ok(file) => *PERF_FILE.lock().expect("perf lock") = Some(file),
        Err(e) => eprintln!("[perf] could not open {}: {e}", path.display()),
    }
}

/// Record one timed stage. `extra` is a JSON object of stage-specific fields
/// (e.g. `side`, `provider`, `in`/`out` tokens); `t`, `stage`, and `ms` are
/// added automatically.
pub fn record(stage: &str, ms: u64, extra: serde_json::Value) {
    let mut obj = serde_json::Map::new();
    obj.insert("t".into(), json!(now_unix_ms()));
    obj.insert("stage".into(), json!(stage));
    obj.insert("ms".into(), json!(ms));
    if let Some(map) = extra.as_object() {
        for (k, v) in map {
            obj.insert(k.clone(), v.clone());
        }
    }
    let line = serde_json::Value::Object(obj).to_string();
    eprintln!("[perf] {line}");
    if let Ok(mut guard) = PERF_FILE.lock() {
        if let Some(file) = guard.as_mut() {
            let _ = writeln!(file, "{line}");
        }
    }
}

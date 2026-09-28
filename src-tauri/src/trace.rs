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
//! `perf.jsonl` to reset — or let it rotate itself, see `MAX_PERF_BYTES`.
//! Shell-only — no IPC/UI; this is raw trace data.

use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde_json::json;

use conva_core::llm::ProviderId;

use crate::session::now_unix_ms;

struct PerfLog {
    file: File,
    path: PathBuf,
    bytes: u64,
}

static PERF_FILE: Mutex<Option<PerfLog>> = Mutex::new(None);

/// Rotate `perf.jsonl` once it passes this size, keeping one prior backup
/// (`perf.jsonl.1`) — bounds disk use for a process left running a long time
/// instead of appending to one file for the life of the install.
const MAX_PERF_BYTES: u64 = 10 * 1024 * 1024;

/// The provider's snake_case label (e.g. "anthropic") for a trace field.
pub fn provider_label(provider: ProviderId) -> String {
    serde_json::to_value(provider)
        .ok()
        .and_then(|v| v.as_str().map(str::to_string))
        .unwrap_or_default()
}

/// Open (append) the perf log. Called once at startup.
pub fn init(path: PathBuf) {
    let bytes = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
    match OpenOptions::new().create(true).append(true).open(&path) {
        Ok(file) => {
            *PERF_FILE.lock().expect("perf lock") = Some(PerfLog { file, path, bytes });
        }
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
        if let Some(log) = guard.as_mut() {
            if log.bytes >= MAX_PERF_BYTES {
                rotate(log);
            }
            if writeln!(log.file, "{line}").is_ok() {
                log.bytes += line.len() as u64 + 1;
            }
        }
    }
}

fn rotated_path(path: &Path) -> PathBuf {
    let mut name = path.as_os_str().to_os_string();
    name.push(".1");
    PathBuf::from(name)
}

/// Best-effort: a failed rename/reopen just keeps appending to the current
/// file rather than risk truncating trace data no backup was made of.
fn rotate(log: &mut PerfLog) {
    if std::fs::rename(&log.path, rotated_path(&log.path)).is_err() {
        return;
    }
    match OpenOptions::new().create(true).append(true).open(&log.path) {
        Ok(file) => {
            log.file = file;
            log.bytes = 0;
        }
        Err(e) => {
            eprintln!(
                "[perf] could not reopen {} after rotation: {e}",
                log.path.display()
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_dir(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("conva-trace-test-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn rotated_path_appends_dot_one() {
        let path = PathBuf::from("/tmp/foo/perf.jsonl");
        assert_eq!(rotated_path(&path), PathBuf::from("/tmp/foo/perf.jsonl.1"));
    }

    #[test]
    fn rotate_moves_current_content_to_backup_and_starts_fresh() {
        let dir = test_dir("rotate");
        let path = dir.join("perf.jsonl");
        std::fs::write(&path, b"old-line\n").unwrap();
        let file = OpenOptions::new().append(true).open(&path).unwrap();
        let mut log = PerfLog {
            file,
            path: path.clone(),
            bytes: 9,
        };

        rotate(&mut log);

        assert_eq!(log.bytes, 0);
        let backup = std::fs::read_to_string(rotated_path(&path)).unwrap();
        assert_eq!(backup, "old-line\n");
        writeln!(log.file, "new-line").unwrap();
        let fresh = std::fs::read_to_string(&path).unwrap();
        assert_eq!(fresh, "new-line\n");
    }

    #[test]
    fn rotate_overwrites_a_stale_backup() {
        let dir = test_dir("rotate-overwrite");
        let path = dir.join("perf.jsonl");
        std::fs::write(rotated_path(&path), b"stale-backup\n").unwrap();
        std::fs::write(&path, b"current\n").unwrap();
        let file = OpenOptions::new().append(true).open(&path).unwrap();
        let mut log = PerfLog {
            file,
            path: path.clone(),
            bytes: 8,
        };

        rotate(&mut log);

        let backup = std::fs::read_to_string(rotated_path(&path)).unwrap();
        assert_eq!(backup, "current\n");
    }
}

//! "Your data on this computer" (Settings → Privacy): inventory, recordings,
//! and "Erase everything on this computer".
//!
//! The decisions live in `conva_core::local_data` (which paths an erase may
//! touch, what counts as a recording, how long one is). This module walks the
//! app-data folder and applies them. Every `*_in` function takes the folder as
//! an argument so it is tested against a temp directory.
//!
//! **Erase runs at the next start, not live.** The Library store, the usage
//! ledger and the trace log hold files open (Windows refuses to delete an open
//! file) and keep an index in memory that would go stale. So the command only
//! writes `pending-erase.json` in the config folder and the UI relaunches the
//! app; [`run_pending_erase`] then erases before any store is opened. The
//! marker is deleted *first*: if that fails nothing is erased, so a stuck
//! marker can never wipe data on every launch.

use std::fs;
use std::path::{Path, PathBuf};

use conva_core::ipc::{
    DeleteRecordingsReport, EraseOptions, EraseReport, LocalDataCategory, LocalDataSummary,
    RecordingInfo,
};
use conva_core::local_data::{
    erase_allows, recording_id_valid, recording_started_ms, wav_duration_ms, ERASE_PATHS,
    RECORDINGS_DIR,
};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::session::now_unix_ms;

/// The loose files counted as "usage counts and diagnostics log". All of them
/// are in the erase plan.
const DIAGNOSTIC_FILES: &[&str] = &[
    "usage.json",
    "usage_events.jsonl",
    "perf.jsonl",
    "highlight_feedback.json",
    "archive-imports.json",
    "telemetry/events.jsonl",
];

const PENDING_FILE: &str = "pending-erase.json";
const REPORT_FILE: &str = "last-erase.json";

#[derive(Debug, Serialize, Deserialize)]
struct PendingErase {
    #[serde(default)]
    include_keys: bool,
    requested_unix_ms: u64,
}

/// Files and bytes under `path`, recursively. Symlinks are counted as the
/// link itself and never followed, errors are skipped.
fn tree_stats(path: &Path) -> (u64, u64) {
    let Ok(meta) = fs::symlink_metadata(path) else {
        return (0, 0);
    };
    if meta.is_dir() {
        let mut files = 0;
        let mut bytes = 0;
        if let Ok(rd) = fs::read_dir(path) {
            for entry in rd.flatten() {
                let (f, b) = tree_stats(&entry.path());
                files += f;
                bytes += b;
            }
        }
        (files, bytes)
    } else {
        (1, meta.len())
    }
}

/// Count of direct children of `dir` that pass `keep`, and their total size.
fn direct_files(dir: &Path, keep: impl Fn(&str) -> bool) -> LocalDataCategory {
    let mut cat = LocalDataCategory::default();
    let Ok(rd) = fs::read_dir(dir) else {
        return cat;
    };
    for entry in rd.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        let Ok(meta) = entry.metadata() else { continue };
        if meta.is_file() && keep(&name) {
            cat.count += 1;
            cat.bytes += meta.len();
        }
    }
    cat
}

fn ends(ext: &'static str) -> impl Fn(&str) -> bool {
    move |n| n.ends_with(ext)
}

pub fn summary_in(data_dir: &Path) -> LocalDataSummary {
    let (_, rag_bytes) = tree_stats(&data_dir.join("rag"));
    let (_, simcon_bytes) = tree_stats(&data_dir.join("simcon"));
    let (model_files, model_bytes) = tree_stats(&data_dir.join("models"));
    let mut diagnostics = LocalDataCategory::default();
    for rel in DIAGNOSTIC_FILES {
        let (f, b) = tree_stats(
            &rel.split('/')
                .fold(data_dir.to_path_buf(), |p, part| p.join(part)),
        );
        diagnostics.count += f as u32;
        diagnostics.bytes += b;
    }
    LocalDataSummary {
        data_dir: Some(data_dir.display().to_string()),
        recordings: direct_files(&data_dir.join(RECORDINGS_DIR), recording_id_valid),
        conversations: direct_files(&data_dir.join("conversations"), ends(".json")),
        session_logs: direct_files(&data_dir.join("sessions"), ends(".jsonl")),
        library: LocalDataCategory {
            count: direct_files(&data_dir.join("rag"), ends(".json")).count,
            bytes: rag_bytes,
        },
        contexts: LocalDataCategory {
            count: direct_files(&data_dir.join("simcon").join("profiles"), ends(".json")).count,
            bytes: simcon_bytes,
        },
        diagnostics,
        models: LocalDataCategory {
            count: model_files as u32,
            bytes: model_bytes,
        },
    }
}

pub fn list_recordings_in(data_dir: &Path) -> Vec<RecordingInfo> {
    let dir = data_dir.join(RECORDINGS_DIR);
    let mut out = Vec::new();
    let Ok(rd) = fs::read_dir(&dir) else {
        return out;
    };
    for entry in rd.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        let Some(started) = recording_started_ms(&name) else {
            continue;
        };
        let Ok(meta) = entry.metadata() else { continue };
        if !meta.is_file() {
            continue;
        }
        let duration_ms = fs::File::open(entry.path()).ok().and_then(|mut f| {
            use std::io::Read;
            let mut head = [0u8; 44];
            f.read_exact(&mut head).ok()?;
            wav_duration_ms(&head, meta.len())
        });
        out.push(RecordingInfo {
            id: name,
            started_unix_ms: started,
            duration_ms,
            size_bytes: meta.len(),
        });
    }
    out.sort_by_key(|r| std::cmp::Reverse(r.started_unix_ms));
    out
}

pub fn delete_recordings_in(data_dir: &Path, ids: &[String]) -> DeleteRecordingsReport {
    let dir = data_dir.join(RECORDINGS_DIR);
    let mut report = DeleteRecordingsReport::default();
    for id in ids {
        // Validated file name only: no separators, no dots beyond `.wav`.
        if !recording_id_valid(id) {
            report.failed.push(id.clone());
            continue;
        }
        let path = dir.join(id);
        let Ok(meta) = fs::symlink_metadata(&path) else {
            report.failed.push(id.clone());
            continue;
        };
        match fs::remove_file(&path) {
            Ok(()) => {
                report.deleted += 1;
                report.freed_bytes += meta.len();
            }
            Err(_) => report.failed.push(id.clone()),
        }
    }
    report
}

/// Remove every path in the erase plan under `data_dir`. Never follows a
/// symlink out of the folder: a link is removed as a link.
pub fn erase_in(data_dir: &Path) -> EraseReport {
    let mut report = EraseReport::default();
    for rel in ERASE_PATHS {
        debug_assert!(erase_allows(rel));
        if !erase_allows(rel) {
            continue;
        }
        let path = rel
            .split('/')
            .fold(data_dir.to_path_buf(), |p, part| p.join(part));
        let Ok(meta) = fs::symlink_metadata(&path) else {
            continue; // nothing there
        };
        let (files, bytes) = tree_stats(&path);
        let result = if meta.is_dir() && !meta.file_type().is_symlink() {
            fs::remove_dir_all(&path)
        } else {
            fs::remove_file(&path)
        };
        match result {
            Ok(()) => {
                report.removed_files += files;
                report.removed_bytes += bytes;
            }
            Err(_) => report.failed.push((*rel).to_string()),
        }
    }
    report
}

// --------------------------------------------------------- app integration

fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|e| format!("no app data dir: {e}"))
}

fn config_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map_err(|e| format!("no app config dir: {e}"))
}

pub fn summary(app: &AppHandle) -> Result<LocalDataSummary, String> {
    Ok(summary_in(&data_dir(app)?))
}

pub fn list_recordings(app: &AppHandle) -> Result<Vec<RecordingInfo>, String> {
    Ok(list_recordings_in(&data_dir(app)?))
}

pub fn delete_recordings(
    app: &AppHandle,
    ids: &[String],
) -> Result<DeleteRecordingsReport, String> {
    Ok(delete_recordings_in(&data_dir(app)?, ids))
}

/// Open the folder holding `id` with the file selected (Explorer `/select,`,
/// Finder `-R`; elsewhere the folder).
pub fn reveal_recording(app: &AppHandle, id: &str) -> Result<(), String> {
    if !recording_id_valid(id) {
        return Err("invalid recording".into());
    }
    let path = data_dir(app)?.join(RECORDINGS_DIR).join(id);
    if !path.is_file() {
        return Err("recording not found".into());
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer.exe")
            .arg(format!("/select,{}", path.display()))
            .spawn()
            .map(|_| ())
            .map_err(|e| e.to_string())
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("-R")
            .arg(&path)
            .spawn()
            .map(|_| ())
            .map_err(|e| e.to_string())
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let dir = path.parent().map(Path::to_path_buf).unwrap_or(path);
        crate::reveal_in_file_manager(&dir.display().to_string())
    }
}

pub fn open_data_folder(app: &AppHandle) -> Result<(), String> {
    let dir = data_dir(app)?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    crate::reveal_in_file_manager(&dir.display().to_string())
}

/// Queue an erase for the next start. The UI relaunches the app right after.
pub fn request_erase(app: &AppHandle, options: EraseOptions) -> Result<(), String> {
    let dir = config_dir(app)?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let marker = PendingErase {
        include_keys: options.include_keys,
        requested_unix_ms: now_unix_ms(),
    };
    let json = serde_json::to_string(&marker).map_err(|e| e.to_string())?;
    fs::write(dir.join(PENDING_FILE), json).map_err(|e| e.to_string())
}

/// Run a queued erase, if any. Call at startup **before** any store, the usage
/// ledger or the trace log is opened.
pub fn run_pending_erase(app: &AppHandle) {
    let (Ok(cfg), Ok(data)) = (config_dir(app), data_dir(app)) else {
        return;
    };
    process_pending(&cfg, &data, &mut remove_all_keys);
}

/// Every API key the app can hold in the OS credential store. Returns what
/// could not be removed.
fn remove_all_keys() -> Vec<String> {
    let mut failed = Vec::new();
    for p in conva_core::llm::provider_registry() {
        if p.requires_api_key && crate::llm::store_api_key(p.id, "").is_err() {
            failed.push(format!("key:{:?}", p.id));
        }
    }
    if crate::asr_deepgram::store_api_key("").is_err() {
        failed.push("key:deepgram".into());
    }
    if crate::research::store_firecrawl_key("").is_err() {
        failed.push("key:firecrawl".into());
    }
    if crate::context::store_tavily_key("").is_err() {
        failed.push("key:tavily".into());
    }
    failed
}

/// The marker-handling core of [`run_pending_erase`], on plain folders so it
/// can be tested. Returns the report when an erase ran.
///
/// The marker is removed **first**. If that fails, nothing is erased: a marker
/// that could not be cleared must never wipe data on every launch. An
/// unreadable marker is cleared and ignored.
fn process_pending(
    cfg: &Path,
    data: &Path,
    remove_keys: &mut dyn FnMut() -> Vec<String>,
) -> Option<EraseReport> {
    let marker_path = cfg.join(PENDING_FILE);
    let text = fs::read_to_string(&marker_path).ok()?;
    if let Err(e) = fs::remove_file(&marker_path) {
        eprintln!("[erase] could not remove the pending marker, not erasing: {e}");
        return None;
    }
    let Ok(pending) = serde_json::from_str::<PendingErase>(&text) else {
        eprintln!("[erase] unreadable pending marker, not erasing");
        return None;
    };
    let mut report = erase_in(data);
    if pending.include_keys {
        let failed = remove_keys();
        report.keys_removed = failed.is_empty();
        report.failed.extend(failed);
    }
    report.finished_unix_ms = now_unix_ms();
    eprintln!(
        "[erase] removed {} files, {} bytes, {} failed",
        report.removed_files,
        report.removed_bytes,
        report.failed.len()
    );
    if let Ok(json) = serde_json::to_string(&report) {
        let _ = fs::write(cfg.join(REPORT_FILE), json);
    }
    Some(report)
}

/// The result of the last erase, once: reading it deletes it.
pub fn take_erase_report(app: &AppHandle) -> Option<EraseReport> {
    let path = config_dir(app).ok()?.join(REPORT_FILE);
    let report = serde_json::from_str(&fs::read_to_string(&path).ok()?).ok();
    let _ = fs::remove_file(&path);
    report
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};

    fn temp_dir(tag: &str) -> PathBuf {
        static N: AtomicU32 = AtomicU32::new(0);
        let d = std::env::temp_dir().join(format!(
            "conva-local-data-{tag}-{}-{}",
            std::process::id(),
            N.fetch_add(1, Ordering::SeqCst)
        ));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    fn write(path: &Path, bytes: &[u8]) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, bytes).unwrap();
    }

    fn wav(seconds: u32) -> Vec<u8> {
        let mut h = vec![0u8; 44];
        h[0..4].copy_from_slice(b"RIFF");
        h[8..12].copy_from_slice(b"WAVE");
        h[22..24].copy_from_slice(&2u16.to_le_bytes());
        h[24..28].copy_from_slice(&16_000u32.to_le_bytes());
        h[34..36].copy_from_slice(&16u16.to_le_bytes());
        h.extend(std::iter::repeat_n(0u8, (seconds * 16_000 * 4) as usize));
        h
    }

    /// A data dir with a bit of everything, including things an erase must keep.
    fn populated(tag: &str) -> PathBuf {
        let d = temp_dir(tag);
        write(&d.join("recordings/call-1760000000000.wav"), &wav(2));
        write(&d.join("recordings/call-1760000100000.wav"), &wav(1));
        write(&d.join("recordings/notes.txt"), b"not a recording");
        write(&d.join("conversations/c1.json"), b"{}");
        write(&d.join("conversations/c2.json"), b"{}");
        write(&d.join("sessions/s1.jsonl"), b"{}\n");
        write(&d.join("rag/doc-1.json"), b"{}");
        write(&d.join("rag/doc-2.json"), b"{}");
        write(&d.join("rag/originals/doc-1.pdf"), b"%PDF");
        write(&d.join("rag/tables/t.table"), b"{}");
        write(&d.join("simcon/profiles/p1.json"), b"{}");
        write(&d.join("usage.json"), b"{}");
        write(&d.join("usage_events.jsonl"), b"{}\n");
        write(&d.join("perf.jsonl"), b"{}\n");
        write(&d.join("telemetry/events.jsonl"), b"{}\n");
        write(&d.join("telemetry/state.json"), b"{\"next_seq\":9}");
        write(&d.join("telemetry/cursor.json"), b"{}");
        write(&d.join("models/ggml-tiny.bin"), &[1u8; 100]);
        d
    }

    #[test]
    fn summary_counts_each_category_and_ignores_foreign_files() {
        let d = populated("summary");
        let s = summary_in(&d);
        assert_eq!(s.recordings.count, 2, "notes.txt is not a recording");
        assert_eq!(s.recordings.bytes, 128_044 + 64_044);
        assert_eq!(s.conversations.count, 2);
        assert_eq!(s.session_logs.count, 1);
        assert_eq!(
            s.library.count, 2,
            "two documents; originals and tables are not documents"
        );
        assert!(
            s.library.bytes >= 2 + 2 + 4 + 2,
            "bytes cover originals and tables too"
        );
        assert_eq!(s.contexts.count, 1);
        assert_eq!(
            s.diagnostics.count, 4,
            "usage.json, usage_events.jsonl, perf.jsonl and the event queue"
        );
        assert_eq!(s.models.count, 1);
        assert_eq!(s.models.bytes, 100);
        assert!(s.data_dir.is_some());
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn summary_of_an_empty_or_missing_folder_is_all_zero() {
        let d = temp_dir("empty");
        let s = summary_in(&d);
        assert_eq!(s.recordings, LocalDataCategory::default());
        assert_eq!(s.library, LocalDataCategory::default());
        let missing = summary_in(&d.join("nope"));
        assert_eq!(missing.models, LocalDataCategory::default());
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn recordings_are_listed_newest_first_with_length_and_size() {
        let d = populated("list");
        let list = list_recordings_in(&d);
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].id, "call-1760000100000.wav");
        assert_eq!(list[0].duration_ms, Some(1000));
        assert_eq!(list[0].size_bytes, 64_044);
        assert_eq!(list[1].id, "call-1760000000000.wav");
        assert_eq!(list[1].duration_ms, Some(2000));
        assert_eq!(list[1].started_unix_ms, 1_760_000_000_000);
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn deleting_recordings_removes_only_valid_named_files_inside_the_folder() {
        let d = populated("delete");
        write(&d.join("outside.wav"), b"keep me");
        let report = delete_recordings_in(
            &d,
            &[
                "call-1760000000000.wav".into(),
                "../outside.wav".into(),
                "notes.txt".into(),
                "call-5.wav".into(), // valid name, not there
            ],
        );
        assert_eq!(report.deleted, 1);
        assert_eq!(report.freed_bytes, 128_044);
        assert_eq!(
            report.failed,
            vec!["../outside.wav", "notes.txt", "call-5.wav"]
        );
        assert!(!d.join("recordings/call-1760000000000.wav").exists());
        assert!(d.join("recordings/call-1760000100000.wav").exists());
        assert!(
            d.join("recordings/notes.txt").exists(),
            "a non-recording in the folder is left alone"
        );
        assert!(
            d.join("outside.wav").exists(),
            "nothing outside the folder is touched"
        );
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn erase_removes_the_plan_and_keeps_models_and_the_beta_lock_state() {
        let d = populated("erase");
        write(&d.join("config-like.json"), b"{}"); // unlisted: must survive
        let report = erase_in(&d);
        assert!(report.failed.is_empty(), "{:?}", report.failed);
        for gone in [
            "recordings",
            "sessions",
            "conversations",
            "simcon",
            "rag",
            "usage.json",
            "usage_events.jsonl",
            "perf.jsonl",
            "telemetry/events.jsonl",
        ] {
            assert!(!d.join(gone).exists(), "{gone} should be gone");
        }
        assert!(d.join("models/ggml-tiny.bin").exists(), "models are kept");
        assert!(
            d.join("telemetry/state.json").exists(),
            "device id, seq and the beta lock are kept"
        );
        assert!(d.join("telemetry/cursor.json").exists());
        assert!(
            d.join("config-like.json").exists(),
            "unlisted files are untouched"
        );
        assert!(report.removed_files >= 12);
        assert!(report.removed_bytes > 0);
        // Idempotent: a second run finds nothing and fails nothing.
        let again = erase_in(&d);
        assert_eq!(again.removed_files, 0);
        assert!(again.failed.is_empty());
        let _ = fs::remove_dir_all(&d);
    }

    #[cfg(unix)]
    #[test]
    fn erase_removes_a_symlink_as_a_link_and_never_follows_it_out_of_the_folder() {
        let d = temp_dir("link");
        let outside = temp_dir("link-outside");
        write(&outside.join("precious.txt"), b"do not delete");
        std::os::unix::fs::symlink(&outside, d.join("rag")).unwrap();
        let report = erase_in(&d);
        assert!(report.failed.is_empty(), "{:?}", report.failed);
        assert!(!d.join("rag").exists(), "the link itself is removed");
        assert!(
            outside.join("precious.txt").exists(),
            "the target outside is untouched"
        );
        let _ = fs::remove_dir_all(&d);
        let _ = fs::remove_dir_all(&outside);
    }

    fn marker(cfg: &Path, include_keys: bool) {
        let m = PendingErase {
            include_keys,
            requested_unix_ms: 1,
        };
        write(
            &cfg.join(PENDING_FILE),
            serde_json::to_string(&m).unwrap().as_bytes(),
        );
    }

    #[test]
    fn a_queued_erase_runs_once_writes_its_report_and_clears_the_marker() {
        let data = populated("pending-data");
        let cfg = temp_dir("pending-cfg");
        marker(&cfg, false);
        let mut keys_called = 0;
        let report = process_pending(&cfg, &data, &mut || {
            keys_called += 1;
            vec![]
        })
        .expect("erase should have run");
        assert_eq!(keys_called, 0, "keys are only removed when asked");
        assert!(!report.keys_removed);
        assert!(report.removed_files > 0 && report.finished_unix_ms > 0);
        assert!(!data.join("recordings").exists());
        assert!(data.join("models/ggml-tiny.bin").exists());
        assert!(!cfg.join(PENDING_FILE).exists(), "marker cleared");
        let saved: EraseReport =
            serde_json::from_str(&fs::read_to_string(cfg.join(REPORT_FILE)).unwrap()).unwrap();
        assert_eq!(saved, report);
        // A second start finds no marker and touches nothing.
        write(&data.join("recordings/call-9.wav"), &wav(1));
        assert!(process_pending(&cfg, &data, &mut Vec::new).is_none());
        assert!(data.join("recordings/call-9.wav").exists());
        let _ = fs::remove_dir_all(&data);
        let _ = fs::remove_dir_all(&cfg);
    }

    #[test]
    fn keys_are_removed_only_when_asked_and_a_failure_is_reported() {
        let data = populated("keys-data");
        let cfg = temp_dir("keys-cfg");
        marker(&cfg, true);
        let report = process_pending(&cfg, &data, &mut || vec!["key:tavily".to_string()]).unwrap();
        assert!(
            !report.keys_removed,
            "one key failed, so not all were removed"
        );
        assert_eq!(report.failed, vec!["key:tavily"]);
        marker(&cfg, true);
        let ok = process_pending(&cfg, &data, &mut Vec::new).unwrap();
        assert!(ok.keys_removed);
        let _ = fs::remove_dir_all(&data);
        let _ = fs::remove_dir_all(&cfg);
    }

    #[test]
    fn no_marker_means_nothing_is_touched() {
        let data = populated("nomarker-data");
        let cfg = temp_dir("nomarker-cfg");
        assert!(process_pending(&cfg, &data, &mut Vec::new).is_none());
        assert!(data.join("recordings/call-1760000000000.wav").exists());
        assert!(!cfg.join(REPORT_FILE).exists());
        let _ = fs::remove_dir_all(&data);
        let _ = fs::remove_dir_all(&cfg);
    }

    #[test]
    fn an_unreadable_marker_is_cleared_and_erases_nothing() {
        let data = populated("garbage-data");
        let cfg = temp_dir("garbage-cfg");
        write(&cfg.join(PENDING_FILE), b"{ not json");
        assert!(process_pending(&cfg, &data, &mut Vec::new).is_none());
        assert!(
            !cfg.join(PENDING_FILE).exists(),
            "cleared so it cannot retry forever"
        );
        assert!(data.join("recordings/call-1760000000000.wav").exists());
        let _ = fs::remove_dir_all(&data);
        let _ = fs::remove_dir_all(&cfg);
    }
}

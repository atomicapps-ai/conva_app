//! Usage metering — the shell half of the ledger (`conva_core::metering`).
//!
//! Records what the owner's BYO keys are spent on so Settings → Usage can show
//! it: LLM tokens per provider **and per feature × model**, Tavily web
//! searches, and TTS characters. The live ledger is held in `AppState.usage`
//! (a `Mutex`) and mirrored to `<app-data>/usage.json` after every change, so
//! counts survive restarts. Each LLM completion additionally appends one raw
//! event row to `<app-data>/usage_events.jsonl` (`{t, feature, provider,
//! model, in, out, ok}` — counts only, never content), the per-call record
//! behind the rolled-up ledger and the local precursor of the platform's
//! `usage_events` ledger (`docs/platform/04-billing-credits.md`). All writes
//! are best-effort: metering must never break a feature, so a failed persist
//! is logged, not propagated.
//!
//! Feature labels in use (stable snake_case, owned by the call sites):
//! `ally_suggest_reply` · `ally_summarize` · `ally_question` ·
//! `ally_card_summary` · `simcon_knowledge` · `simcon_research_findings` ·
//! `simcon_personas` · `rehearsal_persona` · `tracker` · `capture` ·
//! `faner_replay`. The Settings key "Test" ping is deliberately unmetered.

use std::fs;
use std::io::Write;
use std::path::PathBuf;

use tauri::{AppHandle, Manager};

use conva_core::llm::{ProviderId, TokenUsage};
use conva_core::metering::{UsageLedger, UsageSummary};

use crate::session::now_unix_ms;
use crate::AppState;

fn ledger_path(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join("usage.json"))
}

fn events_path(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .app_data_dir()
        .ok()
        .map(|d| d.join("usage_events.jsonl"))
}

/// Append one per-call event row to `usage_events.jsonl`. Best-effort; the
/// rolled-up ledger is the UI's source of truth, this file is the raw record
/// for offline analysis (and, later, server usage reporting).
fn append_event(
    app: &AppHandle,
    feature: &str,
    provider: ProviderId,
    model: &str,
    usage: &TokenUsage,
    ok: bool,
) {
    let Some(path) = events_path(app) else {
        return;
    };
    if let Some(dir) = path.parent() {
        let _ = fs::create_dir_all(dir);
    }
    let line = serde_json::json!({
        "t": now_unix_ms(),
        "feature": feature,
        "provider": crate::trace::provider_label(provider),
        "model": model,
        "in": usage.input_tokens,
        "out": usage.output_tokens,
        "ok": ok,
    })
    .to_string();
    match fs::OpenOptions::new().create(true).append(true).open(&path) {
        Ok(mut file) => {
            if let Err(e) = writeln!(file, "{line}") {
                eprintln!("[metering] could not append usage event: {e}");
            }
        }
        Err(e) => eprintln!("[metering] could not open usage_events.jsonl: {e}"),
    }
}

/// Read the persisted ledger at startup. Missing/corrupt file → a fresh ledger.
pub fn load(app: &AppHandle) -> UsageLedger {
    ledger_path(app)
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn persist(app: &AppHandle, ledger: &UsageLedger) {
    let Some(path) = ledger_path(app) else {
        return;
    };
    if let Some(dir) = path.parent() {
        let _ = fs::create_dir_all(dir);
    }
    match serde_json::to_string_pretty(ledger) {
        Ok(json) => {
            if let Err(e) = fs::write(&path, json) {
                eprintln!("[metering] could not write usage.json: {e}");
            }
        }
        Err(e) => eprintln!("[metering] could not serialize usage ledger: {e}"),
    }
}

/// Attribute one completion attempt's tokens to `provider` and its
/// `feature` × `model` bucket, append the raw event row, then persist.
/// `ok = false` marks a failed attempt whose partial tokens were still
/// billed. Best-effort.
pub fn record_llm(
    app: &AppHandle,
    feature: &str,
    provider: ProviderId,
    model: &str,
    usage: TokenUsage,
    ok: bool,
) {
    append_event(app, feature, provider, model, &usage, ok);
    let state = app.state::<AppState>();
    let mut ledger = state.usage.lock().expect("usage lock");
    ledger.record_llm(feature, provider, model, usage, ok, now_unix_ms());
    persist(app, &ledger);
}

/// Count `count` Tavily searches, then persist. Best-effort.
pub fn record_tavily_search(app: &AppHandle, count: u64) {
    let state = app.state::<AppState>();
    let mut ledger = state.usage.lock().expect("usage lock");
    ledger.record_tavily_search(count, now_unix_ms());
    persist(app, &ledger);
}

/// Count `chars` synthesized by TTS (Aura bills per character), then persist.
pub fn record_tts_characters(app: &AppHandle, chars: u64) {
    let state = app.state::<AppState>();
    let mut ledger = state.usage.lock().expect("usage lock");
    ledger.record_tts_characters(chars, now_unix_ms());
    persist(app, &ledger);
}

/// The Settings → Usage snapshot.
pub fn summary(app: &AppHandle) -> UsageSummary {
    let state = app.state::<AppState>();
    let ledger = state.usage.lock().expect("usage lock");
    ledger.summary()
}

/// Clear all counters (Settings → Usage "reset"). Returns the empty snapshot.
/// The raw `usage_events.jsonl` is deliberately left intact — it is the
/// append-only historical record; reset only reopens the visible window.
pub fn reset(app: &AppHandle) -> UsageSummary {
    let state = app.state::<AppState>();
    let mut ledger = state.usage.lock().expect("usage lock");
    ledger.reset(now_unix_ms());
    persist(app, &ledger);
    ledger.summary()
}

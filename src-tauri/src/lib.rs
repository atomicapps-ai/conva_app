//! conva Tauri shell — wires the UI to the core layers.
//!
//! M3 state: dual capture (mic + WASAPI loopback) → per-side whisper.cpp
//! transcription → manual Ally streaming through the provider
//! registry (Claude default), with API keys in the OS credential vault.

mod asr;
mod asr_deepgram;
mod audio;
mod auth;
mod capture;
mod context;
mod conversations;
mod embed;
mod feedback;
mod hud;
mod llm;
mod metering;
mod models;
mod partner;
mod rag;
mod recorder;
mod rehearsal;
mod secrets;
mod session;
mod trace;
mod tracker;
mod tts;
mod vad_silero;
mod web;

use std::fs;
use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use std::sync::Arc;

use conva_core::asr::TranscriptSegment;
use conva_core::audio::AudioDevice;
use conva_core::config::AppConfig;
use conva_core::context::{ContextSummary, ConversationContext, KnowledgeProfile};
use conva_core::ipc::{events, AllyChunkEvent, AllySource, AllySourcesEvent, SessionStateEvent};
use conva_core::llm::{provider_registry, LlmRequest, ModelInfo, ProviderId, ProviderInfo};
use conva_core::metering::{UsageLedger, UsageSummary};
use conva_core::prompt::{build_ally_request, AllyKind};
use conva_core::rag::{IngestReport, RagDocument};

use rag::RagStore;
use session::SessionManager;

/// In-memory app state; the config mirrors the JSON file on disk.
struct AppState {
    config: Mutex<AppConfig>,
    session: SessionManager,
    rag: Arc<RagStore>,
    /// Usage ledger (LLM tokens + Tavily searches), mirrored to usage.json.
    usage: Mutex<UsageLedger>,
    /// Terms of the active conversation context (a rehearsal's key terms +
    /// digest glossary) — the strongest highlight signal. Empty when no context
    /// is active; set on rehearsal start, cleared on stop (Phase 3c).
    active_context_terms: Mutex<Vec<String>>,
    /// `RagDocument` ids the active conversation context is grounded in — when
    /// non-empty, Ally's retrieval is scoped to exactly these instead of the
    /// whole library. Empty means "no active context" (today's default,
    /// unscoped). Set by context activation (session-grounding picker),
    /// cleared on stop.
    active_context_doc_ids: Mutex<Vec<String>>,
}

fn config_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("no app config dir: {e}"))?;
    Ok(dir.join("config.json"))
}

/// Candidate locations for the repo-committed defaults file. `tauri dev`
/// runs the app with cwd = `src-tauri/`, so the repo root is one level up.
fn repo_config_candidates() -> Vec<std::path::PathBuf> {
    let mut out = Vec::new();
    if let Ok(p) = std::env::var("CONVA_CONFIG_FILE") {
        if !p.trim().is_empty() {
            out.push(std::path::PathBuf::from(p));
        }
    }
    out.push(std::path::PathBuf::from("conva.config.json"));
    out.push(std::path::PathBuf::from("../conva.config.json"));
    out
}

fn load_config(app: &AppHandle) -> AppConfig {
    if let Some(mut existing) = config_path(app)
        .ok()
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str::<AppConfig>(&s).ok())
    {
        // One-time migration: "base.en" was the pre-quantization seeded
        // default and decodes several times slower than the current default —
        // configs still carrying it are stale defaults, not a user choice.
        // (Explicitly picking base.en-q5_1 or any other model is respected.)
        if existing.whisper_model == "base.en" {
            let new_default = AppConfig::default().whisper_model;
            eprintln!(
                "[conva] migrating whisper model 'base.en' (stale default) -> '{new_default}'"
            );
            existing.whisper_model = new_default;
            let _ = persist_config(app, &existing);
        }
        return existing;
    }
    // Fresh machine: seed from the repo-committed defaults so tuned settings
    // travel via git (owner request). Falls back to compiled defaults.
    for candidate in repo_config_candidates() {
        if let Some(config) = fs::read_to_string(&candidate)
            .ok()
            .and_then(|s| serde_json::from_str::<AppConfig>(&s).ok())
        {
            eprintln!("[conva] seeded config from {}", candidate.display());
            let _ = persist_config(app, &config);
            return config;
        }
    }
    AppConfig::default()
}

/// Write the current config as pretty JSON to `path` — meant for committing
/// `conva.config.json` to the repo as the cross-machine defaults.
#[tauri::command]
fn export_config(state: State<AppState>, path: String) -> Result<(), String> {
    let config = state.config.lock().expect("config lock").clone();
    let json = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| e.to_string())
}

/// Load a config file, apply it as the live config, and persist it.
#[tauri::command]
fn import_config(
    app: AppHandle,
    state: State<AppState>,
    path: String,
) -> Result<AppConfig, String> {
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let config: AppConfig = serde_json::from_str(&content).map_err(|e| e.to_string())?;
    persist_config(&app, &config)?;
    *state.config.lock().expect("config lock") = config.clone();
    Ok(config)
}

fn persist_config(app: &AppHandle, config: &AppConfig) -> Result<(), String> {
    let path = config_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
    fs::write(path, json).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_config(state: State<AppState>) -> AppConfig {
    state.config.lock().expect("config lock").clone()
}

#[tauri::command]
fn save_config(app: AppHandle, state: State<AppState>, config: AppConfig) -> Result<(), String> {
    persist_config(&app, &config)?;
    *state.config.lock().expect("config lock") = config;
    Ok(())
}

#[tauri::command]
fn get_provider_registry() -> Vec<ProviderInfo> {
    provider_registry()
}

#[tauri::command]
fn list_audio_devices() -> Vec<AudioDevice> {
    audio::list_devices()
}

/// The selectable speech-to-text models (Settings picker) — fastest first.
#[tauri::command]
fn list_whisper_models() -> Vec<models::WhisperModelInfo> {
    models::catalog()
}

/// Store (or clear, with an empty string) the Deepgram API key in the OS
/// vault. Enables the cloud streaming engine (Settings → engine).
#[tauri::command]
fn set_deepgram_key(key: String) -> Result<(), String> {
    asr_deepgram::store_api_key(&key).map_err(|e| e.to_string())
}

#[tauri::command]
fn deepgram_key_status() -> bool {
    asr_deepgram::load_api_key().is_some()
}

// Async commands run off the main thread — model load (~1 s) and session
// teardown must never freeze the UI.
#[tauri::command]
async fn start_session(app: AppHandle, state: State<'_, AppState>) -> Result<String, String> {
    let config = state.config.lock().expect("config lock").clone();
    if !config.consent_acknowledged {
        return Err("consent_required".into());
    }
    let rag = state.rag.clone();
    let result = state.session.start(&app, &config, rag);
    if result.is_err() {
        // A failed start may have emitted Preparing — make sure the UI's
        // loading state clears rather than sticking forever.
        let _ = app.emit(events::SESSION_STATE, SessionStateEvent::Idle);
    }
    result.map_err(|e| e.to_string())
}

#[tauri::command]
fn session_list(app: AppHandle) -> Result<Vec<session::SessionSummary>, String> {
    session::list_sessions(&app).map_err(|e| e.to_string())
}

#[tauri::command]
fn session_load(app: AppHandle, id: String) -> Result<Vec<TranscriptSegment>, String> {
    session::load_session(&app, &id).map_err(|e| e.to_string())
}

/// Render finalized transcript segments as speaker-labeled Markdown lines
/// (shared by `export_transcript` and `analyze_conversation`).
fn render_transcript_markdown(segments: &[TranscriptSegment]) -> String {
    use conva_core::audio::StreamSide;
    let mut out = String::new();
    for s in segments.iter().filter(|s| s.is_final) {
        let speaker = match s.side {
            StreamSide::Inbound => "Them",
            StreamSide::Outbound => "You",
        };
        let total_seconds = s.start_ms / 1000;
        out.push_str(&format!(
            "**{speaker}** ({:02}:{:02}:{:02}): {}\n\n",
            total_seconds / 3600,
            (total_seconds % 3600) / 60,
            total_seconds % 60,
            s.text.trim()
        ));
    }
    out
}

/// Export a transcript as Markdown to a caller-chosen path (U8). The UI
/// obtains `path` from the native save dialog.
#[tauri::command]
fn export_transcript(path: String, segments: Vec<TranscriptSegment>) -> Result<(), String> {
    let out = format!(
        "# conva transcript\n\n{}",
        render_transcript_markdown(&segments)
    );
    fs::write(&path, out).map_err(|e| e.to_string())
}

/// Write arbitrary text content to a caller-chosen path — the generic
/// counterpart to `export_transcript` for callers (like
/// `analyze_conversation`'s downloader) that produce a string rather than
/// building the file server-side. The UI obtains `path` from the native
/// save dialog, same as every other export action.
#[tauri::command]
fn write_text_file(path: String, content: String) -> Result<(), String> {
    fs::write(&path, content).map_err(|e| e.to_string())
}

/// Analyze a saved conversation's performance (spec 2026-08-26, part B) —
/// category-aware, grounded in its linked context's job description and
/// vocabulary when one exists (best-effort: a missing/deleted context
/// degrades to the ungrounded framing, never errors). Returns the
/// Markdown report text for the caller to save via the native dialog.
#[tauri::command]
fn analyze_conversation(
    app: AppHandle,
    state: State<AppState>,
    id: String,
) -> Result<String, String> {
    let conversation = conversations::load(&app, &id).map_err(|e| e.to_string())?;
    let (category, job_description, glossary) = conversation
        .linked_context_id
        .as_deref()
        .and_then(|cid| context::load(&app, cid).ok())
        .map(|s| (Some(s.category), s.job_description, s.glossary))
        .unwrap_or((None, None, Vec::new()));

    let transcript_text = render_transcript_markdown(&conversation.segments);
    let request = conva_core::context::performance_analysis_prompt(
        category,
        job_description.as_deref(),
        &glossary,
        &transcript_text,
    );

    let selection = state
        .config
        .lock()
        .expect("config lock")
        .llm_quality
        .clone();
    let key = resolve_key(selection.provider)?;
    let mut buf = String::new();
    metering::metered_stream(
        &app,
        "analyze_conversation",
        &selection,
        &key,
        &request,
        &mut |t| buf.push_str(t),
    )
    .map_err(|e| e.to_string())?;
    let text = buf.trim().to_string();
    if text.is_empty() {
        return Err("Ally returned an empty analysis.".into());
    }
    Ok(text)
}

#[tauri::command]
async fn stop_session(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    // Deactivate any conversation-context highlight terms (Phase 3c) and
    // retrieval scope (session grounding) — a stopped session always returns
    // to the unscoped default.
    clear_active_context(&state);
    state.session.stop(&app).map_err(|e| e.to_string())
}

/// Start recording the live call to a stereo WAV; returns the file path.
#[tauri::command]
fn start_recording(app: AppHandle, state: State<AppState>) -> Result<String, String> {
    state
        .session
        .start_recording(&app)
        .map_err(|e| e.to_string())
}

/// Stop the current recording; returns the saved file path (if any).
#[tauri::command]
fn stop_recording(state: State<AppState>) -> Result<Option<String>, String> {
    state.session.stop_recording().map_err(|e| e.to_string())
}

#[tauri::command]
fn recording_status(state: State<AppState>) -> bool {
    state.session.is_recording()
}

#[derive(Serialize)]
struct ProviderKeyStatus {
    id: ProviderId,
    has_key: bool,
}

#[tauri::command]
fn set_api_key(provider: ProviderId, key: String) -> Result<(), String> {
    llm::store_api_key(provider, &key).map_err(|e| e.to_string())
}

#[tauri::command]
fn provider_key_status() -> Vec<ProviderKeyStatus> {
    provider_registry()
        .into_iter()
        .map(|p| ProviderKeyStatus {
            id: p.id,
            has_key: !p.requires_api_key || matches!(llm::load_api_key(p.id), Ok(Some(_))),
        })
        .collect()
}

fn resolve_key(provider: ProviderId) -> Result<String, String> {
    llm::resolve_key(provider).map_err(|e| match e {
        conva_core::CoreError::Llm(msg) if msg == "api_key_missing" => msg,
        other => other.to_string(),
    })
}

/// Settings "Test" button: validates the stored key, returns first-token
/// latency in ms (§4.6).
#[tauri::command]
async fn test_provider(provider: ProviderId, model: String) -> Result<u32, String> {
    let key = resolve_key(provider)?;
    tauri::async_runtime::spawn_blocking(move || {
        llm::validate_key(provider, &key, &model).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn list_provider_models(provider: ProviderId) -> Result<Vec<ModelInfo>, String> {
    let key = resolve_key(provider)?;
    tauri::async_runtime::spawn_blocking(move || {
        llm::list_models(provider, &key).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

// ------------------------------------------------------------ RAG library

#[tauri::command]
async fn rag_ingest(
    state: State<'_, AppState>,
    paths: Vec<String>,
) -> Result<Vec<IngestReport>, String> {
    let store = state.rag.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut reports = Vec::new();
        for path in paths {
            match store.ingest(&path) {
                Ok(report) => reports.push(report),
                Err(e) => return Err(e.to_string()),
            }
        }
        Ok(reports)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Ingest text pasted from the clipboard as a `.txt` document (U5). The name
/// is a display label; the store persists it like any ingested file.
#[tauri::command]
async fn rag_ingest_text(
    state: State<'_, AppState>,
    name: String,
    text: String,
) -> Result<IngestReport, String> {
    let store = state.rag.clone();
    tauri::async_runtime::spawn_blocking(move || {
        store.ingest_text(&name, &text).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn rag_list(state: State<AppState>) -> Vec<RagDocument> {
    state.rag.list()
}

/// RAG-grounded term detection for transcript highlighting: retrieve the
/// library context for `text`, then return the phrases in `text` that overlap
/// it — the words worth offering an Ally action (definition / how-to /
/// elaborate) on. Empty when the library is empty or nothing overlaps.
#[tauri::command]
fn analyze_terms(app: AppHandle, state: State<AppState>, text: String) -> Vec<String> {
    // With a context active, its own documents are the relevance prior — an
    // "Amazon interview" context's AWS docs should drive what gets underlined,
    // not whatever else happens to live in the library (owner, 2026-08-21:
    // grounded context missed "API Gateway"/"Lambda"). No active scope (or a
    // never-prepared context with no profile docs) falls back to the whole
    // library, exactly as before.
    let scope = state
        .active_context_doc_ids
        .lock()
        .expect("ctx lock")
        .clone();
    let chunks = if scope.is_empty() {
        state.rag.retrieve(&text, 4)
    } else {
        state.rag.retrieve_scoped(&text, 4, &scope)
    };
    if chunks.is_empty() {
        return Vec::new();
    }
    let context = chunks
        .iter()
        .map(|c| c.text.as_str())
        .collect::<Vec<_>>()
        .join(" ");
    // Phase 3b: rarity oracle from the library's BM25 document frequencies, so
    // uncommon domain terms surface even without an active conversation context.
    let rag = state.rag.clone();
    let idf = move |term: &str| rag.token_idf(term);
    // Phase 3c: the active context's terms (a rehearsal's key terms + digest
    // glossary) — the strongest highlight signal; empty when none is active.
    let context_terms = state.active_context_terms.lock().expect("ctx lock").clone();
    // Phase 4: the user's on-device 👍/👎 — an explicit signal always wins
    // (boost surfaces, suppress drops), whatever the heuristics scored.
    let (boost, suppress) = feedback::sets(&app);
    let ctx = conva_core::highlight::HighlightContext {
        context_terms: &context_terms,
        rarity: Some(&idf),
        boost: Some(&boost),
        suppress: Some(&suppress),
        ..conva_core::highlight::HighlightContext::from_doc_text(&context)
    };
    conva_core::highlight::relevant_terms(&text, &ctx)
}

/// Record the user's 👍/👎 on a highlight term (Phase 4). `signal` is "up"
/// (boost — always surface), "down" (suppress — never surface), or null to
/// clear. Persisted on-device; consumed by `analyze_terms`.
#[tauri::command]
fn record_highlight_feedback(app: AppHandle, term: String, signal: Option<String>) {
    let sig = match signal.as_deref() {
        Some("up") | Some("boost") => Some(feedback::Signal::Boost),
        Some("down") | Some("suppress") => Some(feedback::Signal::Suppress),
        _ => None,
    };
    feedback::record(&app, &term, sig);
}

/// Record an implicit 👍 — the user researched `term` (Phase 4b). Repeated
/// research auto-boosts the term for future highlighting.
#[tauri::command]
fn record_term_pick(app: AppHandle, term: String) {
    feedback::record_pick(&app, &term);
}

/// Monotonic sequence for injected test segments.
static INJECT_SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

/// Test seam: inject a transcript segment as if it came from ASR, driving the
/// transcript UI + the highlighting pipeline (RAG / context / rarity / feedback)
/// without live audio — so E2E harnesses can exercise the app deterministically.
/// **Inert unless the app was launched with `CONVA_TEST_SEAM` set**, so it is a
/// no-op in normal use. `side` is "inbound" (them) or "outbound" (you); a final
/// segment is also written to the session log.
#[tauri::command]
fn debug_inject_segment(
    app: AppHandle,
    state: State<AppState>,
    side: String,
    text: String,
    is_final: bool,
) {
    if std::env::var("CONVA_TEST_SEAM").is_err() {
        return;
    }
    let side = if side.eq_ignore_ascii_case("inbound") {
        conva_core::audio::StreamSide::Inbound
    } else {
        conva_core::audio::StreamSide::Outbound
    };
    let start_ms = session::now_unix_ms().saturating_sub(state.session.session_started_ms());
    let segment = TranscriptSegment {
        side,
        seq: INJECT_SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed),
        text,
        is_final,
        start_ms,
        end_ms: start_ms + 100,
        confidence: None,
        latency_ms: 0,
    };
    if is_final {
        state.session.log_segment(&segment);
    }
    let _ = app.emit(events::TRANSCRIPT_SEGMENT, &segment);
}

#[tauri::command]
fn rag_set_enabled(state: State<AppState>, id: String, enabled: bool) -> Result<(), String> {
    state
        .rag
        .set_enabled(&id, enabled)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn rag_delete(state: State<AppState>, id: String) -> Result<(), String> {
    state.rag.delete(&id).map_err(|e| e.to_string())
}

/// Tag a document as attached to a Conversation Context AND sync the
/// context's own `source_doc_ids` (spec 2026-08-26, part 1 — pane/library
/// attaches previously never reached the context record, so doc counts and
/// staleness missed them). The context sync is best-effort: the tag
/// operation succeeds even if the context record can't be loaded.
#[tauri::command]
fn rag_attach_context(
    app: AppHandle,
    state: State<AppState>,
    id: String,
    context_id: String,
) -> Result<(), String> {
    state
        .rag
        .attach_context(&id, &context_id)
        .map_err(|e| e.to_string())?;
    sync_context_doc(&app, &context_id, &id, true);
    Ok(())
}

/// Remove a document's tag for a Conversation Context; see
/// [`rag_attach_context`] — also drops the id from the context's
/// `source_doc_ids` (best-effort).
#[tauri::command]
fn rag_detach_context(
    app: AppHandle,
    state: State<AppState>,
    id: String,
    context_id: String,
) -> Result<(), String> {
    state
        .rag
        .detach_context(&id, &context_id)
        .map_err(|e| e.to_string())?;
    sync_context_doc(&app, &context_id, &id, false);
    Ok(())
}

/// Add/remove `doc_id` in a context's `source_doc_ids` and apply the same
/// grounding invalidation the wizard save applies (clear derived glossary;
/// mark generated resources stale). Best-effort by design.
fn sync_context_doc(app: &AppHandle, context_id: &str, doc_id: &str, attach: bool) {
    let Ok(mut session) = context::load(app, context_id) else {
        return;
    };
    let had = session.source_doc_ids.iter().any(|d| d == doc_id);
    if attach && !had {
        session.source_doc_ids.push(doc_id.to_string());
    } else if !attach && had {
        session.source_doc_ids.retain(|d| d != doc_id);
    } else {
        return; // no change — don't touch staleness
    }
    session.glossary.clear();
    if session.dossier_doc_id.is_some() || session.knowledge_profile_id.is_some() {
        session.resources_stale = true;
    }
    let _ = context::save(app, session);
}

/// Download a library document back to `dest` (chosen via the save dialog):
/// the original uploaded file when retained, else its reconstructed text.
#[tauri::command]
async fn rag_download(state: State<'_, AppState>, id: String, dest: String) -> Result<(), String> {
    let store = state.rag.clone();
    tauri::async_runtime::spawn_blocking(move || {
        store.export_original(&id, &dest).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

// -------------------------------------------------- Portable encrypted secrets

#[derive(Serialize)]
struct SecretsStatus {
    passphrase_set: bool,
    file_present: bool,
    file_path: String,
    passphrase_env: String,
}

#[tauri::command]
fn secrets_status() -> SecretsStatus {
    let path = secrets::default_path();
    SecretsStatus {
        passphrase_set: secrets::passphrase_set(),
        file_present: path.exists(),
        file_path: path.display().to_string(),
        passphrase_env: secrets::PASSPHRASE_ENV.to_string(),
    }
}

/// Encrypt the stored API keys to a file safe to commit to git. `dest` comes
/// from the save dialog; falls back to the default path when omitted.
#[tauri::command]
async fn secrets_export(dest: Option<String>) -> Result<String, String> {
    let path = dest
        .map(std::path::PathBuf::from)
        .unwrap_or_else(secrets::default_path);
    tauri::async_runtime::spawn_blocking(move || {
        secrets::export_to(&path).map(|n| format!("Encrypted {n} key(s) → {}", path.display()))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Decrypt a secrets file and load its keys into the OS vault.
#[tauri::command]
async fn secrets_import(src: Option<String>, overwrite: bool) -> Result<String, String> {
    let path = src
        .map(std::path::PathBuf::from)
        .unwrap_or_else(secrets::default_path);
    tauri::async_runtime::spawn_blocking(move || {
        secrets::import_from(&path, overwrite).map(|n| format!("Loaded {n} key(s) from the file"))
    })
    .await
    .map_err(|e| e.to_string())?
}

// -------------------------------------------------------------- Account auth

/// App-data dir that holds the non-secret `auth.json` session snapshot (tokens
/// themselves live in the OS keyring, never here).
fn auth_dir(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("no app config dir: {e}"))?;
    let _ = fs::create_dir_all(&dir);
    Ok(dir)
}

/// Complete a `conva://auth/…` deep link: exchange the PKCE code and emit
/// AUTH_CHANGED with the result. A no-op for any URL outside the auth prefix.
///
/// Shared by both paths a deep link can arrive on:
/// - `tauri_plugin_deep_link::on_open_url` — same-instance delivery (macOS,
///   and a fresh launch on Windows/Linux when no instance is already running).
/// - the single-instance callback below — on Windows/Linux, once conva is
///   already running, the OS answers a `conva://` click by launching a
///   *second* `conva-app.exe` with the URL as an argv entry; single-instance
///   intercepts that doomed second process and forwards its argv/cwd here.
///   The plugin's "deep-link" cargo feature auto-forwards that into
///   `on_open_url` only for schemes registered at **install time**; ours are
///   registered at **runtime** via `register_all()` (dev builds), which Tauri's
///   own deep-link docs call out as a case the automatic forwarding doesn't
///   cover — "when defining deep link schemes at runtime, you must also check
///   `argv` here". Skipping that check was the actual bug behind sign-in never
///   completing: the callback used to be `|_app, _argv, _cwd| {}`, silently
///   dropping every Windows-delivered deep link.
fn handle_auth_deep_link(handle: AppHandle, url: String) {
    if !url.starts_with(auth::AUTH_DEEP_LINK_PREFIX) {
        return;
    }
    tauri::async_runtime::spawn_blocking(move || {
        let dir = match auth_dir(&handle) {
            Ok(dir) => dir,
            Err(e) => {
                eprintln!("[auth] deep link ignored — no auth dir: {e}");
                return;
            }
        };
        let payload = match auth::complete_sign_in(&url, &dir) {
            Ok(Some(status)) => {
                eprintln!("[auth] sign-in completed via deep link");
                auth::AuthChangedEvent {
                    status: Some(status),
                    error: None,
                }
            }
            // Stale or duplicate link (nothing pending).
            Ok(None) => return,
            Err(e) => {
                eprintln!("[auth] sign-in failed: {e}");
                auth::AuthChangedEvent {
                    status: None,
                    error: Some(e),
                }
            }
        };
        let _ = handle.emit(events::AUTH_CHANGED, payload);
    });
}

/// Begin interactive OAuth sign-in (PKCE + conva:// deep link). Opens the
/// system browser and returns immediately; the outcome arrives as an
/// AUTH_CHANGED event once the browser deep-links back into the app.
/// `provider` defaults to google.
#[tauri::command]
async fn auth_start(provider: Option<String>) -> Result<(), String> {
    let provider = provider.unwrap_or_else(|| "google".to_string());
    tauri::async_runtime::spawn_blocking(move || auth::begin_sign_in(&provider))
        .await
        .map_err(|e| e.to_string())?
}

/// Abandon a pending OAuth sign-in (the UI's cancel while "waiting for the
/// browser"). A deep link arriving afterwards is ignored as stale.
#[tauri::command]
fn auth_cancel() {
    auth::cancel_sign_in();
}

/// Open an external URL in the user's default browser (e.g. the website's
/// password-reset page). Runs the launch off the UI thread.
#[tauri::command]
async fn open_url(url: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || auth::open_browser(&url))
        .await
        .map_err(|e| e.to_string())?
}

/// Sign in with an email + password (Supabase). Same identity as Google / the
/// website. Runs the blocking HTTP off the UI thread.
#[tauri::command]
async fn auth_signin_password(
    app: AppHandle,
    email: String,
    password: String,
) -> Result<auth::AuthStatus, String> {
    let dir = auth_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        auth::sign_in_password(email.trim(), &password, &dir)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Create an account with an email + password (Supabase). Errors with
/// `email_confirmation_required` when the project needs an email confirmation.
#[tauri::command]
async fn auth_signup_password(
    app: AppHandle,
    email: String,
    password: String,
) -> Result<auth::AuthStatus, String> {
    let dir = auth_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        auth::sign_up_password(email.trim(), &password, &dir)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Non-secret, offline snapshot of the current session ("signed in as…").
#[tauri::command]
fn auth_status(app: AppHandle) -> Result<auth::AuthStatus, String> {
    Ok(auth::status(&auth_dir(&app)?))
}

/// Revoke server-side (best-effort) and clear local tokens + metadata.
#[tauri::command]
async fn auth_signout(app: AppHandle) -> Result<(), String> {
    let dir = auth_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || auth::sign_out(&dir))
        .await
        .map_err(|e| e.to_string())?
}

// -------------------------------------------------------------- Diagnostics

/// Write a debug report to `<app-config>/conva-debug.log` and return its path.
/// Backs the StatusBar "debug" action so users can share diagnostics as a file.
#[tauri::command]
fn save_debug_log(app: AppHandle, contents: String) -> Result<String, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("no app config dir: {e}"))?;
    let _ = fs::create_dir_all(&dir);
    let path = dir.join("conva-debug.log");
    fs::write(&path, contents).map_err(|e| e.to_string())?;
    Ok(path.display().to_string())
}

// ------------------------------------------------------------ Conversations

/// Create or update a named conversation (Stop → "save this conversation?").
/// With an existing `id` the record is replaced by the fuller transcript the
/// UI accumulated — that's how saving again appends.
#[tauri::command]
fn conversation_save(
    app: AppHandle,
    id: Option<String>,
    title: Option<String>,
    segments: Vec<TranscriptSegment>,
    linked_docs: Vec<String>,
    context_id: Option<String>,
) -> Result<conversations::Conversation, String> {
    conversations::save(&app, id, title, segments, linked_docs, context_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn conversation_list(app: AppHandle) -> Result<Vec<conversations::ConversationSummary>, String> {
    conversations::list(&app).map_err(|e| e.to_string())
}

#[tauri::command]
fn conversation_load(app: AppHandle, id: String) -> Result<conversations::Conversation, String> {
    conversations::load(&app, &id).map_err(|e| e.to_string())
}

#[tauri::command]
fn conversation_delete(app: AppHandle, id: String) -> Result<(), String> {
    conversations::delete(&app, &id).map_err(|e| e.to_string())
}

/// Create or update a Context. An empty `id` mints a
/// new record; an existing id updates in place.
#[tauri::command]
fn context_save(
    app: AppHandle,
    session: ConversationContext,
) -> Result<ConversationContext, String> {
    context::save(&app, session).map_err(|e| e.to_string())
}

#[tauri::command]
fn context_list(app: AppHandle) -> Result<Vec<ContextSummary>, String> {
    context::list(&app).map_err(|e| e.to_string())
}

#[tauri::command]
fn context_load(app: AppHandle, id: String) -> Result<ConversationContext, String> {
    context::load(&app, &id).map_err(|e| e.to_string())
}

#[tauri::command]
fn context_delete(app: AppHandle, id: String) -> Result<(), String> {
    if id == conva_core::context::DEFAULT_CONTEXT_ID {
        return Err("The default context can't be deleted.".into());
    }
    context::delete(&app, &id).map_err(|e| e.to_string())
}

/// Clear both halves of the active-context scope (session grounding). Shared
/// by `stop_session` (a stopped session always returns to unscoped) and
/// `deactivate_context` (the picker's explicit clear).
fn clear_active_context(state: &AppState) {
    state.active_context_terms.lock().expect("ctx lock").clear();
    state
        .active_context_doc_ids
        .lock()
        .expect("ctx lock")
        .clear();
}

/// Activate a conversation context for the **next** live session (session
/// grounding): fills the same two scopes rehearsal already sets on start —
/// highlight terms (key terms + digest glossary) and the retrieval scope
/// `ally()` grounds answers in — so a plain live session can ground on a
/// context exactly like a rehearsal does. Takes effect immediately (not just
/// on the next Start); cleared by `deactivate_context` or `stop_session`.
/// Returns the loaded session so the caller can show its title without a
/// second round-trip.
#[tauri::command]
fn activate_context(
    app: AppHandle,
    state: State<AppState>,
    id: String,
) -> Result<ConversationContext, String> {
    let mut session = context::load(&app, &id).map_err(|e| e.to_string())?;

    // Backfill: a context that became "ready" before glossary harvesting
    // existed (or whose digest section didn't parse at the time) carries an
    // empty glossary forever, because the picker's ready fast-path activates
    // without regenerating anything — the "From your documents list is empty
    // even though the context has compiled intelligence" bug (owner,
    // 2026-08-21). If a dossier exists, re-extract its glossary now and
    // persist it; the terms also flow into this activation below either way.
    if session.glossary.is_empty() {
        if let Some(text) = session
            .dossier_doc_id
            .as_deref()
            .and_then(|doc_id| state.rag.document_text(doc_id))
        {
            let entries = conva_core::highlight::sanitize_glossary_entries(
                conva_core::context::extract_glossary_entries(&text),
                &text,
                session.job_description.as_deref(),
                1,
            );
            if !entries.is_empty() {
                session.glossary = entries.iter().map(|(t, _)| t.clone()).collect();
                session.glossary_definitions = entries.into_iter().collect();
                // Best-effort persist — activation still proceeds with the
                // in-memory terms if the save fails.
                let _ = context::save(&app, session.clone());
            }
        }
    }

    // Second-stage backfill (owner, 2026-08-22): no key terms typed, no
    // digest ever generated — but real documents ARE attached. Mine salient
    // terms straight from those documents so "From your documents" is never
    // empty for a grounded context with content. A later digest generation
    // overwrites `glossary` with the real extracted set.
    // JD-primacy (spec B.2): the job description's own vocabulary fills the
    // list first — it's what the interviewer will actually say.
    if session.glossary.is_empty() && session.key_terms.is_empty() {
        let mut mined: Vec<String> = Vec::new();
        let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
        // The interviewer's vocabulary first (spec B.2): the job
        // description is the best predictor of what the other side will
        // say — up to 16 of the 24 slots.
        if let Some(jd) = session.job_description.as_deref() {
            for term in conva_core::highlight::interviewer_terms(jd, 16) {
                if seen.insert(term.to_lowercase()) {
                    mined.push(term);
                }
            }
        }
        // Then per-document mining fills what's left — gated (floor 2, or
        // JD presence) so one-off extraction-glue artifacts die here.
        for doc_id in &session.source_doc_ids {
            let Some(text) = state.rag.document_text(doc_id) else {
                continue;
            };
            let doc_terms = conva_core::highlight::sanitize_mined_terms(
                conva_core::highlight::salient_doc_terms(&text, 8),
                &text,
                session.job_description.as_deref(),
                2,
            );
            for term in doc_terms {
                if seen.insert(term.to_lowercase()) {
                    mined.push(term);
                }
            }
        }
        if !mined.is_empty() {
            mined.truncate(24);
            session.glossary = mined;
            let _ = context::save(&app, session.clone());
        }
    }

    // The profile's doc_ids (docs + any generated dossier) is the same
    // grounding scope rehearsal's persona prompt already uses. A context with
    // no profile yet (never prepared) activates with highlight terms only —
    // still useful, just not retrieval-scoped.
    let profile_doc_ids = session
        .knowledge_profile_id
        .as_deref()
        .and_then(|pid| context::load_profile(&app, pid).ok())
        .map(|p| p.doc_ids)
        .unwrap_or_default();

    {
        let mut terms = state.active_context_terms.lock().expect("ctx lock");
        terms.clear();
        terms.extend(session.key_terms.iter().cloned());
        terms.extend(session.glossary.iter().cloned());
        // The interviewer's own vocabulary always rides along (spec
        // 2026-08-26, part 2) — in-memory only, so live highlighting is
        // never hostage to a stale or truncated digest.
        if let Some(jd) = session.job_description.as_deref() {
            let have: std::collections::HashSet<String> =
                terms.iter().map(|t| t.to_lowercase()).collect();
            terms.extend(
                conva_core::highlight::interviewer_terms(jd, 16)
                    .into_iter()
                    .filter(|t| !have.contains(&t.to_lowercase())),
            );
        }
    }
    *state.active_context_doc_ids.lock().expect("ctx lock") = profile_doc_ids;

    Ok(session)
}

/// Clear the active conversation context (session grounding) without
/// stopping a session — e.g. the picker's "clear" action before Start.
#[tauri::command]
fn deactivate_context(state: State<AppState>) {
    clear_active_context(&state);
}

/// Copy documents into a Context's folder (named after its title); returns the
/// new paths for the caller to ingest into the RAG library.
#[tauri::command]
fn context_store_docs(
    app: AppHandle,
    title: String,
    paths: Vec<String>,
) -> Result<Vec<String>, String> {
    context::store_docs(&app, &title, paths).map_err(|e| e.to_string())
}

/// Build the reusable KnowledgeProfile (attached docs + web research) and mark
/// the Context ready.
#[tauri::command]
fn context_prepare(app: AppHandle, id: String) -> Result<ConversationContext, String> {
    context::prepare(&app, &id).map_err(|e| e.to_string())
}

/// Load a Context's KnowledgeProfile so the UI can show what grounds the
/// rehearsal — attached documents and the sources Ally researched.
#[tauri::command]
fn context_load_profile(app: AppHandle, profile_id: String) -> Result<KnowledgeProfile, String> {
    context::load_profile(&app, &profile_id).map_err(|e| e.to_string())
}

/// Generate Ally's grounding documents — the staged pipeline (spec
/// 2026-08-26). Stage 1 synthesizes the Context's documents + role/JD into a
/// **Context knowledge** briefing; Stage 2 (when research is enabled) runs
/// vocabulary-seeded web research and writes a cited **Research findings**
/// document; Stage 3 (opt-in, Interview only) runs a much broader research
/// pass and writes an **Interview Q&A** bank (spec 2026-08-26, part A). All
/// land in the library (viewable + reusable + grounding future answers) and
/// attach to the knowledge profile. Regenerating replaces the previous
/// documents. Returns the updated session.
#[tauri::command]
fn context_generate_dossier(
    app: AppHandle,
    state: State<AppState>,
    id: String,
) -> Result<ConversationContext, String> {
    let mut session = context::load(&app, &id).map_err(|e| e.to_string())?;
    let profile_id = session
        .knowledge_profile_id
        .clone()
        .ok_or_else(|| "Prepare this Context before generating a prep document.".to_string())?;
    let mut profile = context::load_profile(&app, &profile_id).map_err(|e| e.to_string())?;

    // Broad grounding across this Context's own knowledge base.
    let mut query = format!("{} {}", session.title, session.purpose);
    if let Some(jd) = &session.job_description {
        query.push(' ');
        query.push_str(jd);
    }
    let chunks = if query.trim().is_empty() {
        Vec::new()
    } else {
        state
            .rag
            .retrieve_scoped(query.trim(), 24, &profile.doc_ids)
    };

    let selection = state
        .config
        .lock()
        .expect("config lock")
        .llm_quality
        .clone();
    let key = resolve_key(selection.provider)?;
    let request = conva_core::context::knowledge_prompt(&session, &profile.research, &chunks, 3000);
    let mut buf = String::new();
    metering::metered_stream(
        &app,
        "context_knowledge",
        &selection,
        &key,
        &request,
        &mut |t| buf.push_str(t),
    )
    .map_err(|e| e.to_string())?;
    let text = buf.trim().to_string();
    if text.is_empty() {
        return Err("Ally returned an empty briefing.".into());
    }

    // Replace any previous dossier so regenerating doesn't pile up copies.
    if let Some(old) = session.dossier_doc_id.take() {
        let _ = state.rag.delete(&old);
        profile.doc_ids.retain(|d| d != &old);
    }

    // Generated (not pasted) content, tagged to this context — the library's
    // "By conva" badge/filter (Conversation Context UI, organized library).
    let name = format!("{} — Context knowledge", session.title.trim());
    let report = state
        .rag
        .ingest_generated(&name, &text, &session.id)
        .map_err(|e| e.to_string())?;
    let doc_id = report.document.id.clone();

    if !profile.doc_ids.contains(&doc_id) {
        profile.doc_ids.push(doc_id.clone());
    }

    session.dossier_doc_id = Some(doc_id);
    // Harvest the digest's glossary into structured context terms (Phase 3c) so
    // the highlighter can surface them during the conversation.
    // Harvested terms pass the mined-term hygiene gate (spec B.2/B.3):
    // bolding is already an LLM-curated signal, so the occurrence floor is
    // 1, but the word-cap and stopword rules still apply, and JD presence
    // still counts in the term's favor.
    let glossary_entries = conva_core::highlight::sanitize_glossary_entries(
        conva_core::context::extract_glossary_entries(&text),
        &text,
        session.job_description.as_deref(),
        1,
    );
    session.glossary = glossary_entries.iter().map(|(t, _)| t.clone()).collect();
    session.glossary_definitions = glossary_entries.into_iter().collect();
    // A fresh digest by definition reflects the current inputs.
    session.resources_stale = false;

    // ── Stage 2: web research → Research findings document (spec
    // 2026-08-26). Queries are seeded by Stage 1's vocabulary; failures or
    // missing key skip the stage cleanly (Stage 1's document stands).
    if session.research_enabled {
        let vocab: Vec<String> = session.glossary.iter().take(6).cloned().collect();
        let queries =
            conva_core::context::research_queries(&session, &vocab, context::RESEARCH_MAX_QUERIES);
        if let Ok((sources, searches)) = context::research(queries, context::RESEARCH_MAX_SOURCES) {
            metering::record_tavily_search(&app, searches);
            if !sources.is_empty() {
                profile.research = sources.clone();
                let request = conva_core::context::research_findings_prompt(&session, &sources);
                let mut fbuf = String::new();
                let fresult = metering::metered_stream(
                    &app,
                    "context_research_findings",
                    &selection,
                    &key,
                    &request,
                    &mut |t| fbuf.push_str(t),
                );
                if fresult.is_ok() {
                    let ftext = fbuf.trim().to_string();
                    if !ftext.is_empty() {
                        // Replace any previous findings doc — no pile-up.
                        if let Some(old) = session.research_doc_id.take() {
                            let _ = state.rag.delete(&old);
                            profile.doc_ids.retain(|d| d != &old);
                        }
                        let fname = format!("{} — Research findings", session.title.trim());
                        if let Ok(freport) = state.rag.ingest_generated(&fname, &ftext, &session.id)
                        {
                            let fdoc_id = freport.document.id.clone();
                            if !profile.doc_ids.contains(&fdoc_id) {
                                profile.doc_ids.push(fdoc_id.clone());
                            }
                            session.research_doc_id = Some(fdoc_id);
                        }
                    }
                }
            }
        }
    }

    // ── Stage 3: deep interview Q&A research (spec 2026-08-26, part A) —
    // opt-in, Interview only, much broader than Stage 2. Failures/no key
    // skip cleanly; Stage 1/2's documents stand regardless.
    if session.deep_qa_enabled
        && session.research_enabled
        && session.category == conva_core::context::ContextCategory::Interview
    {
        let qa_vocab: Vec<String> = session.glossary.iter().take(6).cloned().collect();
        let qa_queries =
            conva_core::context::qa_research_queries(&session, &qa_vocab, context::QA_MAX_QUERIES);
        if let Ok((qa_sources, qa_searches)) =
            context::research(qa_queries, context::QA_MAX_SOURCES)
        {
            metering::record_tavily_search(&app, qa_searches);
            if !qa_sources.is_empty() {
                let qa_request =
                    conva_core::context::interview_qa_prompt(&session, &qa_sources, &chunks);
                let mut qa_buf = String::new();
                let qa_result = metering::metered_stream(
                    &app,
                    "context_qa",
                    &selection,
                    &key,
                    &qa_request,
                    &mut |t| qa_buf.push_str(t),
                );
                if qa_result.is_ok() {
                    let qa_text = qa_buf.trim().to_string();
                    if !qa_text.is_empty() {
                        // Replace any previous Q&A doc — no pile-up.
                        if let Some(old) = session.qa_doc_id.take() {
                            let _ = state.rag.delete(&old);
                            profile.doc_ids.retain(|d| d != &old);
                        }
                        let qa_name = format!("{} — Interview Q&A", session.title.trim());
                        if let Ok(qa_report) =
                            state.rag.ingest_generated(&qa_name, &qa_text, &session.id)
                        {
                            let qa_doc_id = qa_report.document.id.clone();
                            if !profile.doc_ids.contains(&qa_doc_id) {
                                profile.doc_ids.push(qa_doc_id.clone());
                            }
                            session.qa_doc_id = Some(qa_doc_id);
                        }
                    }
                }
            }
        }
    }

    // One profile save covers all three stages (Stage 1's document + Stage
    // 2's research/findings doc + Stage 3's Q&A doc, whichever ran).
    profile.updated_at_unix_ms = session::now_unix_ms();
    context::save_profile(&app, &profile).map_err(|e| e.to_string())?;

    // Contexts-screen-redesign spec, requirement 5 — records when the
    // dossier pipeline actually ran, distinct from `updated_at_unix_ms`
    // (which also bumps on a plain title/purpose edit).
    session.resources_generated_at_unix_ms = Some(session::now_unix_ms());
    context::save(&app, session).map_err(|e| e.to_string())
}

/// Reconstruct a library document's text (for showing the Ally prep dossier
/// inline). Returns null if the id isn't found.
#[tauri::command]
fn rag_document_text(state: State<AppState>, id: String) -> Option<String> {
    state.rag.document_text(&id)
}

/// Generate 3 counterparty personas (Step 3) with the configured LLM, grounded
/// in the Context's goal / type / job description. Overwrites any existing
/// personas and clears the current choice.
#[tauri::command]
fn context_generate_personas(
    app: AppHandle,
    state: State<AppState>,
    id: String,
) -> Result<ConversationContext, String> {
    let mut session = context::load(&app, &id).map_err(|e| e.to_string())?;
    let selection = state
        .config
        .lock()
        .expect("config lock")
        .llm_quality
        .clone();
    let key = resolve_key(selection.provider)?;
    let (system, user) = conva_core::context::persona_prompt(&session);
    let request = LlmRequest {
        system,
        user,
        max_tokens: 1500,
    };
    let mut buf = String::new();
    metering::metered_stream(
        &app,
        "context_personas",
        &selection,
        &key,
        &request,
        &mut |t| buf.push_str(t),
    )
    .map_err(|e| e.to_string())?;
    session.personas = conva_core::context::parse_personas(&buf);
    session.chosen_persona_id = None;
    context::save(&app, session).map_err(|e| e.to_string())
}

/// Record the persona the user will rehearse against (Step 3).
#[tauri::command]
fn context_choose_persona(
    app: AppHandle,
    id: String,
    persona_id: String,
) -> Result<ConversationContext, String> {
    let mut session = context::load(&app, &id).map_err(|e| e.to_string())?;
    session.chosen_persona_id = Some(persona_id);
    context::save(&app, session).map_err(|e| e.to_string())
}

/// Start a live rehearsal (Step 4): mic-only capture, and a worker that plays
/// the chosen persona — STT → in-character LLM reply (grounded in the knowledge
/// base) → Aura TTS. Requires a chosen persona and a prepared knowledge profile.
/// Stop it with the normal `stop_session`. Returns the session id.
#[tauri::command]
async fn context_start_rehearsal(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<String, String> {
    let session = context::load(&app, &id).map_err(|e| e.to_string())?;

    // Preconditions: a chosen persona and a prepared knowledge profile.
    let persona = session
        .chosen_persona_id
        .as_ref()
        .and_then(|pid| session.personas.iter().find(|p| &p.id == pid).cloned())
        .ok_or_else(|| "Choose a persona before starting the rehearsal.".to_string())?;
    let profile_id = session
        .knowledge_profile_id
        .clone()
        .ok_or_else(|| "Prepare this Context before starting the rehearsal.".to_string())?;
    let profile = context::load_profile(&app, &profile_id).map_err(|e| e.to_string())?;

    let config = state.config.lock().expect("config lock").clone();
    if !config.consent_acknowledged {
        return Err("consent_required".into());
    }

    let selection = config.llm_quality.clone();
    let llm_key = resolve_key(selection.provider)?;
    // Aura reuses the Deepgram key; without one the rehearsal is text-only.
    let tts_key = asr_deepgram::load_api_key();

    // Activate this context's highlight terms for the rehearsal (Phase 3c):
    // user-declared key terms + the digest glossary. Cleared on stop_session.
    {
        let mut active = state.active_context_terms.lock().expect("ctx lock");
        active.clear();
        active.extend(session.key_terms.iter().cloned());
        active.extend(session.glossary.iter().cloned());
    }

    let rag = state.rag.clone();
    let rehearsal_title = session.title.clone();
    let (reh_tx, reh_rx) = std::sync::mpsc::channel();
    let (session_id, stop_flag, force_end) = state
        .session
        .start_rehearsal(&app, &config, rag.clone(), reh_tx, rehearsal_title)
        .map_err(|e| e.to_string())?;

    let ctx = rehearsal::RehearsalContext {
        selection,
        llm_key,
        tts_key,
        session,
        profile,
        persona,
        session_start_ms: state.session.session_started_ms(),
    };
    rehearsal::spawn(app.clone(), rag, reh_rx, stop_flag, force_end, ctx);
    Ok(session_id)
}

/// End the user's current rehearsal turn immediately (manual "your turn"); the
/// worker also auto-ends the turn after a pause.
#[tauri::command]
fn context_rehearsal_your_turn(state: State<AppState>) {
    state.session.rehearsal_your_turn();
}

/// Inject a typed turn (e.g. an Ally-suggested answer the user chose to "use")
/// as if the user spoke it: show it in the transcript and hand it to the
/// counterparty, who then responds. Errors if no rehearsal is active.
#[tauri::command]
fn context_rehearsal_say(
    app: AppHandle,
    state: State<AppState>,
    text: String,
) -> Result<(), String> {
    let text = text.trim().to_string();
    if text.is_empty() {
        return Ok(());
    }
    let now = session::now_unix_ms();
    let ts = now.saturating_sub(state.session.session_started_ms());
    let segment = TranscriptSegment {
        side: conva_core::audio::StreamSide::Outbound,
        // Epoch-ms seq — unique and far above the engine's small per-run seqs.
        seq: now,
        text,
        is_final: true,
        start_ms: ts,
        end_ms: ts,
        confidence: None,
        latency_ms: 0,
    };
    // Show it as the user's turn immediately + log it (bypasses the sink) +
    // forward it to FANER (same bypass gap as the persona's reply).
    let _ = app.emit(events::TRANSCRIPT_SEGMENT, segment.clone());
    state.session.log_segment(&segment);
    state.session.forward_to_capture(&segment);
    if state.session.rehearsal_inject_turn(segment) {
        Ok(())
    } else {
        Err("No rehearsal is running.".into())
    }
}

/// Store (empty clears) the Tavily web-research key in the OS vault.
#[tauri::command]
fn set_tavily_key(key: String) -> Result<(), String> {
    context::store_tavily_key(&key).map_err(|e| e.to_string())
}

#[tauri::command]
fn tavily_key_status() -> bool {
    context::load_tavily_key().is_some()
}

/// Usage snapshot for Settings → Usage: LLM tokens per provider + Tavily
/// searches, with running totals.
#[tauri::command]
fn usage_summary(app: AppHandle) -> UsageSummary {
    metering::summary(&app)
}

/// Clear all usage counters; returns the emptied snapshot.
#[tauri::command]
fn usage_reset(app: AppHandle) -> UsageSummary {
    metering::reset(&app)
}

/// Copy every library document's original into the repo `library/` folder so
/// committing it carries the library to other machines (git-synced library).
#[tauri::command]
async fn rag_sync_library(state: State<'_, AppState>) -> Result<String, String> {
    let store = state.rag.clone();
    tauri::async_runtime::spawn_blocking(move || {
        store
            .sync_to_repo_library()
            .map(|(dir, n)| {
                format!(
                    "Wrote {n} document(s) to {} — commit that folder to git.",
                    dir.display()
                )
            })
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

// --- Floating HUD panel (src/hud.rs) ----------------------------------------
// `open`/`toggle` are `async fn` — NOT a style choice. `WebviewWindowBuilder
// ::build()` deadlocks on Windows when called from a synchronous command
// (it self-blocks posting the controller-creation work back to "the main
// thread," which is the thread it's already running on); Tauri dispatches
// async commands on a worker thread instead, where that same call is the
// documented, supported pattern. See #82 and the matching comment in
// `partner.rs::open`. `close`/`is_open` never build a window, so they stay
// sync.

/// Open the floating HUD panel (or re-pin it if already open).
#[tauri::command]
async fn open_hud(app: AppHandle) -> Result<(), String> {
    hud::open(&app)
}

/// Close and destroy the floating HUD panel.
#[tauri::command]
fn close_hud(app: AppHandle) -> Result<(), String> {
    hud::close(&app)
}

/// Toggle the floating HUD panel. Returns the new state (`true` = now open).
#[tauri::command]
async fn toggle_hud(app: AppHandle) -> Result<bool, String> {
    hud::toggle(&app)
}

/// Whether the floating HUD panel is currently open.
#[tauri::command]
fn hud_is_open(app: AppHandle) -> bool {
    hud::is_open(&app)
}

// --- Partner window (src/partner.rs) -----------------------------------------
// `open_partner` is `async fn` for the same reason as the HUD commands
// above — see that comment and #82. `close`/`redock`/`get_payload` never
// build a window, so they stay sync.

/// Open (or re-target) the partner window on a term. Docked to the main
/// window's right edge on first open. `answer`/`source_lines` set = an
/// already-answered card ("Open in viewer" — owner, 2026-08-22: the viewer
/// IS this window, shown directly, no re-research); unset = a fresh term
/// from the Terms tab, which the window researches itself. `doc_id` set =
/// a library document opened directly (e.g. "view" on a Library/Context
/// row) — the window opens it as a document tab instead, ignoring
/// `kind`/`preview`/`answer`/`source_lines`.
#[tauri::command]
async fn open_partner(
    app: AppHandle,
    term: String,
    kind: Option<String>,
    preview: Option<String>,
    answer: Option<String>,
    source_lines: Vec<String>,
    doc_id: Option<String>,
) -> Result<(), String> {
    partner::open(
        &app,
        conva_core::ipc::PartnerPayload {
            term,
            kind,
            preview,
            answer,
            source_lines,
            doc_id,
        },
    )
}

/// Close and destroy the partner window.
#[tauri::command]
fn close_partner(app: AppHandle) -> Result<(), String> {
    partner::close(&app)
}

/// Snap the partner window back flush to the main window's right edge.
#[tauri::command]
fn redock_partner(app: AppHandle) -> Result<(), String> {
    partner::redock(&app)
}

/// The payload the partner view should render (read on partner-window boot).
#[tauri::command]
fn get_partner_payload() -> Option<conva_core::ipc::PartnerPayload> {
    partner::payload()
}

/// Lock (follow the main window) / unlock (float free) the partner window.
/// Locking snaps it flush to the app's right edge, keeping its size.
#[tauri::command]
fn set_partner_locked(app: AppHandle, locked: bool) -> Result<(), String> {
    partner::set_locked(&app, locked)
}

/// Whether the partner window currently follows the main window.
#[tauri::command]
fn get_partner_locked() -> bool {
    partner::locked()
}

/// Build the retrieval query for an Ally answer: the explicit question, or the
/// text of the last few finalized turns (what's being discussed right now).
fn retrieval_query(question: Option<&str>, segments: &[TranscriptSegment]) -> String {
    if let Some(q) = question {
        return q.to_string();
    }
    segments
        .iter()
        .rev()
        .filter(|s| s.is_final)
        .take(4)
        .map(|s| s.text.as_str())
        .collect::<Vec<_>>()
        .join(" ")
}

/// The tool schema offered to Ally on the Anthropic path: a single, sparingly
/// used web search. The description does the gating — the model must only reach
/// for it when its own knowledge and the user's documents fall short.
fn ally_web_tools() -> serde_json::Value {
    serde_json::json!([{
        "name": "web_search",
        "description": "Search the web for CURRENT, real-time, or niche facts \
            that are not in the user's reference material and that you cannot \
            answer confidently from your own knowledge (e.g. today's prices, \
            recent news, live rankings, very specific figures). Do NOT use it \
            for general knowledge you already have, and do NOT announce or \
            narrate that you are searching — just fold the results into a \
            concise answer.",
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "A focused search query."}
            },
            "required": ["query"]
        }
    }])
}

/// Execute an Ally tool call. Today the only tool is `web_search` (Tavily); each
/// executed query is one billed search, recorded in the usage meter.
fn run_web_tool(app: &AppHandle, name: &str, input: &serde_json::Value) -> String {
    if name != "web_search" {
        return format!("Unknown tool: {name}");
    }
    let query = input
        .get("query")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim();
    if query.is_empty() {
        return "No query provided.".into();
    }
    let Some(key) = context::load_tavily_key() else {
        return "Web search is unavailable: no Tavily key is configured.".into();
    };
    match web::tavily_search(&key, query, 3) {
        Ok(sources) => {
            // A successful request is billed by Tavily whether or not it matched.
            metering::record_tavily_search(app, 1);
            if sources.is_empty() {
                return "No results found.".into();
            }
            let mut out = String::new();
            for s in &sources {
                out.push_str(&format!("- {} ({})\n  {}\n", s.title, s.url, s.snippet));
            }
            out
        }
        Err(e) => format!("Web search failed: {e}"),
    }
}

/// Manual Ally (U4/O2): retrieves grounding chunks (R4), builds the
/// context, and streams the answer back as ALLY_CHUNK events. Returns
/// immediately.
#[tauri::command]
fn ally(
    app: AppHandle,
    state: State<AppState>,
    request_id: String,
    kind: AllyKind,
    question: Option<String>,
    segments: Vec<TranscriptSegment>,
) -> Result<(), String> {
    let selection = state
        .config
        .lock()
        .expect("config lock")
        .llm_quality
        .clone();
    let key = resolve_key(selection.provider)?;

    let query = retrieval_query(question.as_deref(), &segments);
    let chunks = if query.trim().is_empty() {
        Vec::new()
    } else {
        // Session grounding: when a conversation context is active, ground
        // Ally's answer in exactly its documents instead of the whole
        // library — the same retrieve_scoped rehearsal already uses.
        let scope = state
            .active_context_doc_ids
            .lock()
            .expect("ctx lock")
            .clone();
        if scope.is_empty() {
            state.rag.retrieve(&query, 8)
        } else {
            state.rag.retrieve_scoped(&query, 8, &scope)
        }
    };
    // R5 "peek": tell the UI which sources ground this answer, up front.
    let _ = app.emit(
        events::ALLY_SOURCES,
        AllySourcesEvent {
            request_id: request_id.clone(),
            sources: chunks
                .iter()
                .map(|c| AllySource {
                    file_name: c.file_name.clone(),
                    location: c.location.clone(),
                })
                .collect(),
        },
    );

    let request = build_ally_request(kind, &segments, &chunks, question.as_deref(), 1024);

    // Usage attribution: which Ally surface asked. Card summaries reuse the
    // `question` kind but are a distinct feature, marked by their "sum:"
    // request-id prefix (src/state/ally.ts).
    let feature: &'static str = if request_id.starts_with("sum:") {
        "ally_card_summary"
    } else {
        match kind {
            AllyKind::SuggestReply => "ally_suggest_reply",
            AllyKind::Summarize => "ally_summarize",
            AllyKind::Question => "ally_question",
        }
    };

    std::thread::Builder::new()
        .name("ally".into())
        .spawn(move || {
            let emit = |token: &str, done: bool, error: Option<String>| {
                let _ = app.emit(
                    events::ALLY_CHUNK,
                    AllyChunkEvent {
                        request_id: request_id.clone(),
                        token: token.to_string(),
                        done,
                        error,
                    },
                );
            };
            // Web search is offered to Ally only when the default provider
            // (Anthropic) is active AND a Tavily key exists. The model decides
            // whether to call it, so cost is incurred only on queries that
            // genuinely need fresh/external facts — general knowledge and
            // document questions stay a single request.
            let web_enabled =
                selection.provider == ProviderId::Anthropic && context::load_tavily_key().is_some();

            // Latency trace: time to first token + total.
            let t0 = std::time::Instant::now();
            let mut first_ms: Option<u64> = None;
            let mut usage = conva_core::llm::TokenUsage::default();
            let result = if web_enabled {
                let tools = ally_web_tools();
                let mut run_tool = |name: &str, input: &serde_json::Value| -> String {
                    run_web_tool(&app, name, input)
                };
                llm::anthropic_stream_with_tools(
                    &key,
                    &selection.model,
                    &request,
                    &tools,
                    &mut |token| {
                        first_ms.get_or_insert_with(|| t0.elapsed().as_millis() as u64);
                        emit(token, false, None);
                    },
                    &mut run_tool,
                    2,
                    &mut usage,
                )
            } else {
                llm::stream_completion(
                    selection.provider,
                    &key,
                    &selection.model,
                    &request,
                    &mut |token| {
                        first_ms.get_or_insert_with(|| t0.elapsed().as_millis() as u64);
                        emit(token, false, None);
                    },
                    &mut usage,
                )
            };
            // Record even on failure — partial-stream tokens were billed.
            // This is the documented exception to `metering::metered_stream`:
            // it picks between two transport variants (tool loop vs plain),
            // so it records through `record_llm` directly.
            metering::record_llm(
                &app,
                feature,
                selection.provider,
                &selection.model,
                usage,
                result.is_ok(),
            );
            match result {
                Ok(()) => {
                    let total_ms = t0.elapsed().as_millis() as u64;
                    trace::record(
                        "llm",
                        total_ms,
                        serde_json::json!({
                            "kind": "ally",
                            "provider": trace::provider_label(selection.provider),
                            "model": selection.model.clone(),
                            "first_token_ms": first_ms.unwrap_or(total_ms),
                            "in": usage.input_tokens,
                            "out": usage.output_tokens,
                        }),
                    );
                    emit("", true, None)
                }
                Err(e) => emit("", true, Some(e.to_string())),
            }
        })
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Filter for whisper.cpp/ggml native logs (routed through the `log` crate by
/// `whisper_rs::install_logging_hooks`). Dev builds of whisper.cpp are
/// compiled with -DWHISPER_DEBUG and emit hundreds of per-token debug lines
/// per utterance — slow enough on the Windows console to tax every decode.
/// Keep info+ from whisper/ggml (model load, GPU device pick), warn+ from
/// anything else, and drop debug/trace entirely.
struct AsrLogFilter;

impl log::Log for AsrLogFilter {
    fn enabled(&self, meta: &log::Metadata) -> bool {
        if meta.target().starts_with("whisper_rs") {
            meta.level() <= log::Level::Info
        } else {
            meta.level() <= log::Level::Warn
        }
    }

    fn log(&self, record: &log::Record) {
        if self.enabled(record.metadata()) {
            eprintln!("{}", record.args());
        }
    }

    fn flush(&self) {}
}

static ASR_LOG_FILTER: AsrLogFilter = AsrLogFilter;

/// Single shared entry point for every platform. `main.rs` (desktop) calls
/// this; on mobile Tauri generates the platform shell and the
/// `mobile_entry_point` attribute exposes `run` as its native entry. Keeping
/// one `run()` for desktop + iOS + Android is the Tauri-2 multi-platform
/// convention — see `docs/multiplatform.md`.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Install before anything touches whisper/ggml so their C-side stderr
    // chatter is level-filtered from the first model load.
    if log::set_logger(&ASR_LOG_FILTER).is_ok() {
        log::set_max_level(log::LevelFilter::Info);
    }
    whisper_rs::install_logging_hooks();

    let builder = tauri::Builder::default();

    // Single-instance must be the FIRST plugin: Windows serves a conva:// link
    // by launching a second copy of the exe, and this plugin forwards that
    // launch — URL included, via its "deep-link" feature — into the running
    // app before anything else initializes in the doomed second process.
    //
    // That auto-forward only covers schemes registered at install time,
    // though — ours are registered at runtime (`register_all()` below, dev
    // builds), so we still have to pull the URL out of `argv` ourselves and
    // hand it to the same handler `on_open_url` uses. See
    // `handle_auth_deep_link` for the full story (this was the sign-in bug).
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
        for arg in &argv {
            if arg.starts_with(auth::AUTH_DEEP_LINK_PREFIX) {
                handle_auth_deep_link(app.clone(), arg.clone());
            }
        }
    }));

    let builder = builder
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_dialog::init());

    // Desktop-only plugins: the auto-updater and process-restart have no
    // mobile equivalent (app stores own updates there). Gating them behind
    // `desktop` is the pattern for every platform-specific capability —
    // audio-loopback capture and the screen-capture-exclusion overlay will
    // follow the same shape when the mobile companion lands.
    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init());

    builder
        // Lock-to-app (spec §4.4): the main window dragging its docked
        // partner along, and a manual partner drag releasing the lock.
        .on_window_event(|window, event| {
            let app = window.app_handle();
            match event {
                tauri::WindowEvent::Moved(pos) => match window.label() {
                    "main" => partner::follow_main(app),
                    l if l == partner::PARTNER_LABEL => {
                        partner::on_partner_moved(app, (pos.x, pos.y));
                    }
                    _ => {}
                },
                tauri::WindowEvent::Resized(_) if window.label() == "main" => {
                    partner::follow_main(app);
                }
                _ => {}
            }
        })
        .setup(|app| {
            let config = load_config(app.handle());
            let data_dir = app
                .path()
                .app_data_dir()
                .expect("app data dir must resolve");
            let rag = Arc::new(RagStore::open(&data_dir).expect("open rag store"));

            // Session grounding's "required selection" invariant: a fresh
            // install always has the always-present default context to select
            // from. Local-only (no network) — safe to run synchronously here,
            // before anything can call activate_context("default").
            if let Err(e) = context::ensure_default_context(app.handle(), &rag) {
                eprintln!("[conva] couldn't seed the default context: {e}");
            }

            // One-time retroactive cleanup for generated documents an old bug
            // orphaned (regenerate's delete-old-then-create-new step used to
            // silently no-op — see `context::cleanup_orphaned_generated_docs`
            // for the full story). Idempotent, local-only — safe every launch.
            if let Err(e) = context::cleanup_orphaned_generated_docs(app.handle(), &rag) {
                eprintln!("[conva] couldn't clean up orphaned generated docs: {e}");
            }

            // Performance tracing → <app-data>/perf.jsonl (+ [perf] stderr lines).
            trace::init(data_dir.join("perf.jsonl"));

            // Seed API keys from a committed encrypted secrets file when the
            // passphrase env var is set (fills only missing keys). Lets keys
            // travel to another machine via git without re-entering them.
            secrets::seed_on_startup();

            // Warm the embedding model off the critical path (first run
            // downloads ~130 MB), then embed any chunks ingested before it
            // was ready. Retrieval degrades to BM25-only until this lands.
            {
                let rag = rag.clone();
                let cache_dir = data_dir.join("models");
                let _ = std::thread::Builder::new()
                    .name("embed-warm".into())
                    .spawn(move || {
                        embed::warm(cache_dir);
                        // Git-synced library: pick up documents committed to
                        // the repo's library/ folder by other machines, then
                        // embed everything that still lacks vectors.
                        rag.seed_from_repo_library();
                        rag.backfill_embeddings();
                    });
            }

            // Fetch the neural-VAD model in the background so it's ready for
            // the first session (falls back to the energy gate until it lands).
            let _ = models::ensure_silero(app.handle());

            let usage = metering::load(app.handle());
            app.manage(AppState {
                config: Mutex::new(config),
                session: SessionManager::new(),
                rag,
                usage: Mutex::new(usage),
                active_context_terms: Mutex::new(Vec::new()),
                active_context_doc_ids: Mutex::new(Vec::new()),
            });

            // Account sign-in return path: catch conva://auth/… deep links,
            // finish the PKCE exchange off the UI thread, and tell the UI via
            // the AUTH_CHANGED event (auth_start returns before the browser
            // round-trip completes).
            {
                use tauri_plugin_deep_link::DeepLinkExt;

                // Dev builds: register the scheme with the OS at runtime
                // (installers register it at install time; macOS only reads
                // it from the bundled Info.plist, hence the gate).
                #[cfg(any(windows, target_os = "linux"))]
                if let Err(e) = app.deep_link().register_all() {
                    eprintln!("[auth] could not register conva:// with the OS: {e}");
                }

                let handle = app.handle().clone();
                app.deep_link().on_open_url(move |event| {
                    for url in event.urls() {
                        handle_auth_deep_link(handle.clone(), url.to_string());
                    }
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_config,
            save_config,
            export_config,
            import_config,
            get_provider_registry,
            list_audio_devices,
            list_whisper_models,
            set_deepgram_key,
            deepgram_key_status,
            start_session,
            stop_session,
            start_recording,
            stop_recording,
            recording_status,
            set_api_key,
            provider_key_status,
            test_provider,
            list_provider_models,
            ally,
            rag_ingest,
            rag_ingest_text,
            rag_list,
            rag_set_enabled,
            rag_delete,
            rag_attach_context,
            rag_detach_context,
            analyze_terms,
            record_highlight_feedback,
            record_term_pick,
            capture::faner_replay,
            debug_inject_segment,
            rag_download,
            secrets_status,
            secrets_export,
            secrets_import,
            auth_start,
            auth_cancel,
            open_url,
            auth_signin_password,
            auth_signup_password,
            auth_status,
            auth_signout,
            save_debug_log,
            session_list,
            session_load,
            export_transcript,
            write_text_file,
            analyze_conversation,
            conversation_save,
            conversation_list,
            conversation_load,
            conversation_delete,
            context_save,
            context_list,
            context_load,
            context_delete,
            activate_context,
            deactivate_context,
            context_store_docs,
            context_prepare,
            context_load_profile,
            context_generate_dossier,
            rag_document_text,
            context_generate_personas,
            context_choose_persona,
            context_start_rehearsal,
            context_rehearsal_your_turn,
            context_rehearsal_say,
            set_tavily_key,
            tavily_key_status,
            usage_summary,
            usage_reset,
            rag_sync_library,
            open_hud,
            close_hud,
            toggle_hud,
            hud_is_open,
            open_partner,
            close_partner,
            redock_partner,
            get_partner_payload,
            set_partner_locked,
            get_partner_locked,
        ])
        .run(tauri::generate_context!())
        .expect("error while running conva");
}

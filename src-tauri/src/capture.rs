//! FANER capture worker + replay command (design §F11:
//! `../../conva_core/docs/technical/faner-capture-algorithm.md`).
//!
//! One thread per live session, mirroring `tracker.rs`. It buffers finalized
//! segments and runs a fast-slot LLM *routing* pass when enough new speech
//! accumulates (≥5 finals, or ≥2 finals and ≥45 s idle) — turning the other
//! party's speech into routed captures (EXPLAIN / RECALL / ASSIST / SYNTHESIZE)
//! grounded in the prepared context. Results merge into a session-scoped
//! deduped state, re-emitted as a full CAPTURE event.
//!
//! `faner_replay` is the dev/validation path: it routes a scripted transcript
//! (the golden conversations) straight through the core rubric and returns the
//! captures, so the owner can validate gold conversations in-app without
//! speaking them.
//!
//! Everything is best-effort: an extraction failure skips silently — capture is
//! an enhancement, never a blocker.

use std::sync::mpsc::{Receiver, RecvTimeoutError, Sender};
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter, State};

use conva_core::asr::TranscriptSegment;
use conva_core::audio::StreamSide;
use conva_core::capture::{
    build_capture_request, parse_capture_reply, Capture, CaptureState, PreparedContext,
};
use conva_core::ipc::{events, CaptureEvent};
use conva_core::llm::ModelSelection;

use crate::AppState;

const POLL: Duration = Duration::from_secs(5);
const MIN_BATCH: usize = 5;
const IDLE_BATCH: usize = 2;
const IDLE_AFTER: Duration = Duration::from_secs(45);

/// Spawn the worker; returns the sender for finalized segments. Dropping every
/// sender (session stop) triggers one last pass and shuts it down.
pub fn spawn_capture(
    app: AppHandle,
    selection: ModelSelection,
    api_key: String,
    ctx: PreparedContext,
) -> Sender<TranscriptSegment> {
    let (tx, rx) = std::sync::mpsc::channel::<TranscriptSegment>();
    let _ = std::thread::Builder::new()
        .name("faner-capture".into())
        .spawn(move || worker(app, selection, api_key, ctx, rx));
    tx
}

fn worker(
    app: AppHandle,
    selection: ModelSelection,
    api_key: String,
    ctx: PreparedContext,
    rx: Receiver<TranscriptSegment>,
) {
    let mut buffer: Vec<TranscriptSegment> = Vec::new();
    let mut state = CaptureState::new();
    let mut last_run = Instant::now();

    loop {
        let disconnected = match rx.recv_timeout(POLL) {
            Ok(segment) => {
                if segment.is_final && !segment.text.trim().is_empty() {
                    buffer.push(segment);
                }
                false
            }
            Err(RecvTimeoutError::Timeout) => false,
            Err(RecvTimeoutError::Disconnected) => true,
        };

        let due = buffer.len() >= MIN_BATCH
            || (buffer.len() >= IDLE_BATCH && last_run.elapsed() >= IDLE_AFTER)
            || (disconnected && !buffer.is_empty());

        if due {
            run_pass(&app, &selection, &api_key, &ctx, &mut buffer, &mut state);
            last_run = Instant::now();
        }
        if disconnected {
            return;
        }
    }
}

fn run_pass(
    app: &AppHandle,
    selection: &ModelSelection,
    api_key: &str,
    ctx: &PreparedContext,
    buffer: &mut Vec<TranscriptSegment>,
    state: &mut CaptureState,
) {
    let request = build_capture_request(buffer, ctx);
    buffer.clear();
    if request.user.trim().is_empty() {
        return;
    }

    let mut reply = String::new();
    let t0 = Instant::now();
    // metered_stream records usage even on failure (partial tokens billed).
    let result = crate::metering::metered_stream(
        app,
        "capture",
        selection,
        api_key,
        &request,
        &mut |token| reply.push_str(token),
    );
    let Ok(usage) = result else {
        return; // best-effort: skip this pass
    };
    crate::trace::record(
        "llm",
        t0.elapsed().as_millis() as u64,
        serde_json::json!({
            "kind": "capture",
            "provider": crate::trace::provider_label(selection.provider),
            "model": selection.model.clone(),
            "in": usage.input_tokens,
            "out": usage.output_tokens,
        }),
    );
    let Some(extraction) = parse_capture_reply(&reply) else {
        return;
    };
    if state.merge(extraction) {
        let _ = app.emit(
            events::CAPTURE,
            CaptureEvent {
                captures: state.captures.clone(),
            },
        );
    }
}

/// One scripted transcript line for `faner_replay`.
#[derive(Debug, Clone, serde::Deserialize)]
pub struct ReplayLine {
    /// "them" (other party) or "you" (the user); anything else defaults to them.
    pub speaker: String,
    pub text: String,
}

impl ReplayLine {
    fn into_segment(self) -> TranscriptSegment {
        let side = if self.speaker.eq_ignore_ascii_case("you") {
            StreamSide::Outbound
        } else {
            StreamSide::Inbound
        };
        TranscriptSegment {
            side,
            seq: 0,
            text: self.text,
            is_final: true,
            start_ms: 0,
            end_ms: 1,
            confidence: None,
            latency_ms: 0,
        }
    }
}

/// Route a scripted transcript through the FANER rubric once and return the
/// captures — the in-app golden-conversation validation path. Uses the
/// fast-slot model, exactly as the live worker does.
#[tauri::command]
pub async fn faner_replay(
    app: AppHandle,
    state: State<'_, AppState>,
    role: String,
    terms: Vec<String>,
    lines: Vec<ReplayLine>,
) -> Result<Vec<Capture>, String> {
    let selection = state
        .config
        .lock()
        .expect("config lock")
        .fast_selection()
        .clone();
    let key = crate::llm::resolve_key(selection.provider).map_err(|e| e.to_string())?;
    let ctx = PreparedContext { role, terms };
    let segments: Vec<TranscriptSegment> =
        lines.into_iter().map(ReplayLine::into_segment).collect();
    let request = build_capture_request(&segments, &ctx);

    tauri::async_runtime::spawn_blocking(move || {
        let mut reply = String::new();
        // The replay is a dev/eval path but still spends real tokens — meter
        // it under its own feature label so it never muddies live features.
        crate::metering::metered_stream(
            &app,
            "faner_replay",
            &selection,
            &key,
            &request,
            &mut |token| reply.push_str(token),
        )
        .map_err(|e| e.to_string())?;
        // Unlike the live worker (best-effort: a parse failure is silently
        // skipped so a bad pass never blocks the session), this is the
        // dev/test path — silently returning an empty Vec here would look
        // identical to "the model legitimately found nothing" and hide real
        // problems (e.g. a truncated reply from too low a max_tokens). Surface
        // it.
        match parse_capture_reply(&reply) {
            Some(extraction) => Ok(extraction.captures),
            None => {
                let snippet: String = reply.chars().take(500).collect();
                Err(format!(
                    "model reply didn't parse as JSON — likely truncated (raised max_tokens should fix this) or malformed. Raw reply: {snippet}"
                ))
            }
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

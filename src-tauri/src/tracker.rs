//! Commitment & entity tracker worker (design §6.3).
//!
//! One thread per live session. It buffers finalized segments and runs a
//! fast-slot LLM extraction pass when enough new speech accumulates (≥5
//! finals, or ≥2 finals and ≥45 s since the last pass). Results merge into
//! a session-scoped deduped state, re-emitted as a full TRACKER event.
//!
//! Everything is best-effort — the tracker is an enhancement, never a blocker —
//! but a failed pass is no longer lost silently: the batch it was working on is
//! kept and retried once (with a larger output cap) before it is dropped, and an
//! unusable reply is counted in Settings → Usage (answer-integrity check C3).

use std::collections::HashSet;
use std::sync::mpsc::{Receiver, RecvTimeoutError, Sender};
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter};

use conva_core::asr::TranscriptSegment;
use conva_core::ipc::{events, TrackerEvent};
use conva_core::llm::ModelSelection;
use conva_core::stop_reason::escalated_cap;
use conva_core::tracker::{
    build_tracker_request, parse_tracker_reply, TrackedCommitment, TrackedEntity,
};

const POLL: Duration = Duration::from_secs(5);
const MIN_BATCH: usize = 5;
const IDLE_BATCH: usize = 2;
const IDLE_AFTER: Duration = Duration::from_secs(45);
/// Safety net for a multi-hour session: real calls surface at most a few
/// dozen entities/commitments an hour, so this ceiling is never expected to
/// bind — it just bounds worst-case memory the way `capture.rs`'s
/// `MAX_CONTEXT_SEGMENTS` and `conversations.rs`'s `MAX_SOURCE_SESSIONS` do
/// for their own unbounded-in-theory Vecs. Evicts oldest first.
const MAX_TRACKED_ITEMS: usize = 500;
/// A batch is tried this many times (the first attempt plus one retry) before
/// it is dropped. Retries wait for the next poll or segment, so a persistent
/// failure (a bad key, a provider outage) cannot hammer the API.
const MAX_ATTEMPTS: u8 = 2;

/// Spawn the worker; returns the sender for finalized segments. Dropping
/// every sender (session stop) triggers one last pass and shuts it down.
pub fn spawn_tracker(
    app: AppHandle,
    selection: ModelSelection,
    api_key: String,
) -> Sender<TranscriptSegment> {
    let (tx, rx) = std::sync::mpsc::channel::<TranscriptSegment>();
    let _ = std::thread::Builder::new()
        .name("tracker".into())
        .spawn(move || worker(app, selection, api_key, rx));
    tx
}

struct TrackerState {
    entities: Vec<TrackedEntity>,
    commitments: Vec<TrackedCommitment>,
    seen: HashSet<String>,
}

impl TrackerState {
    fn new() -> Self {
        Self {
            entities: Vec::new(),
            commitments: Vec::new(),
            seen: HashSet::new(),
        }
    }

    fn merge(&mut self, extraction: conva_core::tracker::TrackerExtraction) -> bool {
        let mut changed = false;
        for entity in extraction.entities {
            let key = format!("e:{}", entity.label.trim().to_lowercase());
            if entity.label.trim().is_empty() || !self.seen.insert(key) {
                continue;
            }
            self.entities.push(entity);
            if self.entities.len() > MAX_TRACKED_ITEMS {
                self.entities.remove(0);
            }
            changed = true;
        }
        for commitment in extraction.commitments {
            let key = format!(
                "c:{}:{}",
                commitment.who.trim().to_lowercase(),
                commitment.what.trim().to_lowercase()
            );
            if commitment.what.trim().is_empty() || !self.seen.insert(key) {
                continue;
            }
            self.commitments.push(commitment);
            if self.commitments.len() > MAX_TRACKED_ITEMS {
                self.commitments.remove(0);
            }
            changed = true;
        }
        changed
    }
}

fn worker(
    app: AppHandle,
    selection: ModelSelection,
    api_key: String,
    rx: Receiver<TranscriptSegment>,
) {
    let mut buffer: Vec<TranscriptSegment> = Vec::new();
    let mut state = TrackerState::new();
    let mut last_run = Instant::now();
    let mut failed_attempts: u8 = 0;

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
            if run_extraction(
                &app,
                &selection,
                &api_key,
                &mut buffer,
                &mut state,
                failed_attempts,
            ) {
                failed_attempts = 0;
            } else {
                failed_attempts += 1;
                if failed_attempts >= MAX_ATTEMPTS {
                    // Give up on this batch rather than carry it forever.
                    eprintln!(
                        "[tracker] dropping {} segments after {MAX_ATTEMPTS} failed passes",
                        buffer.len()
                    );
                    buffer.clear();
                    failed_attempts = 0;
                }
            }
            last_run = Instant::now();
        }
        if disconnected {
            return;
        }
    }
}

/// Run one extraction pass over the buffered segments. Returns `true` when the
/// batch is finished with (merged, or nothing to send) and `false` when the
/// pass failed or its reply was unusable, in which case **the buffer is kept**
/// so the caller can retry it. `attempt` is how many passes already failed for
/// this batch; a retry gets a larger output cap.
fn run_extraction(
    app: &AppHandle,
    selection: &ModelSelection,
    api_key: &str,
    buffer: &mut Vec<TranscriptSegment>,
    state: &mut TrackerState,
    attempt: u8,
) -> bool {
    let mut request = build_tracker_request(buffer);
    if request.user.trim().is_empty() {
        buffer.clear();
        return true;
    }
    if attempt > 0 {
        request.max_tokens = escalated_cap(request.max_tokens);
    }

    let mut reply = String::new();
    let t0 = Instant::now();
    // metered_stream records usage even on failure (partial tokens billed).
    let result = crate::metering::metered_stream(
        app,
        "tracker",
        selection,
        api_key,
        &request,
        &mut |token| reply.push_str(token),
    );
    let Ok(outcome) = result else {
        return false; // best-effort: keep the batch for one retry
    };
    let usage = outcome.usage;
    crate::trace::record(
        "llm",
        t0.elapsed().as_millis() as u64,
        serde_json::json!({
            "kind": "tracker",
            "provider": crate::trace::provider_label(selection.provider),
            "model": selection.model.clone(),
            "in": usage.input_tokens,
            "out": usage.output_tokens,
        }),
    );
    let Some(extraction) = parse_tracker_reply(&reply) else {
        crate::metering::record_unusable_reply(
            app,
            "tracker",
            selection.provider,
            &selection.model,
        );
        return false;
    };
    buffer.clear();
    if state.merge(extraction) {
        let _ = app.emit(
            events::TRACKER,
            TrackerEvent {
                entities: state.entities.clone(),
                commitments: state.commitments.clone(),
            },
        );
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    use conva_core::tracker::TrackerExtraction;

    fn extraction_with_entity(label: &str) -> TrackerExtraction {
        TrackerExtraction {
            entities: vec![TrackedEntity {
                label: label.to_string(),
                detail: String::new(),
            }],
            commitments: vec![],
        }
    }

    #[test]
    fn entities_are_capped_with_oldest_evicted_first() {
        let mut state = TrackerState::new();
        for i in 0..MAX_TRACKED_ITEMS + 10 {
            state.merge(extraction_with_entity(&format!("entity-{i}")));
        }
        assert_eq!(state.entities.len(), MAX_TRACKED_ITEMS);
        assert_eq!(state.entities.first().unwrap().label, "entity-10");
        assert_eq!(
            state.entities.last().unwrap().label,
            format!("entity-{}", MAX_TRACKED_ITEMS + 9)
        );
    }

    #[test]
    fn duplicate_entities_still_dedupe_under_the_cap() {
        let mut state = TrackerState::new();
        state.merge(extraction_with_entity("Acme Corp"));
        let changed = state.merge(extraction_with_entity("Acme Corp"));
        assert!(!changed);
        assert_eq!(state.entities.len(), 1);
    }
}

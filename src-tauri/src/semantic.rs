//! Local-first FANER semantic claim producer.
//!
//! Final transcript segments are queued from the ASR sink and interpreted on
//! a dedicated per-session worker. The fast-slot model may propose semantic
//! frames, but `conva-core` owns validation, identity, consequence, lifecycle,
//! and the empty initial evidence state. This module never performs research
//! or verification.

use std::sync::mpsc::{Receiver, RecvTimeoutError, Sender};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use tauri::{AppHandle, Emitter};

use conva_core::asr::TranscriptSegment;
use conva_core::claim::{ClaimCorrection, ClaimCorrectionKind, ClaimKey, ClaimRecord, ClaimState};
use conva_core::context::ContextCategory;
use conva_core::context_snapshot::{ContextSnapshot, ParticipationLens, RecentClaim};
use conva_core::ipc::{events, ClaimSnapshotEvent, CLAIM_SNAPSHOT_CONTRACT_VERSION};
use conva_core::llm::ModelSelection;
use conva_core::semantic_extraction::{
    build_semantic_extraction_request, claim_records_from_extraction,
    parse_semantic_extraction_reply, settled_transcript_segments, MAX_EXTRACTION_SEGMENTS,
};

const QUIET_AFTER: Duration = Duration::from_millis(750);

fn semantic_due(last_segment_elapsed: Option<Duration>, disconnected: bool) -> bool {
    last_segment_elapsed.is_some_and(|elapsed| elapsed >= QUIET_AFTER)
        || (disconnected && last_segment_elapsed.is_some())
}

pub fn default_context_snapshot() -> ContextSnapshot {
    ContextSnapshot::new(
        ContextCategory::Other,
        ParticipationLens::OtherSpeaker,
        "General live conversation",
    )
    .expect("the default semantic Context Snapshot is valid")
}

/// Spawn a best-effort semantic worker. Dropping every sender triggers one
/// final pass before shutdown.
pub fn spawn_semantic(
    app: AppHandle,
    selection: ModelSelection,
    api_key: String,
    session_id: String,
    snapshot: ContextSnapshot,
) -> std::io::Result<Sender<TranscriptSegment>> {
    let (tx, rx) = std::sync::mpsc::channel::<TranscriptSegment>();
    std::thread::Builder::new()
        .name("faner-semantic".into())
        .spawn(move || worker(app, selection, api_key, session_id, snapshot, rx))?;
    Ok(tx)
}

fn worker(
    app: AppHandle,
    selection: ModelSelection,
    api_key: String,
    session_id: String,
    snapshot: ContextSnapshot,
    rx: Receiver<TranscriptSegment>,
) {
    let mut state = SemanticState::new(session_id, snapshot);
    let mut last_segment = None;

    loop {
        let disconnected = match rx.recv_timeout(QUIET_AFTER) {
            Ok(segment) => {
                if state.push(segment) {
                    last_segment = Some(Instant::now());
                }
                false
            }
            Err(RecvTimeoutError::Timeout) => false,
            Err(RecvTimeoutError::Disconnected) => true,
        };

        if semantic_due(last_segment.map(|at: Instant| at.elapsed()), disconnected) {
            run_pass(&app, &selection, &api_key, &mut state);
            last_segment = None;
        }
        if disconnected {
            return;
        }
    }
}

struct SemanticState {
    session_id: String,
    context: ContextSnapshot,
    segments: Vec<TranscriptSegment>,
    claims: Vec<ClaimRecord>,
    revision: u64,
}

impl SemanticState {
    fn new(session_id: String, context: ContextSnapshot) -> Self {
        Self {
            session_id,
            context: context.bounded(),
            segments: Vec::new(),
            claims: Vec::new(),
            revision: 0,
        }
    }

    fn push(&mut self, segment: TranscriptSegment) -> bool {
        if !segment.is_final || segment.text.trim().is_empty() {
            return false;
        }
        self.segments.push(segment);
        self.segments = settled_transcript_segments(&self.segments);
        if self.segments.len() > MAX_EXTRACTION_SEGMENTS {
            self.segments
                .drain(..self.segments.len() - MAX_EXTRACTION_SEGMENTS);
        }
        true
    }

    fn request(&self) -> Option<conva_core::llm::LlmRequest> {
        if self.segments.is_empty() {
            return None;
        }
        build_semantic_extraction_request(&self.segments, &self.context).ok()
    }

    fn apply_reply(&mut self, reply: &str, now_unix_ms: u64) -> Option<ClaimSnapshotEvent> {
        let extraction = parse_semantic_extraction_reply(reply, &self.context, &self.segments)?;
        let proposed =
            claim_records_from_extraction(&self.session_id, extraction, &self.context, now_unix_ms);
        let mut changed = false;

        for claim in proposed {
            if self.claims.iter().any(|existing| existing.id == claim.id) {
                continue;
            }

            // A corrected final for the same transcript segment supersedes the
            // earlier interpretation rather than leaving two active truths.
            for existing in self.claims.iter_mut().filter(|existing| {
                existing.state != ClaimState::Superseded
                    && existing
                        .source_segment_ids
                        .iter()
                        .any(|source| claim.source_segment_ids.contains(source))
                    && existing.id != claim.id
            }) {
                existing.state = ClaimState::Superseded;
                existing.updated_at_unix_ms = now_unix_ms;
                existing.corrections.push(ClaimCorrection {
                    kind: ClaimCorrectionKind::Transcript,
                    previous_value: existing.exact_quote.clone(),
                    corrected_value: claim.exact_quote.clone(),
                    corrected_by: "asr_final_revision".into(),
                    created_at_unix_ms: now_unix_ms,
                });
            }

            let key = ClaimKey::new(
                &claim.normalized_proposition,
                claim
                    .attribution_chain
                    .first()
                    .map(|attribution| attribution.source_label.as_str()),
            );
            self.context.recent_claims.push(RecentClaim {
                key,
                state: claim.state,
                speaker_label: claim.speaker_label.clone(),
            });
            self.claims.push(claim);
            changed = true;
        }

        if !changed {
            return None;
        }
        self.context = self.context.clone().bounded();
        self.revision += 1;
        Some(ClaimSnapshotEvent {
            contract_version: CLAIM_SNAPSHOT_CONTRACT_VERSION,
            session_id: self.session_id.clone(),
            epoch: 0,
            revision: self.revision,
            claims: self.claims.clone(),
        })
    }
}

fn run_pass(app: &AppHandle, selection: &ModelSelection, api_key: &str, state: &mut SemanticState) {
    let Some(request) = state.request() else {
        return;
    };
    let mut reply = String::new();
    let t0 = Instant::now();
    let result = crate::metering::metered_stream(
        app,
        "faner_semantic",
        selection,
        api_key,
        &request,
        &mut |token| reply.push_str(token),
    );
    let Ok(usage) = result else {
        return;
    };
    crate::trace::record(
        "llm",
        t0.elapsed().as_millis() as u64,
        serde_json::json!({
            "kind": "faner_semantic",
            "provider": crate::trace::provider_label(selection.provider),
            "model": selection.model.clone(),
            "in": usage.input_tokens,
            "out": usage.output_tokens,
        }),
    );

    if let Some(event) = state.apply_reply(&reply, now_unix_ms()) {
        let _ = app.emit(events::CLAIM_SNAPSHOT, event);
    }
}

fn now_unix_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[cfg(test)]
mod tests {
    use super::*;
    use conva_core::audio::StreamSide;
    use conva_core::claim::Consequence;

    fn segment(seq: u64, text: &str) -> TranscriptSegment {
        TranscriptSegment {
            side: StreamSide::Inbound,
            seq,
            text: text.into(),
            is_final: true,
            start_ms: seq * 100,
            end_ms: seq * 100 + 99,
            confidence: None,
            latency_ms: 1,
        }
    }

    #[test]
    fn final_segments_run_after_quiet_period_or_disconnect() {
        assert!(!semantic_due(None, false));
        assert!(!semantic_due(Some(Duration::from_millis(749)), false));
        assert!(semantic_due(Some(Duration::from_millis(750)), false));
        assert!(semantic_due(Some(Duration::ZERO), true));
        assert!(!semantic_due(None, true));
    }

    #[test]
    fn state_emits_cumulative_monotonic_snapshots_and_suppresses_repeats() {
        let mut state = SemanticState::new("session-one".into(), default_context_snapshot());
        state.push(segment(
            1,
            "ABC News is reporting that both people died in the Arizona crash",
        ));
        let first_reply = r#"{"frames":[{"source_segment_ids":["inbound:1"],"speaker_side":"inbound","kind":"claim","exact_quote":"ABC News is reporting that both people died in the Arizona crash","normalized_proposition":"both people died in the Arizona crash","predicate":"died","subject":"both people","attribution_chain":[{"source_label":"ABC News","reporting_verb":"is reporting","directness":"reported_by_speaker"}],"qualifiers":[{"kind":"location","value":"Arizona","unit":null}],"suggested_actions":["verify"]}]}"#;
        let first = state.apply_reply(first_reply, 100).unwrap();
        assert_eq!(first.revision, 1);
        assert_eq!(first.claims.len(), 1);
        assert_eq!(first.claims[0].consequence, Consequence::High);
        assert!(state.apply_reply(first_reply, 101).is_none());

        state.push(segment(2, "The boat had 7 people in it"));
        let second_reply = r#"{"frames":[{"source_segment_ids":["inbound:2"],"speaker_side":"inbound","kind":"claim","exact_quote":"The boat had 7 people in it","normalized_proposition":"the boat had 7 people in it","predicate":"had","subject":"the boat","qualifiers":[{"kind":"quantity","value":"7","unit":"people"}],"suggested_actions":["verify"]}]}"#;
        let second = state.apply_reply(second_reply, 200).unwrap();
        assert_eq!(second.revision, 2);
        assert_eq!(second.claims.len(), 2);
        assert_eq!(second.claims[0], first.claims[0]);
    }

    #[test]
    fn corrected_final_supersedes_an_earlier_claim_from_the_same_segment() {
        let mut state = SemanticState::new("session-one".into(), default_context_snapshot());
        state.push(segment(1, "The boat had 7 people in it"));
        let first_reply = r#"{"frames":[{"source_segment_ids":["inbound:1"],"speaker_side":"inbound","kind":"claim","exact_quote":"The boat had 7 people in it","normalized_proposition":"the boat had 7 people in it","predicate":"had","subject":"the boat"}]}"#;
        state.apply_reply(first_reply, 100).unwrap();

        state.push(segment(1, "The boat had 8 people in it"));
        let corrected_reply = r#"{"frames":[{"source_segment_ids":["inbound:1"],"speaker_side":"inbound","kind":"claim","exact_quote":"The boat had 8 people in it","normalized_proposition":"the boat had 8 people in it","predicate":"had","subject":"the boat"}]}"#;
        let corrected = state.apply_reply(corrected_reply, 200).unwrap();

        assert_eq!(corrected.claims.len(), 2);
        assert_eq!(corrected.claims[0].state, ClaimState::Superseded);
        assert_eq!(corrected.claims[0].corrections.len(), 1);
        assert_eq!(corrected.claims[1].state, ClaimState::Detected);
    }
}

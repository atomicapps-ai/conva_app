//! Per-session FANER Question Radar worker.
//!
//! Transcript delivery stays latency-critical: finalized segments are queued
//! here and Context-scoped hybrid retrieval runs on this named worker instead
//! of the ASR sink. Every detected question emits a result, including misses,
//! so the UI can always offer a safe "Say now" bridge.

use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::Arc;
use std::time::Instant;

use conva_core::asr::TranscriptSegment;
use conva_core::audio::StreamSide;
use conva_core::bridge::bridge_response;
use conva_core::ipc::{events, RadarEvent};
use conva_core::live_assist::{looks_like_data_request, would_handle};
use conva_core::prepared_qa::match_prepared_qa;
use conva_core::radar::looks_like_question;
use conva_core::rag::{classify_evidence, evidence_confidence};
use tauri::{AppHandle, Emitter};

use crate::rag::RagStore;

pub fn spawn_radar(
    app: AppHandle,
    rag: Arc<RagStore>,
    scope: Vec<String>,
    session_id: String,
) -> std::io::Result<Sender<TranscriptSegment>> {
    let (tx, rx) = mpsc::channel();
    std::thread::Builder::new()
        .name("faner-radar".into())
        .spawn(move || run(app, rag, scope, session_id, rx))?;
    Ok(tx)
}

fn run(
    app: AppHandle,
    rag: Arc<RagStore>,
    scope: Vec<String>,
    session_id: String,
    rx: Receiver<TranscriptSegment>,
) {
    let prepared = rag.prepared_qa_entries(&scope);
    while let Ok(segment) = rx.recv() {
        if !segment.is_final
            || segment.side != StreamSide::Inbound
            || !looks_like_question(&segment.text)
        {
            continue;
        }

        let started = Instant::now();
        let turn_id = format!("{session_id}:them:{}", segment.seq);
        let source_key = format!("inbound-{}", segment.seq);
        let prepared_match = match_prepared_qa(&segment.text, &prepared);
        let sources = if let Some(hit) = prepared_match {
            vec![conva_core::rag::ScoredChunk {
                document_id: hit.entry.document_id.clone(),
                file_name: hit.entry.file_name.clone(),
                location: hit.entry.location.clone(),
                text: hit.entry.answer.clone(),
                score: hit.confidence,
            }]
        } else {
            rag.retrieve_scoped(&segment.text, 3, &scope)
        };
        let confidence = prepared_match
            .map(|hit| hit.confidence)
            .unwrap_or_else(|| evidence_confidence(&segment.text, &sources));
        let outcome = if prepared_match.is_some() {
            conva_core::bridge::RetrievalKind::PreparedHit
        } else {
            classify_evidence(&segment.text, &sources)
        };
        let bridge = bridge_response(
            &segment.text,
            outcome,
            sources.first().map(|source| source.text.as_str()),
        );

        // A spreadsheet question is answered by exact arithmetic (live assist);
        // flag it so the UI never asks a language model for the figures too.
        // Same live table scope the coordinator uses, and the cheap textual gate
        // first so ordinary questions never touch a table file.
        let computed = looks_like_data_request(&segment.text) && {
            let (tables, _) = crate::live_assist::active_tables(&app);
            let table_refs: Vec<&conva_core::table::TableDataset> =
                tables.iter().map(|t| t.as_ref()).collect();
            would_handle(&segment.text, &table_refs)
        };

        crate::trace::record(
            "faner_radar",
            started.elapsed().as_millis() as u64,
            serde_json::json!({
                "turn_id": turn_id,
                "outcome": outcome,
                "confidence": confidence,
                "hits": sources.len(),
                "scoped": !scope.is_empty(),
            }),
        );

        let _ = app.emit(
            events::RADAR,
            RadarEvent {
                turn_id,
                source_key,
                question: segment.text,
                outcome,
                confidence,
                bridge,
                sources,
                computed,
            },
        );
    }
}

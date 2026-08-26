//! Transcription Layer contract (design §4.2).
//!
//! `TranscriptionEngine` is the pluggable seam: local whisper.cpp is the
//! default implementation, cloud engines (Deepgram streaming) are opt-in.
//! Selecting an engine is a config choice, never an architecture change.

use serde::{Deserialize, Serialize};

use crate::audio::{AudioFrame, StreamSide};
use crate::CoreError;

/// A partial or final transcription segment (IPC-visible; §4.2 T4 metadata).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranscriptSegment {
    pub side: StreamSide,
    /// Monotonic per-side sequence number. A final segment replaces all
    /// partials that carried the same `seq`.
    pub seq: u64,
    pub text: String,
    /// Partial (still mutating) vs final (settled) — drives the UI "settle"
    /// treatment (§5.1 principle 3).
    pub is_final: bool,
    /// Audio-timeline bounds of this segment, in milliseconds from session
    /// start.
    pub start_ms: u64,
    pub end_ms: u64,
    /// Engine confidence in [0.0, 1.0] where the engine reports one.
    pub confidence: Option<f32>,
    /// Measured capture→emit latency in milliseconds (per-stage HUD, §2.4
    /// rule 3).
    pub latency_ms: u32,
}

/// Identifies a transcription engine implementation in config and UI.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AsrEngineId {
    /// Local whisper.cpp — the default.
    WhisperLocal,
    /// Deepgram streaming WebSocket — cloud opt-in.
    DeepgramCloud,
}

/// A streaming speech-to-text engine bound to one side of the conversation.
/// The two sides run independent engine instances so neither stream can
/// head-of-line block the other (§4.2 T3).
pub trait TranscriptionEngine: Send {
    fn id(&self) -> AsrEngineId;

    /// Feed captured audio. Implementations buffer internally (VAD-gated
    /// chunking) and emit segments through `sink` as they become available.
    fn feed(&mut self, frame: AudioFrame) -> Result<(), CoreError>;

    /// Register the segment sink. Called once before the first `feed`.
    fn set_sink(&mut self, sink: Box<dyn FnMut(TranscriptSegment) + Send>);

    /// Flush any buffered audio as final segments (session stop).
    fn finish(&mut self) -> Result<(), CoreError>;
}

/// Clean raw engine text for display: strip stray "|" marks (a decode
/// artifact observed live, 2026-08-21), collapse whitespace runs to single
/// spaces, and close up the space some tokenizers leave before punctuation
/// (" ." → "."). Applied at the segment source so every consumer — UI,
/// conversations, RAG grounding — sees the cleaned text.
pub fn sanitize_transcript_text(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    for ch in raw.chars() {
        if ch == '|' {
            continue;
        }
        if ch.is_whitespace() {
            if !out.is_empty() && !out.ends_with(' ') {
                out.push(' ');
            }
            continue;
        }
        if matches!(ch, ',' | '.' | '!' | '?' | ';' | ':' | ')' | '%') && out.ends_with(' ') {
            out.pop();
        }
        out.push(ch);
    }
    out.trim_end().to_string()
}

#[cfg(test)]
mod sanitize_tests {
    use super::sanitize_transcript_text;

    #[test]
    fn strips_pipes_collapses_spaces_and_tightens_punctuation() {
        assert_eq!(
            sanitize_transcript_text("back-end services . | When  an   authenticated user"),
            "back-end services. When an authenticated user"
        );
        assert_eq!(sanitize_transcript_text("  plain text.  "), "plain text.");
        assert_eq!(sanitize_transcript_text("P99 metrics ?"), "P99 metrics?");
        assert_eq!(sanitize_transcript_text("| | |"), "");
        assert_eq!(sanitize_transcript_text(""), "");
    }
}

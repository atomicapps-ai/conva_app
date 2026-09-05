//! The typed IPC contract between the Rust core and the UI.
//!
//! Event names and payload shapes defined here are hand-mirrored in
//! `src/lib/ipc.ts` on the UI side. If you change anything in this file,
//! change the TypeScript mirror in the same commit (a ts-rs codegen step
//! replaces the hand mirror later in Phase 1).

use serde::{Deserialize, Serialize};

use crate::asr::TranscriptSegment;
use crate::audio::StreamSide;

/// Event channel names (Tauri `emit` topics).
pub mod events {
    /// Payload: [`super::TranscriptSegment`]
    pub const TRANSCRIPT_SEGMENT: &str = "conva://transcript-segment";
    /// Payload: [`super::AudioLevelEvent`]
    pub const AUDIO_LEVEL: &str = "conva://audio-level";
    /// Payload: [`super::SessionStateEvent`]
    pub const SESSION_STATE: &str = "conva://session-state";
    /// Payload: [`super::AllyChunkEvent`]
    pub const ALLY_CHUNK: &str = "conva://ally-chunk";
    /// Payload: [`super::ModelStatusEvent`]
    pub const MODEL_STATUS: &str = "conva://model-status";
    /// Payload: [`super::AllySourcesEvent`]
    pub const ALLY_SOURCES: &str = "conva://ally-sources";
    /// Payload: [`super::RadarEvent`]
    pub const RADAR: &str = "conva://radar";
    /// Payload: [`super::TrackerEvent`]
    pub const TRACKER: &str = "conva://tracker";
    /// Payload: [`super::CaptureEvent`]
    pub const CAPTURE: &str = "conva://capture";
    /// Payload: [`super::RehearsalStateEvent`]
    pub const REHEARSAL_STATE: &str = "conva://rehearsal-state";
    /// Payload: `AuthChangedEvent` — defined shell-side in
    /// `src-tauri/src/auth.rs` (next to `AuthStatus`, which never crosses into
    /// core) and mirrored in `src/lib/ipc.ts`. Emitted when an OAuth sign-in
    /// finishes out-of-band via the `conva://auth/callback` deep link.
    pub const AUTH_CHANGED: &str = "conva://auth-changed";
    /// A new term was sent to the (already-open) partner window.
    pub const PARTNER_TERM: &str = "conva://partner-term";
    /// The partner window's lock-to-app state changed shell-side (e.g. a
    /// manual drag released it) — the window updates its toggle icon.
    pub const PARTNER_LOCK: &str = "conva://partner-lock";
    /// Payload: [`super::SplashProgressEvent`]
    pub const SPLASH_PROGRESS: &str = "conva://splash-progress";
}

/// Re-exported so the IPC module is a one-stop description of the wire.
pub type TranscriptEvent = TranscriptSegment;

/// The versioned capture/source/session/event contract (browser product
/// architecture M0) — additive to everything above. Lives in
/// `capture_contract.rs`, mirrored by hand in `src/lib/capture/contract.ts`.
pub use crate::capture_contract::{
    channel_for_side, legacy_segment_id, side_for_channel, speaker_ref_for_side, Availability,
    CaptureChannel, CaptureOwner, CaptureSourceCapability, CaptureSourceKind, ContinuityModel,
    ConvaEvent, LegacySegmentRef, ProcessingMode, SpeakerRef, TranscriptPayload,
    CONTRACT_SCHEMA_VERSION,
};

/// VU meter + stream-health payload (A4), emitted ~10 Hz per side.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AudioLevelEvent {
    pub side: StreamSide,
    /// RMS level in dBFS (<= 0.0; silence approaches -inf, clamp at -90).
    pub rms_dbfs: f32,
    /// True when the watchdog considers the stream healthy (frames flowing).
    pub healthy: bool,
}

/// Session lifecycle broadcast (U3).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", tag = "state")]
pub enum SessionStateEvent {
    Idle,
    /// Session start is underway but not yet capturing — model loading, GPU
    /// shader compilation (minutes on the first GPU run), engine connect.
    /// The UI shows a loading state with `message` instead of a dead screen.
    Preparing {
        message: String,
    },
    Listening {
        session_id: String,
        started_at_unix_ms: u64,
    },
    Paused {
        session_id: String,
    },
    Error {
        message: String,
    },
}

/// Which reference chunks grounded an Ally answer (R5 "peek" — emitted
/// once per request, before the first token).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AllySourcesEvent {
    pub request_id: String,
    pub sources: Vec<AllySource>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AllySource {
    pub file_name: String,
    pub location: String,
}

/// Question Radar result (§6.2): always emitted for a detected inbound
/// question, including a safe bridge when the active Context has no match.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RadarEvent {
    /// Correlates detection, retrieval, and later refinement for one turn.
    pub turn_id: String,
    /// Existing transcript bubble identity (`inbound-<seq>`) for UI linking.
    pub source_key: String,
    /// The inbound utterance that triggered the radar.
    pub question: String,
    pub outcome: crate::bridge::RetrievalKind,
    /// Conservative evidence coverage signal in [0, 1].
    pub confidence: f32,
    /// Stable, immediately speakable content while refinement continues.
    pub bridge: crate::bridge::BridgeResponse,
    pub sources: Vec<crate::rag::ScoredChunk>,
}

/// Cumulative tracker state for the live session (§6.3) — the full deduped
/// list, re-emitted after each extraction pass.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrackerEvent {
    pub entities: Vec<crate::tracker::TrackedEntity>,
    pub commitments: Vec<crate::tracker::TrackedCommitment>,
}

/// FANER routed captures for the live session (F11) — the full deduped list of
/// `(trigger, action, arguments)` decisions, re-emitted after each capture
/// pass. See `capture.rs` and `docs/technical/faner-capture-algorithm.md`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CaptureEvent {
    pub captures: Vec<crate::capture::Capture>,
}

/// What the partner window shows (owner mockup, 2026-08-21): the term it was
/// opened for, plus the FANER classification + preview when it came from a
/// capture. Delivered via the `get_partner_payload` command on window boot and
/// re-sent over `events::PARTNER_TERM` when a new term targets an open window.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PartnerPayload {
    pub term: String,
    /// FANER kind/action tag when opened from a capture (e.g. "concept").
    pub kind: Option<String>,
    /// The capture's short preview/definition, when available.
    pub preview: Option<String>,
    /// An already-answered Ally card's text, when the partner window was
    /// opened via "Open in viewer" on an existing card (owner, 2026-08-22:
    /// the viewer IS the partner window, not an internal drawer) — the
    /// window shows this directly instead of re-researching the term.
    /// `None` for a fresh term opened from the Terms tab, which researches.
    pub answer: Option<String>,
    /// Already-grouped "file — ¶loc, ¶loc" citation lines for `answer`.
    pub source_lines: Vec<String>,
    /// Set when this open targets a library document directly (e.g. "view"
    /// on a Library/Context row) rather than a term or answer — the window
    /// opens it as a document tab (`term` doubles as the file name) and
    /// fetches its full text itself via `documentText`, same as clicking a
    /// "FROM YOUR DOCUMENTS" citation line. `None` for every other open.
    pub doc_id: Option<String>,
}

/// Payload of [`events::PARTNER_LOCK`] — whether the partner window is
/// locked to (follows) the main window.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PartnerLockEvent {
    pub locked: bool,
}

/// Live Context rehearsal phase (Phase E) — drives the "who's talking" UI
/// (speaking animation + active-speaker indicator).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", tag = "phase")]
pub enum RehearsalStateEvent {
    /// Waiting for the user's turn (speak, or use a suggested answer).
    Listening,
    /// Generating the counterparty's reply.
    Thinking,
    /// The counterparty is speaking (TTS playing).
    Speaking,
    /// The rehearsal has ended.
    Ended,
}

/// ASR model provisioning progress (T6 first-run downloader).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", tag = "state")]
pub enum ModelStatusEvent {
    Downloading { model: String, percent: u8 },
    Ready { model: String },
    Error { model: String, message: String },
}

/// Boot-sequence progress for the splash window (`src-tauri/src/splash.rs`).
/// Each variant is a real, discrete milestone the boot sequence has actually
/// finished — not a timed/simulated fill. `percent` is monotonically
/// increasing across the sequence: Started(0) → LibraryLoaded(35) →
/// WorkspaceReady(60) → AlmostReady(85) → done (the splash closes once the
/// main window's own `init()` resolves; there is no explicit 100 variant —
/// closing *is* the 100% signal).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", tag = "stage")]
pub enum SplashProgressEvent {
    Started { percent: u8 },
    LibraryLoaded { percent: u8 },
    WorkspaceReady { percent: u8 },
    AlmostReady { percent: u8 },
    Failed { percent: u8, message: String },
}

impl SplashProgressEvent {
    pub fn percent(&self) -> u8 {
        match self {
            Self::Started { percent }
            | Self::LibraryLoaded { percent }
            | Self::WorkspaceReady { percent }
            | Self::AlmostReady { percent }
            | Self::Failed { percent, .. } => *percent,
        }
    }
}

/// One streamed piece of an Ally answer (U4/O2).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AllyChunkEvent {
    /// Correlates chunks to the request that produced them.
    pub request_id: String,
    pub token: String,
    pub done: bool,
    /// Set (with `done: true`) when the request failed mid-stream.
    pub error: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn session_state_serializes_with_tag() {
        let e = SessionStateEvent::Listening {
            session_id: "s1".into(),
            started_at_unix_ms: 123,
        };
        let json = serde_json::to_value(&e).unwrap();
        assert_eq!(json["state"], "listening");
        assert_eq!(json["session_id"], "s1");
    }

    #[test]
    fn event_names_are_namespaced() {
        for name in [
            events::TRANSCRIPT_SEGMENT,
            events::AUDIO_LEVEL,
            events::SESSION_STATE,
            events::ALLY_CHUNK,
            events::RADAR,
            events::AUTH_CHANGED,
            events::SPLASH_PROGRESS,
        ] {
            assert!(name.starts_with("conva://"), "{name}");
        }
    }

    #[test]
    fn radar_event_serializes_correlated_bridge_contract() {
        let event = RadarEvent {
            turn_id: "session-1:them:7".into(),
            source_key: "inbound-7".into(),
            question: "What is RRF?".into(),
            outcome: crate::bridge::RetrievalKind::Miss,
            confidence: 0.0,
            bridge: crate::bridge::BridgeResponse {
                kind: crate::bridge::BridgeKind::Definition,
                text: "Define it first.".into(),
            },
            sources: Vec::new(),
        };
        let json = serde_json::to_value(event).unwrap();
        assert_eq!(json["turn_id"], "session-1:them:7");
        assert_eq!(json["source_key"], "inbound-7");
        assert_eq!(json["outcome"], "miss");
        assert_eq!(json["bridge"]["kind"], "definition");
    }

    #[test]
    fn splash_progress_serializes_with_tag_and_is_monotonic() {
        let stages = [
            SplashProgressEvent::Started { percent: 0 },
            SplashProgressEvent::LibraryLoaded { percent: 35 },
            SplashProgressEvent::WorkspaceReady { percent: 60 },
            SplashProgressEvent::AlmostReady { percent: 85 },
        ];
        let mut last = -1i16;
        for stage in stages {
            let json = serde_json::to_value(&stage).unwrap();
            assert!(json["stage"].is_string());
            let percent = stage.percent();
            assert!(
                i16::from(percent) > last,
                "stages must strictly increase, got {percent} after {last}"
            );
            last = i16::from(percent);
        }
    }

    #[test]
    fn splash_progress_started_tags_as_started() {
        let json = serde_json::to_value(SplashProgressEvent::Started { percent: 0 }).unwrap();
        assert_eq!(json["stage"], "started");
        assert_eq!(json["percent"], 0);
    }
}

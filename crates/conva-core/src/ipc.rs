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
    /// Payload: [`super::ClaimSnapshotEvent`]
    pub const CLAIM_SNAPSHOT: &str = "conva://claim-snapshot";
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
    /// Payload: [`super::ViewState`] — the main window's live View (4)
    /// content, pushed to the partner window that renders it.
    pub const PARTNER_VIEW_STATE: &str = "conva://partner-view-state";
    /// Payload: [`super::ViewAction`] — something the user did in View (4)
    /// (select a tab, pin, elaborate, ask), sent back to the main window.
    pub const PARTNER_VIEW_ACTION: &str = "conva://partner-view-action";
    /// Payload: [`super::SplashProgressEvent`]
    pub const SPLASH_PROGRESS: &str = "conva://splash-progress";
    /// Payload: [`super::LiveAssistResult`] — progressive live-assist output
    /// (holding response, then the completed grid), correlated by
    /// `result_id`. A newer `revision` of the same `result_id` replaces it.
    pub const LIVE_ASSIST: &str = "conva://live-assist";
    /// Payload: [`super::ContextGenerateProgressEvent`]
    pub const CONTEXT_GENERATE_PROGRESS: &str = "conva://context-generate-progress";
    /// Payload: [`super::ArchiveProgressEvent`]. No adapter emits this yet
    /// (checkpoint A defines the contract only).
    pub const ARCHIVE_PROGRESS: &str = "conva://archive-progress";
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
    /// True when live assist is computing an exact answer for this question
    /// (a total over an attached spreadsheet). The UI must not also start a
    /// model answer for it: a language model must never produce the figures.
    #[serde(default)]
    pub computed: bool,
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

pub const CLAIM_SNAPSHOT_CONTRACT_VERSION: u32 = 2;

/// Cumulative claim state for one live-session epoch. Consumers accept only a
/// greater revision in the same epoch, or the first revision of a newer epoch.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ClaimSnapshotEvent {
    pub contract_version: u32,
    pub session_id: String,
    pub epoch: u64,
    pub revision: u64,
    #[serde(default)]
    pub claims: Vec<crate::claim::ClaimRecord>,
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
    /// Complete typed claim state when the viewer was opened from Tracking.
    /// Kept optional so older stored/event payloads and non-claim viewer opens
    /// remain valid. The viewer presents this record without starting research.
    #[serde(default)]
    pub claim: Option<crate::claim::ClaimRecord>,
}

/// One highlighted term with why it is highlighted — the return of
/// `analyze_terms`. `origin` drives visual weight in transcript bubbles (a term
/// surfaced only by a domain lexicon pack renders quieter). Mirrored in
/// `src/lib/ipc.ts`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HighlightTerm {
    /// The transcript's own text for the term (original casing).
    pub term: String,
    pub origin: crate::phrase::HighlightOrigin,
}

impl HighlightTerm {
    /// Pair each selected term of an evaluation with its origin.
    pub fn from_evaluation(eval: &crate::phrase::HighlightEvaluation) -> Vec<HighlightTerm> {
        eval.terms
            .iter()
            .zip(&eval.origins)
            .map(|(term, origin)| HighlightTerm {
                term: term.clone(),
                origin: *origin,
            })
            .collect()
    }
}

/// One labelled fact row shown under a View (4) item ("Who · You").
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ViewFact {
    pub label: String,
    pub value: String,
}

/// One item in View (4) — mirrors the UI's `AllyFocusItem`
/// (`src/components/transcript/allyFocus.ts`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ViewItem {
    pub id: String,
    /// `question` | `prep` | `term` | `commitment` | `mention`.
    pub group: String,
    pub question: String,
    pub answer: String,
    pub source_label: String,
    #[serde(default)]
    pub source_files: Vec<String>,
    /// `instant` | `streaming` | `ready` | `error`.
    pub status: String,
    #[serde(default)]
    pub card_id: Option<String>,
    #[serde(default)]
    pub found_id: Option<String>,
    /// `field` | `specialized` (captured terms).
    #[serde(default)]
    pub tier: Option<String>,
    /// `concept` | `problem` (captured terms).
    #[serde(default)]
    pub kind: Option<String>,
    #[serde(default)]
    pub facts: Vec<ViewFact>,
    /// A structured grid answer (spreadsheet totals). `answer` still carries
    /// the speakable Say-now line so older readers degrade to text.
    #[serde(default)]
    pub table: Option<GridPayload>,
    /// A question waiting on the user's pick (ambiguous column or file).
    #[serde(default)]
    pub choice: Option<ViewChoice>,
    /// True when a newer question replaced this live-assist result.
    #[serde(default)]
    pub stale: bool,
}

/// A question shown inside a View item with tappable options.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ViewChoice {
    pub question: String,
    pub options: Vec<crate::table_query::ChoiceOption>,
}

/// Everything View (4) shows. The main window owns the truth (it has the
/// radar, tracker, captures and Ally cards); the partner window is a live
/// mirror of this state, pushed over [`events::PARTNER_VIEW_STATE`].
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct ViewState {
    pub items: Vec<ViewItem>,
    #[serde(default)]
    pub active_id: Option<String>,
    #[serde(default)]
    pub pinned_ids: Vec<String>,
}

// ---------------------------------------------------------------------------
// Live assist — progressive, source-linked answers that need real computation
// (today: exact spreadsheet totals). Mirrored in `src/lib/ipc.ts`.
// ---------------------------------------------------------------------------

/// Bump when the serialized shape of [`LiveAssistResult`] changes incompatibly.
pub const LIVE_ASSIST_CONTRACT_VERSION: u32 = 1;

/// What kind of computation produced a result.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LiveAssistKind {
    /// Grouped or overall arithmetic over a CSV / XLSX table.
    TableAggregate,
}

/// Where a result is in its life. Results only move forward, except that a
/// new `revision` of the same `result_id` replaces the previous one.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LiveAssistLifecycle {
    /// A holding response: work is under way.
    Provisional,
    /// Waiting on the user to pick a column or file.
    NeedsChoice,
    /// The finished, source-linked answer.
    Complete,
    /// Final, but there is no computed answer (unsupported sheet, unknown
    /// column, too complex). `payload` explains why.
    Declined,
    /// Something went wrong while computing.
    Failed,
    /// A newer question replaced this one before it finished.
    Superseded,
}

impl LiveAssistLifecycle {
    /// True once no further revision is expected.
    pub fn is_final(self) -> bool {
        !matches!(self, Self::Provisional | Self::NeedsChoice)
    }
}

/// Where a figure came from: the file, the column, and the rows.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SourceRef {
    pub doc_id: String,
    pub file_name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sheet: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub column: Option<String>,
    /// First source rows that contributed (capped for size).
    pub rows: Vec<u32>,
    /// True number of rows that contributed.
    pub row_count: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GridAlign {
    Left,
    Right,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GridColumn {
    pub key: String,
    pub label: String,
    pub align: GridAlign,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GridCell {
    /// Display text (`$439,519.85`).
    pub text: String,
    /// Exact machine value as a plain decimal string, when the cell is a number.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub value: Option<String>,
    /// Provenance; empty for labels.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub sources: Vec<SourceRef>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GridRowKind {
    Body,
    Total,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GridRow {
    pub kind: GridRowKind,
    pub cells: Vec<GridCell>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NoticeLevel {
    Info,
    Caution,
}

/// A note under a grid: what was skipped, repeated, or worth checking.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GridNotice {
    pub level: NoticeLevel,
    pub text: String,
    /// Source rows the note is about (capped).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub rows: Vec<u32>,
}

/// A table answer, ready to draw.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GridPayload {
    /// `Total Amount by District`.
    pub title: String,
    pub columns: Vec<GridColumn>,
    pub rows: Vec<GridRow>,
    #[serde(default)]
    pub notices: Vec<GridNotice>,
    /// Files the figures came from, for the "From your documents" list.
    #[serde(default)]
    pub source_files: Vec<String>,
}

/// What a live-assist result shows.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum LiveAssistPayload {
    Text {
        text: String,
    },
    Grid(GridPayload),
    Choice {
        question: String,
        options: Vec<crate::table_query::ChoiceOption>,
    },
}

/// Timing for one result, all measured from the moment the finalized turn was
/// handed to the coordinator (`enqueued_at_unix_ms`). Durations are `None`
/// until that stage happens.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct LiveAssistTiming {
    pub enqueued_at_unix_ms: u64,
    /// Enqueue → holding response emitted.
    #[serde(default)]
    pub holding_ms: Option<u64>,
    /// Enqueue → this revision emitted.
    #[serde(default)]
    pub emitted_ms: Option<u64>,
    /// Time spent parsing the file and computing (excludes queueing).
    #[serde(default)]
    pub compute_ms: Option<u64>,
}

/// One live-assist result. The same `result_id` is emitted several times as it
/// progresses (`revision` 1 = holding, higher = later); consumers keep only
/// the highest revision they have seen for each `result_id`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LiveAssistResult {
    pub contract_version: u32,
    pub result_id: String,
    /// Ties the result to the turn that caused it (`{session}:them:{seq}` for
    /// heard speech, `{session}:ask:{n}` for typed questions). Radar uses the
    /// same turn ids, so the UI can link the two.
    pub correlation_id: String,
    pub session_id: String,
    #[serde(default)]
    pub context_id: Option<String>,
    pub revision: u32,
    pub kind: LiveAssistKind,
    pub lifecycle: LiveAssistLifecycle,
    /// The sentence that prompted this.
    pub question: String,
    /// A line the user can say right now.
    #[serde(default)]
    pub say_now: Option<String>,
    #[serde(default)]
    pub payload: Option<LiveAssistPayload>,
    pub timing: LiveAssistTiming,
    /// Set when `lifecycle` is `superseded`: the newer result's id.
    #[serde(default)]
    pub superseded_by: Option<String>,
}

/// Return value of the live-assist submit / choose commands.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LiveAssistAck {
    /// False when the text is not a data request; the caller should hand it to
    /// Ally as usual.
    pub handled: bool,
    #[serde(default)]
    pub result_id: Option<String>,
}

/// What the user can do in View (4). The main window performs it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ViewActionKind {
    /// Focus the item `id` (its tab was clicked).
    Select,
    /// Toggle the pin on `id`.
    Pin,
    /// Ask Ally for a fuller pass on `id`.
    Elaborate,
    /// Ask a follow-up `text` about `id`.
    Ask,
    /// Answer the choice shown on `id`; `text` is the chosen option id.
    Choose,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ViewAction {
    pub kind: ViewActionKind,
    pub id: String,
    #[serde(default)]
    pub text: Option<String>,
}

/// Payload of [`events::PARTNER_LOCK`] — whether the partner window is
/// locked to (follows) the main window.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PartnerLockEvent {
    pub locked: bool,
}

/// Result of starting a live Context rehearsal — the command's return value,
/// not an event. `voice_enabled` tells the UI up front whether the persona
/// will actually be spoken (Aura TTS reuses the Deepgram key; with none
/// configured the rehearsal silently runs text-only) so it can show a
/// "voice unavailable" notice instead of leaving the user wondering why
/// nothing is playing (owner, 2026-09-15).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StartRehearsalResult {
    pub session_id: String,
    pub voice_enabled: bool,
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
    /// The reply was generated (and shown as text) but Aura TTS failed to
    /// speak it — a transient notice, not a persistent phase; the very next
    /// event is always `Listening`. Without this, a synthesis failure (bad
    /// key, no TTS scope, rate limit) was silent — logged to stderr only —
    /// and looked to the user like "the coach doesn't respond" even though
    /// the reply was right there in the transcript.
    SpeechFailed { error: String },
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
/// WorkspaceReady(60) → AlmostReady(85) → Ready(100). Ready is emitted only
/// after the main window's own `init()` resolves, giving the splash a visible
/// completion beat before it crossfades away.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", tag = "stage")]
pub enum SplashProgressEvent {
    Started { percent: u8 },
    LibraryLoaded { percent: u8 },
    WorkspaceReady { percent: u8 },
    AlmostReady { percent: u8 },
    Ready { percent: u8 },
    Failed { percent: u8, message: String },
}

impl SplashProgressEvent {
    pub fn percent(&self) -> u8 {
        match self {
            Self::Started { percent }
            | Self::LibraryLoaded { percent }
            | Self::WorkspaceReady { percent }
            | Self::AlmostReady { percent }
            | Self::Ready { percent }
            | Self::Failed { percent, .. } => *percent,
        }
    }
}

/// Coarse progress ticks for the desktop "Generate/Regenerate Context
/// resources" pipeline (`context_generate_dossier_blocking` in
/// `src-tauri/src/lib.rs`) — that command is one blocking round trip with no
/// return until every stage finishes, so without this the UI has nothing to
/// show for however long that takes. `percent` is a fixed checkpoint per
/// stage, not a measured duration — there's no real ETA to give (it depends
/// on LLM + web-research latency), so this is "how far through" rather than
/// "how long left". `Researching` is only emitted when web research is
/// actually enabled for the Context; a run with it off starts at `WritingQa`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", tag = "stage")]
pub enum ContextGenerateProgressEvent {
    Researching { context_id: String, percent: u8 },
    WritingQa { context_id: String, percent: u8 },
    CompilingKnowledge { context_id: String, percent: u8 },
    Saving { context_id: String, percent: u8 },
}

impl ContextGenerateProgressEvent {
    pub fn context_id(&self) -> &str {
        match self {
            Self::Researching { context_id, .. }
            | Self::WritingQa { context_id, .. }
            | Self::CompilingKnowledge { context_id, .. }
            | Self::Saving { context_id, .. } => context_id,
        }
    }

    pub fn percent(&self) -> u8 {
        match self {
            Self::Researching { percent, .. }
            | Self::WritingQa { percent, .. }
            | Self::CompilingKnowledge { percent, .. }
            | Self::Saving { percent, .. } => *percent,
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
    /// Set with `done: true` on a stream that finished: why the model
    /// stopped (`complete`, `truncated`, `refused`, `other`, `unknown` — see
    /// `stop_reason::StopReason`). `None` on token chunks and on errors, and
    /// from older peers; the UI treats a missing value as complete.
    #[serde(default)]
    pub stop_reason: Option<crate::stop_reason::StopReason>,
}

// ── `.cva` archive operation contract (checkpoint A) ────────────────────────
//
// MAINTENANCE: this is the OPERATION-level contract the shared UI/backend
// call through (`ConvaBackend.archive` in `src/lib/backend/ConvaBackend.ts`,
// mirrored in `src/lib/ipc.ts`) — distinct from the pure portable DTOs in
// `archive.rs`/`archive_payload.rs`/`archive_conversation.rs`, which never
// cross this boundary directly (an inspection preview is a deliberately
// reduced, sanitized view — never a raw portable payload, file path, or
// opaque backend handle; see `.cva` spec §8.3/§9). No adapter implements
// these operations yet (checkpoint B+): every capability answers
// `unimplemented` until real ZIP I/O and persistence exist behind it. A
// field/shape change here is illustrative-contract churn until then, but
// still updates the TypeScript mirror and `ConvaBackend` in the same commit.

/// What to export: a Context alone, or a saved conversation optionally
/// bundled with its linked Context (spec §2.4).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ArchiveExportScope {
    Context {
        context_id: String,
    },
    Conversation {
        conversation_id: String,
        include_context: bool,
    },
}

/// User choice controlling source-document inclusion (spec §2.4).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct ArchiveExportOptions {
    pub include_source_documents: bool,
}

/// A coarse, content-free size/privacy estimate shown before the user
/// commits to writing the file (spec §8.2). Never a preview of document or
/// transcript text.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct ArchiveExportEstimate {
    pub document_count: u32,
    pub estimated_bytes: u64,
    pub includes_source_documents: bool,
}

/// Result of a completed export.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ArchiveExportResult {
    /// Desktop: the saved file path. Web: an opaque download reference the
    /// UI already used to trigger the browser download — never a raw local
    /// path on either platform beyond what the OS save dialog itself shows.
    pub destination: String,
    pub archive_digest: String,
    pub bytes: u64,
}

/// Sanitized summary of one Context inside an inspected archive — never the
/// raw `PortableContextV1`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ArchiveContextPreview {
    pub title: String,
    pub category: crate::context::ContextCategory,
    pub key_terms_count: u32,
    pub prepared_qa_count: u32,
    pub has_source_documents: bool,
}

/// Sanitized summary of one conversation inside an inspected archive.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ArchiveConversationPreview {
    pub title: String,
    pub created_at_unix_ms: u64,
    pub segment_count: u32,
    pub speaker_count: u32,
    pub duration_ms: u64,
    pub has_claim_review: bool,
}

/// One document/generated-artifact entry as shown in the import preview
/// (spec §8.3) — `included` is false for a metadata-only reference whose
/// original bytes were not part of this export.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ArchiveDocumentPreview {
    pub portable_id: String,
    pub file_name: String,
    pub bytes: Option<u64>,
    pub included: bool,
}

/// Non-blocking compatibility/duplicate signals shown in the import preview
/// (spec §7.2). Never a reason to refuse the preview itself — only to shape
/// the default "Import as copy" choice.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ArchiveCompatibilityWarning {
    DuplicateArchiveDigest,
    DuplicateDocument { portable_id: String },
    PossibleDuplicateContext,
    PossibleDuplicateConversation,
    UnsupportedDocument { portable_id: String, reason: String },
    MigratedFromOlderVersion { from_format_version: u32 },
}

/// Side-effect-free preview of a selected/uploaded `.cva`. Selecting a file
/// must never itself create a record (spec §8.3) — this is the entire
/// result of that inspection step.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ArchiveInspection {
    pub archive_digest: String,
    pub format_version: u32,
    pub created_by_app_version: String,
    pub created_at: String,
    pub title: String,
    pub context: Option<ArchiveContextPreview>,
    pub conversation: Option<ArchiveConversationPreview>,
    pub documents: Vec<ArchiveDocumentPreview>,
    pub warnings: Vec<ArchiveCompatibilityWarning>,
}

/// User decisions confirmed on the import preview screen (spec §8.3):
/// editable destination titles plus which previewed documents to actually
/// bring in vs. reuse an existing identical one.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ArchiveImportOptions {
    #[serde(default)]
    pub context_title: Option<String>,
    #[serde(default)]
    pub conversation_title: Option<String>,
    pub include_document_ids: Vec<String>,
    #[serde(default)]
    pub reuse_exact_document_ids: Vec<String>,
}

/// One document the importer declined to bring in, with a user-facing
/// reason (spec §5.3/§6.3) — the import itself still succeeds for the rest.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ArchiveOmittedDocument {
    pub portable_id: String,
    pub reason: String,
}

/// Result of a completed import (spec §8.3/§9). IDs are always freshly
/// minted destination IDs — an import never reuses a portable/source ID.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ArchiveImportResult {
    pub context_id: Option<String>,
    pub conversation_id: Option<String>,
    pub imported_document_ids: Vec<String>,
    pub reused_document_ids: Vec<String>,
    pub omitted_documents: Vec<ArchiveOmittedDocument>,
}

/// Streamed progress for an in-flight export/import/inspect operation (spec
/// §10) — `operation_id` scopes cancellation and lets the UI ignore stale
/// events from an operation it already gave up on. Never carries transcript
/// or document content, only coarse counts and a safe display message.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "phase", rename_all = "snake_case")]
pub enum ArchiveProgressEvent {
    Hashing {
        operation_id: String,
        processed_bytes: u64,
        total_bytes: u64,
    },
    WritingEntries {
        operation_id: String,
        processed_items: u32,
        total_items: u32,
    },
    Validating {
        operation_id: String,
    },
    Importing {
        operation_id: String,
        processed_items: u32,
        total_items: u32,
    },
    Completed {
        operation_id: String,
    },
    Cancelled {
        operation_id: String,
    },
    Failed {
        operation_id: String,
        message: String,
    },
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
    fn highlight_term_serializes_origin_in_snake_case() {
        use crate::phrase::HighlightOrigin;
        let t = HighlightTerm {
            term: "modeling data".into(),
            origin: HighlightOrigin::Domain,
        };
        let json = serde_json::to_value(&t).unwrap();
        assert_eq!(json["term"], "modeling data");
        assert_eq!(json["origin"], "domain");
        let back: HighlightTerm = serde_json::from_value(json).unwrap();
        assert_eq!(back, t);
        for (origin, wire) in [
            (HighlightOrigin::Context, "context"),
            (HighlightOrigin::Document, "document"),
            (HighlightOrigin::Entity, "entity"),
            (HighlightOrigin::Rarity, "rarity"),
        ] {
            assert_eq!(serde_json::to_value(origin).unwrap(), wire);
        }
    }

    #[test]
    fn event_names_are_namespaced() {
        for name in [
            events::TRANSCRIPT_SEGMENT,
            events::AUDIO_LEVEL,
            events::SESSION_STATE,
            events::ALLY_CHUNK,
            events::RADAR,
            events::CLAIM_SNAPSHOT,
            events::LIVE_ASSIST,
            events::AUTH_CHANGED,
            events::SPLASH_PROGRESS,
            events::CONTEXT_GENERATE_PROGRESS,
        ] {
            assert!(name.starts_with("conva://"), "{name}");
        }
    }

    #[test]
    fn context_generate_progress_serializes_with_tag_and_exposes_id_and_percent() {
        let e = ContextGenerateProgressEvent::WritingQa {
            context_id: "c1".into(),
            percent: 45,
        };
        let json = serde_json::to_value(&e).unwrap();
        assert_eq!(json["stage"], "writing_qa");
        assert_eq!(json["context_id"], "c1");
        assert_eq!(json["percent"], 45);
        assert_eq!(e.context_id(), "c1");
        assert_eq!(e.percent(), 45);
    }

    #[test]
    fn claim_snapshot_serializes_the_versioned_cumulative_contract() {
        let event = ClaimSnapshotEvent {
            contract_version: CLAIM_SNAPSHOT_CONTRACT_VERSION,
            session_id: "session-1".into(),
            epoch: 2,
            revision: 7,
            claims: Vec::new(),
        };

        let json = serde_json::to_value(event).unwrap();
        assert_eq!(events::CLAIM_SNAPSHOT, "conva://claim-snapshot");
        assert_eq!(json["contract_version"], 2);
        assert_eq!(json["session_id"], "session-1");
        assert_eq!(json["epoch"], 2);
        assert_eq!(json["revision"], 7);
        assert_eq!(json["claims"], serde_json::json!([]));
    }

    #[test]
    fn view_state_and_actions_round_trip_with_stable_wire_names() {
        let state = ViewState {
            items: vec![ViewItem {
                id: "card:a1".into(),
                group: "question".into(),
                question: "Q".into(),
                answer: "A".into(),
                source_label: "A1".into(),
                source_files: vec!["brief.md".into()],
                status: "ready".into(),
                card_id: Some("a1".into()),
                found_id: None,
                tier: None,
                kind: None,
                facts: vec![ViewFact {
                    label: "Who".into(),
                    value: "You".into(),
                }],
                table: None,
                choice: None,
                stale: false,
            }],
            active_id: Some("card:a1".into()),
            pinned_ids: vec!["card:a1".into()],
        };
        let json = serde_json::to_value(&state).unwrap();
        assert_eq!(json["items"][0]["source_files"][0], "brief.md");
        assert_eq!(json["active_id"], "card:a1");
        assert_eq!(serde_json::from_value::<ViewState>(json).unwrap(), state);

        let action = ViewAction {
            kind: ViewActionKind::Elaborate,
            id: "card:a1".into(),
            text: None,
        };
        let json = serde_json::to_value(&action).unwrap();
        assert_eq!(json["kind"], "elaborate");
        assert_eq!(serde_json::from_value::<ViewAction>(json).unwrap(), action);
    }

    #[test]
    fn older_view_items_default_to_no_table_choice_or_stale() {
        let item: ViewItem = serde_json::from_value(serde_json::json!({
            "id": "card:a1", "group": "question", "question": "Q", "answer": "A",
            "source_label": "A1", "status": "ready"
        }))
        .unwrap();
        assert!(item.table.is_none() && item.choice.is_none() && !item.stale);
    }

    #[test]
    fn live_assist_result_wire_contract_is_stable() {
        let result = LiveAssistResult {
            contract_version: LIVE_ASSIST_CONTRACT_VERSION,
            result_id: "r1".into(),
            correlation_id: "s1:them:4".into(),
            session_id: "s1".into(),
            context_id: Some("c1".into()),
            revision: 2,
            kind: LiveAssistKind::TableAggregate,
            lifecycle: LiveAssistLifecycle::Complete,
            question: "total per district?".into(),
            say_now: Some("The total is $10.00.".into()),
            payload: Some(LiveAssistPayload::Grid(GridPayload {
                title: "Total Amount by District".into(),
                columns: vec![GridColumn {
                    key: "district".into(),
                    label: "District".into(),
                    align: GridAlign::Left,
                }],
                rows: vec![GridRow {
                    kind: GridRowKind::Total,
                    cells: vec![GridCell {
                        text: "$10.00".into(),
                        value: Some("10.00".into()),
                        sources: vec![SourceRef {
                            doc_id: "d1".into(),
                            file_name: "sales.csv".into(),
                            sheet: None,
                            column: Some("Amount".into()),
                            rows: vec![2, 3],
                            row_count: 2,
                        }],
                    }],
                }],
                notices: vec![GridNotice {
                    level: NoticeLevel::Caution,
                    text: "2 blank".into(),
                    rows: vec![14],
                }],
                source_files: vec!["sales.csv".into()],
            })),
            timing: LiveAssistTiming {
                enqueued_at_unix_ms: 1,
                holding_ms: Some(3),
                emitted_ms: Some(12),
                compute_ms: Some(8),
            },
            superseded_by: None,
        };
        let json = serde_json::to_value(&result).unwrap();
        assert_eq!(events::LIVE_ASSIST, "conva://live-assist");
        assert_eq!(json["contract_version"], 1);
        assert_eq!(json["lifecycle"], "complete");
        assert_eq!(json["kind"], "table_aggregate");
        assert_eq!(json["payload"]["type"], "grid");
        assert_eq!(json["payload"]["rows"][0]["kind"], "total");
        assert_eq!(json["payload"]["rows"][0]["cells"][0]["value"], "10.00");
        assert_eq!(json["timing"]["emitted_ms"], 12);
        assert_eq!(
            serde_json::from_value::<LiveAssistResult>(json).unwrap(),
            result
        );
    }

    #[test]
    fn live_assist_lifecycle_finality() {
        use LiveAssistLifecycle::*;
        for (l, fin) in [
            (Provisional, false),
            (NeedsChoice, false),
            (Complete, true),
            (Declined, true),
            (Failed, true),
            (Superseded, true),
        ] {
            assert_eq!(l.is_final(), fin, "{l:?}");
        }
    }

    #[test]
    fn older_partner_payloads_default_to_no_claim() {
        let payload: PartnerPayload = serde_json::from_value(serde_json::json!({
            "term": "API Gateway",
            "kind": "concept",
            "preview": null,
            "answer": null,
            "source_lines": [],
            "doc_id": null
        }))
        .unwrap();

        assert!(payload.claim.is_none());
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
            computed: false,
        };
        let json = serde_json::to_value(event).unwrap();
        assert_eq!(json["computed"], false);
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
            SplashProgressEvent::Ready { percent: 100 },
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

    #[test]
    fn archive_export_scope_tags_context_and_conversation_variants() {
        let context_scope = ArchiveExportScope::Context {
            context_id: "ctx-1".into(),
        };
        let json = serde_json::to_value(&context_scope).unwrap();
        assert_eq!(json["kind"], "context");
        assert_eq!(json["context_id"], "ctx-1");

        let conversation_scope = ArchiveExportScope::Conversation {
            conversation_id: "conv-1".into(),
            include_context: true,
        };
        let json = serde_json::to_value(&conversation_scope).unwrap();
        assert_eq!(json["kind"], "conversation");
        assert_eq!(json["include_context"], true);
    }

    #[test]
    fn archive_compatibility_warning_round_trips_every_variant() {
        let warnings = [
            ArchiveCompatibilityWarning::DuplicateArchiveDigest,
            ArchiveCompatibilityWarning::DuplicateDocument {
                portable_id: "doc-1".into(),
            },
            ArchiveCompatibilityWarning::PossibleDuplicateContext,
            ArchiveCompatibilityWarning::PossibleDuplicateConversation,
            ArchiveCompatibilityWarning::UnsupportedDocument {
                portable_id: "doc-2".into(),
                reason: "unsupported type".into(),
            },
            ArchiveCompatibilityWarning::MigratedFromOlderVersion {
                from_format_version: 1,
            },
        ];
        for warning in warnings {
            let json = serde_json::to_string(&warning).unwrap();
            let decoded: ArchiveCompatibilityWarning = serde_json::from_str(&json).unwrap();
            assert_eq!(decoded, warning);
        }
    }

    #[test]
    fn archive_progress_event_tags_on_phase_and_scopes_by_operation_id() {
        let event = ArchiveProgressEvent::Hashing {
            operation_id: "op-1".into(),
            processed_bytes: 10,
            total_bytes: 100,
        };
        let json = serde_json::to_value(&event).unwrap();
        assert_eq!(json["phase"], "hashing");
        assert_eq!(json["operation_id"], "op-1");

        let failed = ArchiveProgressEvent::Failed {
            operation_id: "op-1".into(),
            message: "disk full".into(),
        };
        let json = serde_json::to_value(&failed).unwrap();
        assert_eq!(json["phase"], "failed");
        assert_eq!(json["message"], "disk full");
    }

    #[test]
    fn archive_import_options_default_optional_titles_and_reuse_list() {
        let json = serde_json::json!({ "include_document_ids": ["doc-1"] });
        let options: ArchiveImportOptions = serde_json::from_value(json).unwrap();
        assert_eq!(options.context_title, None);
        assert_eq!(options.conversation_title, None);
        assert!(options.reuse_exact_document_ids.is_empty());
        assert_eq!(options.include_document_ids, ["doc-1"]);
    }
}

/// Settings → Privacy: whether usage events are being collected, and why.
/// Mirrored in `src/lib/ipc.ts` as `TelemetryStatus`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TelemetryStatus {
    /// The user's setting (`AppConfig::telemetry_enabled`).
    pub enabled: bool,
    /// The server says this account's beta terms require usage data, so the
    /// setting cannot switch collection off.
    pub required: bool,
    /// What is actually happening: `enabled || required`.
    pub collecting: bool,
    /// The local, inspectable event log, when the app-data dir is known.
    pub log_path: Option<String>,
}

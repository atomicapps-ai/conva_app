//! Versioned capture / source / session / event contract (browser product
//! architecture **M0** — `conva_core/docs/technical/2026-09-conva-web-product-and-capture-architecture.md`
//! §6, §8, §12).
//!
//! Everything here is **additive** to the legacy `StreamSide` /
//! `TranscriptSegment` wire shapes: nothing in this module changes an existing
//! event or persisted record. The legacy values migrate by mapping
//! (`outbound → self`, `inbound → remote_mix`) and the original value is kept
//! alongside the mapped one during the transition, so existing conversations
//! stay readable.
//!
//! Hand-mirrored in `src/lib/capture/contract.ts`. Change one, change the other
//! in the same commit (same rule as `ipc.rs` ↔ `ipc.ts`).

use std::collections::BTreeSet;
use std::fmt;

use serde::{Deserialize, Serialize};

use crate::asr::TranscriptSegment;
use crate::audio::StreamSide;

/// Schema version carried by every [`ConvaEvent`] envelope.
pub const CONTRACT_SCHEMA_VERSION: u32 = 1;

// ── Availability ─────────────────────────────────────────────────────────────

/// Live availability of a capability, source or operation. Potential support,
/// implementation status, policy, permission and current readiness are
/// *different* answers — this enum keeps them apart so the UI never renders a
/// successful-looking control for an operation that would discard work.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", tag = "state")]
pub enum Availability {
    /// Ready to use now.
    Available,
    /// Supported and implemented, but the user must do something first
    /// (grant a permission, pick a source, sign in…).
    NeedsUserAction { reason: String },
    /// Works, with a known limitation right now (e.g. mic-only on a platform
    /// whose other-party capture is missing).
    Degraded { reason: String },
    /// Implemented and supported, but not usable right now (device missing,
    /// service down, disconnected bridge…).
    Unavailable { reason: String },
    /// This platform/runtime can never do it (a browser tab can't spawn an OS
    /// window; Firefox has no display audio…).
    Unsupported { reason: String },
    /// The platform could do it but Conva hasn't built it yet. A TODO stub is
    /// `Unimplemented`, never `Available`.
    Unimplemented { reason: String },
}

impl Availability {
    pub fn needs_user_action(reason: impl Into<String>) -> Self {
        Self::NeedsUserAction {
            reason: reason.into(),
        }
    }
    pub fn degraded(reason: impl Into<String>) -> Self {
        Self::Degraded {
            reason: reason.into(),
        }
    }
    pub fn unavailable(reason: impl Into<String>) -> Self {
        Self::Unavailable {
            reason: reason.into(),
        }
    }
    pub fn unsupported(reason: impl Into<String>) -> Self {
        Self::Unsupported {
            reason: reason.into(),
        }
    }
    pub fn unimplemented(reason: impl Into<String>) -> Self {
        Self::Unimplemented {
            reason: reason.into(),
        }
    }

    /// True when invoking the operation can do real work right now
    /// (`Available` or `Degraded`).
    pub fn is_usable(&self) -> bool {
        matches!(self, Self::Available | Self::Degraded { .. })
    }

    /// The human-readable reason, when the state carries one.
    pub fn reason(&self) -> Option<&str> {
        match self {
            Self::Available => None,
            Self::NeedsUserAction { reason }
            | Self::Degraded { reason }
            | Self::Unavailable { reason }
            | Self::Unsupported { reason }
            | Self::Unimplemented { reason } => Some(reason),
        }
    }
}

// ── Source vocabulary ────────────────────────────────────────────────────────

/// What physically produces a capture stream.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CaptureSourceKind {
    Mic,
    Display,
    Tab,
    Wasapi,
    Meeting,
}

/// The canonical logical channel a stream belongs to (§6 identity vocabulary).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CaptureChannel {
    /// The user's own microphone or a platform-provided self track.
    #[serde(rename = "self")]
    SelfChannel,
    /// Audio played by one or more other participants; a tab/display/WASAPI
    /// stream does not identify *which* person spoke.
    RemoteMix,
    /// Reserved for a meeting integration that demonstrably supplies a
    /// distinct participant track.
    RemoteTrack,
}

/// Who owns the capture lifecycle.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CaptureOwner {
    /// The product page itself (`getUserMedia` / `getDisplayMedia`).
    Page,
    /// A browser extension (offscreen document / `tabCapture`).
    Extension,
    /// The Windows Capture Bridge native host.
    Bridge,
    /// A meeting-platform integration.
    Integration,
    /// The desktop shell's own native engine (today's Tauri app).
    Native,
}

/// How long a source keeps capturing once the visible controller goes away.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ContinuityModel {
    PageLifetime,
    ExtensionLifetime,
    NativeLease,
    Hosted,
}

/// Where the captured audio is processed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProcessingMode {
    Local,
    Hosted,
    Hybrid,
}

/// One capture source as advertised in a capability snapshot (§8).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CaptureSourceCapability {
    pub kind: CaptureSourceKind,
    pub channels: Vec<CaptureChannel>,
    pub owner: CaptureOwner,
    pub continuity: ContinuityModel,
    pub processing: Vec<ProcessingMode>,
    pub availability: Availability,
}

// ── Speaker reference ────────────────────────────────────────────────────────

/// Who a transcript segment is attributed to. Kept separate from the channel
/// (a `remote_mix` may carry several voices) and from any display label (a
/// user-correctable presentation value, never proof of identity).
///
/// Wire form is a single string: `self`, `remote:unknown`,
/// `cluster:<session-local-id>`, `participant:<integration-id>`,
/// `enrolled:<user-authorized-id>`.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(into = "String", try_from = "String")]
pub enum SpeakerRef {
    /// The user.
    SelfSpeaker,
    /// Somebody else, undifferentiated.
    RemoteUnknown,
    /// An anonymous session-local diarization cluster.
    Cluster(String),
    /// A participant identified by an authorized meeting integration.
    Participant(String),
    /// An identity the user explicitly enrolled (Voice Signature).
    Enrolled(String),
}

impl SpeakerRef {
    pub const SELF: &'static str = "self";
    pub const REMOTE_UNKNOWN: &'static str = "remote:unknown";

    pub fn parse(s: &str) -> Result<Self, ContractError> {
        if s == Self::SELF {
            return Ok(Self::SelfSpeaker);
        }
        if s == Self::REMOTE_UNKNOWN {
            return Ok(Self::RemoteUnknown);
        }
        let (prefix, id) = s
            .split_once(':')
            .ok_or_else(|| ContractError::InvalidSpeakerRef(s.to_string()))?;
        if id.is_empty() {
            return Err(ContractError::InvalidSpeakerRef(s.to_string()));
        }
        match prefix {
            "cluster" => Ok(Self::Cluster(id.to_string())),
            "participant" => Ok(Self::Participant(id.to_string())),
            "enrolled" => Ok(Self::Enrolled(id.to_string())),
            _ => Err(ContractError::InvalidSpeakerRef(s.to_string())),
        }
    }
}

impl fmt::Display for SpeakerRef {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::SelfSpeaker => f.write_str(Self::SELF),
            Self::RemoteUnknown => f.write_str(Self::REMOTE_UNKNOWN),
            Self::Cluster(id) => write!(f, "cluster:{id}"),
            Self::Participant(id) => write!(f, "participant:{id}"),
            Self::Enrolled(id) => write!(f, "enrolled:{id}"),
        }
    }
}

impl From<SpeakerRef> for String {
    fn from(value: SpeakerRef) -> Self {
        value.to_string()
    }
}

impl TryFrom<String> for SpeakerRef {
    type Error = ContractError;
    fn try_from(value: String) -> Result<Self, Self::Error> {
        Self::parse(&value)
    }
}

// ── Event envelope ───────────────────────────────────────────────────────────

/// The versioned envelope every adapter emits (§6). Reducers discard stale
/// epochs and de-duplicate by `(session_id, source_id, epoch, seq, event_id)`
/// — see [`SourceCursor`].
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ConvaEvent<T> {
    pub schema_version: u32,
    pub event_id: String,
    pub session_id: String,
    pub source_id: String,
    pub source_kind: CaptureSourceKind,
    pub channel: CaptureChannel,
    /// Increments when this source reconnects.
    pub epoch: u32,
    /// Monotonic within `source_id + epoch`.
    pub seq: u64,
    /// Source monotonic clock, normalized at ingress (ms).
    pub captured_at_ms: u64,
    pub emitted_at_unix_ms: u64,
    pub payload: T,
}

/// Where a mapped segment came from — kept so a legacy record round-trips
/// byte-for-byte and so the old `<side>-<seq>` bubble keys stay valid.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LegacySegmentRef {
    pub side: StreamSide,
    pub seq: u64,
}

/// Transcript payload of a [`ConvaEvent`]: the legacy segment fields plus
/// revision / speaker metadata. Partials may replace earlier partials of the
/// same `segment_id`; a final never silently rewrites another final —
/// corrections are new immutable revisions that `replaces_event_id` the
/// superseded one.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TranscriptPayload {
    /// Utterance identity shared by every partial/final/correction of one
    /// segment. Legacy mapping uses `<side>-<seq>`.
    pub segment_id: String,
    pub text: String,
    pub is_final: bool,
    pub start_ms: u64,
    pub end_ms: u64,
    pub confidence: Option<f32>,
    pub latency_ms: u32,
    /// 0 for the first emission of a `segment_id`; +1 per replacement.
    pub revision: u32,
    /// The `event_id` this revision supersedes, when it replaces one.
    pub replaces_event_id: Option<String>,
    pub speaker_ref: SpeakerRef,
    /// User-correctable presentation label; never proof of identity.
    pub display_label: Option<String>,
    /// BCP-47 language tag, when the engine reports one.
    pub language: Option<String>,
    /// ASR provider provenance (`whisper_local`, `deepgram_cloud`, …).
    pub provider: Option<String>,
    /// Original legacy side + seq, kept during the transition.
    pub legacy: Option<LegacySegmentRef>,
}

// ── Legacy mapping ───────────────────────────────────────────────────────────

/// `outbound → self`, `inbound → remote_mix`.
pub fn channel_for_side(side: StreamSide) -> CaptureChannel {
    match side {
        StreamSide::Outbound => CaptureChannel::SelfChannel,
        StreamSide::Inbound => CaptureChannel::RemoteMix,
    }
}

/// Inverse of [`channel_for_side`]; `remote_track` folds into `inbound` because
/// the legacy model has exactly two sides.
pub fn side_for_channel(channel: CaptureChannel) -> StreamSide {
    match channel {
        CaptureChannel::SelfChannel => StreamSide::Outbound,
        CaptureChannel::RemoteMix | CaptureChannel::RemoteTrack => StreamSide::Inbound,
    }
}

/// The default speaker attribution the legacy two-side model implies.
pub fn speaker_ref_for_side(side: StreamSide) -> SpeakerRef {
    match side {
        StreamSide::Outbound => SpeakerRef::SelfSpeaker,
        StreamSide::Inbound => SpeakerRef::RemoteUnknown,
    }
}

/// The legacy bubble key (`inbound-7`) — identical to the UI's `segmentKey`
/// and to `RadarEvent::source_key`.
pub fn legacy_segment_id(side: StreamSide, seq: u64) -> String {
    let side = match side {
        StreamSide::Inbound => "inbound",
        StreamSide::Outbound => "outbound",
    };
    format!("{side}-{seq}")
}

impl TranscriptPayload {
    /// Lift a legacy segment into the versioned payload. `revision` is left
    /// at 0 — the caller's reducer assigns replacement revisions.
    pub fn from_legacy(seg: &TranscriptSegment) -> Self {
        Self {
            segment_id: legacy_segment_id(seg.side, seg.seq),
            text: seg.text.clone(),
            is_final: seg.is_final,
            start_ms: seg.start_ms,
            end_ms: seg.end_ms,
            confidence: seg.confidence,
            latency_ms: seg.latency_ms,
            revision: 0,
            replaces_event_id: None,
            speaker_ref: speaker_ref_for_side(seg.side),
            display_label: None,
            language: None,
            provider: None,
            legacy: Some(LegacySegmentRef {
                side: seg.side,
                seq: seg.seq,
            }),
        }
    }

    /// Project back onto the legacy segment shape. Uses the preserved legacy
    /// ref when present, otherwise derives side from `channel` and seq from
    /// `fallback_seq`.
    pub fn to_legacy(&self, channel: CaptureChannel, fallback_seq: u64) -> TranscriptSegment {
        let (side, seq) = match &self.legacy {
            Some(l) => (l.side, l.seq),
            None => (side_for_channel(channel), fallback_seq),
        };
        TranscriptSegment {
            side,
            seq,
            text: self.text.clone(),
            is_final: self.is_final,
            start_ms: self.start_ms,
            end_ms: self.end_ms,
            confidence: self.confidence,
            latency_ms: self.latency_ms,
        }
    }
}

// ── Ordering / de-duplication ────────────────────────────────────────────────

/// Why an envelope was not accepted, or how it was.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Acceptance {
    /// Next in sequence (or first for a new epoch).
    Accepted,
    /// Earlier than the newest seen seq but unseen and inside the window;
    /// callers insert by `seq`.
    Reordered,
    /// Same `(epoch, seq)` or same `event_id` already accepted.
    Duplicate,
    /// Belongs to an epoch older than the newest one seen for this source.
    StaleEpoch,
    /// Older than `newest_seq - window`; too late to insert.
    OutsideWindow,
    /// Malformed: wrong schema version or empty identifiers.
    Invalid,
}

/// Per-`(session_id, source_id)` acceptance state: the newest epoch, the seen
/// `(epoch, seq)` pairs inside a bounded window, and the accepted event ids.
#[derive(Debug, Clone)]
pub struct SourceCursor {
    session_id: String,
    source_id: String,
    epoch: Option<u32>,
    newest_seq: Option<u64>,
    seen_seq: BTreeSet<u64>,
    seen_ids: BTreeSet<String>,
    window: u64,
}

impl SourceCursor {
    /// `window` = how far behind the newest seq a late event may still be
    /// inserted.
    pub fn new(session_id: impl Into<String>, source_id: impl Into<String>, window: u64) -> Self {
        Self {
            session_id: session_id.into(),
            source_id: source_id.into(),
            epoch: None,
            newest_seq: None,
            seen_seq: BTreeSet::new(),
            seen_ids: BTreeSet::new(),
            window,
        }
    }

    pub fn epoch(&self) -> Option<u32> {
        self.epoch
    }

    pub fn newest_seq(&self) -> Option<u64> {
        self.newest_seq
    }

    /// Decide whether `event` may be applied, recording it when it may.
    pub fn offer<T>(&mut self, event: &ConvaEvent<T>) -> Acceptance {
        if event.schema_version != CONTRACT_SCHEMA_VERSION
            || event.event_id.is_empty()
            || event.session_id != self.session_id
            || event.source_id != self.source_id
        {
            return Acceptance::Invalid;
        }
        if self.seen_ids.contains(&event.event_id) {
            return Acceptance::Duplicate;
        }
        match self.epoch {
            Some(current) if event.epoch < current => return Acceptance::StaleEpoch,
            Some(current) if event.epoch > current => {
                // A reconnect: everything from the old epoch is finalized.
                self.epoch = Some(event.epoch);
                self.newest_seq = None;
                self.seen_seq.clear();
            }
            Some(_) => {}
            None => self.epoch = Some(event.epoch),
        }
        if self.seen_seq.contains(&event.seq) {
            return Acceptance::Duplicate;
        }
        let outcome = match self.newest_seq {
            Some(newest) if event.seq < newest => {
                if newest - event.seq > self.window {
                    return Acceptance::OutsideWindow;
                }
                Acceptance::Reordered
            }
            _ => Acceptance::Accepted,
        };
        self.seen_seq.insert(event.seq);
        self.seen_ids.insert(event.event_id.clone());
        let newest = self.newest_seq.map_or(event.seq, |n| n.max(event.seq));
        self.newest_seq = Some(newest);
        // Keep the window bounded.
        let floor = newest.saturating_sub(self.window);
        self.seen_seq = self.seen_seq.split_off(&floor);
        outcome
    }
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum ContractError {
    #[error("invalid speaker_ref: {0:?}")]
    InvalidSpeakerRef(String),
}

#[cfg(test)]
mod tests {
    use super::*;

    fn seg(side: StreamSide, seq: u64, text: &str, is_final: bool) -> TranscriptSegment {
        TranscriptSegment {
            side,
            seq,
            text: text.into(),
            is_final,
            start_ms: 10,
            end_ms: 900,
            confidence: Some(0.9),
            latency_ms: 42,
        }
    }

    fn event(
        source: &str,
        epoch: u32,
        seq: u64,
        event_id: &str,
        payload: TranscriptPayload,
    ) -> ConvaEvent<TranscriptPayload> {
        ConvaEvent {
            schema_version: CONTRACT_SCHEMA_VERSION,
            event_id: event_id.into(),
            session_id: "s1".into(),
            source_id: source.into(),
            source_kind: CaptureSourceKind::Mic,
            channel: CaptureChannel::SelfChannel,
            epoch,
            seq,
            captured_at_ms: seq * 100,
            emitted_at_unix_ms: 1_700_000_000_000 + seq,
            payload,
        }
    }

    #[test]
    fn legacy_sides_map_to_canonical_channels() {
        assert_eq!(
            channel_for_side(StreamSide::Outbound),
            CaptureChannel::SelfChannel
        );
        assert_eq!(
            channel_for_side(StreamSide::Inbound),
            CaptureChannel::RemoteMix
        );
        assert_eq!(
            side_for_channel(CaptureChannel::SelfChannel),
            StreamSide::Outbound
        );
        assert_eq!(
            side_for_channel(CaptureChannel::RemoteMix),
            StreamSide::Inbound
        );
        assert_eq!(
            side_for_channel(CaptureChannel::RemoteTrack),
            StreamSide::Inbound
        );
        assert_eq!(
            speaker_ref_for_side(StreamSide::Outbound),
            SpeakerRef::SelfSpeaker
        );
        assert_eq!(
            speaker_ref_for_side(StreamSide::Inbound),
            SpeakerRef::RemoteUnknown
        );
    }

    #[test]
    fn channel_wire_names_match_the_ts_mirror() {
        assert_eq!(
            serde_json::to_value(CaptureChannel::SelfChannel).unwrap(),
            "self"
        );
        assert_eq!(
            serde_json::to_value(CaptureChannel::RemoteMix).unwrap(),
            "remote_mix"
        );
        assert_eq!(
            serde_json::to_value(CaptureChannel::RemoteTrack).unwrap(),
            "remote_track"
        );
        assert_eq!(
            serde_json::to_value(CaptureSourceKind::Wasapi).unwrap(),
            "wasapi"
        );
        assert_eq!(
            serde_json::to_value(ContinuityModel::NativeLease).unwrap(),
            "native_lease"
        );
    }

    #[test]
    fn legacy_segment_round_trips_through_the_payload() {
        let original = seg(StreamSide::Inbound, 7, "hello there", true);
        let payload = TranscriptPayload::from_legacy(&original);
        assert_eq!(payload.segment_id, "inbound-7");
        assert_eq!(payload.speaker_ref, SpeakerRef::RemoteUnknown);
        assert_eq!(payload.revision, 0);
        assert_eq!(
            payload.legacy,
            Some(LegacySegmentRef {
                side: StreamSide::Inbound,
                seq: 7
            })
        );
        let back = payload.to_legacy(CaptureChannel::RemoteMix, 999);
        assert_eq!(
            serde_json::to_value(&back).unwrap(),
            serde_json::to_value(&original).unwrap()
        );
    }

    #[test]
    fn to_legacy_derives_side_and_seq_when_no_legacy_ref() {
        let mut payload = TranscriptPayload::from_legacy(&seg(StreamSide::Outbound, 1, "x", false));
        payload.legacy = None;
        let back = payload.to_legacy(CaptureChannel::RemoteTrack, 12);
        assert_eq!(back.side, StreamSide::Inbound);
        assert_eq!(back.seq, 12);
    }

    #[test]
    fn availability_serializes_with_state_tag_and_reason() {
        let json =
            serde_json::to_value(Availability::unimplemented("hosted ASR not wired")).unwrap();
        assert_eq!(json["state"], "unimplemented");
        assert_eq!(json["reason"], "hosted ASR not wired");
        assert_eq!(
            serde_json::to_value(Availability::Available).unwrap(),
            serde_json::json!({ "state": "available" })
        );
        assert!(Availability::Available.is_usable());
        assert!(Availability::degraded("mic only").is_usable());
        assert!(!Availability::unsupported("no").is_usable());
        assert!(!Availability::unimplemented("todo").is_usable());
        assert!(!Availability::unavailable("down").is_usable());
        assert!(!Availability::needs_user_action("grant").is_usable());
    }

    #[test]
    fn speaker_ref_wire_forms() {
        for (r, s) in [
            (SpeakerRef::SelfSpeaker, "self"),
            (SpeakerRef::RemoteUnknown, "remote:unknown"),
            (SpeakerRef::Cluster("c1".into()), "cluster:c1"),
            (SpeakerRef::Participant("p-9".into()), "participant:p-9"),
            (SpeakerRef::Enrolled("me".into()), "enrolled:me"),
        ] {
            assert_eq!(r.to_string(), s);
            assert_eq!(SpeakerRef::parse(s).unwrap(), r);
            assert_eq!(serde_json::to_value(&r).unwrap(), s);
            let back: SpeakerRef =
                serde_json::from_value(serde_json::Value::String(s.into())).unwrap();
            assert_eq!(back, r);
        }
        assert!(SpeakerRef::parse("cluster:").is_err());
        assert!(SpeakerRef::parse("nope").is_err());
        assert!(SpeakerRef::parse("bot:1").is_err());
    }

    #[test]
    fn envelope_serializes_versioned_fields() {
        let e = event(
            "mic",
            0,
            1,
            "e1",
            TranscriptPayload::from_legacy(&seg(StreamSide::Outbound, 1, "hi", true)),
        );
        let json = serde_json::to_value(&e).unwrap();
        assert_eq!(json["schema_version"], CONTRACT_SCHEMA_VERSION);
        assert_eq!(json["channel"], "self");
        assert_eq!(json["source_kind"], "mic");
        assert_eq!(json["payload"]["speaker_ref"], "self");
        assert_eq!(json["payload"]["legacy"]["side"], "outbound");
        let back: ConvaEvent<TranscriptPayload> = serde_json::from_value(json).unwrap();
        assert_eq!(back, e);
    }

    fn payload(seq: u64) -> TranscriptPayload {
        TranscriptPayload::from_legacy(&seg(StreamSide::Outbound, seq, "t", false))
    }

    #[test]
    fn cursor_accepts_in_order_and_rejects_duplicates() {
        let mut c = SourceCursor::new("s1", "mic", 8);
        assert_eq!(
            c.offer(&event("mic", 0, 1, "e1", payload(1))),
            Acceptance::Accepted
        );
        assert_eq!(
            c.offer(&event("mic", 0, 2, "e2", payload(2))),
            Acceptance::Accepted
        );
        // same (epoch, seq)
        assert_eq!(
            c.offer(&event("mic", 0, 2, "e2-dup", payload(2))),
            Acceptance::Duplicate
        );
        // same event_id, different seq
        assert_eq!(
            c.offer(&event("mic", 0, 3, "e1", payload(3))),
            Acceptance::Duplicate
        );
        assert_eq!(c.newest_seq(), Some(2));
    }

    #[test]
    fn cursor_flags_reordered_events_inside_the_window_and_drops_beyond_it() {
        let mut c = SourceCursor::new("s1", "mic", 3);
        assert_eq!(
            c.offer(&event("mic", 0, 1, "e1", payload(1))),
            Acceptance::Accepted
        );
        assert_eq!(
            c.offer(&event("mic", 0, 5, "e5", payload(5))),
            Acceptance::Accepted
        );
        assert_eq!(
            c.offer(&event("mic", 0, 4, "e4", payload(4))),
            Acceptance::Reordered
        );
        // newest 5, window 3 → seq 1 is the floor; seq 0 is too late.
        assert_eq!(
            c.offer(&event("mic", 0, 0, "e0", payload(0))),
            Acceptance::OutsideWindow
        );
        assert_eq!(
            c.offer(&event("mic", 0, 4, "e4-again", payload(4))),
            Acceptance::Duplicate
        );
    }

    #[test]
    fn cursor_rejects_stale_epochs_after_a_reconnect() {
        let mut c = SourceCursor::new("s1", "mic", 8);
        assert_eq!(
            c.offer(&event("mic", 0, 1, "a1", payload(1))),
            Acceptance::Accepted
        );
        assert_eq!(
            c.offer(&event("mic", 1, 1, "b1", payload(1))),
            Acceptance::Accepted
        );
        assert_eq!(c.epoch(), Some(1));
        assert_eq!(
            c.offer(&event("mic", 0, 2, "a2", payload(2))),
            Acceptance::StaleEpoch
        );
        // A new epoch restarts the sequence, so seq 1 is not a duplicate.
        assert_eq!(
            c.offer(&event("mic", 1, 2, "b2", payload(2))),
            Acceptance::Accepted
        );
    }

    #[test]
    fn cursor_rejects_invalid_envelopes() {
        let mut c = SourceCursor::new("s1", "mic", 8);
        let mut wrong_version = event("mic", 0, 1, "e1", payload(1));
        wrong_version.schema_version = 99;
        assert_eq!(c.offer(&wrong_version), Acceptance::Invalid);
        let other_source = event("display", 0, 1, "e1", payload(1));
        assert_eq!(c.offer(&other_source), Acceptance::Invalid);
        let mut no_id = event("mic", 0, 1, "", payload(1));
        no_id.event_id.clear();
        assert_eq!(c.offer(&no_id), Acceptance::Invalid);
    }
}

//! Context-aware semantic frames emitted from finalized transcript segments.
//!
//! These types deliberately separate what a speaker said, who they attributed
//! it to, and which references still need resolution. Extraction is a later
//! pipeline concern; this module is the shell-independent domain contract.

use serde::{Deserialize, Serialize};

use crate::audio::StreamSide;

/// The conversational job performed by one bounded span of an utterance.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FrameKind {
    Question,
    Request,
    Claim,
    AttributedClaim,
    Decision,
    Commitment,
    Objection,
    Requirement,
    Definition,
    Observation,
    Opinion,
    Prediction,
    Correction,
}

/// Coarse confidence is intentionally distinct from claim confidence.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Confidence {
    Unknown,
    Low,
    Medium,
    High,
}

/// Character offsets into one finalized transcript segment.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TranscriptSpan {
    pub segment_id: String,
    pub start_char: u32,
    pub end_char: u32,
}

impl TranscriptSpan {
    pub fn is_valid(&self) -> bool {
        !self.segment_id.trim().is_empty() && self.start_char < self.end_char
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Modality {
    Asserted,
    Reported,
    Hedged,
    Possible,
    Hypothetical,
    Questioned,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Sensitivity {
    Public,
    Internal,
    PrivatePersonal,
    Restricted,
}

/// An extractor may suggest these actions, but downstream deterministic
/// policy remains authoritative about whether and how they can run.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SuggestedAction {
    Explain,
    Recall,
    Assist,
    Synthesize,
    Verify,
    Resolve,
    Link,
    TrackClaim,
    FlagConflict,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AttributionDirectness {
    DirectStatement,
    ReportedBySpeaker,
    Hearsay,
    Unknown,
}

/// One link in a chain such as speaker -> newscaster -> ABC News.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Attribution {
    pub source_label: String,
    pub reporting_verb: String,
    pub directness: AttributionDirectness,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum QualifierKind {
    Quantity,
    Date,
    Time,
    Location,
    Condition,
    Scope,
    Cause,
    Other,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FrameQualifier {
    pub kind: QualifierKind,
    pub value: String,
    #[serde(default)]
    pub unit: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReferenceKind {
    Pronoun,
    Demonstrative,
    PersonAlias,
    Artifact,
    Event,
    Place,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ReferenceCandidate {
    pub target_id: String,
    pub label: String,
    pub confidence: Confidence,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ReferenceEdge {
    pub surface_text: String,
    pub kind: ReferenceKind,
    /// Required references block verification until one target is resolved.
    pub required_for_verification: bool,
    #[serde(default)]
    pub resolved_target_id: Option<String>,
    #[serde(default)]
    pub candidates: Vec<ReferenceCandidate>,
}

impl ReferenceEdge {
    pub fn is_resolved(&self) -> bool {
        self.resolved_target_id.is_some()
    }
}

/// A semantic unit extracted from one or more transcript spans.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MeaningFrame {
    pub id: String,
    pub source_spans: Vec<TranscriptSpan>,
    pub speaker_side: StreamSide,
    #[serde(default)]
    pub speaker_label: Option<String>,
    pub kind: FrameKind,
    pub exact_quote: String,
    pub normalized_proposition: String,
    pub predicate: String,
    #[serde(default)]
    pub subject: Option<String>,
    #[serde(default)]
    pub object: Option<String>,
    #[serde(default)]
    pub attribution_chain: Vec<Attribution>,
    #[serde(default)]
    pub qualifiers: Vec<FrameQualifier>,
    #[serde(default)]
    pub references: Vec<ReferenceEdge>,
    pub modality: Modality,
    pub negated: bool,
    pub sensitivity: Sensitivity,
    pub extraction_confidence: Confidence,
    #[serde(default)]
    pub suggested_actions: Vec<SuggestedAction>,
}

impl MeaningFrame {
    pub fn has_unresolved_required_reference(&self) -> bool {
        self.references
            .iter()
            .any(|reference| reference.required_for_verification && !reference.is_resolved())
    }

    pub fn is_attributed(&self) -> bool {
        self.kind == FrameKind::AttributedClaim || !self.attribution_chain.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base_frame() -> MeaningFrame {
        MeaningFrame {
            id: "frame-b".into(),
            source_spans: vec![TranscriptSpan {
                segment_id: "segment-1".into(),
                start_char: 0,
                end_char: 72,
            }],
            speaker_side: StreamSide::Inbound,
            speaker_label: Some("guest".into()),
            kind: FrameKind::AttributedClaim,
            exact_quote: "ABC News is reporting that both people died in that car crash in Arizona"
                .into(),
            normalized_proposition: "both people died in that car crash in arizona".into(),
            predicate: "died".into(),
            subject: Some("both people".into()),
            object: None,
            attribution_chain: vec![Attribution {
                source_label: "ABC News".into(),
                reporting_verb: "is reporting".into(),
                directness: AttributionDirectness::ReportedBySpeaker,
            }],
            qualifiers: vec![FrameQualifier {
                kind: QualifierKind::Location,
                value: "Arizona".into(),
                unit: None,
            }],
            references: vec![ReferenceEdge {
                surface_text: "that car crash".into(),
                kind: ReferenceKind::Event,
                required_for_verification: true,
                resolved_target_id: None,
                candidates: vec![],
            }],
            modality: Modality::Reported,
            negated: false,
            sensitivity: Sensitivity::Public,
            extraction_confidence: Confidence::High,
            suggested_actions: vec![SuggestedAction::Resolve, SuggestedAction::Verify],
        }
    }

    #[test]
    fn transcript_spans_require_a_non_empty_forward_range() {
        assert!(base_frame().source_spans[0].is_valid());
        assert!(!TranscriptSpan {
            segment_id: " ".into(),
            start_char: 2,
            end_char: 2,
        }
        .is_valid());
    }

    #[test]
    fn attributed_claim_keeps_the_reporting_source_separate() {
        let frame = base_frame();
        assert!(frame.is_attributed());
        assert_eq!(frame.attribution_chain[0].source_label, "ABC News");
        assert!(!frame.normalized_proposition.contains("ABC News"));
    }

    #[test]
    fn unresolved_required_event_blocks_verification() {
        let mut frame = base_frame();
        assert!(frame.has_unresolved_required_reference());
        frame.references[0].resolved_target_id = Some("event-arizona-crash".into());
        assert!(!frame.has_unresolved_required_reference());
    }
}

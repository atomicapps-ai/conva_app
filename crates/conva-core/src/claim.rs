//! Deterministic claim identity, lifecycle, and consequence/importance rules.

use std::collections::BTreeSet;

use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::audio::StreamSide;
use crate::evidence::{ClaimConfidence, EvidenceRecord};
use crate::meaning_frame::{
    Attribution, Confidence, FrameKind, FrameQualifier, Modality, ReferenceEdge, Sensitivity,
    SuggestedAction,
};

/// A stable, explainable dedupe key. Attribution is part of identity because
/// "ABC News reported X" and an unattributed assertion of X are not the same
/// conversational claim.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct ClaimKey {
    pub normalized_proposition: String,
    #[serde(default)]
    pub attributed_source: Option<String>,
}

impl ClaimKey {
    pub fn new(proposition: &str, attributed_source: Option<&str>) -> Self {
        Self {
            normalized_proposition: normalize_proposition(proposition),
            attributed_source: attributed_source.map(normalize_identity),
        }
    }
}

/// Remove repeated claim identities while preserving first-seen order.
pub fn dedupe_claim_keys(claims: impl IntoIterator<Item = ClaimKey>) -> Vec<ClaimKey> {
    let mut seen = BTreeSet::new();
    claims
        .into_iter()
        .filter(|claim| seen.insert(claim.clone()))
        .collect()
}

/// Conservative normalization for identity comparisons. It changes casing,
/// whitespace, and trailing sentence punctuation but never removes negation or
/// rewrites meaning.
pub fn normalize_proposition(value: &str) -> String {
    let collapsed = value.split_whitespace().collect::<Vec<_>>().join(" ");
    collapsed
        .trim_matches(|character: char| matches!(character, '.' | ',' | ';' | ':' | '!' | '?'))
        .to_lowercase()
}

fn normalize_identity(value: &str) -> String {
    value
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Consequence {
    Low,
    Medium,
    High,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ClaimTopic {
    General,
    CommercialTerm,
    FinancialPerformance,
    Identity,
    LegalStatus,
    Health,
    Safety,
    DeathOrInjury,
    CrimeOrAllegation,
}

pub fn default_consequence(topic: ClaimTopic) -> Consequence {
    match topic {
        ClaimTopic::General => Consequence::Low,
        ClaimTopic::CommercialTerm => Consequence::Medium,
        ClaimTopic::FinancialPerformance
        | ClaimTopic::Identity
        | ClaimTopic::LegalStatus
        | ClaimTopic::Health
        | ClaimTopic::Safety
        | ClaimTopic::DeathOrInjury
        | ClaimTopic::CrimeOrAllegation => Consequence::High,
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ClaimState {
    Detected,
    Attributed,
    NeedsClarification,
    Queued,
    Checking,
    Supported,
    PartlySupported,
    ConflictingEvidence,
    NotVerified,
    NotExternallyVerifiable,
    Superseded,
    Dismissed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ClaimEvent {
    AttributionFound,
    RequiredReferenceUnresolved,
    CheckQueued,
    CheckStarted,
    EvidenceSupported,
    EvidencePartlySupported,
    EvidenceConflicts,
    EvidenceInsufficient,
    CannotVerifyExternally,
    Corrected,
    Dismissed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Error)]
#[error("claim event {event:?} is invalid while claim is {from:?}")]
pub struct InvalidClaimTransition {
    pub from: ClaimState,
    pub event: ClaimEvent,
}

/// Apply the canonical claim state machine. Unsupported paths fail closed
/// rather than letting a model or UI silently invent a state change.
pub fn transition_claim(
    from: ClaimState,
    event: ClaimEvent,
) -> Result<ClaimState, InvalidClaimTransition> {
    use ClaimEvent as Event;
    use ClaimState as State;

    let to = match (from, event) {
        (State::Detected, Event::AttributionFound) => State::Attributed,
        (State::Detected | State::Attributed, Event::RequiredReferenceUnresolved) => {
            State::NeedsClarification
        }
        (State::Detected | State::Attributed, Event::CheckQueued) => State::Queued,
        (State::Queued, Event::CheckStarted) => State::Checking,
        (State::Checking, Event::EvidenceSupported) => State::Supported,
        (State::Checking, Event::EvidencePartlySupported) => State::PartlySupported,
        (State::Checking, Event::EvidenceConflicts) => State::ConflictingEvidence,
        (State::Checking, Event::EvidenceInsufficient) => State::NotVerified,
        (
            State::Detected | State::Attributed | State::NeedsClarification,
            Event::CannotVerifyExternally,
        ) => State::NotExternallyVerifiable,
        (state, Event::Corrected) if is_active(state) => State::Superseded,
        (state, Event::Dismissed) if is_active(state) => State::Dismissed,
        _ => return Err(InvalidClaimTransition { from, event }),
    };
    Ok(to)
}

fn is_active(state: ClaimState) -> bool {
    !matches!(state, ClaimState::Superseded | ClaimState::Dismissed)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ImportanceReason {
    PurposeRelevant,
    ConsequenceIfWrong,
    Novel,
    SpecificAndCheckable,
    NamedDetail,
    ConflictsWithKnownMaterial,
    UnresolvedReference,
    ChangesDecision,
    TimeSensitive,
    RepeatedWithoutChange,
    AlreadySupportedByFreshEvidence,
    PrivatePersonalAssertion,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct ImportanceSignals {
    pub purpose_relevant: bool,
    pub novel: bool,
    pub specific_and_checkable: bool,
    pub has_named_detail: bool,
    pub conflicts_with_known_material: bool,
    pub has_unresolved_reference: bool,
    pub changes_decision: bool,
    pub time_sensitive: bool,
    pub repeated_without_change: bool,
    pub already_supported_by_fresh_evidence: bool,
    pub private_personal_assertion: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ImportanceRanking {
    /// Relative priority only. It is not a truth or confidence score.
    pub score: i16,
    pub reasons: Vec<ImportanceReason>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ClaimCorrectionKind {
    Transcript,
    Attribution,
    Reference,
    Proposition,
    Consequence,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ClaimCorrection {
    pub kind: ClaimCorrectionKind,
    pub previous_value: String,
    pub corrected_value: String,
    pub corrected_by: String,
    pub created_at_unix_ms: u64,
}

/// Durable claim shape carried by the later versioned snapshot event. It keeps
/// extraction, resolution, source quality, and claim confidence separate.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ClaimRecord {
    pub id: String,
    pub source_segment_ids: Vec<String>,
    pub speaker_side: StreamSide,
    #[serde(default)]
    pub speaker_label: Option<String>,
    pub exact_quote: String,
    pub normalized_proposition: String,
    pub predicate: String,
    #[serde(default)]
    pub subject: Option<String>,
    #[serde(default)]
    pub object: Option<String>,
    pub frame_kind: FrameKind,
    #[serde(default)]
    pub attribution_chain: Vec<Attribution>,
    #[serde(default)]
    pub qualifiers: Vec<FrameQualifier>,
    #[serde(default)]
    pub references: Vec<ReferenceEdge>,
    pub modality: Modality,
    pub negated: bool,
    pub sensitivity: Sensitivity,
    pub consequence: Consequence,
    #[serde(default)]
    pub importance_reasons: Vec<ImportanceReason>,
    pub state: ClaimState,
    #[serde(default)]
    pub recommended_action: Option<SuggestedAction>,
    pub policy_id: String,
    pub extraction_confidence: Confidence,
    pub resolution_confidence: Confidence,
    #[serde(default)]
    pub claim_confidence: Option<ClaimConfidence>,
    #[serde(default)]
    pub evidence: Vec<EvidenceRecord>,
    #[serde(default)]
    pub corrections: Vec<ClaimCorrection>,
    pub created_at_unix_ms: u64,
    pub updated_at_unix_ms: u64,
}

/// Rank surfacing value with an audit-friendly list of contributing reasons.
pub fn rank_importance(consequence: Consequence, signals: ImportanceSignals) -> ImportanceRanking {
    let mut score = match consequence {
        Consequence::Low => 0,
        Consequence::Medium => 15,
        Consequence::High => 30,
    };
    let mut reasons = if consequence == Consequence::Low {
        Vec::new()
    } else {
        vec![ImportanceReason::ConsequenceIfWrong]
    };

    let positive = [
        (
            signals.purpose_relevant,
            18,
            ImportanceReason::PurposeRelevant,
        ),
        (signals.novel, 8, ImportanceReason::Novel),
        (
            signals.specific_and_checkable,
            10,
            ImportanceReason::SpecificAndCheckable,
        ),
        (signals.has_named_detail, 6, ImportanceReason::NamedDetail),
        (
            signals.conflicts_with_known_material,
            18,
            ImportanceReason::ConflictsWithKnownMaterial,
        ),
        (
            signals.has_unresolved_reference,
            8,
            ImportanceReason::UnresolvedReference,
        ),
        (
            signals.changes_decision,
            20,
            ImportanceReason::ChangesDecision,
        ),
        (signals.time_sensitive, 12, ImportanceReason::TimeSensitive),
    ];
    for (present, weight, reason) in positive {
        if present {
            score += weight;
            reasons.push(reason);
        }
    }

    let negative = [
        (
            signals.repeated_without_change,
            20,
            ImportanceReason::RepeatedWithoutChange,
        ),
        (
            signals.already_supported_by_fresh_evidence,
            16,
            ImportanceReason::AlreadySupportedByFreshEvidence,
        ),
        (
            signals.private_personal_assertion,
            12,
            ImportanceReason::PrivatePersonalAssertion,
        ),
    ];
    for (present, weight, reason) in negative {
        if present {
            score -= weight;
            reasons.push(reason);
        }
    }

    ImportanceRanking { score, reasons }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalization_preserves_negation_and_collapses_cosmetic_differences() {
        assert_eq!(
            normalize_proposition("  Both people   did NOT die. "),
            "both people did not die"
        );
    }

    #[test]
    fn dedupe_key_includes_attribution() {
        let attributed = ClaimKey::new("Both people died.", Some("ABC News"));
        let repeated = ClaimKey::new(" both people DIED ", Some("abc  news"));
        let unattributed = ClaimKey::new("Both people died", None);
        assert_eq!(attributed, repeated);
        assert_ne!(attributed, unattributed);
    }

    #[test]
    fn dedupe_preserves_first_seen_order_without_merging_attributions() {
        let first = ClaimKey::new("The boat had seven people", Some("Matt"));
        let duplicate = ClaimKey::new(" the boat had seven people. ", Some("matt"));
        let unattributed = ClaimKey::new("The boat had seven people", None);
        assert_eq!(
            dedupe_claim_keys([first.clone(), duplicate, unattributed.clone()]),
            vec![first, unattributed]
        );
    }

    #[test]
    fn death_and_allegation_claims_default_to_high_consequence() {
        assert_eq!(
            default_consequence(ClaimTopic::DeathOrInjury),
            Consequence::High
        );
        assert_eq!(
            default_consequence(ClaimTopic::CrimeOrAllegation),
            Consequence::High
        );
        assert_eq!(default_consequence(ClaimTopic::General), Consequence::Low);
    }

    #[test]
    fn canonical_check_path_reaches_supported() {
        let attributed =
            transition_claim(ClaimState::Detected, ClaimEvent::AttributionFound).unwrap();
        let queued = transition_claim(attributed, ClaimEvent::CheckQueued).unwrap();
        let checking = transition_claim(queued, ClaimEvent::CheckStarted).unwrap();
        assert_eq!(
            transition_claim(checking, ClaimEvent::EvidenceSupported).unwrap(),
            ClaimState::Supported
        );
    }

    #[test]
    fn unresolved_reference_cannot_skip_directly_to_checking() {
        let state = transition_claim(
            ClaimState::Attributed,
            ClaimEvent::RequiredReferenceUnresolved,
        )
        .unwrap();
        assert_eq!(state, ClaimState::NeedsClarification);
        assert!(transition_claim(state, ClaimEvent::CheckStarted).is_err());
    }

    #[test]
    fn evidence_outcomes_only_apply_while_checking() {
        assert!(transition_claim(ClaimState::Detected, ClaimEvent::EvidenceSupported).is_err());
        assert_eq!(
            transition_claim(ClaimState::Checking, ClaimEvent::EvidenceInsufficient).unwrap(),
            ClaimState::NotVerified
        );
    }

    #[test]
    fn correction_supersedes_even_a_checked_claim_but_not_terminal_history() {
        assert_eq!(
            transition_claim(ClaimState::Supported, ClaimEvent::Corrected).unwrap(),
            ClaimState::Superseded
        );
        assert!(transition_claim(ClaimState::Superseded, ClaimEvent::Corrected).is_err());
    }

    #[test]
    fn ranking_explains_positive_and_negative_factors() {
        let ranking = rank_importance(
            Consequence::High,
            ImportanceSignals {
                purpose_relevant: true,
                specific_and_checkable: true,
                repeated_without_change: true,
                ..ImportanceSignals::default()
            },
        );
        assert_eq!(ranking.score, 38);
        assert_eq!(
            ranking.reasons,
            vec![
                ImportanceReason::ConsequenceIfWrong,
                ImportanceReason::PurposeRelevant,
                ImportanceReason::SpecificAndCheckable,
                ImportanceReason::RepeatedWithoutChange,
            ]
        );
    }
}

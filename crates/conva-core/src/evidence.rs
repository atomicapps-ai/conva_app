//! Claim-specific evidence records and deterministic aggregation.

use std::collections::BTreeSet;

use serde::{Deserialize, Serialize};

use crate::claim::{ClaimState, Consequence};
use crate::source_policy::{
    AdmissionDecision, HighConsequenceRequirement, SourceClass, SourcePolicy,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EvidenceScope {
    /// Evidence that a publisher or person made a report.
    Attribution,
    /// Evidence about the proposition inside that report.
    UnderlyingProposition,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EvidenceStance {
    Supports,
    PartlySupports,
    Contradicts,
    Inconclusive,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum QualityAssessment {
    Unknown,
    Weak,
    Adequate,
    Strong,
}

/// Source quality axes. These describe one evidence item and must never be
/// presented as the confidence of the overall claim.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct EvidenceQuality {
    pub authority: QualityAssessment,
    pub directness: QualityAssessment,
    pub specificity: QualityAssessment,
    pub freshness: QualityAssessment,
    pub independence: QualityAssessment,
    pub completeness: QualityAssessment,
    pub provenance: QualityAssessment,
}

impl EvidenceQuality {
    fn is_usable(self, policy_requires_freshness: bool) -> bool {
        let core_is_adequate = self.authority >= QualityAssessment::Adequate
            && self.directness >= QualityAssessment::Adequate
            && self.specificity >= QualityAssessment::Adequate
            && self.completeness >= QualityAssessment::Adequate
            && self.provenance >= QualityAssessment::Adequate;
        let freshness_is_adequate =
            !policy_requires_freshness || self.freshness >= QualityAssessment::Adequate;
        core_is_adequate && freshness_is_adequate
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EvidenceRecord {
    pub source_id: String,
    pub source_class: SourceClass,
    pub publisher: String,
    pub title: String,
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub local_document_id: Option<String>,
    pub excerpt: String,
    pub addressed_claim_part: String,
    pub scope: EvidenceScope,
    pub stance: EvidenceStance,
    pub quality: EvidenceQuality,
    /// Sources with the same ownership/syndication chain share a group. Missing
    /// groups do not count toward corroboration.
    #[serde(default)]
    pub independence_group: Option<String>,
    pub admission: AdmissionDecision,
    pub admission_policy_id: String,
    pub admission_policy_version: u32,
    #[serde(default)]
    pub published_at_unix_ms: Option<u64>,
    pub retrieved_at_unix_ms: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ClaimConfidence {
    None,
    Limited,
    Moderate,
    Strong,
    Conflicted,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EvidenceConclusionReason {
    NoAdmittedEvidence,
    AttributionEvidenceOnly,
    EvidenceQualityInsufficient,
    CorroborationInsufficient,
    PrimaryOfficialSupport,
    IndependentCorroboration,
    AdmittedContradiction,
    PartialSupportOnly,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EvidenceConclusion {
    pub state: ClaimState,
    pub claim_confidence: ClaimConfidence,
    pub admitted_evidence_count: usize,
    pub qualifying_support_count: usize,
    pub independent_support_count: usize,
    pub reasons: Vec<EvidenceConclusionReason>,
}

/// Evaluate only already-admitted evidence. Rejected records remain available
/// for audit but cannot affect the result, regardless of their apparent quality.
pub fn aggregate_evidence(
    evidence: &[EvidenceRecord],
    consequence: Consequence,
    policy: &SourcePolicy,
) -> EvidenceConclusion {
    let admitted: Vec<_> = evidence
        .iter()
        .filter(|record| record.admission.is_admitted())
        .collect();
    if admitted.is_empty() {
        return conclusion(
            ClaimState::NotVerified,
            ClaimConfidence::None,
            0,
            0,
            0,
            vec![EvidenceConclusionReason::NoAdmittedEvidence],
        );
    }

    let proposition_evidence: Vec<_> = admitted
        .iter()
        .copied()
        .filter(|record| record.scope == EvidenceScope::UnderlyingProposition)
        .collect();
    if proposition_evidence.is_empty() {
        return conclusion(
            ClaimState::NotVerified,
            ClaimConfidence::None,
            admitted.len(),
            0,
            0,
            vec![EvidenceConclusionReason::AttributionEvidenceOnly],
        );
    }

    let requires_freshness = policy.freshness_window_hours.is_some();
    let usable: Vec<_> = proposition_evidence
        .iter()
        .copied()
        .filter(|record| record.quality.is_usable(requires_freshness))
        .collect();

    if usable
        .iter()
        .any(|record| record.stance == EvidenceStance::Contradicts)
    {
        return conclusion(
            ClaimState::ConflictingEvidence,
            ClaimConfidence::Conflicted,
            admitted.len(),
            0,
            0,
            vec![EvidenceConclusionReason::AdmittedContradiction],
        );
    }

    let supports: Vec<_> = usable
        .iter()
        .copied()
        .filter(|record| record.stance == EvidenceStance::Supports)
        .collect();
    let support_groups: BTreeSet<_> = supports
        .iter()
        .filter_map(|record| record.independence_group.as_deref())
        .map(normalize_group)
        .filter(|group| !group.is_empty())
        .collect();
    let primary_support = supports
        .iter()
        .any(|record| record.source_class == SourceClass::PrimaryOfficial);

    if consequence == Consequence::High {
        if primary_support {
            return conclusion(
                ClaimState::Supported,
                ClaimConfidence::Strong,
                admitted.len(),
                supports.len(),
                support_groups.len(),
                vec![EvidenceConclusionReason::PrimaryOfficialSupport],
            );
        }
        let independent_reports = supports
            .iter()
            .filter(|record| record.source_class == SourceClass::RecognizedReporting)
            .filter_map(|record| record.independence_group.as_deref())
            .map(normalize_group)
            .filter(|group| !group.is_empty())
            .collect::<BTreeSet<_>>()
            .len();
        let required_reports = match policy.high_consequence_requirement {
            HighConsequenceRequirement::PrimaryOfficialOrIndependentReports => {
                usize::from(policy.minimum_independent_sources.max(2))
            }
            HighConsequenceRequirement::PrimaryOfficialOnly => usize::MAX,
        };
        if independent_reports >= required_reports {
            return conclusion(
                ClaimState::Supported,
                ClaimConfidence::Strong,
                admitted.len(),
                supports.len(),
                independent_reports,
                vec![EvidenceConclusionReason::IndependentCorroboration],
            );
        }
    } else if primary_support
        || support_groups.len() >= usize::from(policy.minimum_independent_sources.max(1))
    {
        return conclusion(
            ClaimState::Supported,
            ClaimConfidence::Strong,
            admitted.len(),
            supports.len(),
            support_groups.len(),
            vec![if primary_support {
                EvidenceConclusionReason::PrimaryOfficialSupport
            } else {
                EvidenceConclusionReason::IndependentCorroboration
            }],
        );
    }

    let partial_support = usable
        .iter()
        .any(|record| record.stance == EvidenceStance::PartlySupports);
    if !supports.is_empty() || partial_support {
        return conclusion(
            ClaimState::PartlySupported,
            ClaimConfidence::Limited,
            admitted.len(),
            supports.len(),
            support_groups.len(),
            vec![if partial_support && supports.is_empty() {
                EvidenceConclusionReason::PartialSupportOnly
            } else {
                EvidenceConclusionReason::CorroborationInsufficient
            }],
        );
    }

    conclusion(
        ClaimState::NotVerified,
        ClaimConfidence::None,
        admitted.len(),
        0,
        0,
        vec![EvidenceConclusionReason::EvidenceQualityInsufficient],
    )
}

fn normalize_group(value: &str) -> String {
    value
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

fn conclusion(
    state: ClaimState,
    claim_confidence: ClaimConfidence,
    admitted_evidence_count: usize,
    qualifying_support_count: usize,
    independent_support_count: usize,
    reasons: Vec<EvidenceConclusionReason>,
) -> EvidenceConclusion {
    EvidenceConclusion {
        state,
        claim_confidence,
        admitted_evidence_count,
        qualifying_support_count,
        independent_support_count,
        reasons,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::context::ContextCategory;
    use crate::source_policy::AdmissionRejection;

    fn adequate_quality() -> EvidenceQuality {
        EvidenceQuality {
            authority: QualityAssessment::Adequate,
            directness: QualityAssessment::Adequate,
            specificity: QualityAssessment::Adequate,
            freshness: QualityAssessment::Adequate,
            independence: QualityAssessment::Adequate,
            completeness: QualityAssessment::Adequate,
            provenance: QualityAssessment::Adequate,
        }
    }

    fn evidence(
        id: &str,
        class: SourceClass,
        scope: EvidenceScope,
        stance: EvidenceStance,
        group: Option<&str>,
    ) -> EvidenceRecord {
        EvidenceRecord {
            source_id: id.into(),
            source_class: class,
            publisher: id.into(),
            title: format!("Report {id}"),
            url: Some(format!("https://{id}.example/report")),
            local_document_id: None,
            excerpt: "A bounded excerpt".into(),
            addressed_claim_part: "the underlying proposition".into(),
            scope,
            stance,
            quality: adequate_quality(),
            independence_group: group.map(str::to_owned),
            admission: AdmissionDecision::Admitted,
            admission_policy_id: "default-live-stream".into(),
            admission_policy_version: 1,
            published_at_unix_ms: Some(1),
            retrieved_at_unix_ms: 1,
        }
    }

    fn live_policy() -> SourcePolicy {
        SourcePolicy::for_context(ContextCategory::LiveStream)
    }

    #[test]
    fn rejected_sources_never_become_evidence() {
        let mut record = evidence(
            "rejected",
            SourceClass::PrimaryOfficial,
            EvidenceScope::UnderlyingProposition,
            EvidenceStance::Supports,
            Some("official"),
        );
        record.admission = AdmissionDecision::Rejected(AdmissionRejection::BlockedDomain);
        let result = aggregate_evidence(&[record], Consequence::High, &live_policy());
        assert_eq!(result.state, ClaimState::NotVerified);
        assert_eq!(result.admitted_evidence_count, 0);
    }

    #[test]
    fn one_news_report_does_not_support_a_high_consequence_proposition() {
        let record = evidence(
            "abc",
            SourceClass::RecognizedReporting,
            EvidenceScope::UnderlyingProposition,
            EvidenceStance::Supports,
            Some("abc-network"),
        );
        let result = aggregate_evidence(&[record], Consequence::High, &live_policy());
        assert_eq!(result.state, ClaimState::PartlySupported);
        assert_eq!(result.claim_confidence, ClaimConfidence::Limited);
    }

    #[test]
    fn two_independent_reports_support_a_high_consequence_proposition() {
        let records = [
            evidence(
                "abc",
                SourceClass::RecognizedReporting,
                EvidenceScope::UnderlyingProposition,
                EvidenceStance::Supports,
                Some("abc-network"),
            ),
            evidence(
                "local",
                SourceClass::RecognizedReporting,
                EvidenceScope::UnderlyingProposition,
                EvidenceStance::Supports,
                Some("local-independent"),
            ),
        ];
        let result = aggregate_evidence(&records, Consequence::High, &live_policy());
        assert_eq!(result.state, ClaimState::Supported);
        assert_eq!(result.independent_support_count, 2);
    }

    #[test]
    fn syndicated_reports_count_as_one_source() {
        let records = [
            evidence(
                "affiliate-one",
                SourceClass::RecognizedReporting,
                EvidenceScope::UnderlyingProposition,
                EvidenceStance::Supports,
                Some("same-wire"),
            ),
            evidence(
                "affiliate-two",
                SourceClass::RecognizedReporting,
                EvidenceScope::UnderlyingProposition,
                EvidenceStance::Supports,
                Some(" SAME-WIRE "),
            ),
        ];
        let result = aggregate_evidence(&records, Consequence::High, &live_policy());
        assert_eq!(result.state, ClaimState::PartlySupported);
        assert_eq!(result.independent_support_count, 1);
    }

    #[test]
    fn primary_official_source_can_support_high_consequence_claim() {
        let record = evidence(
            "official-record",
            SourceClass::PrimaryOfficial,
            EvidenceScope::UnderlyingProposition,
            EvidenceStance::Supports,
            Some("official-record-owner"),
        );
        let result = aggregate_evidence(&[record], Consequence::High, &live_policy());
        assert_eq!(result.state, ClaimState::Supported);
        assert_eq!(result.claim_confidence, ClaimConfidence::Strong);
    }

    #[test]
    fn stricter_policy_can_require_primary_official_evidence() {
        let mut policy = live_policy();
        policy.high_consequence_requirement = HighConsequenceRequirement::PrimaryOfficialOnly;
        let reports = [
            evidence(
                "report-one",
                SourceClass::RecognizedReporting,
                EvidenceScope::UnderlyingProposition,
                EvidenceStance::Supports,
                Some("publisher-one"),
            ),
            evidence(
                "report-two",
                SourceClass::RecognizedReporting,
                EvidenceScope::UnderlyingProposition,
                EvidenceStance::Supports,
                Some("publisher-two"),
            ),
        ];
        let result = aggregate_evidence(&reports, Consequence::High, &policy);
        assert_eq!(result.state, ClaimState::PartlySupported);
    }

    #[test]
    fn support_for_abc_reporting_does_not_verify_the_reported_deaths() {
        let attribution = evidence(
            "abc-page",
            SourceClass::RecognizedReporting,
            EvidenceScope::Attribution,
            EvidenceStance::Supports,
            Some("abc-network"),
        );
        let result = aggregate_evidence(&[attribution], Consequence::High, &live_policy());
        assert_eq!(result.state, ClaimState::NotVerified);
        assert_eq!(
            result.reasons,
            vec![EvidenceConclusionReason::AttributionEvidenceOnly]
        );
    }

    #[test]
    fn admitted_contradiction_produces_conflict_not_a_truth_score() {
        let records = [
            evidence(
                "support",
                SourceClass::RecognizedReporting,
                EvidenceScope::UnderlyingProposition,
                EvidenceStance::Supports,
                Some("publisher-a"),
            ),
            evidence(
                "conflict",
                SourceClass::PrimaryOfficial,
                EvidenceScope::UnderlyingProposition,
                EvidenceStance::Contradicts,
                Some("official"),
            ),
        ];
        let result = aggregate_evidence(&records, Consequence::High, &live_policy());
        assert_eq!(result.state, ClaimState::ConflictingEvidence);
        assert_eq!(result.claim_confidence, ClaimConfidence::Conflicted);
    }

    #[test]
    fn weak_source_quality_cannot_satisfy_support_threshold() {
        let mut record = evidence(
            "vague",
            SourceClass::PrimaryOfficial,
            EvidenceScope::UnderlyingProposition,
            EvidenceStance::Supports,
            Some("official"),
        );
        record.quality.specificity = QualityAssessment::Weak;
        let result = aggregate_evidence(&[record], Consequence::High, &live_policy());
        assert_eq!(result.state, ClaimState::NotVerified);
        assert_eq!(
            result.reasons,
            vec![EvidenceConclusionReason::EvidenceQualityInsufficient]
        );
    }
}

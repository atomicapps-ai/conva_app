//! Deterministic planning and lifecycle rules for claim verification jobs.
//!
//! This module does not perform I/O. It turns a claim plus its exact source
//! policy into a bounded work plan that shell workers can execute without
//! receiving the raw transcript quote. Every candidate is admitted again when
//! it returns, so planning can never bypass domain or source-class policy.

use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::claim::{transition_claim, ClaimEvent, ClaimRecord, ClaimState};
use crate::evidence::{aggregate_evidence, EvidenceConclusion, EvidenceRecord};
use crate::meaning_frame::Sensitivity;
use crate::source_policy::{
    admit_source, AdmissionDecision, AdmissionRejection, HighConsequenceRequirement,
    ResearchRequest, SourceCandidate, SourceClass, SourcePolicy,
};

pub const MAX_VERIFICATION_QUERY_CHARS: usize = 500;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum VerificationTrigger {
    Automatic,
    UserRequested,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct VerificationPlan {
    pub job_id: String,
    pub claim_id: String,
    pub claim_updated_at_unix_ms: u64,
    pub policy_id: String,
    pub policy_version: u32,
    pub trigger: VerificationTrigger,
    /// Normalized proposition only. The exact transcript quote is never copied
    /// into a verification plan.
    pub query: String,
    pub contains_private_content: bool,
    pub local_source_classes: Vec<SourceClass>,
    pub external_source_classes: Vec<SourceClass>,
    /// Why public research was excluded while local work remained possible.
    #[serde(default)]
    pub external_research_rejection: Option<AdmissionRejection>,
    #[serde(default)]
    pub allowed_domains: Vec<String>,
    #[serde(default)]
    pub blocked_domains: Vec<String>,
    pub allow_cached_evidence: bool,
    #[serde(default)]
    pub freshness_window_hours: Option<u32>,
    pub minimum_independent_sources: u8,
    pub high_consequence_requirement: HighConsequenceRequirement,
}

impl VerificationPlan {
    pub fn permits_class(&self, class: SourceClass) -> bool {
        self.local_source_classes.contains(&class) || self.external_source_classes.contains(&class)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Error, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", tag = "reason", content = "detail")]
pub enum VerificationBlockReason {
    #[error("verification job id is empty")]
    EmptyJobId,
    #[error("claim proposition is empty")]
    EmptyProposition,
    #[error("claim source policy does not match the active policy")]
    PolicyMismatch,
    #[error("claim has a required unresolved reference")]
    RequiredReferenceUnresolved,
    #[error("claim verification is already queued or running")]
    AlreadyInProgress,
    #[error("claim is no longer active")]
    TerminalClaim,
    #[error("automatic checks are disabled by the active Context policy")]
    AutomaticChecksDisabled,
    #[error("no permitted source class is available")]
    NoPermittedSources,
    #[error("external research was rejected: {0:?}")]
    ExternalResearchDenied(AdmissionRejection),
}

/// Build an auditable, I/O-free verification plan. A plan can contain local
/// retrieval only, external research only, or both.
pub fn plan_verification(
    job_id: impl Into<String>,
    claim: &ClaimRecord,
    policy: &SourcePolicy,
    trigger: VerificationTrigger,
) -> Result<VerificationPlan, VerificationBlockReason> {
    let job_id = job_id.into();
    if job_id.trim().is_empty() {
        return Err(VerificationBlockReason::EmptyJobId);
    }
    if claim.normalized_proposition.trim().is_empty() {
        return Err(VerificationBlockReason::EmptyProposition);
    }
    if claim.policy_id != policy.id || claim.policy_version != policy.version {
        return Err(VerificationBlockReason::PolicyMismatch);
    }
    if claim
        .references
        .iter()
        .any(|reference| reference.required_for_verification && !reference.is_resolved())
    {
        return Err(VerificationBlockReason::RequiredReferenceUnresolved);
    }
    match claim.state {
        ClaimState::Queued | ClaimState::Checking => {
            return Err(VerificationBlockReason::AlreadyInProgress);
        }
        ClaimState::Superseded | ClaimState::Dismissed => {
            return Err(VerificationBlockReason::TerminalClaim);
        }
        _ => {}
    }
    if trigger == VerificationTrigger::Automatic && !policy.allow_automatic_checks {
        return Err(VerificationBlockReason::AutomaticChecksDisabled);
    }

    let mut local_source_classes = Vec::new();
    let mut external_candidates = Vec::new();
    for class in policy.allowed_classes.iter().copied() {
        match class {
            SourceClass::ContextDocument | SourceClass::ApprovedInternalRepository => {
                local_source_classes.push(class);
            }
            SourceClass::ModelKnowledge => {}
            _ if class.uses_open_web() => external_candidates.push(class),
            _ => {}
        }
    }

    let contains_private_content = matches!(
        claim.sensitivity,
        Sensitivity::PrivatePersonal | Sensitivity::Restricted
    );
    let external_research_rejection = external_gate(policy, contains_private_content);
    let external_source_classes = if external_research_rejection.is_none() {
        external_candidates.clone()
    } else {
        Vec::new()
    };

    if local_source_classes.is_empty() && external_source_classes.is_empty() {
        if !external_candidates.is_empty() {
            return Err(VerificationBlockReason::ExternalResearchDenied(
                external_research_rejection.unwrap_or(AdmissionRejection::SourceClassNotAllowed),
            ));
        }
        return Err(VerificationBlockReason::NoPermittedSources);
    }

    Ok(VerificationPlan {
        job_id: job_id.trim().to_owned(),
        claim_id: claim.id.clone(),
        claim_updated_at_unix_ms: claim.updated_at_unix_ms,
        policy_id: policy.id.clone(),
        policy_version: policy.version,
        trigger,
        query: truncate_chars(
            claim.normalized_proposition.trim(),
            MAX_VERIFICATION_QUERY_CHARS,
        ),
        contains_private_content,
        local_source_classes,
        external_source_classes,
        external_research_rejection,
        allowed_domains: policy.allowed_domains.clone(),
        blocked_domains: policy.blocked_domains.clone(),
        allow_cached_evidence: policy.allow_cached_evidence,
        freshness_window_hours: policy.freshness_window_hours,
        minimum_independent_sources: policy.minimum_independent_sources,
        high_consequence_requirement: policy.high_consequence_requirement,
    })
}

fn external_gate(
    policy: &SourcePolicy,
    contains_private_content: bool,
) -> Option<AdmissionRejection> {
    if !policy.allow_normalized_claim_egress {
        return Some(AdmissionRejection::NormalizedClaimEgressDenied);
    }
    if contains_private_content && !policy.allow_private_claim_egress {
        return Some(AdmissionRejection::PrivateClaimEgressDenied);
    }
    if !policy.allow_open_web {
        return Some(AdmissionRejection::OpenWebDisabled);
    }
    None
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Error)]
pub enum VerificationAdmissionError {
    #[error("verification plan does not match the active source policy")]
    PolicyMismatch,
    #[error("candidate source class is outside the verification plan")]
    CandidateOutsidePlan,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Error)]
pub enum VerificationClaimApplyError {
    #[error("verification plan does not belong to this claim")]
    ClaimMismatch,
    #[error("verification plan does not match the claim source policy")]
    PolicyMismatch,
    #[error("claim changed after the verification plan was created")]
    StaleClaim,
    #[error("claim is not in the required verification state")]
    InvalidState,
    #[error("evidence was evaluated under a different source policy")]
    EvidencePolicyMismatch,
}

/// Re-run admission for each concrete candidate, including domain rules. This
/// is intentionally separate from planning because the publisher domain is not
/// known until a provider or local repository returns a result.
pub fn admit_verification_candidate(
    plan: &VerificationPlan,
    policy: &SourcePolicy,
    candidate: &SourceCandidate,
) -> Result<AdmissionDecision, VerificationAdmissionError> {
    if plan.policy_id != policy.id || plan.policy_version != policy.version {
        return Err(VerificationAdmissionError::PolicyMismatch);
    }
    if !plan.permits_class(candidate.class) {
        return Err(VerificationAdmissionError::CandidateOutsidePlan);
    }
    Ok(admit_source(
        policy,
        candidate,
        ResearchRequest {
            automatic: plan.trigger == VerificationTrigger::Automatic,
            normalized_claim_would_leave_device: candidate.class.uses_open_web(),
            contains_private_transcript_text: plan.contains_private_content,
        },
    ))
}

/// Apply a freshly accepted plan to its unchanged claim. The compare against
/// `claim_updated_at_unix_ms` prevents a late plan from queueing a corrected or
/// otherwise newer claim.
pub fn queue_claim_for_verification(
    claim: &mut ClaimRecord,
    plan: &VerificationPlan,
    now_unix_ms: u64,
) -> Result<(), VerificationClaimApplyError> {
    verify_claim_and_policy(claim, plan)?;
    if claim.updated_at_unix_ms != plan.claim_updated_at_unix_ms {
        return Err(VerificationClaimApplyError::StaleClaim);
    }

    let state = if claim.state == ClaimState::NeedsClarification {
        if claim
            .references
            .iter()
            .any(|reference| reference.required_for_verification && !reference.is_resolved())
        {
            return Err(VerificationClaimApplyError::InvalidState);
        }
        transition_claim(claim.state, ClaimEvent::RequiredReferencesResolved)
            .map_err(|_| VerificationClaimApplyError::InvalidState)?
    } else {
        claim.state
    };
    let event = match state {
        ClaimState::Detected | ClaimState::Attributed => ClaimEvent::CheckQueued,
        ClaimState::Supported
        | ClaimState::PartlySupported
        | ClaimState::ConflictingEvidence
        | ClaimState::NotVerified
        | ClaimState::NotExternallyVerifiable => ClaimEvent::RecheckQueued,
        _ => return Err(VerificationClaimApplyError::InvalidState),
    };
    claim.state =
        transition_claim(state, event).map_err(|_| VerificationClaimApplyError::InvalidState)?;
    claim.updated_at_unix_ms = now_unix_ms;
    Ok(())
}

pub fn start_claim_verification(
    claim: &mut ClaimRecord,
    plan: &VerificationPlan,
    now_unix_ms: u64,
) -> Result<(), VerificationClaimApplyError> {
    verify_claim_and_policy(claim, plan)?;
    claim.state = transition_claim(claim.state, ClaimEvent::CheckStarted)
        .map_err(|_| VerificationClaimApplyError::InvalidState)?;
    claim.updated_at_unix_ms = now_unix_ms;
    Ok(())
}

/// Merge one worker result and calculate the claim conclusion using only
/// evidence admitted under the plan's exact policy version. Rejected evidence
/// remains on the claim for audit but cannot influence `aggregate_evidence`.
pub fn finish_claim_verification(
    claim: &mut ClaimRecord,
    plan: &VerificationPlan,
    policy: &SourcePolicy,
    evidence: Vec<EvidenceRecord>,
    now_unix_ms: u64,
) -> Result<EvidenceConclusion, VerificationClaimApplyError> {
    verify_claim_and_policy(claim, plan)?;
    if policy.id != plan.policy_id || policy.version != plan.policy_version {
        return Err(VerificationClaimApplyError::PolicyMismatch);
    }
    if claim.state != ClaimState::Checking {
        return Err(VerificationClaimApplyError::InvalidState);
    }
    if evidence.iter().any(|record| {
        record.admission_policy_id != plan.policy_id
            || record.admission_policy_version != plan.policy_version
    }) {
        return Err(VerificationClaimApplyError::EvidencePolicyMismatch);
    }

    for record in evidence {
        if let Some(index) = claim
            .evidence
            .iter()
            .position(|current| current.source_id == record.source_id)
        {
            claim.evidence[index] = record;
        } else {
            claim.evidence.push(record);
        }
    }
    let current_policy_evidence: Vec<_> = claim
        .evidence
        .iter()
        .filter(|record| {
            record.admission_policy_id == plan.policy_id
                && record.admission_policy_version == plan.policy_version
        })
        .cloned()
        .collect();
    let conclusion = aggregate_evidence(&current_policy_evidence, claim.consequence, policy);
    claim.state = conclusion.state;
    claim.claim_confidence = Some(conclusion.claim_confidence);
    claim.updated_at_unix_ms = now_unix_ms;
    Ok(conclusion)
}

fn verify_claim_and_policy(
    claim: &ClaimRecord,
    plan: &VerificationPlan,
) -> Result<(), VerificationClaimApplyError> {
    if claim.id != plan.claim_id {
        return Err(VerificationClaimApplyError::ClaimMismatch);
    }
    if claim.policy_id != plan.policy_id || claim.policy_version != plan.policy_version {
        return Err(VerificationClaimApplyError::PolicyMismatch);
    }
    Ok(())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum VerificationJobState {
    Queued,
    Running,
    Completed,
    Cancelled,
    Failed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VerificationJobEvent {
    Start,
    Complete,
    Cancel,
    Fail,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Error)]
#[error("verification job event {event:?} is invalid while job is {from:?}")]
pub struct InvalidVerificationJobTransition {
    pub from: VerificationJobState,
    pub event: VerificationJobEvent,
}

pub fn transition_verification_job(
    from: VerificationJobState,
    event: VerificationJobEvent,
) -> Result<VerificationJobState, InvalidVerificationJobTransition> {
    use VerificationJobEvent as Event;
    use VerificationJobState as State;

    match (from, event) {
        (State::Queued, Event::Start) => Ok(State::Running),
        (State::Queued | State::Running, Event::Cancel) => Ok(State::Cancelled),
        (State::Running, Event::Complete) => Ok(State::Completed),
        (State::Running, Event::Fail) => Ok(State::Failed),
        _ => Err(InvalidVerificationJobTransition { from, event }),
    }
}

fn truncate_chars(value: &str, max: usize) -> String {
    value.chars().take(max).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::audio::StreamSide;
    use crate::claim::{ClaimState, Consequence, ImportanceReason};
    use crate::context::{ContextCategory, ContextCategory as Category};
    use crate::evidence::{EvidenceQuality, EvidenceScope, EvidenceStance, QualityAssessment};
    use crate::meaning_frame::{Confidence, FrameKind, Modality, Sensitivity};

    fn claim_for(policy: &SourcePolicy) -> ClaimRecord {
        ClaimRecord {
            id: "claim-b".into(),
            source_segment_ids: vec!["inbound-7".into()],
            speaker_side: StreamSide::Inbound,
            speaker_label: Some("caller".into()),
            exact_quote: "ABC News is reporting that both people died in that car crash in Arizona"
                .into(),
            normalized_proposition: "both people died in the Arizona car crash".into(),
            predicate: "died".into(),
            subject: Some("both people".into()),
            object: None,
            frame_kind: FrameKind::AttributedClaim,
            attribution_chain: Vec::new(),
            qualifiers: Vec::new(),
            references: Vec::new(),
            modality: Modality::Reported,
            negated: false,
            sensitivity: Sensitivity::Public,
            consequence: Consequence::High,
            importance_reasons: vec![ImportanceReason::ConsequenceIfWrong],
            state: ClaimState::Attributed,
            recommended_action: None,
            policy_id: policy.id.clone(),
            policy_version: policy.version,
            extraction_confidence: Confidence::High,
            resolution_confidence: Confidence::High,
            claim_confidence: None,
            evidence: Vec::new(),
            corrections: Vec::new(),
            created_at_unix_ms: 1,
            updated_at_unix_ms: 2,
        }
    }

    #[test]
    fn every_context_produces_only_its_permitted_research_lanes() {
        let cases = [
            (Category::Interview, true, true),
            (Category::CompanyMeeting, true, false),
            (Category::SalesCall, true, true),
            (Category::LiveStream, false, true),
            (Category::Other, true, false),
        ];
        for (category, local, external) in cases {
            let policy = SourcePolicy::for_context(category);
            let plan = plan_verification(
                format!("job-{category:?}"),
                &claim_for(&policy),
                &policy,
                VerificationTrigger::UserRequested,
            )
            .unwrap();
            assert_eq!(!plan.local_source_classes.is_empty(), local, "{category:?}");
            assert_eq!(
                !plan.external_source_classes.is_empty(),
                external,
                "{category:?}"
            );
        }
    }

    #[test]
    fn private_interview_claim_stays_local_and_exact_quote_never_enters_plan() {
        let policy = SourcePolicy::for_context(ContextCategory::Interview);
        let mut claim = claim_for(&policy);
        claim.sensitivity = Sensitivity::PrivatePersonal;
        let plan = plan_verification(
            "job-private",
            &claim,
            &policy,
            VerificationTrigger::UserRequested,
        )
        .unwrap();
        assert!(!plan.local_source_classes.is_empty());
        assert!(plan.external_source_classes.is_empty());
        assert_eq!(
            plan.external_research_rejection,
            Some(AdmissionRejection::PrivateClaimEgressDenied)
        );
        assert!(!format!("{plan:?}").contains(&claim.exact_quote));
    }

    #[test]
    fn private_live_stream_claim_is_blocked_when_no_local_lane_exists() {
        let policy = SourcePolicy::for_context(ContextCategory::LiveStream);
        let mut claim = claim_for(&policy);
        claim.sensitivity = Sensitivity::PrivatePersonal;
        assert_eq!(
            plan_verification(
                "job-private",
                &claim,
                &policy,
                VerificationTrigger::UserRequested,
            ),
            Err(VerificationBlockReason::ExternalResearchDenied(
                AdmissionRejection::PrivateClaimEgressDenied
            ))
        );
    }

    #[test]
    fn other_context_requires_user_action_but_allows_manual_local_check() {
        let policy = SourcePolicy::for_context(ContextCategory::Other);
        let claim = claim_for(&policy);
        assert_eq!(
            plan_verification("job-auto", &claim, &policy, VerificationTrigger::Automatic,),
            Err(VerificationBlockReason::AutomaticChecksDisabled)
        );
        assert!(plan_verification(
            "job-manual",
            &claim,
            &policy,
            VerificationTrigger::UserRequested,
        )
        .is_ok());
    }

    #[test]
    fn unresolved_reference_and_stale_policy_fail_closed() {
        let policy = SourcePolicy::for_context(ContextCategory::LiveStream);
        let mut claim = claim_for(&policy);
        claim.references.push(crate::meaning_frame::ReferenceEdge {
            surface_text: "that car crash".into(),
            kind: crate::meaning_frame::ReferenceKind::Event,
            required_for_verification: true,
            resolved_target_id: None,
            candidates: Vec::new(),
        });
        assert_eq!(
            plan_verification(
                "job-reference",
                &claim,
                &policy,
                VerificationTrigger::UserRequested,
            ),
            Err(VerificationBlockReason::RequiredReferenceUnresolved)
        );

        claim.references.clear();
        claim.policy_version += 1;
        assert_eq!(
            plan_verification(
                "job-policy",
                &claim,
                &policy,
                VerificationTrigger::UserRequested,
            ),
            Err(VerificationBlockReason::PolicyMismatch)
        );
    }

    #[test]
    fn candidate_admission_rechecks_domain_rules() {
        let mut policy = SourcePolicy::for_context(ContextCategory::LiveStream);
        policy.allowed_domains = vec!["abcnews.go.com".into()];
        let claim = claim_for(&policy);
        let plan = plan_verification(
            "job-domain",
            &claim,
            &policy,
            VerificationTrigger::UserRequested,
        )
        .unwrap();
        let allowed = SourceCandidate {
            class: SourceClass::RecognizedReporting,
            publisher_domain: Some("abcnews.go.com".into()),
        };
        let blocked = SourceCandidate {
            class: SourceClass::RecognizedReporting,
            publisher_domain: Some("unrelated.example".into()),
        };
        assert_eq!(
            admit_verification_candidate(&plan, &policy, &allowed),
            Ok(AdmissionDecision::Admitted)
        );
        assert_eq!(
            admit_verification_candidate(&plan, &policy, &blocked),
            Ok(AdmissionDecision::Rejected(
                AdmissionRejection::DomainNotAllowed
            ))
        );
    }

    #[test]
    fn model_knowledge_can_never_enter_a_plan() {
        let mut policy = SourcePolicy::for_context(ContextCategory::Other);
        policy.allowed_classes.clear();
        policy.allowed_classes.insert(SourceClass::ModelKnowledge);
        assert_eq!(
            plan_verification(
                "job-model",
                &claim_for(&policy),
                &policy,
                VerificationTrigger::UserRequested,
            ),
            Err(VerificationBlockReason::NoPermittedSources)
        );
    }

    #[test]
    fn jobs_cancel_only_before_terminal_completion() {
        let running =
            transition_verification_job(VerificationJobState::Queued, VerificationJobEvent::Start)
                .unwrap();
        assert_eq!(running, VerificationJobState::Running);
        assert_eq!(
            transition_verification_job(running, VerificationJobEvent::Cancel).unwrap(),
            VerificationJobState::Cancelled
        );
        assert!(transition_verification_job(
            VerificationJobState::Completed,
            VerificationJobEvent::Cancel
        )
        .is_err());
    }

    #[test]
    fn stale_plan_cannot_queue_a_corrected_claim() {
        let policy = SourcePolicy::for_context(ContextCategory::LiveStream);
        let mut claim = claim_for(&policy);
        let plan = plan_verification(
            "job-stale",
            &claim,
            &policy,
            VerificationTrigger::UserRequested,
        )
        .unwrap();
        claim.updated_at_unix_ms += 1;
        assert_eq!(
            queue_claim_for_verification(&mut claim, &plan, 10),
            Err(VerificationClaimApplyError::StaleClaim)
        );
        assert_eq!(claim.state, ClaimState::Attributed);
    }

    #[test]
    fn queue_start_and_finish_use_the_existing_evidence_aggregator() {
        let policy = SourcePolicy::for_context(ContextCategory::LiveStream);
        let mut claim = claim_for(&policy);
        let plan = plan_verification(
            "job-complete",
            &claim,
            &policy,
            VerificationTrigger::UserRequested,
        )
        .unwrap();
        queue_claim_for_verification(&mut claim, &plan, 3).unwrap();
        assert_eq!(claim.state, ClaimState::Queued);
        start_claim_verification(&mut claim, &plan, 4).unwrap();
        assert_eq!(claim.state, ClaimState::Checking);

        let strong = EvidenceQuality {
            authority: QualityAssessment::Strong,
            directness: QualityAssessment::Strong,
            specificity: QualityAssessment::Strong,
            freshness: QualityAssessment::Strong,
            independence: QualityAssessment::Strong,
            completeness: QualityAssessment::Strong,
            provenance: QualityAssessment::Strong,
        };
        let conclusion = finish_claim_verification(
            &mut claim,
            &plan,
            &policy,
            vec![EvidenceRecord {
                source_id: "az-dps-report".into(),
                source_class: SourceClass::PrimaryOfficial,
                publisher: "Arizona DPS".into(),
                title: "Collision report".into(),
                url: Some("https://azdps.gov/report".into()),
                local_document_id: None,
                excerpt: "Two fatalities were confirmed.".into(),
                addressed_claim_part: "fatalities".into(),
                scope: EvidenceScope::UnderlyingProposition,
                stance: EvidenceStance::Supports,
                quality: strong,
                independence_group: Some("az-dps".into()),
                admission: AdmissionDecision::Admitted,
                admission_policy_id: policy.id.clone(),
                admission_policy_version: policy.version,
                published_at_unix_ms: Some(4),
                retrieved_at_unix_ms: 5,
            }],
            6,
        )
        .unwrap();

        assert_eq!(conclusion.state, ClaimState::Supported);
        assert_eq!(claim.state, ClaimState::Supported);
        assert_eq!(claim.claim_confidence, Some(conclusion.claim_confidence));
        assert_eq!(claim.evidence.len(), 1);
    }

    #[test]
    fn evidence_from_another_policy_version_cannot_change_the_claim() {
        let policy = SourcePolicy::for_context(ContextCategory::CompanyMeeting);
        let mut claim = claim_for(&policy);
        let plan = plan_verification(
            "job-policy-evidence",
            &claim,
            &policy,
            VerificationTrigger::UserRequested,
        )
        .unwrap();
        queue_claim_for_verification(&mut claim, &plan, 3).unwrap();
        start_claim_verification(&mut claim, &plan, 4).unwrap();
        let result = finish_claim_verification(
            &mut claim,
            &plan,
            &policy,
            vec![EvidenceRecord {
                source_id: "stale-doc".into(),
                source_class: SourceClass::ContextDocument,
                publisher: "Context".into(),
                title: "Old report".into(),
                url: None,
                local_document_id: Some("doc-1".into()),
                excerpt: "Old value".into(),
                addressed_claim_part: "value".into(),
                scope: EvidenceScope::UnderlyingProposition,
                stance: EvidenceStance::Supports,
                quality: EvidenceQuality {
                    authority: QualityAssessment::Adequate,
                    directness: QualityAssessment::Adequate,
                    specificity: QualityAssessment::Adequate,
                    freshness: QualityAssessment::Adequate,
                    independence: QualityAssessment::Adequate,
                    completeness: QualityAssessment::Adequate,
                    provenance: QualityAssessment::Adequate,
                },
                independence_group: Some("context-doc-1".into()),
                admission: AdmissionDecision::Admitted,
                admission_policy_id: policy.id.clone(),
                admission_policy_version: policy.version + 1,
                published_at_unix_ms: None,
                retrieved_at_unix_ms: 5,
            }],
            6,
        );
        assert_eq!(
            result,
            Err(VerificationClaimApplyError::EvidencePolicyMismatch)
        );
        assert!(claim.evidence.is_empty());
        assert_eq!(claim.state, ClaimState::Checking);
    }
}

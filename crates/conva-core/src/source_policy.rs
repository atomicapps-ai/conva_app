//! Source admission policy for claim research and verification.
//!
//! Admission is binary, deterministic, and happens before evidence quality is
//! considered. A well-written but disallowed source remains rejected.

use std::collections::BTreeSet;

use serde::{Deserialize, Serialize};

use crate::context::ContextCategory;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SourceClass {
    ContextDocument,
    ApprovedInternalRepository,
    PrimaryOfficial,
    RecognizedReporting,
    SpecialistReference,
    CommunityMaterial,
    GeneralWebDiscovery,
    ModelKnowledge,
}

impl SourceClass {
    pub fn uses_open_web(self) -> bool {
        matches!(
            self,
            Self::PrimaryOfficial
                | Self::RecognizedReporting
                | Self::SpecialistReference
                | Self::CommunityMaterial
                | Self::GeneralWebDiscovery
        )
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HighConsequenceRequirement {
    PrimaryOfficialOrIndependentReports,
    PrimaryOfficialOnly,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SourcePolicy {
    pub id: String,
    pub version: u32,
    pub allowed_classes: BTreeSet<SourceClass>,
    #[serde(default)]
    pub allowed_domains: Vec<String>,
    #[serde(default)]
    pub blocked_domains: Vec<String>,
    pub allow_open_web: bool,
    pub allow_normalized_claim_egress: bool,
    /// A separate opt-in because public research being enabled must not make
    /// private interview experience or personal assertions uploadable.
    pub allow_private_claim_egress: bool,
    pub allow_cached_evidence: bool,
    pub allow_automatic_checks: bool,
    pub freshness_window_hours: Option<u32>,
    pub minimum_independent_sources: u8,
    pub high_consequence_requirement: HighConsequenceRequirement,
}

impl SourcePolicy {
    /// Visible, user-overridable starting policy for each supported Context.
    pub fn for_context(category: ContextCategory) -> Self {
        use SourceClass as Class;

        let internal = [Class::ContextDocument, Class::ApprovedInternalRepository];
        let public = [
            Class::PrimaryOfficial,
            Class::RecognizedReporting,
            Class::SpecialistReference,
        ];
        let (classes, open_web, egress, cached, automatic, freshness) = match category {
            ContextCategory::Interview => (
                internal.into_iter().chain(public).collect(),
                true,
                true,
                true,
                true,
                Some(24 * 30),
            ),
            ContextCategory::CompanyMeeting => (
                internal.into_iter().collect(),
                false,
                false,
                true,
                true,
                None,
            ),
            ContextCategory::SalesCall => (
                internal.into_iter().chain(public).collect(),
                true,
                true,
                true,
                true,
                Some(24 * 30),
            ),
            ContextCategory::LiveStream => (
                public
                    .into_iter()
                    .chain([Class::GeneralWebDiscovery])
                    .collect(),
                true,
                true,
                false,
                true,
                Some(24),
            ),
            ContextCategory::Other => (
                internal.into_iter().collect(),
                false,
                false,
                true,
                false,
                None,
            ),
        };

        Self {
            id: format!("default-{}", context_slug(category)),
            version: 1,
            allowed_classes: classes,
            allowed_domains: Vec::new(),
            blocked_domains: Vec::new(),
            allow_open_web: open_web,
            allow_normalized_claim_egress: egress,
            allow_private_claim_egress: false,
            allow_cached_evidence: cached,
            allow_automatic_checks: automatic,
            freshness_window_hours: freshness,
            minimum_independent_sources: 1,
            high_consequence_requirement:
                HighConsequenceRequirement::PrimaryOfficialOrIndependentReports,
        }
    }
}

fn context_slug(category: ContextCategory) -> &'static str {
    match category {
        ContextCategory::Interview => "interview",
        ContextCategory::CompanyMeeting => "company-meeting",
        ContextCategory::SalesCall => "sales-call",
        ContextCategory::LiveStream => "live-stream",
        ContextCategory::Other => "other",
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SourceCandidate {
    pub class: SourceClass,
    /// A host such as `news.example.com`; URLs are also accepted defensively.
    pub publisher_domain: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct ResearchRequest {
    pub automatic: bool,
    pub normalized_claim_would_leave_device: bool,
    pub contains_private_transcript_text: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", tag = "decision", content = "reason")]
pub enum AdmissionDecision {
    Admitted,
    Rejected(AdmissionRejection),
}

impl AdmissionDecision {
    pub fn is_admitted(self) -> bool {
        self == Self::Admitted
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AdmissionRejection {
    ModelKnowledgeCannotVerify,
    AutomaticCheckRequiresUser,
    NormalizedClaimEgressDenied,
    PrivateClaimEgressDenied,
    OpenWebDisabled,
    SourceClassNotAllowed,
    BlockedDomain,
    DomainNotAllowed,
}

pub fn admit_source(
    policy: &SourcePolicy,
    candidate: &SourceCandidate,
    request: ResearchRequest,
) -> AdmissionDecision {
    if candidate.class == SourceClass::ModelKnowledge {
        return AdmissionDecision::Rejected(AdmissionRejection::ModelKnowledgeCannotVerify);
    }
    if request.automatic && !policy.allow_automatic_checks {
        return AdmissionDecision::Rejected(AdmissionRejection::AutomaticCheckRequiresUser);
    }
    if request.normalized_claim_would_leave_device && !policy.allow_normalized_claim_egress {
        return AdmissionDecision::Rejected(AdmissionRejection::NormalizedClaimEgressDenied);
    }
    if request.normalized_claim_would_leave_device
        && request.contains_private_transcript_text
        && !policy.allow_private_claim_egress
    {
        return AdmissionDecision::Rejected(AdmissionRejection::PrivateClaimEgressDenied);
    }
    if candidate.class.uses_open_web() && !policy.allow_open_web {
        return AdmissionDecision::Rejected(AdmissionRejection::OpenWebDisabled);
    }
    if !policy.allowed_classes.contains(&candidate.class) {
        return AdmissionDecision::Rejected(AdmissionRejection::SourceClassNotAllowed);
    }

    if let Some(domain) = candidate.publisher_domain.as_deref() {
        if policy
            .blocked_domains
            .iter()
            .any(|blocked| domain_matches(domain, blocked))
        {
            return AdmissionDecision::Rejected(AdmissionRejection::BlockedDomain);
        }
        if !policy.allowed_domains.is_empty()
            && !policy
                .allowed_domains
                .iter()
                .any(|allowed| domain_matches(domain, allowed))
        {
            return AdmissionDecision::Rejected(AdmissionRejection::DomainNotAllowed);
        }
    } else if !policy.allowed_domains.is_empty() && candidate.class.uses_open_web() {
        return AdmissionDecision::Rejected(AdmissionRejection::DomainNotAllowed);
    }

    AdmissionDecision::Admitted
}

fn domain_matches(candidate: &str, policy_domain: &str) -> bool {
    let candidate = normalized_host(candidate);
    let policy_domain = normalized_host(policy_domain);
    !candidate.is_empty()
        && !policy_domain.is_empty()
        && (candidate == policy_domain
            || candidate
                .strip_suffix(&policy_domain)
                .is_some_and(|prefix| prefix.ends_with('.')))
}

fn normalized_host(value: &str) -> String {
    let without_scheme = value
        .trim()
        .split_once("://")
        .map_or(value.trim(), |(_, rest)| rest);
    without_scheme
        .split(['/', '?', '#'])
        .next()
        .unwrap_or_default()
        .split(':')
        .next()
        .unwrap_or_default()
        .trim_end_matches('.')
        .to_lowercase()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn candidate(class: SourceClass, domain: Option<&str>) -> SourceCandidate {
        SourceCandidate {
            class,
            publisher_domain: domain.map(str::to_owned),
        }
    }

    #[test]
    fn all_supported_contexts_receive_explicit_defaults() {
        let categories = [
            ContextCategory::Interview,
            ContextCategory::CompanyMeeting,
            ContextCategory::SalesCall,
            ContextCategory::LiveStream,
            ContextCategory::Other,
        ];
        for category in categories {
            let policy = SourcePolicy::for_context(category);
            assert!(!policy.id.is_empty());
            assert!(!policy.allowed_classes.is_empty());
        }
    }

    #[test]
    fn company_meeting_rejects_open_web_and_claim_egress() {
        let policy = SourcePolicy::for_context(ContextCategory::CompanyMeeting);
        let result = admit_source(
            &policy,
            &candidate(SourceClass::RecognizedReporting, Some("example.com")),
            ResearchRequest {
                normalized_claim_would_leave_device: true,
                ..ResearchRequest::default()
            },
        );
        assert_eq!(
            result,
            AdmissionDecision::Rejected(AdmissionRejection::NormalizedClaimEgressDenied)
        );
    }

    #[test]
    fn interview_allows_public_research_but_keeps_private_experience_local() {
        let policy = SourcePolicy::for_context(ContextCategory::Interview);
        let source = candidate(SourceClass::PrimaryOfficial, Some("employer.example"));
        assert!(admit_source(
            &policy,
            &source,
            ResearchRequest {
                normalized_claim_would_leave_device: true,
                ..ResearchRequest::default()
            }
        )
        .is_admitted());
        assert_eq!(
            admit_source(
                &policy,
                &source,
                ResearchRequest {
                    normalized_claim_would_leave_device: true,
                    contains_private_transcript_text: true,
                    ..ResearchRequest::default()
                }
            ),
            AdmissionDecision::Rejected(AdmissionRejection::PrivateClaimEgressDenied)
        );
    }

    #[test]
    fn other_context_requires_a_person_before_automatic_research() {
        let policy = SourcePolicy::for_context(ContextCategory::Other);
        let result = admit_source(
            &policy,
            &candidate(SourceClass::ContextDocument, None),
            ResearchRequest {
                automatic: true,
                ..ResearchRequest::default()
            },
        );
        assert_eq!(
            result,
            AdmissionDecision::Rejected(AdmissionRejection::AutomaticCheckRequiresUser)
        );
    }

    #[test]
    fn model_knowledge_never_independently_verifies() {
        let mut policy = SourcePolicy::for_context(ContextCategory::LiveStream);
        policy.allowed_classes.insert(SourceClass::ModelKnowledge);
        assert_eq!(
            admit_source(
                &policy,
                &candidate(SourceClass::ModelKnowledge, None),
                ResearchRequest::default()
            ),
            AdmissionDecision::Rejected(AdmissionRejection::ModelKnowledgeCannotVerify)
        );
    }

    #[test]
    fn blocklist_wins_over_allowlist_and_matches_subdomains() {
        let mut policy = SourcePolicy::for_context(ContextCategory::LiveStream);
        policy.allowed_domains = vec!["example.com".into()];
        policy.blocked_domains = vec!["bad.example.com".into()];
        assert_eq!(
            admit_source(
                &policy,
                &candidate(
                    SourceClass::RecognizedReporting,
                    Some("https://wire.bad.example.com/story")
                ),
                ResearchRequest::default()
            ),
            AdmissionDecision::Rejected(AdmissionRejection::BlockedDomain)
        );
    }

    #[test]
    fn allowlist_accepts_subdomains_but_not_suffix_spoofs() {
        let mut policy = SourcePolicy::for_context(ContextCategory::Interview);
        policy.allowed_domains = vec!["example.com".into()];
        assert!(admit_source(
            &policy,
            &candidate(SourceClass::PrimaryOfficial, Some("press.example.com")),
            ResearchRequest::default()
        )
        .is_admitted());
        assert_eq!(
            admit_source(
                &policy,
                &candidate(SourceClass::PrimaryOfficial, Some("notexample.com")),
                ResearchRequest::default()
            ),
            AdmissionDecision::Rejected(AdmissionRejection::DomainNotAllowed)
        );
    }

    #[test]
    fn live_stream_defaults_are_fresh_and_do_not_accept_cache() {
        let policy = SourcePolicy::for_context(ContextCategory::LiveStream);
        assert_eq!(policy.freshness_window_hours, Some(24));
        assert!(!policy.allow_cached_evidence);
        assert!(policy.allow_open_web);
    }
}

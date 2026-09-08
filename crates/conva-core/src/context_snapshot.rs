//! Compact, versioned context supplied to the FANER semantic pass.

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::claim::{ClaimKey, ClaimState};
use crate::context::ContextCategory;
use crate::meaning_frame::{Confidence, ReferenceCandidate};
use crate::source_policy::SourcePolicy;

pub const CONTEXT_SNAPSHOT_VERSION: u32 = 1;
pub const MAX_SNAPSHOT_ENTITIES: usize = 32;
pub const MAX_SNAPSHOT_EVENTS: usize = 16;
pub const MAX_RECENT_CLAIMS: usize = 24;
pub const MAX_ALIASES_PER_TARGET: usize = 8;
pub const MAX_ROLLING_SUMMARY_CHARS: usize = 2_000;
pub const MAX_PURPOSE_CHARS: usize = 500;
pub const MAX_POLICY_DOMAINS: usize = 32;
pub const MAX_LABEL_CHARS: usize = 160;
pub const MAX_EVENT_SUMMARY_CHARS: usize = 500;
pub const MAX_RELATIONSHIPS_PER_ENTITY: usize = 16;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ParticipationLens {
    Interviewer,
    Interviewee,
    MeetingLead,
    MeetingParticipant,
    Buyer,
    Seller,
    LiveHost,
    LiveGuest,
    OtherSpeaker,
    OtherListener,
}

impl ParticipationLens {
    pub fn is_compatible_with(self, category: ContextCategory) -> bool {
        matches!(
            (category, self),
            (
                ContextCategory::Interview,
                Self::Interviewer | Self::Interviewee
            ) | (
                ContextCategory::CompanyMeeting,
                Self::MeetingLead | Self::MeetingParticipant
            ) | (ContextCategory::SalesCall, Self::Buyer | Self::Seller)
                | (
                    ContextCategory::LiveStream,
                    Self::LiveHost | Self::LiveGuest
                )
                | (
                    ContextCategory::Other,
                    Self::OtherSpeaker | Self::OtherListener
                )
        )
    }

    pub fn default_for(category: ContextCategory) -> Self {
        match category {
            ContextCategory::Interview => Self::Interviewee,
            ContextCategory::CompanyMeeting => Self::MeetingParticipant,
            ContextCategory::SalesCall => Self::Seller,
            ContextCategory::LiveStream => Self::LiveHost,
            ContextCategory::Other => Self::OtherSpeaker,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EntityKind {
    Person,
    Organization,
    Product,
    Place,
    Artifact,
    Other,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EntityRelationship {
    pub predicate: String,
    pub target_entity_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct KnownEntity {
    pub id: String,
    pub canonical_name: String,
    pub kind: EntityKind,
    #[serde(default)]
    pub aliases: Vec<String>,
    #[serde(default)]
    pub relationships: Vec<EntityRelationship>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct KnownEvent {
    pub id: String,
    pub label: String,
    #[serde(default)]
    pub aliases: Vec<String>,
    #[serde(default)]
    pub summary: String,
    #[serde(default)]
    pub participant_entity_ids: Vec<String>,
    #[serde(default)]
    pub location: Option<String>,
    #[serde(default)]
    pub occurred_at_label: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RecentClaim {
    pub key: ClaimKey,
    pub state: ClaimState,
    #[serde(default)]
    pub speaker_label: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ContextSnapshot {
    pub contract_version: u32,
    pub category: ContextCategory,
    pub participation_lens: ParticipationLens,
    pub purpose: String,
    #[serde(default)]
    pub entities: Vec<KnownEntity>,
    #[serde(default)]
    pub events: Vec<KnownEvent>,
    #[serde(default)]
    pub recent_claims: Vec<RecentClaim>,
    pub source_policy: SourcePolicy,
    #[serde(default)]
    pub rolling_summary: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum SnapshotError {
    #[error("participation lens {lens:?} is incompatible with {category:?}")]
    IncompatibleLens {
        category: ContextCategory,
        lens: ParticipationLens,
    },
    #[error("unsupported Context Snapshot version {actual}; expected {expected}")]
    UnsupportedVersion { actual: u32, expected: u32 },
}

impl ContextSnapshot {
    pub fn new(
        category: ContextCategory,
        participation_lens: ParticipationLens,
        purpose: impl Into<String>,
    ) -> Result<Self, SnapshotError> {
        if !participation_lens.is_compatible_with(category) {
            return Err(SnapshotError::IncompatibleLens {
                category,
                lens: participation_lens,
            });
        }
        Ok(Self {
            contract_version: CONTEXT_SNAPSHOT_VERSION,
            category,
            participation_lens,
            purpose: truncate_chars(purpose.into().trim(), MAX_PURPOSE_CHARS),
            entities: Vec::new(),
            events: Vec::new(),
            recent_claims: Vec::new(),
            source_policy: SourcePolicy::for_context(category),
            rolling_summary: String::new(),
        })
    }

    pub fn validate(&self) -> Result<(), SnapshotError> {
        if self.contract_version != CONTEXT_SNAPSHOT_VERSION {
            return Err(SnapshotError::UnsupportedVersion {
                actual: self.contract_version,
                expected: CONTEXT_SNAPSHOT_VERSION,
            });
        }
        if !self.participation_lens.is_compatible_with(self.category) {
            return Err(SnapshotError::IncompatibleLens {
                category: self.category,
                lens: self.participation_lens,
            });
        }
        Ok(())
    }

    /// Enforce the fast-path size budget and remove malformed/duplicate target
    /// ids. Call after assembling a snapshot from Context storage.
    pub fn bounded(mut self) -> Self {
        self.contract_version = CONTEXT_SNAPSHOT_VERSION;
        self.purpose = truncate_chars(self.purpose.trim(), MAX_PURPOSE_CHARS);
        self.rolling_summary = tail_chars(self.rolling_summary.trim(), MAX_ROLLING_SUMMARY_CHARS);
        self.entities = bounded_entities(self.entities);
        let entity_ids: BTreeSet<_> = self.entities.iter().map(|item| item.id.clone()).collect();
        for entity in &mut self.entities {
            entity.relationships =
                bounded_relationships(std::mem::take(&mut entity.relationships), &entity_ids);
        }
        self.events = bounded_events(self.events, &entity_ids);
        let mut target_ids = entity_ids;
        self.events
            .retain(|event| target_ids.insert(event.id.clone()));
        if self.recent_claims.len() > MAX_RECENT_CLAIMS {
            self.recent_claims = self
                .recent_claims
                .split_off(self.recent_claims.len() - MAX_RECENT_CLAIMS);
        }
        for recent in &mut self.recent_claims {
            recent.key.normalized_proposition =
                truncate_chars(&recent.key.normalized_proposition, MAX_PURPOSE_CHARS);
            recent.key.attributed_source = recent
                .key
                .attributed_source
                .take()
                .map(|source| truncate_chars(source.trim(), MAX_LABEL_CHARS))
                .filter(|source| !source.is_empty());
            recent.speaker_label = recent
                .speaker_label
                .take()
                .map(|label| truncate_chars(label.trim(), MAX_LABEL_CHARS))
                .filter(|label| !label.is_empty());
        }
        self.source_policy.allowed_domains =
            normalize_domains(self.source_policy.allowed_domains, MAX_POLICY_DOMAINS);
        self.source_policy.blocked_domains =
            normalize_domains(self.source_policy.blocked_domains, MAX_POLICY_DOMAINS);
        self
    }

    pub fn contains_recent_claim(&self, key: &ClaimKey) -> bool {
        self.recent_claims.iter().any(|claim| &claim.key == key)
    }

    /// Exact alias lookup only. Fuzzy or pronoun resolution remains a set of
    /// candidates for user/model review and never silently binds here.
    pub fn reference_candidates(&self, surface_text: &str) -> Vec<ReferenceCandidate> {
        let needle = normalize_lookup(surface_text);
        if needle.is_empty() {
            return Vec::new();
        }
        let mut matches = BTreeMap::<String, String>::new();
        for entity in &self.entities {
            if target_names(&entity.canonical_name, &entity.aliases)
                .any(|name| normalize_lookup(name) == needle)
            {
                matches.insert(entity.id.clone(), entity.canonical_name.clone());
            }
        }
        for event in &self.events {
            if target_names(&event.label, &event.aliases)
                .any(|name| normalize_lookup(name) == needle)
            {
                matches.insert(event.id.clone(), event.label.clone());
            }
        }
        matches
            .into_iter()
            .map(|(target_id, label)| ReferenceCandidate {
                target_id,
                label,
                confidence: Confidence::High,
            })
            .collect()
    }

    pub fn reference_candidate_for_id(&self, target_id: &str) -> Option<ReferenceCandidate> {
        self.entities
            .iter()
            .find(|entity| entity.id == target_id)
            .map(|entity| ReferenceCandidate {
                target_id: entity.id.clone(),
                label: entity.canonical_name.clone(),
                confidence: Confidence::Medium,
            })
            .or_else(|| {
                self.events
                    .iter()
                    .find(|event| event.id == target_id)
                    .map(|event| ReferenceCandidate {
                        target_id: event.id.clone(),
                        label: event.label.clone(),
                        confidence: Confidence::Medium,
                    })
            })
    }
}

fn bounded_entities(entities: Vec<KnownEntity>) -> Vec<KnownEntity> {
    let mut seen = BTreeSet::new();
    entities
        .into_iter()
        .filter_map(|mut entity| {
            entity.id = entity.id.trim().to_owned();
            entity.canonical_name = truncate_chars(entity.canonical_name.trim(), MAX_LABEL_CHARS);
            if entity.id.is_empty()
                || entity.canonical_name.is_empty()
                || !seen.insert(entity.id.clone())
            {
                return None;
            }
            entity.aliases = bounded_aliases(entity.aliases);
            Some(entity)
        })
        .take(MAX_SNAPSHOT_ENTITIES)
        .collect()
}

fn bounded_relationships(
    relationships: Vec<EntityRelationship>,
    entity_ids: &BTreeSet<String>,
) -> Vec<EntityRelationship> {
    let mut seen = BTreeSet::new();
    relationships
        .into_iter()
        .filter_map(|mut relationship| {
            relationship.predicate = truncate_chars(relationship.predicate.trim(), MAX_LABEL_CHARS);
            relationship.target_entity_id = relationship.target_entity_id.trim().to_owned();
            let key = (
                relationship.predicate.to_lowercase(),
                relationship.target_entity_id.clone(),
            );
            if relationship.predicate.is_empty()
                || !entity_ids.contains(relationship.target_entity_id.as_str())
                || !seen.insert(key)
            {
                return None;
            }
            Some(relationship)
        })
        .take(MAX_RELATIONSHIPS_PER_ENTITY)
        .collect()
}

fn bounded_events(events: Vec<KnownEvent>, entity_ids: &BTreeSet<String>) -> Vec<KnownEvent> {
    let mut seen = BTreeSet::new();
    events
        .into_iter()
        .filter_map(|mut event| {
            event.id = event.id.trim().to_owned();
            event.label = truncate_chars(event.label.trim(), MAX_LABEL_CHARS);
            if event.id.is_empty() || event.label.is_empty() || !seen.insert(event.id.clone()) {
                return None;
            }
            event.aliases = bounded_aliases(event.aliases);
            event.summary = truncate_chars(event.summary.trim(), MAX_EVENT_SUMMARY_CHARS);
            event.location = event
                .location
                .take()
                .map(|value| truncate_chars(value.trim(), MAX_LABEL_CHARS))
                .filter(|value| !value.is_empty());
            event.occurred_at_label = event
                .occurred_at_label
                .take()
                .map(|value| truncate_chars(value.trim(), MAX_LABEL_CHARS))
                .filter(|value| !value.is_empty());
            event
                .participant_entity_ids
                .retain(|id| entity_ids.contains(id.as_str()));
            event.participant_entity_ids.sort();
            event.participant_entity_ids.dedup();
            Some(event)
        })
        .take(MAX_SNAPSHOT_EVENTS)
        .collect()
}

fn bounded_aliases(aliases: Vec<String>) -> Vec<String> {
    let mut seen = BTreeSet::new();
    aliases
        .into_iter()
        .map(|alias| truncate_chars(alias.trim(), MAX_LABEL_CHARS))
        .filter(|alias| !alias.is_empty() && seen.insert(normalize_lookup(alias)))
        .take(MAX_ALIASES_PER_TARGET)
        .collect()
}

fn normalize_domains(domains: Vec<String>, limit: usize) -> Vec<String> {
    let mut seen = BTreeSet::new();
    domains
        .into_iter()
        .map(|domain| {
            truncate_chars(domain.trim().trim_end_matches('.'), MAX_LABEL_CHARS).to_lowercase()
        })
        .filter(|domain| !domain.is_empty() && seen.insert(domain.clone()))
        .take(limit)
        .collect()
}

fn target_names<'a>(canonical: &'a str, aliases: &'a [String]) -> impl Iterator<Item = &'a str> {
    std::iter::once(canonical).chain(aliases.iter().map(String::as_str))
}

fn normalize_lookup(value: &str) -> String {
    value
        .trim_matches(|character: char| !character.is_alphanumeric())
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

fn truncate_chars(value: &str, limit: usize) -> String {
    value.chars().take(limit).collect()
}

fn tail_chars(value: &str, limit: usize) -> String {
    let count = value.chars().count();
    value.chars().skip(count.saturating_sub(limit)).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entity(id: &str, name: &str, aliases: &[&str]) -> KnownEntity {
        KnownEntity {
            id: id.into(),
            canonical_name: name.into(),
            kind: EntityKind::Person,
            aliases: aliases.iter().map(|alias| (*alias).into()).collect(),
            relationships: Vec::new(),
        }
    }

    #[test]
    fn every_context_has_two_compatible_lenses() {
        let pairs = [
            (ContextCategory::Interview, ParticipationLens::Interviewer),
            (ContextCategory::Interview, ParticipationLens::Interviewee),
            (
                ContextCategory::CompanyMeeting,
                ParticipationLens::MeetingLead,
            ),
            (
                ContextCategory::CompanyMeeting,
                ParticipationLens::MeetingParticipant,
            ),
            (ContextCategory::SalesCall, ParticipationLens::Buyer),
            (ContextCategory::SalesCall, ParticipationLens::Seller),
            (ContextCategory::LiveStream, ParticipationLens::LiveHost),
            (ContextCategory::LiveStream, ParticipationLens::LiveGuest),
            (ContextCategory::Other, ParticipationLens::OtherSpeaker),
            (ContextCategory::Other, ParticipationLens::OtherListener),
        ];
        for (category, lens) in pairs {
            assert!(lens.is_compatible_with(category));
        }
    }

    #[test]
    fn incompatible_lens_fails_instead_of_silently_changing_role() {
        assert_eq!(
            ContextSnapshot::new(
                ContextCategory::Interview,
                ParticipationLens::LiveHost,
                "Prepare"
            )
            .unwrap_err(),
            SnapshotError::IncompatibleLens {
                category: ContextCategory::Interview,
                lens: ParticipationLens::LiveHost,
            }
        );
    }

    #[test]
    fn unsupported_snapshot_version_is_rejected() {
        let mut snapshot = ContextSnapshot::new(
            ContextCategory::SalesCall,
            ParticipationLens::Buyer,
            "Evaluate a proposal",
        )
        .unwrap();
        snapshot.contract_version = CONTEXT_SNAPSHOT_VERSION + 1;
        assert_eq!(
            snapshot.validate().unwrap_err(),
            SnapshotError::UnsupportedVersion {
                actual: CONTEXT_SNAPSHOT_VERSION + 1,
                expected: CONTEXT_SNAPSHOT_VERSION,
            }
        );
    }

    #[test]
    fn snapshot_is_bounded_and_keeps_the_newest_summary_and_claims() {
        let mut snapshot = ContextSnapshot::new(
            ContextCategory::Other,
            ParticipationLens::OtherSpeaker,
            "x".repeat(MAX_PURPOSE_CHARS + 10),
        )
        .unwrap();
        snapshot.rolling_summary = format!("old{}", "n".repeat(MAX_ROLLING_SUMMARY_CHARS));
        snapshot.entities = (0..MAX_SNAPSHOT_ENTITIES + 2)
            .map(|index| entity(&format!("e{index}"), &format!("Person {index}"), &[]))
            .collect();
        snapshot.recent_claims = (0..MAX_RECENT_CLAIMS + 2)
            .map(|index| RecentClaim {
                key: ClaimKey::new(&format!("claim {index}"), None),
                state: ClaimState::Detected,
                speaker_label: None,
            })
            .collect();
        let bounded = snapshot.bounded();
        assert_eq!(bounded.purpose.chars().count(), MAX_PURPOSE_CHARS);
        assert_eq!(
            bounded.rolling_summary.chars().count(),
            MAX_ROLLING_SUMMARY_CHARS
        );
        assert!(!bounded.rolling_summary.starts_with("old"));
        assert_eq!(bounded.entities.len(), MAX_SNAPSHOT_ENTITIES);
        assert_eq!(bounded.recent_claims.len(), MAX_RECENT_CLAIMS);
        assert_eq!(
            bounded.recent_claims[0].key.normalized_proposition,
            "claim 2"
        );
    }

    #[test]
    fn exact_unique_alias_resolves_but_ambiguous_alias_does_not() {
        let mut snapshot = ContextSnapshot::new(
            ContextCategory::LiveStream,
            ParticipationLens::LiveHost,
            "Cover the Nolan Wells case",
        )
        .unwrap();
        snapshot.entities = vec![
            entity("matt-a", "Matthew Jones", &["Matt"]),
            entity("matt-b", "Matthew Smith", &["Matt"]),
            entity("nolan", "Nolan Wells", &["Nolan"]),
        ];
        let snapshot = snapshot.bounded();
        assert_eq!(snapshot.reference_candidates("Nolan").len(), 1);
        assert_eq!(snapshot.reference_candidates("Matt").len(), 2);
        assert!(snapshot.reference_candidates("he").is_empty());
    }

    #[test]
    fn malformed_and_duplicate_targets_are_removed() {
        let mut snapshot = ContextSnapshot::new(
            ContextCategory::CompanyMeeting,
            ParticipationLens::MeetingLead,
            "Decide launch timing",
        )
        .unwrap();
        snapshot.entities = vec![
            entity("person-1", "Ari", &[" A ", "a", ""]),
            entity("person-1", "Duplicate", &[]),
            entity("", "Missing id", &[]),
        ];
        snapshot.events = vec![KnownEvent {
            id: "person-1".into(),
            label: "Colliding event".into(),
            aliases: vec![],
            summary: String::new(),
            participant_entity_ids: vec!["missing".into(), "person-1".into()],
            location: None,
            occurred_at_label: None,
        }];
        let bounded = snapshot.bounded();
        assert_eq!(bounded.entities.len(), 1);
        assert_eq!(bounded.entities[0].aliases, vec!["A"]);
        assert!(bounded.events.is_empty());
    }
}

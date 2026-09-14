//! Explicit portable conversation DTO conversion for `.cva` v1.
//!
//! MAINTENANCE: When `src-tauri/src/conversations.rs::Conversation`,
//! `TranscriptSegment`, `ClaimSnapshotEvent`, `ClaimRecord`, `EvidenceRecord`,
//! or `ClaimCorrection` change, review BOTH conversion directions, every
//! session/claim/document reference, the manifest inventory, v1 fixture
//! compatibility, and schema migrations. Never derive this DTO by serializing
//! a persistence record wholesale. `Conversation` itself is a `src-tauri`
//! (shell) type and must never be imported here — `conva-core` stays
//! GUI/OS-free, so this module operates on the plain field values a shell
//! adapter extracts from/reassembles into that struct. See the conva_core
//! `.cva` spec and implementation handoff.
//!
//! ## Segment references are content-derived, not opaque IDs
//!
//! A `TranscriptSegment` carries no independent identifier — claims reference
//! it by a string derived purely from its own `side`/`seq` fields
//! (`semantic_extraction::segment_id`, e.g. `"inbound:5"`). Because `side` and
//! `seq` are preserved verbatim on export/import (they are data, not portable
//! IDs), that derived string is automatically identical after import with no
//! remapping step. This module does not additionally assert that every
//! `source_segment_ids` entry resolves to a live segment in the exported
//! array: the running app itself does not guarantee (side, seq) uniqueness
//! within `Conversation.segments` (a segment can be finalized more than once
//! with the same seq), so a stricter check here would reject legitimate data
//! the source app already accepted. Only session, claim, and document
//! references — real identifiers minted elsewhere — are remapped and
//! strictly validated below.

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};

use crate::archive::ArchiveError;
use crate::archive_payload::{remap, remap_optional};
use crate::asr::TranscriptSegment;
use crate::audio::StreamSide;
use crate::claim::{ClaimCorrection, ClaimRecord, ClaimState, Consequence, ImportanceReason};
use crate::evidence::{
    ClaimConfidence, EvidenceQuality, EvidenceRecord, EvidenceScope, EvidenceStance,
};
use crate::ipc::{ClaimSnapshotEvent, CLAIM_SNAPSHOT_CONTRACT_VERSION};
use crate::meaning_frame::{
    Attribution, Confidence, FrameKind, FrameQualifier, Modality, ReferenceEdge, Sensitivity,
    SuggestedAction,
};
use crate::source_policy::{AdmissionDecision, SourceClass};

/// One caller-generated destination ID per referenced entity kind. Each map
/// is its own namespace: a session ID must never be looked up in
/// `claim_ids`, a claim ID never in `document_ids`, and so on. `context_id`
/// is `Some` only when this conversation is imported together with its
/// linked Context (must equal the destination ID used by
/// [`crate::archive_payload::import_context`] for the same archive).
#[derive(Debug, Clone, Default)]
pub struct ConversationImportIds {
    pub conversation_id: String,
    pub document_ids: BTreeMap<String, String>,
    pub session_ids: BTreeMap<String, String>,
    pub claim_ids: BTreeMap<String, String>,
    pub context_id: Option<String>,
}

/// Explicit transcript segment DTO. Mirrors `TranscriptSegment` field for
/// field rather than reusing it directly so a future addition to the live
/// segment type must be a conscious archive decision.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PortableTranscriptSegmentV1 {
    pub side: StreamSide,
    pub seq: u64,
    pub text: String,
    pub is_final: bool,
    pub start_ms: u64,
    pub end_ms: u64,
    #[serde(default)]
    pub confidence: Option<f32>,
    pub latency_ms: u32,
}

/// MAINTENANCE: audit alongside `TranscriptSegment`. No IDs to remap — side
/// and seq are plain data, not portable relationship keys.
pub fn export_transcript_segment(segment: &TranscriptSegment) -> PortableTranscriptSegmentV1 {
    PortableTranscriptSegmentV1 {
        side: segment.side,
        seq: segment.seq,
        text: segment.text.clone(),
        is_final: segment.is_final,
        start_ms: segment.start_ms,
        end_ms: segment.end_ms,
        confidence: segment.confidence,
        latency_ms: segment.latency_ms,
    }
}

pub fn import_transcript_segment(portable: PortableTranscriptSegmentV1) -> TranscriptSegment {
    TranscriptSegment {
        side: portable.side,
        seq: portable.seq,
        text: portable.text,
        is_final: portable.is_final,
        start_ms: portable.start_ms,
        end_ms: portable.end_ms,
        confidence: portable.confidence,
        latency_ms: portable.latency_ms,
    }
}

/// MAINTENANCE: audit alongside `EvidenceRecord`. `local_document_id` is the
/// only reference field; every other field is a value/enum with no local
/// path, secret, or foreign ID.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PortableEvidenceV1 {
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
    #[serde(default)]
    pub independence_group: Option<String>,
    pub admission: AdmissionDecision,
    pub admission_policy_id: String,
    pub admission_policy_version: u32,
    #[serde(default)]
    pub published_at_unix_ms: Option<u64>,
    pub retrieved_at_unix_ms: u64,
}

fn export_evidence(evidence: &EvidenceRecord) -> PortableEvidenceV1 {
    PortableEvidenceV1 {
        source_id: evidence.source_id.clone(),
        source_class: evidence.source_class,
        publisher: evidence.publisher.clone(),
        title: evidence.title.clone(),
        url: evidence.url.clone(),
        local_document_id: evidence.local_document_id.clone(),
        excerpt: evidence.excerpt.clone(),
        addressed_claim_part: evidence.addressed_claim_part.clone(),
        scope: evidence.scope,
        stance: evidence.stance,
        quality: evidence.quality,
        independence_group: evidence.independence_group.clone(),
        admission: evidence.admission,
        admission_policy_id: evidence.admission_policy_id.clone(),
        admission_policy_version: evidence.admission_policy_version,
        published_at_unix_ms: evidence.published_at_unix_ms,
        retrieved_at_unix_ms: evidence.retrieved_at_unix_ms,
    }
}

/// `local_document_id` is a document reference: remap it through the same
/// document namespace used for Context/library documents, or reject the
/// claim rather than silently keep a source-only ID alive in a destination
/// store where it names nothing (or, worse, a different document).
fn import_evidence(
    portable: PortableEvidenceV1,
    document_ids: &BTreeMap<String, String>,
) -> Result<EvidenceRecord, ArchiveError> {
    Ok(EvidenceRecord {
        source_id: portable.source_id,
        source_class: portable.source_class,
        publisher: portable.publisher,
        title: portable.title,
        url: portable.url,
        local_document_id: remap_optional(&portable.local_document_id, document_ids)?,
        excerpt: portable.excerpt,
        addressed_claim_part: portable.addressed_claim_part,
        scope: portable.scope,
        stance: portable.stance,
        quality: portable.quality,
        independence_group: portable.independence_group,
        admission: portable.admission,
        admission_policy_id: portable.admission_policy_id,
        admission_policy_version: portable.admission_policy_version,
        published_at_unix_ms: portable.published_at_unix_ms,
        retrieved_at_unix_ms: portable.retrieved_at_unix_ms,
    })
}

/// MAINTENANCE: audit alongside `ClaimRecord`. `id` is a portable claim ID
/// (remapped); `source_segment_ids` are content-derived transcript
/// references (see module docs, not remapped); `evidence[].local_document_id`
/// is remapped through the document namespace. Every other field is a
/// value/enum carrying no local state.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PortableClaimV1 {
    pub id: String,
    #[serde(default)]
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
    pub policy_version: u32,
    pub extraction_confidence: Confidence,
    pub resolution_confidence: Confidence,
    #[serde(default)]
    pub claim_confidence: Option<ClaimConfidence>,
    #[serde(default)]
    pub evidence: Vec<PortableEvidenceV1>,
    #[serde(default)]
    pub corrections: Vec<ClaimCorrection>,
    pub created_at_unix_ms: u64,
    pub updated_at_unix_ms: u64,
}

fn export_claim(claim: &ClaimRecord) -> PortableClaimV1 {
    PortableClaimV1 {
        id: claim.id.clone(),
        source_segment_ids: claim.source_segment_ids.clone(),
        speaker_side: claim.speaker_side,
        speaker_label: claim.speaker_label.clone(),
        exact_quote: claim.exact_quote.clone(),
        normalized_proposition: claim.normalized_proposition.clone(),
        predicate: claim.predicate.clone(),
        subject: claim.subject.clone(),
        object: claim.object.clone(),
        frame_kind: claim.frame_kind,
        attribution_chain: claim.attribution_chain.clone(),
        qualifiers: claim.qualifiers.clone(),
        references: claim.references.clone(),
        modality: claim.modality,
        negated: claim.negated,
        sensitivity: claim.sensitivity,
        consequence: claim.consequence,
        importance_reasons: claim.importance_reasons.clone(),
        state: claim.state,
        recommended_action: claim.recommended_action,
        policy_id: claim.policy_id.clone(),
        policy_version: claim.policy_version,
        extraction_confidence: claim.extraction_confidence,
        resolution_confidence: claim.resolution_confidence,
        claim_confidence: claim.claim_confidence,
        evidence: claim.evidence.iter().map(export_evidence).collect(),
        corrections: claim.corrections.clone(),
        created_at_unix_ms: claim.created_at_unix_ms,
        updated_at_unix_ms: claim.updated_at_unix_ms,
    }
}

/// Reject a claim whose ID has no destination mapping rather than import it
/// under its stale source ID: `ClaimRecord::id` is derived
/// (`semantic_extraction::stable_claim_id`) from the *session* that produced
/// it, so keeping the old ID after the session is remapped would silently
/// point the claim at an identity that no longer matches its own snapshot.
fn import_claim(
    portable: PortableClaimV1,
    claim_ids: &BTreeMap<String, String>,
    document_ids: &BTreeMap<String, String>,
) -> Result<ClaimRecord, ArchiveError> {
    let id = remap(&portable.id, claim_ids)?;
    let evidence = portable
        .evidence
        .into_iter()
        .map(|e| import_evidence(e, document_ids))
        .collect::<Result<_, _>>()?;
    Ok(ClaimRecord {
        id,
        source_segment_ids: portable.source_segment_ids,
        speaker_side: portable.speaker_side,
        speaker_label: portable.speaker_label,
        exact_quote: portable.exact_quote,
        normalized_proposition: portable.normalized_proposition,
        predicate: portable.predicate,
        subject: portable.subject,
        object: portable.object,
        frame_kind: portable.frame_kind,
        attribution_chain: portable.attribution_chain,
        qualifiers: portable.qualifiers,
        references: portable.references,
        modality: portable.modality,
        negated: portable.negated,
        sensitivity: portable.sensitivity,
        consequence: portable.consequence,
        importance_reasons: portable.importance_reasons,
        state: portable.state,
        recommended_action: portable.recommended_action,
        policy_id: portable.policy_id,
        policy_version: portable.policy_version,
        extraction_confidence: portable.extraction_confidence,
        resolution_confidence: portable.resolution_confidence,
        claim_confidence: portable.claim_confidence,
        evidence,
        corrections: portable.corrections,
        created_at_unix_ms: portable.created_at_unix_ms,
        updated_at_unix_ms: portable.updated_at_unix_ms,
    })
}

/// MAINTENANCE: audit alongside `ClaimSnapshotEvent`. `session_id` is
/// remapped; `contract_version` is intentionally NOT carried on the wire —
/// see [`export_claim_snapshot`].
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PortableClaimSnapshotV1 {
    pub session_id: String,
    pub epoch: u64,
    pub revision: u64,
    #[serde(default)]
    pub claims: Vec<PortableClaimV1>,
}

/// `ClaimSnapshotEvent::contract_version` gates live-session claim-matching
/// compatibility, not archive portability. Exporting only the current
/// contract version (rejecting anything else, which the app itself should
/// never produce — `normalize_claim_linkage` already enforces this at save
/// time) and reconstructing the constant on import means a future contract
/// bump can't silently smuggle a stale version through a `.cva` file.
fn export_claim_snapshot(
    snapshot: &ClaimSnapshotEvent,
) -> Result<PortableClaimSnapshotV1, ArchiveError> {
    if snapshot.contract_version != CLAIM_SNAPSHOT_CONTRACT_VERSION {
        return Err(ArchiveError::InvalidManifest(
            "unsupported claim snapshot contract version",
        ));
    }
    Ok(PortableClaimSnapshotV1 {
        session_id: snapshot.session_id.clone(),
        epoch: snapshot.epoch,
        revision: snapshot.revision,
        claims: snapshot.claims.iter().map(export_claim).collect(),
    })
}

fn import_claim_snapshot(
    portable: PortableClaimSnapshotV1,
    ids: &ConversationImportIds,
) -> Result<ClaimSnapshotEvent, ArchiveError> {
    let session_id = remap(&portable.session_id, &ids.session_ids)?;
    let claims = portable
        .claims
        .into_iter()
        .map(|c| import_claim(c, &ids.claim_ids, &ids.document_ids))
        .collect::<Result<_, _>>()?;
    Ok(ClaimSnapshotEvent {
        contract_version: CLAIM_SNAPSHOT_CONTRACT_VERSION,
        session_id,
        epoch: portable.epoch,
        revision: portable.revision,
        claims,
    })
}

/// V1's intentionally explicit allowlist for a saved conversation. Never add
/// a filesystem path, device/account identifier, or raw audio reference. A
/// field newly added to `Conversation` must be consciously included with a
/// default/migration or consciously excluded — see module docs.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PortableConversationV1 {
    pub id: String,
    pub title: String,
    pub created_at_unix_ms: u64,
    pub updated_at_unix_ms: u64,
    pub segments: Vec<PortableTranscriptSegmentV1>,
    #[serde(default)]
    pub linked_docs: Vec<String>,
    #[serde(default)]
    pub linked_context_id: Option<String>,
    #[serde(default)]
    pub source_session_ids: Vec<String>,
    #[serde(default)]
    pub claim_snapshots: Vec<PortableClaimSnapshotV1>,
}

/// Plain field values pulled out of `src-tauri`'s `Conversation` for export.
/// A borrowed mirror of that struct's shape, not a re-export of it — see the
/// module-level architecture note.
pub struct ConversationExportInput<'a> {
    pub id: &'a str,
    pub title: &'a str,
    pub created_at_unix_ms: u64,
    pub updated_at_unix_ms: u64,
    pub segments: &'a [TranscriptSegment],
    pub linked_docs: &'a [String],
    pub linked_context_id: Option<&'a str>,
    pub source_session_ids: &'a [String],
    pub claim_snapshots: &'a [ClaimSnapshotEvent],
}

/// Owned field values a shell adapter reassembles into a `Conversation`
/// after import. Deliberately the same shape as
/// [`ConversationExportInput`] rather than that struct's owned twin, so a
/// caller must explicitly map each field into its own persistence type.
pub struct ImportedConversation {
    pub id: String,
    pub title: String,
    pub created_at_unix_ms: u64,
    pub updated_at_unix_ms: u64,
    pub segments: Vec<TranscriptSegment>,
    pub linked_docs: Vec<String>,
    pub linked_context_id: Option<String>,
    pub source_session_ids: Vec<String>,
    pub claim_snapshots: Vec<ClaimSnapshotEvent>,
}

/// Check relationships before allocating or writing destination records, and
/// before trusting untrusted imported data. Mirrors the invariants
/// `src-tauri::conversations::normalize_claim_linkage` enforces at save
/// time, since import bypasses that function entirely.
pub fn validate_conversation_references(p: &PortableConversationV1) -> Result<(), ArchiveError> {
    if p.id.trim().is_empty() || p.title.trim().is_empty() {
        return Err(ArchiveError::InvalidManifest("empty conversation identity"));
    }
    let mut sessions = BTreeSet::new();
    for id in &p.source_session_ids {
        if id.trim().is_empty() || !sessions.insert(id.as_str()) {
            return Err(ArchiveError::InvalidManifest(
                "invalid or duplicate source session id",
            ));
        }
    }
    let mut snapshot_sessions = BTreeSet::new();
    for snapshot in &p.claim_snapshots {
        if snapshot.session_id.trim().is_empty()
            || !sessions.contains(snapshot.session_id.as_str())
            || !snapshot_sessions.insert(snapshot.session_id.as_str())
        {
            return Err(ArchiveError::InvalidManifest(
                "claim snapshot is not linked to exactly one declared source session",
            ));
        }
        let mut claim_ids = BTreeSet::new();
        for claim in &snapshot.claims {
            if claim.id.trim().is_empty() || !claim_ids.insert(claim.id.as_str()) {
                return Err(ArchiveError::InvalidManifest(
                    "invalid or duplicate claim id in snapshot",
                ));
            }
        }
    }
    Ok(())
}

/// All document IDs a conversation references: linked library documents plus
/// every claim's evidence-linked document. Callers cross-check this against
/// the archive's declared document index before persisting anything.
pub fn conversation_document_ids(p: &PortableConversationV1) -> BTreeSet<&str> {
    let mut ids: BTreeSet<&str> = p.linked_docs.iter().map(String::as_str).collect();
    for snapshot in &p.claim_snapshots {
        for claim in &snapshot.claims {
            for evidence in &claim.evidence {
                if let Some(doc_id) = &evidence.local_document_id {
                    ids.insert(doc_id.as_str());
                }
            }
        }
    }
    ids
}

/// MAINTENANCE: audit this allowlist whenever `Conversation`'s own fields
/// evolve. `include_context_link` lets the caller omit
/// `linked_context_id` when the Context is not part of this export scope,
/// per spec §2.4/§8.2 (transcript-only vs. conversation+Context exports).
pub fn export_conversation(
    input: ConversationExportInput<'_>,
    include_context_link: bool,
) -> Result<PortableConversationV1, ArchiveError> {
    let portable = PortableConversationV1 {
        id: input.id.to_owned(),
        title: input.title.to_owned(),
        created_at_unix_ms: input.created_at_unix_ms,
        updated_at_unix_ms: input.updated_at_unix_ms,
        segments: input
            .segments
            .iter()
            .map(export_transcript_segment)
            .collect(),
        linked_docs: input.linked_docs.to_vec(),
        linked_context_id: if include_context_link {
            input.linked_context_id.map(str::to_owned)
        } else {
            None
        },
        source_session_ids: input.source_session_ids.to_vec(),
        claim_snapshots: input
            .claim_snapshots
            .iter()
            .map(export_claim_snapshot)
            .collect::<Result<_, _>>()?,
    };
    validate_conversation_references(&portable)?;
    Ok(portable)
}

/// MAINTENANCE: mirror every new export field here. Reject missing mappings;
/// never leave a portable session/claim/document ID in a destination record.
pub fn import_conversation(
    portable: PortableConversationV1,
    ids: &ConversationImportIds,
) -> Result<ImportedConversation, ArchiveError> {
    validate_conversation_references(&portable)?;
    if ids.conversation_id.trim().is_empty() || ids.conversation_id == portable.id {
        return Err(ArchiveError::InvalidManifest(
            "invalid destination conversation ID",
        ));
    }
    if portable.linked_context_id.is_some() != ids.context_id.is_some() {
        return Err(ArchiveError::InvalidManifest(
            "context link mapping mismatch",
        ));
    }
    if portable
        .linked_context_id
        .as_ref()
        .zip(ids.context_id.as_ref())
        .is_some_and(|(old, new)| new.trim().is_empty() || old == new)
    {
        return Err(ArchiveError::InvalidManifest(
            "invalid destination context ID",
        ));
    }
    let linked_docs = portable
        .linked_docs
        .iter()
        .map(|id| remap(id, &ids.document_ids))
        .collect::<Result<_, _>>()?;
    let source_session_ids = portable
        .source_session_ids
        .iter()
        .map(|id| remap(id, &ids.session_ids))
        .collect::<Result<_, _>>()?;
    let claim_snapshots = portable
        .claim_snapshots
        .into_iter()
        .map(|s| import_claim_snapshot(s, ids))
        .collect::<Result<_, _>>()?;
    Ok(ImportedConversation {
        id: ids.conversation_id.clone(),
        title: portable.title,
        created_at_unix_ms: portable.created_at_unix_ms,
        updated_at_unix_ms: portable.updated_at_unix_ms,
        segments: portable
            .segments
            .into_iter()
            .map(import_transcript_segment)
            .collect(),
        linked_docs,
        linked_context_id: ids.context_id.clone(),
        source_session_ids,
        claim_snapshots,
    })
}

/// When one archive bundles a Context and a linked conversation (spec §2.4:
/// "conversation plus Context"), both halves must agree on the destination
/// IDs that tie them together: `context.conversation_id` and
/// `conversation.context_id` name the same pair of records from opposite
/// sides. Call this before persisting either side. Namespaces stay distinct
/// even here — a context ID is compared only against another context ID, a
/// conversation ID only against another conversation ID.
pub fn validate_paired_import_ids(
    context: &crate::archive_payload::ContextImportIds,
    conversation: &ConversationImportIds,
) -> Result<(), ArchiveError> {
    let context_agrees = conversation
        .context_id
        .as_deref()
        .is_none_or(|id| id == context.context_id);
    let conversation_agrees = context
        .conversation_id
        .as_deref()
        .is_none_or(|id| id == conversation.conversation_id);
    if !context_agrees || !conversation_agrees {
        return Err(ArchiveError::InvalidManifest(
            "Context and conversation import IDs disagree on their link",
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::claim::ClaimCorrectionKind;
    use crate::evidence::QualityAssessment;

    fn segment(side: StreamSide, seq: u64, text: &str) -> TranscriptSegment {
        TranscriptSegment {
            side,
            seq,
            text: text.into(),
            is_final: true,
            start_ms: seq * 1000,
            end_ms: seq * 1000 + 500,
            confidence: Some(0.9),
            latency_ms: 42,
        }
    }

    fn quality() -> EvidenceQuality {
        EvidenceQuality {
            authority: QualityAssessment::Strong,
            directness: QualityAssessment::Strong,
            specificity: QualityAssessment::Adequate,
            freshness: QualityAssessment::Adequate,
            independence: QualityAssessment::Adequate,
            completeness: QualityAssessment::Adequate,
            provenance: QualityAssessment::Strong,
        }
    }

    fn claim(id: &str) -> ClaimRecord {
        ClaimRecord {
            id: id.into(),
            source_segment_ids: vec!["inbound:1".into()],
            speaker_side: StreamSide::Inbound,
            speaker_label: Some("Guest".into()),
            exact_quote: "The boat had 7 people".into(),
            normalized_proposition: "the boat had 7 people".into(),
            predicate: "had".into(),
            subject: Some("the boat".into()),
            object: None,
            frame_kind: FrameKind::Claim,
            attribution_chain: vec![],
            qualifiers: vec![],
            references: vec![],
            modality: Modality::Asserted,
            negated: false,
            sensitivity: Sensitivity::Public,
            consequence: Consequence::High,
            importance_reasons: vec![ImportanceReason::SpecificAndCheckable],
            state: ClaimState::Supported,
            recommended_action: Some(SuggestedAction::Verify),
            policy_id: "default-live-stream".into(),
            policy_version: 1,
            extraction_confidence: Confidence::High,
            resolution_confidence: Confidence::High,
            claim_confidence: Some(ClaimConfidence::Strong),
            evidence: vec![EvidenceRecord {
                source_id: "src-1".into(),
                source_class: SourceClass::ContextDocument,
                publisher: "Case file".into(),
                title: "Incident report".into(),
                url: None,
                local_document_id: Some("doc-old".into()),
                excerpt: "seven people were aboard".into(),
                addressed_claim_part: "the underlying proposition".into(),
                scope: EvidenceScope::UnderlyingProposition,
                stance: EvidenceStance::Supports,
                quality: quality(),
                independence_group: Some("case-file".into()),
                admission: AdmissionDecision::Admitted,
                admission_policy_id: "default-live-stream".into(),
                admission_policy_version: 1,
                published_at_unix_ms: Some(10),
                retrieved_at_unix_ms: 11,
            }],
            corrections: vec![ClaimCorrection {
                kind: ClaimCorrectionKind::Proposition,
                previous_value: "the boat had 8 people".into(),
                corrected_value: "the boat had 7 people".into(),
                corrected_by: "user".into(),
                created_at_unix_ms: 12,
            }],
            created_at_unix_ms: 1,
            updated_at_unix_ms: 2,
        }
    }

    fn sample_conversation() -> (Vec<TranscriptSegment>, Vec<ClaimSnapshotEvent>) {
        let segments = vec![
            segment(StreamSide::Outbound, 0, "Tell me what happened"),
            segment(StreamSide::Inbound, 1, "The boat had 7 people"),
        ];
        let snapshots = vec![ClaimSnapshotEvent {
            contract_version: CLAIM_SNAPSHOT_CONTRACT_VERSION,
            session_id: "session-old".into(),
            epoch: 0,
            revision: 1,
            claims: vec![claim("claim-old")],
        }];
        (segments, snapshots)
    }

    fn ids() -> ConversationImportIds {
        ConversationImportIds {
            conversation_id: "conv-new".into(),
            document_ids: BTreeMap::from([("doc-old".into(), "doc-new".into())]),
            session_ids: BTreeMap::from([("session-old".into(), "session-new".into())]),
            claim_ids: BTreeMap::from([("claim-old".into(), "claim-new".into())]),
            context_id: Some("ctx-new".into()),
        }
    }

    #[test]
    fn portable_conversation_round_trips_and_remaps_every_reference() {
        let (segments, snapshots) = sample_conversation();
        let input = ConversationExportInput {
            id: "conv-old",
            title: "Nolan Wells Case",
            created_at_unix_ms: 100,
            updated_at_unix_ms: 200,
            segments: &segments,
            linked_docs: &["doc-old".to_string()],
            linked_context_id: Some("ctx-old"),
            source_session_ids: &["session-old".to_string()],
            claim_snapshots: &snapshots,
        };
        let portable = export_conversation(input, true).unwrap();
        let wire = serde_json::to_string(&portable).unwrap();
        assert!(!wire.contains("conv-new"));
        assert!(!wire.contains("contract_version"));
        let decoded: PortableConversationV1 = serde_json::from_str(&wire).unwrap();

        let imported = import_conversation(decoded, &ids()).unwrap();
        assert_eq!(imported.id, "conv-new");
        assert_eq!(imported.linked_docs, ["doc-new"]);
        assert_eq!(imported.linked_context_id.as_deref(), Some("ctx-new"));
        assert_eq!(imported.source_session_ids, ["session-new"]);
        assert_eq!(imported.segments.len(), 2);
        assert_eq!(imported.claim_snapshots.len(), 1);
        let snapshot = &imported.claim_snapshots[0];
        assert_eq!(snapshot.session_id, "session-new");
        assert_eq!(snapshot.contract_version, CLAIM_SNAPSHOT_CONTRACT_VERSION);
        let claim = &snapshot.claims[0];
        assert_eq!(claim.id, "claim-new");
        assert_eq!(
            claim.evidence[0].local_document_id.as_deref(),
            Some("doc-new")
        );
        // Corrections and speaker attribution survive untouched.
        assert_eq!(claim.corrections.len(), 1);
        assert_eq!(claim.speaker_label.as_deref(), Some("Guest"));
        assert_eq!(claim.speaker_side, StreamSide::Inbound);
        // Content-derived segment references are not remapped.
        assert_eq!(claim.source_segment_ids, ["inbound:1"]);
    }

    #[test]
    fn transcript_only_export_omits_the_context_link() {
        let (segments, snapshots) = sample_conversation();
        let input = ConversationExportInput {
            id: "conv-old",
            title: "Transcript only",
            created_at_unix_ms: 1,
            updated_at_unix_ms: 2,
            segments: &segments,
            linked_docs: &[],
            linked_context_id: Some("ctx-old"),
            source_session_ids: &["session-old".to_string()],
            claim_snapshots: &snapshots,
        };
        let portable = export_conversation(input, false).unwrap();
        assert_eq!(portable.linked_context_id, None);
        let mut ids = ids();
        ids.context_id = None;
        let imported = import_conversation(portable, &ids).unwrap();
        assert_eq!(imported.linked_context_id, None);
    }

    #[test]
    fn missing_session_or_claim_mapping_fails_before_import() {
        let (segments, snapshots) = sample_conversation();
        let input = ConversationExportInput {
            id: "conv-old",
            title: "Case",
            created_at_unix_ms: 1,
            updated_at_unix_ms: 2,
            segments: &segments,
            linked_docs: &[],
            linked_context_id: None,
            source_session_ids: &["session-old".to_string()],
            claim_snapshots: &snapshots,
        };
        let portable = export_conversation(input, false).unwrap();

        let mut missing_session = ids();
        missing_session.session_ids.clear();
        missing_session.context_id = None;
        assert!(import_conversation(portable.clone(), &missing_session).is_err());

        let mut missing_claim = ids();
        missing_claim.claim_ids.clear();
        missing_claim.context_id = None;
        assert!(import_conversation(portable.clone(), &missing_claim).is_err());

        let mut missing_doc = ids();
        missing_doc.document_ids.clear();
        missing_doc.context_id = None;
        assert!(import_conversation(portable, &missing_doc).is_err());
    }

    #[test]
    fn claim_snapshot_linked_to_undeclared_session_is_rejected() {
        let mut portable = PortableConversationV1 {
            id: "conv-old".into(),
            title: "Case".into(),
            created_at_unix_ms: 1,
            updated_at_unix_ms: 2,
            segments: vec![],
            linked_docs: vec![],
            linked_context_id: None,
            source_session_ids: vec!["session-a".into()],
            claim_snapshots: vec![PortableClaimSnapshotV1 {
                session_id: "session-b".into(),
                epoch: 0,
                revision: 1,
                claims: vec![],
            }],
        };
        assert!(validate_conversation_references(&portable).is_err());
        portable.claim_snapshots[0].session_id = "session-a".into();
        assert!(validate_conversation_references(&portable).is_ok());
    }

    #[test]
    fn wrong_contract_version_snapshot_cannot_be_exported() {
        let mut bad = ClaimSnapshotEvent {
            contract_version: CLAIM_SNAPSHOT_CONTRACT_VERSION + 1,
            session_id: "session-old".into(),
            epoch: 0,
            revision: 1,
            claims: vec![],
        };
        assert!(export_claim_snapshot(&bad).is_err());
        bad.contract_version = CLAIM_SNAPSHOT_CONTRACT_VERSION;
        assert!(export_claim_snapshot(&bad).is_ok());
    }

    #[test]
    fn conversation_document_ids_covers_linked_docs_and_evidence() {
        let (_, snapshots) = sample_conversation();
        let portable = PortableConversationV1 {
            id: "conv-old".into(),
            title: "Case".into(),
            created_at_unix_ms: 1,
            updated_at_unix_ms: 2,
            segments: vec![],
            linked_docs: vec!["doc-linked".into()],
            linked_context_id: None,
            source_session_ids: vec!["session-old".into()],
            claim_snapshots: snapshots
                .iter()
                .map(export_claim_snapshot)
                .collect::<Result<_, _>>()
                .unwrap(),
        };
        let ids = conversation_document_ids(&portable);
        assert!(ids.contains("doc-linked"));
        assert!(ids.contains("doc-old"));
    }

    #[test]
    fn paired_context_and_conversation_ids_must_agree_on_their_link() {
        use crate::archive_payload::ContextImportIds;

        let context = ContextImportIds {
            context_id: "ctx-new".into(),
            document_ids: BTreeMap::new(),
            profile_id: None,
            conversation_id: Some("conv-new".into()),
        };
        let mut conversation = ids();
        assert!(validate_paired_import_ids(&context, &conversation).is_ok());

        conversation.context_id = Some("ctx-wrong".into());
        assert!(validate_paired_import_ids(&context, &conversation).is_err());

        conversation.context_id = Some("ctx-new".into());
        let mut mismatched_context = context;
        mismatched_context.conversation_id = Some("conv-wrong".into());
        assert!(validate_paired_import_ids(&mismatched_context, &conversation).is_err());
    }
}

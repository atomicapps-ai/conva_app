//! Explicit portable Context DTO conversion for `.cva` v1.
//!
//! MAINTENANCE: When `ConversationContext` or `KnowledgeProfile` changes,
//! review BOTH conversion directions, every document/persona/profile reference,
//! privacy exclusions, v1 fixture compatibility, and schema migrations. Never
//! derive this DTO by serializing a persistence record wholesale. See the
//! conva_core `.cva` spec and implementation handoff.

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};

use crate::archive::ArchiveError;
use crate::context::{
    ContextCategory, ContextPersona, ContextStatus, ConversationContext, KnowledgeProfile,
    ResearchSource, SuggestionDecision,
};
use crate::context_snapshot::ParticipationLens;
use crate::rag::{DocSource, RagDocument};
use crate::source_policy::SourcePolicy;

/// Document IDs are archive-local relationship keys. Every referenced source
/// and generated document must have a destination ID; missing bytes are a
/// separate import-preview decision, not permission to keep an old ID.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct ContextImportIds {
    pub context_id: String,
    pub document_ids: BTreeMap<String, String>,
    pub profile_id: Option<String>,
    pub conversation_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PortableKnowledgeProfileV1 {
    pub id: String,
    pub title: String,
    pub created_at_unix_ms: u64,
    pub updated_at_unix_ms: u64,
    pub doc_ids: Vec<String>,
    pub research: Vec<ResearchSource>,
    pub ready: bool,
}

/// V1's intentionally explicit allowlist. Never add credentials, local paths,
/// process state or library caches. A field newly added to the app model must
/// be consciously included with a default/migration or consciously excluded.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PortableContextV1 {
    pub id: String,
    pub title: String,
    pub purpose: String,
    #[serde(default)]
    pub job_description: Option<String>,
    pub category: ContextCategory,
    #[serde(default)]
    pub participation_lens: Option<ParticipationLens>,
    #[serde(default)]
    pub source_policy: Option<SourcePolicy>,
    pub created_at_unix_ms: u64,
    pub updated_at_unix_ms: u64,
    #[serde(default)]
    pub source_doc_ids: Vec<String>,
    #[serde(default)]
    pub slot_doc_ids: BTreeMap<String, Vec<String>>,
    #[serde(default)]
    pub auto_generate_context: bool,
    #[serde(default)]
    pub research_enabled: bool,
    #[serde(default)]
    pub deep_qa_enabled: bool,
    #[serde(default)]
    pub key_terms: Vec<String>,
    #[serde(default)]
    pub glossary: Vec<String>,
    #[serde(default)]
    pub glossary_definitions: BTreeMap<String, String>,
    #[serde(default)]
    pub knowledge_profile: Option<PortableKnowledgeProfileV1>,
    #[serde(default)]
    pub personas: Vec<ContextPersona>,
    #[serde(default)]
    pub chosen_persona_id: Option<String>,
    #[serde(default)]
    pub conversation_id: Option<String>,
    #[serde(default)]
    pub dossier_doc_id: Option<String>,
    #[serde(default)]
    pub research_doc_id: Option<String>,
    #[serde(default)]
    pub qa_doc_id: Option<String>,
    #[serde(default)]
    pub resources_stale: bool,
    #[serde(default)]
    pub resources_generated_at_unix_ms: Option<u64>,
    #[serde(default)]
    pub suggestion_decisions: BTreeMap<String, SuggestionDecision>,
}

/// Explicit metadata for a referenced Library item. `archive_path = None`
/// means the source bytes were intentionally omitted; import must not claim
/// the document is searchable until bytes/text are ingested normally.
/// MAINTENANCE: audit this allowlist when `RagDocument` changes; never export
/// its local storage path, retrieval index, or a foreign Context association.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PortableDocumentV1 {
    pub id: String,
    pub file_name: String,
    pub source: DocSource,
    pub enabled: bool,
    pub searchable: bool,
    pub ingested_at_unix_ms: u64,
    pub archive_path: Option<String>,
    pub bytes: Option<u64>,
    pub sha256: Option<String>,
}

/// Generated review/grounding text is a distinct artifact even when the app
/// stores it as a `RagDocument`. The text is present in `generated/files` only
/// when its archive entry is declared and verified by the ZIP reader.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PortableGeneratedArtifactV1 {
    pub document_id: String,
    pub kind: GeneratedArtifactKind,
    pub archive_path: String,
    pub created_at_unix_ms: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GeneratedArtifactKind {
    Dossier,
    Research,
    PreparedQa,
}

/// File bytes and their SHA-256 come from the platform writer; metadata-only
/// exports deliberately have none. Do not infer MIME/type from the filename
/// here—the document ingestion policy validates that during import.
pub fn export_document_metadata(
    document: &RagDocument,
    included: Option<(u64, String)>,
) -> PortableDocumentV1 {
    let (archive_path, bytes, sha256) = match included {
        Some((bytes, digest)) => (
            Some(format!("documents/files/{}", document.id)),
            Some(bytes),
            Some(digest),
        ),
        None => (None, None, None),
    };
    PortableDocumentV1 {
        id: document.id.clone(),
        file_name: document.file_name.clone(),
        source: document.source,
        enabled: document.enabled,
        searchable: document.searchable,
        ingested_at_unix_ms: document.ingested_at_unix_ms,
        archive_path,
        bytes,
        sha256,
    }
}

/// Index validation runs before importing any source bytes. The ZIP validator
/// separately checks the declared file entry's size/hash against actual bytes.
pub fn validate_document_index(
    context: &PortableContextV1,
    documents: &[PortableDocumentV1],
    artifacts: &[PortableGeneratedArtifactV1],
) -> Result<(), ArchiveError> {
    validate_context_references(context)?;
    let mut all_refs: BTreeSet<&str> = context.source_doc_ids.iter().map(String::as_str).collect();
    for id in [
        &context.dossier_doc_id,
        &context.research_doc_id,
        &context.qa_doc_id,
    ]
    .into_iter()
    .flatten()
    {
        all_refs.insert(id);
    }
    if let Some(profile) = &context.knowledge_profile {
        all_refs.extend(profile.doc_ids.iter().map(String::as_str));
    }
    let mut seen = BTreeSet::new();
    for doc in documents {
        if doc.id.trim().is_empty()
            || doc.file_name.trim().is_empty()
            || !seen.insert(doc.id.as_str())
        {
            return Err(ArchiveError::InvalidManifest(
                "invalid or duplicate document",
            ));
        }
        let expected = format!("documents/files/{}", doc.id);
        if doc
            .archive_path
            .as_deref()
            .is_some_and(|path| path != expected)
            || doc.archive_path.is_some() != (doc.bytes.is_some() && doc.sha256.is_some())
        {
            return Err(ArchiveError::InvalidManifest(
                "invalid document file metadata",
            ));
        }
        if let Some(path) = &doc.archive_path {
            crate::archive::validate_path(path)?;
        }
        if let Some(digest) = &doc.sha256 {
            if digest.len() != 64
                || !digest
                    .bytes()
                    .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
            {
                return Err(ArchiveError::InvalidManifest("invalid document digest"));
            }
        }
    }
    let mut artifact_ids = BTreeSet::new();
    for artifact in artifacts {
        if !artifact_ids.insert(artifact.document_id.as_str())
            || !all_refs.contains(artifact.document_id.as_str())
        {
            return Err(ArchiveError::InvalidManifest(
                "unlinked or duplicate generated artifact",
            ));
        }
        let expected = format!("generated/files/{}.md", artifact.document_id);
        if artifact.archive_path != expected || !seen.contains(artifact.document_id.as_str()) {
            return Err(ArchiveError::InvalidManifest(
                "invalid generated artifact reference",
            ));
        }
        crate::archive::validate_path(&artifact.archive_path)?;
    }
    if !all_refs.iter().all(|id| seen.contains(id)) {
        return Err(ArchiveError::InvalidManifest("unlisted Context document"));
    }
    Ok(())
}

/// MAINTENANCE: audit this allowlist whenever Context/Profile fields evolve.
/// Caller supplies the profile; absence when the Context references one is an
/// error, never a silent loss of research or document relationships.
pub fn export_context(
    context: &ConversationContext,
    profile: Option<&KnowledgeProfile>,
) -> Result<PortableContextV1, ArchiveError> {
    if context.knowledge_profile_id.as_deref() != profile.map(|p| p.id.as_str()) {
        return Err(ArchiveError::InvalidManifest("Context profile mismatch"));
    }
    let portable = PortableContextV1 {
        id: context.id.clone(),
        title: context.title.clone(),
        purpose: context.purpose.clone(),
        job_description: context.job_description.clone(),
        category: context.category,
        participation_lens: context.participation_lens,
        source_policy: context.source_policy.clone(),
        created_at_unix_ms: context.created_at_unix_ms,
        updated_at_unix_ms: context.updated_at_unix_ms,
        source_doc_ids: context.source_doc_ids.clone(),
        slot_doc_ids: context.slot_doc_ids.clone(),
        auto_generate_context: context.auto_generate_context,
        research_enabled: context.research_enabled,
        deep_qa_enabled: context.deep_qa_enabled,
        key_terms: context.key_terms.clone(),
        glossary: context.glossary.clone(),
        glossary_definitions: context.glossary_definitions.clone(),
        knowledge_profile: profile.map(|p| PortableKnowledgeProfileV1 {
            id: p.id.clone(),
            title: p.title.clone(),
            created_at_unix_ms: p.created_at_unix_ms,
            updated_at_unix_ms: p.updated_at_unix_ms,
            doc_ids: p.doc_ids.clone(),
            research: p.research.clone(),
            ready: p.ready,
        }),
        personas: context.personas.clone(),
        chosen_persona_id: context.chosen_persona_id.clone(),
        conversation_id: context.conversation_id.clone(),
        dossier_doc_id: context.dossier_doc_id.clone(),
        research_doc_id: context.research_doc_id.clone(),
        qa_doc_id: context.qa_doc_id.clone(),
        resources_stale: context.resources_stale,
        resources_generated_at_unix_ms: context.resources_generated_at_unix_ms,
        suggestion_decisions: context.suggestion_decisions.clone(),
    };
    validate_context_references(&portable)?;
    Ok(portable)
}

/// Check relationships before allocating or writing destination records.
pub fn validate_context_references(p: &PortableContextV1) -> Result<(), ArchiveError> {
    if p.id.trim().is_empty() || p.title.trim().is_empty() {
        return Err(ArchiveError::InvalidManifest("empty Context identity"));
    }
    if p.chosen_persona_id
        .as_ref()
        .is_some_and(|id| !p.personas.iter().any(|persona| &persona.id == id))
    {
        return Err(ArchiveError::InvalidManifest("unknown chosen persona"));
    }
    for docs in p.slot_doc_ids.values() {
        if docs.iter().any(|id| !p.source_doc_ids.contains(id)) {
            return Err(ArchiveError::InvalidManifest(
                "slot document absent from sources",
            ));
        }
    }
    if p.knowledge_profile
        .as_ref()
        .is_some_and(|profile| profile.id.trim().is_empty())
    {
        return Err(ArchiveError::InvalidManifest("empty profile ID"));
    }
    Ok(())
}

fn remap(id: &str, ids: &BTreeMap<String, String>) -> Result<String, ArchiveError> {
    ids.get(id)
        .filter(|new| !new.trim().is_empty() && new.as_str() != id)
        .cloned()
        .ok_or(ArchiveError::InvalidManifest("unmapped document ID"))
}

fn remap_optional(
    id: &Option<String>,
    ids: &BTreeMap<String, String>,
) -> Result<Option<String>, ArchiveError> {
    id.as_deref().map(|id| remap(id, ids)).transpose()
}

/// MAINTENANCE: mirror every new export field here. Reject missing mappings;
/// never leave portable IDs in live records, even in profile or slot lists.
pub fn import_context(
    portable: PortableContextV1,
    ids: &ContextImportIds,
) -> Result<(ConversationContext, Option<KnowledgeProfile>), ArchiveError> {
    validate_context_references(&portable)?;
    if ids.context_id.trim().is_empty() || ids.context_id == portable.id {
        return Err(ArchiveError::InvalidManifest(
            "invalid destination Context ID",
        ));
    }
    let mut all_doc_ids = portable.source_doc_ids.clone();
    all_doc_ids.extend(portable.slot_doc_ids.values().flatten().cloned());
    all_doc_ids.extend(
        [
            portable.dossier_doc_id.clone(),
            portable.research_doc_id.clone(),
            portable.qa_doc_id.clone(),
        ]
        .into_iter()
        .flatten(),
    );
    if let Some(profile) = &portable.knowledge_profile {
        all_doc_ids.extend(profile.doc_ids.iter().cloned());
    }
    let unique_docs: BTreeSet<_> = all_doc_ids.iter().cloned().collect();
    let mapped_docs: BTreeSet<_> = unique_docs
        .iter()
        .map(|id| remap(id, &ids.document_ids))
        .collect::<Result<_, _>>()?;
    if unique_docs.len() != mapped_docs.len() {
        return Err(ArchiveError::InvalidManifest(
            "duplicate destination document ID",
        ));
    }
    for id in &all_doc_ids {
        remap(id, &ids.document_ids)?;
    }
    let profile = portable
        .knowledge_profile
        .map(|p| -> Result<_, ArchiveError> {
            let new_id = ids
                .profile_id
                .as_ref()
                .filter(|id| !id.trim().is_empty() && **id != p.id)
                .ok_or(ArchiveError::InvalidManifest(
                    "missing destination profile ID",
                ))?;
            Ok(KnowledgeProfile {
                id: new_id.clone(),
                title: p.title,
                created_at_unix_ms: p.created_at_unix_ms,
                updated_at_unix_ms: p.updated_at_unix_ms,
                doc_ids: p
                    .doc_ids
                    .iter()
                    .map(|id| remap(id, &ids.document_ids))
                    .collect::<Result<_, _>>()?,
                research: p.research,
                ready: p.ready,
            })
        })
        .transpose()?;
    if portable.conversation_id.is_some() != ids.conversation_id.is_some() {
        return Err(ArchiveError::InvalidManifest(
            "conversation mapping mismatch",
        ));
    }
    if portable
        .conversation_id
        .as_ref()
        .zip(ids.conversation_id.as_ref())
        .is_some_and(|(old, new)| new.trim().is_empty() || old == new)
    {
        return Err(ArchiveError::InvalidManifest(
            "invalid destination conversation ID",
        ));
    }
    let status = if portable.dossier_doc_id.is_some() && profile.as_ref().is_some_and(|p| p.ready) {
        ContextStatus::Ready
    } else {
        ContextStatus::Draft
    };
    let context = ConversationContext {
        id: ids.context_id.clone(),
        title: portable.title,
        purpose: portable.purpose,
        job_description: portable.job_description,
        category: portable.category,
        participation_lens: portable.participation_lens,
        source_policy: portable.source_policy,
        status,
        created_at_unix_ms: portable.created_at_unix_ms,
        updated_at_unix_ms: portable.updated_at_unix_ms,
        source_doc_ids: portable
            .source_doc_ids
            .iter()
            .map(|id| remap(id, &ids.document_ids))
            .collect::<Result<_, _>>()?,
        slot_doc_ids: portable
            .slot_doc_ids
            .into_iter()
            .map(|(slot, docs)| {
                Ok((
                    slot,
                    docs.iter()
                        .map(|id| remap(id, &ids.document_ids))
                        .collect::<Result<_, _>>()?,
                ))
            })
            .collect::<Result<_, ArchiveError>>()?,
        auto_generate_context: portable.auto_generate_context,
        research_enabled: portable.research_enabled,
        deep_qa_enabled: portable.deep_qa_enabled,
        key_terms: portable.key_terms,
        glossary: portable.glossary,
        glossary_definitions: portable.glossary_definitions,
        knowledge_profile_id: profile.as_ref().map(|p| p.id.clone()),
        personas: portable.personas,
        chosen_persona_id: portable.chosen_persona_id,
        conversation_id: ids.conversation_id.clone(),
        dossier_doc_id: remap_optional(&portable.dossier_doc_id, &ids.document_ids)?,
        research_doc_id: remap_optional(&portable.research_doc_id, &ids.document_ids)?,
        qa_doc_id: remap_optional(&portable.qa_doc_id, &ids.document_ids)?,
        resources_stale: portable.resources_stale,
        resources_generated_at_unix_ms: portable.resources_generated_at_unix_ms,
        suggestion_decisions: portable.suggestion_decisions,
    };
    Ok((context, profile))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::context::{SuggestionDecision, SuggestionDecisionStatus};

    fn sample() -> (ConversationContext, KnowledgeProfile) {
        let profile = KnowledgeProfile {
            id: "kp-old".into(),
            title: "Case".into(),
            created_at_unix_ms: 1,
            updated_at_unix_ms: 2,
            doc_ids: vec!["pack-old".into()],
            research: vec![],
            ready: true,
        };
        let context = ConversationContext {
            id: "ctx-old".into(),
            title: "Case".into(),
            purpose: "Prepare".into(),
            job_description: Some("Role".into()),
            category: ContextCategory::Other,
            participation_lens: None,
            source_policy: None,
            status: ContextStatus::Ended,
            created_at_unix_ms: 1,
            updated_at_unix_ms: 2,
            source_doc_ids: vec!["source-old".into()],
            slot_doc_ids: BTreeMap::from([("source".into(), vec!["source-old".into()])]),
            auto_generate_context: true,
            research_enabled: false,
            key_terms: vec!["term".into()],
            glossary: vec!["term".into()],
            glossary_definitions: BTreeMap::from([("term".into(), "Meaning".into())]),
            knowledge_profile_id: Some(profile.id.clone()),
            personas: vec![],
            chosen_persona_id: None,
            conversation_id: Some("conversation-old".into()),
            dossier_doc_id: Some("pack-old".into()),
            research_doc_id: Some("research-old".into()),
            deep_qa_enabled: true,
            qa_doc_id: Some("qa-old".into()),
            resources_stale: true,
            resources_generated_at_unix_ms: Some(2),
            suggestion_decisions: BTreeMap::from([(
                "qa:one".into(),
                SuggestionDecision {
                    status: SuggestionDecisionStatus::Accepted,
                    edited_value: Some("Edited answer".into()),
                },
            )]),
        };
        (context, profile)
    }

    fn ids() -> ContextImportIds {
        ContextImportIds {
            context_id: "ctx-new".into(),
            document_ids: BTreeMap::from([
                ("source-old".into(), "source-new".into()),
                ("pack-old".into(), "pack-new".into()),
                ("research-old".into(), "research-new".into()),
                ("qa-old".into(), "qa-new".into()),
            ]),
            profile_id: Some("kp-new".into()),
            conversation_id: Some("conversation-new".into()),
        }
    }

    #[test]
    fn portable_context_round_trip_remaps_all_relationships_and_preserves_review() {
        let (original, profile) = sample();
        let portable = export_context(&original, Some(&profile)).unwrap();
        let wire = serde_json::to_string(&portable).unwrap();
        assert!(!wire.contains("ctx-new"));
        let decoded = serde_json::from_str(&wire).unwrap();
        let (imported, imported_profile) = import_context(decoded, &ids()).unwrap();
        let imported_profile = imported_profile.unwrap();
        assert_eq!(imported.id, "ctx-new");
        assert_eq!(imported.status, ContextStatus::Ready);
        assert_eq!(imported.source_doc_ids, ["source-new"]);
        assert_eq!(imported.slot_doc_ids["source"], ["source-new"]);
        assert_eq!(imported.dossier_doc_id.as_deref(), Some("pack-new"));
        assert_eq!(imported.research_doc_id.as_deref(), Some("research-new"));
        assert_eq!(imported.qa_doc_id.as_deref(), Some("qa-new"));
        assert_eq!(
            imported.conversation_id.as_deref(),
            Some("conversation-new")
        );
        assert_eq!(imported_profile.id, "kp-new");
        assert_eq!(imported_profile.doc_ids, ["pack-new"]);
        assert_eq!(imported.suggestion_decisions, original.suggestion_decisions);
        assert_eq!(imported.glossary_definitions, original.glossary_definitions);
    }

    #[test]
    fn missing_or_aliased_document_mapping_fails_before_import() {
        let (context, profile) = sample();
        let portable = export_context(&context, Some(&profile)).unwrap();
        let mut missing = ids();
        missing.document_ids.remove("qa-old");
        assert!(import_context(portable.clone(), &missing).is_err());
        let mut alias = ids();
        alias
            .document_ids
            .insert("qa-old".into(), "pack-new".into());
        assert!(import_context(portable, &alias).is_err());
    }

    #[test]
    fn profile_and_slot_relationships_are_not_silently_dropped() {
        let (context, profile) = sample();
        assert!(export_context(&context, None).is_err());
        let mut portable = export_context(&context, Some(&profile)).unwrap();
        portable
            .slot_doc_ids
            .insert("bad".into(), vec!["missing".into()]);
        assert!(import_context(portable, &ids()).is_err());
    }

    #[test]
    fn document_index_rejects_omitted_references_and_bad_file_metadata() {
        let (context, profile) = sample();
        let portable = export_context(&context, Some(&profile)).unwrap();
        let documents: Vec<_> = ["source-old", "pack-old", "research-old", "qa-old"]
            .into_iter()
            .map(|id| PortableDocumentV1 {
                id: id.into(),
                file_name: format!("{id}.txt"),
                source: DocSource::File,
                enabled: true,
                searchable: true,
                ingested_at_unix_ms: 1,
                archive_path: None,
                bytes: None,
                sha256: None,
            })
            .collect();
        let artifacts = [
            ("pack-old", GeneratedArtifactKind::Dossier),
            ("research-old", GeneratedArtifactKind::Research),
            ("qa-old", GeneratedArtifactKind::PreparedQa),
        ]
        .into_iter()
        .map(|(id, kind)| PortableGeneratedArtifactV1 {
            document_id: id.into(),
            kind,
            archive_path: format!("generated/files/{id}.md"),
            created_at_unix_ms: 2,
        })
        .collect::<Vec<_>>();
        validate_document_index(&portable, &documents, &artifacts).unwrap();
        assert!(validate_document_index(&portable, &documents[..3], &artifacts).is_err());
        let mut invalid = documents;
        invalid[0].archive_path = Some("documents/files/../evil".into());
        assert!(validate_document_index(&portable, &invalid, &artifacts).is_err());
    }
}

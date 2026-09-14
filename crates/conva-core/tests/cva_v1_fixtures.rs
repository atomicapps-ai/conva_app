//! Retained `.cva` v1 golden fixtures (checkpoint A, pure contract).
//!
//! MAINTENANCE: these fixtures are permanent compatibility evidence, not
//! disposable test data. If a DTO/manifest change breaks a test here, that is
//! very likely the real signal — fix the compatibility break (a migration,
//! or a deliberate new archive version), never "fix" the test by editing a
//! committed fixture file. New fixtures for a NEW archive version are added,
//! never substituted for these. See `examples/generate_cva_fixtures.rs` (the
//! tool that produced these files) and the top-of-file MAINTENANCE comments
//! in `src/archive.rs`, `src/archive_payload.rs`, and
//! `src/archive_conversation.rs`.
//!
//! Every fixture directory mirrors the real `.cva` ZIP layout 1:1
//! (`context/context.json`, `documents/files/<id>`, ...), so a future ZIP
//! writer/reader can be tested by literally zipping/unzipping these same
//! trees — nothing here is aware of ZIP at all yet (checkpoint A has no ZIP
//! I/O), only of the manifest + JSON payload contract.

use std::collections::{BTreeMap, BTreeSet};

use conva_core::archive::{
    is_supported_format_version, validate_id_map, validate_manifest, validate_path, ArchiveError,
    ArchiveManifest, FORMAT_VERSION, MAX_ENTRIES, MAX_JSON_BYTES,
};
use conva_core::archive_conversation::{
    conversation_document_ids, import_conversation, validate_conversation_references,
    ConversationImportIds, PortableConversationV1,
};
use conva_core::archive_payload::{
    import_context, validate_context_references, validate_document_index, ContextImportIds,
    PortableContextV1, PortableDocumentV1, PortableGeneratedArtifactV1,
};

// ── fixture bytes (compiled in — no filesystem access at test time) ────────

const MINIMAL_CONTEXT_MANIFEST: &str =
    include_str!("fixtures/cva-v1-minimal-context/manifest.json");
const MINIMAL_CONTEXT_CONTEXT: &str =
    include_str!("fixtures/cva-v1-minimal-context/context/context.json");

const CONVERSATION_ONLY_MANIFEST: &str =
    include_str!("fixtures/cva-v1-conversation-only/manifest.json");
const CONVERSATION_ONLY_CONVERSATION: &str =
    include_str!("fixtures/cva-v1-conversation-only/conversation/conversation.json");

const FULL_MANIFEST: &str = include_str!("fixtures/cva-v1-full/manifest.json");
const FULL_CONTEXT: &str = include_str!("fixtures/cva-v1-full/context/context.json");
const FULL_CONVERSATION: &str = include_str!("fixtures/cva-v1-full/conversation/conversation.json");
const FULL_DOCUMENTS_INDEX: &str = include_str!("fixtures/cva-v1-full/documents/index.json");
const FULL_GENERATED_INDEX: &str = include_str!("fixtures/cva-v1-full/generated/index.json");
const FULL_DOC_RESUME_BYTES: &[u8] =
    include_bytes!("fixtures/cva-v1-full/documents/files/doc-resume");
const FULL_GENERATED_DOSSIER: &[u8] =
    include_bytes!("fixtures/cva-v1-full/generated/files/doc-dossier.md");
const FULL_GENERATED_RESEARCH: &[u8] =
    include_bytes!("fixtures/cva-v1-full/generated/files/doc-research.md");
const FULL_GENERATED_QA: &[u8] = include_bytes!("fixtures/cva-v1-full/generated/files/doc-qa.md");

fn sha256_hex(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    Sha256::digest(bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

fn manifest_of(json: &str) -> ArchiveManifest {
    serde_json::from_str(json).expect("fixture manifest must deserialize")
}

// ── minimal-context ─────────────────────────────────────────────────────────

#[test]
fn minimal_context_fixture_validates_and_round_trips() {
    let manifest = manifest_of(MINIMAL_CONTEXT_MANIFEST);
    validate_manifest(&manifest).expect("minimal-context manifest must validate");
    assert_eq!(manifest.contents.documents, 0);
    assert_eq!(manifest.contents.generated_artifacts, 0);

    let portable: PortableContextV1 =
        serde_json::from_str(MINIMAL_CONTEXT_CONTEXT).expect("minimal context.json must parse");
    validate_context_references(&portable).unwrap();
    assert!(portable.knowledge_profile.is_none());
    assert!(portable.source_doc_ids.is_empty());

    let ids = ContextImportIds {
        context_id: "ctx-imported".into(),
        document_ids: BTreeMap::new(),
        profile_id: None,
        conversation_id: None,
    };
    let (imported, profile) = import_context(portable, &ids).unwrap();
    assert_eq!(imported.id, "ctx-imported");
    assert!(profile.is_none());

    // Re-serializing must reproduce byte-identical JSON — catches silent
    // serde attribute drift (field rename, tag change, ordering) that a
    // type-only check would miss.
    let reparsed: PortableContextV1 = serde_json::from_str(MINIMAL_CONTEXT_CONTEXT).unwrap();
    let rewritten = serde_json::to_string_pretty(&reparsed).unwrap() + "\n";
    assert_eq!(rewritten, MINIMAL_CONTEXT_CONTEXT);
}

// ── conversation-only ────────────────────────────────────────────────────────

#[test]
fn conversation_only_fixture_validates_and_round_trips() {
    let manifest = manifest_of(CONVERSATION_ONLY_MANIFEST);
    validate_manifest(&manifest).expect("conversation-only manifest must validate");
    assert!(!manifest.contents.context);
    assert!(manifest.contents.conversation);

    let portable: PortableConversationV1 = serde_json::from_str(CONVERSATION_ONLY_CONVERSATION)
        .expect("conversation-only conversation.json must parse");
    validate_conversation_references(&portable).unwrap();
    assert!(portable.linked_context_id.is_none());
    assert!(portable.claim_snapshots.is_empty());
    assert_eq!(portable.segments.len(), 2);

    let ids = ConversationImportIds {
        conversation_id: "conv-imported".into(),
        document_ids: BTreeMap::new(),
        session_ids: BTreeMap::new(),
        claim_ids: BTreeMap::new(),
        context_id: None,
    };
    let imported = import_conversation(portable, &ids).unwrap();
    assert_eq!(imported.id, "conv-imported");
    assert_eq!(imported.segments.len(), 2);

    let reparsed: PortableConversationV1 =
        serde_json::from_str(CONVERSATION_ONLY_CONVERSATION).unwrap();
    let rewritten = serde_json::to_string_pretty(&reparsed).unwrap() + "\n";
    assert_eq!(rewritten, CONVERSATION_ONLY_CONVERSATION);
}

// ── full: Context + conversation + documents + generated artifacts ─────────

#[test]
fn full_fixture_manifest_declares_every_file_with_correct_hashes() {
    let manifest = manifest_of(FULL_MANIFEST);
    validate_manifest(&manifest).expect("full manifest must validate");
    assert_eq!(manifest.contents.documents, 5);
    assert_eq!(manifest.contents.generated_artifacts, 3);

    let by_path: BTreeMap<&str, &conva_core::archive::ArchiveEntry> = manifest
        .entries
        .iter()
        .map(|e| (e.path.as_str(), e))
        .collect();
    let check = |path: &str, bytes: &[u8]| {
        let entry = by_path
            .get(path)
            .unwrap_or_else(|| panic!("missing entry {path}"));
        assert_eq!(entry.bytes, bytes.len() as u64, "byte length for {path}");
        assert_eq!(entry.sha256, sha256_hex(bytes), "sha256 for {path}");
    };
    check("context/context.json", FULL_CONTEXT.as_bytes());
    check(
        "conversation/conversation.json",
        FULL_CONVERSATION.as_bytes(),
    );
    check("documents/index.json", FULL_DOCUMENTS_INDEX.as_bytes());
    check("generated/index.json", FULL_GENERATED_INDEX.as_bytes());
    check("documents/files/doc-resume", FULL_DOC_RESUME_BYTES);
    check("generated/files/doc-dossier.md", FULL_GENERATED_DOSSIER);
    check("generated/files/doc-research.md", FULL_GENERATED_RESEARCH);
    check("generated/files/doc-qa.md", FULL_GENERATED_QA);

    // validate_payload_names accepts exactly this file set plus manifest.json.
    let mut names: Vec<&str> = by_path.keys().copied().collect();
    names.push("manifest.json");
    conva_core::archive::validate_payload_names(&manifest, names).unwrap();
}

#[test]
fn full_fixture_context_and_documents_cross_validate() {
    let context: PortableContextV1 =
        serde_json::from_str(FULL_CONTEXT).expect("full context.json must parse");
    let documents: Vec<PortableDocumentV1> =
        serde_json::from_str(FULL_DOCUMENTS_INDEX).expect("full documents/index.json must parse");
    let artifacts: Vec<PortableGeneratedArtifactV1> =
        serde_json::from_str(FULL_GENERATED_INDEX).expect("full generated/index.json must parse");
    validate_context_references(&context).unwrap();
    validate_document_index(&context, &documents, &artifacts).unwrap();

    // Exactly one document (the resume) carries real bytes; the rest are
    // metadata-only (the job description, by user choice) or generated
    // (whose real text lives under `generated/files/`, not here).
    let with_bytes: Vec<&PortableDocumentV1> = documents
        .iter()
        .filter(|d| d.archive_path.is_some())
        .collect();
    assert_eq!(with_bytes.len(), 1);
    assert_eq!(with_bytes[0].id, "doc-resume");

    let ids = ContextImportIds {
        context_id: "ctx-imported".into(),
        document_ids: documents
            .iter()
            .map(|d| (d.id.clone(), format!("{}-imported", d.id)))
            .collect(),
        profile_id: Some("kp-imported".into()),
        conversation_id: Some("conv-imported".into()),
    };
    let (imported, profile) = import_context(context, &ids).unwrap();
    assert_eq!(imported.id, "ctx-imported");
    assert_eq!(
        imported.source_doc_ids,
        ["doc-resume-imported", "doc-jd-imported"]
    );
    assert_eq!(profile.unwrap().id, "kp-imported");
    // Suggestion review ledger (accept/dismiss) survives import untouched.
    assert_eq!(imported.suggestion_decisions.len(), 2);
}

#[test]
fn full_fixture_conversation_claims_and_evidence_round_trip() {
    let conversation: PortableConversationV1 =
        serde_json::from_str(FULL_CONVERSATION).expect("full conversation.json must parse");
    validate_conversation_references(&conversation).unwrap();

    let doc_ids = conversation_document_ids(&conversation);
    assert!(doc_ids.contains("doc-resume")); // linked_docs
    assert!(doc_ids.contains("doc-dossier")); // evidence.local_document_id

    let ids = ConversationImportIds {
        conversation_id: "conv-imported".into(),
        document_ids: BTreeMap::from([
            ("doc-resume".into(), "doc-resume-imported".into()),
            ("doc-dossier".into(), "doc-dossier-imported".into()),
        ]),
        session_ids: BTreeMap::from([(
            "session-nolan-wells-1".into(),
            "session-imported-1".into(),
        )]),
        claim_ids: BTreeMap::from([("claim-reconciliation".into(), "claim-imported-1".into())]),
        context_id: Some("ctx-imported".into()),
    };
    let imported = import_conversation(conversation, &ids).unwrap();
    assert_eq!(imported.linked_context_id.as_deref(), Some("ctx-imported"));
    let snapshot = &imported.claim_snapshots[0];
    assert_eq!(snapshot.session_id, "session-imported-1");
    let claim = &snapshot.claims[0];
    assert_eq!(claim.id, "claim-imported-1");
    // Speaker attribution, corrections, and evidence provenance survive.
    assert_eq!(claim.speaker_label.as_deref(), Some("Nolan Wells"));
    assert_eq!(claim.corrections.len(), 1);
    assert_eq!(
        claim.evidence[0].local_document_id.as_deref(),
        Some("doc-dossier-imported")
    );
    assert_eq!(claim.state, conva_core::claim::ClaimState::Supported);
}

#[test]
fn full_fixture_context_and_conversation_agree_on_their_link() {
    let context: PortableContextV1 = serde_json::from_str(FULL_CONTEXT).unwrap();
    let conversation: PortableConversationV1 = serde_json::from_str(FULL_CONVERSATION).unwrap();
    assert_eq!(context.conversation_id.as_deref(), Some("conv-nolan-wells"));
    assert_eq!(
        conversation.linked_context_id.as_deref(),
        Some("ctx-nolan-wells")
    );

    let context_ids = ContextImportIds {
        context_id: "ctx-imported".into(),
        document_ids: BTreeMap::new(),
        profile_id: Some("kp-imported".into()),
        conversation_id: Some("conv-imported".into()),
    };
    let conversation_ids = ConversationImportIds {
        conversation_id: "conv-imported".into(),
        document_ids: BTreeMap::new(),
        session_ids: BTreeMap::new(),
        claim_ids: BTreeMap::new(),
        context_id: Some("ctx-imported".into()),
    };
    conva_core::archive_conversation::validate_paired_import_ids(&context_ids, &conversation_ids)
        .unwrap();
}

// ── malformed/corrupt fixtures, generated at test time (spec §12.1) ────────

#[test]
fn future_format_version_is_rejected_clearly() {
    let mut manifest = manifest_of(MINIMAL_CONTEXT_MANIFEST);
    manifest.format_version = FORMAT_VERSION + 1;
    assert!(!is_supported_format_version(manifest.format_version));
    assert_eq!(
        validate_manifest(&manifest),
        Err(ArchiveError::UnsupportedFormat)
    );
}

#[test]
fn every_path_traversal_and_normalization_variant_is_rejected() {
    for bad in [
        "../context/context.json",
        "/context/context.json",
        "context\\context.json",
        "context/../conversation/conversation.json",
        "context/context.json/",
    ] {
        assert!(validate_path(bad).is_err(), "{bad}");
    }
    // Not on the canonical allowlist at all.
    let mut manifest = manifest_of(MINIMAL_CONTEXT_MANIFEST);
    manifest.entries[0].path = "context/extra-payload.json".into();
    assert!(validate_manifest(&manifest).is_err());
}

#[test]
fn checksum_and_byte_length_mismatches_are_rejected_at_the_zip_boundary() {
    // The pure manifest layer only validates the SHA-256's *shape*; the
    // real byte-for-byte comparison happens once the ZIP reader exists
    // (checkpoint B) and streams actual entry bytes. Exercise the shape
    // check here so the boundary the future reader must extend is explicit.
    let mut manifest = manifest_of(MINIMAL_CONTEXT_MANIFEST);
    manifest.entries[0].sha256 = "not-a-valid-hex-digest".into();
    assert!(validate_manifest(&manifest).is_err());
}

#[test]
fn duplicate_and_undeclared_entries_are_rejected() {
    let mut manifest = manifest_of(FULL_MANIFEST);
    let dup = manifest.entries[0].clone();
    manifest.entries.push(dup);
    assert!(matches!(
        validate_manifest(&manifest),
        Err(ArchiveError::DuplicatePath(_))
    ));

    // A zip listing missing a declared entry is rejected by
    // `validate_payload_names`, independent of `validate_manifest`.
    let manifest = manifest_of(FULL_MANIFEST);
    let names: Vec<&str> = manifest.entries[..manifest.entries.len() - 1]
        .iter()
        .map(|e| e.path.as_str())
        .chain(["manifest.json"])
        .collect();
    assert!(conva_core::archive::validate_payload_names(&manifest, names).is_err());
}

#[test]
fn context_with_no_conversation_is_rejected() {
    let mut manifest = manifest_of(MINIMAL_CONTEXT_MANIFEST);
    manifest.contents.context = false;
    manifest.contents.conversation = false;
    assert!(validate_manifest(&manifest).is_err());
}

#[test]
fn entry_count_limit_boundary_is_enforced() {
    let mut manifest = manifest_of(MINIMAL_CONTEXT_MANIFEST);
    let template = manifest.entries[0].clone();
    manifest.entries.clear();
    // One entry must stay the real context payload or the contents/payload
    // cross-check fails first; pad with generated-file entries instead.
    manifest.entries.push(conva_core::archive::ArchiveEntry {
        path: "context/context.json".into(),
        ..template.clone()
    });
    for i in 0..MAX_ENTRIES {
        manifest.entries.push(conva_core::archive::ArchiveEntry {
            path: format!("generated/files/pad-{i}.md"),
            media_type: "text/markdown".into(),
            bytes: 1,
            sha256: "a".repeat(64),
        });
    }
    assert!(matches!(
        validate_manifest(&manifest),
        Err(ArchiveError::LimitExceeded("entry count"))
    ));
}

#[test]
fn json_payload_size_limit_boundary_is_enforced() {
    let mut manifest = manifest_of(MINIMAL_CONTEXT_MANIFEST);
    manifest.entries[0].bytes = MAX_JSON_BYTES + 1;
    assert_eq!(
        validate_manifest(&manifest),
        Err(ArchiveError::LimitExceeded("JSON payload"))
    );
    manifest.entries[0].bytes = MAX_JSON_BYTES;
    assert!(validate_manifest(&manifest).is_ok());
}

#[test]
fn import_id_map_rejects_incomplete_or_identity_mappings() {
    let documents: Vec<PortableDocumentV1> = serde_json::from_str(FULL_DOCUMENTS_INDEX).unwrap();
    let source_ids: Vec<String> = documents.iter().map(|d| d.id.clone()).collect();
    let mut complete: BTreeMap<String, String> = source_ids
        .iter()
        .map(|id| (id.clone(), format!("{id}-new")))
        .collect();
    validate_id_map(&source_ids, &complete).unwrap();

    // Missing one mapping.
    let removed_key = source_ids[0].clone();
    let removed_value = complete.remove(&removed_key).unwrap();
    assert!(validate_id_map(&source_ids, &complete).is_err());
    complete.insert(removed_key.clone(), removed_value);

    // Identity mapping (an import must never keep a source ID).
    complete.insert(removed_key.clone(), removed_key.clone());
    assert!(validate_id_map(&source_ids, &complete).is_err());
}

#[test]
fn unmapped_claim_or_session_reference_fails_import_before_persistence() {
    let conversation: PortableConversationV1 = serde_json::from_str(FULL_CONVERSATION).unwrap();
    let mut ids = ConversationImportIds {
        conversation_id: "conv-imported".into(),
        document_ids: BTreeMap::from([
            ("doc-resume".into(), "doc-resume-imported".into()),
            ("doc-dossier".into(), "doc-dossier-imported".into()),
        ]),
        session_ids: BTreeMap::from([(
            "session-nolan-wells-1".into(),
            "session-imported-1".into(),
        )]),
        claim_ids: BTreeMap::new(), // claim id intentionally unmapped
        context_id: Some("ctx-imported".into()),
    };
    assert!(import_conversation(conversation.clone(), &ids).is_err());

    ids.claim_ids
        .insert("claim-reconciliation".into(), "claim-imported-1".into());
    ids.session_ids.clear(); // now the session id is unmapped instead
    assert!(import_conversation(conversation, &ids).is_err());
}

// A defensive sanity check that the fixture set itself stays internally
// consistent (no fixture references a document ID absent from its own
// documents index) — guards the fixtures, not the production code.
#[test]
fn full_fixture_document_ids_are_all_accounted_for() {
    let context: PortableContextV1 = serde_json::from_str(FULL_CONTEXT).unwrap();
    let conversation: PortableConversationV1 = serde_json::from_str(FULL_CONVERSATION).unwrap();
    let documents: Vec<PortableDocumentV1> = serde_json::from_str(FULL_DOCUMENTS_INDEX).unwrap();
    let known: BTreeSet<&str> = documents.iter().map(|d| d.id.as_str()).collect();

    let mut referenced: BTreeSet<&str> =
        context.source_doc_ids.iter().map(String::as_str).collect();
    referenced.extend(
        [
            context.dossier_doc_id.as_deref(),
            context.research_doc_id.as_deref(),
            context.qa_doc_id.as_deref(),
        ]
        .into_iter()
        .flatten(),
    );
    referenced.extend(conversation_document_ids(&conversation));

    assert!(referenced.is_subset(&known), "{referenced:?} vs {known:?}");
}

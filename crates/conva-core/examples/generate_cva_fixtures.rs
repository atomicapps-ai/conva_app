//! Regeneration tool for the retained `.cva` v1 golden fixtures under
//! `crates/conva-core/tests/fixtures/`.
//!
//! MAINTENANCE: this tool exists so a hand-typed JSON fixture never drifts
//! from what the real DTOs actually serialize to (nested enum tags in
//! particular are easy to get wrong by hand). It is NOT a normal part of the
//! test run — `cva_v1_fixtures.rs` only *reads* the committed files and
//! fails if they stop parsing/validating, which is the whole point: that
//! failure is the signal that a DTO change broke backward compatibility.
//!
//! Run it only to add fixtures for a brand-new archive version (e.g. a
//! future `cva-v2-*` set once `FORMAT_VERSION` bumps). Never rerun it to
//! "fix" an existing v1 fixture — a v1 fixture that stops validating means a
//! real compatibility break was just introduced, not a stale fixture.
//!
//! `cargo run -p conva-core --example generate_cva_fixtures`

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};

use conva_core::archive::{
    ArchiveContents, ArchiveCreator, ArchiveEntry, ArchiveManifest, FORMAT, FORMAT_VERSION,
};
use conva_core::archive_conversation::{export_conversation, ConversationExportInput};
use conva_core::archive_payload::{
    export_context, GeneratedArtifactKind, PortableDocumentV1, PortableGeneratedArtifactV1,
};
use conva_core::asr::TranscriptSegment;
use conva_core::audio::StreamSide;
use conva_core::claim::{
    ClaimCorrection, ClaimCorrectionKind, ClaimRecord, ClaimState, Consequence, ImportanceReason,
};
use conva_core::context::{
    ContextCategory, ContextPersona, ConversationContext, KnowledgeProfile, PersonaGender,
    ResearchSource, SuggestionDecision, SuggestionDecisionStatus,
};
use conva_core::context_snapshot::ParticipationLens;
use conva_core::evidence::{
    ClaimConfidence, EvidenceQuality, EvidenceRecord, EvidenceScope, EvidenceStance,
    QualityAssessment,
};
use conva_core::ipc::{ClaimSnapshotEvent, CLAIM_SNAPSHOT_CONTRACT_VERSION};
use conva_core::meaning_frame::{
    Attribution, AttributionDirectness, Confidence, FrameKind, FrameQualifier, Modality,
    QualifierKind, ReferenceEdge, ReferenceKind, Sensitivity, SuggestedAction,
};
use conva_core::rag::DocSource;
use conva_core::source_policy::{AdmissionDecision, SourceClass, SourcePolicy};

fn fixtures_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures")
}

/// Writes `value` at `dir/<archive_path>`, where `archive_path` is the exact
/// canonical in-archive path (e.g. `"context/context.json"`) — the fixture
/// directory on disk mirrors the real `.cva` ZIP layout 1:1, so a fixture's
/// own files can be fed straight to `entry()` and `validate_manifest`.
fn write_json(dir: &Path, archive_path: &str, value: &impl serde::Serialize) -> Vec<u8> {
    let full_path = dir.join(archive_path);
    fs::create_dir_all(full_path.parent().expect("archive path has a parent"))
        .expect("create fixture dir");
    let json = serde_json::to_string_pretty(value).expect("serialize fixture") + "\n";
    let bytes = json.into_bytes();
    fs::write(&full_path, &bytes).expect("write fixture");
    bytes
}

fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    digest.iter().map(|b| format!("{b:02x}")).collect()
}

/// Writes raw (non-JSON) bytes at `dir/<archive_path>` — used for the
/// original/generated document file entries, which are stored verbatim
/// rather than as a JSON payload.
fn write_bytes(dir: &Path, archive_path: &str, bytes: &[u8]) -> Vec<u8> {
    let full_path = dir.join(archive_path);
    fs::create_dir_all(full_path.parent().expect("archive path has a parent"))
        .expect("create fixture dir");
    fs::write(&full_path, bytes).expect("write fixture");
    bytes.to_vec()
}

fn entry(archive_path: &str, media_type: &str, bytes: &[u8]) -> ArchiveEntry {
    ArchiveEntry {
        path: archive_path.to_owned(),
        media_type: media_type.to_owned(),
        bytes: bytes.len() as u64,
        sha256: sha256_hex(bytes),
    }
}

fn write_manifest(dir: &Path, title: &str, contents: ArchiveContents, entries: Vec<ArchiveEntry>) {
    let manifest = ArchiveManifest {
        format: FORMAT.to_owned(),
        format_version: FORMAT_VERSION,
        created_at: "2026-09-09T20:15:00Z".to_owned(),
        created_by: ArchiveCreator {
            app: "conva".to_owned(),
            app_version: "0.4.0".to_owned(),
        },
        title: title.to_owned(),
        contents,
        entries,
    };
    conva_core::archive::validate_manifest(&manifest).expect("generated manifest must validate");
    let json = serde_json::to_string_pretty(&manifest).expect("serialize manifest") + "\n";
    fs::write(dir.join("manifest.json"), json).expect("write manifest.json");
}

// ── minimal-context ─────────────────────────────────────────────────────────

fn generate_minimal_context() {
    let dir = fixtures_root().join("cva-v1-minimal-context");
    let context = ConversationContext {
        id: "ctx-minimal".into(),
        title: "General conversation".into(),
        purpose: "Quick prep".into(),
        job_description: None,
        category: ContextCategory::Other,
        participation_lens: None,
        source_policy: None,
        status: conva_core::context::ContextStatus::Draft,
        created_at_unix_ms: 1_700_000_000_000,
        updated_at_unix_ms: 1_700_000_000_000,
        source_doc_ids: vec![],
        slot_doc_ids: BTreeMap::new(),
        auto_generate_context: false,
        research_enabled: false,
        deep_qa_enabled: false,
        key_terms: vec![],
        glossary: vec![],
        glossary_definitions: BTreeMap::new(),
        knowledge_profile_id: None,
        personas: vec![],
        chosen_persona_id: None,
        conversation_id: None,
        dossier_doc_id: None,
        research_doc_id: None,
        qa_doc_id: None,
        resources_stale: false,
        resources_generated_at_unix_ms: None,
        suggestion_decisions: BTreeMap::new(),
    };
    let portable = export_context(&context, None).expect("export minimal context");
    let bytes = write_json(&dir, "context/context.json", &portable);
    write_manifest(
        &dir,
        "General conversation",
        ArchiveContents {
            context: true,
            conversation: false,
            documents: 0,
            generated_artifacts: 0,
        },
        vec![entry("context/context.json", "application/json", &bytes)],
    );
}

// ── conversation-only ────────────────────────────────────────────────────────

fn generate_conversation_only() {
    let dir = fixtures_root().join("cva-v1-conversation-only");
    let segments = vec![
        TranscriptSegment {
            side: StreamSide::Outbound,
            seq: 0,
            text: "Thanks for taking the call today.".into(),
            is_final: true,
            start_ms: 0,
            end_ms: 1800,
            confidence: Some(0.97),
            latency_ms: 180,
        },
        TranscriptSegment {
            side: StreamSide::Inbound,
            seq: 0,
            text: "Of course, happy to walk through it.".into(),
            is_final: true,
            start_ms: 1900,
            end_ms: 3600,
            confidence: Some(0.95),
            latency_ms: 210,
        },
    ];
    let input = ConversationExportInput {
        id: "conv-only",
        title: "Quick sync",
        created_at_unix_ms: 1_700_000_100_000,
        updated_at_unix_ms: 1_700_000_200_000,
        segments: &segments,
        linked_docs: &[],
        linked_context_id: None,
        source_session_ids: &[],
        claim_snapshots: &[],
    };
    let portable = export_conversation(input, false).expect("export conversation-only");
    let bytes = write_json(&dir, "conversation/conversation.json", &portable);
    write_manifest(
        &dir,
        "Quick sync",
        ArchiveContents {
            context: false,
            conversation: true,
            documents: 0,
            generated_artifacts: 0,
        },
        vec![entry(
            "conversation/conversation.json",
            "application/json",
            &bytes,
        )],
    );
}

// ── full: Context + conversation + documents + generated artifacts ─────────

fn generate_full() {
    let dir = fixtures_root().join("cva-v1-full");

    let context = ConversationContext {
        id: "ctx-nolan-wells".into(),
        title: "Nolan Wells Case".into(),
        purpose: "Prepare for the Nolan Wells deposition".into(),
        job_description: Some("Senior Accountant".into()),
        category: ContextCategory::Interview,
        participation_lens: Some(ParticipationLens::Interviewee),
        source_policy: Some(SourcePolicy::for_context(ContextCategory::Interview)),
        status: conva_core::context::ContextStatus::Ready,
        created_at_unix_ms: 1_726_000_000_000,
        updated_at_unix_ms: 1_726_003_600_000,
        source_doc_ids: vec!["doc-resume".into(), "doc-jd".into()],
        slot_doc_ids: BTreeMap::from([
            ("resume".into(), vec!["doc-resume".into()]),
            ("job_description".into(), vec!["doc-jd".into()]),
        ]),
        auto_generate_context: true,
        research_enabled: true,
        deep_qa_enabled: true,
        key_terms: vec!["GAAP".into(), "deposition".into()],
        glossary: vec!["GAAP".into()],
        glossary_definitions: BTreeMap::from([(
            "GAAP".into(),
            "Generally Accepted Accounting Principles".into(),
        )]),
        knowledge_profile_id: Some("kp-1".into()),
        personas: vec![ContextPersona {
            id: "persona-1".into(),
            title: "Skeptical opposing counsel".into(),
            summary: "Probes inconsistencies in financial testimony.".into(),
            style_tags: vec!["skeptical".into(), "detail-oriented".into()],
            recommended: true,
            gender: Some(PersonaGender::Female),
            favorite: false,
        }],
        chosen_persona_id: Some("persona-1".into()),
        conversation_id: Some("conv-nolan-wells".into()),
        dossier_doc_id: Some("doc-dossier".into()),
        research_doc_id: Some("doc-research".into()),
        qa_doc_id: Some("doc-qa".into()),
        resources_stale: false,
        resources_generated_at_unix_ms: Some(1_726_002_000_000),
        suggestion_decisions: BTreeMap::from([
            (
                "qa:1".into(),
                SuggestionDecision {
                    status: SuggestionDecisionStatus::Accepted,
                    edited_value: None,
                },
            ),
            (
                "qa:2".into(),
                SuggestionDecision {
                    status: SuggestionDecisionStatus::Dismissed,
                    edited_value: None,
                },
            ),
        ]),
    };
    let profile = KnowledgeProfile {
        id: "kp-1".into(),
        title: "Nolan Wells knowledge".into(),
        created_at_unix_ms: 1_726_000_000_000,
        updated_at_unix_ms: 1_726_001_000_000,
        doc_ids: vec![
            "doc-resume".into(),
            "doc-jd".into(),
            "doc-dossier".into(),
            "doc-research".into(),
            "doc-qa".into(),
        ],
        research: vec![ResearchSource {
            title: "GAAP overview".into(),
            url: "https://example.com/gaap".into(),
            snippet: "GAAP is the common set of accounting standards.".into(),
            fetched_at_unix_ms: 1_726_000_500_000,
        }],
        ready: true,
    };
    let context_portable = export_context(&context, Some(&profile)).expect("export full context");
    let context_bytes = write_json(&dir, "context/context.json", &context_portable);

    // Real bytes for the included originals/generated text — a fixture with
    // fabricated (bytes, sha256) pairs that don't match any actual entry
    // would silently hide the exact drift this checkpoint exists to catch.
    let resume_bytes = write_bytes(
        &dir,
        "documents/files/doc-resume",
        b"pretend resume PDF bytes",
    );
    let dossier_bytes = write_bytes(
        &dir,
        "generated/files/doc-dossier.md",
        b"# Ally Dossier\n\nNolan Wells - senior accountant, prior Big Four experience.\n",
    );
    let research_bytes = write_bytes(
        &dir,
        "generated/files/doc-research.md",
        b"# Research\n\nGAAP background reading compiled during preparation.\n",
    );
    let qa_bytes = write_bytes(
        &dir,
        "generated/files/doc-qa.md",
        b"# Prepared Q&A\n\nQ: Walk me through the year-end close.\nA: ...\n",
    );

    let documents = vec![
        PortableDocumentV1 {
            id: "doc-resume".into(),
            file_name: "resume.pdf".into(),
            source: DocSource::File,
            enabled: true,
            searchable: true,
            ingested_at_unix_ms: 1_726_000_000_000,
            archive_path: Some("documents/files/doc-resume".into()),
            bytes: Some(resume_bytes.len() as u64),
            sha256: Some(sha256_hex(&resume_bytes)),
        },
        PortableDocumentV1 {
            id: "doc-jd".into(),
            file_name: "job-description.pdf".into(),
            source: DocSource::File,
            enabled: true,
            searchable: true,
            ingested_at_unix_ms: 1_726_000_000_000,
            // Metadata-only: the user chose "Context only" (spec §2.4), so
            // original bytes are intentionally omitted.
            archive_path: None,
            bytes: None,
            sha256: None,
        },
        // Generated documents: `documents/index.json` carries their
        // enabled/searchable/ingested_at metadata, but the actual text lives
        // ONLY under `generated/files/<id>.md`, indexed by
        // `generated/index.json` below — `archive_path` here stays `None`
        // rather than duplicating the same bytes under `documents/files/`
        // (see `archive_payload::validate_document_index`, which requires
        // any populated `PortableDocumentV1.archive_path` to equal
        // `documents/files/<id>` exactly).
        PortableDocumentV1 {
            id: "doc-dossier".into(),
            file_name: "Ally Dossier.md".into(),
            source: DocSource::Generated,
            enabled: true,
            searchable: true,
            ingested_at_unix_ms: 1_726_002_000_000,
            archive_path: None,
            bytes: None,
            sha256: None,
        },
        PortableDocumentV1 {
            id: "doc-research".into(),
            file_name: "Research.md".into(),
            source: DocSource::Generated,
            enabled: true,
            searchable: true,
            ingested_at_unix_ms: 1_726_002_000_000,
            archive_path: None,
            bytes: None,
            sha256: None,
        },
        PortableDocumentV1 {
            id: "doc-qa".into(),
            file_name: "Prepared Q&A.md".into(),
            source: DocSource::Generated,
            enabled: true,
            searchable: true,
            ingested_at_unix_ms: 1_726_002_000_000,
            archive_path: None,
            bytes: None,
            sha256: None,
        },
    ];
    let artifacts = vec![
        PortableGeneratedArtifactV1 {
            document_id: "doc-dossier".into(),
            kind: GeneratedArtifactKind::Dossier,
            archive_path: "generated/files/doc-dossier.md".into(),
            created_at_unix_ms: 1_726_002_000_000,
        },
        PortableGeneratedArtifactV1 {
            document_id: "doc-research".into(),
            kind: GeneratedArtifactKind::Research,
            archive_path: "generated/files/doc-research.md".into(),
            created_at_unix_ms: 1_726_002_000_000,
        },
        PortableGeneratedArtifactV1 {
            document_id: "doc-qa".into(),
            kind: GeneratedArtifactKind::PreparedQa,
            archive_path: "generated/files/doc-qa.md".into(),
            created_at_unix_ms: 1_726_002_000_000,
        },
    ];
    conva_core::archive_payload::validate_document_index(&context_portable, &documents, &artifacts)
        .expect("full fixture document index must validate");
    let documents_bytes = write_json(&dir, "documents/index.json", &documents);
    let generated_bytes = write_json(&dir, "generated/index.json", &artifacts);

    let segments = vec![
        TranscriptSegment {
            side: StreamSide::Outbound,
            seq: 0,
            text: "Can you walk me through the year-end close?".into(),
            is_final: true,
            start_ms: 0,
            end_ms: 2200,
            confidence: Some(0.96),
            latency_ms: 190,
        },
        TranscriptSegment {
            side: StreamSide::Inbound,
            seq: 1,
            text: "The reconciliation had 7 open items at close.".into(),
            is_final: true,
            start_ms: 2300,
            end_ms: 4600,
            confidence: Some(0.94),
            latency_ms: 205,
        },
    ];
    let claim = ClaimRecord {
        id: "claim-reconciliation".into(),
        source_segment_ids: vec!["inbound:1".into()],
        speaker_side: StreamSide::Inbound,
        speaker_label: Some("Nolan Wells".into()),
        exact_quote: "The reconciliation had 7 open items at close.".into(),
        normalized_proposition: "the reconciliation had 7 open items at close".into(),
        predicate: "had".into(),
        subject: Some("the reconciliation".into()),
        object: None,
        frame_kind: FrameKind::Claim,
        attribution_chain: vec![Attribution {
            source_label: "Nolan Wells".into(),
            reporting_verb: "stated".into(),
            directness: AttributionDirectness::DirectStatement,
        }],
        qualifiers: vec![FrameQualifier {
            kind: QualifierKind::Quantity,
            value: "7".into(),
            unit: Some("open items".into()),
        }],
        references: vec![ReferenceEdge {
            surface_text: "the reconciliation".into(),
            kind: ReferenceKind::Artifact,
            required_for_verification: false,
            resolved_target_id: None,
            candidates: vec![],
        }],
        modality: Modality::Asserted,
        negated: false,
        sensitivity: Sensitivity::Internal,
        consequence: Consequence::Medium,
        importance_reasons: vec![ImportanceReason::SpecificAndCheckable],
        state: ClaimState::Supported,
        recommended_action: Some(SuggestedAction::Verify),
        policy_id: "default-interview".into(),
        policy_version: 1,
        extraction_confidence: Confidence::High,
        resolution_confidence: Confidence::High,
        claim_confidence: Some(ClaimConfidence::Strong),
        evidence: vec![EvidenceRecord {
            source_id: "doc-dossier-excerpt".into(),
            source_class: SourceClass::ContextDocument,
            publisher: "Internal audit file".into(),
            title: "Year-end close reconciliation".into(),
            url: None,
            local_document_id: Some("doc-dossier".into()),
            excerpt: "7 items remained open at close.".into(),
            addressed_claim_part: "the underlying proposition".into(),
            scope: EvidenceScope::UnderlyingProposition,
            stance: EvidenceStance::Supports,
            quality: EvidenceQuality {
                authority: QualityAssessment::Strong,
                directness: QualityAssessment::Strong,
                specificity: QualityAssessment::Adequate,
                freshness: QualityAssessment::Adequate,
                independence: QualityAssessment::Adequate,
                completeness: QualityAssessment::Adequate,
                provenance: QualityAssessment::Strong,
            },
            independence_group: Some("internal-audit".into()),
            admission: AdmissionDecision::Admitted,
            admission_policy_id: "default-interview".into(),
            admission_policy_version: 1,
            published_at_unix_ms: Some(1_726_001_500_000),
            retrieved_at_unix_ms: 1_726_001_600_000,
        }],
        corrections: vec![ClaimCorrection {
            kind: ClaimCorrectionKind::Proposition,
            previous_value: "the reconciliation had 8 open items at close".into(),
            corrected_value: "the reconciliation had 7 open items at close".into(),
            corrected_by: "user".into(),
            created_at_unix_ms: 1_726_001_700_000,
        }],
        created_at_unix_ms: 1_726_001_000_000,
        updated_at_unix_ms: 1_726_001_800_000,
    };
    let claim_snapshots = vec![ClaimSnapshotEvent {
        contract_version: CLAIM_SNAPSHOT_CONTRACT_VERSION,
        session_id: "session-nolan-wells-1".into(),
        epoch: 0,
        revision: 1,
        claims: vec![claim],
    }];
    let conversation_input = ConversationExportInput {
        id: "conv-nolan-wells",
        title: "Nolan Wells Case",
        created_at_unix_ms: 1_726_000_500_000,
        updated_at_unix_ms: 1_726_003_600_000,
        segments: &segments,
        linked_docs: &["doc-resume".to_string()],
        linked_context_id: Some("ctx-nolan-wells"),
        source_session_ids: &["session-nolan-wells-1".to_string()],
        claim_snapshots: &claim_snapshots,
    };
    let conversation_portable =
        export_conversation(conversation_input, true).expect("export full conversation");
    let conversation_bytes = write_json(
        &dir,
        "conversation/conversation.json",
        &conversation_portable,
    );

    write_manifest(
        &dir,
        "Nolan Wells Case",
        ArchiveContents {
            context: true,
            conversation: true,
            documents: documents.len(),
            generated_artifacts: artifacts.len(),
        },
        vec![
            entry("context/context.json", "application/json", &context_bytes),
            entry(
                "conversation/conversation.json",
                "application/json",
                &conversation_bytes,
            ),
            entry("documents/index.json", "application/json", &documents_bytes),
            entry("generated/index.json", "application/json", &generated_bytes),
            entry(
                "documents/files/doc-resume",
                "application/pdf",
                &resume_bytes,
            ),
            entry(
                "generated/files/doc-dossier.md",
                "text/markdown",
                &dossier_bytes,
            ),
            entry(
                "generated/files/doc-research.md",
                "text/markdown",
                &research_bytes,
            ),
            entry("generated/files/doc-qa.md", "text/markdown", &qa_bytes),
        ],
    );
}

fn main() {
    generate_minimal_context();
    generate_conversation_only();
    generate_full();
    println!("Wrote .cva v1 fixtures under {}", fixtures_root().display());
}

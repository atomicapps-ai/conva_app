//! Desktop `.cva` archive I/O (Checkpoints B/C/D): ZIP read/write, atomic
//! save, side-effect-free inspection, and the persistence glue between the
//! pure `conva-core` portable contract
//! (`crates/conva-core/src/{archive,archive_payload,archive_conversation}.rs`)
//! and this app's on-disk Context/conversation/RAG stores.
//!
//! MAINTENANCE: this module is a second audit point alongside the
//! `conva-core` DTOs' own MAINTENANCE comments. A change to how Context,
//! conversation, document, or generated-artifact records are *persisted*
//! (`context.rs`, `conversations.rs`, `rag.rs`) needs a matching review here:
//! which fields this module reads at export time and how it reconstructs a
//! persisted record at import time.
//!
//! Design choice, deliberate: every function below that does the real work
//! (manifest/entry assembly, ZIP write, ZIP validate+load, document staging,
//! ID minting, rollback) takes plain data (`&Path`, `&RagStore`, already
//! loaded `ConversationContext`/`Conversation` values) rather than
//! `AppHandle` — so it is unit-testable without Tauri's (currently unwired
//! in this crate) `tauri::test` mocking. Only the thin `#[tauri::command]`
//! wrappers in `lib.rs` touch `AppHandle`, to load/save through
//! `context.rs`/`conversations.rs`.

use std::collections::{BTreeMap, BTreeSet};
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use serde::de::DeserializeOwned;
use sha2::{Digest, Sha256};

use conva_core::archive::{
    format_utc_timestamp, is_supported_format_version, validate_manifest, validate_payload_names,
    ArchiveContents, ArchiveCreator, ArchiveEntry, ArchiveManifest, FORMAT, FORMAT_VERSION,
    MAX_ARCHIVE_BYTES, MAX_ENTRIES, MAX_ENTRY_BYTES, MAX_UNCOMPRESSED_BYTES,
};
use conva_core::archive_conversation::{
    conversation_document_ids, export_conversation as export_conversation_dto,
    import_conversation as import_conversation_dto, validate_paired_import_ids,
    ConversationExportInput, ConversationImportIds, ImportedConversation, PortableConversationV1,
};
use conva_core::archive_payload::{
    export_context as export_context_dto, export_document_metadata,
    import_context as import_context_dto, validate_document_index, ContextImportIds,
    GeneratedArtifactKind, PortableContextV1, PortableDocumentV1, PortableGeneratedArtifactV1,
};
use conva_core::context::{ConversationContext, KnowledgeProfile};
use conva_core::ipc::{
    ArchiveCompatibilityWarning, ArchiveContextPreview, ArchiveConversationPreview,
    ArchiveDocumentPreview, ArchiveExportEstimate, ArchiveExportOptions, ArchiveExportResult,
    ArchiveImportOptions, ArchiveInspection, ArchiveOmittedDocument, ArchiveProgressEvent,
};
use conva_core::rag::{DocSource, IngestReport, RagDocument};
use conva_core::CoreError;

use crate::rag::RagStore;

const APP_NAME: &str = "conva";
/// Diagnostic-only per spec §4 (`created_by` "never changes trust or
/// compatibility") — the workspace package version, not a build/git sha.
const APP_VERSION: &str = env!("CARGO_PKG_VERSION");

// ── Small shared helpers ─────────────────────────────────────────────────

fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    digest.iter().map(|b| format!("{b:02x}")).collect()
}

/// A fresh id with no realistic collision risk: `<prefix>-<unix_ms>-<rand>`.
/// Used only for records this module mints *before* handing them to
/// `context.rs`/`conversations.rs::save` (which otherwise mint their own ids
/// for a truly new record) — see the module doc comment for why an import
/// needs to know its destination Context id before the normal save path
/// would assign one (generated artifacts must be tagged with it as they're
/// ingested).
fn mint_id(prefix: &str) -> String {
    format!(
        "{prefix}-{}-{:08x}",
        crate::session::now_unix_ms(),
        rand::random::<u32>()
    )
}

fn now_iso() -> String {
    format_utc_timestamp(crate::session::now_unix_ms())
}

/// Progress/cancellation are both optional (tests pass no-ops); real
/// `#[tauri::command]` callers pass a closure that emits
/// [`ArchiveProgressEvent`] / checks a shared cancel flag.
pub type ProgressFn<'a> = dyn FnMut(ArchiveProgressEvent) + 'a;
pub type CancelFn<'a> = dyn Fn() -> bool + 'a;

#[cfg(test)]
fn noop_progress(_: ArchiveProgressEvent) {}
#[cfg(test)]
fn noop_cancel() -> bool {
    false
}

#[derive(Debug, thiserror::Error)]
pub enum ImportOutcomeError {
    #[error("import cancelled")]
    Cancelled,
    #[error(transparent)]
    Core(#[from] CoreError),
}

// ── ZIP writer (atomic) ──────────────────────────────────────────────────

/// One in-memory entry to write: its declared archive path, media type, and
/// exact bytes. Built up by the export functions below, then handed to
/// [`write_archive_atomic`] as a single unit so the manifest (which must
/// declare every entry's final length/hash) and the ZIP body never disagree.
struct PendingEntry {
    path: String,
    media_type: String,
    bytes: Vec<u8>,
}

/// Write `manifest.json` plus every pending entry to `dest`, atomically:
/// build the whole file at a temporary sibling path, flush + sync it, then
/// `rename` over `dest` (rename is overwrite-atomic on both POSIX and
/// Windows — spec §"Decide destination-exists behavior explicitly": this
/// implementation replaces an existing file at `dest` in one atomic step,
/// never partially). On any error the temporary file is removed and `dest`
/// is left completely untouched.
fn write_archive_atomic(
    dest: &Path,
    manifest: &ArchiveManifest,
    entries: &[PendingEntry],
) -> Result<u64, CoreError> {
    let tmp_name = format!(
        ".{}.cva-tmp-{}",
        dest.file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| "archive".to_string()),
        std::process::id()
    );
    let tmp_path = dest.with_file_name(tmp_name);

    let result = (|| -> Result<u64, CoreError> {
        let file = File::create(&tmp_path).map_err(|e| CoreError::Archive(e.to_string()))?;
        let mut zip = zip::ZipWriter::new(file);
        let opts = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);

        let manifest_json =
            serde_json::to_vec_pretty(manifest).map_err(|e| CoreError::Archive(e.to_string()))?;
        zip.start_file("manifest.json", opts)
            .map_err(|e| CoreError::Archive(e.to_string()))?;
        zip.write_all(&manifest_json)
            .map_err(|e| CoreError::Archive(e.to_string()))?;

        for entry in entries {
            zip.start_file(&entry.path, opts)
                .map_err(|e| CoreError::Archive(e.to_string()))?;
            zip.write_all(&entry.bytes)
                .map_err(|e| CoreError::Archive(e.to_string()))?;
        }
        let file = zip
            .finish()
            .map_err(|e| CoreError::Archive(e.to_string()))?;
        file.sync_all()
            .map_err(|e| CoreError::Archive(e.to_string()))?;
        Ok(file.metadata().map(|m| m.len()).unwrap_or(0))
    })();

    match result {
        Ok(bytes) => {
            fs::rename(&tmp_path, dest).map_err(|e| {
                let _ = fs::remove_file(&tmp_path);
                CoreError::Archive(format!("could not save archive: {e}"))
            })?;
            Ok(bytes)
        }
        Err(e) => {
            let _ = fs::remove_file(&tmp_path);
            Err(e)
        }
    }
}

// ── Export ────────────────────────────────────────────────────────────────

/// Every source document to export is looked up once from the caller's
/// already-loaded `RagStore` snapshot, keyed by id — avoids re-locking the
/// store per document.
fn doc_index(rag: &RagStore) -> BTreeMap<String, RagDocument> {
    rag.list().into_iter().map(|d| (d.id.clone(), d)).collect()
}

/// Coarse, content-free estimate (spec §8.2) — no file I/O beyond what the
/// caller's `RagStore`/`ConversationContext` already loaded.
pub fn estimate_context_export(
    context: &ConversationContext,
    rag: &RagStore,
    options: &ArchiveExportOptions,
) -> ArchiveExportEstimate {
    estimate_doc_ids(&source_and_generated_doc_ids(context), rag, options)
}

/// Same estimate for a conversation export scope — `doc_ids` is
/// `conversation_document_ids(...)`, optionally unioned with
/// `source_and_generated_doc_ids(context)` when the Context is bundled too.
pub fn estimate_conversation_export(
    doc_ids: &BTreeSet<&str>,
    rag: &RagStore,
    options: &ArchiveExportOptions,
) -> ArchiveExportEstimate {
    estimate_doc_ids(doc_ids, rag, options)
}

fn estimate_doc_ids(
    doc_ids: &BTreeSet<&str>,
    rag: &RagStore,
    options: &ArchiveExportOptions,
) -> ArchiveExportEstimate {
    let docs = doc_index(rag);
    let mut document_count = 0u32;
    let mut estimated_bytes = 4096u64; // manifest + context.json + indexes, rough
    for &id in doc_ids {
        let Some(doc) = docs.get(id) else { continue };
        document_count += 1;
        if doc.source == DocSource::Generated {
            estimated_bytes += rag.document_text(id).map(|t| t.len() as u64).unwrap_or(0);
        } else if options.include_source_documents {
            estimated_bytes += doc.size_bytes;
        }
    }
    ArchiveExportEstimate {
        document_count,
        estimated_bytes,
        includes_source_documents: options.include_source_documents,
    }
}

pub(crate) fn source_and_generated_doc_ids(context: &ConversationContext) -> BTreeSet<&str> {
    let mut ids: BTreeSet<&str> = context.source_doc_ids.iter().map(String::as_str).collect();
    ids.extend(context.slot_doc_ids.values().flatten().map(String::as_str));
    ids.extend(
        [
            &context.dossier_doc_id,
            &context.research_doc_id,
            &context.qa_doc_id,
        ]
        .into_iter()
        .flatten()
        .map(String::as_str),
    );
    ids
}

/// Build the `documents/index.json` + `generated/index.json` payloads and
/// their file entries for every document `doc_ids` references. Source
/// documents get real bytes only when `include_source_documents` is set (spec
/// §2.4 "Context only" vs "Portable package"); generated artifacts (dossier/
/// research/Q&A) always carry their text — they are Ally's compiled
/// intelligence, not a "source" the privacy toggle is about.
/// `(documents index, generated-artifact index, pending ZIP entries)`.
type AssembledDocuments = (
    Vec<PortableDocumentV1>,
    Vec<PortableGeneratedArtifactV1>,
    Vec<PendingEntry>,
);

fn assemble_documents(
    rag: &RagStore,
    doc_ids: &BTreeSet<&str>,
    include_source_documents: bool,
) -> Result<AssembledDocuments, CoreError> {
    let index = doc_index(rag);
    let mut documents = Vec::new();
    let mut artifacts = Vec::new();
    let mut entries = Vec::new();

    for &id in doc_ids {
        let Some(doc) = index.get(id) else {
            return Err(CoreError::Archive(format!(
                "referenced document '{id}' no longer exists in the library"
            )));
        };
        if doc.source == DocSource::Generated {
            let text = rag.document_text(id).unwrap_or_default();
            let bytes = text.into_bytes();
            let archive_path = format!("generated/files/{id}.md");
            documents.push(PortableDocumentV1 {
                id: doc.id.clone(),
                file_name: doc.file_name.clone(),
                source: doc.source,
                enabled: doc.enabled,
                searchable: doc.searchable,
                ingested_at_unix_ms: doc.ingested_at_unix_ms,
                archive_path: None,
                bytes: None,
                sha256: None,
            });
            artifacts.push(PortableGeneratedArtifactV1 {
                document_id: doc.id.clone(),
                kind: generated_artifact_kind(&doc.file_name),
                archive_path: archive_path.clone(),
                created_at_unix_ms: doc.ingested_at_unix_ms,
            });
            entries.push(PendingEntry {
                path: archive_path,
                media_type: "text/markdown".into(),
                bytes,
            });
        } else if include_source_documents {
            let mut tmp = std::env::temp_dir();
            tmp.push(format!(
                "conva-cva-export-{}-{id}",
                crate::session::now_unix_ms()
            ));
            rag.export_original(id, tmp.to_string_lossy().as_ref())
                .map_err(|e| CoreError::Archive(format!("reading '{id}' for export: {e}")))?;
            let bytes = fs::read(&tmp).map_err(|e| CoreError::Archive(e.to_string()))?;
            let _ = fs::remove_file(&tmp);
            if bytes.len() as u64 > MAX_ENTRY_BYTES {
                return Err(CoreError::Archive(format!(
                    "'{}' exceeds the per-entry archive size limit",
                    doc.file_name
                )));
            }
            let digest = sha256_hex(&bytes);
            let archive_path = format!("documents/files/{id}");
            documents.push(export_document_metadata(
                doc,
                Some((bytes.len() as u64, digest)),
            ));
            entries.push(PendingEntry {
                path: archive_path,
                media_type: guess_media_type(&doc.file_name),
                bytes,
            });
        } else {
            documents.push(export_document_metadata(doc, None));
        }
    }
    Ok((documents, artifacts, entries))
}

/// Best-effort media type from the file extension — display/inspection only;
/// import re-derives real support from the ingest pipeline itself, exactly
/// as a normal upload does (never trusted from an archive).
fn guess_media_type(file_name: &str) -> String {
    match Path::new(file_name)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .as_deref()
    {
        Some("pdf") => "application/pdf",
        Some("docx") => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        Some("md") => "text/markdown",
        Some("txt") => "text/plain",
        Some("html") | Some("htm") => "text/html",
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        _ => "application/octet-stream",
    }
    .to_string()
}

fn generated_artifact_kind(file_name: &str) -> GeneratedArtifactKind {
    let lower = file_name.to_ascii_lowercase();
    if lower.contains("research") {
        GeneratedArtifactKind::Research
    } else if lower.contains("q&a") || lower.contains("qa") {
        GeneratedArtifactKind::PreparedQa
    } else {
        GeneratedArtifactKind::Dossier
    }
}

/// Export a Context (spec Checkpoint B). `progress`/`cancel` are best-effort:
/// cancellation is only checked between documents, so a single huge document
/// read/hash still runs to completion — real-world archives are small
/// relative to the size limits, so this granularity is enough to make
/// "Cancel" responsive without threading cancellation through every `Read`.
#[allow(clippy::too_many_arguments)]
pub fn export_context(
    context: &ConversationContext,
    profile: Option<&KnowledgeProfile>,
    rag: &RagStore,
    options: &ArchiveExportOptions,
    dest: &Path,
    operation_id: &str,
    progress: &mut ProgressFn<'_>,
    cancel: &CancelFn<'_>,
) -> Result<ArchiveExportResult, CoreError> {
    let portable = export_context_dto(context, profile)?;
    let doc_ids = source_and_generated_doc_ids(context);
    let (documents, artifacts, mut entries) =
        assemble_documents(rag, &doc_ids, options.include_source_documents)?;
    if cancel() {
        return Err(CoreError::Archive("cancelled".into()));
    }
    validate_document_index(&portable, &documents, &artifacts)?;

    let mut pending = Vec::new();
    let context_bytes =
        serde_json::to_vec_pretty(&portable).map_err(|e| CoreError::Archive(e.to_string()))?;
    pending.push(PendingEntry {
        path: "context/context.json".into(),
        media_type: "application/json".into(),
        bytes: context_bytes,
    });
    if !documents.is_empty() {
        let bytes =
            serde_json::to_vec_pretty(&documents).map_err(|e| CoreError::Archive(e.to_string()))?;
        pending.push(PendingEntry {
            path: "documents/index.json".into(),
            media_type: "application/json".into(),
            bytes,
        });
    }
    if !artifacts.is_empty() {
        let bytes =
            serde_json::to_vec_pretty(&artifacts).map_err(|e| CoreError::Archive(e.to_string()))?;
        pending.push(PendingEntry {
            path: "generated/index.json".into(),
            media_type: "application/json".into(),
            bytes,
        });
    }
    pending.append(&mut entries);

    progress(ArchiveProgressEvent::Hashing {
        operation_id: operation_id.to_string(),
        processed_bytes: 0,
        total_bytes: pending.iter().map(|e| e.bytes.len() as u64).sum(),
    });
    let manifest_entries: Vec<ArchiveEntry> = pending
        .iter()
        .map(|e| ArchiveEntry {
            path: e.path.clone(),
            media_type: e.media_type.clone(),
            bytes: e.bytes.len() as u64,
            sha256: sha256_hex(&e.bytes),
        })
        .collect();
    let manifest = ArchiveManifest {
        format: FORMAT.to_owned(),
        format_version: FORMAT_VERSION,
        created_at: now_iso(),
        created_by: ArchiveCreator {
            app: APP_NAME.into(),
            app_version: APP_VERSION.into(),
        },
        title: context.title.clone(),
        contents: ArchiveContents {
            context: true,
            conversation: false,
            documents: documents.len(),
            generated_artifacts: artifacts.len(),
        },
        entries: manifest_entries,
    };
    validate_manifest(&manifest)?;
    if cancel() {
        return Err(CoreError::Archive("cancelled".into()));
    }

    progress(ArchiveProgressEvent::WritingEntries {
        operation_id: operation_id.to_string(),
        processed_items: 0,
        total_items: pending.len() as u32,
    });
    let bytes = write_archive_atomic(dest, &manifest, &pending)?;
    let archive_digest =
        sha256_hex(&fs::read(dest).map_err(|e| CoreError::Archive(e.to_string()))?);
    Ok(ArchiveExportResult {
        destination: dest.to_string_lossy().into_owned(),
        archive_digest,
        bytes,
    })
}

/// Export a saved conversation, optionally bundled with its linked Context
/// (spec §2.4/Checkpoint D). `context` is `None` for a transcript-only
/// export even when the conversation has a `linked_context_id` — the
/// caller decides scope before calling this.
#[allow(clippy::too_many_arguments)]
pub fn export_conversation(
    input: ConversationExportInput<'_>,
    context: Option<(&ConversationContext, Option<&KnowledgeProfile>)>,
    rag: &RagStore,
    options: &ArchiveExportOptions,
    dest: &Path,
    operation_id: &str,
    progress: &mut ProgressFn<'_>,
    cancel: &CancelFn<'_>,
) -> Result<ArchiveExportResult, CoreError> {
    let conversation_portable = export_conversation_dto(input, context.is_some())?;
    let mut doc_ids: BTreeSet<&str> = conversation_document_ids(&conversation_portable);
    let context_portable = match context {
        Some((context, profile)) => {
            doc_ids.extend(source_and_generated_doc_ids(context));
            Some(export_context_dto(context, profile)?)
        }
        None => None,
    };
    if cancel() {
        return Err(CoreError::Archive("cancelled".into()));
    }
    let (documents, artifacts, mut entries) =
        assemble_documents(rag, &doc_ids, options.include_source_documents)?;
    if let Some(context_portable) = &context_portable {
        validate_document_index(context_portable, &documents, &artifacts)?;
    }

    let mut pending = Vec::new();
    let conversation_bytes = serde_json::to_vec_pretty(&conversation_portable)
        .map_err(|e| CoreError::Archive(e.to_string()))?;
    pending.push(PendingEntry {
        path: "conversation/conversation.json".into(),
        media_type: "application/json".into(),
        bytes: conversation_bytes,
    });
    if let Some(context_portable) = &context_portable {
        let bytes = serde_json::to_vec_pretty(context_portable)
            .map_err(|e| CoreError::Archive(e.to_string()))?;
        pending.push(PendingEntry {
            path: "context/context.json".into(),
            media_type: "application/json".into(),
            bytes,
        });
    }
    if !documents.is_empty() {
        let bytes =
            serde_json::to_vec_pretty(&documents).map_err(|e| CoreError::Archive(e.to_string()))?;
        pending.push(PendingEntry {
            path: "documents/index.json".into(),
            media_type: "application/json".into(),
            bytes,
        });
    }
    if !artifacts.is_empty() {
        let bytes =
            serde_json::to_vec_pretty(&artifacts).map_err(|e| CoreError::Archive(e.to_string()))?;
        pending.push(PendingEntry {
            path: "generated/index.json".into(),
            media_type: "application/json".into(),
            bytes,
        });
    }
    pending.append(&mut entries);

    progress(ArchiveProgressEvent::Hashing {
        operation_id: operation_id.to_string(),
        processed_bytes: 0,
        total_bytes: pending.iter().map(|e| e.bytes.len() as u64).sum(),
    });
    let manifest_entries: Vec<ArchiveEntry> = pending
        .iter()
        .map(|e| ArchiveEntry {
            path: e.path.clone(),
            media_type: e.media_type.clone(),
            bytes: e.bytes.len() as u64,
            sha256: sha256_hex(&e.bytes),
        })
        .collect();
    let manifest = ArchiveManifest {
        format: FORMAT.to_owned(),
        format_version: FORMAT_VERSION,
        created_at: now_iso(),
        created_by: ArchiveCreator {
            app: APP_NAME.into(),
            app_version: APP_VERSION.into(),
        },
        title: conversation_portable.title.clone(),
        contents: ArchiveContents {
            context: context_portable.is_some(),
            conversation: true,
            documents: documents.len(),
            generated_artifacts: artifacts.len(),
        },
        entries: manifest_entries,
    };
    validate_manifest(&manifest)?;
    if cancel() {
        return Err(CoreError::Archive("cancelled".into()));
    }
    progress(ArchiveProgressEvent::WritingEntries {
        operation_id: operation_id.to_string(),
        processed_items: 0,
        total_items: pending.len() as u32,
    });
    let bytes = write_archive_atomic(dest, &manifest, &pending)?;
    let archive_digest =
        sha256_hex(&fs::read(dest).map_err(|e| CoreError::Archive(e.to_string()))?);
    Ok(ArchiveExportResult {
        destination: dest.to_string_lossy().into_owned(),
        archive_digest,
        bytes,
    })
}

// ── Load + validate (shared by inspect and import) ──────────────────────

/// Every declared payload's bytes, already checked against the manifest's
/// length/hash. Buffered fully in memory — bounded by
/// [`MAX_UNCOMPRESSED_BYTES`] (500 MiB), acceptable for a desktop v1; true
/// zero-buffering streaming is a follow-up, not required by the size limits
/// already enforced here.
struct LoadedArchive {
    manifest: ArchiveManifest,
    archive_digest: String,
    payloads: BTreeMap<String, Vec<u8>>,
}

impl LoadedArchive {
    fn json<T: DeserializeOwned>(&self, path: &str) -> Result<Option<T>, CoreError> {
        match self.payloads.get(path) {
            Some(bytes) => Ok(Some(
                serde_json::from_slice(bytes).map_err(|e| CoreError::Archive(e.to_string()))?,
            )),
            None => Ok(None),
        }
    }
}

/// Open, validate, and fully load a `.cva` at `path` — the one place every
/// required-rejection check from spec §6.2 is enforced before any content is
/// trusted. Side-effect-free: never writes anything, never touches the
/// Context/conversation/RAG stores. Used by both `inspect` (which stops
/// here) and `import` (which re-derives everything it persists from this
/// same loaded, validated data — it does not trust a separate prior
/// inspection call).
fn load_archive(path: &Path) -> Result<LoadedArchive, CoreError> {
    let archive_len = fs::metadata(path)
        .map_err(|e| CoreError::Archive(format!("can't read '{}': {e}", path.display())))?
        .len();
    if archive_len > MAX_ARCHIVE_BYTES {
        return Err(CoreError::Archive(
            "archive exceeds the file size limit".into(),
        ));
    }
    let archive_digest = {
        let mut file = File::open(path).map_err(|e| CoreError::Archive(e.to_string()))?;
        let mut hasher = Sha256::new();
        let mut buf = [0u8; 64 * 1024];
        loop {
            let n = file
                .read(&mut buf)
                .map_err(|e| CoreError::Archive(e.to_string()))?;
            if n == 0 {
                break;
            }
            hasher.update(&buf[..n]);
        }
        hasher
            .finalize()
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect::<String>()
    };

    let file = File::open(path).map_err(|e| CoreError::Archive(e.to_string()))?;
    let mut zip = zip::ZipArchive::new(file)
        .map_err(|e| CoreError::Archive(format!("not a valid ZIP: {e}")))?;
    if zip.len() > MAX_ENTRIES + 1 {
        return Err(CoreError::Archive(
            "archive exceeds the entry count limit".into(),
        ));
    }

    let names: Vec<String> = (0..zip.len())
        .filter_map(|i| zip.name_for_index(i).map(str::to_string))
        .collect();

    let manifest_bytes = {
        let mut entry = zip
            .by_name("manifest.json")
            .map_err(|_| CoreError::Archive("missing manifest.json".into()))?;
        if entry.is_dir() {
            return Err(CoreError::Archive(
                "manifest.json is not a regular entry".into(),
            ));
        }
        let mut buf = Vec::new();
        entry
            .read_to_end(&mut buf)
            .map_err(|e| CoreError::Archive(e.to_string()))?;
        buf
    };
    let manifest: ArchiveManifest = serde_json::from_slice(&manifest_bytes)
        .map_err(|e| CoreError::Archive(format!("invalid manifest.json: {e}")))?;
    validate_manifest(&manifest)?;
    if !is_supported_format_version(manifest.format_version) {
        return Err(CoreError::Archive("unsupported .cva format version".into()));
    }
    validate_payload_names(&manifest, names.iter().map(String::as_str))?;

    let mut payloads = BTreeMap::new();
    let mut total = 0u64;
    for declared in &manifest.entries {
        let mut entry = zip.by_name(&declared.path).map_err(|_| {
            CoreError::Archive(format!("missing declared entry '{}'", declared.path))
        })?;
        if entry.is_dir() {
            return Err(CoreError::Archive(format!(
                "'{}' is not a regular file entry",
                declared.path
            )));
        }
        // Reject symlinks/devices via the stored Unix mode when present
        // (spec §6.2: "symlink, hard-link, device, or other non-regular
        // entry"). Archives written on platforms without Unix permission
        // bits (Windows) carry no such bit, so absence is not itself a
        // rejection — only an explicit non-regular mode is.
        if let Some(mode) = entry.unix_mode() {
            const S_IFMT: u32 = 0o170000;
            const S_IFREG: u32 = 0o100000;
            if mode & S_IFMT != 0 && mode & S_IFMT != S_IFREG {
                return Err(CoreError::Archive(format!(
                    "'{}' is not a regular file",
                    declared.path
                )));
            }
        }
        let compressed = entry.compressed_size();
        let uncompressed = entry.size();
        if uncompressed != declared.bytes {
            return Err(CoreError::Archive(format!(
                "'{}' length does not match the manifest",
                declared.path
            )));
        }
        if uncompressed > MAX_ENTRY_BYTES {
            return Err(CoreError::Archive(
                "archive entry exceeds the size limit".into(),
            ));
        }
        if compressed > 0
            && uncompressed / compressed.max(1) > conva_core::archive::MAX_COMPRESSION_RATIO
        {
            return Err(CoreError::Archive(
                "archive entry exceeds the compression ratio limit".into(),
            ));
        }
        total = total
            .checked_add(uncompressed)
            .filter(|t| *t <= MAX_UNCOMPRESSED_BYTES)
            .ok_or_else(|| {
                CoreError::Archive("archive exceeds the uncompressed size limit".into())
            })?;

        let mut buf = Vec::with_capacity(uncompressed as usize);
        entry
            .read_to_end(&mut buf)
            .map_err(|e| CoreError::Archive(e.to_string()))?;
        if sha256_hex(&buf) != declared.sha256 {
            return Err(CoreError::Archive(format!(
                "'{}' does not match its declared checksum",
                declared.path
            )));
        }
        payloads.insert(declared.path.clone(), buf);
    }
    let _ = total;

    Ok(LoadedArchive {
        manifest,
        archive_digest,
        payloads,
    })
}

// ── Import provenance ledger ─────────────────────────────────────────────

/// Minimal local import provenance (spec §7.3): which archive digests this
/// installation has already imported, so `inspect` can warn on a repeat
/// import. One JSON array at `<app-data>/archive-imports.json`. Best-effort
/// — a read/parse failure degrades to "nothing recorded yet" rather than
/// failing import/inspect, since this is a non-critical duplicate hint, not
/// the transactional record of the import itself (that's the imported
/// Context/conversation/documents on disk).
pub fn imports_ledger_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("archive-imports.json")
}

pub fn load_imported_digests(ledger_path: &Path) -> BTreeSet<String> {
    fs::read_to_string(ledger_path)
        .ok()
        .and_then(|s| serde_json::from_str::<Vec<String>>(&s).ok())
        .map(|v| v.into_iter().collect())
        .unwrap_or_default()
}

pub fn record_imported_digest(ledger_path: &Path, digest: &str) {
    let mut digests = load_imported_digests(ledger_path);
    if !digests.insert(digest.to_string()) {
        return;
    }
    if let Ok(json) = serde_json::to_string_pretty(&digests.into_iter().collect::<Vec<_>>()) {
        let _ = fs::write(ledger_path, json);
    }
}

// ── Inspect ───────────────────────────────────────────────────────────────

fn context_preview(
    context: &PortableContextV1,
    has_source_documents: bool,
) -> ArchiveContextPreview {
    ArchiveContextPreview {
        title: context.title.clone(),
        category: context.category,
        key_terms_count: context.key_terms.len() as u32,
        prepared_qa_count: 0, // Q&A lives in generated text, not a countable field here.
        has_source_documents,
    }
}

fn conversation_preview(conversation: &PortableConversationV1) -> ArchiveConversationPreview {
    let mut speakers = std::collections::HashSet::new();
    let mut start = u64::MAX;
    let mut end = 0u64;
    for seg in &conversation.segments {
        speakers.insert(seg.side);
        start = start.min(seg.start_ms);
        end = end.max(seg.end_ms);
    }
    ArchiveConversationPreview {
        title: conversation.title.clone(),
        created_at_unix_ms: conversation.created_at_unix_ms,
        segment_count: conversation.segments.len() as u32,
        speaker_count: speakers.len() as u32,
        duration_ms: end.saturating_sub(if start == u64::MAX { 0 } else { start }),
        has_claim_review: conversation
            .claim_snapshots
            .iter()
            .any(|s| !s.claims.is_empty()),
    }
}

/// Side-effect-free preview (spec §8.3/Checkpoint C). Selecting a file for
/// inspection never creates a record — this function only reads.
pub fn inspect(
    path: &Path,
    previously_imported_digests: &BTreeSet<String>,
) -> Result<ArchiveInspection, CoreError> {
    let loaded = load_archive(path)?;
    let context: Option<PortableContextV1> = loaded.json("context/context.json")?;
    let conversation: Option<PortableConversationV1> =
        loaded.json("conversation/conversation.json")?;
    let documents: Vec<PortableDocumentV1> =
        loaded.json("documents/index.json")?.unwrap_or_default();
    let artifacts: Vec<PortableGeneratedArtifactV1> =
        loaded.json("generated/index.json")?.unwrap_or_default();
    if let Some(context) = &context {
        validate_document_index(context, &documents, &artifacts)?;
    }

    let artifact_doc_ids: BTreeSet<&str> =
        artifacts.iter().map(|a| a.document_id.as_str()).collect();
    let has_source_documents = documents
        .iter()
        .any(|d| d.archive_path.is_some() && !artifact_doc_ids.contains(d.id.as_str()));

    let mut warnings = Vec::new();
    if previously_imported_digests.contains(&loaded.archive_digest) {
        warnings.push(ArchiveCompatibilityWarning::DuplicateArchiveDigest);
    }
    if loaded.manifest.format_version != FORMAT_VERSION {
        warnings.push(ArchiveCompatibilityWarning::MigratedFromOlderVersion {
            from_format_version: loaded.manifest.format_version,
        });
    }
    let document_previews: Vec<ArchiveDocumentPreview> = documents
        .iter()
        .map(|d| ArchiveDocumentPreview {
            portable_id: d.id.clone(),
            file_name: d.file_name.clone(),
            bytes: d.bytes,
            included: d.archive_path.is_some() || artifact_doc_ids.contains(d.id.as_str()),
        })
        .collect();

    Ok(ArchiveInspection {
        archive_digest: loaded.archive_digest,
        format_version: loaded.manifest.format_version,
        created_by_app_version: loaded.manifest.created_by.app_version.clone(),
        created_at: loaded.manifest.created_at.clone(),
        title: loaded.manifest.title.clone(),
        context: context.map(|c| context_preview(&c, has_source_documents)),
        conversation: conversation.as_ref().map(conversation_preview),
        documents: document_previews,
        warnings,
    })
}

// ── Import ────────────────────────────────────────────────────────────────

/// Drop references to documents that were not actually staged (omitted:
/// metadata-only, excluded by the user, or failed ingestion) before handing
/// the portable Context to `archive_payload::import_context`, which requires
/// *every* reference to resolve — the "does the user continue without this
/// document" policy decision (spec §6.3) lives here, at the shell layer, not
/// in the pure crate.
fn filter_context_doc_refs(
    mut portable: PortableContextV1,
    available: &BTreeSet<String>,
) -> PortableContextV1 {
    portable.source_doc_ids.retain(|id| available.contains(id));
    for docs in portable.slot_doc_ids.values_mut() {
        docs.retain(|id| available.contains(id));
    }
    portable.slot_doc_ids.retain(|_, docs| !docs.is_empty());
    if portable
        .dossier_doc_id
        .as_ref()
        .is_some_and(|id| !available.contains(id))
    {
        portable.dossier_doc_id = None;
    }
    if portable
        .research_doc_id
        .as_ref()
        .is_some_and(|id| !available.contains(id))
    {
        portable.research_doc_id = None;
    }
    if portable
        .qa_doc_id
        .as_ref()
        .is_some_and(|id| !available.contains(id))
    {
        portable.qa_doc_id = None;
    }
    if let Some(profile) = &mut portable.knowledge_profile {
        profile.doc_ids.retain(|id| available.contains(id));
    }
    portable
}

fn filter_conversation_doc_refs(
    mut portable: PortableConversationV1,
    available: &BTreeSet<String>,
) -> PortableConversationV1 {
    portable.linked_docs.retain(|id| available.contains(id));
    for snapshot in &mut portable.claim_snapshots {
        for claim in &mut snapshot.claims {
            for evidence in &mut claim.evidence {
                if evidence
                    .local_document_id
                    .as_ref()
                    .is_some_and(|id| !available.contains(id))
                {
                    evidence.local_document_id = None;
                }
            }
        }
    }
    portable
}

/// Stage every included document/generated artifact into `rag` through its
/// *normal* ingestion path (`RagStore::ingest`/`ingest_generated_artifact`)
/// — the same validation, parsing, and indexing a manual upload gets (spec
/// Checkpoint C: "stage document ingestion using the existing normal
/// validation/indexing path"). Returns the portable→destination id map plus
/// the list of newly created document ids (for rollback) and every omitted
/// reference with a user-facing reason. `context_id` tags generated
/// artifacts exactly as `RagStore::ingest_generated_artifact` requires;
/// pass a freshly minted id that is not yet persisted anywhere else.
/// `(portable id -> destination id, newly staged destination ids, omitted
/// references with reasons)`.
type StagedDocuments = (
    BTreeMap<String, String>,
    Vec<String>,
    Vec<ArchiveOmittedDocument>,
);

fn stage_documents(
    rag: &RagStore,
    documents: &[PortableDocumentV1],
    artifacts: &[PortableGeneratedArtifactV1],
    payloads: &BTreeMap<String, Vec<u8>>,
    include_document_ids: &BTreeSet<String>,
    context_id: &str,
    cancel: &CancelFn<'_>,
) -> Result<StagedDocuments, ImportOutcomeError> {
    let artifact_by_doc: BTreeMap<&str, &PortableGeneratedArtifactV1> = artifacts
        .iter()
        .map(|a| (a.document_id.as_str(), a))
        .collect();
    let mut id_map = BTreeMap::new();
    let mut staged = Vec::new();
    let mut omitted = Vec::new();

    for doc in documents {
        if cancel() {
            rollback_staged(rag, &staged);
            return Err(ImportOutcomeError::Cancelled);
        }
        if let Some(artifact) = artifact_by_doc.get(doc.id.as_str()) {
            let Some(bytes) = payloads.get(&artifact.archive_path) else {
                omitted.push(ArchiveOmittedDocument {
                    portable_id: doc.id.clone(),
                    reason: "generated content missing from archive".into(),
                });
                continue;
            };
            let text = String::from_utf8_lossy(bytes);
            match rag.ingest_generated_artifact(&doc.file_name, &text, context_id) {
                Ok(report) => {
                    staged.push(report.document.id.clone());
                    id_map.insert(doc.id.clone(), report.document.id.clone());
                }
                Err(e) => omitted.push(ArchiveOmittedDocument {
                    portable_id: doc.id.clone(),
                    reason: e.to_string(),
                }),
            }
            continue;
        }
        let Some(archive_path) = &doc.archive_path else {
            omitted.push(ArchiveOmittedDocument {
                portable_id: doc.id.clone(),
                reason: "source document was not included in this archive".into(),
            });
            continue;
        };
        if !include_document_ids.contains(&doc.id) {
            omitted.push(ArchiveOmittedDocument {
                portable_id: doc.id.clone(),
                reason: "excluded by the import selection".into(),
            });
            continue;
        }
        let Some(bytes) = payloads.get(archive_path) else {
            omitted.push(ArchiveOmittedDocument {
                portable_id: doc.id.clone(),
                reason: "document bytes missing from archive".into(),
            });
            continue;
        };
        let tmp_dir = std::env::temp_dir().join(format!(
            "conva-cva-import-{}-{:08x}",
            crate::session::now_unix_ms(),
            rand::random::<u32>()
        ));
        let stage_result = (|| -> Result<IngestReport, CoreError> {
            fs::create_dir_all(&tmp_dir).map_err(|e| CoreError::Archive(e.to_string()))?;
            let tmp_path = tmp_dir.join(&doc.file_name);
            fs::write(&tmp_path, bytes).map_err(|e| CoreError::Archive(e.to_string()))?;
            let report = rag
                .ingest(tmp_path.to_string_lossy().as_ref())
                .map_err(|e| CoreError::Archive(e.to_string()))?;
            Ok(report)
        })();
        let _ = fs::remove_dir_all(&tmp_dir);
        match stage_result {
            Ok(report) => {
                staged.push(report.document.id.clone());
                id_map.insert(doc.id.clone(), report.document.id.clone());
            }
            Err(e) => omitted.push(ArchiveOmittedDocument {
                portable_id: doc.id.clone(),
                reason: e.to_string(),
            }),
        }
    }
    Ok((id_map, staged, omitted))
}

fn rollback_staged(rag: &RagStore, staged: &[String]) {
    for id in staged {
        let _ = rag.delete(id);
    }
}

/// Result of a successful Context import that still needs its two
/// AppHandle-touching persistence calls (`context::save`/`save_profile`) —
/// kept separate so this function (and its rollback path) stays testable
/// without `AppHandle`. `imported_document_ids`/`omitted_documents` are
/// already final; the caller only needs to persist `context`/`profile` and,
/// on failure to do so, call [`rollback_staged`] with `staged_document_ids`.
pub struct ImportedContext {
    pub context: ConversationContext,
    pub profile: Option<KnowledgeProfile>,
    pub imported_document_ids: Vec<String>,
    pub staged_document_ids: Vec<String>,
    pub omitted_documents: Vec<ArchiveOmittedDocument>,
    pub archive_digest: String,
}

/// Validate, stage documents, and build the destination Context (Checkpoint
/// C). Documents are staged for real (there is no separate "staging area" in
/// this app's file-per-record persistence — see module doc comment); on any
/// failure after staging begins, every staged document is deleted before
/// returning `Err`, so a rejected import never leaves partial records.
pub fn import_context(
    path: &Path,
    rag: &RagStore,
    options: &ArchiveImportOptions,
    operation_id: &str,
    progress: &mut ProgressFn<'_>,
    cancel: &CancelFn<'_>,
) -> Result<ImportedContext, ImportOutcomeError> {
    progress(ArchiveProgressEvent::Validating {
        operation_id: operation_id.to_string(),
    });
    let loaded = load_archive(path)?;
    let Some(mut context): Option<PortableContextV1> = loaded.json("context/context.json")? else {
        return Err(CoreError::Archive("archive has no Context to import".into()).into());
    };
    if let Some(title) = &options.context_title {
        if !title.trim().is_empty() {
            context.title = title.trim().to_string();
        }
    }
    let documents: Vec<PortableDocumentV1> =
        loaded.json("documents/index.json")?.unwrap_or_default();
    let artifacts: Vec<PortableGeneratedArtifactV1> =
        loaded.json("generated/index.json")?.unwrap_or_default();
    validate_document_index(&context, &documents, &artifacts).map_err(CoreError::from)?;

    if cancel() {
        return Err(ImportOutcomeError::Cancelled);
    }
    let context_id = mint_id("sim");
    let include: BTreeSet<String> = options.include_document_ids.iter().cloned().collect();
    progress(ArchiveProgressEvent::Importing {
        operation_id: operation_id.to_string(),
        processed_items: 0,
        total_items: documents.len() as u32,
    });
    let (doc_id_map, staged, omitted) = stage_documents(
        rag,
        &documents,
        &artifacts,
        &loaded.payloads,
        &include,
        &context_id,
        cancel,
    )?;

    let available: BTreeSet<String> = doc_id_map.keys().cloned().collect();
    let filtered = filter_context_doc_refs(context, &available);
    let profile_id = filtered.knowledge_profile.as_ref().map(|_| mint_id("kp"));
    let ids = ContextImportIds {
        context_id: context_id.clone(),
        document_ids: doc_id_map,
        profile_id,
        conversation_id: None,
    };
    let (context, profile) = match import_context_dto(filtered, &ids) {
        Ok(v) => v,
        Err(e) => {
            rollback_staged(rag, &staged);
            return Err(CoreError::from(e).into());
        }
    };

    Ok(ImportedContext {
        context,
        profile,
        imported_document_ids: staged.clone(),
        staged_document_ids: staged,
        omitted_documents: omitted,
        archive_digest: loaded.archive_digest,
    })
}

pub struct ImportedConversationOutcome {
    pub conversation: ImportedConversation,
    pub context: Option<ConversationContext>,
    pub profile: Option<KnowledgeProfile>,
    pub imported_document_ids: Vec<String>,
    pub staged_document_ids: Vec<String>,
    pub omitted_documents: Vec<ArchiveOmittedDocument>,
    pub archive_digest: String,
}

/// Import a saved conversation, optionally bundled with its linked Context
/// (Checkpoint D) — same staging/rollback discipline as [`import_context`].
pub fn import_conversation(
    path: &Path,
    rag: &RagStore,
    options: &ArchiveImportOptions,
    operation_id: &str,
    progress: &mut ProgressFn<'_>,
    cancel: &CancelFn<'_>,
) -> Result<ImportedConversationOutcome, ImportOutcomeError> {
    progress(ArchiveProgressEvent::Validating {
        operation_id: operation_id.to_string(),
    });
    let loaded = load_archive(path)?;
    let Some(mut conversation): Option<PortableConversationV1> =
        loaded.json("conversation/conversation.json")?
    else {
        return Err(CoreError::Archive("archive has no conversation to import".into()).into());
    };
    if let Some(title) = &options.conversation_title {
        if !title.trim().is_empty() {
            conversation.title = title.trim().to_string();
        }
    }
    let mut context: Option<PortableContextV1> = loaded.json("context/context.json")?;
    if let Some(title) = &options.context_title {
        if let Some(context) = &mut context {
            if !title.trim().is_empty() {
                context.title = title.trim().to_string();
            }
        }
    }
    let documents: Vec<PortableDocumentV1> =
        loaded.json("documents/index.json")?.unwrap_or_default();
    let artifacts: Vec<PortableGeneratedArtifactV1> =
        loaded.json("generated/index.json")?.unwrap_or_default();
    if let Some(context) = &context {
        validate_document_index(context, &documents, &artifacts).map_err(CoreError::from)?;
    }

    if cancel() {
        return Err(ImportOutcomeError::Cancelled);
    }
    let conversation_id = mint_id("conv");
    let context_id = context.as_ref().map(|_| mint_id("sim"));
    let staging_context_id = context_id
        .clone()
        .unwrap_or_else(|| conversation_id.clone());
    let include: BTreeSet<String> = options.include_document_ids.iter().cloned().collect();
    progress(ArchiveProgressEvent::Importing {
        operation_id: operation_id.to_string(),
        processed_items: 0,
        total_items: documents.len() as u32,
    });
    let (doc_id_map, staged, omitted) = stage_documents(
        rag,
        &documents,
        &artifacts,
        &loaded.payloads,
        &include,
        &staging_context_id,
        cancel,
    )?;
    let available: BTreeSet<String> = doc_id_map.keys().cloned().collect();

    let filtered_conversation = filter_conversation_doc_refs(conversation, &available);
    let conversation_ids = ConversationImportIds {
        conversation_id: conversation_id.clone(),
        document_ids: doc_id_map.clone(),
        session_ids: filtered_conversation
            .source_session_ids
            .iter()
            .map(|id| (id.clone(), mint_id("session")))
            .collect(),
        claim_ids: filtered_conversation
            .claim_snapshots
            .iter()
            .flat_map(|s| s.claims.iter())
            .map(|c| (c.id.clone(), mint_id("claim")))
            .collect(),
        context_id: context_id.clone(),
    };

    let (imported_context, profile) = match &context {
        Some(context_portable) => {
            let filtered = filter_context_doc_refs(context_portable.clone(), &available);
            let profile_id = filtered.knowledge_profile.as_ref().map(|_| mint_id("kp"));
            let context_ids = ContextImportIds {
                context_id: context_id
                    .clone()
                    .expect("context_id set when context present"),
                document_ids: doc_id_map,
                profile_id,
                // Only claim the conversation link on the Context side when
                // the exported Context actually declared it — an export
                // taken before the two were linked (or a Context export
                // that never points back) must not invent the relationship
                // on import (`import_context_dto` requires this to agree
                // with the portable Context's own `conversation_id`).
                conversation_id: context_portable
                    .conversation_id
                    .is_some()
                    .then(|| conversation_id.clone()),
            };
            if let Err(e) = validate_paired_import_ids(&context_ids, &conversation_ids) {
                rollback_staged(rag, &staged);
                return Err(CoreError::from(e).into());
            }
            match import_context_dto(filtered, &context_ids) {
                Ok((c, p)) => (Some(c), p),
                Err(e) => {
                    rollback_staged(rag, &staged);
                    return Err(CoreError::from(e).into());
                }
            }
        }
        None => (None, None),
    };

    let imported = match import_conversation_dto(filtered_conversation, &conversation_ids) {
        Ok(v) => v,
        Err(e) => {
            rollback_staged(rag, &staged);
            return Err(CoreError::from(e).into());
        }
    };

    Ok(ImportedConversationOutcome {
        conversation: imported,
        context: imported_context,
        profile,
        imported_document_ids: staged.clone(),
        staged_document_ids: staged,
        omitted_documents: omitted,
        archive_digest: loaded.archive_digest,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use conva_core::context::{ContextCategory, ContextStatus};

    fn temp_dir(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "conva-archive-test-{label}-{}-{:08x}",
            crate::session::now_unix_ms(),
            rand::random::<u32>()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn minimal_context(id: &str, title: &str) -> ConversationContext {
        ConversationContext {
            id: id.into(),
            title: title.into(),
            purpose: "Prepare".into(),
            job_description: None,
            category: ContextCategory::Other,
            participation_lens: None,
            source_policy: None,
            status: ContextStatus::Draft,
            created_at_unix_ms: 1_700_000_000_000,
            updated_at_unix_ms: 1_700_000_000_000,
            source_doc_ids: vec![],
            slot_doc_ids: BTreeMap::new(),
            auto_generate_context: false,
            research_enabled: false,
            deep_qa_enabled: false,
            key_terms: vec!["alpha".into(), "beta".into()],
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
        }
    }

    #[test]
    fn minimal_context_round_trips_export_inspect_import_on_a_separate_store() {
        let dest_dir = temp_dir("dest");
        let dest = dest_dir.join("export.cva");
        let source_rag = RagStore::open(&dest_dir.join("source-rag")).unwrap();
        let context = minimal_context("ctx-old", "Weekly sync");

        let result = export_context(
            &context,
            None,
            &source_rag,
            &ArchiveExportOptions {
                include_source_documents: true,
            },
            &dest,
            "test-op",
            &mut noop_progress,
            &noop_cancel,
        )
        .unwrap();
        assert!(dest.exists());
        assert_eq!(result.destination, dest.to_string_lossy());

        // Inspect is side-effect-free: a fresh destination store stays empty.
        let dest_rag = RagStore::open(&dest_dir.join("dest-rag")).unwrap();
        let inspection = inspect(&dest, &BTreeSet::new()).unwrap();
        assert_eq!(inspection.archive_digest, result.archive_digest);
        assert!(inspection.context.is_some());
        assert_eq!(inspection.context.unwrap().title, "Weekly sync");
        assert!(dest_rag.list().is_empty());

        // Import on the SEPARATE destination store.
        let imported = import_context(
            &dest,
            &dest_rag,
            &ArchiveImportOptions {
                context_title: None,
                conversation_title: None,
                include_document_ids: vec![],
                reuse_exact_document_ids: vec![],
            },
            "test-op",
            &mut noop_progress,
            &noop_cancel,
        )
        .unwrap();
        assert_ne!(imported.context.id, "ctx-old");
        assert_eq!(imported.context.title, "Weekly sync");
        assert_eq!(imported.context.key_terms, context.key_terms);
        assert!(imported.omitted_documents.is_empty());
    }

    #[test]
    fn context_with_source_document_stages_it_through_normal_ingest() {
        let dir = temp_dir("withdoc");
        let source_rag = RagStore::open(&dir.join("source-rag")).unwrap();
        let ingested = source_rag
            .ingest_text("Notes", "Some real reference text.")
            .unwrap();
        let mut context = minimal_context("ctx-old", "Case file");
        context.source_doc_ids = vec![ingested.document.id.clone()];

        let dest = dir.join("export.cva");
        export_context(
            &context,
            None,
            &source_rag,
            &ArchiveExportOptions {
                include_source_documents: true,
            },
            &dest,
            "test-op",
            &mut noop_progress,
            &noop_cancel,
        )
        .unwrap();

        let dest_rag = RagStore::open(&dir.join("dest-rag")).unwrap();
        let inspection = inspect(&dest, &BTreeSet::new()).unwrap();
        let include_document_ids: Vec<String> = inspection
            .documents
            .iter()
            .filter(|d| d.included)
            .map(|d| d.portable_id.clone())
            .collect();
        assert_eq!(include_document_ids.len(), 1);

        let imported = import_context(
            &dest,
            &dest_rag,
            &ArchiveImportOptions {
                context_title: None,
                conversation_title: None,
                include_document_ids,
                reuse_exact_document_ids: vec![],
            },
            "test-op",
            &mut noop_progress,
            &noop_cancel,
        )
        .unwrap();
        assert_eq!(imported.context.source_doc_ids.len(), 1);
        let new_doc_id = &imported.context.source_doc_ids[0];
        assert_ne!(new_doc_id, &ingested.document.id);
        assert!(dest_rag
            .document_text(new_doc_id)
            .unwrap()
            .contains("real reference text"));
    }

    #[test]
    fn excluding_a_document_omits_it_but_still_imports_the_context() {
        let dir = temp_dir("excluded");
        let source_rag = RagStore::open(&dir.join("source-rag")).unwrap();
        let ingested = source_rag
            .ingest_text("Notes", "Excludable content.")
            .unwrap();
        let mut context = minimal_context("ctx-old", "Case file");
        context.source_doc_ids = vec![ingested.document.id.clone()];

        let dest = dir.join("export.cva");
        export_context(
            &context,
            None,
            &source_rag,
            &ArchiveExportOptions {
                include_source_documents: true,
            },
            &dest,
            "test-op",
            &mut noop_progress,
            &noop_cancel,
        )
        .unwrap();

        let dest_rag = RagStore::open(&dir.join("dest-rag")).unwrap();
        let imported = import_context(
            &dest,
            &dest_rag,
            &ArchiveImportOptions {
                context_title: None,
                conversation_title: None,
                include_document_ids: vec![], // explicitly exclude everything
                reuse_exact_document_ids: vec![],
            },
            "test-op",
            &mut noop_progress,
            &noop_cancel,
        )
        .unwrap();
        assert!(imported.context.source_doc_ids.is_empty());
        assert_eq!(imported.omitted_documents.len(), 1);
        assert!(dest_rag.list().is_empty());
    }

    #[test]
    fn metadata_only_export_never_writes_source_bytes_and_import_omits_it() {
        let dir = temp_dir("metaonly");
        let source_rag = RagStore::open(&dir.join("source-rag")).unwrap();
        let ingested = source_rag
            .ingest_text("Notes", "Private content not to travel.")
            .unwrap();
        let mut context = minimal_context("ctx-old", "Context only export");
        context.source_doc_ids = vec![ingested.document.id.clone()];

        let dest = dir.join("export.cva");
        export_context(
            &context,
            None,
            &source_rag,
            &ArchiveExportOptions {
                include_source_documents: false,
            },
            &dest,
            "test-op",
            &mut noop_progress,
            &noop_cancel,
        )
        .unwrap();

        let bytes = fs::read(&dest).unwrap();
        assert!(
            !bytes
                .windows(b"Private content".len())
                .any(|w| w == b"Private content"),
            "metadata-only export must never contain the source document's bytes"
        );

        let dest_rag = RagStore::open(&dir.join("dest-rag")).unwrap();
        let imported = import_context(
            &dest,
            &dest_rag,
            &ArchiveImportOptions {
                context_title: None,
                conversation_title: None,
                include_document_ids: vec![],
                reuse_exact_document_ids: vec![],
            },
            "test-op",
            &mut noop_progress,
            &noop_cancel,
        )
        .unwrap();
        assert!(imported.context.source_doc_ids.is_empty());
        assert_eq!(imported.omitted_documents.len(), 1);
        assert_eq!(
            imported.omitted_documents[0].reason,
            "source document was not included in this archive"
        );
    }

    #[test]
    fn tampered_entry_bytes_are_rejected_before_any_import() {
        let dir = temp_dir("tampered");
        let source_rag = RagStore::open(&dir.join("source-rag")).unwrap();
        let context = minimal_context("ctx-old", "Tamper test");
        let dest = dir.join("export.cva");
        export_context(
            &context,
            None,
            &source_rag,
            &ArchiveExportOptions {
                include_source_documents: true,
            },
            &dest,
            "test-op",
            &mut noop_progress,
            &noop_cancel,
        )
        .unwrap();

        // Corrupt a byte in the middle of the file (past the local header) —
        // proves checksum validation actually runs, not just presence.
        let mut bytes = fs::read(&dest).unwrap();
        let mid = bytes.len() / 2;
        bytes[mid] ^= 0xFF;
        fs::write(&dest, &bytes).unwrap();

        let dest_rag = RagStore::open(&dir.join("dest-rag")).unwrap();
        let result = import_context(
            &dest,
            &dest_rag,
            &ArchiveImportOptions {
                context_title: None,
                conversation_title: None,
                include_document_ids: vec![],
                reuse_exact_document_ids: vec![],
            },
            "test-op",
            &mut noop_progress,
            &noop_cancel,
        );
        assert!(result.is_err());
        assert!(
            dest_rag.list().is_empty(),
            "a rejected archive must create no records"
        );
    }

    #[test]
    fn oversized_archive_is_rejected_by_the_size_limit() {
        let dir = temp_dir("oversized");
        let dest = dir.join("huge.cva");
        // A manifest-valid but declared-oversized entry: this only needs to
        // trip the *file size* gate, not actually contain that much data.
        let manifest = ArchiveManifest {
            format: FORMAT.to_owned(),
            format_version: FORMAT_VERSION,
            created_at: now_iso(),
            created_by: ArchiveCreator {
                app: APP_NAME.into(),
                app_version: APP_VERSION.into(),
            },
            title: "Huge".into(),
            contents: ArchiveContents {
                context: true,
                conversation: false,
                documents: 0,
                generated_artifacts: 0,
            },
            entries: vec![ArchiveEntry {
                path: "context/context.json".into(),
                media_type: "application/json".into(),
                bytes: 2,
                sha256: "a".repeat(64),
            }],
        };
        write_archive_atomic(
            &dest,
            &manifest,
            &[PendingEntry {
                path: "context/context.json".into(),
                media_type: "application/json".into(),
                bytes: b"{}".to_vec(),
            }],
        )
        .unwrap();
        // Now pad the file past the archive size limit by growing an unused
        // trailing region — cheap way to exercise the file-size gate without
        // materializing hundreds of MB of real ZIP content in a unit test.
        let file = std::fs::OpenOptions::new()
            .append(true)
            .open(&dest)
            .unwrap();
        file.set_len(MAX_ARCHIVE_BYTES + 1024).unwrap();

        let result = inspect(&dest, &BTreeSet::new());
        assert!(result.is_err());
    }

    #[test]
    fn cancelling_mid_import_rolls_back_every_staged_document() {
        let dir = temp_dir("cancel");
        let source_rag = RagStore::open(&dir.join("source-rag")).unwrap();
        let doc_a = source_rag
            .ingest_text("A", "First document content.")
            .unwrap();
        let doc_b = source_rag
            .ingest_text("B", "Second document content.")
            .unwrap();
        let mut context = minimal_context("ctx-old", "Cancel test");
        context.source_doc_ids = vec![doc_a.document.id.clone(), doc_b.document.id.clone()];

        let dest = dir.join("export.cva");
        export_context(
            &context,
            None,
            &source_rag,
            &ArchiveExportOptions {
                include_source_documents: true,
            },
            &dest,
            "test-op",
            &mut noop_progress,
            &noop_cancel,
        )
        .unwrap();

        let dest_rag = RagStore::open(&dir.join("dest-rag")).unwrap();
        let inspection = inspect(&dest, &BTreeSet::new()).unwrap();
        let include_document_ids: Vec<String> = inspection
            .documents
            .iter()
            .map(|d| d.portable_id.clone())
            .collect();

        // Cancel takes effect after the first document has already been
        // staged, so rollback has real work to do.
        let counter = std::cell::Cell::new(0u32);
        let cancel = || {
            let n = counter.get() + 1;
            counter.set(n);
            n > 1
        };
        let result = import_context(
            &dest,
            &dest_rag,
            &ArchiveImportOptions {
                context_title: None,
                conversation_title: None,
                include_document_ids,
                reuse_exact_document_ids: vec![],
            },
            "test-op",
            &mut noop_progress,
            &cancel,
        );
        assert!(matches!(result, Err(ImportOutcomeError::Cancelled)));
        assert!(
            dest_rag.list().is_empty(),
            "cancellation must roll back every already-staged document"
        );
    }

    #[test]
    fn conversation_with_context_round_trips_and_agrees_on_the_link() {
        use conva_core::asr::TranscriptSegment;
        use conva_core::audio::StreamSide;

        let dir = temp_dir("conv");
        let source_rag = RagStore::open(&dir.join("source-rag")).unwrap();
        let mut context = minimal_context("ctx-old", "Linked context");
        // Realistic bidirectional link, as the app actually saves it: the
        // Context points at the conversation it was grounding.
        context.conversation_id = Some("conv-old".into());
        let segments = vec![TranscriptSegment {
            side: StreamSide::Outbound,
            seq: 0,
            text: "Hello there".into(),
            is_final: true,
            start_ms: 0,
            end_ms: 1000,
            confidence: Some(0.9),
            latency_ms: 10,
        }];
        let input = ConversationExportInput {
            id: "conv-old",
            title: "Case call",
            created_at_unix_ms: 1,
            updated_at_unix_ms: 2,
            segments: &segments,
            linked_docs: &[],
            linked_context_id: Some("ctx-old"),
            source_session_ids: &[],
            claim_snapshots: &[],
        };
        let dest = dir.join("export.cva");
        export_conversation(
            input,
            Some((&context, None)),
            &source_rag,
            &ArchiveExportOptions {
                include_source_documents: true,
            },
            &dest,
            "test-op",
            &mut noop_progress,
            &noop_cancel,
        )
        .unwrap();

        let dest_rag = RagStore::open(&dir.join("dest-rag")).unwrap();
        let inspection = inspect(&dest, &BTreeSet::new()).unwrap();
        assert!(inspection.context.is_some());
        assert!(inspection.conversation.is_some());
        assert_eq!(inspection.conversation.unwrap().segment_count, 1);

        let imported = import_conversation(
            &dest,
            &dest_rag,
            &ArchiveImportOptions {
                context_title: None,
                conversation_title: None,
                include_document_ids: vec![],
                reuse_exact_document_ids: vec![],
            },
            "test-op",
            &mut noop_progress,
            &noop_cancel,
        )
        .unwrap();
        let imported_context = imported.context.unwrap();
        assert_eq!(
            imported.conversation.linked_context_id.as_deref(),
            Some(imported_context.id.as_str())
        );
        assert_eq!(
            imported_context.conversation_id.as_deref(),
            Some(imported.conversation.id.as_str())
        );
    }
}

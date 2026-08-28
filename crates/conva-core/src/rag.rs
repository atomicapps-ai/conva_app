//! RAG / Vector Layer contract (design §4.4).
//!
//! Phase 1 implementation: fastembed (BGE-small) + embedded LanceDB with
//! hybrid vector+BM25 retrieval. This module defines the boundary only.

use async_trait::async_trait;
use serde::{Deserialize, Serialize};

use crate::CoreError;

/// Where a library document came from — drives the library's provenance badge
/// and filter chips (Conversation Context UI, "organized library").
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DocSource {
    /// Picked or dropped in as a file. The default for documents ingested
    /// before this field existed (`serde(default)`), which is accurate for
    /// the overwhelming majority of pre-existing libraries.
    #[default]
    File,
    /// Saved from pasted/typed text ("paste from clipboard" flow).
    Pasted,
    /// Written by conva itself (e.g. a generated Context Digest) — the
    /// library's "By conva" filter and badge.
    Generated,
}

/// A document registered in the RAG library (U5).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RagDocument {
    pub id: String,
    pub file_name: String,
    /// Whether this document participates in retrieval (per-doc toggle, U5).
    pub enabled: bool,
    pub chunk_count: u32,
    pub ingested_at_unix_ms: u64,
    /// Provenance — see [`DocSource`].
    #[serde(default)]
    pub source: DocSource,
    /// Conversation Context ids this document is attached to (a doc can
    /// ground more than one context). Empty for library documents not
    /// attached to any context. Drives the library's "In this context" filter.
    #[serde(default)]
    pub context_ids: Vec<String>,
    /// Content size in bytes (Contexts-screen-redesign spec, requirement 6)
    /// — the real on-disk file size for a file-sourced document, or the
    /// ingested text's byte length for pasted/generated content (see
    /// `store_text_document` in `src-tauri/src/rag.rs` for exactly which,
    /// per source). `#[serde(default)]` gives `0` for documents ingested
    /// before this field existed — same backward-compat pattern `source`
    /// above already uses. UI formats this with `formatBytes()`
    /// (`src/lib/formatBytes.ts`), never displays the raw number.
    #[serde(default)]
    pub size_bytes: u64,
}

/// Ingestion outcome reported to the UI (R1/R2).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IngestReport {
    pub document: RagDocument,
    pub warnings: Vec<String>,
}

/// A retrieved chunk with source attribution (R4/R5 — every Ally answer shows
/// which chunks grounded it).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScoredChunk {
    pub document_id: String,
    pub file_name: String,
    /// Heading breadcrumb / page reference for click-through (R1 metadata).
    pub location: String,
    pub text: String,
    /// Fused hybrid score (higher is better).
    pub score: f32,
}

/// The retrieval boundary used by the LLM orchestrator. Budget: <15 ms for
/// `retrieve` at k=8 on a warm store (§2.5).
#[async_trait]
pub trait RagStore: Send + Sync {
    async fn ingest(&self, path: &str) -> Result<IngestReport, CoreError>;
    async fn list_documents(&self) -> Result<Vec<RagDocument>, CoreError>;
    async fn set_enabled(&self, document_id: &str, enabled: bool) -> Result<(), CoreError>;
    async fn delete(&self, document_id: &str) -> Result<(), CoreError>;
    async fn retrieve(&self, query: &str, k: usize) -> Result<Vec<ScoredChunk>, CoreError>;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn old_documents_without_the_new_fields_deserialize_as_file_sourced() {
        // A library document persisted before source/context_ids existed —
        // must still load (serde default), and read as the accurate default:
        // it was ingested as a file (the only path that existed then).
        let old_json = r#"{
            "id": "doc-1",
            "file_name": "resume.pdf",
            "enabled": true,
            "chunk_count": 4,
            "ingested_at_unix_ms": 1000
        }"#;
        let doc: RagDocument = serde_json::from_str(old_json).unwrap();
        assert_eq!(doc.source, DocSource::File);
        assert!(doc.context_ids.is_empty());
    }

    #[test]
    fn doc_source_wire_format_is_snake_case() {
        assert_eq!(serde_json::to_string(&DocSource::File).unwrap(), "\"file\"");
        assert_eq!(
            serde_json::to_string(&DocSource::Pasted).unwrap(),
            "\"pasted\""
        );
        assert_eq!(
            serde_json::to_string(&DocSource::Generated).unwrap(),
            "\"generated\""
        );
    }
}

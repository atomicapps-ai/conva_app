//! `.cva` archive bindings for the browser (Checkpoint E, part 1: inspect
//! only — see `conva_core/docs/technical/cva-import-export-implementation-
//! handoff.md` for exactly what's shipped vs. still owed). Every function
//! below is deliberately thin: decode input, call the real logic in
//! `conva_core::archive`, encode the typed result. No archive/DTO/ZIP logic
//! lives in this crate — it lives once, in `conva-core`, shared with the
//! desktop adapter (`src-tauri/src/archive.rs`).

use std::collections::BTreeSet;

use conva_core::archive::ArchiveCreator;
use conva_core::archive_payload::{
    build_context_archive, ArchivePayloadFile, AssembledContextDocuments, PortableDocumentV1,
    PortableGeneratedArtifactV1,
};
use conva_core::context::{ConversationContext, KnowledgeProfile};
use conva_core::rag::DocSource;
use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

/// `ArchiveInspection` (and every nested preview type) has no `#[serde(rename_all)]`
/// — its field names are plain snake_case, and `src/lib/ipc.ts` mirrors them
/// literally (verified against `ipc.ts` directly, not assumed). serde-wasm-
/// bindgen's DEFAULT serializer produces a JS `Map`/`Set`-based encoding,
/// which a TS caller expecting plain object/array access (`insp.archive_digest`)
/// cannot read. `json_compatible()` instead serializes exactly like `JSON.
/// parse(JSON.stringify(x))` would — plain objects and arrays — matching
/// what `ipc.ts`'s types actually expect.
fn to_js<T: Serialize>(value: &T) -> Result<JsValue, JsValue> {
    value
        .serialize(&serde_wasm_bindgen::Serializer::json_compatible())
        .map_err(|e| JsValue::from_str(&e.to_string()))
}

/// Validate and preview a `.cva` file's bytes — the browser-side twin of
/// desktop's side-effect-free `inspect` (spec §8.3/Checkpoint C). Never
/// persists anything; the caller (`web.ts`'s `archive.inspectArchive`)
/// still has to run `importArchive` afterward to actually save anything.
///
/// `bytes` is the whole archive as read by the browser's `File`/`Blob` APIs
/// (e.g. `new Uint8Array(await file.arrayBuffer())`). Returns the
/// `ArchiveInspection` JSON shape mirrored in `src/lib/ipc.ts`, or throws a
/// `string` (via `Err`) with a safe, displayable message on rejection —
/// every check from spec §6.2 runs before this can succeed.
///
/// Known gap (disclosed, not silent): this always inspects as if nothing
/// was ever previously imported (`DuplicateArchiveDigest` never fires) — the
/// web build has no local import-provenance ledger yet, unlike desktop's
/// `<app-data>/archive-imports.json`. See the Checkpoint E handoff note for
/// what a web-side equivalent would need.
#[wasm_bindgen(js_name = inspectArchiveBytes)]
pub fn inspect_archive_bytes(bytes: &[u8]) -> Result<JsValue, JsValue> {
    let inspection = conva_core::archive::inspect_bytes(bytes, &BTreeSet::new())
        .map_err(|e| JsValue::from_str(&e.to_string()))?;
    to_js(&inspection)
}

// ── Export (Checkpoint E, export slice) ─────────────────────────────────

/// One document the caller already has bytes/text for (or has decided to
/// omit) — the wasm-side input twin of desktop's `assemble_documents`
/// output, except *this* module never touches a document store itself; the
/// browser already fetched everything via the existing hosted library
/// endpoints (`downloadOriginal`/`documentText`) before calling this.
#[derive(Deserialize)]
struct WasmDocInput {
    id: String,
    file_name: String,
    source: DocSource,
    enabled: bool,
    searchable: bool,
    ingested_at_unix_ms: u64,
    media_type: String,
    /// The document's own bytes, when this export includes its full content
    /// (source-document privacy toggle) — `None` for a metadata-only
    /// reference. Always ignored for `source: "generated"` documents: their
    /// content travels through `artifacts` below instead (matching
    /// desktop's `assemble_documents`, which never puts a generated
    /// document's bytes in `PortableDocumentV1` itself).
    #[serde(default)]
    bytes: Option<Vec<u8>>,
}

/// A generated artifact's (dossier/research/prepared-Q&A) text, fetched via
/// the existing `documentText` hosted call — text, not bytes, since that's
/// exactly what the browser already has from that endpoint.
#[derive(Deserialize)]
struct WasmArtifactInput {
    document_id: String,
    kind: conva_core::archive_payload::GeneratedArtifactKind,
    created_at_unix_ms: u64,
    text: String,
}

#[derive(Deserialize)]
struct WasmExportContextInput {
    /// Exactly the JSON shape `web.ts`'s `loadContext`/`saveContext` already
    /// send/receive — the same `ConversationContext` wire format, not a
    /// separate web-only representation.
    context: ConversationContext,
    #[serde(default)]
    profile: Option<KnowledgeProfile>,
    #[serde(default)]
    documents: Vec<WasmDocInput>,
    #[serde(default)]
    artifacts: Vec<WasmArtifactInput>,
    created_at_unix_ms: f64,
    app_version: String,
}

/// Build a Context `.cva`'s complete bytes, ready for a browser download —
/// the browser-side twin of desktop's `export_context`
/// (`src-tauri/src/archive.rs`), sharing the exact same pure assembly logic
/// (`conva_core::archive_payload::build_context_archive`). The caller
/// (`web.ts`'s `archive.exportArchive`) has already fetched every included
/// document's bytes/text via the existing hosted library endpoints — this
/// function does no network I/O itself, only assembly.
///
/// `input` is a single JS object matching [`WasmExportContextInput`] (built
/// via `serde_wasm_bindgen`, which converts a `Uint8Array` field directly
/// into `Vec<u8>` — no base64 round trip needed for document bytes).
#[wasm_bindgen(js_name = exportContextArchiveBytes)]
pub fn export_context_archive_bytes(input: JsValue) -> Result<Vec<u8>, JsValue> {
    let input: WasmExportContextInput = serde_wasm_bindgen::from_value(input)
        .map_err(|e| JsValue::from_str(&format!("invalid export input: {e}")))?;

    let mut documents = Vec::with_capacity(input.documents.len());
    let mut files = Vec::new();
    for d in input.documents {
        // Generated documents' content always travels via `artifacts`, never
        // `PortableDocumentV1` itself — see `WasmDocInput::bytes`'s doc
        // comment. Ignoring a caller mistake here rather than trusting it
        // matches desktop's own `assemble_documents`, which never even asks
        // the caller for generated-document bytes in this field.
        let included = d.source != DocSource::Generated && d.bytes.is_some();
        let archive_path = included.then(|| format!("documents/files/{}", d.id));
        documents.push(PortableDocumentV1 {
            id: d.id.clone(),
            file_name: d.file_name,
            source: d.source,
            enabled: d.enabled,
            searchable: d.searchable,
            ingested_at_unix_ms: d.ingested_at_unix_ms,
            archive_path: archive_path.clone(),
            bytes: included
                .then(|| d.bytes.as_ref().map(|b| b.len() as u64))
                .flatten(),
            sha256: included
                .then(|| d.bytes.as_ref().map(|b| sha256_hex(b)))
                .flatten(),
        });
        if included {
            if let (Some(path), Some(bytes)) = (archive_path, d.bytes) {
                files.push(ArchivePayloadFile {
                    path,
                    media_type: d.media_type,
                    bytes,
                });
            }
        }
    }

    let mut artifacts = Vec::with_capacity(input.artifacts.len());
    for a in input.artifacts {
        let path = format!("generated/files/{}.md", a.document_id);
        artifacts.push(PortableGeneratedArtifactV1 {
            document_id: a.document_id,
            kind: a.kind,
            archive_path: path.clone(),
            created_at_unix_ms: a.created_at_unix_ms,
        });
        files.push(ArchivePayloadFile {
            path,
            media_type: "text/markdown".into(),
            bytes: a.text.into_bytes(),
        });
    }

    build_context_archive(
        &input.context,
        input.profile.as_ref(),
        AssembledContextDocuments {
            documents,
            artifacts,
            files,
        },
        input.created_at_unix_ms as u64,
        ArchiveCreator {
            app: "conva".into(),
            app_version: input.app_version,
        },
    )
    .map_err(|e| JsValue::from_str(&e.to_string()))
}

fn sha256_hex(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    Sha256::digest(bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

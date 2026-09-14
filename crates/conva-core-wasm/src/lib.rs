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

// ── Import (Checkpoint E, import slice) ─────────────────────────────────
//
// Mirrors desktop's `import_context` pipeline (`src-tauri/src/archive.rs`):
// load materials → caller stages each document/generated-artifact through
// the existing hosted endpoints, building a portable-id → destination-id
// map → `importContextWithIds` (wraps `filter_context_doc_refs` +
// `archive_payload::import_context`, the exact same pure functions desktop
// uses) → the caller persists the result via `saveContext`. Nothing here
// touches the network or a document store; that stays in `archiveImport.ts`.

/// One generated artifact's metadata plus its decoded Markdown text — the
/// import-side twin of `WasmArtifactInput` above, but going the other
/// direction (Rust → JS) and reading the text out of the loaded archive's
/// payloads rather than taking it as input.
#[derive(Serialize)]
struct ArtifactWithText<'a> {
    document_id: &'a str,
    kind: conva_core::archive_payload::GeneratedArtifactKind,
    created_at_unix_ms: u64,
    text: String,
}

/// Everything `archiveImport.ts` needs to drive a Context-scope import, one
/// JS object. `context` is the RAW portable DTO (still carrying the source
/// installation's IDs) — round-tripped back into {@link import_context_with_ids}
/// once every document has a destination ID. `documents` carries each
/// document's `archive_path` so the caller knows which ones to fetch bytes
/// for via {@link get_archive_entry_bytes} (and which have none at all — a
/// metadata-only reference the caller must omit). This function does not
/// itself refuse a Context with a research profile or an archive that also
/// contains a conversation — see `conva-core`'s `load_context_import_materials`
/// doc comment: that policy decision belongs to the caller
/// (`archiveImport.ts`), matching where the export slice's own equivalent
/// refusals live (TypeScript, not Rust).
#[derive(Serialize)]
struct ImportMaterialsOut<'a> {
    archive_digest: &'a str,
    context: &'a conva_core::archive_payload::PortableContextV1,
    documents: &'a [PortableDocumentV1],
    artifacts: Vec<ArtifactWithText<'a>>,
    has_conversation: bool,
}

/// Validate a `.cva`'s bytes and extract everything a Context-scope import
/// needs — the browser-side twin of desktop's `import_context`'s own
/// loading step (`src-tauri/src/archive.rs`), stopping short of staging any
/// document (that needs the network; this function does not touch it).
#[wasm_bindgen(js_name = loadContextArchiveForImport)]
pub fn load_context_archive_for_import(bytes: &[u8]) -> Result<JsValue, JsValue> {
    let loaded = conva_core::archive::load_archive_bytes(bytes)
        .map_err(|e| JsValue::from_str(&e.to_string()))?;
    let materials = conva_core::archive::load_context_import_materials(&loaded)
        .map_err(|e| JsValue::from_str(&e.to_string()))?;
    let artifacts = materials
        .artifacts
        .iter()
        .map(|a| ArtifactWithText {
            document_id: &a.document_id,
            kind: a.kind,
            created_at_unix_ms: a.created_at_unix_ms,
            text: loaded
                .payloads
                .get(&a.archive_path)
                .map(|b| String::from_utf8_lossy(b).into_owned())
                .unwrap_or_default(),
        })
        .collect();
    to_js(&ImportMaterialsOut {
        archive_digest: &materials.archive_digest,
        context: &materials.context,
        documents: &materials.documents,
        artifacts,
        has_conversation: materials.has_conversation,
    })
}

/// Fetch one already-validated archive entry's raw bytes by its canonical
/// path (a document's own `archive_path`, from
/// {@link load_context_archive_for_import}'s `documents` list) — called once
/// per source document the caller decides to stage, so archives with many
/// documents never need every document's bytes in memory at once. Re-parses
/// `bytes` each call rather than keeping wasm-side state between calls
/// (simpler, and cheap enough for a Context's typical document count); a
/// caller that already parsed the whole archive to reach this point pays
/// that cost again per document — an accepted, documented trade-off for a
/// first import slice, not a hidden inefficiency.
#[wasm_bindgen(js_name = getArchiveEntryBytes)]
pub fn get_archive_entry_bytes(bytes: &[u8], path: &str) -> Result<Vec<u8>, JsValue> {
    let loaded = conva_core::archive::load_archive_bytes(bytes)
        .map_err(|e| JsValue::from_str(&e.to_string()))?;
    loaded
        .payloads
        .get(path)
        .cloned()
        .ok_or_else(|| JsValue::from_str(&format!("archive entry '{path}' not found")))
}

/// Build the final, ready-to-save `ConversationContext` once every document
/// the caller decided to keep has a real destination ID — the browser-side
/// twin of desktop's `filter_context_doc_refs` + `archive_payload::
/// import_context` pipeline (`src-tauri/src/archive.rs`), reusing those
/// exact pure functions rather than a parallel TS reimplementation.
///
/// `portable_context` is the same raw DTO `loadContextArchiveForImport`
/// returned (JSON round-tripped through the caller, unmodified except
/// possibly `title`). `document_ids` is the portable-id → destination-id map
/// built while staging documents: a key simply absent means that document
/// was omitted (upload failed, excluded, or had no bytes to begin with) —
/// every reference to an omitted document is dropped from the output,
/// mirroring desktop's own omission handling. Web never imports the linked
/// conversation or a research profile (Context scope only, no `loadProfile`
/// endpoint) — `conversation_id` is dropped unconditionally before calling
/// `import_context` (any such reference is guaranteed dangling in the
/// destination store; desktop's own Context-only `import_context` has this
/// same latent gap, untested since it happens not to have been hit yet —
/// fixed here rather than in `src-tauri` to keep this slice's change scope
/// to the web adapter), and a caller-supplied `knowledge_profile` is left
/// for `import_context`'s own validation to reject (it requires a
/// destination `profile_id`, always `None` here) — a backstop in case
/// `archiveImport.ts`'s own refusal check is ever skipped, not the primary
/// enforcement point.
#[wasm_bindgen(js_name = importContextWithIds)]
pub fn import_context_with_ids(
    portable_context: JsValue,
    context_id: String,
    document_ids: JsValue,
) -> Result<JsValue, JsValue> {
    let mut portable: conva_core::archive_payload::PortableContextV1 =
        serde_wasm_bindgen::from_value(portable_context)
            .map_err(|e| JsValue::from_str(&format!("invalid portable Context: {e}")))?;
    let document_ids: std::collections::BTreeMap<String, String> =
        serde_wasm_bindgen::from_value(document_ids)
            .map_err(|e| JsValue::from_str(&format!("invalid document id map: {e}")))?;

    portable.conversation_id = None;

    let available: std::collections::BTreeSet<String> = document_ids.keys().cloned().collect();
    let filtered = conva_core::archive_payload::filter_context_doc_refs(portable, &available);
    let ids = conva_core::archive_payload::ContextImportIds {
        context_id,
        document_ids,
        profile_id: None,
        conversation_id: None,
    };
    let (context, _profile) = conva_core::archive_payload::import_context(filtered, &ids)
        .map_err(|e| JsValue::from_str(&e.to_string()))?;
    to_js(&context)
}

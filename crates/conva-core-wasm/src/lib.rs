//! `.cva` archive bindings for the browser (Checkpoint E, part 1: inspect
//! only — see `conva_core/docs/technical/cva-import-export-implementation-
//! handoff.md` for exactly what's shipped vs. still owed). Every function
//! below is deliberately thin: decode input, call the real logic in
//! `conva_core::archive`, encode the typed result. No archive/DTO/ZIP logic
//! lives in this crate — it lives once, in `conva-core`, shared with the
//! desktop adapter (`src-tauri/src/archive.rs`).

use std::collections::BTreeSet;

use serde::Serialize;
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

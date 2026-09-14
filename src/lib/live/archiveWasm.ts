/**
 * `.cva` archive support for the browser (Checkpoint E — see
 * `conva_core/docs/technical/cva-import-export-implementation-handoff.md`
 * for exactly what's shipped: inspect, Context-scope export, and now
 * Context-scope import). Loads the `conva-core-wasm` module (built by `npm
 * run build:wasm` into `public/wasm/conva-core-wasm/` — see that script's
 * doc comment for why it's a runtime-fetched public asset rather than a
 * bundled `src/` import) and runs the exact same Rust `.cva` logic desktop
 * uses, client-side, on bytes the browser already has in memory. No hosted
 * endpoint involved for inspect/export/the pure part of import — see
 * `web.ts`'s `archive.*` and `archiveImport.ts` (which does use the
 * existing `/api/live/contexts`/`/api/live/library` endpoints to actually
 * stage/persist an import, since that part necessarily isn't pure).
 */
import type {
  ArchiveInspection,
  ContextCategory,
  ContextPersona,
  ConversationContext,
  KnowledgeProfile,
  ParticipationLens,
  ResearchSource,
  SourcePolicy,
  SuggestionDecision,
} from "@/lib/ipc";

/** One document the caller already has bytes/text for (or has decided to
 *  omit) — mirrors `conva-core-wasm`'s `WasmDocInput` field-for-field
 *  (snake_case, matching this codebase's IPC convention everywhere else,
 *  not a camelCase JS convention for just this one boundary). */
export interface ArchiveExportDocInput {
  id: string;
  file_name: string;
  source: "file" | "pasted" | "generated";
  enabled: boolean;
  searchable: boolean;
  ingested_at_unix_ms: number;
  media_type: string;
  /** Omit (or `null`) for a metadata-only reference. Always ignored for
   *  `source: "generated"` documents — see `conva-core-wasm`'s doc comment. */
  bytes?: Uint8Array | null;
}

export interface ArchiveExportArtifactInput {
  document_id: string;
  kind: "dossier" | "research" | "prepared_qa";
  created_at_unix_ms: number;
  text: string;
}

export interface ArchiveExportContextInput {
  context: ConversationContext;
  profile?: KnowledgeProfile | null;
  documents: ArchiveExportDocInput[];
  artifacts: ArchiveExportArtifactInput[];
  created_at_unix_ms: number;
  app_version: string;
}

/** A portable Knowledge-profile reference nested in {@link PortableContextV1}
 *  — mirrors `conva-core`'s `PortableKnowledgeProfileV1` field-for-field.
 *  Always absent from an archive built on web (no way to fetch a profile to
 *  export) and always refused before it reaches {@link importContextWithIds}
 *  (no way to persist one to import) — see `archiveImport.ts`. */
export interface PortableKnowledgeProfileV1 {
  id: string;
  title: string;
  created_at_unix_ms: number;
  updated_at_unix_ms: number;
  doc_ids: string[];
  research: ResearchSource[];
  ready: boolean;
}

/** The RAW portable Context DTO — still carrying the *source* installation's
 *  IDs, unlike {@link ArchiveInspection}'s sanitized preview. Mirrors
 *  `conva-core`'s `PortableContextV1` field-for-field (snake_case, same IPC
 *  convention as everywhere else). Round-tripped opaquely by
 *  `archiveImport.ts`: read out of {@link loadContextArchiveForImport}'s
 *  result, optionally have `title` overridden, then handed back into
 *  {@link importContextWithIds} unmodified otherwise — never hand-built or
 *  hand-edited field-by-field in TypeScript. */
export interface PortableContextV1 {
  id: string;
  title: string;
  purpose: string;
  job_description: string | null;
  category: ContextCategory;
  participation_lens: ParticipationLens | null;
  source_policy: SourcePolicy | null;
  created_at_unix_ms: number;
  updated_at_unix_ms: number;
  source_doc_ids: string[];
  slot_doc_ids: Record<string, string[]>;
  auto_generate_context: boolean;
  research_enabled: boolean;
  deep_qa_enabled: boolean;
  key_terms: string[];
  glossary: string[];
  glossary_definitions: Record<string, string>;
  knowledge_profile: PortableKnowledgeProfileV1 | null;
  personas: ContextPersona[];
  chosen_persona_id: string | null;
  conversation_id: string | null;
  dossier_doc_id: string | null;
  research_doc_id: string | null;
  qa_doc_id: string | null;
  resources_stale: boolean;
  resources_generated_at_unix_ms: number | null;
  suggestion_decisions: Record<string, SuggestionDecision>;
}

/** One document referenced by a Context being imported — mirrors
 *  `conva-core`'s `PortableDocumentV1`. `archive_path` is the entry to pass
 *  to {@link getArchiveEntryBytes} when present; `null` means a
 *  metadata-only reference with no content to bring in. */
export interface ArchiveImportDocument {
  id: string;
  file_name: string;
  source: "file" | "pasted" | "generated";
  enabled: boolean;
  searchable: boolean;
  ingested_at_unix_ms: number;
  archive_path: string | null;
  bytes: number | null;
  sha256: string | null;
}

/** One generated artifact's metadata plus its already-decoded Markdown
 *  text — ready to hand to `ingestText`, no separate byte-fetch needed
 *  (unlike a source document). */
export interface ArchiveImportArtifact {
  document_id: string;
  kind: "dossier" | "research" | "prepared_qa";
  created_at_unix_ms: number;
  text: string;
}

/** Everything {@link importContextArchive} (`archiveImport.ts`) needs from a
 *  validated `.cva`, before staging any document. */
export interface ContextImportMaterials {
  archive_digest: string;
  context: PortableContextV1;
  documents: ArchiveImportDocument[];
  artifacts: ArchiveImportArtifact[];
  has_conversation: boolean;
}

/** Shape of the wasm-bindgen "web" target's generated ESM module — only the
 *  parts this file actually calls. */
interface ArchiveWasmModule {
  default: (module_or_path?: unknown) => Promise<unknown>;
  inspectArchiveBytes: (bytes: Uint8Array) => unknown;
  exportContextArchiveBytes: (input: ArchiveExportContextInput) => Uint8Array;
  loadContextArchiveForImport: (bytes: Uint8Array) => ContextImportMaterials;
  getArchiveEntryBytes: (bytes: Uint8Array, path: string) => Uint8Array;
  importContextWithIds: (
    portableContext: PortableContextV1,
    contextId: string,
    documentIds: Record<string, string>,
  ) => ConversationContext;
}

let modulePromise: Promise<ArchiveWasmModule> | null = null;

/** Lazily load + initialize the wasm module exactly once; a failed attempt
 *  (missing build, unsupported browser, network) is not cached, so the next
 *  call can retry rather than staying permanently broken for the session. */
function loadArchiveWasm(): Promise<ArchiveWasmModule> {
  if (!modulePromise) {
    // A runtime-computed URL, not a literal import specifier: `tsc` types
    // this as an untyped dynamic import (no file-resolution attempted) and
    // Vite's bundler never tries to statically resolve/bundle it either —
    // both matter because desktop's plain `npm run build` type-checks and
    // bundles this exact file too (`detect.ts` statically imports
    // `WebBackend` alongside `TauriBackend`) without ever having built this
    // wasm module. See scripts/build-wasm.mjs's doc comment.
    const url = `${import.meta.env.BASE_URL}wasm/conva-core-wasm/conva_core_wasm.js`;
    modulePromise = import(/* @vite-ignore */ url)
      .then(async (mod: ArchiveWasmModule) => {
        await mod.default();
        return mod;
      })
      .catch((e: unknown) => {
        modulePromise = null;
        throw new Error(
          `.cva archive support failed to load (run "npm run build:wasm" before the web build?): ${e instanceof Error ? e.message : String(e)}`,
        );
      });
  }
  return modulePromise;
}

/** Real content digest, lowercase hex — matches what the desktop adapter
 *  computes server-side (SHA-256 of the whole archive file). Used as the
 *  {@link registerLocalArchiveFile} cache key, independent of the wasm
 *  module (native browser `crypto.subtle`). */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  // Cast: `crypto.subtle.digest`'s DOM types want a `Uint8Array<ArrayBuffer>`
  // specifically; a plain `Uint8Array` (whose backing store TS can't prove
  // isn't a `SharedArrayBuffer`) doesn't structurally match, though every
  // real caller here passes an ordinary heap-allocated array.
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Bytes the user picked for import/inspection, keyed by content digest —
 *  the in-memory stand-in for desktop's "a file path the OS already granted
 *  access to". Small and short-lived: entries exist only for files actually
 *  selected in the current tab session, never persisted. */
const localArchives = new Map<string, Uint8Array>();

/** Register a locally-selected `.cva` file's bytes and return the digest to
 *  pass as `archiveDigest` to {@link inspectLocalArchive}/`ConvaBackend`'s
 *  `archive.inspectArchive` — the web adapter's answer to "desktop picks its
 *  own destination/source" (spec §9's implementation note): getting bytes
 *  out of a browser `File` is adapter-specific, so it lives here rather than
 *  in the shared `ConvaBackend` contract. */
export async function registerLocalArchiveFile(bytes: Uint8Array): Promise<string> {
  const digest = await sha256Hex(bytes);
  localArchives.set(digest, bytes);
  return digest;
}

/** Side-effect-free preview of a previously {@link registerLocalArchiveFile}d
 *  archive — the web half of `web.ts`'s `archive.inspectArchive`. Never
 *  uploads anything: validation runs entirely in the wasm module on bytes
 *  already in this tab's memory. */
export async function inspectLocalArchive(archiveDigest: string): Promise<ArchiveInspection> {
  const bytes = localArchives.get(archiveDigest);
  if (!bytes) {
    throw new Error("No locally-selected .cva file matches this digest — select the file again.");
  }
  const wasm = await loadArchiveWasm();
  try {
    return wasm.inspectArchiveBytes(bytes) as ArchiveInspection;
  } catch (e) {
    // The wasm binding rejects with a plain string (see conva-core-wasm's
    // `JsValue::from_str`), not an `Error` — normalize it.
    throw new Error(typeof e === "string" ? e : e instanceof Error ? e.message : String(e));
  }
}

/** Look up a previously {@link registerLocalArchiveFile}d archive's bytes by
 *  digest — `web.ts`'s `archive.importArchive` needs the real bytes (not
 *  just a preview), since actually staging documents reads directly out of
 *  them (`getArchiveEntryBytes`), unlike `inspectLocalArchive`. */
export function getLocalArchiveBytes(archiveDigest: string): Uint8Array | undefined {
  return localArchives.get(archiveDigest);
}

/** Build a Context `.cva`'s complete bytes, entirely client-side — the web
 *  half of `web.ts`'s `archive.exportArchive` (Context scope). The caller
 *  (`archiveExport.ts`) has already fetched every included document's
 *  bytes/text via the existing hosted library endpoints; this only runs the
 *  same Rust assembly logic desktop's `export_context` uses
 *  (`conva_core::archive_payload::build_context_archive`), compiled to wasm.
 */
export async function exportContextArchive(input: ArchiveExportContextInput): Promise<Uint8Array> {
  const wasm = await loadArchiveWasm();
  try {
    return wasm.exportContextArchiveBytes(input);
  } catch (e) {
    throw new Error(typeof e === "string" ? e : e instanceof Error ? e.message : String(e));
  }
}

function normalizeWasmError(e: unknown): Error {
  // Same normalization as every other wasm call in this file — the binding
  // rejects with a plain string, not an `Error`.
  return e instanceof Error ? e : new Error(typeof e === "string" ? e : String(e));
}

// ── Import (Checkpoint E, import slice) ─────────────────────────────────

/** Validate a locally-selected `.cva`'s bytes and extract everything a
 *  Context-scope import needs — the web half of `web.ts`'s
 *  `archive.importArchive`. Does not itself refuse a Context with a
 *  research profile or an archive that also contains a conversation; that
 *  policy decision is `archiveImport.ts`'s (matching where the export
 *  slice's own equivalent refusals live). Does not stage/upload anything —
 *  side-effect-free like {@link inspectLocalArchive}. */
export async function loadContextArchiveForImport(bytes: Uint8Array): Promise<ContextImportMaterials> {
  const wasm = await loadArchiveWasm();
  try {
    return wasm.loadContextArchiveForImport(bytes);
  } catch (e) {
    throw normalizeWasmError(e);
  }
}

/** Fetch one archive entry's raw bytes by path (a document's own
 *  `archive_path`) — called once per source document `archiveImport.ts`
 *  decides to stage. */
export async function getArchiveEntryBytes(bytes: Uint8Array, path: string): Promise<Uint8Array> {
  const wasm = await loadArchiveWasm();
  try {
    return wasm.getArchiveEntryBytes(bytes, path);
  } catch (e) {
    throw normalizeWasmError(e);
  }
}

/** Build the final, ready-to-save `ConversationContext` once every document
 *  the caller decided to keep has a real destination ID — see
 *  `conva-core-wasm`'s `import_context_with_ids` doc comment for exactly
 *  what this does and does not enforce (in particular: a document id simply
 *  absent from `documentIds` means that reference is dropped, not an
 *  error). */
export async function importContextWithIds(
  portableContext: PortableContextV1,
  contextId: string,
  documentIds: Record<string, string>,
): Promise<ConversationContext> {
  const wasm = await loadArchiveWasm();
  try {
    return wasm.importContextWithIds(portableContext, contextId, documentIds);
  } catch (e) {
    throw normalizeWasmError(e);
  }
}

/**
 * `.cva` Context import, client-orchestrated (Checkpoint E, import slice —
 * owner decision, 2026-09-14: best-effort, not transactional; see the
 * implementation handoff for the reasoning). Mirrors desktop's
 * `import_context` pipeline (`src-tauri/src/archive.rs`) but staged through
 * the *existing* hosted endpoints (`saveContext`/`uploadDocument`/
 * `ingestText`) instead of a local `RagStore` — no new server route, same
 * as the export slice.
 *
 * The pipeline, in order:
 * 1. Validate + extract the archive's materials (wasm, side-effect-free).
 * 2. Refuse up front (clear message, nothing persisted yet) a Context whose
 *    `knowledge_profile` is set (no way to persist one on web) or an
 *    archive that also declares a conversation (Context scope only).
 * 3. Create the destination Context with every document reference stripped,
 *    `id: ""` so the Worker mints the real id — web's existing "empty id →
 *    server-minted" convention (`ContextSetup.tsx`'s own create path), used
 *    as-is rather than inventing a client-side minting scheme.
 * 4. Stage each document/generated artifact through the normal upload/
 *    ingest path, attaching directly to the now-real Context id (its own
 *    `contextIds` parameter) — no separate attach call needed. A document
 *    with no bytes, or whose upload/ingest fails, is omitted with a reason
 *    rather than failing the whole import (spec §6.3's "the user continues
 *    without this document" policy).
 * 5. Rebuild the Context with the full, remapped document references (same
 *    wasm converter, called again with the real id + doc-id map) and save
 *    it again — this second `saveContext` call updates the record created
 *    in step 3.
 *
 * **Not transactional, by design (the user's explicit choice over building a
 * hosted transactional import endpoint first):** a failure in step 5 leaves
 * a Context with no document references even though the documents
 * themselves already list it in their own `context_ids` (from step 4) — a
 * one-sided link, not silently hidden; the error propagates so the caller
 * can tell the user to retry rather than reporting false success. A failure
 * partway through step 4 simply omits the rest for that document and
 * continues — matching desktop's own `stage_documents` behavior, not a new
 * failure mode invented here.
 *
 * **Known, disclosed simplifications** (first slice — see the implementation
 * handoff for the full list): `reuse_exact_document_ids` is not honored,
 * every included document is always freshly uploaded/ingested, never
 * reused; an empty `include_document_ids` means "include every document
 * with real content" (the opposite of desktop's stricter "empty means
 * none" convention) since there is no per-document inclusion picker UI on
 * web yet — matching the export slice's own "include everything, no picker"
 * simplification; a generated artifact (dossier/research/prepared Q&A) is
 * re-created via `ingestText` and lands with `source: "pasted"`, not
 * `"generated"` — web's hosted library API has no way to create a
 * "generated"-sourced document at all, so the content is preserved exactly
 * but the source tag is not.
 */
import type { ArchiveImportOptions, ArchiveImportResult, ArchiveOmittedDocument, ConversationContext } from "@/lib/ipc";
import {
  getArchiveEntryBytes,
  importContextWithIds,
  loadContextArchiveForImport,
  type PortableContextV1,
} from "@/lib/live/archiveWasm";
import { saveContext } from "@/lib/live/contextsClient";
import { ingestText, uploadDocument } from "@/lib/live/libraryClient";
import type { StoreClientDeps } from "@/lib/live/storeClient";

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Import a Context `.cva`'s bytes into the signed-in user's own Contexts —
 *  the web half of `web.ts`'s `archive.importArchive`. Throws a plain
 *  `Error` with a UI-safe message on an up-front refusal (profile,
 *  conversation, malformed archive); once staging begins, per-document
 *  failures are reported in the result's `omitted_documents` instead of
 *  throwing — see the module doc comment for what is and isn't atomic. */
export async function importContextArchive(
  deps: StoreClientDeps,
  bytes: Uint8Array,
  options: ArchiveImportOptions,
): Promise<ArchiveImportResult> {
  const materials = await loadContextArchiveForImport(bytes);
  if (materials.has_conversation) {
    throw new Error(
      "This archive also contains a conversation — importing it isn't supported on web yet (Context scope only). Use the desktop app, or a Context-only export.",
    );
  }
  if (materials.context.knowledge_profile) {
    throw new Error(
      "This Context has a research profile — importing it isn't supported on web yet (no way to persist the profile). Use the desktop app.",
    );
  }

  const portable: PortableContextV1 = materials.context;
  if (options.context_title?.trim()) {
    portable.title = options.context_title.trim();
  }

  // No per-document inclusion picker UI on web yet (same simplification as
  // the export slice) — an explicit list restricts to it, but an EMPTY list
  // means "include everything with real content available", the opposite of
  // desktop's stricter "empty means none" convention (that convention exists
  // for desktop's real picker UI, which web doesn't have).
  const includeIds = options.include_document_ids.length ? new Set(options.include_document_ids) : null;

  // Step 1: mint the real Context id with every document reference stripped
  // (nothing has been staged yet) — `importContextWithIds` with an empty
  // document-id map drops every reference via `filter_context_doc_refs`.
  const placeholderId = `import-${crypto.randomUUID()}`;
  const minimal: ConversationContext = await importContextWithIds(portable, placeholderId, {});
  const created = await saveContext(deps, { ...minimal, id: "" });
  const contextId = created.id;

  // Step 2: stage every document/generated artifact, attaching directly to
  // the real Context id via each upload/ingest call's own `contextIds` —
  // no separate attach round trip needed.
  const artifactByDoc = new Map(materials.artifacts.map((a) => [a.document_id, a]));
  const documentIds: Record<string, string> = {};
  const importedDocumentIds: string[] = [];
  const omitted: ArchiveOmittedDocument[] = [];

  for (const doc of materials.documents) {
    const artifact = artifactByDoc.get(doc.id);
    if (artifact) {
      try {
        const { document } = await ingestText(deps, doc.file_name, artifact.text, [contextId]);
        documentIds[doc.id] = document.id;
        importedDocumentIds.push(document.id);
      } catch (e) {
        omitted.push({ portable_id: doc.id, reason: errorMessage(e) });
      }
      continue;
    }
    if (!doc.archive_path) {
      omitted.push({ portable_id: doc.id, reason: "source document was not included in this archive" });
      continue;
    }
    if (includeIds && !includeIds.has(doc.id)) {
      omitted.push({ portable_id: doc.id, reason: "excluded by the import selection" });
      continue;
    }
    try {
      const raw = await getArchiveEntryBytes(bytes, doc.archive_path);
      // Cast: `File`'s constructor wants a `BlobPart`, which structurally
      // excludes a `Uint8Array<ArrayBufferLike>` (same DOM strictness quirk
      // as elsewhere in this codebase) — `raw` is always a real
      // heap-allocated array here.
      const file = new File([raw as BlobPart], doc.file_name);
      const { document } = await uploadDocument(deps, file, [contextId]);
      documentIds[doc.id] = document.id;
      importedDocumentIds.push(document.id);
    } catch (e) {
      omitted.push({ portable_id: doc.id, reason: errorMessage(e) });
    }
  }

  // Step 3: rebuild with the full, remapped references and persist —
  // updates the record `saveContext` created in step 1 (non-empty id now).
  const final: ConversationContext = await importContextWithIds(portable, contextId, documentIds);
  const saved = await saveContext(deps, { ...final, id: contextId });

  return {
    context_id: saved.id,
    conversation_id: null,
    imported_document_ids: importedDocumentIds,
    reused_document_ids: [],
    omitted_documents: omitted,
  };
}

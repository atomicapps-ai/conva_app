/**
 * `.cva` Context export assembly for the browser (Checkpoint E, export
 * slice). Fetches everything a Context export needs through the existing
 * hosted library/context endpoints (`contextsClient.ts`/`libraryClient.ts`)
 * — no new server route — then hands it to the wasm module
 * (`archiveWasm.ts`'s `exportContextArchive`) to assemble into real `.cva`
 * bytes, exactly the way desktop's `export_context` does with `RagStore`.
 *
 * Known gap, disclosed: a Context with a `knowledge_profile_id` set refuses
 * with a clear error rather than silently dropping the profile — web has no
 * `loadProfile`/`saveProfile` hosted call at all yet (`context.loadProfile`
 * is `unimplemented` in `capabilitySnapshot.ts`), so there is nothing to
 * fetch. See the implementation handoff for what a web profile endpoint
 * would need.
 */
import type { ConversationContext, RagDocument } from "@/lib/ipc";
import { BUILD } from "@/lib/debug";
import {
  exportContextArchive,
  type ArchiveExportArtifactInput,
  type ArchiveExportDocInput,
} from "@/lib/live/archiveWasm";
import { loadContext } from "@/lib/live/contextsClient";
import { documentText, downloadOriginal, listDocuments } from "@/lib/live/libraryClient";
import type { StoreClientDeps } from "@/lib/live/storeClient";

/** Every document/generated-artifact id a Context export needs — mirrors
 *  `src-tauri/src/archive.rs`'s `source_and_generated_doc_ids` exactly. */
function referencedDocIds(context: ConversationContext): Set<string> {
  const ids = new Set<string>(context.source_doc_ids);
  for (const docs of Object.values(context.slot_doc_ids ?? {})) for (const id of docs) ids.add(id);
  for (const id of [context.dossier_doc_id, context.research_doc_id, context.qa_doc_id]) {
    if (id) ids.add(id);
  }
  return ids;
}

/** Which of the three well-known generated-artifact slots `docId` fills —
 *  exact, not desktop's filename-guessing `generated_artifact_kind` (the
 *  browser already knows the relationship from the Context record itself). */
function generatedArtifactKind(context: ConversationContext, docId: string): "dossier" | "research" | "prepared_qa" {
  if (docId === context.research_doc_id) return "research";
  if (docId === context.qa_doc_id) return "prepared_qa";
  return "dossier";
}

export interface ExportedContextArchive {
  bytes: Uint8Array;
  /** A sanitized, download-safe file name (title + `.cva`) — never the
   *  Context's raw title verbatim in a path-sensitive context. */
  fileName: string;
}

/** Assemble and build a Context `.cva`, entirely client-side. Throws a plain
 *  `Error` with a UI-safe message on any refusal (missing context, a
 *  profile reference web can't fetch, a vanished document). */
export async function buildContextArchiveForDownload(
  deps: StoreClientDeps,
  contextId: string,
  includeSourceDocuments: boolean,
): Promise<ExportedContextArchive> {
  const context = await loadContext(deps, contextId);
  if (context.knowledge_profile_id) {
    throw new Error(
      "This Context has a research profile — exporting it isn't supported on web yet (no way to fetch the profile). Use the desktop app, or export without opening the profile.",
    );
  }

  const ids = referencedDocIds(context);
  const allDocs = await listDocuments(deps);
  const byId = new Map<string, RagDocument>(allDocs.map((d) => [d.id, d]));

  const documents: ArchiveExportDocInput[] = [];
  const artifacts: ArchiveExportArtifactInput[] = [];
  for (const id of ids) {
    const doc = byId.get(id);
    if (!doc) throw new Error(`Referenced document '${id}' no longer exists in the library.`);
    if (doc.source === "generated") {
      const text = (await documentText(deps, id)) ?? "";
      documents.push({
        id: doc.id,
        file_name: doc.file_name,
        source: doc.source,
        enabled: doc.enabled,
        searchable: doc.searchable ?? false,
        ingested_at_unix_ms: doc.ingested_at_unix_ms,
        media_type: "text/markdown",
        bytes: null,
      });
      artifacts.push({
        document_id: doc.id,
        kind: generatedArtifactKind(context, doc.id),
        created_at_unix_ms: doc.ingested_at_unix_ms,
        text,
      });
    } else if (includeSourceDocuments) {
      const { blob } = await downloadOriginal(deps, id);
      const bytes = new Uint8Array(await blob.arrayBuffer());
      documents.push({
        id: doc.id,
        file_name: doc.file_name,
        source: doc.source,
        enabled: doc.enabled,
        searchable: doc.searchable ?? true,
        ingested_at_unix_ms: doc.ingested_at_unix_ms,
        media_type: blob.type || "application/octet-stream",
        bytes,
      });
    } else {
      documents.push({
        id: doc.id,
        file_name: doc.file_name,
        source: doc.source,
        enabled: doc.enabled,
        searchable: doc.searchable ?? true,
        ingested_at_unix_ms: doc.ingested_at_unix_ms,
        media_type: "application/octet-stream",
        bytes: null,
      });
    }
  }

  const bytes = await exportContextArchive({
    context,
    profile: null,
    documents,
    artifacts,
    created_at_unix_ms: Date.now(),
    app_version: BUILD.version,
  });

  const safeTitle = context.title.trim().replace(/[^A-Za-z0-9._ -]+/g, "").trim() || "context";
  return { bytes, fileName: `${safeTitle}.cva` };
}

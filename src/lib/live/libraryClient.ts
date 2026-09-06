/**
 * Cloud library for the web build — the browser side of `/api/live/library`
 * (M2 checkpoint 9, text-first; spec
 * `conva_core/docs/platform/live-gateway-protocol.md` "Cloud library").
 * Pasted / generated text is chunked and stored by the Worker AS THE USER
 * (RLS); retrieval for Ally happens server-side. File originals (local
 * paths) stay unsupported on web until the Storage slice. Refusals become
 * coded {@link LiveSessionError}s (`unprovisioned` until migration 0007,
 * `signed_out`, `not_found`, `too_large`, `empty_text`…).
 */
import type { IngestReport, RagDocument } from "@/lib/ipc";
import { badResponse, callStore, type StoreClientDeps } from "./storeClient";

export type LibraryClientDeps = StoreClientDeps;

const NOUN = "Document";

export function listDocuments(deps: LibraryClientDeps): Promise<RagDocument[]> {
  return callStore(deps, NOUN, "/library", { method: "GET" }, (b) => (Array.isArray(b.documents) ? (b.documents as RagDocument[]) : []));
}

export function ingestText(deps: LibraryClientDeps, name: string, text: string, contextIds: readonly string[] = []): Promise<IngestReport> {
  const body: Record<string, unknown> = { name, text };
  if (contextIds.length) body.context_ids = contextIds;
  return callStore(deps, NOUN, "/library", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }, (b) => {
    const r = b.report as { document?: unknown; warnings?: unknown } | undefined;
    if (!r || !r.document || typeof r.document !== "object") throw badResponse(NOUN);
    return { document: r.document as RagDocument, warnings: Array.isArray(r.warnings) ? (r.warnings as string[]) : [] };
  });
}

function patch(deps: LibraryClientDeps, id: string, body: Record<string, unknown>): Promise<RagDocument> {
  return callStore(deps, NOUN, `/library/${encodeURIComponent(id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }, (b) => {
    if (!b.document || typeof b.document !== "object") throw badResponse(NOUN);
    return b.document as RagDocument;
  });
}

export function setDocumentEnabled(deps: LibraryClientDeps, id: string, enabled: boolean): Promise<RagDocument> {
  return patch(deps, id, { enabled });
}

export function attachDocumentContext(deps: LibraryClientDeps, id: string, contextId: string): Promise<RagDocument> {
  return patch(deps, id, { attach_context: contextId });
}

export function detachDocumentContext(deps: LibraryClientDeps, id: string, contextId: string): Promise<RagDocument> {
  return patch(deps, id, { detach_context: contextId });
}

export function deleteDocument(deps: LibraryClientDeps, id: string): Promise<void> {
  return callStore(deps, NOUN, `/library/${encodeURIComponent(id)}`, { method: "DELETE" }, () => undefined);
}

/** The extracted text for the viewer; null when the document is gone. */
export async function documentText(deps: LibraryClientDeps, id: string): Promise<string | null> {
  try {
    return await callStore(deps, NOUN, `/library/${encodeURIComponent(id)}/text`, { method: "GET" }, (b) => (typeof b.text === "string" ? b.text : ""));
  } catch (e) {
    if (e && typeof e === "object" && (e as { code?: string }).code === "not_found") return null;
    throw e;
  }
}

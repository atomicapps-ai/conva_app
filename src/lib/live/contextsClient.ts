/**
 * Cloud Contexts for the web build — the browser side of `/api/live/contexts`
 * (M2 checkpoint 7; spec `conva_core/docs/platform/live-gateway-protocol.md`
 * "Cloud Contexts"). The Worker reads/writes Supabase AS THE USER (RLS); the
 * page never holds a Supabase token. Refusals become coded
 * {@link LiveSessionError}s — `unprovisioned` when migration 0005 is not
 * applied yet, `signed_out`, `not_found`, `too_large`… — so the UI can say why.
 * Pure apart from the injected fetch.
 */
import type { ContextSummary, ConversationContext } from "@/lib/ipc";
import { badResponse, callStore, type StoreClientDeps } from "./storeClient";

export type ContextsClientDeps = StoreClientDeps;

const NOUN = "Context";

export function listContexts(deps: ContextsClientDeps): Promise<ContextSummary[]> {
  return callStore(deps, NOUN, "/contexts", { method: "GET" }, (b) => (Array.isArray(b.contexts) ? (b.contexts as ContextSummary[]) : []));
}

export function loadContext(deps: ContextsClientDeps, id: string): Promise<ConversationContext> {
  return callStore(deps, NOUN, `/contexts/${encodeURIComponent(id)}`, { method: "GET" }, (b) => {
    if (!b.context || typeof b.context !== "object") throw badResponse(NOUN);
    return b.context as ConversationContext;
  });
}

export function saveContext(deps: ContextsClientDeps, context: ConversationContext): Promise<ConversationContext> {
  return callStore(deps, NOUN, "/contexts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(context) }, (b) => {
    if (!b.context || typeof b.context !== "object") throw badResponse(NOUN);
    return b.context as ConversationContext;
  });
}

export function deleteContext(deps: ContextsClientDeps, id: string): Promise<void> {
  return callStore(deps, NOUN, `/contexts/${encodeURIComponent(id)}`, { method: "DELETE" }, () => undefined);
}

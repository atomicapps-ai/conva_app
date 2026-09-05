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
import { LiveSessionError } from "./liveClient";

export interface ContextsClientDeps {
  fetch: typeof fetch;
  base?: string;
}

async function call<T>(deps: ContextsClientDeps, path: string, init: RequestInit, pick: (body: Record<string, unknown>) => T): Promise<T> {
  const base = deps.base ?? "/api/live";
  let res: Response;
  try {
    res = await deps.fetch(`${base}${path}`, { credentials: "same-origin", cache: "no-store", ...init, headers: { Accept: "application/json", ...(init.headers ?? {}) } });
  } catch (e) {
    throw new LiveSessionError("network", `Contexts request failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown> & { error?: unknown; reason?: unknown };
  if (!res.ok) {
    const code = typeof body.error === "string" ? body.error : res.status === 401 ? "signed_out" : res.status === 503 ? "unconfigured" : `http_${res.status}`;
    throw new LiveSessionError(code, typeof body.reason === "string" ? body.reason : describe(code, res.status));
  }
  return pick(body);
}

export function listContexts(deps: ContextsClientDeps): Promise<ContextSummary[]> {
  return call(deps, "/contexts", { method: "GET" }, (b) => (Array.isArray(b.contexts) ? (b.contexts as ContextSummary[]) : []));
}

export function loadContext(deps: ContextsClientDeps, id: string): Promise<ConversationContext> {
  return call(deps, `/contexts/${encodeURIComponent(id)}`, { method: "GET" }, (b) => {
    if (!b.context || typeof b.context !== "object") throw new LiveSessionError("bad_response", "The Context store answered without a record.");
    return b.context as ConversationContext;
  });
}

export function saveContext(deps: ContextsClientDeps, context: ConversationContext): Promise<ConversationContext> {
  return call(deps, "/contexts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(context) }, (b) => {
    if (!b.context || typeof b.context !== "object") throw new LiveSessionError("bad_response", "The Context store answered without a record.");
    return b.context as ConversationContext;
  });
}

export function deleteContext(deps: ContextsClientDeps, id: string): Promise<void> {
  return call(deps, `/contexts/${encodeURIComponent(id)}`, { method: "DELETE" }, () => undefined);
}

function describe(code: string, status: number): string {
  switch (code) {
    case "signed_out":
      return "Sign in to use Contexts.";
    case "unprovisioned":
      return "Cloud Contexts are not provisioned on this deployment yet.";
    case "unconfigured":
      return "The session backend is not configured on this deployment.";
    case "not_found":
      return "That Context no longer exists.";
    case "too_large":
      return "This Context is too large to store.";
    default:
      return `The Context store answered ${status}.`;
  }
}

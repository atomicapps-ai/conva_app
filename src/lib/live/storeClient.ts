/**
 * Shared fetch shape for the web build's per-user cloud stores behind the live
 * gateway (`/api/live/contexts`, `/api/live/conversations`). Cookie-authorised,
 * never cached, JSON in/out; every refusal becomes a coded
 * {@link LiveSessionError} carrying the Worker's `reason` when it gave one,
 * else a human default per code. Pure apart from the injected fetch.
 */
import { LiveSessionError } from "./liveClient";

export interface StoreClientDeps {
  fetch: typeof fetch;
  base?: string;
}

export async function callStore<T>(deps: StoreClientDeps, noun: string, path: string, init: RequestInit, pick: (body: Record<string, unknown>) => T): Promise<T> {
  const base = deps.base ?? "/api/live";
  let res: Response;
  try {
    res = await deps.fetch(`${base}${path}`, { credentials: "same-origin", cache: "no-store", ...init, headers: { Accept: "application/json", ...(init.headers ?? {}) } });
  } catch (e) {
    throw new LiveSessionError("network", `${noun} request failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown> & { error?: unknown; reason?: unknown };
  if (!res.ok) {
    const code = typeof body.error === "string" ? body.error : res.status === 401 ? "signed_out" : res.status === 503 ? "unconfigured" : `http_${res.status}`;
    throw new LiveSessionError(code, typeof body.reason === "string" ? body.reason : describe(noun, code, res.status));
  }
  return pick(body);
}

/** The Worker answered 200 without the record it promised. */
export function badResponse(noun: string): LiveSessionError {
  return new LiveSessionError("bad_response", `The ${noun} store answered without a record.`);
}

function describe(noun: string, code: string, status: number): string {
  switch (code) {
    case "signed_out":
      return `Sign in to use ${noun}s.`;
    case "unprovisioned":
      return `Cloud ${noun}s are not provisioned on this deployment yet.`;
    case "unconfigured":
      return "The session backend is not configured on this deployment.";
    case "not_found":
      return `That ${noun} no longer exists.`;
    case "too_large":
      return `This ${noun} is too large to store.`;
    default:
      return `The ${noun} store answered ${status}.`;
  }
}

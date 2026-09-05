/**
 * `GET /api/live/status` — whether THIS deployment can run a hosted live
 * session (a provider is configured, the gateway is present). The web adapter
 * turns the answer into capability availability: a mic that the browser can
 * capture but no gateway can transcribe is `unavailable` with the server's
 * reason, never `available`. Pure apart from the injected fetch.
 */
import type { AllyStatus, LiveStatus } from "./protocol";

export const UNREACHABLE: LiveStatus = {
  configured: false,
  provider: null,
  reason: "The live gateway did not answer (/api/live/status).",
  max_sources: 0,
  sample_rate_hz: 16_000,
  ally: { configured: false, provider: null, model: null, reason: "The live gateway did not answer (/api/live/status)." },
};

/** A cp1 gateway (no `ally` in its status) is honestly "not configured". */
function allyOf(raw: unknown, fallbackReason: string): AllyStatus {
  const a = raw as Partial<AllyStatus> | undefined;
  if (!a || typeof a !== "object") return { configured: false, provider: null, model: null, reason: fallbackReason };
  return {
    configured: a.configured === true,
    provider: typeof a.provider === "string" ? a.provider : null,
    model: typeof a.model === "string" ? a.model : null,
    reason: typeof a.reason === "string" ? a.reason : a.configured === true ? undefined : fallbackReason,
  };
}

export async function fetchLiveStatus(f: typeof fetch = fetch, base = "/api/live"): Promise<LiveStatus> {
  try {
    const res = await f(`${base}/status`, { credentials: "same-origin", cache: "no-store", headers: { Accept: "application/json" } });
    if (!res.ok) {
      const reason = `The live gateway answered ${res.status}.`;
      return { ...UNREACHABLE, reason, ally: { ...UNREACHABLE.ally!, reason } };
    }
    const body = (await res.json()) as Partial<LiveStatus>;
    return {
      configured: body.configured === true,
      provider: typeof body.provider === "string" ? body.provider : null,
      reason: typeof body.reason === "string" ? body.reason : undefined,
      max_sources: typeof body.max_sources === "number" ? body.max_sources : 0,
      sample_rate_hz: typeof body.sample_rate_hz === "number" ? body.sample_rate_hz : 16_000,
      ally: allyOf(body.ally, "This live gateway does not offer Ally yet (no `ally` in /api/live/status)."),
    };
  } catch (e) {
    const reason = `The live gateway is unreachable: ${e instanceof Error ? e.message : String(e)}`;
    return { ...UNREACHABLE, reason, ally: { ...UNREACHABLE.ally!, reason } };
  }
}

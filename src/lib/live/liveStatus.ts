/**
 * `GET /api/live/status` — whether THIS deployment can run a hosted live
 * session (a provider is configured, the gateway is present). The web adapter
 * turns the answer into capability availability: a mic that the browser can
 * capture but no gateway can transcribe is `unavailable` with the server's
 * reason, never `available`. Pure apart from the injected fetch.
 */
import type { LiveStatus } from "./protocol";

export const UNREACHABLE: LiveStatus = {
  configured: false,
  provider: null,
  reason: "The live gateway did not answer (/api/live/status).",
  max_sources: 0,
  sample_rate_hz: 16_000,
};

export async function fetchLiveStatus(f: typeof fetch = fetch, base = "/api/live"): Promise<LiveStatus> {
  try {
    const res = await f(`${base}/status`, { credentials: "same-origin", cache: "no-store", headers: { Accept: "application/json" } });
    if (!res.ok) return { ...UNREACHABLE, reason: `The live gateway answered ${res.status}.` };
    const body = (await res.json()) as Partial<LiveStatus>;
    return {
      configured: body.configured === true,
      provider: typeof body.provider === "string" ? body.provider : null,
      reason: typeof body.reason === "string" ? body.reason : undefined,
      max_sources: typeof body.max_sources === "number" ? body.max_sources : 0,
      sample_rate_hz: typeof body.sample_rate_hz === "number" ? body.sample_rate_hz : 16_000,
    };
  } catch (e) {
    return { ...UNREACHABLE, reason: `The live gateway is unreachable: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/**
 * Hosted usage for the web build — `GET /api/live/usage` (M2 checkpoint 4)
 * mapped onto the legacy {@link UsageSummary} the Settings → Usage panel
 * already renders, so desktop (local BYO-key ledger) and web (server-side
 * per-day ledger) share one UI. Pure apart from the injected fetch.
 */
import type { UsageSummary } from "@/lib/ipc";
import { LiveSessionError } from "./liveClient";
import type { LiveUsage } from "./protocol";

export async function fetchLiveUsage(f: typeof fetch = fetch, base = "/api/live"): Promise<LiveUsage> {
  let res: Response;
  try {
    res = await f(`${base}/usage`, { credentials: "same-origin", cache: "no-store", headers: { Accept: "application/json" } });
  } catch (e) {
    throw new LiveSessionError("network", `Usage request failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  const body = (await res.json().catch(() => ({}))) as Partial<LiveUsage> & { error?: string; reason?: string };
  if (!res.ok) {
    const code = body.error ?? (res.status === 401 ? "signed_out" : res.status === 503 ? "unconfigured" : `http_${res.status}`);
    throw new LiveSessionError(code, body.reason ?? `Usage answered ${res.status}.`);
  }
  return body as LiveUsage;
}

/** Fold the hosted counters into the legacy summary shape. `model` names the
 *  Ally model bucket (from `/api/live/status`), null when unknown. */
export function toUsageSummary(u: LiveUsage, model: string | null, nowMs = Date.now()): UsageSummary {
  const requests = u.ally.requests;
  const tokens = { input_tokens: u.ally.input_tokens, output_tokens: u.ally.output_tokens };
  return {
    providers: requests > 0 ? [{ provider: "anthropic", ...tokens, requests }] : [],
    llm_features:
      requests > 0
        ? [{ feature: "ally", provider: "anthropic", model: model ?? "hosted", ...tokens, requests, failed_requests: u.ally.failed }]
        : [],
    total_input_tokens: tokens.input_tokens,
    total_output_tokens: tokens.output_tokens,
    total_requests: requests,
    tavily_searches: 0,
    tts_characters: 0,
    listening_ms: u.live.used_ms,
    since_unix_ms: u.day_start_unix * 1000,
    updated_at_unix_ms: nowMs,
  };
}

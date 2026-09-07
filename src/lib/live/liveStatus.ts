/**
 * `GET /api/live/status` — whether THIS deployment can run a hosted live
 * session (a provider is configured, the gateway is present). The web adapter
 * turns the answer into capability availability: a mic that the browser can
 * capture but no gateway can transcribe is `unavailable` with the server's
 * reason, never `available`. Pure apart from the injected fetch.
 */
import type { AllyStatus, LibraryStatus, LiveStatus, LiveTerms } from "./protocol";

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

/** A pre-cp11 gateway (no `library`) or one without an embeddings provider is keyword-only, not broken. */
function libraryOf(raw: unknown): LibraryStatus | undefined {
  const l = raw as { embeddings?: Partial<LibraryStatus["embeddings"]> } | undefined;
  if (!l || typeof l !== "object" || !l.embeddings || typeof l.embeddings !== "object") return undefined;
  const e = l.embeddings;
  return {
    embeddings: {
      configured: e.configured === true,
      provider: typeof e.provider === "string" ? e.provider : null,
      model: typeof e.model === "string" ? e.model : null,
      dim: typeof e.dim === "number" ? e.dim : 384,
      reason: typeof e.reason === "string" ? e.reason : e.configured === true ? undefined : "This live gateway has no embeddings provider; retrieval is keyword-only.",
    },
  };
}

/** A pre-cp15 gateway (no `terms`) simply does not say what it sends; nothing is invented for it. */
function termsOf(raw: unknown): LiveTerms | undefined {
  const t = raw as { asr?: unknown; ally?: unknown } | undefined;
  if (!t || typeof t !== "object") return undefined;
  const asr = t.asr as Partial<NonNullable<LiveTerms["asr"]>> | null | undefined;
  const ally = t.ally as Partial<NonNullable<LiveTerms["ally"]>> | null | undefined;
  return {
    asr:
      asr && typeof asr === "object" && typeof asr.provider === "string"
        ? { provider: asr.provider, region: asr.region === "eu" ? "eu" : "us", mip_opt_out: asr.mip_opt_out === true }
        : null,
    ally:
      ally && typeof ally === "object" && typeof ally.provider === "string"
        ? { provider: ally.provider, inference_geo: ally.inference_geo === "us" ? "us" : "global" }
        : null,
  };
}

/** A pre-cp16 gateway (no `notice`) requires no acknowledgement id; the client still shows its notice. */
function noticeOf(raw: unknown): { id: string } | undefined {
  const n = raw as { id?: unknown } | undefined;
  return n && typeof n === "object" && typeof n.id === "string" && n.id.length > 0 ? { id: n.id } : undefined;
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
      library: libraryOf(body.library),
      terms: termsOf(body.terms),
      notice: noticeOf(body.notice),
    };
  } catch (e) {
    const reason = `The live gateway is unreachable: ${e instanceof Error ? e.message : String(e)}`;
    return { ...UNREACHABLE, reason, ally: { ...UNREACHABLE.ally!, reason } };
  }
}

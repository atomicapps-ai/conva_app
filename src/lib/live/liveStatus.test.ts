import { describe, expect, it } from "vitest";

import { fetchLiveStatus } from "./liveStatus";

const json = (body: unknown, status = 200) => (async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;

const BASE = { configured: true, provider: "deepgram", max_sources: 2, sample_rate_hz: 16000, ally: { configured: true, provider: "anthropic", model: "claude-opus-5" } };

describe("fetchLiveStatus — provider terms (cp15)", () => {
  it("parses the terms the gateway says it sends, normalizing unknown values to the defaults", async () => {
    const s = await fetchLiveStatus(json({ ...BASE, terms: { asr: { provider: "deepgram", region: "eu", mip_opt_out: true }, ally: { provider: "anthropic", inference_geo: "us" } } }));
    expect(s.terms).toEqual({ asr: { provider: "deepgram", region: "eu", mip_opt_out: true }, ally: { provider: "anthropic", inference_geo: "us" } });
    const odd = await fetchLiveStatus(json({ ...BASE, terms: { asr: { provider: "deepgram", region: "mars", mip_opt_out: "yes" }, ally: { provider: "anthropic", inference_geo: "eu" } } }));
    expect(odd.terms).toEqual({ asr: { provider: "deepgram", region: "us", mip_opt_out: false }, ally: { provider: "anthropic", inference_geo: "global" } });
  });
  it("keeps null blocks null and leaves terms undefined for a pre-cp15 gateway — nothing is invented", async () => {
    const half = await fetchLiveStatus(json({ ...BASE, terms: { asr: null, ally: { provider: "anthropic", inference_geo: "global" } } }));
    expect(half.terms).toEqual({ asr: null, ally: { provider: "anthropic", inference_geo: "global" } });
    const old = await fetchLiveStatus(json(BASE));
    expect(old.terms).toBeUndefined();
    const down = await fetchLiveStatus(json({ error: "x" }, 503));
    expect(down.configured).toBe(false);
    expect(down.terms).toBeUndefined();
  });
});

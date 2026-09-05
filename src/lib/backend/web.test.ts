import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AllyChunkEvent, AllySourcesEvent } from "@/lib/ipc";
import type { RuntimeProbe } from "@/lib/backend/capabilitySnapshot";
import { WebBackend } from "@/lib/backend/web";
import * as webAuth from "@/lib/backend/webAuth";

const chromeWindows: RuntimeProbe = { os: "windows", hasGetUserMedia: true, hasGetDisplayMedia: true, secureContext: true };

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
const ndjson = (lines: unknown[]) => new Response(lines.map((l) => JSON.stringify(l)).join("\n") + "\n", { status: 200, headers: { "Content-Type": "application/x-ndjson" } });
const STATUS_ON = { configured: true, provider: "deepgram", max_sources: 2, sample_rate_hz: 16000, ally: { configured: true, provider: "anthropic", model: "claude-opus-5" } };
const STATUS_NO_ALLY = { ...STATUS_ON, ally: { configured: false, provider: null, model: null, reason: "ANTHROPIC_API_KEY is not set on this Worker" } };
const STATUS_OFF = { configured: false, provider: null, reason: "session backend: SESSION_SECRET is not set", max_sources: 2, sample_rate_hz: 16000, ally: { configured: false, provider: null, model: null, reason: "session backend: SESSION_SECRET is not set" } };
const USAGE = {
  day: "2027-01-15",
  day_start_unix: 1_799_971_200,
  resets_at_unix: 1_800_057_600,
  live: { used_ms: 60_000, audio_ms: 50_000, limit_ms: 10_800_000, remaining_ms: 10_740_000, sessions: 1, active_sessions: 0, max_concurrent_sessions: 1, max_duration_s: 10_800 },
  ally: { requests: 2, failed: 0, limit: 200, remaining: 198, input_tokens: 80, output_tokens: 12 },
  limits: { max_minutes_per_day: 180, max_concurrent_sessions: 1, max_duration_s: 10_800, ally_max_requests_per_day: 200 },
  beta_access: true,
};

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("WebBackend — Ally over the live gateway (M2 cp3)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    webAuth._resetForTests();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function route(status: unknown, ally?: (init: RequestInit) => Response, usage?: () => Response) {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === "/api/live/status") return json(status);
      if (url === "/api/app/session") return json({ signed_in: false, configured: true });
      if (url === "/api/live/ally" && ally) return ally(init!);
      if (url === "/api/live/usage" && usage) return usage();
      return json({ error: "not_found" }, 404);
    });
  }

  it("usage.summary is available when the gateway's session backend answers (folded hosted counters); reset is unsupported; recover follows capture.start", async () => {
    route(STATUS_NO_ALLY, undefined, () => json(USAGE));
    const b = new WebBackend(chromeWindows);
    expect(b.capabilityStore.snapshot().operations["usage.summary"].state).toBe("unimplemented");
    await tick();
    const ops = b.capabilityStore.snapshot().operations;
    expect(ops["usage.summary"].state).toBe("available");
    expect(ops["usage.reset"].state).toBe("unsupported");
    expect(ops["capture.recover"].state).toBe("available");
    const s = await b.usage.summary();
    expect(s.listening_ms).toBe(60_000);
    expect(s.providers).toEqual([{ provider: "anthropic", input_tokens: 80, output_tokens: 12, requests: 2 }]);
    expect(s.llm_features[0]).toMatchObject({ feature: "ally", model: "hosted" });
    await expect(b.usage.reset()).rejects.toThrow(/desktop-only/);

    route(STATUS_OFF);
    const off = new WebBackend(chromeWindows);
    await tick();
    const o = off.capabilityStore.snapshot().operations;
    expect(o["usage.summary"]).toMatchObject({ state: "unavailable", reason: "session backend: SESSION_SECRET is not set" });
    expect(o["capture.recover"].state).toBe("unavailable");
  });

  it("ally.run is available exactly when the gateway reports Ally configured, else unavailable with its reason", async () => {
    route(STATUS_ON);
    const on = new WebBackend(chromeWindows);
    expect(on.capabilityStore.snapshot().operations["ally.run"].state).toBe("unimplemented");
    await tick();
    expect(on.capabilityStore.snapshot().operations["ally.run"].state).toBe("available");

    route(STATUS_NO_ALLY);
    const off = new WebBackend(chromeWindows);
    await tick();
    const a = off.capabilityStore.snapshot().operations["ally.run"];
    expect(a.state).toBe("unavailable");
    expect(a.state === "unavailable" && a.reason).toMatch(/ANTHROPIC_API_KEY/);
    expect(off.capabilityStore.snapshot().operations["session.start"].state).toBe("available");
  });

  it("ally.run streams the gateway's answer as allySources then allyChunk events (done last), through the in-page bus", async () => {
    let sent: unknown = null;
    route(STATUS_ON, (init) => {
      sent = JSON.parse(init.body as string);
      return ndjson([
        { type: "sources", request_id: "ally-7", sources: [{ file_name: "pricing.pdf", location: "§2" }] },
        { type: "chunk", request_id: "ally-7", token: "**$120/mo**" },
        { type: "chunk", request_id: "ally-7", token: " — confirm term" },
        { type: "done", request_id: "ally-7", stop_reason: "end_turn", usage: { input_tokens: 30, output_tokens: 8 } },
      ]);
    });
    const b = new WebBackend(chromeWindows);
    const chunks: AllyChunkEvent[] = [];
    const sources: AllySourcesEvent[] = [];
    const offChunk = await b.subscribe("allyChunk", (e) => chunks.push(e));
    await b.subscribe("allySources", (e) => sources.push(e));
    await b.ally.run("ally-7", "suggest_reply", null, [
      { side: "inbound", seq: 1, text: "How much is it?", is_final: true, start_ms: 0, end_ms: 900, confidence: null, latency_ms: 10 },
    ]);
    expect(sent).toMatchObject({ request_id: "ally-7", kind: "suggest_reply", question: null, segments: [{ side: "inbound", text: "How much is it?", is_final: true }] });
    expect(sources).toEqual([{ request_id: "ally-7", sources: [{ file_name: "pricing.pdf", location: "§2" }] }]);
    expect(chunks).toEqual([
      { request_id: "ally-7", token: "**$120/mo**", done: false, error: null },
      { request_id: "ally-7", token: " — confirm term", done: false, error: null },
      { request_id: "ally-7", token: "", done: true, error: null },
    ]);
    offChunk();
    await b.ally.run("ally-8", "summarize", null, []);
    expect(chunks).toHaveLength(3);
  });

  it("a refusal before any line rejects with the server's code; a mid-stream error ends the card with a terminal error chunk", async () => {
    route(STATUS_NO_ALLY, () => json({ error: "unconfigured", reason: "ANTHROPIC_API_KEY is not set" }, 503));
    const b = new WebBackend(chromeWindows);
    await expect(b.ally.run("r", "summarize", null, [])).rejects.toMatchObject({ code: "unconfigured" });

    route(STATUS_ON, () => ndjson([{ type: "sources", request_id: "r2", sources: [] }, { type: "error", request_id: "r2", code: "refusal", message: "Ally declined to answer this request." }]));
    const b2 = new WebBackend(chromeWindows);
    const chunks: AllyChunkEvent[] = [];
    await b2.subscribe("allyChunk", (e) => chunks.push(e));
    await b2.ally.run("r2", "question", "Why?", []);
    expect(chunks).toEqual([{ request_id: "r2", token: "", done: true, error: "Ally declined to answer this request. (refusal)" }]);
  });
});

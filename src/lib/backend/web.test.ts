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

  function route(status: unknown, ally?: (init: RequestInit) => Response) {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === "/api/live/status") return json(status);
      if (url === "/api/app/session") return json({ signed_in: false, configured: true });
      if (url === "/api/live/ally" && ally) return ally(init!);
      return json({ error: "not_found" }, 404);
    });
  }

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

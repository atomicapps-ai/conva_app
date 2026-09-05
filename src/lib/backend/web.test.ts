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

  it("telemetry: Ally runs are recorded content-free and flushTelemetry posts one validated aggregate to /api/live/telemetry", async () => {
    const question = "Did the buyer, Priya Natarajan, agree to the 14% discount?";
    route(STATUS_ON, () => ndjson([{ type: "sources", request_id: "t1", sources: [] }, { type: "chunk", request_id: "t1", token: "Yes — Priya agreed." }, { type: "done", request_id: "t1", stop_reason: "end_turn", usage: null }]));
    const b = new WebBackend(chromeWindows);
    await b.ally.run("t1", "question", question, []);
    // The fake answers every request with t1's lines, so t2's stream ends
    // without a terminal line for t2 → a truthful stream_truncated error.
    await expect(b.ally.run("t2", "summarize", null, [])).resolves.toBeUndefined();
    b.flushTelemetry(false);
    const post = fetchMock.mock.calls.find((c) => c[0] === "/api/live/telemetry") as [string, RequestInit] | undefined;
    expect(post).toBeDefined();
    expect(post![1].method).toBe("POST");
    expect(post![1].credentials).toBe("same-origin");
    const agg = JSON.parse(post![1].body as string) as { schema: number; ally: { by_kind: Record<string, number>; by_outcome: Record<string, number> }; samples: number };
    expect(agg.schema).toBe(1);
    expect(agg.samples).toBe(2);
    expect(agg.ally.by_kind).toEqual({ question: 1, summarize: 1 });
    expect(agg.ally.by_outcome).toEqual({ ok: 1, error: 1 });
    expect((agg.ally as { by_code: Record<string, number> }).by_code).toEqual({ stream_truncated: 1 });
    for (const s of ["Priya", "Natarajan", "discount", "agreed", "14%"]) expect(post![1].body as string).not.toContain(s);
    // Nothing left → no second post.
    b.flushTelemetry(false);
    expect(fetchMock.mock.calls.filter((c) => c[0] === "/api/live/telemetry")).toHaveLength(1);
  });

  it("sessions.exportTranscript on web is a browser download of the desktop Markdown (nothing is fetched)", async () => {
    route(STATUS_ON);
    const b = new WebBackend(chromeWindows);
    const urls: string[] = [];
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: (blob: Blob) => { urls.push(`blob:${blob.size}`); return "blob:x"; }, revokeObjectURL: () => {} }));
    const clicks: string[] = [];
    const origCreate = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = origCreate(tag);
      if (tag === "a") (el as HTMLAnchorElement).click = () => clicks.push((el as HTMLAnchorElement).download);
      return el;
    });
    const before = fetchMock.mock.calls.length;
    await b.sessions.exportTranscript("C:\\notes\\call.md", [
      { side: "inbound", seq: 1, text: "How much is it?", is_final: true, start_ms: 0, end_ms: 900, confidence: null, latency_ms: 10 },
    ]);
    expect(clicks).toEqual(["call.md"]);
    expect(urls).toHaveLength(1);
    expect(fetchMock.mock.calls.length).toBe(before, "export never touches the network");
    await b.sessions.writeTextFile("report.md", "# analysis");
    expect(clicks).toEqual(["call.md", "report.md"]);
    vi.restoreAllMocks();
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

describe("WebBackend — cloud Contexts (M2 cp7)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    webAuth._resetForTests();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const CTX = {
    id: "ctx-1",
    title: "Acme interview",
    purpose: "Panel interview",
    job_description: null,
    category: "interview",
    status: "ready",
    created_at_unix_ms: 1,
    updated_at_unix_ms: 2,
    source_doc_ids: [],
    auto_generate_context: false,
    knowledge_profile_id: null,
    personas: [],
    chosen_persona_id: null,
    conversation_id: null,
    dossier_doc_id: null,
  };

  function route(status: unknown, handlers: Record<string, (init: RequestInit) => Response> = {}) {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === "/api/live/status") return json(status);
      if (url === "/api/app/session") return json({ signed_in: false, configured: true });
      const h = handlers[`${init?.method ?? "GET"} ${url}`];
      return h ? h(init ?? {}) : json({ error: "not_found" }, 404);
    });
  }

  it("context.* ride the session backend: available when it answers (even with Ally off), unavailable with its reason otherwise", async () => {
    route(STATUS_NO_ALLY);
    const on = new WebBackend(chromeWindows);
    expect(on.capabilityStore.snapshot().operations["context.list"].state).toBe("unimplemented");
    await tick();
    const ops = on.capabilityStore.snapshot().operations;
    for (const op of ["context.save", "context.list", "context.load", "context.delete", "context.activateContext", "context.deactivateContext"] as const) {
      expect(ops[op].state, op).toBe("available");
    }
    expect(ops["context.storeDocs"].state).toBe("unsupported");

    route(STATUS_OFF);
    const off = new WebBackend(chromeWindows);
    await tick();
    const o = off.capabilityStore.snapshot().operations;
    expect(o["context.list"]).toMatchObject({ state: "unavailable", reason: "session backend: SESSION_SECRET is not set" });
    expect(o["context.activateContext"].state).toBe("unavailable");
  });

  it("list/save/load/delete go through /api/live/contexts as the signed-in user; `unprovisioned` surfaces as a coded error", async () => {
    const saved: unknown[] = [];
    route(STATUS_ON, {
      "GET /api/live/contexts": () => json({ contexts: [{ id: "ctx-1", title: "Acme interview", category: "interview", status: "ready" }] }),
      "POST /api/live/contexts": (init) => {
        saved.push(JSON.parse(init.body as string));
        return json({ context: CTX });
      },
      "GET /api/live/contexts/ctx-1": () => json({ context: CTX }),
      "DELETE /api/live/contexts/ctx-1": () => json({ ok: true }),
    });
    const b = new WebBackend(chromeWindows);
    await tick();
    expect(await b.context.list()).toEqual([{ id: "ctx-1", title: "Acme interview", category: "interview", status: "ready" }]);
    expect(await b.context.save(CTX as never)).toEqual(CTX);
    expect(saved).toEqual([CTX]);
    expect((await b.context.load("ctx-1")).title).toBe("Acme interview");
    await expect(b.context.delete("ctx-1")).resolves.toBeUndefined();

    route(STATUS_ON, { "GET /api/live/contexts": () => json({ error: "unprovisioned", reason: "Apply migration 0005." }, 503) });
    await expect(b.context.list()).rejects.toMatchObject({ code: "unprovisioned", message: "Apply migration 0005." });
  });

  it("activateContext loads the record and grounds every following Ally ask with its id; deactivate (or the default Context) goes back to ungrounded", async () => {
    const asks: { context_id?: string }[] = [];
    route(STATUS_ON, {
      "GET /api/live/contexts/ctx-1": () => json({ context: CTX }),
      "POST /api/live/ally": (init) => {
        asks.push(JSON.parse(init.body as string));
        const id = (asks.at(-1) as { request_id: string }).request_id;
        return ndjson([
          { type: "sources", request_id: id, sources: [] },
          { type: "done", request_id: id, stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } },
        ]);
      },
    });
    const b = new WebBackend(chromeWindows);
    await tick();

    await b.ally.run("a0", "summarize", null, []);
    expect(asks[0]).not.toHaveProperty("context_id");

    const ctx = await b.context.activateContext("ctx-1");
    expect(ctx.id).toBe("ctx-1");
    await b.ally.run("a1", "question", "What do they want?", []);
    expect(asks[1]).toMatchObject({ request_id: "a1", context_id: "ctx-1" });

    await b.context.deactivateContext();
    await b.ally.run("a2", "summarize", null, []);
    expect(asks[2]).not.toHaveProperty("context_id");

    // The default Context is synthesised locally — nothing is fetched — and means "ungrounded".
    await b.context.activateContext("ctx-1");
    const before = fetchMock.mock.calls.length;
    const dflt = await b.context.activateContext("default");
    expect(dflt).toMatchObject({ id: "default", title: "General", status: "ready" });
    expect(fetchMock.mock.calls.length).toBe(before);
    expect((await b.context.load("default")).id).toBe("default");
    await b.ally.run("a3", "summarize", null, []);
    expect(asks[3]).not.toHaveProperty("context_id");
  });

  it("deleting the active Context drops the grounding; activating an unknown id rejects with the Worker's code and grounds nothing", async () => {
    const asks: { context_id?: string }[] = [];
    route(STATUS_ON, {
      "GET /api/live/contexts/ctx-1": () => json({ context: CTX }),
      "GET /api/live/contexts/missing": () => json({ error: "not_found" }, 404),
      "DELETE /api/live/contexts/ctx-1": () => json({ ok: true }),
      "POST /api/live/ally": (init) => {
        asks.push(JSON.parse(init.body as string));
        const id = (asks.at(-1) as { request_id: string }).request_id;
        return ndjson([{ type: "done", request_id: id, stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } }]);
      },
    });
    const b = new WebBackend(chromeWindows);
    await tick();
    await b.context.activateContext("ctx-1");
    await expect(b.context.activateContext("missing")).rejects.toMatchObject({ code: "not_found" });
    await b.ally.run("a1", "summarize", null, []);
    expect(asks[0]).toMatchObject({ context_id: "ctx-1" }); // the failed activation left the previous grounding intact
    await b.context.delete("ctx-1");
    await b.ally.run("a2", "summarize", null, []);
    expect(asks[1]).not.toHaveProperty("context_id");
  });
});

describe("WebBackend — cloud Conversations (M2 cp8)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    webAuth._resetForTests();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const SEG = { side: "inbound" as const, seq: 1, text: "How much is it?", is_final: true, start_ms: 0, end_ms: 900, confidence: null, latency_ms: 40 };
  const CONV = { id: "conv-1", title: "How much is it?", created_at_unix_ms: 1, updated_at_unix_ms: 2, segments: [SEG], linked_docs: [], linked_context_id: "ctx-1" };

  function route(status: unknown, handlers: Record<string, (init: RequestInit) => Response> = {}) {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === "/api/live/status") return json(status);
      if (url === "/api/app/session") return json({ signed_in: false, configured: true });
      const h = handlers[`${init?.method ?? "GET"} ${url}`];
      return h ? h(init ?? {}) : json({ error: "not_found" }, 404);
    });
  }

  it("conversations.* ride the session backend like Contexts: available when it answers, unavailable with its reason otherwise", async () => {
    route(STATUS_NO_ALLY);
    const on = new WebBackend(chromeWindows);
    expect(on.capabilityStore.snapshot().operations["conversations.save"].state).toBe("unimplemented");
    await tick();
    for (const op of ["conversations.save", "conversations.list", "conversations.load", "conversations.delete"] as const) {
      expect(on.capabilityStore.snapshot().operations[op].state, op).toBe("available");
    }
    route(STATUS_OFF);
    const off = new WebBackend(chromeWindows);
    await tick();
    expect(off.capabilityStore.snapshot().operations["conversations.save"]).toMatchObject({ state: "unavailable", reason: "session backend: SESSION_SECRET is not set" });
  });

  it("save posts the store's inputs (id, title, segments, linked docs, active Context) and returns the Worker's record; list/load/delete round-trip; unprovisioned is coded", async () => {
    const posted: unknown[] = [];
    route(STATUS_ON, {
      "POST /api/live/conversations": (init) => {
        posted.push(JSON.parse(init.body as string));
        return json({ conversation: CONV });
      },
      "GET /api/live/conversations": () => json({ conversations: [{ id: "conv-1", title: CONV.title, segment_count: 1, preview: SEG.text }] }),
      "GET /api/live/conversations/conv-1": () => json({ conversation: CONV }),
      "DELETE /api/live/conversations/conv-1": () => json({ ok: true }),
    });
    const b = new WebBackend(chromeWindows);
    await tick();
    const saved = await b.conversations.save(null, null, [SEG, { ...SEG, seq: 2, text: "partial", is_final: false }], ["d1"], "ctx-1");
    expect(saved).toEqual(CONV);
    expect(posted[0]).toEqual({ id: null, title: null, segments: [SEG, { ...SEG, seq: 2, text: "partial", is_final: false }], linked_docs: ["d1"], context_id: "ctx-1" });
    await b.conversations.save("conv-1", "Renamed", [SEG], [], null);
    expect(posted[1]).toEqual({ id: "conv-1", title: "Renamed", segments: [SEG], linked_docs: [] });
    expect(await b.conversations.list()).toEqual([{ id: "conv-1", title: CONV.title, segment_count: 1, preview: SEG.text }]);
    expect((await b.conversations.load("conv-1")).segments).toEqual([SEG]);
    await expect(b.conversations.delete("conv-1")).resolves.toBeUndefined();

    route(STATUS_ON, { "POST /api/live/conversations": () => json({ error: "unprovisioned", reason: "Apply migration 0006." }, 503) });
    await expect(b.conversations.save(null, null, [SEG], [], null)).rejects.toMatchObject({ code: "unprovisioned", message: "Apply migration 0006." });
  });
});

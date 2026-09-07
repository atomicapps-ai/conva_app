import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AllyChunkEvent, AllySourcesEvent } from "@/lib/ipc";
import type { RuntimeProbe } from "@/lib/backend/capabilitySnapshot";
import { WebBackend } from "@/lib/backend/web";
import * as webAuth from "@/lib/backend/webAuth";
import { useHostedConsentStore } from "@/state/hostedConsent";

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
    for (const op of ["context.save", "context.list", "context.load", "context.delete", "context.activateContext", "context.deactivateContext", "context.prepare"] as const) {
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

  it("prepare marks a draft Context ready without touching its other fields, and is a no-op past draft (M2 cp20 — the setup wizard's Finish awaits this on web)", async () => {
    const draft = { ...CTX, id: "ctx-2", status: "draft" as const };
    const saved: unknown[] = [];
    route(STATUS_ON, {
      "GET /api/live/contexts/ctx-2": () => json({ context: draft }),
      "POST /api/live/contexts": (init) => {
        const body = JSON.parse(init.body as string);
        saved.push(body);
        return json({ context: body });
      },
    });
    const b = new WebBackend(chromeWindows);
    await tick();
    const ready = await b.context.prepare("ctx-2");
    expect(ready).toMatchObject({ ...draft, status: "ready" });
    expect(saved).toEqual([{ ...draft, status: "ready" }]);

    // Already past draft: no save call, the record comes back unchanged.
    route(STATUS_ON, { "GET /api/live/contexts/ctx-2": () => json({ context: { ...draft, status: "ready" } }) });
    const before = fetchMock.mock.calls.length;
    expect(await b.context.prepare("ctx-2")).toMatchObject({ status: "ready" });
    expect(fetchMock.mock.calls.length).toBe(before + 1); // the GET only — no POST
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

describe("WebBackend — cloud library (M2 cp9, text-first)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    webAuth._resetForTests();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const DOC = { id: "doc_1", file_name: "pricing.md", enabled: true, chunk_count: 2, ingested_at_unix_ms: 1, source: "pasted", context_ids: [], size_bytes: 9 };

  function route(status: unknown, handlers: Record<string, (init: RequestInit) => Response> = {}) {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === "/api/live/status") return json(status);
      if (url === "/api/app/session") return json({ signed_in: false, configured: true });
      const h = handlers[`${init?.method ?? "GET"} ${url}`];
      return h ? h(init ?? {}) : json({ error: "not_found" }, 404);
    });
  }

  it("text-based rag.* flip to available with the session backend; rag.ingest (file paths) stays unsupported", async () => {
    route(STATUS_NO_ALLY);
    const on = new WebBackend(chromeWindows);
    expect(on.capabilityStore.snapshot().operations["rag.ingestText"].state).toBe("unimplemented");
    await tick();
    const ops = on.capabilityStore.snapshot().operations;
    for (const op of ["rag.ingestText", "rag.list", "rag.setEnabled", "rag.delete", "rag.attachContext", "rag.detachContext", "rag.documentText"] as const) {
      expect(ops[op].state, op).toBe("available");
    }
    expect(ops["rag.ingest"].state).toBe("unsupported");
    route(STATUS_OFF);
    const off = new WebBackend(chromeWindows);
    await tick();
    expect(off.capabilityStore.snapshot().operations["rag.list"]).toMatchObject({ state: "unavailable", reason: "session backend: SESSION_SECRET is not set" });
  });

  it("rag.upload sends each File through /api/live/library/upload in order; rag.download streams the original into a browser download named after `dest`", async () => {
    const uploads: { name: string | null; type: string | null; size: number }[] = [];
    route(STATUS_ON, {
      "POST /api/live/library/upload": (init) => {
        const h = init.headers as Record<string, string>;
        const body = init.body as File;
        uploads.push({ name: h["X-Conva-File-Name"], type: h["Content-Type"], size: body.size });
        return json({ report: { document: { ...DOC, id: `doc_${uploads.length}`, source: "file" }, warnings: [] } });
      },
      "GET /api/live/library/doc_1/original": () => new Response(new Uint8Array([9, 9]), { status: 200, headers: { "Content-Type": "text/markdown", "Content-Disposition": "attachment; filename=\"server-name.md\"" } }),
    });
    const b = new WebBackend(chromeWindows);
    await tick();
    for (const op of ["rag.upload", "rag.download"] as const) expect(b.capabilityStore.snapshot().operations[op].state, op).toBe("available");
    const reports = await b.rag.upload([new File(["a"], "one.md", { type: "text/markdown" }), new File(["bb"], "two.txt", { type: "text/plain" })]);
    expect(reports.map((r) => r.document.id)).toEqual(["doc_1", "doc_2"]);
    expect(uploads).toEqual([
      { name: "one.md", type: "text/markdown", size: 1 },
      { name: "two.txt", type: "text/plain", size: 2 },
    ]);

    const clicks: string[] = [];
    const realCreate = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = realCreate(tag);
      if (tag === "a") el.addEventListener("click", (e) => { e.preventDefault(); clicks.push((el as HTMLAnchorElement).download); });
      return el;
    });
    vi.stubGlobal("URL", { ...URL, createObjectURL: () => "blob:x", revokeObjectURL: () => {} });
    await b.rag.download("doc_1", "C:\\Users\\me\\Downloads\\pricing.md");
    expect(clicks).toEqual(["pricing.md"]);
    vi.restoreAllMocks();
  });

  it("ingestText / list / setEnabled / attach / detach / delete / documentText round-trip through /api/live/library; unprovisioned is coded", async () => {
    const bodies: unknown[] = [];
    route(STATUS_ON, {
      "POST /api/live/library": (init) => {
        bodies.push(JSON.parse(init.body as string));
        return json({ report: { document: DOC, warnings: [] } });
      },
      "GET /api/live/library": () => json({ documents: [DOC] }),
      "PATCH /api/live/library/doc_1": (init) => {
        bodies.push(JSON.parse(init.body as string));
        return json({ document: DOC });
      },
      "DELETE /api/live/library/doc_1": () => json({ ok: true }),
      "GET /api/live/library/doc_1/text": () => json({ text: "# Pricing" }),
    });
    const b = new WebBackend(chromeWindows);
    await tick();
    expect(await b.rag.ingestText("pricing.md", "# Pricing")).toEqual({ document: DOC, warnings: [] });
    expect(await b.rag.list()).toEqual([DOC]);
    await expect(b.rag.setEnabled("doc_1", false)).resolves.toBeUndefined();
    await expect(b.rag.attachContext("doc_1", "ctx-1")).resolves.toBeUndefined();
    await expect(b.rag.detachContext("doc_1", "ctx-1")).resolves.toBeUndefined();
    await expect(b.rag.delete("doc_1")).resolves.toBeUndefined();
    expect(await b.rag.documentText("doc_1")).toBe("# Pricing");
    expect(await b.rag.documentText("missing")).toBeNull();
    expect(bodies).toEqual([{ name: "pricing.md", text: "# Pricing" }, { enabled: false }, { attach_context: "ctx-1" }, { detach_context: "ctx-1" }]);
    await expect(b.rag.ingest(["C:\\\\file.pdf"])).rejects.toThrow(/rag.ingest/);

    route(STATUS_ON, { "GET /api/live/library": () => json({ error: "unprovisioned", reason: "Apply migration 0007." }, 503) });
    await expect(b.rag.list()).rejects.toMatchObject({ code: "unprovisioned", message: "Apply migration 0007." });
  });
});

describe("WebBackend — hosted-processing notice (M2 cp16)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    webAuth._resetForTests();
    useHostedConsentStore.getState().reset();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  const TERMS = { asr: { provider: "deepgram", region: "us", mip_opt_out: true }, ally: { provider: "anthropic", inference_geo: "global" } };
  function route(status: unknown) {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === "/api/live/status") return json(status);
      if (url === "/api/app/session") return json({ signed_in: false, configured: true });
      return json({ error: "not_found" }, 404);
    });
  }

  it("Start asks the notice first — before any mic prompt or gateway call — and a decline is consent_required", async () => {
    route({ ...STATUS_ON, terms: TERMS, notice: { id: "hosted-v1" } });
    const b = new WebBackend(chromeWindows);
    await tick();
    expect(useHostedConsentStore.getState().terms).toEqual(TERMS);
    expect(b.capabilityStore.snapshot().operations["session.start"].state).toBe("available");
    const start = b.session.start();
    await tick();
    expect(useHostedConsentStore.getState().pending?.scope).toEqual(["mic"]);
    useHostedConsentStore.getState().decline();
    await expect(start).rejects.toMatchObject({ code: "consent_required" });
    expect(fetchMock.mock.calls.some(([url]) => url === "/api/live/sessions")).toBe(false);
    // Sharing call audio is a scope expansion with its own notice.
    const share = b.capture.start("display", "share-1");
    await tick();
    expect(useHostedConsentStore.getState().pending).toMatchObject({ scope: ["display"], expanding: true });
    useHostedConsentStore.getState().decline();
    await expect(share).rejects.toMatchObject({ code: "consent_required" });
  });

  it("a build whose notice id is not the one the gateway requires cannot start hosted sessions, and says why", async () => {
    route({ ...STATUS_ON, terms: TERMS, notice: { id: "hosted-v2" } });
    const b = new WebBackend(chromeWindows);
    await tick();
    const op = b.capabilityStore.snapshot().operations["session.start"];
    expect(op.state).toBe("unavailable");
    expect(op.state === "unavailable" ? op.reason : "").toMatch(/hosted-v1.*out of date.*hosted-v2/);
    // A pre-cp16 gateway (no notice id) is not held back — the client still shows its notice.
    route(STATUS_ON);
    const old = new WebBackend(chromeWindows);
    await tick();
    expect(old.capabilityStore.snapshot().operations["session.start"].state).toBe("available");
  });
});

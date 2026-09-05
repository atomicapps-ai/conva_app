import { describe, expect, it } from "vitest";

import type { TranscriptSegment } from "@/lib/ipc";
import { LiveSessionError } from "@/lib/live/liveClient";
import { evidenceFrom, MAX_EVIDENCE_SEGMENTS, runAlly } from "@/lib/live/allyClient";
import { fetchLiveStatus } from "@/lib/live/liveStatus";
import { parseAllyLine, type AllyStreamLine } from "@/lib/live/protocol";

const seg = (side: "inbound" | "outbound", text: string, is_final = true, seq = 0): TranscriptSegment => ({
  side,
  seq,
  text,
  is_final,
  start_ms: seq * 1000,
  end_ms: seq * 1000 + 900,
  confidence: null,
  latency_ms: 50,
});

/** A streamed NDJSON body split at arbitrary byte boundaries. */
function ndjsonResponse(lines: unknown[], chunkSize = 11, status = 200): Response {
  const bytes = new TextEncoder().encode(lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  let i = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(c) {
      if (i >= bytes.length) return c.close();
      c.enqueue(bytes.slice(i, i + chunkSize));
      i += chunkSize;
    },
  });
  return new Response(body, { status, headers: { "Content-Type": "application/x-ndjson" } });
}

describe("evidenceFrom — bounded evidence for the Ally request", () => {
  it("keeps finals in order, drops empty text, appends the latest partial per side, slims the fields", () => {
    const out = evidenceFrom([
      seg("inbound", "How much?", true, 1),
      seg("outbound", "   ", true, 2),
      seg("outbound", "One sec", true, 3),
      seg("inbound", "and wha", false, 4),
      seg("inbound", "and what abou", false, 5),
      seg("outbound", "I thi", false, 6),
    ]);
    expect(out).toEqual([
      { side: "inbound", text: "How much?", is_final: true, start_ms: 1000, end_ms: 1900 },
      { side: "outbound", text: "One sec", is_final: true, start_ms: 3000, end_ms: 3900 },
      { side: "inbound", text: "and what abou", is_final: false, start_ms: 5000, end_ms: 5900 },
      { side: "outbound", text: "I thi", is_final: false, start_ms: 6000, end_ms: 6900 },
    ]);
  });

  it("caps at MAX_EVIDENCE_SEGMENTS newest finals", () => {
    const many = Array.from({ length: MAX_EVIDENCE_SEGMENTS + 50 }, (_, i) => seg("inbound", `turn ${i}`, true, i));
    const out = evidenceFrom(many);
    expect(out).toHaveLength(MAX_EVIDENCE_SEGMENTS);
    expect(out[0].text).toBe("turn 50");
    expect(out.at(-1)?.text).toBe(`turn ${MAX_EVIDENCE_SEGMENTS + 49}`);
  });
});

describe("parseAllyLine", () => {
  it("accepts the four line types and rejects malformed ones", () => {
    expect(parseAllyLine('{"type":"sources","request_id":"r","sources":[{"file_name":"a.pdf","location":"§1"},{"bad":1}]}')).toEqual({
      type: "sources",
      request_id: "r",
      sources: [{ file_name: "a.pdf", location: "§1" }],
    });
    expect(parseAllyLine('{"type":"chunk","request_id":"r","token":"hi"}')).toEqual({ type: "chunk", request_id: "r", token: "hi" });
    expect(parseAllyLine('{"type":"done","request_id":"r","stop_reason":"end_turn","usage":{"input_tokens":1,"output_tokens":2}}')).toEqual({
      type: "done",
      request_id: "r",
      stop_reason: "end_turn",
      usage: { input_tokens: 1, output_tokens: 2 },
    });
    expect(parseAllyLine('{"type":"error","request_id":"r","code":"refusal","message":"no"}')).toEqual({ type: "error", request_id: "r", code: "refusal", message: "no" });
    expect(parseAllyLine("not json")).toBeNull();
    expect(parseAllyLine('{"type":"chunk","token":"no id"}')).toBeNull();
    expect(parseAllyLine('{"type":"mystery","request_id":"r"}')).toBeNull();
  });
});

describe("runAlly — POST /api/live/ally", () => {
  it("sends the bounded evidence with cookie credentials and replays sources → chunks → done in order", async () => {
    let captured: { url: string; init: RequestInit } | null = null;
    const f = (async (url: string | URL | Request, init?: RequestInit) => {
      captured = { url: String(url), init: init! };
      return ndjsonResponse([
        { type: "sources", request_id: "r1", sources: [] },
        { type: "chunk", request_id: "r1", token: "**Yes**" },
        { type: "chunk", request_id: "other", token: "NOT MINE" },
        { type: "chunk", request_id: "r1", token: " — $120/mo" },
        { type: "done", request_id: "r1", stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 4 } },
      ]);
    }) as typeof fetch;
    const lines: AllyStreamLine[] = [];
    await runAlly(
      { fetch: f },
      { request_id: "r1", kind: "suggest_reply", question: null, segments: [seg("inbound", "How much?"), seg("outbound", "partial", false)] },
      (l) => lines.push(l),
    );
    expect(captured!.url).toBe("/api/live/ally");
    expect(captured!.init.method).toBe("POST");
    expect(captured!.init.credentials).toBe("same-origin");
    expect(JSON.parse(captured!.init.body as string)).toEqual({
      request_id: "r1",
      kind: "suggest_reply",
      question: null,
      segments: [
        { side: "inbound", text: "How much?", is_final: true, start_ms: 0, end_ms: 900 },
        { side: "outbound", text: "partial", is_final: false, start_ms: 0, end_ms: 900 },
      ],
    });
    expect(lines.map((l) => l.type)).toEqual(["sources", "chunk", "chunk", "done"]);
    expect(lines.filter((l) => l.type === "chunk").map((l) => (l as { token: string }).token)).toEqual(["**Yes**", " — $120/mo"]);
  });

  it("turns HTTP refusals into coded LiveSessionErrors before any line", async () => {
    const refuse = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as typeof fetch;
    const req = { request_id: "r", kind: "summarize" as const, question: null, segments: [] };
    await expect(runAlly({ fetch: refuse(401, { error: "signed_out" }) }, req, () => {})).rejects.toMatchObject({ code: "signed_out" });
    await expect(runAlly({ fetch: refuse(403, { error: "not_entitled", reason: "Not on the allowlist." }) }, req, () => {})).rejects.toMatchObject({
      code: "not_entitled",
      message: "Not on the allowlist.",
    });
    await expect(runAlly({ fetch: refuse(503, { error: "unconfigured", reason: "ANTHROPIC_API_KEY is not set" }) }, req, () => {})).rejects.toMatchObject({ code: "unconfigured" });
    await expect(runAlly({ fetch: refuse(409, { error: "duplicate_request" }) }, req, () => {})).rejects.toMatchObject({ code: "duplicate_request" });
    const netFail = (async () => {
      throw new TypeError("Failed to fetch");
    }) as typeof fetch;
    const err = await runAlly({ fetch: netFail }, req, () => {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LiveSessionError);
    expect((err as LiveSessionError).code).toBe("network");
  });

  it("a stream that ends without a terminal line yields a synthetic error line, so the card never hangs", async () => {
    const f = (async () => ndjsonResponse([{ type: "sources", request_id: "r", sources: [] }, { type: "chunk", request_id: "r", token: "partial answer" }])) as typeof fetch;
    const lines: AllyStreamLine[] = [];
    await runAlly({ fetch: f }, { request_id: "r", kind: "question", question: "Why?", segments: [] }, (l) => lines.push(l));
    expect(lines.at(-1)).toMatchObject({ type: "error", code: "stream_truncated" });
  });

  it("a body that errors mid-stream yields stream_interrupted once", async () => {
    let pulls = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(c) {
        // First pull delivers two lines; the next one fails like a dropped connection.
        if (pulls++ === 0) c.enqueue(new TextEncoder().encode('{"type":"sources","request_id":"r","sources":[]}\n{"type":"chunk","request_id":"r","token":"a"}\n'));
        else c.error(new Error("connection reset"));
      },
    });
    const f = (async () => new Response(body, { status: 200 })) as typeof fetch;
    const lines: AllyStreamLine[] = [];
    await runAlly({ fetch: f }, { request_id: "r", kind: "summarize", question: null, segments: [] }, (l) => lines.push(l));
    expect(lines.map((l) => l.type)).toEqual(["sources", "chunk", "error"]);
    expect(lines.at(-1)).toMatchObject({ code: "stream_interrupted" });
  });
});

describe("fetchLiveStatus — ally readiness", () => {
  const json = (b: unknown, status = 200) => (async () => new Response(JSON.stringify(b), { status })) as typeof fetch;
  it("reads a cp3 gateway's ally block, and reports a cp1 gateway (no block) as not configured with a reason", async () => {
    const cp3 = await fetchLiveStatus(json({ configured: true, provider: "deepgram", max_sources: 2, sample_rate_hz: 16000, ally: { configured: true, provider: "anthropic", model: "claude-opus-5" } }));
    expect(cp3.ally).toEqual({ configured: true, provider: "anthropic", model: "claude-opus-5", reason: undefined });
    const cp1 = await fetchLiveStatus(json({ configured: true, provider: "deepgram", max_sources: 2, sample_rate_hz: 16000 }));
    expect(cp1.configured).toBe(true);
    expect(cp1.ally?.configured).toBe(false);
    expect(cp1.ally?.reason).toMatch(/does not offer Ally/);
    const off = await fetchLiveStatus(json({ configured: true, provider: "deepgram", max_sources: 2, sample_rate_hz: 16000, ally: { configured: false, provider: null, model: null, reason: "ANTHROPIC_API_KEY is not set" } }));
    expect(off.ally).toMatchObject({ configured: false, reason: "ANTHROPIC_API_KEY is not set" });
    const down = await fetchLiveStatus(json({}, 502));
    expect(down.ally?.configured).toBe(false);
    expect(down.ally?.reason).toMatch(/502/);
  });
});

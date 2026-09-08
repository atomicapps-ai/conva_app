import { describe, expect, it } from "vitest";

import type { Conversation, TranscriptSegment } from "@/lib/ipc";
import { LiveSessionError } from "@/lib/live/liveClient";
import { deleteConversation, listConversations, loadConversation, saveConversation } from "@/lib/live/conversationsClient";

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
const seg = (side: "inbound" | "outbound", text: string, is_final = true, seq = 0): TranscriptSegment => ({ side, seq, text, is_final, start_ms: seq * 1000, end_ms: seq * 1000 + 900, confidence: null, latency_ms: 50 });
const CONV: Conversation = { id: "conv-1", title: "Renewal call", created_at_unix_ms: 1, updated_at_unix_ms: 2, segments: [seg("inbound", "How much?", true, 1)], linked_docs: ["d1"], linked_context_id: "ctx-1" };

function fake(table: Record<string, () => Response>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const f = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const key = `${init?.method ?? "GET"} ${String(url)}`;
    return table[key] ? table[key]() : json({ error: "not_found" }, 404);
  }) as typeof fetch;
  return { f, calls };
}

describe("conversationsClient — /api/live/conversations (M2 cp8)", () => {
  it("list/load/save/delete hit the four routes with cookie credentials; save sends the desktop command's inputs and omits an absent Context", async () => {
    const { f, calls } = fake({
      "GET /api/live/conversations": () => json({ conversations: [{ id: "conv-1", title: "Renewal call", segment_count: 1 }] }),
      "GET /api/live/conversations/conv-1": () => json({ conversation: CONV }),
      "POST /api/live/conversations": () => json({ conversation: CONV }),
      "DELETE /api/live/conversations/conv-1": () => json({ ok: true }),
    });
    expect(await listConversations({ fetch: f })).toEqual([{ id: "conv-1", title: "Renewal call", segment_count: 1 }]);
    expect(await loadConversation({ fetch: f }, "conv-1")).toEqual(CONV);
    expect(await saveConversation({ fetch: f }, { id: null, title: null, segments: CONV.segments, linked_docs: ["d1"], context_id: null })).toEqual(CONV);
    expect(await saveConversation({ fetch: f }, { id: "conv-1", title: "Renamed", segments: CONV.segments, linked_docs: [], context_id: "ctx-1" })).toEqual(CONV);
    expect(await saveConversation({ fetch: f }, { id: "conv-1", title: "Linked", segments: CONV.segments, linked_docs: [], source_session_ids: ["session-1"], claim_snapshots: [{ contract_version: 2, session_id: "session-1", epoch: 0, revision: 1, claims: [] }] })).toEqual(CONV);
    await expect(deleteConversation({ fetch: f }, "conv-1")).resolves.toBeUndefined();

    expect(calls.map((c) => `${c.init.method} ${c.url}`)).toEqual([
      "GET /api/live/conversations",
      "GET /api/live/conversations/conv-1",
      "POST /api/live/conversations",
      "POST /api/live/conversations",
      "POST /api/live/conversations",
      "DELETE /api/live/conversations/conv-1",
    ]);
    for (const c of calls) {
      expect(c.init.credentials).toBe("same-origin");
      expect(c.init.cache).toBe("no-store");
    }
    expect(JSON.parse(calls[2].init.body as string)).toEqual({ id: null, title: null, segments: CONV.segments, linked_docs: ["d1"] });
    expect(JSON.parse(calls[3].init.body as string)).toEqual({ id: "conv-1", title: "Renamed", segments: CONV.segments, linked_docs: [], context_id: "ctx-1" });
    expect(JSON.parse(calls[4].init.body as string)).toEqual({ id: "conv-1", title: "Linked", segments: CONV.segments, linked_docs: [], source_session_ids: ["session-1"], claim_snapshots: [{ contract_version: 2, session_id: "session-1", epoch: 0, revision: 1, claims: [] }] });
  });

  it("refusals become coded LiveSessionErrors with Conversation wording; bad bodies and network failures are coded too", async () => {
    const refuse = (status: number, body: unknown) => (async () => json(body, status)) as typeof fetch;
    await expect(listConversations({ fetch: refuse(401, { error: "signed_out" }) })).rejects.toMatchObject({ code: "signed_out", message: "Sign in to use Conversations." });
    await expect(listConversations({ fetch: refuse(503, { error: "unprovisioned" }) })).rejects.toMatchObject({ code: "unprovisioned", message: /Conversations are not provisioned/ });
    await expect(loadConversation({ fetch: refuse(404, { error: "not_found" }) }, "gone")).rejects.toMatchObject({ code: "not_found", message: "That Conversation no longer exists." });
    await expect(saveConversation({ fetch: refuse(422, { error: "too_large", reason: "Conversation record over 2097152 bytes" }) }, { id: null, title: null, segments: [], linked_docs: [] })).rejects.toMatchObject({
      code: "too_large",
      message: "Conversation record over 2097152 bytes",
    });
    await expect(listConversations({ fetch: refuse(502, "x") })).rejects.toMatchObject({ code: "http_502" });
    await expect(loadConversation({ fetch: (async () => json({})) as typeof fetch }, "x")).rejects.toMatchObject({ code: "bad_response" });
    expect(await listConversations({ fetch: (async () => json({})) as typeof fetch })).toEqual([]);
    const netFail = (async () => {
      throw new TypeError("Failed to fetch");
    }) as typeof fetch;
    const err = await saveConversation({ fetch: netFail }, { id: null, title: null, segments: [], linked_docs: [] }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LiveSessionError);
    expect((err as LiveSessionError).code).toBe("network");
  });
});

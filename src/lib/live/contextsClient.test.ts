import { describe, expect, it } from "vitest";

import type { ConversationContext } from "@/lib/ipc";
import { LiveSessionError } from "@/lib/live/liveClient";
import { deleteContext, listContexts, loadContext, saveContext } from "@/lib/live/contextsClient";

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });

const CTX: ConversationContext = {
  id: "ctx-1",
  title: "Acme interview",
  purpose: "Panel interview for the PM role",
  job_description: "Own the roadmap.",
  category: "interview",
  status: "ready",
  created_at_unix_ms: 1_700_000_000_000,
  updated_at_unix_ms: 1_700_000_100_000,
  source_doc_ids: [],
  auto_generate_context: false,
  knowledge_profile_id: null,
  personas: [],
  chosen_persona_id: null,
  conversation_id: null,
  dossier_doc_id: null,
};

/** Records every call and answers from a table keyed by `METHOD path`. */
function fake(table: Record<string, () => Response>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const f = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const key = `${init?.method ?? "GET"} ${String(url)}`;
    return table[key] ? table[key]() : json({ error: "not_found" }, 404);
  }) as typeof fetch;
  return { f, calls };
}

describe("contextsClient — /api/live/contexts (M2 cp7)", () => {
  it("list/load/save/delete hit the four routes with cookie credentials, no caching, and an encoded id", async () => {
    const { f, calls } = fake({
      "GET /api/live/contexts": () => json({ contexts: [{ id: "ctx-1", title: "Acme interview" }] }),
      "GET /api/live/contexts/ctx%2F1": () => json({ context: { ...CTX, id: "ctx/1" } }),
      "POST /api/live/contexts": () => json({ context: CTX }),
      "DELETE /api/live/contexts/ctx-1": () => json({ ok: true }),
    });
    expect(await listContexts({ fetch: f })).toEqual([{ id: "ctx-1", title: "Acme interview" }]);
    expect((await loadContext({ fetch: f }, "ctx/1")).id).toBe("ctx/1");
    expect(await saveContext({ fetch: f }, CTX)).toEqual(CTX);
    await expect(deleteContext({ fetch: f }, "ctx-1")).resolves.toBeUndefined();

    expect(calls.map((c) => `${c.init.method} ${c.url}`)).toEqual([
      "GET /api/live/contexts",
      "GET /api/live/contexts/ctx%2F1",
      "POST /api/live/contexts",
      "DELETE /api/live/contexts/ctx-1",
    ]);
    for (const c of calls) {
      expect(c.init.credentials).toBe("same-origin");
      expect(c.init.cache).toBe("no-store");
      expect((c.init.headers as Record<string, string>).Accept).toBe("application/json");
    }
    const post = calls[2];
    expect((post.init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    expect(JSON.parse(post.init.body as string)).toEqual(CTX);
  });

  it("an empty or foreign list body reads as no contexts", async () => {
    expect(await listContexts({ fetch: fake({ "GET /api/live/contexts": () => json({}) }).f })).toEqual([]);
    expect(await listContexts({ fetch: fake({ "GET /api/live/contexts": () => json({ contexts: "nope" }) }).f })).toEqual([]);
  });

  it("refusals become coded LiveSessionErrors with the Worker's reason or a human default", async () => {
    const refuse = (status: number, body: unknown) => (async () => json(body, status)) as typeof fetch;
    await expect(listContexts({ fetch: refuse(401, { error: "signed_out" }) })).rejects.toMatchObject({ code: "signed_out", message: "Sign in to use Contexts." });
    await expect(listContexts({ fetch: refuse(503, { error: "unprovisioned" }) })).rejects.toMatchObject({ code: "unprovisioned", message: /not provisioned/ });
    await expect(loadContext({ fetch: refuse(404, { error: "not_found" }) }, "gone")).rejects.toMatchObject({ code: "not_found", message: /no longer exists/ });
    await expect(saveContext({ fetch: refuse(413, { error: "too_large", reason: "Context payload exceeds 256 KiB." }) }, CTX)).rejects.toMatchObject({
      code: "too_large",
      message: "Context payload exceeds 256 KiB.",
    });
    // No error code in the body: the status alone decides.
    await expect(listContexts({ fetch: refuse(401, {}) })).rejects.toMatchObject({ code: "signed_out" });
    await expect(listContexts({ fetch: refuse(503, {}) })).rejects.toMatchObject({ code: "unconfigured" });
    await expect(listContexts({ fetch: refuse(502, "not even json") })).rejects.toMatchObject({ code: "http_502", message: /answered 502/ });
  });

  it("a network failure is `network`; a 200 without a record is `bad_response`", async () => {
    const netFail = (async () => {
      throw new TypeError("Failed to fetch");
    }) as typeof fetch;
    const err = await listContexts({ fetch: netFail }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LiveSessionError);
    expect((err as LiveSessionError).code).toBe("network");
    await expect(loadContext({ fetch: (async () => json({ ok: true })) as typeof fetch }, "x")).rejects.toMatchObject({ code: "bad_response" });
    await expect(saveContext({ fetch: (async () => json({})) as typeof fetch }, CTX)).rejects.toMatchObject({ code: "bad_response" });
  });

  it("honours a custom base path", async () => {
    const { f, calls } = fake({ "GET /gw/contexts": () => json({ contexts: [] }) });
    await listContexts({ fetch: f, base: "/gw" });
    expect(calls[0].url).toBe("/gw/contexts");
  });
});

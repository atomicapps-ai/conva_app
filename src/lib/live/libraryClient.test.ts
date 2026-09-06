import { describe, expect, it } from "vitest";

import type { RagDocument } from "@/lib/ipc";
import { LiveSessionError } from "@/lib/live/liveClient";
import { attachDocumentContext, deleteDocument, detachDocumentContext, documentText, ingestText, listDocuments, setDocumentEnabled } from "@/lib/live/libraryClient";

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
const DOC: RagDocument = { id: "doc_1", file_name: "pricing.md", enabled: true, chunk_count: 2, ingested_at_unix_ms: 1, source: "pasted", context_ids: ["ctx-1"], size_bytes: 120 };

function fake(table: Record<string, (init: RequestInit) => Response>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const f = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const key = `${init?.method ?? "GET"} ${String(url)}`;
    return table[key] ? table[key](init ?? {}) : json({ error: "not_found" }, 404);
  }) as typeof fetch;
  return { f, calls };
}

describe("libraryClient — /api/live/library (M2 cp9)", () => {
  it("list / ingest / enable / attach / detach / delete / text hit the routes with cookie credentials and the Worker's body shapes", async () => {
    const bodies: unknown[] = [];
    const record = (init: RequestInit) => {
      bodies.push(JSON.parse(init.body as string));
      return json({ document: DOC });
    };
    const { f, calls } = fake({
      "GET /api/live/library": () => json({ documents: [DOC] }),
      "POST /api/live/library": (init) => {
        bodies.push(JSON.parse(init.body as string));
        return json({ report: { document: DOC, warnings: ["w"] } });
      },
      "PATCH /api/live/library/doc_1": record,
      "DELETE /api/live/library/doc_1": () => json({ ok: true }),
      "GET /api/live/library/doc_1/text": () => json({ text: "# Pricing" }),
    });
    expect(await listDocuments({ fetch: f })).toEqual([DOC]);
    expect(await ingestText({ fetch: f }, "pricing.md", "# Pricing", ["ctx-1"])).toEqual({ document: DOC, warnings: ["w"] });
    expect(await ingestText({ fetch: f }, "n", "t")).toEqual({ document: DOC, warnings: ["w"] });
    expect(await setDocumentEnabled({ fetch: f }, "doc_1", false)).toEqual(DOC);
    expect(await attachDocumentContext({ fetch: f }, "doc_1", "ctx-2")).toEqual(DOC);
    expect(await detachDocumentContext({ fetch: f }, "doc_1", "ctx-1")).toEqual(DOC);
    await expect(deleteDocument({ fetch: f }, "doc_1")).resolves.toBeUndefined();
    expect(await documentText({ fetch: f }, "doc_1")).toBe("# Pricing");
    expect(await documentText({ fetch: f }, "gone")).toBeNull();

    expect(bodies).toEqual([
      { name: "pricing.md", text: "# Pricing", context_ids: ["ctx-1"] },
      { name: "n", text: "t" },
      { enabled: false },
      { attach_context: "ctx-2" },
      { detach_context: "ctx-1" },
    ]);
    for (const c of calls) {
      expect(c.init.credentials).toBe("same-origin");
      expect(c.init.cache).toBe("no-store");
    }
  });

  it("refusals are coded with Document wording; malformed 200s are bad_response; network is coded", async () => {
    const refuse = (status: number, body: unknown) => (async () => json(body, status)) as typeof fetch;
    await expect(listDocuments({ fetch: refuse(401, { error: "signed_out" }) })).rejects.toMatchObject({ code: "signed_out", message: "Sign in to use Documents." });
    await expect(listDocuments({ fetch: refuse(503, { error: "unprovisioned" }) })).rejects.toMatchObject({ code: "unprovisioned", message: /Documents are not provisioned/ });
    await expect(ingestText({ fetch: refuse(422, { error: "empty_text", reason: "the document has no text" }) }, "n", "  ")).rejects.toMatchObject({ code: "empty_text", message: "the document has no text" });
    await expect(setDocumentEnabled({ fetch: refuse(404, { error: "not_found" }) }, "x", true)).rejects.toMatchObject({ code: "not_found" });
    await expect(ingestText({ fetch: (async () => json({ report: {} })) as typeof fetch }, "n", "t")).rejects.toMatchObject({ code: "bad_response" });
    await expect(documentText({ fetch: refuse(503, { error: "unprovisioned" }) }, "x")).rejects.toMatchObject({ code: "unprovisioned" });
    const netFail = (async () => {
      throw new TypeError("Failed to fetch");
    }) as typeof fetch;
    const err = await listDocuments({ fetch: netFail }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LiveSessionError);
    expect((err as LiveSessionError).code).toBe("network");
  });
});

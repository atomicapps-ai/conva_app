import { describe, expect, it } from "vitest";

import type { RagDocument } from "@/lib/ipc";
import { LiveSessionError } from "@/lib/live/liveClient";
import { attachDocumentContext, deleteDocument, detachDocumentContext, documentText, downloadOriginal, fileNameFromDisposition, ingestText, listDocuments, setDocumentEnabled, uploadDocument } from "@/lib/live/libraryClient";

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

describe("libraryClient — file originals (M2 cp10)", () => {
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });

  it("uploadDocument sends the bytes as the body with the descriptor in headers (percent-encoded name, mime, Context ids) and returns the IngestReport", async () => {
    let captured: { url: string; init: RequestInit } | null = null;
    const f = (async (url: string | URL | Request, init?: RequestInit) => {
      captured = { url: String(url), init: init! };
      return json({ report: { document: DOC, warnings: ["PDF text extraction is not available on the web yet"] } });
    }) as typeof fetch;
    const file = new File([new Uint8Array([37, 80, 68, 70])], "Q3 Plan (final).pdf", { type: "application/pdf" });
    const report = await uploadDocument({ fetch: f }, file, ["ctx-1", "ctx-2"]);
    expect(report.document).toEqual(DOC);
    expect(report.warnings).toHaveLength(1);
    expect(captured!.url).toBe("/api/live/library/upload");
    expect(captured!.init.method).toBe("POST");
    expect(captured!.init.credentials).toBe("same-origin");
    const h = captured!.init.headers as Record<string, string>;
    expect(h["X-Conva-File-Name"]).toBe(encodeURIComponent("Q3 Plan (final).pdf"));
    expect(h["Content-Type"]).toBe("application/pdf");
    expect(h["X-Conva-Context-Ids"]).toBe("ctx-1,ctx-2");
    expect(captured!.init.body).toBe(file);

    const noType = new File(["# md"], "notes.md");
    await uploadDocument({ fetch: f }, noType);
    const h2 = captured!.init.headers as Record<string, string>;
    expect(h2["Content-Type"]).toBe("application/octet-stream");
    expect(h2["X-Conva-Context-Ids"]).toBeUndefined();

    const refuse = (status: number, body: unknown) => (async () => json(body, status)) as typeof fetch;
    await expect(uploadDocument({ fetch: refuse(503, { error: "unprovisioned" }) }, file)).rejects.toMatchObject({ code: "unprovisioned" });
    await expect(uploadDocument({ fetch: refuse(422, { error: "unsupported_type", reason: "unsupported file type '.png'" }) }, file)).rejects.toMatchObject({ code: "unsupported_type", message: /'.png'/ });
    await expect(uploadDocument({ fetch: refuse(413, { error: "too_large" }) }, file)).rejects.toMatchObject({ code: "too_large" });
  });

  it("downloadOriginal returns the blob and the server's file name; refusals are coded", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const f = (async () => new Response(bytes, { status: 200, headers: { "Content-Type": "application/octet-stream", "Content-Disposition": `attachment; filename="Q3 _Plan_.docx"; filename*=UTF-8''${encodeURIComponent("Q3 Plän.docx")}` } })) as typeof fetch;
    const { blob, fileName } = await downloadOriginal({ fetch: f }, "doc_1");
    const downloaded = await new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(blob);
    });
    expect(new Uint8Array(downloaded)).toEqual(bytes);
    expect(fileName).toBe("Q3 Plän.docx");
    expect(fileNameFromDisposition('attachment; filename="plain.txt"')).toBe("plain.txt");
    expect(fileNameFromDisposition("attachment; filename=bare.md")).toBe("bare.md");
    expect(fileNameFromDisposition("attachment")).toBeNull();
    expect(fileNameFromDisposition(null)).toBeNull();
    const refuse = (status: number, body: unknown) => (async () => json(body, status)) as typeof fetch;
    await expect(downloadOriginal({ fetch: refuse(404, { error: "no_original", reason: "This document was pasted; there is no file to download." }) }, "doc_p")).rejects.toMatchObject({ code: "no_original" });
    await expect(downloadOriginal({ fetch: refuse(401, {}) }, "x")).rejects.toMatchObject({ code: "signed_out" });
  });
});

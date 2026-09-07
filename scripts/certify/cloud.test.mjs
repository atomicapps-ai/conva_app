import { describe, expect, it } from "vitest";
import { REHEARSAL_ANSWER, REHEARSAL_DOC, REHEARSAL_FACT, UNTITLED, createCloudStub, deriveTitle, locationOf, normalizeSegments, tokensOf } from "./cloud.mjs";

const seg = (side, text, is_final = true, seq = 0) => ({ side, seq, text, is_final, start_ms: 0, end_ms: 400, confidence: 0.9, latency_ms: 300 });

describe("rehearsal cloud stub — pure helpers", () => {
  it("derives a title from the first spoken final, capped at 48 chars", () => {
    expect(deriveTitle([])).toBe(UNTITLED);
    expect(deriveTitle([seg("self", "  ", false), seg("self", "Morning — did the vendor send the quote?")])).toBe("Morning — did the vendor send the quote?");
    expect(deriveTitle([seg("self", "x".repeat(60))])).toBe(`${"x".repeat(48)}…`);
  });
  it("keeps finals only and refuses malformed segments", () => {
    expect(normalizeSegments([seg("self", "a"), seg("remote_mix", "b", false)]).value).toHaveLength(1);
    expect(normalizeSegments("nope").ok).toBe(false);
    expect(normalizeSegments([{ text: 1 }]).ok).toBe(false);
  });
  it("cites a heading breadcrumb, else a paragraph range; tokenizes an answer losslessly", () => {
    expect(locationOf(REHEARSAL_DOC.text)).toBe("Vendor brief");
    expect(locationOf("one\n\ntwo\n\nthree")).toBe("¶1–3");
    expect(locationOf("just one")).toBe("¶1");
    expect(tokensOf(REHEARSAL_ANSWER).join("")).toBe(REHEARSAL_ANSWER);
  });
});

describe("rehearsal cloud stub — routes", () => {
  it("seeds one ready Context with the brief attached, and lists both as the app expects", () => {
    const s = createCloudStub({ now: () => 1_000 });
    const docs = s.handle({ method: "GET", path: "/library" }).body.documents;
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({ file_name: REHEARSAL_DOC.name, enabled: true, source: "pasted" });
    expect(docs[0].chunk_count).toBeGreaterThan(0);
    const ctxs = s.handle({ method: "GET", path: "/contexts" }).body.contexts;
    expect(ctxs).toHaveLength(1);
    expect(ctxs[0]).toMatchObject({ title: "Vendor call", status: "ready", source_doc_count: 1, has_key_terms: true });
    expect(docs[0].context_ids).toEqual([ctxs[0].id]);
    const full = s.handle({ method: "GET", path: `/contexts/${ctxs[0].id}` });
    expect(full.status).toBe(200);
    expect(full.body.context.source_doc_ids).toEqual([docs[0].id]);
    expect(s.handle({ method: "GET", path: "/contexts/nope" }).status).toBe(404);
  });

  it("streams a cited answer as sources → chunks → done, once per request id", () => {
    const s = createCloudStub();
    const ctx = s.records.contexts()[0];
    const r = s.handle({ method: "POST", path: "/ally", body: { request_id: "r1", kind: "question", question: "lead time?", segments: [seg("self", "hi"), seg("remote_mix", "partial", false)], context_id: ctx.id } });
    expect(r.status).toBe(200);
    expect(r.lines[0]).toEqual({ type: "sources", request_id: "r1", sources: [{ file_name: REHEARSAL_DOC.name, location: "Vendor brief" }] });
    const chunks = r.lines.filter((l) => l.type === "chunk");
    expect(chunks.map((c) => c.token).join("")).toContain(REHEARSAL_FACT);
    expect(r.lines.at(-1)).toMatchObject({ type: "done", request_id: "r1", stop_reason: "end_turn" });
    expect(r.lines.every((l) => l.request_id === "r1")).toBe(true);
    expect(s.handle({ method: "POST", path: "/ally", body: { request_id: "r1", kind: "question", question: null, segments: [] } }).status).toBe(409);
    expect(s.handle({ method: "POST", path: "/ally", body: { kind: "question" } }).status).toBe(422);
    // content-free record: counts and flags, never the question or the answer
    expect(s.stats.ally[0]).toEqual({ kind: "question", question_chars: 10, segments: 2, finals: 1, context_id: true, context_known: true, sources: 1, tokens: chunks.length });
    expect(JSON.stringify(s.stats)).not.toContain("lead time?");
  });

  it("answers ungrounded when the library is empty", () => {
    const s = createCloudStub({ seed: false });
    const r = s.handle({ method: "POST", path: "/ally", body: { request_id: "x", kind: "summarize", question: null, segments: [] } });
    expect(r.lines[0].sources).toEqual([]);
    expect(r.lines.filter((l) => l.type === "chunk").map((c) => c.token).join("")).not.toContain(REHEARSAL_FACT);
  });

  it("saves a conversation with finals only, derives the title, lists newest first, purges on delete", () => {
    let t = 1_000;
    const s = createCloudStub({ now: () => t });
    const first = s.handle({ method: "POST", path: "/conversations", body: { id: null, title: null, segments: [seg("self", "Great, let's lock it in."), seg("remote_mix", "I'll send", false)], linked_docs: [] } });
    expect(first.status).toBe(201);
    expect(first.body.conversation).toMatchObject({ title: "Great, let's lock it in.", created_at_unix_ms: 1_000, linked_context_id: null });
    expect(first.body.conversation.segments).toHaveLength(1);
    t = 2_000;
    const second = s.handle({ method: "POST", path: "/conversations", body: { id: null, title: "Rehearsal", segments: [seg("self", "a")], linked_docs: ["doc_001"], context_id: "ctx_001" } });
    expect(second.body.conversation).toMatchObject({ title: "Rehearsal", linked_context_id: "ctx_001", linked_docs: ["doc_001"] });
    const list = s.handle({ method: "GET", path: "/conversations" }).body.conversations;
    expect(list.map((c) => c.title)).toEqual(["Rehearsal", "Great, let's lock it in."]);
    expect(list[1]).toMatchObject({ segment_count: 1, preview: "Great, let's lock it in." });
    expect(list[0]).not.toHaveProperty("segments");
    // re-save keeps created_at, replaces the transcript
    t = 3_000;
    const resave = s.handle({ method: "POST", path: "/conversations", body: { id: first.body.conversation.id, title: null, segments: [seg("self", "a"), seg("self", "b")], linked_docs: [] } });
    expect(resave.status).toBe(200);
    expect(resave.body.conversation).toMatchObject({ title: "Great, let's lock it in.", created_at_unix_ms: 1_000, updated_at_unix_ms: 3_000 });
    expect(resave.body.conversation.segments).toHaveLength(2);
    expect(s.handle({ method: "DELETE", path: `/conversations/${first.body.conversation.id}` }).status).toBe(200);
    expect(s.handle({ method: "GET", path: `/conversations/${first.body.conversation.id}` }).status).toBe(404);
    expect(s.snapshot().conversations).toBe(1);
    expect(s.handle({ method: "POST", path: "/conversations", body: { segments: "no" } }).status).toBe(422);
  });

  it("ingests pasted text, attaches / detaches Contexts both ways, and purges a document", () => {
    const s = createCloudStub();
    const ctx = s.records.contexts()[0];
    const r = s.handle({ method: "POST", path: "/library", body: { name: "notes.txt", text: "one\n\ntwo", context_ids: [ctx.id] } });
    expect(r.status).toBe(201);
    const doc = r.body.report.document;
    expect(doc).toMatchObject({ file_name: "notes.txt", chunk_count: 2, context_ids: [ctx.id], source: "pasted", size_bytes: 8 });
    expect(s.records.contexts()[0].source_doc_ids).toContain(doc.id);
    expect(s.handle({ method: "GET", path: `/library/${doc.id}/text` }).body.text).toBe("one\n\ntwo");
    expect(s.handle({ method: "PATCH", path: `/library/${doc.id}`, body: { detach_context: ctx.id } }).body.document.context_ids).toEqual([]);
    expect(s.records.contexts()[0].source_doc_ids).not.toContain(doc.id);
    expect(s.handle({ method: "PATCH", path: `/library/${doc.id}`, body: { enabled: false } }).body.document.enabled).toBe(false);
    expect(s.handle({ method: "POST", path: "/library", body: { name: "e.txt", text: "  " } }).status).toBe(422);
    expect(s.handle({ method: "DELETE", path: `/library/${doc.id}` }).status).toBe(200);
    expect(s.handle({ method: "GET", path: "/library" }).body.documents.map((d) => d.id)).not.toContain(doc.id);
    expect(s.handle({ method: "GET", path: `/library/${doc.id}/text` }).status).toBe(404);
    // an upload: the descriptor rides in headers, the bytes are the body
    const up = s.handle({ method: "POST", path: "/library/upload", body: Buffer.from("# Hello\n\nworld"), headers: { "x-conva-file-name": encodeURIComponent("hello.md") } });
    expect(up.status).toBe(201);
    expect(up.body.report.document).toMatchObject({ file_name: "hello.md", source: "file", chunk_count: 1, size_bytes: 14 });
    expect(s.handle({ method: "POST", path: "/library/upload", body: Buffer.alloc(0), headers: {} }).status).toBe(422);
  });

  it("saves, reads and deletes a Context; unknown routes are 404", () => {
    const s = createCloudStub({ seed: false });
    const r = s.handle({ method: "POST", path: "/contexts", body: { id: "", title: "Interview", category: "interview", status: "draft", source_doc_ids: [], personas: [] } });
    expect(r.status).toBe(201);
    expect(r.body.context.id).toMatch(/^ctx_/);
    const again = s.handle({ method: "POST", path: "/contexts", body: { ...r.body.context, title: "Interview 2" } });
    expect(again.status).toBe(200);
    expect(again.body.context.created_at_unix_ms).toBe(r.body.context.created_at_unix_ms);
    expect(s.handle({ method: "GET", path: "/contexts" }).body.contexts[0].title).toBe("Interview 2");
    expect(s.handle({ method: "DELETE", path: `/contexts/${r.body.context.id}` }).status).toBe(200);
    expect(s.snapshot().contexts).toBe(0);
    expect(s.handle({ method: "POST", path: "/contexts", body: { title: " " } }).status).toBe(422);
    expect(s.handle({ method: "GET", path: "/nothing" }).status).toBe(404);
    expect(s.stats.ops.every((o) => typeof o.op === "string" && typeof o.status === "number")).toBe(true);
  });
});

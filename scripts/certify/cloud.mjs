/* First-run rehearsal — an in-memory stub of the hosted cloud slice (M2 cp19).
 *
 * The certification gateway (`gateway.mjs`) answers the cloud routes with 503
 * so the certify row stays about capture. The rehearsal wants the rest of the
 * checklist (`conva_core/docs/technical/2026-09-beta-first-run-checklist.md`
 * steps 8, 11, 12) to run in the REAL web build too, so this module keeps
 * library documents, Contexts and conversations in memory and answers
 * `POST /api/live/ally` with a streamed, cited answer — the record shapes and
 * refusal codes mirror the Worker (`conva_web/src/live/{library,contexts,
 * conversations,ally}.js`) closely enough for the app's clients, never the
 * Worker's storage. Pure: no I/O, no clock of its own (inject `now`), so it
 * is unit-tested next to the frame codec. Everything it records about a run
 * is content-free (ids, kinds, counts). */

export const UNTITLED = "Untitled conversation";
const MAX_SEGMENTS = 2000;

/** The seeded material the rehearsal asks about — synthetic, no real vendor. */
export const REHEARSAL_DOC = {
  name: "vendor-brief.md",
  text: "# Vendor brief\n\nNorthwind's revised quote is fourteen thousand, down from forty.\n\nDelivery lead time is six weeks from purchase order, and the warranty runs twenty-four months.\n",
};
export const REHEARSAL_FACT = "six weeks from purchase order";
export const REHEARSAL_QUESTION = "What is the delivery lead time?";
export const REHEARSAL_CONTEXT = { title: "Vendor call", purpose: "Lock the revised quote and confirm the delivery terms.", key_terms: ["lead time", "warranty"] };
export const REHEARSAL_ANSWER = `Per the vendor brief, delivery lead time is ${REHEARSAL_FACT}, and the warranty runs twenty-four months.`;

/** Port of the Worker's deriveTitle (conversations.rs derive_title): first spoken words, else a marker. */
export function deriveTitle(segments) {
  const first = segments.find((s) => s.is_final && s.text.trim().length > 0);
  if (!first) return UNTITLED;
  const text = first.text.trim();
  const chars = Array.from(text);
  return chars.length > 48 ? `${chars.slice(0, 48).join("")}…` : text;
}

/** Finals only, slimmed — the Worker's normalizeSegments. */
export function normalizeSegments(raw) {
  if (raw == null) return { ok: true, value: [] };
  if (!Array.isArray(raw)) return { ok: false, error: "bad_segments", reason: "segments must be an array" };
  if (raw.length > MAX_SEGMENTS) return { ok: false, error: "bad_segments", reason: `at most ${MAX_SEGMENTS} segments` };
  const out = [];
  for (const s of raw) {
    if (!s || typeof s !== "object" || typeof s.text !== "string" || typeof s.side !== "string") return { ok: false, error: "bad_segments", reason: "each segment needs side and text" };
    if (s.is_final !== true) continue;
    out.push({
      side: s.side.slice(0, 32),
      seq: Number.isFinite(s.seq) ? s.seq : 0,
      text: s.text.slice(0, 4000),
      is_final: true,
      start_ms: Number.isFinite(s.start_ms) ? s.start_ms : 0,
      end_ms: Number.isFinite(s.end_ms) ? s.end_ms : 0,
      confidence: Number.isFinite(s.confidence) ? s.confidence : null,
      latency_ms: Number.isFinite(s.latency_ms) ? s.latency_ms : 0,
    });
  }
  return { ok: true, value: out };
}

/** Where a citation points: the first markdown heading as a breadcrumb, else the paragraph range. */
export function locationOf(text) {
  const heading = /^#+\s+(.+)$/m.exec(text);
  if (heading) return heading[1].trim();
  const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim()).length;
  return paragraphs > 1 ? `¶1–${paragraphs}` : "¶1";
}

/** Split an answer into streamable tokens (word + following space), like a model's deltas. */
export function tokensOf(answer) {
  return answer.match(/\S+\s*/g) ?? [];
}

const ok = (body, status = 200) => ({ status, body });
const refuse = (status, error, reason) => ({ status, body: reason ? { error, reason } : { error } });

/**
 * Create one stub. `seed` (default true) plants {@link REHEARSAL_DOC} and
 * {@link REHEARSAL_CONTEXT} (ready, the document attached) so an ask has
 * something to cite. `handle` takes a request already parsed by the gateway
 * and answers `{ status, body }` — or, for `/ally`, `{ status, lines }` with
 * the NDJSON lines in order (`sources`, `chunk`s, `done`).
 */
export function createCloudStub({ now = () => Date.now(), seed = true } = {}) {
  const documents = new Map(); // id → { record, text, deleted }
  const contexts = new Map(); // id → record
  const conversations = new Map(); // id → record
  const answered = new Set(); // request ids (idempotency)
  const stats = { ops: [], ally: [] };
  let counter = 0;
  const mint = (prefix) => `${prefix}_${String(++counter).padStart(3, "0")}`;
  const op = (name, status, extra = {}) => stats.ops.push({ op: name, status, ...extra });

  const docRecord = (d) => ({ ...d.record });
  const liveDocs = () => [...documents.values()].filter((d) => !d.deleted);
  const contextSummary = (c) => ({
    id: c.id,
    title: c.title,
    category: c.category,
    status: c.status,
    created_at_unix_ms: c.created_at_unix_ms,
    updated_at_unix_ms: c.updated_at_unix_ms,
    source_doc_count: c.source_doc_ids.length,
    has_key_terms: Array.isArray(c.key_terms) && c.key_terms.length > 0,
    research_enabled: c.research_enabled === true,
    has_job_description: typeof c.job_description === "string" && c.job_description.trim().length > 0,
    has_generated_resources: typeof c.dossier_doc_id === "string",
    resources_stale: c.resources_stale === true,
    resources_generated_at_unix_ms: c.resources_generated_at_unix_ms ?? null,
  });
  const conversationSummary = (c) => ({
    id: c.id,
    title: c.title,
    created_at_unix_ms: c.created_at_unix_ms,
    updated_at_unix_ms: c.updated_at_unix_ms,
    segment_count: c.segments.length,
    linked_docs: c.linked_docs,
    linked_context_id: c.linked_context_id,
    preview: (c.segments.find((s) => s.text.trim())?.text ?? "").trim().slice(0, 120),
  });

  function ingest(name, text, contextIds, source, extra = {}) {
    const id = mint("doc");
    const t = now();
    const record = { id, file_name: name, enabled: true, chunk_count: Math.max(1, text.split(/\n\s*\n/).filter((p) => p.trim()).length), ingested_at_unix_ms: t, source, context_ids: [...contextIds], size_bytes: Buffer.byteLength(text, "utf8"), ...extra };
    documents.set(id, { record, text, deleted: false });
    for (const cid of contextIds) {
      const c = contexts.get(cid);
      if (c && !c.source_doc_ids.includes(id)) {
        c.source_doc_ids.push(id);
        c.updated_at_unix_ms = t;
      }
    }
    return record;
  }

  function saveContext(body) {
    if (!body || typeof body !== "object" || typeof body.title !== "string" || !body.title.trim()) return refuse(422, "bad_title", "title is required");
    const t = now();
    const id = typeof body.id === "string" && body.id.trim() ? body.id : mint("ctx");
    const existing = contexts.get(id);
    const record = {
      ...body,
      id,
      title: body.title,
      category: typeof body.category === "string" ? body.category : "other",
      status: typeof body.status === "string" ? body.status : "draft",
      source_doc_ids: Array.isArray(body.source_doc_ids) ? body.source_doc_ids.filter((d) => typeof d === "string") : [],
      created_at_unix_ms: existing ? existing.created_at_unix_ms : t,
      updated_at_unix_ms: t,
    };
    contexts.set(id, record);
    return ok({ context: record }, existing ? 200 : 201);
  }

  if (seed) {
    const t = now();
    const ctxId = mint("ctx");
    contexts.set(ctxId, {
      id: ctxId,
      title: REHEARSAL_CONTEXT.title,
      purpose: REHEARSAL_CONTEXT.purpose,
      job_description: null,
      category: "sales",
      status: "ready",
      created_at_unix_ms: t,
      updated_at_unix_ms: t,
      source_doc_ids: [],
      auto_generate_context: false,
      key_terms: [...REHEARSAL_CONTEXT.key_terms],
      knowledge_profile_id: null,
      personas: [],
      chosen_persona_id: null,
      conversation_id: null,
      dossier_doc_id: null,
    });
    ingest(REHEARSAL_DOC.name, REHEARSAL_DOC.text, [ctxId], "pasted");
  }

  /** The cited chunks for an ask: the Context's documents when it names any, else the whole enabled library. */
  function retrieve(contextId) {
    const ctx = contextId ? contexts.get(contextId) : null;
    const scope = ctx && ctx.source_doc_ids.length ? new Set(ctx.source_doc_ids) : null;
    return liveDocs()
      .filter((d) => d.record.enabled && (!scope || scope.has(d.record.id)))
      .map((d) => ({ file_name: d.record.file_name, location: locationOf(d.text) }));
  }

  function ally(body) {
    if (!body || typeof body !== "object" || typeof body.request_id !== "string" || !body.request_id) return refuse(422, "bad_request_id", "request_id is required");
    if (typeof body.kind !== "string") return refuse(422, "bad_kind", "kind is required");
    if (answered.has(body.request_id)) return refuse(409, "duplicate_request", "This request id was already answered.");
    answered.add(body.request_id);
    const segments = Array.isArray(body.segments) ? body.segments : [];
    const contextId = typeof body.context_id === "string" ? body.context_id : null;
    const sources = retrieve(contextId);
    const question = typeof body.question === "string" ? body.question : null;
    const answer = sources.length ? REHEARSAL_ANSWER : "No documents to cite on this deployment.";
    const tokens = tokensOf(answer);
    stats.ally.push({ kind: body.kind, question_chars: question ? question.length : 0, segments: segments.length, finals: segments.filter((s) => s && s.is_final === true).length, context_id: contextId !== null, context_known: contextId !== null && contexts.has(contextId), sources: sources.length, tokens: tokens.length });
    const rid = body.request_id;
    const lines = [{ type: "sources", request_id: rid, sources }, ...tokens.map((token) => ({ type: "chunk", request_id: rid, token })), { type: "done", request_id: rid, stop_reason: "end_turn", usage: { input_tokens: 200 + segments.length * 20, output_tokens: tokens.length } }];
    return { status: 200, lines };
  }

  function handle({ method, path, body = null, headers = {} }) {
    const [, noun, id, sub] = /^\/([a-z]+)(?:\/([^/]+))?(?:\/([a-z]+))?\/?$/.exec(path) ?? [];
    if (noun === "ally") {
      if (method !== "POST" || id) return refuse(404, "not_found");
      const r = ally(body);
      op("ally", r.status);
      return r;
    }
    const finish = (r) => {
      op(`${noun}.${method.toLowerCase()}${sub ? `.${sub}` : ""}`, r.status);
      return r;
    };
    if (noun === "library") {
      if (!id && method === "GET") return finish(ok({ documents: liveDocs().map(docRecord) }));
      if (!id && method === "POST") {
        if (!body || typeof body !== "object") return finish(refuse(400, "invalid_json"));
        if (typeof body.text !== "string" || !body.text.trim()) return finish(refuse(422, "empty_text", "text is empty"));
        const name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : "pasted.txt";
        const record = ingest(name, body.text, Array.isArray(body.context_ids) ? body.context_ids.filter((c) => typeof c === "string") : [], "pasted");
        return finish(ok({ report: { document: record, warnings: [] } }, 201));
      }
      if (id === "upload" && method === "POST") {
        const name = decodeURIComponent(headers["x-conva-file-name"] ?? "upload.bin");
        const bytes = body && typeof body === "object" && typeof body.length === "number" ? body : Buffer.alloc(0);
        if (bytes.length === 0) return finish(refuse(422, "empty_file", "the file is empty"));
        const ext = (name.split(".").pop() ?? "").toLowerCase();
        const text = ["txt", "md", "html"].includes(ext) ? bytes.toString("utf8") : "";
        const ctxIds = String(headers["x-conva-context-ids"] ?? "").split(",").filter(Boolean);
        const record = ingest(name, text, ctxIds, "file", { size_bytes: bytes.length, chunk_count: text ? 1 : 0 });
        return finish(ok({ report: { document: record, warnings: text ? [] : ["Text was not extracted from this file by the rehearsal stub."] } }, 201));
      }
      const d = id ? documents.get(id) : null;
      if (!d || d.deleted) return finish(refuse(404, "not_found", "That document no longer exists."));
      if (method === "GET" && sub === "text") return finish(ok({ text: d.text }));
      if (method === "GET" && sub === "original") return finish(ok({ text: d.text }));
      if (method === "PATCH" && !sub) {
        if (!body || typeof body !== "object") return finish(refuse(400, "invalid_json"));
        if (typeof body.enabled === "boolean") d.record.enabled = body.enabled;
        if (typeof body.attach_context === "string" && !d.record.context_ids.includes(body.attach_context)) {
          d.record.context_ids.push(body.attach_context);
          const c = contexts.get(body.attach_context);
          if (c && !c.source_doc_ids.includes(d.record.id)) c.source_doc_ids.push(d.record.id);
        }
        if (typeof body.detach_context === "string") {
          d.record.context_ids = d.record.context_ids.filter((c) => c !== body.detach_context);
          const c = contexts.get(body.detach_context);
          if (c) c.source_doc_ids = c.source_doc_ids.filter((x) => x !== d.record.id);
        }
        return finish(ok({ document: docRecord(d) }));
      }
      if (method === "DELETE" && !sub) {
        d.deleted = true;
        d.text = "";
        d.record = { ...d.record, enabled: false, chunk_count: 0, context_ids: [] };
        for (const c of contexts.values()) c.source_doc_ids = c.source_doc_ids.filter((x) => x !== id);
        return finish(ok({ ok: true }));
      }
      return finish(refuse(404, "not_found"));
    }
    if (noun === "contexts") {
      if (!id && method === "GET") return finish(ok({ contexts: [...contexts.values()].sort((a, b) => b.updated_at_unix_ms - a.updated_at_unix_ms).map(contextSummary) }));
      if (!id && method === "POST") return finish(saveContext(body));
      const c = id ? contexts.get(id) : null;
      if (!c) return finish(refuse(404, "not_found", "That Context no longer exists."));
      if (method === "GET" && !sub) return finish(ok({ context: { ...c } }));
      if (method === "DELETE" && !sub) {
        contexts.delete(id);
        return finish(ok({ ok: true }));
      }
      return finish(refuse(404, "not_found"));
    }
    if (noun === "conversations") {
      if (!id && method === "GET") return finish(ok({ conversations: [...conversations.values()].sort((a, b) => b.updated_at_unix_ms - a.updated_at_unix_ms).map(conversationSummary) }));
      if (!id && method === "POST") {
        if (!body || typeof body !== "object") return finish(refuse(400, "invalid_json"));
        if (body.title != null && typeof body.title !== "string") return finish(refuse(422, "bad_title", "title must be a string or null"));
        const seg = normalizeSegments(body.segments);
        if (!seg.ok) return finish(refuse(422, seg.error, seg.reason));
        const t = now();
        const cid = typeof body.id === "string" && body.id.trim() ? body.id : mint("conv");
        const existing = conversations.get(cid) ?? null;
        const requested = typeof body.title === "string" && body.title.trim() ? body.title.trim() : null;
        const record = {
          id: cid,
          title: requested ?? existing?.title ?? deriveTitle(seg.value),
          created_at_unix_ms: existing ? existing.created_at_unix_ms : t,
          updated_at_unix_ms: t,
          segments: seg.value,
          linked_docs: Array.isArray(body.linked_docs) ? body.linked_docs.filter((d) => typeof d === "string").slice(0, 500) : [],
          linked_context_id: typeof body.context_id === "string" ? body.context_id : (existing?.linked_context_id ?? null),
        };
        conversations.set(cid, record);
        return finish(ok({ conversation: record }, existing ? 200 : 201));
      }
      const c = id ? conversations.get(id) : null;
      if (!c) return finish(refuse(404, "not_found", "That conversation no longer exists."));
      if (method === "GET" && !sub) return finish(ok({ conversation: { ...c } }));
      if (method === "DELETE" && !sub) {
        conversations.delete(id);
        return finish(ok({ ok: true }));
      }
      return finish(refuse(404, "not_found"));
    }
    return refuse(404, "not_found");
  }

  return {
    handle,
    stats,
    /** Content-free snapshot for the row. */
    snapshot: () => ({ documents: liveDocs().length, contexts: contexts.size, conversations: conversations.size, ally_requests: stats.ally.length, ops: stats.ops.length }),
    /** Test / driver access to the records (never logged). */
    records: { documents: () => liveDocs().map(docRecord), contexts: () => [...contexts.values()], conversations: () => [...conversations.values()] },
  };
}

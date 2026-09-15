import { afterEach, describe, expect, it, vi } from "vitest";

import type { ArchiveImportOptions, ConversationContext, RagDocument } from "@/lib/ipc";
import { importContextArchive } from "@/lib/live/archiveImport";
import * as archiveWasm from "@/lib/live/archiveWasm";
import type { ContextImportMaterials, PortableContextV1 } from "@/lib/live/archiveWasm";
import * as contextsClient from "@/lib/live/contextsClient";
import * as libraryClient from "@/lib/live/libraryClient";

vi.mock("@/lib/live/archiveWasm", () => ({
  loadContextArchiveForImport: vi.fn(),
  getArchiveEntryBytes: vi.fn(),
  importContextWithIds: vi.fn(),
}));
vi.mock("@/lib/live/contextsClient", () => ({ saveContext: vi.fn() }));
vi.mock("@/lib/live/libraryClient", () => ({ ingestText: vi.fn(), uploadDocument: vi.fn() }));

function portableContext(over: Partial<PortableContextV1> = {}): PortableContextV1 {
  return {
    id: "ctx-old",
    title: "Acme Interview",
    purpose: "Prep",
    job_description: null,
    category: "interview",
    participation_lens: null,
    source_policy: null,
    created_at_unix_ms: 1,
    updated_at_unix_ms: 2,
    source_doc_ids: [],
    slot_doc_ids: {},
    auto_generate_context: false,
    research_enabled: false,
    deep_qa_enabled: false,
    key_terms: [],
    glossary: [],
    glossary_definitions: {},
    knowledge_profile: null,
    personas: [],
    chosen_persona_id: null,
    conversation_id: null,
    dossier_doc_id: null,
    research_doc_id: null,
    qa_doc_id: null,
    resources_stale: false,
    resources_generated_at_unix_ms: null,
    suggestion_decisions: {},
    ...over,
  };
}

function materials(over: Partial<ContextImportMaterials> = {}): ContextImportMaterials {
  return {
    archive_digest: "digest-1",
    context: portableContext(),
    documents: [],
    artifacts: [],
    has_conversation: false,
    ...over,
  };
}

function conversationContext(over: Partial<ConversationContext> = {}): ConversationContext {
  return {
    id: "",
    title: "Acme Interview",
    purpose: "Prep",
    job_description: null,
    category: "interview",
    status: "draft",
    created_at_unix_ms: 1,
    updated_at_unix_ms: 2,
    source_doc_ids: [],
    auto_generate_context: false,
    knowledge_profile_id: null,
    personas: [],
    chosen_persona_id: null,
    conversation_id: null,
    dossier_doc_id: null,
    ...over,
  };
}

function ragDoc(over: Partial<RagDocument>): RagDocument {
  return {
    id: "doc-x",
    file_name: "x.txt",
    enabled: true,
    chunk_count: 1,
    ingested_at_unix_ms: 1,
    source: "file",
    context_ids: [],
    size_bytes: 10,
    ...over,
  };
}

const OPTIONS: ArchiveImportOptions = { include_document_ids: [], reuse_exact_document_ids: [] };

describe("importContextArchive (Checkpoint E, import slice)", () => {
  afterEach(() => {
    vi.mocked(archiveWasm.loadContextArchiveForImport).mockReset();
    vi.mocked(archiveWasm.getArchiveEntryBytes).mockReset();
    vi.mocked(archiveWasm.importContextWithIds).mockReset();
    vi.mocked(contextsClient.saveContext).mockReset();
    vi.mocked(libraryClient.ingestText).mockReset();
    vi.mocked(libraryClient.uploadDocument).mockReset();
  });

  it("refuses an archive that also declares a conversation — Context scope only", async () => {
    vi.mocked(archiveWasm.loadContextArchiveForImport).mockResolvedValue(materials({ has_conversation: true }));
    await expect(importContextArchive({ fetch }, new Uint8Array(), OPTIONS)).rejects.toThrow(/conversation/i);
    expect(contextsClient.saveContext).not.toHaveBeenCalled();
  });

  it("refuses a Context with a research profile — web has no way to persist one", async () => {
    vi.mocked(archiveWasm.loadContextArchiveForImport).mockResolvedValue(
      materials({
        context: portableContext({
          knowledge_profile: { id: "kp-1", title: "P", created_at_unix_ms: 1, updated_at_unix_ms: 1, doc_ids: [], research: [], ready: true },
        }),
      }),
    );
    await expect(importContextArchive({ fetch }, new Uint8Array(), OPTIONS)).rejects.toThrow(/research profile/i);
    expect(contextsClient.saveContext).not.toHaveBeenCalled();
  });

  it("stages a file document and a generated artifact, mints the id via an empty-id create then updates with full references", async () => {
    vi.mocked(archiveWasm.loadContextArchiveForImport).mockResolvedValue(
      materials({
        context: portableContext({ source_doc_ids: ["doc-file"], dossier_doc_id: "doc-dossier" }),
        documents: [
          { id: "doc-file", file_name: "resume.pdf", source: "file", enabled: true, searchable: true, ingested_at_unix_ms: 1, archive_path: "documents/files/doc-file", bytes: 4, sha256: "a".repeat(64) },
          { id: "doc-dossier", file_name: "dossier.md", source: "generated", enabled: true, searchable: false, ingested_at_unix_ms: 2, archive_path: null, bytes: null, sha256: null },
        ],
        artifacts: [{ document_id: "doc-dossier", kind: "dossier", created_at_unix_ms: 2, text: "# Dossier" }],
      }),
    );
    vi.mocked(archiveWasm.importContextWithIds).mockImplementation(async (_portable, contextId, documentIds) =>
      conversationContext({ id: contextId, source_doc_ids: Object.values(documentIds) }),
    );
    vi.mocked(contextsClient.saveContext).mockImplementation(async (_deps, ctx) =>
      conversationContext({ ...ctx, id: ctx.id || "ctx-real" }),
    );
    vi.mocked(archiveWasm.getArchiveEntryBytes).mockResolvedValue(new Uint8Array([1, 2, 3, 4]));
    vi.mocked(libraryClient.uploadDocument).mockResolvedValue({ document: ragDoc({ id: "doc-file-new", file_name: "resume.pdf" }), warnings: [] });
    vi.mocked(libraryClient.ingestText).mockResolvedValue({ document: ragDoc({ id: "doc-dossier-new", file_name: "dossier.md", source: "pasted" }), warnings: [] });

    const result = await importContextArchive({ fetch }, new Uint8Array(), OPTIONS);

    expect(result.context_id).toBe("ctx-real");
    expect(result.omitted_documents).toEqual([]);
    expect(result.imported_document_ids.sort()).toEqual(["doc-dossier-new", "doc-file-new"]);

    // Step 1: empty-id create with no document references yet.
    expect(contextsClient.saveContext).toHaveBeenNthCalledWith(1, expect.anything(), expect.objectContaining({ id: "" }));
    // Documents attach directly to the REAL minted id, not the placeholder.
    expect(libraryClient.uploadDocument).toHaveBeenCalledWith(expect.anything(), expect.any(File), ["ctx-real"]);
    expect(libraryClient.ingestText).toHaveBeenCalledWith(expect.anything(), "dossier.md", "# Dossier", ["ctx-real"]);
    // Step 3: update call carries the real (non-empty) id.
    expect(contextsClient.saveContext).toHaveBeenNthCalledWith(2, expect.anything(), expect.objectContaining({ id: "ctx-real" }));
    // The final importContextWithIds call maps both portable ids to their new ids.
    const finalCall = vi.mocked(archiveWasm.importContextWithIds).mock.calls[1];
    expect(finalCall[1]).toBe("ctx-real");
    expect(finalCall[2]).toEqual({ "doc-file": "doc-file-new", "doc-dossier": "doc-dossier-new" });
  });

  it("omits a metadata-only document (no archive_path) with a clear reason and still imports the rest", async () => {
    vi.mocked(archiveWasm.loadContextArchiveForImport).mockResolvedValue(
      materials({
        documents: [
          { id: "doc-meta", file_name: "meta.txt", source: "file", enabled: true, searchable: true, ingested_at_unix_ms: 1, archive_path: null, bytes: null, sha256: null },
        ],
      }),
    );
    vi.mocked(archiveWasm.importContextWithIds).mockResolvedValue(conversationContext({ id: "ctx-real" }));
    vi.mocked(contextsClient.saveContext).mockImplementation(async (_deps, ctx) =>
      conversationContext({ ...ctx, id: ctx.id || "ctx-real" }),
    );

    const result = await importContextArchive({ fetch }, new Uint8Array(), OPTIONS);
    expect(result.omitted_documents).toEqual([
      { portable_id: "doc-meta", reason: "source document was not included in this archive" },
    ]);
    expect(libraryClient.uploadDocument).not.toHaveBeenCalled();
  });

  it("omits a document excluded by an explicit include_document_ids selection", async () => {
    vi.mocked(archiveWasm.loadContextArchiveForImport).mockResolvedValue(
      materials({
        documents: [
          { id: "doc-a", file_name: "a.txt", source: "file", enabled: true, searchable: true, ingested_at_unix_ms: 1, archive_path: "documents/files/doc-a", bytes: 1, sha256: "a".repeat(64) },
          { id: "doc-b", file_name: "b.txt", source: "file", enabled: true, searchable: true, ingested_at_unix_ms: 1, archive_path: "documents/files/doc-b", bytes: 1, sha256: "b".repeat(64) },
        ],
      }),
    );
    vi.mocked(archiveWasm.importContextWithIds).mockResolvedValue(conversationContext({ id: "ctx-real" }));
    vi.mocked(contextsClient.saveContext).mockImplementation(async (_deps, ctx) =>
      conversationContext({ ...ctx, id: ctx.id || "ctx-real" }),
    );
    vi.mocked(archiveWasm.getArchiveEntryBytes).mockResolvedValue(new Uint8Array([1]));
    vi.mocked(libraryClient.uploadDocument).mockResolvedValue({ document: ragDoc({ id: "doc-a-new" }), warnings: [] });

    const result = await importContextArchive(
      { fetch },
      new Uint8Array(),
      { include_document_ids: ["doc-a"], reuse_exact_document_ids: [] },
    );
    expect(libraryClient.uploadDocument).toHaveBeenCalledTimes(1);
    expect(result.omitted_documents).toEqual([
      { portable_id: "doc-b", reason: "excluded by the import selection" },
    ]);
  });

  it("omits a document whose upload fails, with the failure's message as the reason, and does not abort the rest", async () => {
    vi.mocked(archiveWasm.loadContextArchiveForImport).mockResolvedValue(
      materials({
        documents: [
          { id: "doc-bad", file_name: "bad.pdf", source: "file", enabled: true, searchable: true, ingested_at_unix_ms: 1, archive_path: "documents/files/doc-bad", bytes: 1, sha256: "a".repeat(64) },
        ],
      }),
    );
    vi.mocked(archiveWasm.importContextWithIds).mockResolvedValue(conversationContext({ id: "ctx-real" }));
    vi.mocked(contextsClient.saveContext).mockImplementation(async (_deps, ctx) =>
      conversationContext({ ...ctx, id: ctx.id || "ctx-real" }),
    );
    vi.mocked(archiveWasm.getArchiveEntryBytes).mockResolvedValue(new Uint8Array([1]));
    vi.mocked(libraryClient.uploadDocument).mockRejectedValue(new Error("too_large"));

    const result = await importContextArchive({ fetch }, new Uint8Array(), OPTIONS);
    expect(result.omitted_documents).toEqual([{ portable_id: "doc-bad", reason: "too_large" }]);
  });

  it("applies an explicit context_title override before building the destination Context", async () => {
    vi.mocked(archiveWasm.loadContextArchiveForImport).mockResolvedValue(materials());
    vi.mocked(archiveWasm.importContextWithIds).mockResolvedValue(conversationContext({ id: "ctx-real" }));
    vi.mocked(contextsClient.saveContext).mockImplementation(async (_deps, ctx) =>
      conversationContext({ ...ctx, id: ctx.id || "ctx-real" }),
    );

    await importContextArchive(
      { fetch },
      new Uint8Array(),
      { context_title: "  Renamed  ", include_document_ids: [], reuse_exact_document_ids: [] },
    );
    const firstCall = vi.mocked(archiveWasm.importContextWithIds).mock.calls[0];
    expect((firstCall[0] as PortableContextV1).title).toBe("Renamed");
  });
});

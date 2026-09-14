import { afterEach, describe, expect, it, vi } from "vitest";

import type { ConversationContext, RagDocument } from "@/lib/ipc";
import { buildContextArchiveForDownload } from "@/lib/live/archiveExport";
import * as archiveWasm from "@/lib/live/archiveWasm";
import * as contextsClient from "@/lib/live/contextsClient";
import * as libraryClient from "@/lib/live/libraryClient";

vi.mock("@/lib/live/contextsClient", () => ({ loadContext: vi.fn() }));
vi.mock("@/lib/live/libraryClient", () => ({
  listDocuments: vi.fn(),
  documentText: vi.fn(),
  downloadOriginal: vi.fn(),
}));
vi.mock("@/lib/live/archiveWasm", () => ({ exportContextArchive: vi.fn() }));

const BASE_CONTEXT: ConversationContext = {
  id: "ctx-1",
  title: "Acme / Interview #3",
  purpose: "",
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

function doc(over: Partial<RagDocument>): RagDocument {
  return {
    id: "doc-1",
    file_name: "resume.pdf",
    enabled: true,
    chunk_count: 1,
    ingested_at_unix_ms: 10,
    source: "file",
    context_ids: [],
    size_bytes: 100,
    ...over,
  };
}

describe("buildContextArchiveForDownload (Checkpoint E, export)", () => {
  afterEach(() => {
    vi.mocked(contextsClient.loadContext).mockReset();
    vi.mocked(libraryClient.listDocuments).mockReset();
    vi.mocked(libraryClient.documentText).mockReset();
    vi.mocked(libraryClient.downloadOriginal).mockReset();
    vi.mocked(archiveWasm.exportContextArchive).mockReset();
  });

  it("refuses a Context with a knowledge_profile_id — web has no way to fetch the profile", async () => {
    vi.mocked(contextsClient.loadContext).mockResolvedValue({ ...BASE_CONTEXT, knowledge_profile_id: "kp-1" });
    await expect(buildContextArchiveForDownload({ fetch }, "ctx-1", true)).rejects.toThrow(/research profile/);
    expect(libraryClient.listDocuments).not.toHaveBeenCalled();
  });

  it("throws when a referenced document has vanished from the library", async () => {
    vi.mocked(contextsClient.loadContext).mockResolvedValue({ ...BASE_CONTEXT, source_doc_ids: ["doc-1"] });
    vi.mocked(libraryClient.listDocuments).mockResolvedValue([]);
    await expect(buildContextArchiveForDownload({ fetch }, "ctx-1", true)).rejects.toThrow(/doc-1.*no longer exists/);
  });

  it("collects source_doc_ids + slot_doc_ids + generated artifact ids, fetches bytes only when included, and sanitizes the file name", async () => {
    const context: ConversationContext = {
      ...BASE_CONTEXT,
      title: 'Acme / "Interview" #3?',
      source_doc_ids: ["doc-file"],
      slot_doc_ids: { resume: ["doc-slot"] },
      dossier_doc_id: "doc-dossier",
      research_doc_id: "doc-research",
      qa_doc_id: "doc-qa",
    };
    vi.mocked(contextsClient.loadContext).mockResolvedValue(context);
    const docs: RagDocument[] = [
      doc({ id: "doc-file", file_name: "resume.pdf", source: "file" }),
      doc({ id: "doc-slot", file_name: "notes.txt", source: "pasted" }),
      doc({ id: "doc-dossier", file_name: "dossier.md", source: "generated" }),
      doc({ id: "doc-research", file_name: "research.md", source: "generated" }),
      doc({ id: "doc-qa", file_name: "qa.md", source: "generated" }),
    ];
    vi.mocked(libraryClient.listDocuments).mockResolvedValue(docs);
    vi.mocked(libraryClient.documentText).mockImplementation(async (_deps, id) => `text for ${id}`);
    // jsdom's `Blob` has no `.arrayBuffer()` (unlike a real browser) — stand
    // in a minimal Blob-shaped object with it for this test only.
    const blob = {
      type: "application/pdf",
      arrayBuffer: async () => new TextEncoder().encode("file-bytes").buffer,
    } as Blob;
    vi.mocked(libraryClient.downloadOriginal).mockResolvedValue({ blob, fileName: "resume.pdf" });
    const expectedBytes = new Uint8Array([9, 9, 9]);
    vi.mocked(archiveWasm.exportContextArchive).mockResolvedValue(expectedBytes);

    const result = await buildContextArchiveForDownload({ fetch }, "ctx-1", true);

    expect(result.bytes).toBe(expectedBytes);
    // Title sanitized to a path-safe file name, quotes/`?`/`/` stripped.
    expect(result.fileName).toBe("Acme  Interview 3.cva");

    // Every non-generated doc (file AND pasted) fetches real bytes when
    // includeSourceDocuments is true — "doc-file" and "doc-slot" both.
    expect(libraryClient.downloadOriginal).toHaveBeenCalledTimes(2);
    expect(libraryClient.downloadOriginal).toHaveBeenCalledWith(expect.anything(), "doc-file");
    expect(libraryClient.downloadOriginal).toHaveBeenCalledWith(expect.anything(), "doc-slot");
    // The three generated docs each get their markdown text for the archive.
    expect(libraryClient.documentText).toHaveBeenCalledTimes(3);

    const call = vi.mocked(archiveWasm.exportContextArchive).mock.calls[0][0];
    expect(call.context).toBe(context);
    expect(call.profile).toBeNull();
    const byId = new Map(call.documents.map((d) => [d.id, d]));
    expect(byId.get("doc-file")?.bytes).toBeInstanceOf(Uint8Array);
    expect(byId.get("doc-dossier")?.bytes ?? null).toBeNull();
    const artifactKinds = new Map(call.artifacts.map((a) => [a.document_id, a.kind]));
    expect(artifactKinds.get("doc-dossier")).toBe("dossier");
    expect(artifactKinds.get("doc-research")).toBe("research");
    expect(artifactKinds.get("doc-qa")).toBe("prepared_qa");
  });

  it("omits source-document bytes and downloads nothing when includeSourceDocuments is false", async () => {
    vi.mocked(contextsClient.loadContext).mockResolvedValue({ ...BASE_CONTEXT, source_doc_ids: ["doc-file"] });
    vi.mocked(libraryClient.listDocuments).mockResolvedValue([doc({ id: "doc-file", source: "file" })]);
    vi.mocked(archiveWasm.exportContextArchive).mockResolvedValue(new Uint8Array());

    await buildContextArchiveForDownload({ fetch }, "ctx-1", false);

    expect(libraryClient.downloadOriginal).not.toHaveBeenCalled();
    const call = vi.mocked(archiveWasm.exportContextArchive).mock.calls[0][0];
    expect(call.documents[0].bytes ?? null).toBeNull();
  });

  it("falls back to a plain 'context' file name when the title sanitizes to nothing", async () => {
    vi.mocked(contextsClient.loadContext).mockResolvedValue({ ...BASE_CONTEXT, title: "???" });
    vi.mocked(libraryClient.listDocuments).mockResolvedValue([]);
    vi.mocked(archiveWasm.exportContextArchive).mockResolvedValue(new Uint8Array());

    const result = await buildContextArchiveForDownload({ fetch }, "ctx-1", true);
    expect(result.fileName).toBe("context.cva");
  });
});

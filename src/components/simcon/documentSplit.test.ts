import { describe, expect, it } from "vitest";

import { splitDocuments } from "@/components/simcon/documentSplit";
import type { RagDocument } from "@/lib/ipc";

function doc(overrides: Partial<RagDocument> = {}): RagDocument {
  return {
    id: "d1",
    file_name: "doc.txt",
    enabled: true,
    chunk_count: 1,
    ingested_at_unix_ms: 0,
    source: "file",
    context_ids: [],
    ...overrides,
  };
}

describe("splitDocuments", () => {
  it("puts a generated doc tagged to the current context in `generated`", () => {
    const d = doc({ id: "g1", source: "generated", context_ids: ["ctx-1"] });
    const { attachable, generated } = splitDocuments([d], "ctx-1");
    expect(generated).toEqual([d]);
    expect(attachable).toEqual([]);
  });

  it("excludes a generated doc tagged to a different context from both lists", () => {
    const d = doc({ id: "g2", source: "generated", context_ids: ["ctx-other"] });
    const { attachable, generated } = splitDocuments([d], "ctx-1");
    expect(generated).toEqual([]);
    expect(attachable).toEqual([]);
  });

  it("excludes a generated doc tagged to no context from both lists", () => {
    const d = doc({ id: "g3", source: "generated", context_ids: [] });
    const { attachable, generated } = splitDocuments([d], "ctx-1");
    expect(generated).toEqual([]);
    expect(attachable).toEqual([]);
  });

  it("always keeps a non-generated doc attachable regardless of context_ids", () => {
    const d1 = doc({ id: "f1", source: "file", context_ids: ["ctx-1"] });
    const d2 = doc({ id: "f2", source: "pasted", context_ids: ["ctx-other"] });
    const { attachable, generated } = splitDocuments([d1, d2], "ctx-1");
    expect(attachable).toEqual([d1, d2]);
    expect(generated).toEqual([]);
  });

  it("excludes every generated doc and keeps everything else attachable when contextId is undefined", () => {
    const gen = doc({ id: "g4", source: "generated", context_ids: ["ctx-1"] });
    const file = doc({ id: "f3", source: "file", context_ids: [] });
    const { attachable, generated } = splitDocuments([gen, file], undefined);
    expect(generated).toEqual([]);
    expect(attachable).toEqual([file]);
  });
});

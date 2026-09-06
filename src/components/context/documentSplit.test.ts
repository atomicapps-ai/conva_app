import { describe, expect, it } from "vitest";

import { groupBySlot, splitDocuments } from "@/components/context/documentSplit";
import type { ContextFileSlot } from "@/components/context/categoryTemplates";
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
    size_bytes: 0,
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

describe("groupBySlot", () => {
  const slots: ContextFileSlot[] = [
    { key: "resume", label: "Résumé / CV", multiple: false },
    { key: "job_description", label: "Job description", multiple: false },
  ];

  it("puts a doc into the slot whose slotDocIds list contains its id", () => {
    const resume = doc({ id: "d1", file_name: "resume.pdf" });
    const { slots: groups } = groupBySlot([resume], slots, { resume: ["d1"] });
    expect(groups[0]!.docs).toEqual([resume]);
    expect(groups[1]!.docs).toEqual([]);
  });

  it("puts a doc absent from every slot's list into `other`", () => {
    const misc = doc({ id: "d2", file_name: "misc.txt" });
    const { other } = groupBySlot([misc], slots, {});
    expect(other).toEqual([misc]);
  });

  it("puts every doc into `other` when slotDocIds is empty (back-compat, pre-migration contexts)", () => {
    const a = doc({ id: "d1" });
    const b = doc({ id: "d2" });
    const { slots: groups, other } = groupBySlot([a, b], slots, {});
    expect(other).toEqual([a, b]);
    expect(groups.every((g) => g.docs.length === 0)).toBe(true);
  });

  it("keeps a slot in the result with an empty docs array when nothing matches", () => {
    const { slots: groups } = groupBySlot([], slots, {});
    expect(groups).toHaveLength(2);
    expect(groups[0]).toEqual({ slot: slots[0], docs: [] });
  });
});

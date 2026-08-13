import { describe, expect, it } from "vitest";

import { autoNameGrounding, resolveGrounding } from "@/components/contexts/groundResolve";

describe("resolveGrounding", () => {
  it("dedupes doc ids across overlapping contexts and extra picks", () => {
    const r = resolveGrounding(
      [
        { docIds: ["a", "b"], keyTerms: [] },
        { docIds: ["b", "c"], keyTerms: [] },
      ],
      ["c", "d"],
    );
    expect(r.docIds).toEqual(["a", "b", "c", "d"]);
  });

  it("dedupes key terms case-insensitively, keeping first-seen casing", () => {
    const r = resolveGrounding(
      [
        { docIds: [], keyTerms: ["GAAP", "deferred revenue"] },
        { docIds: [], keyTerms: ["gaap", "SOC 2"] },
      ],
      [],
    );
    expect(r.keyTerms).toEqual(["GAAP", "deferred revenue", "SOC 2"]);
  });

  it("drops blank terms and ids", () => {
    const r = resolveGrounding([{ docIds: ["", "a"], keyTerms: ["  ", "x"] }], [""]);
    expect(r.docIds).toEqual(["a"]);
    expect(r.keyTerms).toEqual(["x"]);
  });

  it("is empty for no input", () => {
    expect(resolveGrounding([], [])).toEqual({ docIds: [], keyTerms: [] });
  });
});

describe("autoNameGrounding", () => {
  it("uses the single label as-is", () => {
    expect(autoNameGrounding(["Acme interview"])).toBe("Acme interview");
  });

  it("names a mix as '<first> + N more'", () => {
    expect(autoNameGrounding(["Acme interview", "pricing.pdf", "notes.txt"])).toBe(
      "Acme interview + 2 more",
    );
  });

  it("falls back to a timestamp when nothing has a label", () => {
    expect(autoNameGrounding([])).toMatch(/^Quick context — \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  });

  it("ignores blank labels", () => {
    expect(autoNameGrounding(["  ", "Only one"])).toBe("Only one");
  });
});

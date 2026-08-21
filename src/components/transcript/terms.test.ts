import { describe, expect, it } from "vitest";

import type { Capture } from "@/lib/ipc";
import {
  buildDocTerms,
  buildTermChips,
  captureTermLabel,
  chipKindTag,
} from "@/components/transcript/terms";

describe("buildDocTerms (Terms tab · From your documents)", () => {
  it("keeps key terms first, appends glossary, dedupes case-insensitively", () => {
    expect(
      buildDocTerms(
        ["STAR method", "  SLA "],
        ["sla", "Leadership Principles", "STAR Method"],
      ),
    ).toEqual(["STAR method", "SLA", "Leadership Principles"]);
  });

  it("handles missing lists and blank entries", () => {
    expect(buildDocTerms(undefined, undefined)).toEqual([]);
    expect(buildDocTerms(["", "  "], ["x"])).toEqual(["x"]);
  });
});

describe("captureTermLabel", () => {
  it("joins the capture's argument keywords", () => {
    const c = { arguments: ["schema", "migration"] } as unknown as Capture;
    expect(captureTermLabel(c)).toBe("schema migration");
  });
});

function capture(args: string[], kind: string | null, action = "EXPLAIN"): Capture {
  return { arguments: args, kind, action, preview: "p" } as unknown as Capture;
}

describe("buildTermChips (Terms tab chips)", () => {
  it("captures first, doc terms after, capture wins a label collision", () => {
    const { detected, docs } = buildTermChips(
      [capture(["STAR", "method"], "concept"), capture([], "concept")],
      ["star method", "SLA"],
    );
    expect(detected.map((c) => c.label)).toEqual(["STAR method"]);
    expect(docs.map((c) => c.label)).toEqual(["SLA"]);
  });
});

describe("chipKindTag (per-phrase action tag)", () => {
  it("maps FANER classification to the shown tag", () => {
    const [concept] = buildTermChips([capture(["x"], "concept")], []).detected;
    const [problem] = buildTermChips([capture(["y"], "problem")], []).detected;
    const [recall] = buildTermChips([capture(["z"], null, "RECALL")], []).detected;
    const [doc] = buildTermChips([], ["d"]).docs;
    expect(chipKindTag(concept!)).toBe("concept");
    expect(chipKindTag(problem!)).toBe("fix");
    expect(chipKindTag(recall!)).toBe("recall");
    expect(chipKindTag(doc!)).toBe("term");
  });
});

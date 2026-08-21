import { describe, expect, it } from "vitest";

import type { Capture } from "@/lib/ipc";
import { buildDocTerms, captureTermLabel } from "@/components/transcript/terms";

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

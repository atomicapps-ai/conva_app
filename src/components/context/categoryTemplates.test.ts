import { describe, expect, it } from "vitest";

import { CATEGORIES, categoryTemplate, researchDefault } from "@/components/context/categoryTemplates";

describe("categoryTemplates", () => {
  it("every category has non-empty file slots and digest sections", () => {
    for (const c of CATEGORIES) {
      expect(c.fileSlots.length).toBeGreaterThan(0);
      expect(c.digestSections.length).toBeGreaterThan(0);
    }
  });

  it("categoryTemplate falls back to the first entry for an unrecognized value", () => {
    // @ts-expect-error deliberately probing the defensive fallback with a
    // value outside the ContextCategory union.
    expect(categoryTemplate("nonsense")).toBe(CATEGORIES[0]);
  });

  it("researchDefault matches decision 2 (interview/sales/live_stream on, company_meeting/other off)", () => {
    expect(researchDefault("interview")).toBe(true);
    expect(researchDefault("sales_call")).toBe(true);
    expect(researchDefault("live_stream")).toBe(true);
    expect(researchDefault("company_meeting")).toBe(false);
    expect(researchDefault("other")).toBe(false);
  });
});

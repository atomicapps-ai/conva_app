import { describe, expect, it } from "vitest";

import { CATEGORIES } from "@/components/context/categoryTemplates";
import { CONTEXT_STARTERS, contextStarter } from "@/components/context/contextStarters";

describe("contextStarters", () => {
  it("defines a starter skeleton for every Context category", () => {
    for (const { value } of CATEGORIES) {
      const starter = contextStarter(value);
      expect(starter.namePlaceholder.trim()).not.toBe("");
      expect(starter.purposePlaceholder.trim()).not.toBe("");
      expect(starter.keyTermsPlaceholder.trim()).not.toBe("");
    }
  });

  it("gives every category a distinct name and goal example", () => {
    const names = Object.values(CONTEXT_STARTERS).map((s) => s.namePlaceholder);
    const purposes = Object.values(CONTEXT_STARTERS).map((s) => s.purposePlaceholder);
    expect(new Set(names).size).toBe(names.length);
    expect(new Set(purposes).size).toBe(purposes.length);
  });
});

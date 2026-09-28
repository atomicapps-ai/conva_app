import { describe, expect, it } from "vitest";

import {
  SECTION_ORDER,
  SECTION_META,
  selectSection,
  type PanelState,
} from "@/components/transcript/panelSections";

describe("panelSections", () => {
  it("keeps a fixed section order with meta for each", () => {
    expect(SECTION_ORDER).toEqual(["questions", "tracking", "terms"]);
    for (const id of SECTION_ORDER) {
      expect(SECTION_META[id].label).toBeTruthy();
      expect(SECTION_META[id].icon).toBeTruthy();
    }
  });

  it("selects exclusively; re-selecting the open section is a no-op", () => {
    const state: PanelState = { open: "terms" };
    expect(selectSection(state, "questions")).toEqual({ open: "questions" });
    expect(selectSection(state, "terms")).toBe(state);
  });
});

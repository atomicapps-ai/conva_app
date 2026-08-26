import { describe, expect, it } from "vitest";

import {
  SECTION_ORDER,
  SECTION_META,
  selectSection,
  togglePin,
  revealAnswers,
  type PanelState,
} from "@/components/transcript/panelSections";

const pinned: PanelState = { open: "terms", answersPinned: true };
const unpinned: PanelState = { open: "questions", answersPinned: false };

describe("panelSections", () => {
  it("keeps a fixed section order with meta for each", () => {
    expect(SECTION_ORDER).toEqual(["questions", "tracking", "terms", "answers"]);
    for (const id of SECTION_ORDER) {
      expect(SECTION_META[id].label).toBeTruthy();
      expect(SECTION_META[id].icon).toBeTruthy();
    }
  });

  it("selects exclusively; re-selecting the open section is a no-op", () => {
    expect(selectSection(pinned, "questions")).toEqual({
      open: "questions",
      answersPinned: true,
    });
    expect(selectSection(pinned, "terms")).toBe(pinned);
  });

  it("ignores selecting answers while pinned (the dock is already visible)", () => {
    expect(selectSection(pinned, "answers")).toBe(pinned);
    expect(selectSection(unpinned, "answers").open).toBe("answers");
  });

  it("hands the open section over across pin toggles", () => {
    const nowUnpinned = togglePin(pinned);
    expect(nowUnpinned).toEqual({ open: "answers", answersPinned: false });
    const backPinned = togglePin({ open: "answers", answersPinned: false });
    expect(backPinned).toEqual({ open: "terms", answersPinned: true });
    // pinning while a content section is open keeps it open
    expect(togglePin({ open: "questions", answersPinned: false })).toEqual({
      open: "questions",
      answersPinned: true,
    });
  });

  it("revealAnswers opens the section only when unpinned", () => {
    expect(revealAnswers(pinned)).toBe(pinned);
    expect(revealAnswers(unpinned)).toEqual({
      open: "answers",
      answersPinned: false,
    });
  });
});

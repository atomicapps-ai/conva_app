import { beforeEach, describe, expect, it } from "vitest";

import { useUiPrefs } from "@/state/uiPrefs";

describe("uiPrefs accordion", () => {
  beforeEach(() => {
    localStorage.clear();
    useUiPrefs.setState({ answersPinned: true, panelOpenSection: "terms" });
  });

  it("defaults: answers pinned, terms open", () => {
    expect(useUiPrefs.getState().answersPinned).toBe(true);
    expect(useUiPrefs.getState().panelOpenSection).toBe("terms");
  });

  it("persists pin + open section", () => {
    useUiPrefs.getState().setAnswersPinned(false);
    useUiPrefs.getState().setPanelOpenSection("questions");
    expect(localStorage.getItem("conva.panel.answersPinned")).toBe("false");
    expect(localStorage.getItem("conva.panel.openSection")).toBe("questions");
  });

  it("rejects an unknown stored section id", () => {
    useUiPrefs.getState().setPanelOpenSection("bogus" as never);
    expect(useUiPrefs.getState().panelOpenSection).toBe("terms");
  });
});

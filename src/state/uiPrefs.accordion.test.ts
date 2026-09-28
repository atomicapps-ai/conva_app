import { beforeEach, describe, expect, it } from "vitest";

import { useUiPrefs } from "@/state/uiPrefs";

describe("uiPrefs accordion", () => {
  beforeEach(() => {
    localStorage.clear();
    useUiPrefs.setState({ panelOpenSection: "terms" });
  });

  it("defaults: terms open", () => {
    expect(useUiPrefs.getState().panelOpenSection).toBe("terms");
  });

  it("persists the open section", () => {
    useUiPrefs.getState().setPanelOpenSection("questions");
    expect(localStorage.getItem("conva.panel.openSection")).toBe("questions");
  });

  it("rejects an unknown stored section id — including a stale 'answers' from before the dock retired", () => {
    useUiPrefs.getState().setPanelOpenSection("bogus" as never);
    expect(useUiPrefs.getState().panelOpenSection).toBe("terms");
    useUiPrefs.getState().setPanelOpenSection("answers" as never);
    expect(useUiPrefs.getState().panelOpenSection).toBe("terms");
  });
});

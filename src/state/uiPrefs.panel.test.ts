import { beforeEach, describe, expect, it } from "vitest";

import { useUiPrefs } from "@/state/uiPrefs";

describe("panel width pref", () => {
  beforeEach(() => {
    localStorage.removeItem("conva.panel.widthPx");
    useUiPrefs.setState({ panelWidthPx: 340 });
  });

  it("defaults to 340 and clamps to 280-560", () => {
    expect(useUiPrefs.getState().panelWidthPx).toBe(340);
    useUiPrefs.getState().setPanelWidthPx(9999);
    expect(useUiPrefs.getState().panelWidthPx).toBe(560);
    useUiPrefs.getState().setPanelWidthPx(0);
    expect(useUiPrefs.getState().panelWidthPx).toBe(280);
  });

  it("persists to localStorage rounded", () => {
    useUiPrefs.getState().setPanelWidthPx(412.6);
    expect(localStorage.getItem("conva.panel.widthPx")).toBe("413");
  });
});

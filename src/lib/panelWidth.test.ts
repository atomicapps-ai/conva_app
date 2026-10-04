import { describe, expect, it } from "vitest";
import { EMBEDDED_VIEW_MIN_PANEL_PX, effectivePanelWidth } from "./panelWidth";

describe("effectivePanelWidth", () => {
  it("desktop keeps the stored width", () => {
    expect(effectivePanelWidth({ panelWidthPx: 340, windowWidthPx: 1280, embeddedView: false })).toBe(340);
  });
  it("embedded View raises a narrow panel to the floor", () => {
    expect(effectivePanelWidth({ panelWidthPx: 340, windowWidthPx: 1280, embeddedView: true })).toBe(EMBEDDED_VIEW_MIN_PANEL_PX);
  });
  it("embedded View keeps a wider stored width", () => {
    expect(effectivePanelWidth({ panelWidthPx: 560, windowWidthPx: 1280, embeddedView: true })).toBe(560);
  });
  it("the window clamp still leaves the conversation 320px", () => {
    expect(effectivePanelWidth({ panelWidthPx: 340, windowWidthPx: 800, embeddedView: true })).toBe(480);
    expect(effectivePanelWidth({ panelWidthPx: 340, windowWidthPx: 500, embeddedView: true })).toBe(280);
  });
  it("an unmeasured window uses the base width", () => {
    expect(effectivePanelWidth({ panelWidthPx: 340, windowWidthPx: 0, embeddedView: false })).toBe(340);
  });
});

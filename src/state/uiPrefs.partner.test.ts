import { beforeEach, describe, expect, it } from "vitest";

import { useUiPrefs } from "@/state/uiPrefs";

describe("partner font pref", () => {
  beforeEach(() => localStorage.removeItem("conva.partner.fontPx"));

  it("defaults to 14 and clamps bumps to the shared 11-20 range", () => {
    expect(useUiPrefs.getState().partnerFontPx).toBe(14);
    for (let i = 0; i < 20; i++) useUiPrefs.getState().bumpPartnerFont(1);
    expect(useUiPrefs.getState().partnerFontPx).toBe(20);
    for (let i = 0; i < 20; i++) useUiPrefs.getState().bumpPartnerFont(-1);
    expect(useUiPrefs.getState().partnerFontPx).toBe(11);
  });

  it("persists to localStorage", () => {
    useUiPrefs.getState().bumpPartnerFont(1);
    expect(localStorage.getItem("conva.partner.fontPx")).toBe(
      String(useUiPrefs.getState().partnerFontPx),
    );
  });
});

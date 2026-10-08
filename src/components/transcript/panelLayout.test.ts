import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Structural guard for the Live cockpit (owner, 2026-09-29; CLAUDE.md rule
 * 10): 1 Nav rail · 2 Conversation · 3 Ally (accordion, lists only) ·
 * 4 View = the separate attached window. There is NO View pane inside the
 * main window on desktop — twice a session put one next to panel 3. These
 * read the source (TranscriptView is too heavy to mount), like the App
 * mounting test does.
 */
const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");
const transcript = read("src/components/transcript/TranscriptView.tsx");
const partner = read("src/components/partner/PartnerWindow.tsx");

describe("Live cockpit panel layout", () => {
  it("the main window renders View only as the web fallback (embeddedView)", () => {
    expect(transcript).toContain("embeddedView={");
    expect(transcript).toMatch(/partnerView \? null : \(\s*<ViewPanel/);
  });

  it("panel 3 is the accordion alone — no answer canvas, no type-tab strip", () => {
    expect(transcript).not.toContain("AllyFocusCanvas");
    expect(transcript).not.toContain('data-col="view"');
  });

  it("selecting or receiving something brings up window 4 without retargeting it", () => {
    expect(transcript).toMatch(/backend\.partner\.ensureOpen\(\)/);
    expect(transcript).toMatch(/backend\.partner\.publishView\(/);
    expect(transcript).toMatch(/subscribe\("partnerViewAction"/);
  });

  it("window 4's first tab is View, rendered by ViewPanel", () => {
    expect(partner).toContain('const VIEW_KEY = "view"');
    expect(partner).toContain("<ViewPanel");
    expect(partner).toContain('subscribe("partnerViewState"');
  });
});

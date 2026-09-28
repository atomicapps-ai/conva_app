import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Structural guard for the Live cockpit's right side (owner-approved mockup,
 * 2026-09-28): Active (3) and View (4) are TWO SEPARATE docked panels, each
 * its own `<aside>` with its own border/background/header/width handle —
 * NOT one shared box split by an in-panel divider (the misreading #353
 * shipped). `AllyPanel` is not exported and TranscriptView is too heavy to
 * mount, so this reads the source, like the App mounting test does.
 */
const src = readFileSync(
  resolve(process.cwd(), "src/components/transcript/TranscriptView.tsx"),
  "utf8",
);

describe("Live cockpit panel layout", () => {
  it("renders Active and View as separate asides", () => {
    expect(src).toContain('data-col="ally"');
    expect(src).toContain('data-col="view"');
    expect((src.match(/<aside\b/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it("gives each panel its own width handle and no shared Active/View divider", () => {
    expect(src).toContain("Resize Active panel");
    expect(src).toContain("Resize View panel");
    expect(src).not.toContain("Resize Active/View");
    expect(src).not.toContain("activeViewSplitRatio");
  });

  it("stacks the two panels only in drawer mode", () => {
    expect(src).toMatch(/stacked=\{drawer\}/);
  });
});

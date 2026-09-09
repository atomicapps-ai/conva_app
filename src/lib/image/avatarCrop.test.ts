import { describe, expect, it } from "vitest";

import {
  AVATAR_MAX_ZOOM,
  AVATAR_MIN_ZOOM,
  clampCrop,
  computeCropRect,
  panAfterDrag,
} from "@/lib/image/avatarCrop";

describe("clampCrop", () => {
  it("bounds zoom to [MIN, MAX] and pan to [0, 1]", () => {
    expect(clampCrop({ zoom: 0.2, panX: -1, panY: 5 })).toEqual({
      zoom: AVATAR_MIN_ZOOM,
      panX: 0,
      panY: 1,
    });
    expect(clampCrop({ zoom: 99, panX: 0.3, panY: 0.7 })).toEqual({
      zoom: AVATAR_MAX_ZOOM,
      panX: 0.3,
      panY: 0.7,
    });
  });
});

describe("computeCropRect", () => {
  it("at zoom 1, covers the image's shorter side with no room to pan on that axis", () => {
    // Landscape 800×400: shorter side is height (400) — the crop square is
    // 400×400 regardless of panY, and slides 0..400 horizontally as panX moves.
    const centered = computeCropRect(800, 400, { zoom: 1, panX: 0.5, panY: 0.5 });
    expect(centered).toEqual({ sx: 200, sy: 0, size: 400 });

    const left = computeCropRect(800, 400, { zoom: 1, panX: 0, panY: 0.5 });
    expect(left).toEqual({ sx: 0, sy: 0, size: 400 });

    const right = computeCropRect(800, 400, { zoom: 1, panX: 1, panY: 0.5 });
    expect(right).toEqual({ sx: 400, sy: 0, size: 400 });

    // panY never moves the crop on the already-fully-covered short axis.
    expect(computeCropRect(800, 400, { zoom: 1, panX: 0.5, panY: 0 }).sy).toBe(0);
    expect(computeCropRect(800, 400, { zoom: 1, panX: 0.5, panY: 1 }).sy).toBe(0);
  });

  it("a square image has zero slack on both axes regardless of pan", () => {
    const rect = computeCropRect(600, 600, { zoom: 1, panX: 0.1, panY: 0.9 });
    expect(rect).toEqual({ sx: 0, sy: 0, size: 600 });
  });

  it("zooming in shrinks the crop square and opens up slack on both axes", () => {
    const rect = computeCropRect(600, 600, { zoom: 2, panX: 0.5, panY: 0.5 });
    expect(rect.size).toBe(300);
    // Centered at 50%/50% slack of (600-300)=300 each way → offset 150.
    expect(rect.sx).toBe(150);
    expect(rect.sy).toBe(150);
  });

  it("silently clamps an out-of-range crop before computing", () => {
    const rect = computeCropRect(800, 400, { zoom: 1, panX: -5, panY: 5 });
    expect(rect).toEqual({ sx: 0, sy: 0, size: 400 });
  });
});

describe("panAfterDrag", () => {
  it("dragging right (positive dx) reveals more of the image's left side (pan decreases)", () => {
    const start = { zoom: 2, panX: 0.5, panY: 0.5 };
    // renderedWidth 400 in a 200px viewport → slackX 200.
    const next = panAfterDrag(start, 100, 0, 400, 400, 200);
    expect(next.panX).toBeCloseTo(0.5 - 100 / 200, 5);
    expect(next.panY).toBe(0.5);
  });

  it("does nothing on an axis with no slack (avoids divide-by-zero)", () => {
    const start = { zoom: 1, panX: 0.5, panY: 0.5 };
    // renderedHeight equals the viewport — zero vertical slack.
    const next = panAfterDrag(start, 0, 50, 400, 200, 200);
    expect(next.panY).toBe(0.5);
  });

  it("clamps the result to [0, 1]", () => {
    const start = { zoom: 2, panX: 0.1, panY: 0.9 };
    const next = panAfterDrag(start, 1000, -1000, 400, 400, 200);
    expect(next.panX).toBe(0);
    expect(next.panY).toBe(1);
  });
});

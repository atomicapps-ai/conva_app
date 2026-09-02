import { describe, expect, it } from "vitest";

import {
  canDockLibrary,
  CENTER_MIN_PX,
  layoutTier,
  RAIL_EXPANDED_PX,
  RAIL_ICONS_PX,
  resolveLayout,
} from "@/lib/responsive";

describe("layoutTier", () => {
  it("classifies the three V5.0 tiers at their boundaries", () => {
    expect(layoutTier(1600)).toBe("wide");
    expect(layoutTier(1024)).toBe("wide");
    expect(layoutTier(1023)).toBe("compact");
    expect(layoutTier(560)).toBe("compact");
    expect(layoutTier(559)).toBe("tiny");
    expect(layoutTier(0)).toBe("tiny");
  });

  it("puts the 960×640 new-window default in the compact tier", () => {
    // The default window is narrower than the 1024px expanded-nav threshold
    // on purpose (smaller-screens-first) — a fresh install starts on the
    // icon-only rail, not the expanded one.
    expect(layoutTier(960)).toBe("compact");
  });
});

describe("resolveLayout", () => {
  it("sheds labels/dock/list together at the wide→compact boundary, then the rail at compact→tiny", () => {
    expect(resolveLayout(1440)).toMatchObject({
      railMode: "expanded",
      libraryDocked: true,
      showsListAndWorkspace: true,
    });
    expect(resolveLayout(800)).toMatchObject({
      railMode: "icons",
      libraryDocked: false,
      showsListAndWorkspace: false,
    });
    expect(resolveLayout(500)).toMatchObject({
      railMode: "menu",
      libraryDocked: false,
      showsListAndWorkspace: false,
    });
  });

  it("manual Compact forces the icon rail at any width", () => {
    expect(resolveLayout(1600, true).railMode).toBe("icons");
  });

  it("manual Compact never re-expands a rail that already became a menu", () => {
    expect(resolveLayout(500, true).railMode).toBe("menu");
  });
});

describe("canDockLibrary", () => {
  it("keeps the dock only while the 360px centre floor survives", () => {
    // 184 rail + 220 list + 260 dock + 360 centre = 1024.
    expect(canDockLibrary(1024, RAIL_EXPANDED_PX)).toBe(true);
    expect(canDockLibrary(1023, RAIL_EXPANDED_PX)).toBe(false);
  });

  it("an icon rail buys back exactly the width it saves", () => {
    const saved = RAIL_EXPANDED_PX - RAIL_ICONS_PX;
    expect(canDockLibrary(1024 - saved, RAIL_ICONS_PX)).toBe(true);
  });

  it("never claims a dock fits at the minimum shell width", () => {
    expect(canDockLibrary(560, RAIL_ICONS_PX)).toBe(false);
    expect(CENTER_MIN_PX).toBe(360);
  });
});

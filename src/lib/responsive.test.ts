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
  it("classifies the four V5.0 tiers at their boundaries", () => {
    expect(layoutTier(1600)).toBe("wide");
    expect(layoutTier(1380)).toBe("wide");
    expect(layoutTier(1379)).toBe("standard");
    expect(layoutTier(1040)).toBe("standard");
    expect(layoutTier(1039)).toBe("compact");
    expect(layoutTier(700)).toBe("compact");
    expect(layoutTier(699)).toBe("tiny");
    expect(layoutTier(0)).toBe("tiny");
  });

  it("puts the 1280×800 new-window default in the standard tier", () => {
    // The window is 1280 wide, so the shell is a shade under it — either way
    // it must land on the icon rail, not the expanded one.
    expect(layoutTier(1280)).toBe("standard");
  });
});

describe("resolveLayout", () => {
  it("sheds labels, then the dock, then the rail — in that order", () => {
    expect(resolveLayout(1440)).toMatchObject({
      railMode: "expanded",
      libraryDocked: true,
      showsListAndWorkspace: true,
    });
    expect(resolveLayout(1200)).toMatchObject({
      railMode: "icons",
      libraryDocked: false,
      showsListAndWorkspace: true,
    });
    expect(resolveLayout(900)).toMatchObject({
      railMode: "icons",
      libraryDocked: false,
      showsListAndWorkspace: false,
    });
    expect(resolveLayout(640)).toMatchObject({
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
  it("keeps the dock only while the 520px centre floor survives", () => {
    // 240 rail + 300 list + 360 dock + 520 centre = 1420.
    expect(canDockLibrary(1420, RAIL_EXPANDED_PX)).toBe(true);
    expect(canDockLibrary(1419, RAIL_EXPANDED_PX)).toBe(false);
  });

  it("an icon rail buys back exactly the width it saves", () => {
    const saved = RAIL_EXPANDED_PX - RAIL_ICONS_PX;
    expect(canDockLibrary(1420 - saved, RAIL_ICONS_PX)).toBe(true);
  });

  it("never claims a dock fits at the minimum shell width", () => {
    expect(canDockLibrary(700, RAIL_ICONS_PX)).toBe(false);
    expect(CENTER_MIN_PX).toBe(520);
  });
});

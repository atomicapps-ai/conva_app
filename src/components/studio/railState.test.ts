import { describe, expect, it } from "vitest";

import { NAV_ITEMS } from "@/components/studio/navItems";
import { activeRailView, isRailDestination } from "@/components/studio/railState";

describe("NAV_ITEMS — the six approved destinations", () => {
  it("is exactly Home · Live Session · Contexts · Library · Coaching · What's Coming, in order", () => {
    expect(NAV_ITEMS.map((i) => i.label)).toEqual([
      "Home",
      "Live Session",
      "Contexts",
      "Library",
      "Coaching",
      "What's Coming",
    ]);
  });

  it("routes those labels to the right views", () => {
    expect(NAV_ITEMS.map((i) => i.view)).toEqual([
      "dashboard",
      "live",
      "context",
      "library",
      "coaching",
      "whatsnew",
    ]);
  });

  it("has NO Settings row — the gear lives in the account utility row", () => {
    expect(NAV_ITEMS.some((i) => i.view === "settings")).toBe(false);
  });

  it("has no Conversations row — it is a sub-view now", () => {
    expect(NAV_ITEMS.some((i) => i.view === "conversations")).toBe(false);
  });

  it("uses canonical locked icon assets, one per row", () => {
    expect(NAV_ITEMS.map((i) => i.icon)).toEqual([
      "nav-home",
      "nav-live-session",
      "nav-contexts",
      "nav-library",
      "nav-coaching",
      "nav-whats-coming",
    ]);
  });
});

describe("activeRailView", () => {
  it("lights its own row for every rail destination", () => {
    for (const item of NAV_ITEMS) {
      expect(activeRailView(item.view)).toBe(item.view);
    }
  });

  it("lights NO row on Settings (§8) or the other account surfaces", () => {
    expect(activeRailView("settings")).toBeNull();
    expect(activeRailView("profile")).toBeNull();
    expect(activeRailView("about")).toBeNull();
  });

  it("lights Home for the Conversations sub-view", () => {
    expect(activeRailView("conversations")).toBe("dashboard");
  });

  it("lights What's Coming for the roadmap sub-views", () => {
    expect(activeRailView("features")).toBe("whatsnew");
    expect(activeRailView("releases")).toBe("whatsnew");
  });
});

describe("isRailDestination", () => {
  it("is true only for the six rows", () => {
    expect(isRailDestination("library")).toBe(true);
    expect(isRailDestination("coaching")).toBe(true);
    expect(isRailDestination("conversations")).toBe(false);
    expect(isRailDestination("settings")).toBe(false);
  });
});

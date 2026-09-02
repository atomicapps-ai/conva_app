import { describe, expect, it } from "vitest";

import { NAV_ITEMS } from "@/components/studio/navItems";
import { activeRailView } from "@/components/studio/railState";
import {
  DEFAULT_SETTINGS_GROUP,
  groupForKey,
  SETTINGS_GROUPS,
  toSettingsGroup,
  type SettingsGroup,
} from "@/components/settingsNav";

describe("SETTINGS_GROUPS", () => {
  it("is exactly the five approved groups, in order", () => {
    expect(SETTINGS_GROUPS.map((g) => g.label)).toEqual([
      "Account",
      "Devices",
      "Transcription",
      "Ally",
      "Privacy",
    ]);
  });

  it("opens on Account", () => {
    expect(DEFAULT_SETTINGS_GROUP).toBe("account");
  });
});

describe("Settings routing", () => {
  it("is reached from the account gear, not from a rail row", () => {
    expect(NAV_ITEMS.some((i) => i.view === "settings")).toBe(false);
  });

  it("lights no rail row while Settings is open (§8)", () => {
    expect(activeRailView("settings")).toBeNull();
  });
});

describe("toSettingsGroup", () => {
  it("passes real groups through", () => {
    expect(toSettingsGroup("privacy")).toBe("privacy");
  });

  it("falls back to Account for junk, null, or an old stored value", () => {
    expect(toSettingsGroup("insights")).toBe("account");
    expect(toSettingsGroup(null)).toBe("account");
    expect(toSettingsGroup(undefined)).toBe("account");
    expect(toSettingsGroup("")).toBe("account");
  });
});

describe("groupForKey", () => {
  it("moves down and wraps", () => {
    expect(groupForKey("account", "ArrowDown")).toBe("devices");
    expect(groupForKey("privacy", "ArrowDown")).toBe("account");
  });

  it("moves up and wraps", () => {
    expect(groupForKey("devices", "ArrowUp")).toBe("account");
    expect(groupForKey("account", "ArrowUp")).toBe("privacy");
  });

  it("jumps to the ends", () => {
    expect(groupForKey("transcription", "Home")).toBe("account");
    expect(groupForKey("transcription", "End")).toBe("privacy");
  });

  it("ignores every other key", () => {
    expect(groupForKey("ally", "ArrowRight")).toBe("ally");
    expect(groupForKey("ally", "Enter")).toBe("ally");
  });

  it("is a no-op for an unknown current group", () => {
    expect(groupForKey("nope" as SettingsGroup, "ArrowDown")).toBe("nope");
  });
});

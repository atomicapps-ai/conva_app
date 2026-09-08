import { beforeEach, describe, expect, it } from "vitest";

import { useUiPrefs } from "@/state/uiPrefs";

describe("update preferences", () => {
  beforeEach(() => {
    localStorage.removeItem("conva.updates.autoInstall");
    useUiPrefs.setState({ autoInstallUpdates: false });
  });

  it("keeps automatic installation off by default", () => {
    expect(useUiPrefs.getState().autoInstallUpdates).toBe(false);
  });

  it("persists the user's automatic-install choice", () => {
    useUiPrefs.getState().setAutoInstallUpdates(true);
    expect(useUiPrefs.getState().autoInstallUpdates).toBe(true);
    expect(localStorage.getItem("conva.updates.autoInstall")).toBe("1");

    useUiPrefs.getState().setAutoInstallUpdates(false);
    expect(localStorage.getItem("conva.updates.autoInstall")).toBe("0");
  });
});

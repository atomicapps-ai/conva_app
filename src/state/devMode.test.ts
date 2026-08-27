import { beforeEach, describe, expect, it } from "vitest";

import { useDevMode } from "@/state/devMode";

const KEY = "conva.dev.debugChromeVisible";

describe("dev debug-chrome visibility pref", () => {
  beforeEach(() => {
    localStorage.removeItem(KEY);
    useDevMode.setState({ debugChromeVisible: true });
  });

  it("defaults to visible", () => {
    expect(useDevMode.getState().debugChromeVisible).toBe(true);
  });

  it("setDebugChromeVisible persists and updates state", () => {
    useDevMode.getState().setDebugChromeVisible(false);
    expect(useDevMode.getState().debugChromeVisible).toBe(false);
    expect(localStorage.getItem(KEY)).toBe("0");

    useDevMode.getState().setDebugChromeVisible(true);
    expect(useDevMode.getState().debugChromeVisible).toBe(true);
    expect(localStorage.getItem(KEY)).toBe("1");
  });

  it("toggleDebugChrome flips the current value", () => {
    useDevMode.getState().toggleDebugChrome();
    expect(useDevMode.getState().debugChromeVisible).toBe(false);
    expect(localStorage.getItem(KEY)).toBe("0");

    useDevMode.getState().toggleDebugChrome();
    expect(useDevMode.getState().debugChromeVisible).toBe(true);
    expect(localStorage.getItem(KEY)).toBe("1");
  });
});

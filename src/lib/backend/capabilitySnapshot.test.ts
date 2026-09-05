import { describe, expect, it } from "vitest";

import { DESKTOP_CAPABILITIES, WEB_CAPABILITIES } from "@/lib/backend/capabilities";
import {
  ALL_OPERATIONS,
  desktopSnapshot,
  legacySnapshot,
  sourceOfKind,
  webOperations,
  webSnapshot,
  type RuntimeProbe,
} from "@/lib/backend/capabilitySnapshot";
import { isUsable } from "@/lib/capture/contract";

const chromeWindows: RuntimeProbe = {
  os: "windows",
  hasGetUserMedia: true,
  hasGetDisplayMedia: true,
  secureContext: true,
};
const firefoxLike: RuntimeProbe = {
  os: "linux",
  hasGetUserMedia: true,
  hasGetDisplayMedia: false,
  secureContext: true,
};
const macDesktop: RuntimeProbe = { ...chromeWindows, os: "macos" };

describe("available vs unsupported vs unimplemented", () => {
  it("desktop: mic + WASAPI available on Windows; WASAPI unsupported (not unimplemented) on macOS", () => {
    const win = desktopSnapshot(DESKTOP_CAPABILITIES, chromeWindows);
    expect(sourceOfKind(win, "mic")?.availability).toEqual({ state: "available" });
    expect(sourceOfKind(win, "wasapi")?.availability).toEqual({ state: "available" });

    const mac = desktopSnapshot(DESKTOP_CAPABILITIES, macDesktop);
    expect(sourceOfKind(mac, "mic")?.availability.state).toBe("available");
    expect(sourceOfKind(mac, "wasapi")?.availability.state).toBe("unsupported");
    // meeting integrations are a future adapter — honest "not built"
    expect(sourceOfKind(mac, "meeting")?.availability.state).toBe("unimplemented");
    // the legacy descriptor is passed through untouched
    expect(mac.legacy).toBe(DESKTOP_CAPABILITIES);
    expect(mac.adapter).toBe("tauri");
  });

  it("web: nothing is available in M0 — TODO stubs are unimplemented, never available", () => {
    const snap = webSnapshot(WEB_CAPABILITIES, chromeWindows);
    expect(snap.adapter).toBe("web");
    expect(snap.legacy).toBe(WEB_CAPABILITIES);
    for (const s of snap.sources) {
      expect(isUsable(s.availability)).toBe(false);
    }
    expect(sourceOfKind(snap, "mic")?.availability.state).toBe("unimplemented");
    expect(sourceOfKind(snap, "display")?.availability.state).toBe("unimplemented");
    expect(sourceOfKind(snap, "tab")?.availability.state).toBe("unimplemented");
    expect(sourceOfKind(snap, "wasapi")?.availability.state).toBe("unimplemented");
    expect(sourceOfKind(snap, "wasapi")?.owner).toBe("bridge");
  });

  it("web: a missing runtime API is unsupported, an insecure context is unsupported", () => {
    const ff = webSnapshot(WEB_CAPABILITIES, firefoxLike);
    expect(sourceOfKind(ff, "display")?.availability.state).toBe("unsupported");
    expect(sourceOfKind(ff, "tab")?.availability.state).toBe("unsupported");
    expect(sourceOfKind(ff, "mic")?.availability.state).toBe("unimplemented");

    const http = webSnapshot(WEB_CAPABILITIES, { ...chromeWindows, secureContext: false });
    expect(sourceOfKind(http, "mic")?.availability.state).toBe("unsupported");
    expect(sourceOfKind(http, "display")?.availability.state).toBe("unsupported");
  });

  it("web operations: todo → unimplemented, Layer-4 → unsupported, working auth → available", () => {
    const ops = webOperations();
    expect(ops["session.start"].state).toBe("unimplemented");
    expect(ops["ally.run"].state).toBe("unimplemented");
    expect(ops["conversations.load"].state).toBe("unimplemented");
    expect(ops["hud.open"].state).toBe("unsupported");
    expect(ops["partner.open"].state).toBe("unsupported");
    expect(ops["providers.setKey"].state).toBe("unsupported");
    expect(ops["auth.signinPassword"].state).toBe("available");
    expect(ops["auth.status"].state).toBe("available");
    // the audit's "misleading scaffold successes" are NOT available
    expect(ops["rag.analyzeTerms"].state).toBe("unimplemented");
    expect(ops["rag.recordHighlightFeedback"].state).toBe("unimplemented");
    // not falsely desktop-only (architecture §8)
    expect(ops["context.activateContext"].state).toBe("unimplemented");
    expect(ops["context.startRehearsal"].state).toBe("unimplemented");
  });

  it("every operation has an entry in every table", () => {
    const web = webOperations();
    const desktop = desktopSnapshot(DESKTOP_CAPABILITIES, chromeWindows).operations;
    const legacy = legacySnapshot(DESKTOP_CAPABILITIES).operations;
    // Desktop: every shell command is available; the PAL-only per-source
    // capture control (start/stop/status/subscribe) is honestly unimplemented
    // because both sides start together on session.start().
    const desktopUnimplemented = new Set(["capture.start", "capture.stop", "capture.status", "capture.subscribe"]);
    for (const op of ALL_OPERATIONS) {
      expect(web[op]).toBeDefined();
      if (desktopUnimplemented.has(op)) expect(desktop[op].state).toBe("unimplemented");
      else expect(desktop[op]).toEqual({ state: "available" });
      expect(legacy[op].state).toBe("unimplemented");
    }
    expect(new Set(ALL_OPERATIONS).size).toBe(ALL_OPERATIONS.length);
  });

  it("legacy shim snapshot claims nothing — no sources, no available operations", () => {
    const s = legacySnapshot(WEB_CAPABILITIES, 7);
    expect(s.adapter).toBe("legacy");
    expect(s.revision).toBe(7);
    expect(s.sources).toEqual([]);
    expect(Object.values(s.operations).some((a) => isUsable(a))).toBe(false);
  });
});

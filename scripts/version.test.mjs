import { describe, expect, it } from "vitest";

import { msiVersion } from "./version.mjs";

// Regression cover for the bug that kept `dev-build.yml`'s Windows row red for
// all 21 of its runs: `0.4.0-beta.21` is rejected by tauri-bundler's MSI target
// ("optional pre-release identifier in app version must be numeric-only"), so
// the beta build died at the bundle step after a full release compile. The fix
// is the `bundle.windows.wix.version` override this maps out — NOT a change to
// the `-beta.N` version contract, which SDLC §3.2 fixes.
describe("msiVersion", () => {
  it("maps a -beta.N prerelease onto WiX's four numeric fields", () => {
    expect(msiVersion("0.4.0-beta.21")).toBe("0.4.0.21");
  });

  it("treats alpha and rc the same way", () => {
    expect(msiVersion("1.2.3-alpha.4")).toBe("1.2.3.4");
    expect(msiVersion("1.2.3-rc.9")).toBe("1.2.3.9");
  });

  it("returns null for a plain release, so no override is written", () => {
    expect(msiVersion("0.3.3")).toBeNull();
    expect(msiVersion("10.20.30")).toBeNull();
  });

  it("refuses a prerelease number WiX cannot hold", () => {
    expect(msiVersion("0.4.0-beta.65535")).toBe("0.4.0.65535");
    expect(() => msiVersion("0.4.0-beta.65536")).toThrow(/65535/);
  });

  it("ignores shapes the version contract does not allow", () => {
    expect(msiVersion("0.4.0-beta")).toBeNull();
    expect(msiVersion("0.4.0-nightly.1")).toBeNull();
  });
});

import { describe, expect, it } from "vitest";

import { msiVersion, patchWixVersion } from "./version.mjs";

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

// A LF-only anchor made the stamp step fail on the Windows beta build and ONLY
// there: Windows runners check out with `core.autocrlf`, so tauri.conf.json
// arrives with \r\n. Everything local and every other CI row is LF, so nothing
// caught it until dev-build run 23 died at "Stamp version". Both endings are
// covered here now.
const conf = (nl, wix = "") =>
  [
    "{",
    '  "productName": "conva",',
    '  "bundle": {',
    ...(wix ? [`    "windows": { "wix": { "version": "${wix}" } },`] : []),
    '    "active": true,',
    '    "targets": "all"',
    "  }",
    "}",
    "",
  ].join(nl);

describe.each([
  ["LF", "\n"],
  ["CRLF", "\r\n"],
])("patchWixVersion (%s line endings)", (_name, nl) => {
  it("inserts the override as the first key of bundle", () => {
    expect(patchWixVersion(conf(nl), "0.4.0.23")).toBe(conf(nl, "0.4.0.23"));
  });

  it("removes the override for a release", () => {
    expect(patchWixVersion(conf(nl, "0.4.0.23"), null)).toBe(conf(nl));
  });

  it("replaces an existing override rather than stacking a second one", () => {
    const out = patchWixVersion(conf(nl, "0.4.0.23"), "0.4.0.24");
    expect(out).toBe(conf(nl, "0.4.0.24"));
    expect(out.match(/"wix"/g)).toHaveLength(1);
  });

  it("round-trips to a byte-identical file", () => {
    expect(patchWixVersion(patchWixVersion(conf(nl), "0.4.0.23"), null)).toBe(conf(nl));
  });

  it("keeps the file parseable and does not touch the rest of it", () => {
    const out = patchWixVersion(conf(nl), "0.4.0.23");
    expect(JSON.parse(out).bundle.windows.wix.version).toBe("0.4.0.23");
    expect(JSON.parse(out).productName).toBe("conva");
    expect(out.includes("\r\n")).toBe(nl === "\r\n");
  });
});

import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The Rust version is pinned in rust-toolchain.toml, and CI installs it by
// name (dtolnay/rust-toolchain has no per-version refs). Two places that must
// agree: this fails the moment someone bumps one and forgets the other, or
// reintroduces a floating `@stable` step that would let a new release break CI.
const pinned = readFileSync("rust-toolchain.toml", "utf8").match(
  /^channel\s*=\s*"([^"]+)"/m,
)?.[1];

const workflows = readdirSync(".github/workflows")
  .filter((f) => f.endsWith(".yml"))
  .map((f) => [f, readFileSync(`.github/workflows/${f}`, "utf8")]);

describe("rust toolchain pin", () => {
  it("rust-toolchain.toml names an exact version, not a moving channel", () => {
    expect(pinned).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("no workflow floats on @stable", () => {
    for (const [file, text] of workflows) {
      expect(text, file).not.toMatch(/dtolnay\/rust-toolchain@(stable|beta|nightly)/);
    }
  });

  it("every workflow Rust step installs exactly the pinned version", () => {
    let steps = 0;
    for (const [file, text] of workflows) {
      const re = /dtolnay\/rust-toolchain@master\n\s+with:\n((?:\s+\S.*\n)+?)(?=\s*- |\s*\n|$)/g;
      for (const m of text.matchAll(re)) {
        steps += 1;
        const tc = m[1].match(/toolchain:\s*(\S+)/)?.[1];
        expect(tc, `${file}: toolchain line`).toBe(pinned);
      }
    }
    expect(steps).toBeGreaterThan(0);
  });
});

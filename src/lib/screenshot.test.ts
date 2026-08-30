import { describe, expect, it, vi } from "vitest";

import { blobToBase64, replaceSuspectColorFunctions } from "@/lib/screenshot";

describe("blobToBase64", () => {
  it("strips the data: URL prefix, leaving only the base64 payload", async () => {
    const blob = new Blob(["hello"], { type: "text/plain" });
    const b64 = await blobToBase64(blob);
    // "hello" -> base64 "aGVsbG8=", with no "data:...;base64," prefix left.
    expect(b64).toBe("aGVsbG8=");
    expect(b64.startsWith("data:")).toBe(false);
  });

  it("round-trips through atob back to the original bytes", async () => {
    const blob = new Blob(["conva screenshot"], { type: "image/png" });
    const b64 = await blobToBase64(blob);
    expect(atob(b64)).toBe("conva screenshot");
  });
});

// Regression coverage for the screenshot capture crash (owner, 2026-08-30):
// "Attempting to parse an unsupported color function 'oklab'" / "... 'color'".
// `normalize` is stubbed here — the real canvas round-trip is browser-only —
// so these tests cover the pure parsing/replacement logic: which spans get
// treated as suspect, and that everything else in the string is left alone.
describe("replaceSuspectColorFunctions", () => {
  const upper = (s: string) => s.toUpperCase();

  it("leaves a value with no suspect function untouched", () => {
    expect(replaceSuspectColorFunctions("rgb(79, 184, 255)", upper)).toBe("rgb(79, 184, 255)");
  });

  it("replaces a single color-mix() call in place", () => {
    const input = "color-mix(in oklab, #4fb8ff 50%, transparent)";
    expect(replaceSuspectColorFunctions(input, upper)).toBe(input.toUpperCase());
  });

  it("only replaces the suspect span, preserving surrounding text", () => {
    const input = "0 0 0 4px color-mix(in oklab, #4fb8ff 50%, transparent) inset";
    const result = replaceSuspectColorFunctions(input, upper);
    expect(result).toBe(
      "0 0 0 4px COLOR-MIX(IN OKLAB, #4FB8FF 50%, TRANSPARENT) inset",
    );
  });

  it("handles multiple suspect calls in one value (a multi-stop box-shadow)", () => {
    const input =
      "color-mix(in oklab, red 50%, transparent) 0 0, color-mix(in oklab, blue 50%, transparent) 1px 1px";
    const result = replaceSuspectColorFunctions(input, (s) => `<${s}>`);
    expect(result).toBe(
      "<color-mix(in oklab, red 50%, transparent)> 0 0, <color-mix(in oklab, blue 50%, transparent)> 1px 1px",
    );
  });

  it("treats a suspect function nested inside color-mix as one normalized span", () => {
    // color-mix(in oklab, oklch(...) 50%, transparent) -- the whole
    // expression is one call to a color engine (the canvas trick); it must
    // not be split into two separate replacements.
    const input = "color-mix(in oklab, oklch(70% 0.1 200) 50%, transparent)";
    const normalize = vi.fn((s: string) => "rgba(1, 2, 3, 0.5)");
    const result = replaceSuspectColorFunctions(input, normalize);
    expect(normalize).toHaveBeenCalledTimes(1);
    expect(normalize).toHaveBeenCalledWith(input);
    expect(result).toBe("rgba(1, 2, 3, 0.5)");
  });

  it("does not false-positive on plain 'color' as a property name, only the function call", () => {
    // "color:" alone (no open paren) must never match -- \b(?:...)\( requires
    // the literal "(" right after the keyword.
    expect(replaceSuspectColorFunctions("color", upper)).toBe("color");
  });

  it("returns an empty string unchanged", () => {
    expect(replaceSuspectColorFunctions("", upper)).toBe("");
  });
});

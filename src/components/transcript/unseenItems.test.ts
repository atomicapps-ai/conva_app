import { describe, expect, it } from "vitest";

import { markSeen, unseenIn } from "@/components/transcript/unseenItems";

describe("unseenIn", () => {
  it("returns ids not yet in seen", () => {
    expect(unseenIn(["a", "b", "c"], new Set(["a"]))).toEqual(["b", "c"]);
  });

  it("returns empty once everything has been seen", () => {
    expect(unseenIn(["a", "b"], new Set(["a", "b"]))).toEqual([]);
  });

  it("returns everything when nothing has been seen", () => {
    expect(unseenIn(["a", "b"], new Set())).toEqual(["a", "b"]);
  });
});

describe("markSeen", () => {
  it("adds ids to a new Set without mutating the input", () => {
    const before = new Set(["a"]);
    const after = markSeen(before, ["b", "c"]);
    expect(before).toEqual(new Set(["a"]));
    expect(after).toEqual(new Set(["a", "b", "c"]));
    expect(after).not.toBe(before);
  });

  it("is idempotent for ids already seen", () => {
    const after = markSeen(new Set(["a"]), ["a"]);
    expect(after).toEqual(new Set(["a"]));
  });

  it("returns the same Set instance when nothing is new — avoids a needless React state update on every live-transcript tick (2026-09-28 flicker fix)", () => {
    const before = new Set(["a", "b"]);
    expect(markSeen(before, [])).toBe(before);
    expect(markSeen(before, ["a"])).toBe(before);
    expect(markSeen(before, ["a", "b"])).toBe(before);
  });

  it("still allocates a new Set when at least one id is actually new", () => {
    const before = new Set(["a"]);
    const after = markSeen(before, ["a", "b"]);
    expect(after).not.toBe(before);
    expect(after).toEqual(new Set(["a", "b"]));
  });
});

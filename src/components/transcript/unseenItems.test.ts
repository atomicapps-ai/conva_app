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
});

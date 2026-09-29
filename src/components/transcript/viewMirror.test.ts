import { describe, expect, it } from "vitest";

import type { AllyFocusItem } from "@/components/transcript/allyFocus";

import {
  fromViewItem,
  sameViewState,
  toViewItem,
  toViewState,
} from "./viewMirror";

const full: AllyFocusItem = {
  id: "found:t-x",
  group: "term",
  question: "cold start",
  answer: "Provision concurrency.",
  sourceLabel: "Term",
  sourceFiles: ["brief.md"],
  status: "instant",
  cardId: "c1",
  foundId: "t-x",
  tier: "field",
  kind: "problem",
  facts: [{ label: "Who", value: "You" }],
};
const bare: AllyFocusItem = {
  id: "card:a1",
  group: "question",
  question: "Q",
  answer: "A",
  sourceLabel: "A1",
  status: "streaming",
};

describe("viewMirror", () => {
  it("round-trips a fully populated item", () => {
    expect(fromViewItem(toViewItem(full))).toEqual(full);
  });

  it("round-trips a bare item without inventing optional fields", () => {
    const back = fromViewItem(toViewItem(bare));
    expect(back).toEqual({ ...bare, sourceFiles: [] });
    expect(back).not.toHaveProperty("tier");
    expect(back).not.toHaveProperty("facts");
  });

  it("uses the wire names", () => {
    const wire = toViewItem(full);
    expect(wire.source_label).toBe("Term");
    expect(wire.card_id).toBe("c1");
    expect(wire.found_id).toBe("t-x");
  });

  it("builds and compares states", () => {
    const a = toViewState([full, bare], "card:a1", new Set(["found:t-x"]));
    expect(a.active_id).toBe("card:a1");
    expect(a.pinned_ids).toEqual(["found:t-x"]);
    expect(sameViewState(a, toViewState([full, bare], "card:a1", new Set(["found:t-x"])))).toBe(true);
    expect(sameViewState(a, toViewState([full], "found:t-x", new Set()))).toBe(false);
    expect(sameViewState(null, a)).toBe(false);
  });
});

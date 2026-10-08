import { describe, expect, it } from "vitest";

import type { AllyFocusItem } from "@/components/transcript/allyFocus";
import { itemFromLiveAssist } from "@/components/transcript/allyFocus";
import type { ViewItem } from "@/lib/ipc";
import { choiceResult, completedResult } from "@/test/liveAssistFixtures";

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

describe("viewMirror — live assist payloads", () => {
  it("carries a grid to the partner window and back unchanged", () => {
    const item = itemFromLiveAssist(completedResult());
    const wire = toViewItem(item);
    expect(wire.table?.title).toBe("Total Amount by District");
    // Through JSON, exactly as the event bridge does it.
    const back = fromViewItem(JSON.parse(JSON.stringify(wire)) as ViewItem);
    expect(back.table).toEqual(item.table);
    expect(back.answer).toBe(item.answer);
  });

  it("carries a pending choice and a superseded flag", () => {
    const choice = fromViewItem(toViewItem(itemFromLiveAssist(choiceResult())));
    expect(choice.choice?.options).toHaveLength(2);
    const stale = fromViewItem(
      toViewItem(itemFromLiveAssist({ ...completedResult(), lifecycle: "superseded" })),
    );
    expect(stale.stale).toBe(true);
  });

  it("reads an older sender's item that has none of the new fields", () => {
    const legacy = {
      id: "card:a1",
      group: "question",
      question: "Q",
      answer: "A",
      source_label: "A1",
      source_files: [],
      status: "ready",
      card_id: null,
      found_id: null,
      tier: null,
      kind: null,
      facts: [],
    } as ViewItem;
    const item = fromViewItem(legacy);
    expect(item).not.toHaveProperty("table");
    expect(item).not.toHaveProperty("choice");
    expect(item).not.toHaveProperty("stale");
  });

  it("does not add the new fields to a plain item's wire form beyond nulls", () => {
    const wire = toViewItem(bare);
    expect(wire.table).toBeNull();
    expect(wire.choice).toBeNull();
    expect(wire.stale).toBe(false);
  });
});

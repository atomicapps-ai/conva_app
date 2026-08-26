import { describe, expect, it } from "vitest";

import { orderAllyCards } from "@/components/transcript/TranscriptView";
import type { AllyCard } from "@/state/ally";

// Only the fields the ordering reads matter; the rest are inert fixtures.
function card(id: string, sourceKey?: string): AllyCard {
  return {
    id,
    seq: 0,
    kind: "question",
    text: "",
    sources: [],
    sourceKey,
  } as unknown as AllyCard;
}

function bySource(cards: AllyCard[]): Map<string, AllyCard[]> {
  const m = new Map<string, AllyCard[]>();
  for (const c of cards) {
    if (!c.sourceKey) continue;
    m.set(c.sourceKey, [...(m.get(c.sourceKey) ?? []), c]);
  }
  return m;
}

describe("orderAllyCards (Ally answers column order)", () => {
  it("orders derived cards by their source turn's position, freeform at the end", () => {
    const derived = [card("a1", "t1"), card("a2", "t3"), card("a3", "t1")];
    const freeform = [card("f1"), card("f2")];
    const out = orderAllyCards(
      ["t1", "t2", "t3"],
      bySource(derived),
      freeform,
    );
    expect(out.map((c) => c.id)).toEqual(["a1", "a3", "a2", "f1", "f2"]);
  });

  it("drops nothing when a card's source turn is unknown-free and handles empties", () => {
    expect(orderAllyCards([], new Map(), [])).toEqual([]);
    const freeform = [card("f1")];
    expect(orderAllyCards(["t1"], new Map(), freeform).map((c) => c.id)).toEqual([
      "f1",
    ]);
  });
});

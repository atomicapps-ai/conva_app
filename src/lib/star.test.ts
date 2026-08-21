import { describe, expect, it } from "vitest";

import type { AllyCard } from "@/state/ally";
import { collectStarHits } from "@/lib/star";

function card(overrides: Partial<AllyCard> = {}): AllyCard {
  return {
    id: "c1",
    seq: 1,
    kind: "question",
    question: null,
    text: "",
    done: true,
    error: null,
    sources: [],
    startedAtMs: 0,
    sourceKey: "them-1",
    sourceQuote: "Terraform state locking",
    ...overrides,
  };
}

describe("collectStarHits", () => {
  it("matches a starred card's quote found in the same turn's text", () => {
    const c = card();
    const hits = collectStarHits(
      "Walk me through Terraform state locking with a team.",
      "them-1",
      [c],
      new Set([c.id]),
    );
    expect(hits).toHaveLength(1);
    expect(hits[0]?.phrase).toBe("Terraform state locking");
    expect(hits[0]?.card.id).toBe("c1");
  });

  it("ignores a card that isn't starred", () => {
    const c = card();
    const hits = collectStarHits("Terraform state locking again", "them-1", [c], new Set());
    expect(hits).toHaveLength(0);
  });

  it("ignores a starred card from a different turn", () => {
    const c = card({ sourceKey: "them-2" });
    const hits = collectStarHits(
      "Terraform state locking again",
      "them-1",
      [c],
      new Set([c.id]),
    );
    expect(hits).toHaveLength(0);
  });

  it("ignores a starred card with no quote (a whole-turn or freeform ask)", () => {
    const c = card({ sourceQuote: null });
    const hits = collectStarHits("anything", "them-1", [c], new Set([c.id]));
    expect(hits).toHaveLength(0);
  });

  it("does not match the quote mid-word", () => {
    const c = card({ sourceQuote: "REST" });
    const hits = collectStarHits(
      "I'm interested in how you scaled the backend.",
      "them-1",
      [c],
      new Set([c.id]),
    );
    expect(hits).toHaveLength(0);
  });

  it("short-circuits when nothing is starred", () => {
    expect(collectStarHits("any text", "them-1", [card()], new Set())).toEqual([]);
  });

  it("sorts longest phrase first when two starred quotes nest", () => {
    const short = card({ id: "c-short", sourceQuote: "state" });
    const long = card({ id: "c-long", sourceQuote: "Terraform state locking" });
    const hits = collectStarHits(
      "Terraform state locking is tricky",
      "them-1",
      [short, long],
      new Set(["c-short", "c-long"]),
    );
    expect(hits[0]?.phrase).toBe("Terraform state locking");
  });
});

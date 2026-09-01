import { beforeEach, describe, expect, it } from "vitest";

import { useAllyStore } from "@/state/ally";
import type { RadarEvent } from "@/lib/ipc";

function hit(question: string, turnId = question): RadarEvent {
  return {
    turn_id: turnId,
    source_key: `inbound-${turnId}`,
    question,
    outcome: "miss",
    confidence: 0,
    bridge: { kind: "framework", text: "Start with the main point." },
    sources: [],
  };
}

describe("radarHistory", () => {
  beforeEach(() => useAllyStore.getState().clear());

  it("appends newest first", () => {
    useAllyStore.getState().applyRadar(hit("What is BM25?"));
    useAllyStore.getState().applyRadar(hit("What is RRF?"));
    expect(useAllyStore.getState().radarHistory.map((r) => r.question)).toEqual([
      "What is RRF?",
      "What is BM25?",
    ]);
  });

  it("dedupes updates for the same correlated turn", () => {
    useAllyStore.getState().applyRadar(hit("What is BM25?", "turn-1"));
    useAllyStore.getState().applyRadar(hit("What is RRF?"));
    useAllyStore.getState().applyRadar(hit("what is bm25?", "turn-1"));
    const qs = useAllyStore.getState().radarHistory.map((r) => r.question);
    expect(qs).toEqual(["what is bm25?", "What is RRF?"]);
  });

  it("retains repeated wording from different conversation turns", () => {
    useAllyStore.getState().applyRadar(hit("Can you explain that?", "turn-1"));
    useAllyStore.getState().applyRadar(hit("Can you explain that?", "turn-2"));
    expect(useAllyStore.getState().radarHistory).toHaveLength(2);
  });

  it("caps at 20", () => {
    for (let i = 0; i < 25; i++) useAllyStore.getState().applyRadar(hit(`q${i}`));
    expect(useAllyStore.getState().radarHistory).toHaveLength(20);
    expect(useAllyStore.getState().radarHistory[0]?.question).toBe("q24");
  });

  it("clear() empties the history", () => {
    useAllyStore.getState().applyRadar(hit("x"));
    useAllyStore.getState().clear();
    expect(useAllyStore.getState().radarHistory).toEqual([]);
  });
});

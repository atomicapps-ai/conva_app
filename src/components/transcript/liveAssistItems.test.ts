import { describe, expect, it } from "vitest";

import {
  buildAllyFocusItems,
  itemFromLiveAssist,
} from "@/components/transcript/allyFocus";
import type { FoundItem } from "@/components/transcript/foundGroups";
import type { RadarEvent } from "@/lib/ipc";
import {
  assistResult,
  choiceResult,
  completedResult,
} from "@/test/liveAssistFixtures";

const radarQuestion = (turnId: string): FoundItem => {
  const radar: RadarEvent = {
    turn_id: turnId,
    source_key: "inbound-4",
    question: "What's the total amount per district?",
    outcome: "miss",
    confidence: 0,
    bridge: { kind: "boundary", text: "I don't want to guess at the exact detail." },
    sources: [],
    computed: true,
  };
  return {
    id: `q-${turnId}`,
    group: "question",
    label: radar.question,
    detail: null,
    radar,
  };
};

describe("itemFromLiveAssist", () => {
  it("shows a holding response as answering, with the Say-now line", () => {
    const item = itemFromLiveAssist(assistResult());
    expect(item.status).toBe("streaming");
    expect(item.table).toBeUndefined();
    expect(item.answer).toContain("One moment");
    expect(item.answer).toContain("Adding up Amount by District");
    expect(item.resultId).toBe("la-1");
  });

  it("turns the finished result into a grid item whose answer is only the speakable line", () => {
    const item = itemFromLiveAssist(completedResult());
    expect(item.status).toBe("ready");
    expect(item.table?.rows.at(-1)?.cells[1]?.text).toBe("$439,519.85");
    expect(item.answer).toBe(
      "The total amount is $439,519.85. South is the largest at $141,875.25.",
    );
    expect(item.sourceFiles).toEqual(["Q3-district-sales.csv"]);
    expect(item.table).not.toHaveProperty("type");
  });

  it("gives a heard question the identity of its Questions row, and a typed one its own", () => {
    expect(itemFromLiveAssist(completedResult()).id).toBe("found:q-s1:them:4");
    expect(itemFromLiveAssist(completedResult()).foundId).toBe("q-s1:them:4");
    const typed = itemFromLiveAssist(choiceResult());
    expect(typed.id).toBe("assist:la-2");
    expect(typed.foundId).toBeUndefined();
  });

  it("carries a choice, a decline, a failure and a superseded result honestly", () => {
    const choice = itemFromLiveAssist(choiceResult());
    expect(choice.choice?.options.map((o) => o.label)).toEqual(["Amount", "Net amount"]);
    expect(choice.status).toBe("instant");

    const declined = itemFromLiveAssist(
      assistResult({
        lifecycle: "declined",
        say_now: "I can't total that sheet safely yet.",
        payload: { type: "text", text: "It has merged cells." },
      }),
    );
    expect(declined.status).toBe("ready");
    expect(declined.answer).toContain("I can't total that sheet safely yet.");
    expect(declined.answer).toContain("merged cells");

    expect(itemFromLiveAssist(assistResult({ lifecycle: "failed" })).status).toBe("error");
    const old = itemFromLiveAssist(
      assistResult({ lifecycle: "superseded", superseded_by: "la-9" }),
    );
    expect(old.stale).toBe(true);
  });
});

describe("buildAllyFocusItems with live assist", () => {
  it("makes the Questions row show the grid instead of the radar bridge", () => {
    const items = buildAllyFocusItems([], [radarQuestion("s1:them:4")], [completedResult()]);
    expect(items).toHaveLength(1);
    expect(items[0]!.id).toBe("found:q-s1:them:4");
    expect(items[0]!.table).toBeDefined();
    expect(items[0]!.answer).not.toContain("guess");
  });

  it("leaves ordinary radar questions alone", () => {
    const items = buildAllyFocusItems([], [radarQuestion("s1:them:9")], [completedResult()]);
    expect(items.map((i) => i.id).sort()).toEqual(["found:q-s1:them:4", "found:q-s1:them:9"]);
    const radar = items.find((i) => i.id === "found:q-s1:them:9")!;
    expect(radar.table).toBeUndefined();
    expect(radar.answer).toContain("guess");
  });

  it("orders newest results first and works with no live-assist input at all", () => {
    const older = assistResult({ result_id: "old", correlation_id: "s1:them:1" });
    const newer = assistResult({ result_id: "new", correlation_id: "s1:them:2" });
    expect(buildAllyFocusItems([], [], [older, newer]).map((i) => i.resultId)).toEqual([
      "new",
      "old",
    ]);
    expect(buildAllyFocusItems([], [])).toEqual([]);
  });
});

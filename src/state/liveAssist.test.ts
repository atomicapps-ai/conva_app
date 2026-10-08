import { beforeEach, describe, expect, it } from "vitest";

import {
  assistResult,
  completedResult,
} from "@/test/liveAssistFixtures";
import { useLiveAssistStore } from "@/state/liveAssist";

beforeEach(() => useLiveAssistStore.getState().clear());

describe("live assist store", () => {
  it("replaces a holding response with the finished result, in place", () => {
    const { apply } = useLiveAssistStore.getState();
    apply(assistResult());
    apply(completedResult());
    const { results } = useLiveAssistStore.getState();
    expect(results).toHaveLength(1);
    expect(results[0]!.lifecycle).toBe("complete");
    expect(results[0]!.revision).toBe(2);
  });

  it("never rolls a finished result back when an older revision arrives late", () => {
    const { apply } = useLiveAssistStore.getState();
    apply(completedResult());
    apply(assistResult()); // stale revision 1 delivered after revision 2
    apply(completedResult()); // an exact repeat
    const { results } = useLiveAssistStore.getState();
    expect(results).toHaveLength(1);
    expect(results[0]!.lifecycle).toBe("complete");
  });

  it("keeps separate results separate and in first-seen order", () => {
    const { apply } = useLiveAssistStore.getState();
    apply(assistResult({ result_id: "a" }));
    apply(assistResult({ result_id: "b" }));
    apply(assistResult({ result_id: "a", revision: 2, lifecycle: "complete" }));
    expect(useLiveAssistStore.getState().results.map((r) => r.result_id)).toEqual(["a", "b"]);
  });

  it("caps memory, dropping finished results before ones still working", () => {
    const { apply } = useLiveAssistStore.getState();
    apply(assistResult({ result_id: "working" })); // provisional, oldest
    for (let i = 0; i < 40; i += 1) {
      apply(assistResult({ result_id: `done-${i}`, lifecycle: "complete" }));
    }
    const ids = useLiveAssistStore.getState().results.map((r) => r.result_id);
    expect(ids.length).toBeLessThanOrEqual(30);
    expect(ids).toContain("working");
    expect(ids).toContain("done-39");
    expect(ids).not.toContain("done-0");
  });
});

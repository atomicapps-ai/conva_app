import { beforeEach, describe, expect, it } from "vitest";

import type { TranscriptSegment } from "@/lib/ipc";
import { useTranscriptStore } from "@/state/transcript";

function segment(overrides: Partial<TranscriptSegment>): TranscriptSegment {
  return {
    side: "outbound",
    seq: 0,
    text: "",
    is_final: false,
    start_ms: 0,
    end_ms: 0,
    confidence: null,
    latency_ms: 0,
    ...overrides,
  };
}

describe("lastActivityMs — the idle-auto-stop clock (lib/idleAutoStop.ts)", () => {
  beforeEach(() => {
    useTranscriptStore.setState({
      segments: [],
      archived: [],
      lastActivityMs: null,
      session: { state: "idle" },
    });
  });

  it("starts the clock when a live run begins listening", () => {
    const before = Date.now();
    useTranscriptStore
      .getState()
      .setSession({ state: "listening", session_id: "s1", started_at_unix_ms: 0 });
    expect(useTranscriptStore.getState().lastActivityMs).toBeGreaterThanOrEqual(before);
  });

  it("advances on a final, non-empty segment", () => {
    useTranscriptStore.setState({ lastActivityMs: 1 });
    useTranscriptStore
      .getState()
      .applySegment(segment({ is_final: true, text: "hello there" }));
    expect(useTranscriptStore.getState().lastActivityMs).toBeGreaterThan(1);
  });

  it("does not advance on an interim (non-final) segment", () => {
    useTranscriptStore.setState({ lastActivityMs: 1 });
    useTranscriptStore
      .getState()
      .applySegment(segment({ is_final: false, text: "hello the" }));
    expect(useTranscriptStore.getState().lastActivityMs).toBe(1);
  });

  it("does not advance on a final segment that's just whitespace", () => {
    useTranscriptStore.setState({ lastActivityMs: 1 });
    useTranscriptStore
      .getState()
      .applySegment(segment({ is_final: true, text: "   " }));
    expect(useTranscriptStore.getState().lastActivityMs).toBe(1);
  });
});

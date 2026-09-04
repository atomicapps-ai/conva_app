import { describe, expect, it } from "vitest";

import { formatTranscriptForViewer } from "@/lib/formatTranscript";
import type { TranscriptSegment } from "@/lib/ipc";

function seg(overrides: Partial<TranscriptSegment> = {}): TranscriptSegment {
  return {
    side: "inbound",
    seq: 0,
    text: "",
    is_final: true,
    start_ms: 0,
    end_ms: 0,
    confidence: null,
    latency_ms: 0,
    ...overrides,
  };
}

describe("formatTranscriptForViewer", () => {
  it("labels inbound as Them and outbound as You", () => {
    const text = formatTranscriptForViewer([
      seg({ side: "inbound", seq: 0, text: "Walk me through your last project." }),
      seg({ side: "outbound", seq: 1, text: "Sure, happy to." }),
    ]);
    expect(text).toBe("Them\nWalk me through your last project.\n\nYou\nSure, happy to.");
  });

  it("joins consecutive same-speaker segments into one paragraph, same grouping as groupTurns", () => {
    const text = formatTranscriptForViewer([
      seg({ side: "inbound", seq: 0, text: "First part." }),
      seg({ side: "inbound", seq: 1, text: "Second part." }),
    ]);
    expect(text).toBe("Them\nFirst part. Second part.");
  });

  it("drops a turn that's entirely empty/whitespace text", () => {
    const text = formatTranscriptForViewer([
      seg({ side: "inbound", seq: 0, text: "   " }),
      seg({ side: "outbound", seq: 1, text: "Real content." }),
    ]);
    expect(text).toBe("You\nReal content.");
  });

  it("returns an empty string for no segments", () => {
    expect(formatTranscriptForViewer([])).toBe("");
  });
});

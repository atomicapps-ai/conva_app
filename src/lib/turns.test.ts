import { describe, expect, it } from "vitest";

import type { TranscriptSegment } from "@/lib/ipc";
import { groupTurns, segmentKey } from "@/lib/turns";

function seg(
  over: Partial<TranscriptSegment> & { side: TranscriptSegment["side"]; seq: number },
): TranscriptSegment {
  return {
    text: "hello",
    is_final: true,
    start_ms: 0,
    end_ms: 100,
    confidence: 1,
    latency_ms: 0,
    ...over,
  };
}

describe("groupTurns — default (no voice resolver)", () => {
  it("groups consecutive same-side segments into one turn, same as before speaker-awareness", () => {
    const segs = [
      seg({ side: "inbound", seq: 1 }),
      seg({ side: "inbound", seq: 2 }),
      seg({ side: "outbound", seq: 1 }),
    ];
    const turns = groupTurns(segs);
    expect(turns).toHaveLength(2);
    expect(turns[0]?.segments).toHaveLength(2);
    expect(turns[0]?.side).toBe("inbound");
    expect(turns[1]?.side).toBe("outbound");
  });

  it("keys a turn by its first segment", () => {
    const segs = [seg({ side: "inbound", seq: 5 }), seg({ side: "inbound", seq: 6 })];
    const turns = groupTurns(segs);
    expect(turns[0]?.key).toBe(segmentKey(segs[0]!));
  });
});

describe("groupTurns — speaker-aware boundaries (doc §15 Phase B: side + voice_id)", () => {
  it("starts a new turn on every voice change, even within the same side", () => {
    const segs = [
      seg({ side: "inbound", seq: 1 }),
      seg({ side: "inbound", seq: 2 }),
      seg({ side: "inbound", seq: 3 }),
    ];
    // seq 1-2 are voice-1, seq 3 switches to voice-2 mid-side.
    const voiceIdFor = (s: TranscriptSegment) => (s.seq <= 2 ? "voice-1" : "voice-2");
    const turns = groupTurns(segs, voiceIdFor);
    expect(turns).toHaveLength(2);
    expect(turns[0]?.segments).toHaveLength(2);
    expect(turns[0]?.speakerId).toBe("voice-1");
    expect(turns[1]?.segments).toHaveLength(1);
    expect(turns[1]?.speakerId).toBe("voice-2");
  });

  it("keeps consecutive same-voice segments grouped, even across a brief pause", () => {
    const segs = [
      seg({ side: "inbound", seq: 1, end_ms: 1000 }),
      seg({ side: "inbound", seq: 2, start_ms: 5000 }),
    ];
    const turns = groupTurns(segs, () => "voice-1");
    expect(turns).toHaveLength(1);
    expect(turns[0]?.segments).toHaveLength(2);
  });

  it("a voice returning after an interruption starts a NEW turn, not a re-merge with their earlier one", () => {
    const segs = [
      seg({ side: "inbound", seq: 1 }),
      seg({ side: "outbound", seq: 1 }),
      seg({ side: "inbound", seq: 2 }),
    ];
    const turns = groupTurns(segs, () => "voice-1");
    // The (side-agnostic) resolver returns "voice-1" for every segment here,
    // yet the side change still forces a break — side and voice both have to
    // match for two turns to merge.
    expect(turns.map((t) => t.segments.length)).toEqual([1, 1, 1]);
    expect(turns.map((t) => t.speakerId)).toEqual(["voice-1", "voice-1", "voice-1"]);
    expect(turns.map((t) => t.side)).toEqual(["inbound", "outbound", "inbound"]);
  });

  it("every turn carries a speakerId, defaulting to the side when unresolved", () => {
    const turns = groupTurns([seg({ side: "outbound", seq: 1 })]);
    expect(turns[0]?.speakerId).toBe("outbound");
  });
});

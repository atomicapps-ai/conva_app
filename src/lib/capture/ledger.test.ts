import { describe, expect, it } from "vitest";

import {
  CONTRACT_SCHEMA_VERSION,
  transcriptPayloadFromLegacy,
  type ConvaEvent,
  type TranscriptPayload,
} from "@/lib/capture/contract";
import {
  EventLedger,
  SourceCursor,
  compareChronologically,
  compareEnvelopes,
  isAccepted,
} from "@/lib/capture/ledger";

function ev(
  source: string,
  epoch: number,
  seq: number,
  eventId = `${source}:${epoch}:${seq}`,
  over: Partial<ConvaEvent<TranscriptPayload>> = {},
): ConvaEvent<TranscriptPayload> {
  return {
    schema_version: CONTRACT_SCHEMA_VERSION,
    event_id: eventId,
    session_id: "s1",
    source_id: source,
    source_kind: source === "mic" ? "mic" : "display",
    channel: source === "mic" ? "self" : "remote_mix",
    epoch,
    seq,
    captured_at_ms: seq * 100,
    emitted_at_unix_ms: 1_700_000_000_000 + seq,
    payload: transcriptPayloadFromLegacy({
      side: source === "mic" ? "outbound" : "inbound",
      seq,
      text: `t${seq}`,
      is_final: false,
      start_ms: seq * 100,
      end_ms: seq * 100 + 50,
      confidence: null,
      latency_ms: 0,
    }),
    ...over,
  };
}

describe("SourceCursor — duplicate rejection", () => {
  it("accepts in-order events and rejects the same (epoch, seq) or event_id again", () => {
    const c = new SourceCursor("s1", "mic", 8);
    expect(c.offer(ev("mic", 0, 1))).toBe("accepted");
    expect(c.offer(ev("mic", 0, 2))).toBe("accepted");
    expect(c.offer(ev("mic", 0, 2, "another-id"))).toBe("duplicate");
    expect(c.offer(ev("mic", 0, 3, "mic:0:1"))).toBe("duplicate");
    expect(c.newestSeq).toBe(2);
  });
});

describe("SourceCursor — out-of-order handling", () => {
  it("flags late-but-unseen events inside the window as reordered", () => {
    const c = new SourceCursor("s1", "mic", 3);
    expect(c.offer(ev("mic", 0, 1))).toBe("accepted");
    expect(c.offer(ev("mic", 0, 5))).toBe("accepted");
    expect(c.offer(ev("mic", 0, 4))).toBe("reordered");
    expect(isAccepted("reordered")).toBe(true);
  });

  it("drops events older than the window and still dedupes inside it", () => {
    const c = new SourceCursor("s1", "mic", 3);
    c.offer(ev("mic", 0, 1));
    c.offer(ev("mic", 0, 5));
    expect(c.offer(ev("mic", 0, 0))).toBe("outside_window");
    expect(c.offer(ev("mic", 0, 4))).toBe("reordered");
    expect(c.offer(ev("mic", 0, 4, "again"))).toBe("duplicate");
  });
});

describe("SourceCursor — reconnect epochs", () => {
  it("rejects events from a stale epoch once a newer one has been seen", () => {
    const c = new SourceCursor("s1", "mic", 8);
    expect(c.offer(ev("mic", 0, 1))).toBe("accepted");
    expect(c.offer(ev("mic", 1, 1))).toBe("accepted");
    expect(c.epoch).toBe(1);
    expect(c.offer(ev("mic", 0, 2))).toBe("stale_epoch");
    // the new epoch restarts seq — seq 2 is fresh, not a duplicate
    expect(c.offer(ev("mic", 1, 2))).toBe("accepted");
  });
});

describe("SourceCursor — validation", () => {
  it("rejects wrong schema version, empty ids and other sources/sessions", () => {
    const c = new SourceCursor("s1", "mic", 8);
    expect(
      c.offer(ev("mic", 0, 1, "x", { schema_version: 2 as unknown as typeof CONTRACT_SCHEMA_VERSION })),
    ).toBe("invalid");
    expect(c.offer(ev("mic", 0, 1, ""))).toBe("invalid");
    expect(c.offer(ev("display", 0, 1))).toBe("invalid");
    expect(c.offer(ev("mic", 0, 1, "x", { session_id: "other" }))).toBe("invalid");
  });
});

describe("EventLedger — multi-source", () => {
  it("keeps one cursor per source and pins the session from the first event", () => {
    const l = new EventLedger();
    expect(l.offer(ev("mic", 0, 1)).apply).toBe(true);
    expect(l.offer(ev("display", 0, 1)).apply).toBe(true);
    expect(l.sessionId).toBe("s1");
    expect(l.offer(ev("mic", 0, 1, "dup")).acceptance).toBe("duplicate");
    expect(l.offer(ev("display", 0, 2)).acceptance).toBe("accepted");
    expect(l.offer(ev("mic", 0, 1, "x", { session_id: "s2" })).acceptance).toBe("invalid");
    expect(l.cursor("mic")?.newestSeq).toBe(1);
    expect(l.cursor("display")?.newestSeq).toBe(2);
  });

  it("rejects events for another session when pinned up front", () => {
    const l = new EventLedger("s9");
    expect(l.offer(ev("mic", 0, 1)).acceptance).toBe("invalid");
  });
});

describe("ordering helpers", () => {
  it("orders by source, epoch, seq and chronologically by captured_at", () => {
    const a = ev("mic", 0, 2);
    const b = ev("mic", 1, 1);
    const c = ev("display", 0, 1);
    expect([b, a, c].sort(compareEnvelopes).map((e) => e.event_id)).toEqual([
      "display:0:1",
      "mic:0:2",
      "mic:1:1",
    ]);
    const late = ev("display", 0, 9, "late", { captured_at_ms: 50 });
    expect([a, late].sort(compareChronologically)[0]?.event_id).toBe("late");
  });
});

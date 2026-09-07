import { describe, expect, it } from "vitest";

import {
  CONTRACT_SCHEMA_VERSION,
  transcriptPayloadFromLegacy,
  type TranscriptEvent,
  type TranscriptPayload,
} from "@/lib/capture/contract";
import { TranscriptState, correctionOf } from "@/lib/capture/transcriptState";

let seqCounter = 0;

function ev(
  segmentId: string,
  text: string,
  isFinal: boolean,
  over: Partial<TranscriptEvent> = {},
  payloadOver: Partial<TranscriptPayload> = {},
): TranscriptEvent {
  seqCounter += 1;
  const legacySeq = Number(segmentId.split("-")[1] ?? seqCounter);
  const side = segmentId.startsWith("outbound") ? "outbound" : "inbound";
  return {
    schema_version: CONTRACT_SCHEMA_VERSION,
    event_id: `e${seqCounter}`,
    session_id: "s1",
    source_id: side === "outbound" ? "mic" : "loopback",
    source_kind: side === "outbound" ? "mic" : "wasapi",
    channel: side === "outbound" ? "self" : "remote_mix",
    epoch: 0,
    seq: seqCounter,
    captured_at_ms: legacySeq * 1000,
    emitted_at_unix_ms: 1_700_000_000_000 + seqCounter,
    ...over,
    payload: {
      ...transcriptPayloadFromLegacy({
        side,
        seq: legacySeq,
        text,
        is_final: isFinal,
        start_ms: legacySeq * 1000,
        end_ms: legacySeq * 1000 + 500,
        confidence: 0.8,
        latency_ms: 20,
      }),
      ...payloadOver,
    },
  };
}

describe("TranscriptState — partial replacement and finalization", () => {
  it("replaces a partial with a later partial of the same segment", () => {
    const s = new TranscriptState();
    expect(s.apply(ev("inbound-1", "hel", false)).outcome).toBe("created");
    expect(s.apply(ev("inbound-1", "hello wor", false)).outcome).toBe("replaced_partial");
    expect(s.events()).toHaveLength(1);
    expect(s.events()[0]?.payload.text).toBe("hello wor");
    // superseded partials are not retained
    expect(s.get("inbound-1")?.history).toHaveLength(1);
  });

  it("finalizes a segment and then ignores late partials for it", () => {
    const s = new TranscriptState();
    s.apply(ev("inbound-1", "hel", false));
    expect(s.apply(ev("inbound-1", "hello world", true)).outcome).toBe("finalized");
    expect(s.get("inbound-1")?.finalized).toBe(true);
    expect(s.apply(ev("inbound-1", "hello wo", false)).outcome).toBe("late_partial_ignored");
    expect(s.finals()[0]?.payload.text).toBe("hello world");
    expect(s.toLegacySegments()).toEqual([
      {
        side: "inbound",
        seq: 1,
        text: "hello world",
        is_final: true,
        start_ms: 1000,
        end_ms: 1500,
        confidence: 0.8,
        latency_ms: 20,
      },
    ]);
  });

  it("ignores a partial whose revision is older than the current one", () => {
    const s = new TranscriptState();
    s.apply(ev("inbound-1", "a", false, {}, { revision: 2 }));
    expect(s.apply(ev("inbound-1", "b", false, {}, { revision: 1 })).outcome).toBe(
      "stale_revision",
    );
    expect(s.events()[0]?.payload.text).toBe("a");
  });
});

describe("TranscriptState — immutable finals and corrections", () => {
  it("rejects a final that tries to rewrite a final without a revision link", () => {
    const s = new TranscriptState();
    s.apply(ev("inbound-1", "hello world", true));
    // same revision → stale
    expect(s.apply(ev("inbound-1", "hello word", true)).outcome).toBe("stale_revision");
    // higher revision but no replaces link → rejected
    expect(
      s.apply(ev("inbound-1", "hello word", true, {}, { revision: 1 })).outcome,
    ).toBe("rejected_final_rewrite");
    expect(s.events()[0]?.payload.text).toBe("hello world");
  });

  it("accepts a correction as a new revision and keeps the superseded final in history", () => {
    const s = new TranscriptState();
    const final = ev("inbound-1", "their price is 40k", true);
    s.apply(final);
    const fix = correctionOf(
      final,
      { event_id: "fix-1", seq: 99, captured_at_ms: 1000, emitted_at_unix_ms: 1_700_000_009_000 },
      { text: "their price is 14k", speaker_ref: "cluster:c1", display_label: "Dana" },
    );
    expect(fix.payload.revision).toBe(1);
    expect(fix.payload.replaces_event_id).toBe(final.event_id);
    expect(s.apply(fix).outcome).toBe("corrected");
    const rec = s.get("inbound-1")!;
    expect(rec.current.payload.text).toBe("their price is 14k");
    expect(rec.current.payload.speaker_ref).toBe("cluster:c1");
    expect(rec.current.payload.display_label).toBe("Dana");
    expect(rec.history.map((h) => h.payload.text)).toEqual([
      "their price is 40k",
      "their price is 14k",
    ]);
    // the original event object was not mutated
    expect(final.payload.text).toBe("their price is 40k");
    expect(final.payload.revision).toBe(0);
  });

  it("chains corrections: each must replace the CURRENT event", () => {
    const s = new TranscriptState();
    const final = ev("inbound-1", "v0", true);
    s.apply(final);
    const fix1 = correctionOf(
      final,
      { event_id: "fix-1", seq: 50, captured_at_ms: 1000, emitted_at_unix_ms: 1 },
      { text: "v1" },
    );
    s.apply(fix1);
    // a second correction against the ORIGINAL (not current) is rejected
    const stale = correctionOf(
      final,
      { event_id: "fix-stale", seq: 51, captured_at_ms: 1000, emitted_at_unix_ms: 2 },
      { text: "vX" },
    );
    expect(s.apply(stale).outcome).toBe("stale_revision");
    const fix2 = correctionOf(
      fix1,
      { event_id: "fix-2", seq: 52, captured_at_ms: 1000, emitted_at_unix_ms: 3 },
      { text: "v2" },
    );
    expect(s.apply(fix2).outcome).toBe("corrected");
    expect(s.get("inbound-1")?.history).toHaveLength(3);
  });
});

describe("TranscriptState — ordering across channels", () => {
  it("interleaves self and remote by captured_at, not by arrival", () => {
    const s = new TranscriptState();
    s.apply(ev("inbound-3", "remote later", true));
    s.apply(ev("outbound-1", "self first", true));
    s.apply(ev("inbound-2", "remote middle", true));
    expect(s.events().map((e) => e.payload.text)).toEqual([
      "self first",
      "remote middle",
      "remote later",
    ]);
    expect(s.size()).toBe(3);
  });
});

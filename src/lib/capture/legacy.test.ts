import { describe, expect, it } from "vitest";

import { EventLedger } from "@/lib/capture/ledger";
import {
  LEGACY_CONVERSATION_SCHEMA_VERSION,
  LegacyEnvelopeAdapter,
  conversationSchemaVersion,
  conversationToEvents,
  isLegacyConversation,
  legacyEventId,
  type PersistedConversation,
} from "@/lib/capture/legacy";
import { TranscriptState } from "@/lib/capture/transcriptState";
import type { Conversation, TranscriptSegment } from "@/lib/ipc";

/** A record exactly as `conversations.rs` writes it today — no schema_version. */
const LEGACY_RECORD: Conversation = {
  id: "conv-2026-08-30-abc",
  title: "Weekly sync",
  created_at_unix_ms: 1_756_500_000_000,
  updated_at_unix_ms: 1_756_500_900_000,
  linked_docs: ["doc-1"],
  linked_context_id: null,
  segments: [
    {
      side: "outbound",
      seq: 1,
      text: "Morning — did the vendor send the revised quote?",
      is_final: true,
      start_ms: 0,
      end_ms: 2900,
      confidence: 0.94,
      latency_ms: 310,
    },
    {
      side: "inbound",
      seq: 1,
      text: "They did, it's fourteen thousand now, down from forty.",
      is_final: true,
      start_ms: 3200,
      end_ms: 6800,
      confidence: 0.91,
      latency_ms: 280,
    },
    {
      side: "outbound",
      seq: 2,
      text: "Great, let's lock it in before Friday.",
      is_final: true,
      start_ms: 7000,
      end_ms: 9100,
      confidence: null,
      latency_ms: 295,
    },
  ],
};

describe("legacy conversation records", () => {
  it("reads a record without schema_version as the legacy schema", () => {
    expect(conversationSchemaVersion(LEGACY_RECORD)).toBe(LEGACY_CONVERSATION_SCHEMA_VERSION);
    expect(isLegacyConversation(LEGACY_RECORD)).toBe(true);
    const stamped: PersistedConversation = { ...LEGACY_RECORD, schema_version: 1 };
    expect(conversationSchemaVersion(stamped)).toBe(1);
    expect(isLegacyConversation(stamped)).toBe(false);
  });

  it("projects a legacy record into envelopes without touching the record", () => {
    const snapshot = JSON.stringify(LEGACY_RECORD);
    const events = conversationToEvents(LEGACY_RECORD);
    expect(JSON.stringify(LEGACY_RECORD)).toBe(snapshot);
    expect(events).toHaveLength(3);
    expect(events.map((e) => e.channel)).toEqual(["self", "remote_mix", "self"]);
    expect(events.map((e) => e.source_kind)).toEqual(["mic", "wasapi", "mic"]);
    expect(events.map((e) => e.payload.speaker_ref)).toEqual([
      "self",
      "remote:unknown",
      "self",
    ]);
    expect(events.map((e) => e.payload.segment_id)).toEqual([
      "outbound-1",
      "inbound-1",
      "outbound-2",
    ]);
    // per-source monotonic seq, independent of the legacy per-side seq
    expect(events.map((e) => [e.source_id, e.seq])).toEqual([
      ["native-mic", 0],
      ["native-loopback", 0],
      ["native-mic", 1],
    ]);
    expect(events.every((e) => e.payload.is_final)).toBe(true);
    expect(events.every((e) => e.emitted_at_unix_ms === LEGACY_RECORD.updated_at_unix_ms)).toBe(true);
    expect(events.every((e) => e.session_id === "conversation:conv-2026-08-30-abc")).toBe(true);
  });

  it("is deterministic — the same record always yields the same event ids", () => {
    const a = conversationToEvents(LEGACY_RECORD);
    const b = conversationToEvents(LEGACY_RECORD);
    expect(a).toEqual(b);
    expect(a[0]?.event_id).toBe(
      legacyEventId("conversation:conv-2026-08-30-abc", "native-mic", 0, 0),
    );
  });

  it("loads through the ledger + reducer and reproduces the saved segments exactly", () => {
    const ledger = new EventLedger();
    const state = new TranscriptState();
    for (const e of conversationToEvents(LEGACY_RECORD)) {
      const d = ledger.offer(e);
      expect(d.apply).toBe(true);
      state.apply(e);
    }
    expect(state.toLegacySegments()).toEqual(LEGACY_RECORD.segments);
  });
});

describe("LegacyEnvelopeAdapter — live stream", () => {
  const partial = (side: TranscriptSegment["side"], seq: number, text: string, final = false) => ({
    side,
    seq,
    text,
    is_final: final,
    start_ms: seq * 1000,
    end_ms: seq * 1000 + 400,
    confidence: 0.5,
    latency_ms: 100,
  });

  it("keeps partial→final replacement working via the legacy segment_id", () => {
    let t = 0;
    const adapter = new LegacyEnvelopeAdapter({ sessionId: "live-1", now: () => ++t });
    const ledger = new EventLedger("live-1");
    const state = new TranscriptState();
    const stream = [
      partial("inbound", 1, "so the"),
      partial("inbound", 1, "so the price"),
      partial("outbound", 1, "right"),
      partial("inbound", 1, "so the price is fourteen", true),
      partial("outbound", 1, "right, fourteen", true),
    ];
    const outcomes = stream.map((s) => {
      const e = adapter.lift(s);
      expect(ledger.offer(e).apply).toBe(true);
      return state.apply(e).outcome;
    });
    expect(outcomes).toEqual([
      "created",
      "replaced_partial",
      "created",
      "finalized",
      "finalized",
    ]);
    expect(state.toLegacySegments()).toEqual([
      partial("inbound", 1, "so the price is fourteen", true),
      partial("outbound", 1, "right, fourteen", true),
    ]);
    // envelope seq is per source and monotonic even though legacy seq repeats
    expect(adapter.sourceId("inbound")).toBe("native-loopback");
    expect(adapter.channel("outbound")).toBe("self");
    expect(ledger.cursor("native-loopback")?.newestSeq).toBe(2);
    expect(ledger.cursor("native-mic")?.newestSeq).toBe(1);
  });

  it("stamps a fixed epoch and honours source-id overrides", () => {
    const adapter = new LegacyEnvelopeAdapter({
      sessionId: "s",
      epoch: 3,
      now: () => 42,
      sourceIds: { outbound: "fake-mic" },
    });
    const e = adapter.lift(partial("outbound", 1, "x"));
    expect(e.epoch).toBe(3);
    expect(e.source_id).toBe("fake-mic");
    expect(e.emitted_at_unix_ms).toBe(42);
    expect(e.event_id).toBe("s:fake-mic:3:0");
  });
});

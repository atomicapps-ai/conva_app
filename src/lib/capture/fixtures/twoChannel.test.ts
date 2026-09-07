import { describe, expect, it } from "vitest";

import { validateEnvelope } from "@/lib/capture/contract";
import {
  EXPECTED_FINALS,
  FIXTURE_SESSION_ID,
  TWO_CHANNEL_CLEAN,
  buildTwoChannelFaulty,
  buildTwoChannelStream,
} from "@/lib/capture/fixtures/twoChannel";

describe("two-channel fixture", () => {
  it("is deterministic and well-formed", () => {
    expect(buildTwoChannelStream()).toEqual(TWO_CHANNEL_CLEAN);
    expect(TWO_CHANNEL_CLEAN).toHaveLength(10);
    for (const e of TWO_CHANNEL_CLEAN) {
      expect(validateEnvelope(e)).toEqual([]);
      expect(e.session_id).toBe(FIXTURE_SESSION_ID);
    }
    expect(new Set(TWO_CHANNEL_CLEAN.map((e) => e.event_id)).size).toBe(TWO_CHANNEL_CLEAN.length);
  });

  it("has per-source monotonic seq and one epoch", () => {
    for (const source of ["fx-mic", "fx-share"]) {
      const seqs = TWO_CHANNEL_CLEAN.filter((e) => e.source_id === source).map((e) => e.seq);
      expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
      expect(new Set(seqs).size).toBe(seqs.length);
    }
    expect(new Set(TWO_CHANNEL_CLEAN.map((e) => e.epoch))).toEqual(new Set([0]));
  });

  it("carries different phrases on self vs remote_mix", () => {
    const finals = TWO_CHANNEL_CLEAN.filter((e) => e.payload.is_final);
    expect(finals.map((e) => ({ channel: e.channel, text: e.payload.text }))).toEqual(EXPECTED_FINALS);
    expect(finals.filter((e) => e.channel === "self").every((e) => e.payload.speaker_ref === "self")).toBe(true);
    expect(
      finals.filter((e) => e.channel === "remote_mix").every((e) => e.payload.speaker_ref === "remote:unknown"),
    ).toBe(true);
  });

  it("the faulty variant is deterministic and names its injected faults", () => {
    const a = buildTwoChannelFaulty();
    const b = buildTwoChannelFaulty();
    expect(a).toEqual(b);
    expect(a.events.length).toBe(TWO_CHANNEL_CLEAN.length + 3); // dup + stale + correction
    expect(a.events.filter((e) => e.event_id === a.expectRejected.duplicate)).toHaveLength(2);
    expect(a.events.find((e) => e.event_id === a.expectRejected.staleEpoch)?.epoch).toBe(0);
    expect(a.correction.payload.replaces_event_id).toBe(a.expectRejected.duplicate);
  });
});

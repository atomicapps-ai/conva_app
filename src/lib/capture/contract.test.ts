import { describe, expect, it } from "vitest";

import {
  AVAILABLE,
  CONTRACT_SCHEMA_VERSION,
  availabilityReason,
  channelForSide,
  clusterRef,
  degraded,
  enrolledRef,
  isSpeakerRef,
  isUsable,
  legacySegmentId,
  needsUserAction,
  parseSpeakerRef,
  participantRef,
  sideForChannel,
  speakerRefForSide,
  transcriptEventToLegacy,
  transcriptPayloadFromLegacy,
  transcriptPayloadToLegacy,
  unavailable,
  unimplemented,
  unsupported,
  validateEnvelope,
  type ConvaEvent,
  type TranscriptPayload,
} from "@/lib/capture/contract";
import type { TranscriptSegment } from "@/lib/ipc";

function seg(over: Partial<TranscriptSegment> = {}): TranscriptSegment {
  return {
    side: "inbound",
    seq: 7,
    text: "hello there",
    is_final: true,
    start_ms: 10,
    end_ms: 900,
    confidence: 0.9,
    latency_ms: 42,
    ...over,
  };
}

function envelope(over: Partial<ConvaEvent<TranscriptPayload>> = {}): ConvaEvent<TranscriptPayload> {
  return {
    schema_version: CONTRACT_SCHEMA_VERSION,
    event_id: "e1",
    session_id: "s1",
    source_id: "mic",
    source_kind: "mic",
    channel: "self",
    epoch: 0,
    seq: 1,
    captured_at_ms: 100,
    emitted_at_unix_ms: 1_700_000_000_000,
    payload: transcriptPayloadFromLegacy(seg({ side: "outbound", seq: 1 })),
    ...over,
  };
}

describe("legacy inbound/outbound mapping", () => {
  it("maps outbound → self and inbound → remote_mix", () => {
    expect(channelForSide("outbound")).toBe("self");
    expect(channelForSide("inbound")).toBe("remote_mix");
  });

  it("maps channels back to the two legacy sides (remote_track folds into inbound)", () => {
    expect(sideForChannel("self")).toBe("outbound");
    expect(sideForChannel("remote_mix")).toBe("inbound");
    expect(sideForChannel("remote_track")).toBe("inbound");
  });

  it("attributes legacy sides to self / remote:unknown speakers", () => {
    expect(speakerRefForSide("outbound")).toBe("self");
    expect(speakerRefForSide("inbound")).toBe("remote:unknown");
  });

  it("uses the existing `<side>-<seq>` bubble key as segment_id", () => {
    expect(legacySegmentId("inbound", 7)).toBe("inbound-7");
    expect(transcriptPayloadFromLegacy(seg()).segment_id).toBe("inbound-7");
  });

  it("round-trips a legacy segment byte-for-byte through the payload", () => {
    const original = seg();
    const payload = transcriptPayloadFromLegacy(original);
    expect(payload.revision).toBe(0);
    expect(payload.replaces_event_id).toBeNull();
    expect(payload.speaker_ref).toBe("remote:unknown");
    expect(payload.legacy).toEqual({ side: "inbound", seq: 7 });
    expect(transcriptPayloadToLegacy(payload, "remote_mix", 999)).toEqual(original);
  });

  it("derives side + seq from the envelope when no legacy ref is present", () => {
    const payload = { ...transcriptPayloadFromLegacy(seg()), legacy: null };
    const back = transcriptPayloadToLegacy(payload, "self", 12);
    expect(back.side).toBe("outbound");
    expect(back.seq).toBe(12);
    const viaEvent = transcriptEventToLegacy(envelope({ channel: "remote_track", seq: 3, payload }));
    expect(viaEvent.side).toBe("inbound");
    expect(viaEvent.seq).toBe(3);
  });
});

describe("Availability", () => {
  it("distinguishes available / degraded (usable) from the rest (not usable)", () => {
    expect(isUsable(AVAILABLE)).toBe(true);
    expect(isUsable(degraded("mic only"))).toBe(true);
    expect(isUsable(needsUserAction("grant mic"))).toBe(false);
    expect(isUsable(unavailable("bridge disconnected"))).toBe(false);
    expect(isUsable(unsupported("no OS window in a tab"))).toBe(false);
    expect(isUsable(unimplemented("hosted ASR not wired"))).toBe(false);
  });

  it("keeps unsupported and unimplemented apart — they are different answers", () => {
    const u = unsupported("Firefox has no display audio");
    const i = unimplemented("browser mic pipeline lands in M2");
    expect(u.state).toBe("unsupported");
    expect(i.state).toBe("unimplemented");
    expect(u).not.toEqual(i);
    expect(availabilityReason(u)).toBe("Firefox has no display audio");
    expect(availabilityReason(AVAILABLE)).toBeNull();
  });

  it("uses the same tagged wire shape as the Rust mirror", () => {
    expect(JSON.parse(JSON.stringify(unimplemented("todo")))).toEqual({
      state: "unimplemented",
      reason: "todo",
    });
    expect(JSON.parse(JSON.stringify(AVAILABLE))).toEqual({ state: "available" });
  });
});

describe("SpeakerRef", () => {
  it("parses every wire form", () => {
    expect(parseSpeakerRef("self")).toEqual({ kind: "self", id: null });
    expect(parseSpeakerRef("remote:unknown")).toEqual({ kind: "remote_unknown", id: null });
    expect(parseSpeakerRef(clusterRef("c1"))).toEqual({ kind: "cluster", id: "c1" });
    expect(parseSpeakerRef(participantRef("p-9"))).toEqual({ kind: "participant", id: "p-9" });
    expect(parseSpeakerRef(enrolledRef("me"))).toEqual({ kind: "enrolled", id: "me" });
  });

  it("rejects malformed refs", () => {
    expect(parseSpeakerRef("cluster:")).toBeNull();
    expect(parseSpeakerRef("nope")).toBeNull();
    expect(parseSpeakerRef("bot:1")).toBeNull();
    expect(isSpeakerRef(":x")).toBe(false);
    expect(isSpeakerRef("enrolled:x")).toBe(true);
  });
});

describe("validateEnvelope", () => {
  it("accepts a well-formed header", () => {
    expect(validateEnvelope(envelope())).toEqual([]);
  });

  it("names every offending field", () => {
    const bad = envelope({
      schema_version: 99 as unknown as typeof CONTRACT_SCHEMA_VERSION,
      event_id: "",
      source_kind: "phone" as never,
      channel: "them" as never,
      epoch: -1,
      seq: 1.5,
    });
    expect(validateEnvelope(bad)).toEqual([
      "schema_version",
      "event_id",
      "source_kind",
      "channel",
      "epoch",
      "seq",
    ]);
  });
});

import { beforeEach, describe, expect, it } from "vitest";

import {
  DEFAULT_INBOUND_SPEAKER_ID,
  YOU_SPEAKER_ID,
  defaultLabelFor,
  fixtureVoiceId,
  mergeSpeakers,
  resolveAssignment,
  resolveMergedId,
  useSpeakerStore,
} from "@/state/speakers";

describe("defaultLabelFor", () => {
  it("labels 'you' regardless of ordinal", () => {
    expect(defaultLabelFor("you", 0)).toBe("You");
  });

  it("labels the first anonymous voice 'New voice'", () => {
    expect(defaultLabelFor("anonymous", 1)).toBe("New voice");
  });

  it("labels later anonymous voices 'Voice N'", () => {
    expect(defaultLabelFor("anonymous", 2)).toBe("Voice 2");
    expect(defaultLabelFor("anonymous", 3)).toBe("Voice 3");
  });
});

describe("fixtureVoiceId — the Phase A-pending placeholder, not real recognition", () => {
  it("is constant per side (never varies within a side)", () => {
    expect(fixtureVoiceId("outbound")).toBe(YOU_SPEAKER_ID);
    expect(fixtureVoiceId("inbound")).toBe(DEFAULT_INBOUND_SPEAKER_ID);
    // Calling it again must never "discover" a second inbound voice — that
    // would misrepresent the placeholder as real diarization.
    expect(fixtureVoiceId("inbound")).toBe(DEFAULT_INBOUND_SPEAKER_ID);
  });
});

describe("resolveMergedId", () => {
  it("returns the id unchanged when it was never merged", () => {
    expect(resolveMergedId("voice-1", {})).toBe("voice-1");
  });

  it("follows a merge chain to the end", () => {
    const mergedInto = { "voice-1": "voice-2", "voice-2": "voice-3" };
    expect(resolveMergedId("voice-1", mergedInto)).toBe("voice-3");
  });

  it("does not infinite-loop on a cyclic chain", () => {
    const mergedInto = { a: "b", b: "a" };
    expect(() => resolveMergedId("a", mergedInto)).not.toThrow();
  });
});

describe("mergeSpeakers", () => {
  it("is a no-op for a self-merge", () => {
    const table = { a: "b" };
    expect(mergeSpeakers(table, "x", "x")).toBe(table);
  });

  it("records a merge", () => {
    expect(mergeSpeakers({}, "voice-1", "voice-2")).toEqual({ "voice-1": "voice-2" });
  });

  it("rewrites existing entries that pointed at the merged-away id", () => {
    const table = { "voice-1": "voice-2" };
    expect(mergeSpeakers(table, "voice-2", "voice-3")).toEqual({
      "voice-1": "voice-3",
      "voice-2": "voice-3",
    });
  });
});

describe("resolveAssignment", () => {
  it("falls back to the inferred id as 'provisional' with no override", () => {
    expect(resolveAssignment("inbound-1", "voice-unknown", {}, {})).toEqual({
      speakerId: "voice-unknown",
      status: "provisional",
    });
  });

  it("prefers an override over the inferred id", () => {
    const overrides = { "inbound-1": { speakerId: "voice-manual-1", status: "confirmed" as const } };
    expect(resolveAssignment("inbound-1", "voice-unknown", overrides, {})).toEqual({
      speakerId: "voice-manual-1",
      status: "confirmed",
    });
  });

  it("resolves the override through a merge", () => {
    const overrides = { "inbound-1": { speakerId: "voice-manual-1", status: "confirmed" as const } };
    const mergedInto = { "voice-manual-1": "voice-manual-2" };
    expect(resolveAssignment("inbound-1", "voice-unknown", overrides, mergedInto)).toEqual({
      speakerId: "voice-manual-2",
      status: "confirmed",
    });
  });

  it("preserves 'uncertain' status rather than forcing a confident identity", () => {
    const overrides = { "inbound-1": { speakerId: "voice-unknown", status: "uncertain" as const } };
    expect(resolveAssignment("inbound-1", "voice-unknown", overrides, {}).status).toBe("uncertain");
  });
});

describe("useSpeakerStore", () => {
  beforeEach(() => {
    useSpeakerStore.getState().reset();
  });

  it("ensureSpeaker creates 'you' at ordinal 0 and is idempotent", () => {
    const a = useSpeakerStore.getState().ensureSpeaker(YOU_SPEAKER_ID, "you");
    const b = useSpeakerStore.getState().ensureSpeaker(YOU_SPEAKER_ID, "you");
    expect(a).toEqual({ id: "you", kind: "you", label: "You", ordinal: 0, namedByUser: false });
    expect(b).toBe(a);
  });

  it("ensureSpeaker assigns increasing ordinals to non-'you' voices", () => {
    const first = useSpeakerStore.getState().ensureSpeaker("voice-unknown", "anonymous");
    const second = useSpeakerStore.getState().createSpeaker();
    expect(first.ordinal).toBe(1);
    expect(first.label).toBe("New voice");
    expect(second.ordinal).toBe(2);
    expect(second.label).toBe("Voice 2");
  });

  it("renameSpeaker sets a user label, flips kind to 'named', and sticks", () => {
    useSpeakerStore.getState().ensureSpeaker("voice-unknown", "anonymous");
    useSpeakerStore.getState().renameSpeaker("voice-unknown", "Alex");
    const speaker = useSpeakerStore.getState().speakers["voice-unknown"];
    expect(speaker).toMatchObject({ label: "Alex", kind: "named", namedByUser: true });
  });

  it("renameSpeaker ignores blank input and an unknown id", () => {
    useSpeakerStore.getState().ensureSpeaker("voice-unknown", "anonymous");
    useSpeakerStore.getState().renameSpeaker("voice-unknown", "   ");
    useSpeakerStore.getState().renameSpeaker("no-such-id", "Nope");
    expect(useSpeakerStore.getState().speakers["voice-unknown"]?.label).toBe("New voice");
    expect(useSpeakerStore.getState().speakers["no-such-id"]).toBeUndefined();
  });

  it("forgetSpeaker resets a named voice back to its anonymous placeholder", () => {
    useSpeakerStore.getState().ensureSpeaker("voice-unknown", "anonymous");
    useSpeakerStore.getState().renameSpeaker("voice-unknown", "Alex");
    useSpeakerStore.getState().forgetSpeaker("voice-unknown");
    expect(useSpeakerStore.getState().speakers["voice-unknown"]).toMatchObject({
      label: "New voice",
      kind: "anonymous",
      namedByUser: false,
    });
  });

  it("forgetSpeaker never touches 'you'", () => {
    useSpeakerStore.getState().ensureSpeaker(YOU_SPEAKER_ID, "you");
    useSpeakerStore.getState().forgetSpeaker(YOU_SPEAKER_ID);
    expect(useSpeakerStore.getState().speakers[YOU_SPEAKER_ID]?.label).toBe("You");
  });

  it("reassignSegment writes a 'confirmed' override the resolver picks up", () => {
    useSpeakerStore.getState().reassignSegment("inbound-3", "voice-manual-1");
    expect(useSpeakerStore.getState().resolve("inbound-3", "voice-unknown")).toEqual({
      speakerId: "voice-manual-1",
      status: "confirmed",
    });
  });

  it("mergeInto folds one voice's segments into another", () => {
    useSpeakerStore.getState().reassignSegment("inbound-1", "voice-manual-1");
    useSpeakerStore.getState().mergeInto("voice-manual-1", "voice-manual-2");
    expect(useSpeakerStore.getState().resolve("inbound-1", "voice-unknown").speakerId).toBe(
      "voice-manual-2",
    );
  });

  it("reset clears speakers, overrides, and merges (session-only identity)", () => {
    useSpeakerStore.getState().ensureSpeaker("voice-unknown", "anonymous");
    useSpeakerStore.getState().reassignSegment("inbound-1", "voice-manual-1");
    useSpeakerStore.getState().mergeInto("voice-manual-1", "voice-manual-2");
    useSpeakerStore.getState().reset();
    const s = useSpeakerStore.getState();
    expect(s.speakers).toEqual({});
    expect(s.overrides).toEqual({});
    expect(s.mergedInto).toEqual({});
  });
});

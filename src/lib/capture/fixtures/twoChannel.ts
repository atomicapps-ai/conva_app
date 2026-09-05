/**
 * Deterministic two-channel synthetic event fixture (browser architecture
 * §15 "Synthetic audio … different content in self and remote; clock drift,
 * missing/reordered chunks, reconnect epochs").
 *
 * No audio bytes — M0 tests the contract, ledger and reducer, so the fixture
 * is the ENVELOPE stream an adapter would emit for a short scripted exchange:
 * distinct phrases on `self` (mic) and `remote_mix` (shared call audio),
 * partials that settle into finals, plus a faulty variant that injects a
 * duplicate, an out-of-order event, a stale-epoch event and a correction.
 * Every id and timestamp is fixed, so replay is byte-for-byte repeatable.
 */

import {
  CONTRACT_SCHEMA_VERSION,
  SPEAKER_REMOTE_UNKNOWN,
  SPEAKER_SELF,
  type CaptureChannel,
  type CaptureSourceKind,
  type SpeakerRef,
  type TranscriptEvent,
  type TranscriptPayload,
} from "@/lib/capture/contract";
import { correctionOf } from "@/lib/capture/transcriptState";

export const FIXTURE_SESSION_ID = "fixture-two-channel";
export const FIXTURE_SOURCES = {
  self: { id: "fx-mic", kind: "mic" as CaptureSourceKind, channel: "self" as CaptureChannel },
  remote: {
    id: "fx-share",
    kind: "display" as CaptureSourceKind,
    channel: "remote_mix" as CaptureChannel,
  },
} as const;

/** Fixed wall-clock origin for `emitted_at_unix_ms`. */
export const FIXTURE_T0_UNIX_MS = 1_757_000_000_000;

interface Utterance {
  who: keyof typeof FIXTURE_SOURCES;
  /** Legacy-style utterance number on that side (drives `segment_id`). */
  n: number;
  startMs: number;
  /** Growing partials, then the final (last entry). */
  texts: string[];
}

/** The scripted exchange — different phrases per channel, interleaved. */
export const FIXTURE_SCRIPT: readonly Utterance[] = [
  {
    who: "self",
    n: 1,
    startMs: 0,
    texts: ["morning", "morning did the vendor", "Morning — did the vendor send the revised quote?"],
  },
  {
    who: "remote",
    n: 1,
    startMs: 3200,
    texts: ["they did", "they did it's fourteen", "They did, it's fourteen thousand now, down from forty."],
  },
  {
    who: "self",
    n: 2,
    startMs: 7000,
    texts: ["great let's", "Great, let's lock it in before Friday."],
  },
  {
    who: "remote",
    n: 2,
    startMs: 9400,
    texts: ["I'll send the", "I'll send the paperwork tonight."],
  },
];

/** Final text per channel, in order — what a correct replay must show. */
export const EXPECTED_FINALS: ReadonlyArray<{ channel: CaptureChannel; text: string }> = [
  { channel: "self", text: "Morning — did the vendor send the revised quote?" },
  { channel: "remote_mix", text: "They did, it's fourteen thousand now, down from forty." },
  { channel: "self", text: "Great, let's lock it in before Friday." },
  { channel: "remote_mix", text: "I'll send the paperwork tonight." },
];

function speaker(who: keyof typeof FIXTURE_SOURCES): SpeakerRef {
  return who === "self" ? SPEAKER_SELF : SPEAKER_REMOTE_UNKNOWN;
}

/**
 * Build the clean stream: per-source monotonic seq, one epoch, partials at
 * +400 ms steps, `event_id` = `<source>:<epoch>:<seq>`.
 */
export function buildTwoChannelStream(epoch = 0): TranscriptEvent[] {
  const seq: Record<string, number> = {};
  const out: TranscriptEvent[] = [];
  for (const u of FIXTURE_SCRIPT) {
    const src = FIXTURE_SOURCES[u.who];
    const side = u.who === "self" ? "outbound" : "inbound";
    u.texts.forEach((text, i) => {
      const s = seq[src.id] ?? 0;
      seq[src.id] = s + 1;
      const isFinal = i === u.texts.length - 1;
      const captured = u.startMs + i * 400;
      const payload: TranscriptPayload = {
        segment_id: `${side}-${u.n}`,
        text,
        is_final: isFinal,
        start_ms: u.startMs,
        end_ms: captured + 350,
        confidence: isFinal ? 0.92 : 0.6,
        latency_ms: 300,
        revision: i,
        replaces_event_id: i === 0 ? null : `${src.id}:${epoch}:${s - 1}`,
        speaker_ref: speaker(u.who),
        display_label: null,
        language: "en",
        provider: "fixture",
        legacy: { side, seq: u.n },
      };
      out.push({
        schema_version: CONTRACT_SCHEMA_VERSION,
        event_id: `${src.id}:${epoch}:${s}`,
        session_id: FIXTURE_SESSION_ID,
        source_id: src.id,
        source_kind: src.kind,
        channel: src.channel,
        epoch,
        seq: s,
        captured_at_ms: captured,
        emitted_at_unix_ms: FIXTURE_T0_UNIX_MS + captured + 300,
        payload,
      });
    });
  }
  // Interleave by arrival = captured time (stable), like a real gateway.
  return out.sort((a, b) => a.captured_at_ms - b.captured_at_ms || (a.source_id < b.source_id ? -1 : 1));
}

/** The clean two-channel stream (10 events: 3+3+2+2 partials/finals). */
export const TWO_CHANNEL_CLEAN: readonly TranscriptEvent[] = buildTwoChannelStream();

export interface FaultyStream {
  events: TranscriptEvent[];
  /** Ids the ledger must reject, keyed by why. */
  expectRejected: { duplicate: string; staleEpoch: string };
  /** Id the ledger must accept as `reordered`. */
  expectReordered: string;
  /** The correction event (accepted; supersedes a final). */
  correction: TranscriptEvent;
}

/**
 * The same exchange with transport faults injected:
 * - the remote first final is delivered TWICE (same event id);
 * - the two self partials of utterance 2 arrive swapped (seq 3 before 2);
 * - a leftover event from the previous epoch of the remote source shows
 *   up after epoch 1 has started;
 * - a correction fixes "fourteen thousand" → "fourteen thousand five hundred"
 *   as revision N+1 linked to the final it replaces.
 * The remote source runs at epoch 1 (it "reconnected" before the session).
 */
export function buildTwoChannelFaulty(): FaultyStream {
  const selfStream = buildTwoChannelStream(0).filter((e) => e.source_id === FIXTURE_SOURCES.self.id);
  const remoteStream = buildTwoChannelStream(1).filter(
    (e) => e.source_id === FIXTURE_SOURCES.remote.id,
  );
  const all = [...selfStream, ...remoteStream].sort(
    (a, b) => a.captured_at_ms - b.captured_at_ms || (a.source_id < b.source_id ? -1 : 1),
  );

  const remoteFinal1 = remoteStream.find((e) => e.payload.segment_id === "inbound-1" && e.payload.is_final)!;
  const selfU2 = selfStream.filter((e) => e.payload.segment_id === "outbound-2");
  const [selfU2Partial, selfU2Final] = [selfU2[0]!, selfU2[1]!];

  // Stale: an epoch-0 remote event (id from the old epoch).
  const stale: TranscriptEvent = {
    ...remoteFinal1,
    epoch: 0,
    seq: 0,
    event_id: `${FIXTURE_SOURCES.remote.id}:0:0`,
    payload: { ...remoteFinal1.payload, text: "ghost from the old connection" },
  };

  const correction = correctionOf(
    remoteFinal1,
    {
      event_id: `${FIXTURE_SOURCES.remote.id}:1:corr-1`,
      seq: remoteStream.length, // next seq on that source
      captured_at_ms: remoteFinal1.captured_at_ms,
      emitted_at_unix_ms: FIXTURE_T0_UNIX_MS + 20_000,
    },
    { text: "They did, it's fourteen thousand five hundred now, down from forty." },
  );

  const events: TranscriptEvent[] = [];
  for (const e of all) {
    if (e === selfU2Partial) continue; // delivered late, below
    events.push(e);
    if (e === remoteFinal1) events.push({ ...remoteFinal1 }); // duplicate
    if (e === selfU2Final) events.push(selfU2Partial); // out of order
  }
  events.push(stale);
  events.push(correction);

  return {
    events,
    expectRejected: { duplicate: remoteFinal1.event_id, staleEpoch: stale.event_id },
    expectReordered: selfU2Partial.event_id,
    correction,
  };
}

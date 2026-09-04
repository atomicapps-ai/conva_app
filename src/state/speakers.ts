import { create } from "zustand";

/**
 * Session-local speaker identity model — the UI-side half of speaker-aware
 * conversations (see
 * `conva_core/docs/technical/speaker-aware-conversations.md`, §9 for the
 * eventual Rust domain model this mirrors in spirit: `SpeakerAssignment` /
 * `VoiceProfile`, `voice_id`, `AssignmentStatus`).
 *
 * Phase A (the model spike) hasn't run yet — there is no real diarization or
 * embedding pipeline behind this. `fixtureVoiceId` below assigns every
 * inbound segment to ONE placeholder anonymous voice rather than pretending
 * to tell speakers apart automatically. What IS real: naming a voice,
 * correcting a wrongly-grouped turn to a different (or brand new) voice, and
 * merging two session voices that turned out to be the same person — all
 * user-driven, all useful regardless of what the backend can detect on its
 * own, so they're implemented for real here rather than stubbed.
 *
 * Session-only identity is the default (owner decision, doc §13): `reset()`
 * clears everything, and nothing here is ever written to disk. Naming a
 * voice never verifies or authenticates anyone — it is a local label a user
 * assigns, never a claim about real-world identity (doc §1, §7).
 */

export type SpeakerKind = "you" | "anonymous" | "named";

/** Mirrors the eventual Rust `AssignmentStatus` (doc §9) exactly —
 *  "provisional" (today's placeholder, or later an unconfirmed model guess),
 *  "confirmed" (the user directly named/reassigned/merged it), "uncertain"
 *  (overlap or insufficient speech — doc §1: "show no identity claim"). */
export type AssignmentStatus = "provisional" | "confirmed" | "uncertain";

export interface SpeakerProfile {
  /** Stable id for this voice WITHIN this session only (the future
   *  `voice_id`) — never a durable cross-conversation identity. */
  id: string;
  kind: SpeakerKind;
  /** User-facing, user-editable display label — "You", "New voice",
   *  "Voice 2", or a name the user typed in. */
  label: string;
  /** Ordinal among non-"you" voices introduced this session, in
   *  introduction order — drives the default "Voice N" label. "you" is
   *  always ordinal 0. */
  ordinal: number;
  /** True once the user has explicitly named this voice at least once this
   *  session — cleared by `forgetSpeaker` (doc §6.4's "Forget" action). */
  namedByUser: boolean;
}

export interface SpeakerAssignment {
  speakerId: string;
  status: AssignmentStatus;
}

/** Per-segment overrides layered on top of the inferred assignment — both
 *  "correct this turn" and "different voice from here" (doc §6.4) work by
 *  writing an override keyed by the segment's stable `turns.ts`
 *  `segmentKey`. */
export type SpeakerAssignmentOverrides = Record<string, SpeakerAssignment>;

export const YOU_SPEAKER_ID = "you";
/** The single inbound bucket used until real diarization exists (Phase A+).
 *  Deliberately ONE id for every inbound segment — see the file doc comment
 *  on why this must never vary per segment today. */
export const DEFAULT_INBOUND_SPEAKER_ID = "voice-unknown";

export function defaultLabelFor(kind: SpeakerKind, ordinal: number): string {
  if (kind === "you") return "You";
  return ordinal <= 1 ? "New voice" : `Voice ${ordinal}`;
}

export function makeSpeaker(id: string, kind: SpeakerKind, ordinal: number): SpeakerProfile {
  return { id, kind, label: defaultLabelFor(kind, ordinal), ordinal, namedByUser: false };
}

/** Pure: today's placeholder inference (see file doc comment). Every
 *  outbound segment is "you"; every inbound segment falls into the single
 *  unknown bucket. This function must stay constant per side — any future
 *  real diarization signal is a DIFFERENT function (Phase A+), never a tweak
 *  to this one, so it stays honest about being a placeholder. */
export function fixtureVoiceId(side: "inbound" | "outbound"): string {
  return side === "outbound" ? YOU_SPEAKER_ID : DEFAULT_INBOUND_SPEAKER_ID;
}

/** Follow a chain of merges to the live (non-merged-away) speaker id. Guards
 *  against a cycle so a bad merge chain can't infinite-loop the UI. */
export function resolveMergedId(id: string, mergedInto: Record<string, string>): string {
  let current = id;
  const seen = new Set<string>();
  let next = mergedInto[current];
  while (next && !seen.has(current)) {
    seen.add(current);
    current = next;
    next = mergedInto[current];
  }
  return current;
}

/** Resolve one segment's final (speakerId, status), given: the inferred
 *  placeholder assignment, any per-segment override (correction/split), and
 *  the merge table. Pure and cheap — safe to call on every render, which is
 *  what lets a revision regroup bubbles just by re-rendering (today, only
 *  from a user action; from Phase A/B on, also from an async worker). */
export function resolveAssignment(
  segmentKey: string,
  inferredSpeakerId: string,
  overrides: SpeakerAssignmentOverrides,
  mergedInto: Record<string, string>,
): SpeakerAssignment {
  const base: SpeakerAssignment = overrides[segmentKey] ?? {
    speakerId: inferredSpeakerId,
    status: "provisional",
  };
  return { speakerId: resolveMergedId(base.speakerId, mergedInto), status: base.status };
}

/** Merge `fromId` into `intoId` — pure, returns a new merge table. A
 *  self-merge is a no-op. Rewrites any existing chain that pointed at
 *  `fromId` so `resolveMergedId` never needs more than the one extra hop it
 *  already walks. */
export function mergeSpeakers(
  mergedInto: Record<string, string>,
  fromId: string,
  intoId: string,
): Record<string, string> {
  if (fromId === intoId) return mergedInto;
  const next: Record<string, string> = { ...mergedInto, [fromId]: intoId };
  for (const [k, v] of Object.entries(next)) {
    if (v === fromId) next[k] = intoId;
  }
  return next;
}

interface SpeakerState {
  speakers: Record<string, SpeakerProfile>;
  overrides: SpeakerAssignmentOverrides;
  mergedInto: Record<string, string>;
  nextOrdinal: number;
  nextManualSeq: number;
  /** Get-or-create a speaker profile for `id`. Safe to call on every render
   *  for the same id — a no-op once the profile exists. */
  ensureSpeaker: (id: string, kind: SpeakerKind) => SpeakerProfile;
  /** Create a brand-new session voice (used by "Different voice from here")
   *  and return its profile. */
  createSpeaker: () => SpeakerProfile;
  /** Doc §6.4's Save action — sets a user-chosen name. Flips kind to
   *  "named"; blank input is ignored (Cancel is the way to back out). */
  renameSpeaker: (id: string, label: string) => void;
  /** Doc §6.4's "Forget" — clears a named voice back to its anonymous
   *  placeholder label. No persistent profile exists yet to delete; once
   *  one does (Phase C), this is also where that delete belongs. */
  forgetSpeaker: (id: string) => void;
  /** Correct or split: point one segment at a different (existing or new)
   *  speaker id, "confirmed" because a direct user action made the call. */
  reassignSegment: (
    segmentKey: string,
    targetSpeakerId: string,
    status?: AssignmentStatus,
  ) => void;
  /** Doc §6.4's "Merge with…" — two session voices turned out to be the
   *  same person. */
  mergeInto: (fromId: string, intoId: string) => void;
  resolve: (segmentKey: string, inferredSpeakerId: string) => SpeakerAssignment;
  /** Clear all session-local speaker state — call at the start of a new
   *  listening session/conversation (identity is session-scoped by
   *  default, doc §13). */
  reset: () => void;
}

export const useSpeakerStore = create<SpeakerState>((set, get) => ({
  speakers: {},
  overrides: {},
  mergedInto: {},
  nextOrdinal: 1,
  nextManualSeq: 1,

  ensureSpeaker: (id, kind) => {
    const existing = get().speakers[id];
    if (existing) return existing;
    const ordinal = kind === "you" ? 0 : get().nextOrdinal;
    const speaker = makeSpeaker(id, kind, ordinal);
    set((s) => ({
      speakers: { ...s.speakers, [id]: speaker },
      nextOrdinal: kind === "you" ? s.nextOrdinal : s.nextOrdinal + 1,
    }));
    return speaker;
  },

  createSpeaker: () => {
    const seq = get().nextManualSeq;
    set((s) => ({ nextManualSeq: s.nextManualSeq + 1 }));
    return get().ensureSpeaker(`voice-manual-${seq}`, "anonymous");
  },

  renameSpeaker: (id, label) =>
    set((s) => {
      const speaker = s.speakers[id];
      const trimmed = label.trim();
      if (!speaker || !trimmed) return s;
      return {
        speakers: {
          ...s.speakers,
          [id]: { ...speaker, label: trimmed, kind: "named", namedByUser: true },
        },
      };
    }),

  forgetSpeaker: (id) =>
    set((s) => {
      const speaker = s.speakers[id];
      if (!speaker || speaker.kind === "you") return s;
      return {
        speakers: {
          ...s.speakers,
          [id]: {
            ...speaker,
            kind: "anonymous",
            label: defaultLabelFor("anonymous", speaker.ordinal),
            namedByUser: false,
          },
        },
      };
    }),

  reassignSegment: (segmentKey, targetSpeakerId, status = "confirmed") =>
    set((s) => ({
      overrides: { ...s.overrides, [segmentKey]: { speakerId: targetSpeakerId, status } },
    })),

  mergeInto: (fromId, intoId) =>
    set((s) => ({ mergedInto: mergeSpeakers(s.mergedInto, fromId, intoId) })),

  resolve: (segmentKey, inferredSpeakerId) => {
    const s = get();
    return resolveAssignment(segmentKey, inferredSpeakerId, s.overrides, s.mergedInto);
  },

  reset: () => set({ speakers: {}, overrides: {}, mergedInto: {}, nextOrdinal: 1, nextManualSeq: 1 }),
}));

import type { TranscriptSegment } from "@/lib/ipc";

/** Stable identity for a transcript bubble/turn — also the Ally-card link
 *  key (`cardsBySource`, TranscriptView) and the scroll target for
 *  Conversations' search-result jumps (`state/transcriptJump.ts`). Keyed by
 *  the turn's first segment (side + seq) so it doesn't shift as later
 *  segments in the same turn stream in. */
export function segmentKey(seg: TranscriptSegment): string {
  return `${seg.side}-${seg.seq}`;
}

export interface Turn {
  side: TranscriptSegment["side"];
  key: string;
  segments: TranscriptSegment[];
  /** The voice id every segment in this turn shares (speaker-aware
   *  conversations, doc §15 Phase B: "update turn grouping to
   *  `side + voice_id`"). Defaults to one id per side (`defaultVoiceId`
   *  below) when the caller doesn't supply a resolver, so every existing
   *  caller's grouping stays byte-for-byte unchanged. */
  speakerId: string;
}

/** Pre speaker-aware-conversations default: one constant id per side, so
 *  grouping-by-speaker degrades exactly to the old grouping-by-side when no
 *  resolver is supplied. */
function defaultVoiceId(seg: TranscriptSegment): string {
  return seg.side;
}

/**
 * Consolidate consecutive same-speaker segments into turns (bubbles) — a new
 * turn starts when the speaker changes (which includes every side change,
 * since side and voice are never shared across sides), never merely on a
 * pause/time split (doc §6.3). Single source of truth for TranscriptView's
 * rendering AND Conversations' search: a search match has to resolve to the
 * SAME turn key TranscriptView would render, or the jump-to-result scroll
 * silently finds nothing.
 *
 * `voiceIdFor` resolves each segment's voice (session-local identity, post
 * overrides/merges — see `state/speakers.ts`). Omit it to get the original
 * side-only grouping.
 */
export function groupTurns(
  segments: TranscriptSegment[],
  voiceIdFor: (seg: TranscriptSegment) => string = defaultVoiceId,
): Turn[] {
  const out: Turn[] = [];
  for (const seg of segments) {
    const speakerId = voiceIdFor(seg);
    const last = out[out.length - 1];
    if (last && last.side === seg.side && last.speakerId === speakerId) {
      last.segments.push(seg);
    } else {
      out.push({ side: seg.side, key: segmentKey(seg), speakerId, segments: [seg] });
    }
  }
  return out;
}

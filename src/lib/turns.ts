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
}

/**
 * Consolidate consecutive same-speaker segments into turns (bubbles) — a new
 * turn starts only when the speaker switches, never on a pause/time split.
 * Single source of truth for TranscriptView's rendering AND Conversations'
 * search: a search match has to resolve to the SAME turn key TranscriptView
 * would render, or the jump-to-result scroll silently finds nothing.
 */
export function groupTurns(segments: TranscriptSegment[]): Turn[] {
  const out: Turn[] = [];
  for (const seg of segments) {
    const last = out[out.length - 1];
    if (last && last.side === seg.side) last.segments.push(seg);
    else out.push({ side: seg.side, key: segmentKey(seg), segments: [seg] });
  }
  return out;
}

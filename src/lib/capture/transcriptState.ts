/**
 * Transcript revision reducer — turns accepted {@link TranscriptEvent}s into
 * the current set of segments (browser architecture §6 "Event envelope"):
 *
 * - a partial may REPLACE an earlier partial of the same `segment_id`;
 * - a final FINALIZES the segment (replaces whatever partial was showing);
 * - a final never silently rewrites another final — a later final for an
 *   already-final segment is only accepted as a CORRECTION when it carries a
 *   higher `revision` and names the event it `replaces_event_id`; the
 *   superseded final stays in the immutable revision history.
 *
 * Ordering/dedupe is the {@link EventLedger}'s job; feed it first, then apply
 * accepted events here. Pure — no React, no Tauri.
 */

import {
  transcriptPayloadToLegacy,
  type ConvaEvent,
  type TranscriptEvent,
  type TranscriptPayload,
} from "@/lib/capture/contract";
import { compareChronologically } from "@/lib/capture/ledger";
import type { TranscriptSegment } from "@/lib/ipc";

/** One segment's current state plus its immutable history. */
export interface SegmentRecord {
  segment_id: string;
  /** The event currently representing this segment. */
  current: TranscriptEvent;
  /** Every accepted event for this segment, oldest first (partials included
   *  until the final lands; finals + corrections are kept forever). */
  history: TranscriptEvent[];
  /** True once a final has been accepted. */
  finalized: boolean;
}

export type ApplyOutcome =
  /** First event for this segment. */
  | "created"
  /** A partial replaced an earlier partial. */
  | "replaced_partial"
  /** A final settled the segment. */
  | "finalized"
  /** A higher-revision final replaced an earlier final (history kept). */
  | "corrected"
  /** A partial arrived after the segment was final — ignored. */
  | "late_partial_ignored"
  /** A final for a final segment without a proper revision/replaces link. */
  | "rejected_final_rewrite"
  /** Revision lower than or equal to the current one — ignored. */
  | "stale_revision";

export interface ApplyResult {
  outcome: ApplyOutcome;
  record: SegmentRecord | null;
}

export class TranscriptState {
  private segments = new Map<string, SegmentRecord>();

  /** Apply one already-accepted event. */
  apply(event: TranscriptEvent): ApplyResult {
    const id = event.payload.segment_id;
    const existing = this.segments.get(id);

    if (!existing) {
      const record: SegmentRecord = {
        segment_id: id,
        current: event,
        history: [event],
        finalized: event.payload.is_final,
      };
      this.segments.set(id, record);
      return { outcome: "created", record };
    }

    const cur = existing.current.payload;
    const next = event.payload;

    if (!existing.finalized) {
      // Partials replace partials; a final settles. Both need a fresh
      // revision (>= is fine for a legacy stream that repeats revision 0
      // while mutating text — those are ordered by the ledger already).
      if (next.revision < cur.revision) {
        return { outcome: "stale_revision", record: existing };
      }
      // Partials are transient: drop the superseded one from history so
      // memory stays bounded; the final and any corrections are kept.
      existing.history = existing.history.filter((h) => h.payload.is_final);
      existing.history.push(event);
      existing.current = event;
      existing.finalized = next.is_final;
      return {
        outcome: next.is_final ? "finalized" : "replaced_partial",
        record: existing,
      };
    }

    // Already final.
    if (!next.is_final) {
      return { outcome: "late_partial_ignored", record: existing };
    }
    if (next.revision <= cur.revision) {
      return { outcome: "stale_revision", record: existing };
    }
    if (next.replaces_event_id !== existing.current.event_id) {
      return { outcome: "rejected_final_rewrite", record: existing };
    }
    existing.history.push(event);
    existing.current = event;
    return { outcome: "corrected", record: existing };
  }

  get(segmentId: string): SegmentRecord | undefined {
    return this.segments.get(segmentId);
  }

  /** Current events, chronological (captured_at, then source/epoch/seq). */
  events(): TranscriptEvent[] {
    return [...this.segments.values()]
      .map((r) => r.current)
      .sort(compareChronologically);
  }

  /** Current finals only, chronological. */
  finals(): TranscriptEvent[] {
    return this.events().filter((e) => e.payload.is_final);
  }

  /** Legacy projection — what today's `TranscriptSegment[]` consumers read. */
  toLegacySegments(): TranscriptSegment[] {
    return this.events().map((e) => transcriptPayloadToLegacy(e.payload, e.channel, e.seq));
  }

  size(): number {
    return this.segments.size;
  }
}

/**
 * Build a correction of a final `event`: same segment, next revision, linked
 * to the event it replaces. Header fields (epoch/seq/event_id/timestamps) are
 * the caller's — a correction is a NEW envelope on the wire.
 */
export function correctionOf(
  event: TranscriptEvent,
  header: Pick<
    ConvaEvent<unknown>,
    "event_id" | "seq" | "captured_at_ms" | "emitted_at_unix_ms"
  > &
    Partial<Pick<ConvaEvent<unknown>, "epoch">>,
  patch: Partial<Pick<TranscriptPayload, "text" | "speaker_ref" | "display_label" | "confidence">>,
): TranscriptEvent {
  return {
    ...event,
    ...header,
    epoch: header.epoch ?? event.epoch,
    payload: {
      ...event.payload,
      ...patch,
      is_final: true,
      revision: event.payload.revision + 1,
      replaces_event_id: event.event_id,
    },
  };
}

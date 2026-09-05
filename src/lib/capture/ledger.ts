/**
 * Event ledger — ordering + de-duplication for {@link ConvaEvent} envelopes
 * (browser architecture §6 "reducers discard stale epochs and de-duplicate by
 * `(session_id, source_id, epoch, seq, event_id)`", §12 bounded acceptance).
 *
 * Mirror of `SourceCursor` in `crates/conva-core/src/capture_contract.rs`.
 * Pure — no React, no Tauri, no timers.
 */

import {
  CONTRACT_SCHEMA_VERSION,
  validateEnvelope,
  type ConvaEvent,
} from "@/lib/capture/contract";

/** How an offered envelope was classified. */
export type Acceptance =
  /** Next in sequence (or first for a new epoch). */
  | "accepted"
  /** Earlier than the newest seen seq but unseen and inside the window —
   *  callers insert by `seq`. */
  | "reordered"
  /** Same `(epoch, seq)` or same `event_id` already accepted. */
  | "duplicate"
  /** Belongs to an epoch older than the newest one seen for this source. */
  | "stale_epoch"
  /** Older than `newest_seq - window`; too late to insert. */
  | "outside_window"
  /** Malformed header, or addressed to another session/source. */
  | "invalid";

export const ACCEPTED_OUTCOMES: ReadonlySet<Acceptance> = new Set<Acceptance>([
  "accepted",
  "reordered",
]);

export function isAccepted(a: Acceptance): boolean {
  return ACCEPTED_OUTCOMES.has(a);
}

/** Default reorder window (in sequence numbers) when none is given. */
export const DEFAULT_REORDER_WINDOW = 64;

/**
 * Per-`(session_id, source_id)` acceptance state: the newest epoch, the seen
 * seqs inside a bounded window, and every accepted event id.
 */
export class SourceCursor {
  private epochValue: number | null = null;
  private newest: number | null = null;
  private seenSeq = new Set<number>();
  private seenIds = new Set<string>();

  constructor(
    readonly sessionId: string,
    readonly sourceId: string,
    readonly window: number = DEFAULT_REORDER_WINDOW,
  ) {}

  get epoch(): number | null {
    return this.epochValue;
  }

  get newestSeq(): number | null {
    return this.newest;
  }

  /** Decide whether `event` may be applied, recording it when it may. */
  offer(event: ConvaEvent<unknown>): Acceptance {
    if (
      event.schema_version !== CONTRACT_SCHEMA_VERSION ||
      validateEnvelope(event).length > 0 ||
      event.session_id !== this.sessionId ||
      event.source_id !== this.sourceId
    ) {
      return "invalid";
    }
    if (this.seenIds.has(event.event_id)) return "duplicate";

    if (this.epochValue === null) {
      this.epochValue = event.epoch;
    } else if (event.epoch < this.epochValue) {
      return "stale_epoch";
    } else if (event.epoch > this.epochValue) {
      // A reconnect: everything from the old epoch is finalized.
      this.epochValue = event.epoch;
      this.newest = null;
      this.seenSeq = new Set();
    }

    if (this.seenSeq.has(event.seq)) return "duplicate";

    let outcome: Acceptance = "accepted";
    if (this.newest !== null && event.seq < this.newest) {
      if (this.newest - event.seq > this.window) return "outside_window";
      outcome = "reordered";
    }

    this.seenSeq.add(event.seq);
    this.seenIds.add(event.event_id);
    this.newest = this.newest === null ? event.seq : Math.max(this.newest, event.seq);
    const floor = this.newest - this.window;
    if (floor > 0) {
      for (const s of this.seenSeq) if (s < floor) this.seenSeq.delete(s);
    }
    return outcome;
  }
}

/** Outcome of offering one envelope to an {@link EventLedger}. */
export interface LedgerDecision {
  acceptance: Acceptance;
  /** Convenience: `acceptance` is `accepted` or `reordered`. */
  apply: boolean;
}

/**
 * One cursor per `(session_id, source_id)`. Events for an unknown session
 * are rejected as `invalid` unless the ledger was created open (no session
 * pin), in which case the first event's session becomes the pin.
 */
export class EventLedger {
  private cursors = new Map<string, SourceCursor>();
  private sessionPin: string | null;

  constructor(
    sessionId: string | null = null,
    readonly window: number = DEFAULT_REORDER_WINDOW,
  ) {
    this.sessionPin = sessionId;
  }

  get sessionId(): string | null {
    return this.sessionPin;
  }

  /** The cursor for a source, if any events were offered for it. */
  cursor(sourceId: string): SourceCursor | undefined {
    return this.cursors.get(sourceId);
  }

  offer(event: ConvaEvent<unknown>): LedgerDecision {
    if (validateEnvelope(event).length > 0) {
      return { acceptance: "invalid", apply: false };
    }
    if (this.sessionPin === null) this.sessionPin = event.session_id;
    if (event.session_id !== this.sessionPin) {
      return { acceptance: "invalid", apply: false };
    }
    let cursor = this.cursors.get(event.source_id);
    if (!cursor) {
      cursor = new SourceCursor(this.sessionPin, event.source_id, this.window);
      this.cursors.set(event.source_id, cursor);
    }
    const acceptance = cursor.offer(event);
    return { acceptance, apply: isAccepted(acceptance) };
  }
}

/**
 * Deterministic total order for accepted envelopes: by source, then epoch,
 * then seq (the reducer's insertion order for `reordered` events).
 */
export function compareEnvelopes(a: ConvaEvent<unknown>, b: ConvaEvent<unknown>): number {
  if (a.source_id !== b.source_id) return a.source_id < b.source_id ? -1 : 1;
  if (a.epoch !== b.epoch) return a.epoch - b.epoch;
  return a.seq - b.seq;
}

/** Chronological order across sources — what the UI shows. Ties fall back to
 *  {@link compareEnvelopes} so the result is deterministic. */
export function compareChronologically(
  a: ConvaEvent<unknown>,
  b: ConvaEvent<unknown>,
): number {
  if (a.captured_at_ms !== b.captured_at_ms) return a.captured_at_ms - b.captured_at_ms;
  return compareEnvelopes(a, b);
}

/**
 * Legacy bridge — lifts today's two-side `TranscriptSegment` stream and the
 * persisted `Conversation` records into versioned {@link ConvaEvent}
 * envelopes, deterministically (browser architecture §6: "outbound maps to
 * self; inbound maps to remote mix. Persist both schema version and original
 * value during transition. Existing conversation records remain readable").
 *
 * Nothing here mutates or re-shapes a stored record: a legacy conversation is
 * read exactly as saved and projected on the fly. Pure — no React, no Tauri.
 */

import {
  CONTRACT_SCHEMA_VERSION,
  channelForSide,
  transcriptPayloadFromLegacy,
  type CaptureChannel,
  type CaptureSourceKind,
  type TranscriptEvent,
} from "@/lib/capture/contract";
import type { Conversation, StreamSide, TranscriptSegment } from "@/lib/ipc";

/** Persisted conversations written before the envelope contract carry no
 *  `schema_version`; they read as this. */
export const LEGACY_CONVERSATION_SCHEMA_VERSION = 0;

/**
 * A stored conversation as it may appear on disk. Today's records have no
 * `schema_version` (→ {@link LEGACY_CONVERSATION_SCHEMA_VERSION}); a future
 * writer may stamp one. Additive: the `Conversation` type itself is untouched.
 */
export type PersistedConversation = Conversation & { schema_version?: number };

export function conversationSchemaVersion(c: PersistedConversation): number {
  return typeof c.schema_version === "number" ? c.schema_version : LEGACY_CONVERSATION_SCHEMA_VERSION;
}

export function isLegacyConversation(c: PersistedConversation): boolean {
  return conversationSchemaVersion(c) === LEGACY_CONVERSATION_SCHEMA_VERSION;
}

/** The desktop shell's two capture sources, by legacy side. */
export const LEGACY_SOURCE_ID: Record<StreamSide, string> = {
  outbound: "native-mic",
  inbound: "native-loopback",
};

export const LEGACY_SOURCE_KIND: Record<StreamSide, CaptureSourceKind> = {
  outbound: "mic",
  inbound: "wasapi",
};

export interface LegacyAdapterOptions {
  /** Session the envelopes belong to. */
  sessionId: string;
  /** Reconnect epoch for both sources (a legacy session has exactly one). */
  epoch?: number;
  /** Wall-clock stamp for `emitted_at_unix_ms`; deterministic in tests. */
  now?: () => number;
  /** Override source ids (e.g. a fake). Defaults to {@link LEGACY_SOURCE_ID}. */
  sourceIds?: Partial<Record<StreamSide, string>>;
}

/**
 * Stateful, deterministic projection of a legacy segment stream. Each side is
 * one source with its own monotonic `seq`; the legacy per-side `seq` is kept
 * in `payload.legacy` and drives `segment_id`, so partial→final replacement
 * keeps working through the reducer exactly as it does on screen today.
 *
 * `event_id` is derived from `(session, source, epoch, seq)` so the same
 * stream always yields the same ids — replay-safe.
 */
export class LegacyEnvelopeAdapter {
  private counters: Record<StreamSide, number> = { inbound: 0, outbound: 0 };
  private readonly epoch: number;
  private readonly now: () => number;
  private readonly sourceIds: Record<StreamSide, string>;

  constructor(private readonly options: LegacyAdapterOptions) {
    this.epoch = options.epoch ?? 0;
    this.now = options.now ?? (() => Date.now());
    this.sourceIds = { ...LEGACY_SOURCE_ID, ...options.sourceIds };
  }

  get sessionId(): string {
    return this.options.sessionId;
  }

  sourceId(side: StreamSide): string {
    return this.sourceIds[side];
  }

  channel(side: StreamSide): CaptureChannel {
    return channelForSide(side);
  }

  /** Wrap the next legacy segment. */
  lift(seg: TranscriptSegment): TranscriptEvent {
    const seq = this.counters[seg.side];
    this.counters[seg.side] = seq + 1;
    const sourceId = this.sourceIds[seg.side];
    return {
      schema_version: CONTRACT_SCHEMA_VERSION,
      event_id: legacyEventId(this.options.sessionId, sourceId, this.epoch, seq),
      session_id: this.options.sessionId,
      source_id: sourceId,
      source_kind: LEGACY_SOURCE_KIND[seg.side],
      channel: channelForSide(seg.side),
      epoch: this.epoch,
      seq,
      captured_at_ms: seg.start_ms,
      emitted_at_unix_ms: this.now(),
      payload: transcriptPayloadFromLegacy(seg),
    };
  }
}

export function legacyEventId(
  sessionId: string,
  sourceId: string,
  epoch: number,
  seq: number,
): string {
  return `${sessionId}:${sourceId}:${epoch}:${seq}`;
}

/**
 * Project a persisted conversation's segments into envelopes. Saved records
 * hold finals only, so every envelope is `is_final`; `emitted_at_unix_ms` is
 * the record's `updated_at_unix_ms` (the only wall-clock the record has).
 * Segments are emitted in stored order — the ledger/reducer decide display
 * order from `captured_at_ms` (= `start_ms`).
 */
export function conversationToEvents(c: PersistedConversation): TranscriptEvent[] {
  const adapter = new LegacyEnvelopeAdapter({
    sessionId: `conversation:${c.id}`,
    now: () => c.updated_at_unix_ms,
  });
  return c.segments.map((s) => adapter.lift(s));
}

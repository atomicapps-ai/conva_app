/**
 * Versioned capture / source / session / event contract — browser product
 * architecture **M0** (`conva_core/docs/technical/
 * 2026-09-conva-web-product-and-capture-architecture.md` §6, §8, §12).
 *
 * Hand mirror of `crates/conva-core/src/capture_contract.rs` — change one,
 * change the other in the same commit (same rule as `ipc.rs` ↔ `ipc.ts`).
 *
 * Everything here is ADDITIVE to the legacy `StreamSide` / `TranscriptSegment`
 * shapes in `@/lib/ipc`: no existing event or persisted record changes. Legacy
 * values migrate by mapping (`outbound → self`, `inbound → remote_mix`) and the
 * original value travels alongside the mapped one, so existing conversations
 * stay readable.
 *
 * Pure types + mapping only — no React, no Tauri, no browser APIs.
 */

import type { StreamSide, TranscriptSegment } from "@/lib/ipc";

/** Schema version carried by every {@link ConvaEvent} envelope. */
export const CONTRACT_SCHEMA_VERSION = 1 as const;
export type ContractSchemaVersion = typeof CONTRACT_SCHEMA_VERSION;

// ── Availability ─────────────────────────────────────────────────────────────

/**
 * Live availability of a capability, source or operation. Potential support,
 * implementation status, policy, permission and current readiness are
 * DIFFERENT answers — this union keeps them apart so the UI never renders a
 * successful-looking control for an operation that would discard work.
 *
 * - `available`         ready now
 * - `needs_user_action` implemented, but the user must grant/pick/sign in first
 * - `degraded`          works with a known limitation right now
 * - `unavailable`       implemented + supported, not usable right now
 * - `unsupported`       this platform/runtime can never do it
 * - `unimplemented`     the platform could, Conva hasn't built it yet (a TODO
 *                       stub is `unimplemented`, never `available`)
 */
export type Availability =
  | { state: "available" }
  | { state: "needs_user_action"; reason: string }
  | { state: "degraded"; reason: string }
  | { state: "unavailable"; reason: string }
  | { state: "unsupported"; reason: string }
  | { state: "unimplemented"; reason: string };

export type AvailabilityState = Availability["state"];

export const AVAILABLE: Availability = { state: "available" };
export const needsUserAction = (reason: string): Availability => ({
  state: "needs_user_action",
  reason,
});
export const degraded = (reason: string): Availability => ({ state: "degraded", reason });
export const unavailable = (reason: string): Availability => ({
  state: "unavailable",
  reason,
});
export const unsupported = (reason: string): Availability => ({
  state: "unsupported",
  reason,
});
export const unimplemented = (reason: string): Availability => ({
  state: "unimplemented",
  reason,
});

/** True when invoking the operation can do real work right now. */
export function isUsable(a: Availability): boolean {
  return a.state === "available" || a.state === "degraded";
}

/** The human-readable reason, when the state carries one. */
export function availabilityReason(a: Availability): string | null {
  return a.state === "available" ? null : a.reason;
}

// ── Source vocabulary ────────────────────────────────────────────────────────

/** What physically produces a capture stream. */
export type CaptureSourceKind = "mic" | "display" | "tab" | "wasapi" | "meeting";
export const CAPTURE_SOURCE_KINDS: readonly CaptureSourceKind[] = [
  "mic",
  "display",
  "tab",
  "wasapi",
  "meeting",
];

/**
 * The canonical logical channel (§6 identity vocabulary).
 * - `self`         the user's mic or a platform-provided self track
 * - `remote_mix`   audio played by one or more other participants; does NOT
 *                  identify which person spoke
 * - `remote_track` reserved for an integration that supplies a distinct
 *                  participant track
 */
export type CaptureChannel = "self" | "remote_mix" | "remote_track";
export const CAPTURE_CHANNELS: readonly CaptureChannel[] = [
  "self",
  "remote_mix",
  "remote_track",
];

/** Who owns the capture lifecycle. `native` = today's desktop shell engine. */
export type CaptureOwner = "page" | "extension" | "bridge" | "integration" | "native";

/** How long a source keeps capturing once its visible controller goes away. */
export type ContinuityModel =
  | "page_lifetime"
  | "extension_lifetime"
  | "native_lease"
  | "hosted";

/** Where the captured audio is processed. */
export type ProcessingMode = "local" | "hosted" | "hybrid";

/** One capture source as advertised in a capability snapshot (§8). */
export interface CaptureSourceCapability {
  kind: CaptureSourceKind;
  channels: CaptureChannel[];
  owner: CaptureOwner;
  continuity: ContinuityModel;
  processing: ProcessingMode[];
  availability: Availability;
}

// ── Speaker reference ────────────────────────────────────────────────────────

/**
 * Who a transcript segment is attributed to — separate from the channel (a
 * `remote_mix` may carry several voices) and from any display label (a
 * user-correctable presentation value, never proof of identity).
 *
 * Wire form: `self` · `remote:unknown` · `cluster:<session-local-id>` ·
 * `participant:<integration-id>` · `enrolled:<user-authorized-id>`.
 */
export type SpeakerRef =
  | "self"
  | "remote:unknown"
  | `cluster:${string}`
  | `participant:${string}`
  | `enrolled:${string}`;

export type SpeakerRefKind = "self" | "remote_unknown" | "cluster" | "participant" | "enrolled";

export const SPEAKER_SELF: SpeakerRef = "self";
export const SPEAKER_REMOTE_UNKNOWN: SpeakerRef = "remote:unknown";
export const clusterRef = (id: string): SpeakerRef => `cluster:${id}`;
export const participantRef = (id: string): SpeakerRef => `participant:${id}`;
export const enrolledRef = (id: string): SpeakerRef => `enrolled:${id}`;

/** Parse a wire string; `null` when it isn't a valid speaker ref. */
export function parseSpeakerRef(
  s: string,
): { kind: SpeakerRefKind; id: string | null } | null {
  if (s === "self") return { kind: "self", id: null };
  if (s === "remote:unknown") return { kind: "remote_unknown", id: null };
  const i = s.indexOf(":");
  if (i <= 0) return null;
  const prefix = s.slice(0, i);
  const id = s.slice(i + 1);
  if (!id) return null;
  if (prefix === "cluster" || prefix === "participant" || prefix === "enrolled") {
    return { kind: prefix, id };
  }
  return null;
}

export function isSpeakerRef(s: string): s is SpeakerRef {
  return parseSpeakerRef(s) !== null;
}

// ── Event envelope ───────────────────────────────────────────────────────────

/**
 * The versioned envelope every adapter emits (§6). Reducers discard stale
 * epochs and de-duplicate by `(session_id, source_id, epoch, seq, event_id)`
 * — see `@/lib/capture/ledger`.
 */
export interface ConvaEvent<T> {
  schema_version: ContractSchemaVersion;
  event_id: string;
  session_id: string;
  source_id: string;
  source_kind: CaptureSourceKind;
  channel: CaptureChannel;
  /** Increments when this source reconnects. */
  epoch: number;
  /** Monotonic within `source_id + epoch`. */
  seq: number;
  /** Source monotonic clock, normalized at ingress (ms). */
  captured_at_ms: number;
  emitted_at_unix_ms: number;
  payload: T;
}

/** Where a mapped segment came from — kept so legacy records round-trip. */
export interface LegacySegmentRef {
  side: StreamSide;
  seq: number;
}

/**
 * Transcript payload of a {@link ConvaEvent}: the legacy segment fields plus
 * revision / speaker metadata. Partials may replace earlier partials of the
 * same `segment_id`; a final never silently rewrites another final —
 * corrections are new immutable revisions that `replaces_event_id` the
 * superseded one.
 */
export interface TranscriptPayload {
  /** Utterance identity shared by every partial/final/correction of one
   *  segment. Legacy mapping uses `<side>-<seq>` (= the UI's `segmentKey`). */
  segment_id: string;
  text: string;
  is_final: boolean;
  start_ms: number;
  end_ms: number;
  confidence: number | null;
  latency_ms: number;
  /** 0 for the first emission of a `segment_id`; +1 per replacement. */
  revision: number;
  /** The `event_id` this revision supersedes, when it replaces one. */
  replaces_event_id: string | null;
  speaker_ref: SpeakerRef;
  /** User-correctable presentation label; never proof of identity. */
  display_label: string | null;
  /** BCP-47 language tag, when the engine reports one. */
  language: string | null;
  /** ASR provider provenance (`whisper_local`, `deepgram_cloud`, …). */
  provider: string | null;
  /** Original legacy side + seq, kept during the transition. */
  legacy: LegacySegmentRef | null;
}

export type TranscriptEvent = ConvaEvent<TranscriptPayload>;

// ── Legacy mapping ───────────────────────────────────────────────────────────

/** `outbound → self`, `inbound → remote_mix`. */
export function channelForSide(side: StreamSide): CaptureChannel {
  return side === "outbound" ? "self" : "remote_mix";
}

/** Inverse of {@link channelForSide}; `remote_track` folds into `inbound`. */
export function sideForChannel(channel: CaptureChannel): StreamSide {
  return channel === "self" ? "outbound" : "inbound";
}

/** The default speaker attribution the legacy two-side model implies. */
export function speakerRefForSide(side: StreamSide): SpeakerRef {
  return side === "outbound" ? SPEAKER_SELF : SPEAKER_REMOTE_UNKNOWN;
}

/** The legacy bubble key (`inbound-7`) — identical to `segmentKey` in
 *  `@/lib/turns` and to `RadarEvent.source_key`. */
export function legacySegmentId(side: StreamSide, seq: number): string {
  return `${side}-${seq}`;
}

/** Lift a legacy segment into the versioned payload (`revision` 0). */
export function transcriptPayloadFromLegacy(seg: TranscriptSegment): TranscriptPayload {
  return {
    segment_id: legacySegmentId(seg.side, seg.seq),
    text: seg.text,
    is_final: seg.is_final,
    start_ms: seg.start_ms,
    end_ms: seg.end_ms,
    confidence: seg.confidence,
    latency_ms: seg.latency_ms,
    revision: 0,
    replaces_event_id: null,
    speaker_ref: speakerRefForSide(seg.side),
    display_label: null,
    language: null,
    provider: null,
    legacy: { side: seg.side, seq: seg.seq },
  };
}

/**
 * Project a payload back onto the legacy segment shape. Uses the preserved
 * legacy ref when present, otherwise derives `side` from `channel` and `seq`
 * from `fallbackSeq`.
 */
export function transcriptPayloadToLegacy(
  payload: TranscriptPayload,
  channel: CaptureChannel,
  fallbackSeq: number,
): TranscriptSegment {
  const side = payload.legacy?.side ?? sideForChannel(channel);
  const seq = payload.legacy?.seq ?? fallbackSeq;
  return {
    side,
    seq,
    text: payload.text,
    is_final: payload.is_final,
    start_ms: payload.start_ms,
    end_ms: payload.end_ms,
    confidence: payload.confidence,
    latency_ms: payload.latency_ms,
  };
}

/** Legacy → envelope projection (the whole segment, not just the payload). */
export function transcriptEventToLegacy(event: TranscriptEvent): TranscriptSegment {
  return transcriptPayloadToLegacy(event.payload, event.channel, event.seq);
}

// ── Validation ───────────────────────────────────────────────────────────────

export type EnvelopeIssue =
  | "schema_version"
  | "event_id"
  | "session_id"
  | "source_id"
  | "source_kind"
  | "channel"
  | "epoch"
  | "seq"
  | "captured_at_ms"
  | "emitted_at_unix_ms";

function isNonNegativeInt(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 0;
}

/**
 * Structural validation of an envelope's header (not its payload). Returns the
 * list of offending fields — empty means well-formed.
 */
export function validateEnvelope(e: ConvaEvent<unknown>): EnvelopeIssue[] {
  const issues: EnvelopeIssue[] = [];
  if (e.schema_version !== CONTRACT_SCHEMA_VERSION) issues.push("schema_version");
  if (typeof e.event_id !== "string" || e.event_id.length === 0) issues.push("event_id");
  if (typeof e.session_id !== "string" || e.session_id.length === 0) issues.push("session_id");
  if (typeof e.source_id !== "string" || e.source_id.length === 0) issues.push("source_id");
  if (!CAPTURE_SOURCE_KINDS.includes(e.source_kind)) issues.push("source_kind");
  if (!CAPTURE_CHANNELS.includes(e.channel)) issues.push("channel");
  if (!isNonNegativeInt(e.epoch)) issues.push("epoch");
  if (!isNonNegativeInt(e.seq)) issues.push("seq");
  if (!isNonNegativeInt(e.captured_at_ms)) issues.push("captured_at_ms");
  if (!isNonNegativeInt(e.emitted_at_unix_ms)) issues.push("emitted_at_unix_ms");
  return issues;
}

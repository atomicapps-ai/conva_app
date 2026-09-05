/**
 * Live-session wire protocol v1 — the contract between the browser product and
 * the hosted gateway (`conva_web` Worker, `/api/live/*`). Hand-mirrored in
 * `conva_web/src/live/protocol.js`; change both in the same change set.
 * Canonical spec: `conva_core/docs/platform/live-gateway-protocol.md`.
 *
 * Transport: one authenticated WebSocket per product session
 * (`GET /api/live/stream?ticket=…`, ticket from `POST /api/live/sessions`).
 *   • Control = JSON text frames ({@link ClientFrame} / {@link ServerFrame}).
 *   • Audio   = binary frames: a fixed {@link AUDIO_HEADER_BYTES} header then
 *               little-endian PCM16 mono at {@link SAMPLE_RATE_HZ}.
 *   • Flow control = credits: the server grants `frames` per source; the client
 *     never sends an audio frame without a credit (browser WebSocket has no
 *     backpressure — architecture §11).
 *   • Transcripts arrive as {@link TranscriptEvent} envelopes (M0 contract);
 *     the client de-duplicates/orders them with the M0 `EventLedger`.
 *
 * Pure: no I/O, no DOM. Unit-tested in protocol.test.ts.
 */

import type {
  CaptureChannel,
  CaptureSourceKind,
  TranscriptEvent,
} from "@/lib/capture/contract";
import { CONTRACT_SCHEMA_VERSION } from "@/lib/capture/contract";

export const LIVE_PROTOCOL_VERSION = 1 as const;
export const SAMPLE_RATE_HZ = 16_000;
export const AUDIO_FORMAT = "pcm16" as const;
/** Target batch size for one audio frame (architecture §11: 100–250 ms). */
export const FRAME_MS_MIN = 100;
export const FRAME_MS_MAX = 250;
/** Unsent live audio is capped here; beyond it the client drops and marks a gap. */
export const MAX_BUFFERED_MS = 2_000;

// ── HTTP shapes ─────────────────────────────────────────────────────────────

/** `GET /api/live/status` — is a hosted live session possible on this deployment? */
export interface LiveStatus {
  configured: boolean;
  /** ASR provider id when configured (`deepgram`), else null. */
  provider: string | null;
  /** Human reason when `configured` is false. */
  reason?: string;
  max_sources: number;
  sample_rate_hz: number;
}

export type ProcessingMode = "hosted";
export type RetentionMode = "ephemeral";

/** `POST /api/live/sessions` request. */
export interface CreateSessionRequest {
  processing_mode: ProcessingMode;
  retention_mode: RetentionMode;
  context_id: string | null;
  sources: Array<{ kind: CaptureSourceKind; channel: CaptureChannel }>;
}

/** `POST /api/live/sessions` 201 response. */
export interface CreateSessionResponse {
  session_id: string;
  /** Single-use, short-lived, bound to the caller's web session. */
  ticket: string;
  /** Same-origin path of the WebSocket endpoint. */
  stream_url: string;
  expires_at_unix: number;
  limits: { max_duration_s: number; max_sources: number };
}

// ── Client → server control frames ──────────────────────────────────────────

export interface HelloFrame {
  type: "hello";
  protocol: typeof LIVE_PROTOCOL_VERSION;
  contract_schema_version: number;
  /** Build identity for content-free telemetry (git sha), never user content. */
  client_build: string;
}

export interface SourceAttachFrame {
  type: "source.attach";
  source_id: string;
  kind: CaptureSourceKind;
  channel: CaptureChannel;
  /** Reconnect epoch for this source (0 on first attach). */
  epoch: number;
  sample_rate_hz: number;
  format: typeof AUDIO_FORMAT;
}

export interface SourceDetachFrame {
  type: "source.detach";
  source_id: string;
  reason: "user" | "ended" | "device_lost" | "error";
}

/** Acknowledge transcript delivery up to `seq` for a source (resume cursor). */
export interface AckFrame {
  type: "ack";
  source_id: string;
  epoch: number;
  seq: number;
}

export interface StopFrame {
  type: "stop";
}

export interface CancelFrame {
  type: "cancel";
  operation_id: string;
}

export type ClientFrame =
  | HelloFrame
  | SourceAttachFrame
  | SourceDetachFrame
  | AckFrame
  | StopFrame
  | CancelFrame;

// ── Server → client control frames ──────────────────────────────────────────

export interface ReadyFrame {
  type: "ready";
  protocol: typeof LIVE_PROTOCOL_VERSION;
  session_id: string;
  provider: string;
  /** Initial per-source credit granted on attach. */
  initial_credit: number;
}

export interface SourceAttachedFrame {
  type: "source.attached";
  source_id: string;
  /** Index the client must put in the audio frame header for this source. */
  source_index: number;
  epoch: number;
}

export type SourceState = "capturing" | "degraded" | "reconnecting" | "ended";

export interface SourceStateFrame {
  type: "source.state";
  source_id: string;
  state: SourceState;
  reason?: string;
}

/** Grant the client `frames` more audio frames for a source. */
export interface CreditFrame {
  type: "credit";
  source_id: string;
  frames: number;
}

export interface TranscriptFrame {
  type: "transcript";
  event: TranscriptEvent;
}

export interface ErrorFrame {
  type: "error";
  code:
    | "bad_frame"
    | "unknown_source"
    | "no_credit"
    | "provider_unavailable"
    | "provider_unconfigured"
    | "quota_exceeded"
    | "session_expired"
    | "protocol_mismatch"
    | "internal";
  message: string;
  fatal: boolean;
  source_id?: string;
}

export interface ByeFrame {
  type: "bye";
  reason: "stopped" | "expired" | "quota" | "error" | "cancelled";
  /** Content-free usage: milliseconds of audio accepted per source. */
  usage: { audio_ms_by_source: Record<string, number> };
}

export type ServerFrame =
  | ReadyFrame
  | SourceAttachedFrame
  | SourceStateFrame
  | CreditFrame
  | TranscriptFrame
  | ErrorFrame
  | ByeFrame;

// ── Binary audio frame ──────────────────────────────────────────────────────

/**
 * Header (little-endian):
 *   0  u8   version (= 1)
 *   1  u8   source_index (from `source.attached`)
 *   2  u16  reserved (0)
 *   4  u32  seq — monotonic per source+epoch, counts audio frames
 *   8  u32  captured_at_ms — source clock at the FIRST sample of this frame
 *  12  u32  sample_count — PCM16 samples that follow (mono)
 */
export const AUDIO_HEADER_BYTES = 16;
export const AUDIO_FRAME_VERSION = 1;

export interface AudioFrame {
  source_index: number;
  seq: number;
  captured_at_ms: number;
  /** Little-endian PCM16 mono samples. */
  samples: Int16Array;
}

export function encodeAudioFrame(f: AudioFrame): ArrayBuffer {
  if (f.source_index < 0 || f.source_index > 255) throw new RangeError("source_index must fit u8");
  const buf = new ArrayBuffer(AUDIO_HEADER_BYTES + f.samples.length * 2);
  const view = new DataView(buf);
  view.setUint8(0, AUDIO_FRAME_VERSION);
  view.setUint8(1, f.source_index);
  view.setUint16(2, 0, true);
  view.setUint32(4, f.seq >>> 0, true);
  view.setUint32(8, f.captured_at_ms >>> 0, true);
  view.setUint32(12, f.samples.length >>> 0, true);
  for (let i = 0; i < f.samples.length; i++) {
    view.setInt16(AUDIO_HEADER_BYTES + i * 2, f.samples[i] ?? 0, true);
  }
  return buf;
}

/** Returns null for a malformed frame (wrong version, short header, length mismatch). */
export function decodeAudioFrame(buf: ArrayBuffer): AudioFrame | null {
  if (buf.byteLength < AUDIO_HEADER_BYTES) return null;
  const view = new DataView(buf);
  if (view.getUint8(0) !== AUDIO_FRAME_VERSION) return null;
  const sample_count = view.getUint32(12, true);
  if (buf.byteLength !== AUDIO_HEADER_BYTES + sample_count * 2) return null;
  const samples = new Int16Array(sample_count);
  for (let i = 0; i < sample_count; i++) {
    samples[i] = view.getInt16(AUDIO_HEADER_BYTES + i * 2, true);
  }
  return {
    source_index: view.getUint8(1),
    seq: view.getUint32(4, true),
    captured_at_ms: view.getUint32(8, true),
    samples,
  };
}

/** Milliseconds of audio in a frame at the protocol sample rate. */
export function frameDurationMs(sampleCount: number, sampleRateHz = SAMPLE_RATE_HZ): number {
  return (sampleCount * 1000) / sampleRateHz;
}

// ── Control-frame parsing / validation ──────────────────────────────────────

const CLIENT_TYPES = new Set<ClientFrame["type"]>([
  "hello",
  "source.attach",
  "source.detach",
  "ack",
  "stop",
  "cancel",
]);
const SERVER_TYPES = new Set<ServerFrame["type"]>([
  "ready",
  "source.attached",
  "source.state",
  "credit",
  "transcript",
  "error",
  "bye",
]);

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const isStr = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Parse a JSON text frame from the client. Null when malformed or unknown. */
export function parseClientFrame(text: string): ClientFrame | null {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(v) || !isStr(v.type) || !CLIENT_TYPES.has(v.type as ClientFrame["type"])) return null;
  switch (v.type as ClientFrame["type"]) {
    case "hello":
      return v.protocol === LIVE_PROTOCOL_VERSION && isNum(v.contract_schema_version) && typeof v.client_build === "string"
        ? (v as unknown as HelloFrame)
        : null;
    case "source.attach":
      return isStr(v.source_id) && isStr(v.kind) && isStr(v.channel) && isNum(v.epoch) && v.epoch >= 0 &&
        v.sample_rate_hz === SAMPLE_RATE_HZ && v.format === AUDIO_FORMAT
        ? (v as unknown as SourceAttachFrame)
        : null;
    case "source.detach":
      return isStr(v.source_id) && isStr(v.reason) ? (v as unknown as SourceDetachFrame) : null;
    case "ack":
      return isStr(v.source_id) && isNum(v.epoch) && isNum(v.seq) ? (v as unknown as AckFrame) : null;
    case "stop":
      return { type: "stop" };
    case "cancel":
      return isStr(v.operation_id) ? (v as unknown as CancelFrame) : null;
  }
}

/** Parse a JSON text frame from the server. Null when malformed or unknown. */
export function parseServerFrame(text: string): ServerFrame | null {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(v) || !isStr(v.type) || !SERVER_TYPES.has(v.type as ServerFrame["type"])) return null;
  switch (v.type as ServerFrame["type"]) {
    case "ready":
      return v.protocol === LIVE_PROTOCOL_VERSION && isStr(v.session_id) && isStr(v.provider) && isNum(v.initial_credit)
        ? (v as unknown as ReadyFrame)
        : null;
    case "source.attached":
      return isStr(v.source_id) && isNum(v.source_index) && isNum(v.epoch) ? (v as unknown as SourceAttachedFrame) : null;
    case "source.state":
      return isStr(v.source_id) && isStr(v.state) ? (v as unknown as SourceStateFrame) : null;
    case "credit":
      return isStr(v.source_id) && isNum(v.frames) && v.frames >= 0 ? (v as unknown as CreditFrame) : null;
    case "transcript":
      return isRecord(v.event) && v.event.schema_version === CONTRACT_SCHEMA_VERSION
        ? (v as unknown as TranscriptFrame)
        : null;
    case "error":
      return isStr(v.code) && typeof v.message === "string" && typeof v.fatal === "boolean"
        ? (v as unknown as ErrorFrame)
        : null;
    case "bye":
      return isStr(v.reason) && isRecord(v.usage) ? (v as unknown as ByeFrame) : null;
  }
}

export function helloFrame(clientBuild: string): HelloFrame {
  return {
    type: "hello",
    protocol: LIVE_PROTOCOL_VERSION,
    contract_schema_version: CONTRACT_SCHEMA_VERSION,
    client_build: clientBuild,
  };
}

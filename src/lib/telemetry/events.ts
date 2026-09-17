/**
 * Content-free behavioural telemetry — the taxonomy `/events` validates
 * against (docs/platform/11-beta-telemetry-and-participation.md "Event
 * taxonomy v1" + docs/platform/15-events-implementation.md §9's two
 * metering-derived additions, both in conva_core). Pure — no Tauri, no
 * fetch; see `queue.ts` for the durable local queue this feeds and
 * `commands.ts` for the desktop adapter.
 *
 * Hand-mirrored, the same way `lib/ipc.ts` mirrors the rest of the Rust↔TS
 * contract, against TWO other copies: `crates/conva-core/src/
 * telemetry_events.rs` (the Rust validator the desktop queue itself runs
 * before ever writing a line) and `conva_web/src/live/events.js` (the
 * server's own validator). A new taxonomy entry needs all three updated,
 * not just one — plus `platform/supabase/migrations/0011_telemetry_events
 * .sql`'s `ev` check constraint in conva_core.
 */
import type { TelemetryEvent } from "@/lib/ipc";

export const EVENTS_SCHEMA_VERSION = 1;

/** Bounded lower_snake_case machine token — no spaces, no free text. */
export const CODE_RE = /^[a-z][a-z0-9]*(?:_[a-z0-9]+){0,4}$/;
export const CODE_MAX = 48;
/** Permissive enough for real model ids ("claude-sonnet-5", "gpt-5.2")
 *  without allowing free text: bounded, no spaces, restricted charset. */
const MODEL_RE = /^[A-Za-z0-9](?:[A-Za-z0-9._:-]{0,62}[A-Za-z0-9])?$/;

const ALLY_ANSWER_ACTIONS = ["kept", "copied", "expanded", "opened", "dismissed", "reasked"] as const;
const CAPTURE_MODES = ["mic_only", "both_sides"] as const;
const SIGNIN_METHODS = ["google", "password"] as const;
export const PLATFORM_VALUES = ["desktop", "web"] as const;

type FieldCheck = (v: unknown) => boolean;
const isCode: FieldCheck = (v) => typeof v === "string" && v.length > 0 && v.length <= CODE_MAX && CODE_RE.test(v);
const isModelId: FieldCheck = (v) => typeof v === "string" && v.length > 0 && v.length <= 64 && MODEL_RE.test(v);
const isNum: FieldCheck = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1e15;
const isBool: FieldCheck = (v) => typeof v === "boolean";
const isEnum =
  (allowed: readonly string[]): FieldCheck =>
  (v) =>
    typeof v === "string" && (allowed as readonly string[]).includes(v);

/** Per-event field schemas: `{ field: validator(value) => boolean }`. A
 *  `fields` key not listed for that event is rejected — the same closed
 *  allow-list discipline as the server/Rust validators. */
const FIELD_SCHEMAS: Record<string, Record<string, FieldCheck>> = {
  app_started: { cold_start: isBool, gpu_backend: isCode },
  app_quit: { uptime_ms: isNum },
  signed_in: { method: isEnum(SIGNIN_METHODS) },
  session_started: { capture_mode: isEnum(CAPTURE_MODES) },
  session_ended: { duration_ms: isNum, turns: isNum },
  asr_engine: { backend: isCode, realtime_factor: isNum, dropped_frames: isNum },
  ally_asked: {
    feature: isCode,
    provider: isCode,
    model: isModelId,
    in_tokens: isNum,
    out_tokens: isNum,
    latency_ms: isNum,
    ok: isBool,
  },
  ally_answer_action: { action: isEnum(ALLY_ANSWER_ACTIONS), ms_to_action: isNum },
  radar_question_tapped: {},
  tracking_item_created: { kind: isCode },
  context_created: { doc_count: isNum },
  doc_ingested: { type: isCode, size_bucket: isCode },
  conversation_saved: { duration_ms: isNum },
  // scrubbed_message is shape-checked as a bounded machine token, never free
  // text — the exact code vocabulary is 15's open question §12 Q1.
  error: { code: isCode, scrubbed_message: isCode },
  log_dropped: { count: isNum },
  // 15 §9 — reused from the local usage/metering ledger (src-tauri/src/metering.rs)
  research_search: { count: isNum },
  tts_synthesized: { chars_bucket: isCode },
};

/** Every event name this taxonomy recognizes. */
export const TAXONOMY: readonly string[] = Object.freeze(Object.keys(FIELD_SCHEMAS));

export interface Violation {
  path: string;
  reason: string;
}

const APP_VERSION_RE = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.]+)?$/;
const SESSION_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const EVENT_TOP_KEYS = new Set(["ev", "seq", "t", "schema_v", "session_id", "app_version", "platform", "fields"]);

/** Validate one event envelope + its `fields`. Violation paths never echo
 *  values — only schema positions, safe to log (mirrors the server/Rust
 *  validators' discipline). */
export function validateEvent(e: unknown): Violation[] {
  const out: Violation[] = [];
  const bad = (path: string, reason: string) => out.push({ path, reason });
  if (!e || typeof e !== "object" || Array.isArray(e)) return [{ path: "", reason: "object expected" }];
  const rec = e as Record<string, unknown>;
  for (const k of Object.keys(rec)) if (!EVENT_TOP_KEYS.has(k)) bad(k, "unknown key");

  const ev = typeof rec.ev === "string" ? rec.ev : "";
  const schema = FIELD_SCHEMAS[ev];
  if (!schema) bad("ev", "unknown taxonomy event");
  if (!Number.isInteger(rec.seq) || (rec.seq as number) < 0) bad("seq", "non-negative integer expected");
  if (!isNum(rec.t)) bad("t", "non-negative finite number expected");
  if (rec.schema_v !== EVENTS_SCHEMA_VERSION) bad("schema_v", "unsupported schema");
  if (rec.session_id !== undefined && rec.session_id !== null && !(typeof rec.session_id === "string" && SESSION_ID_RE.test(rec.session_id) && rec.session_id.length <= 128)) {
    bad("session_id", "bounded id expected");
  }
  if (typeof rec.app_version !== "string" || !APP_VERSION_RE.test(rec.app_version)) bad("app_version", "semver expected");
  if (!isEnum(PLATFORM_VALUES)(rec.platform)) bad("platform", "desktop|web expected");

  const fields = rec.fields;
  if (fields === undefined || fields === null) {
    if (schema && Object.keys(schema).length > 0) bad("fields", "object expected");
  } else if (typeof fields !== "object" || Array.isArray(fields)) {
    bad("fields", "object expected");
  } else if (schema) {
    for (const k of Object.keys(fields as Record<string, unknown>)) {
      const check = schema[k];
      if (!check) {
        bad(`fields.${k}`, "unknown field for this event");
        continue;
      }
      if (!check((fields as Record<string, unknown>)[k])) bad(`fields.${k}`, "invalid value");
    }
  }
  return out;
}

export function isValidEvent(e: unknown): e is TelemetryEvent {
  return validateEvent(e).length === 0;
}

/** Bucket a character count the same coarse way as `crates/conva-core/src/
 *  telemetry_events.rs`'s `chars_bucket` — kept in lockstep so a `chars_bucket`
 *  value never disagrees between the Rust (desktop metering) and TS (any
 *  future UI-driven `tts_synthesized` call site) producers. */
export function charsBucket(chars: number): string {
  if (chars <= 500) return "under_500";
  if (chars <= 2000) return "under_2000";
  if (chars <= 10_000) return "under_10000";
  return "over_10000";
}

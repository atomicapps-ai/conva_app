/**
 * Content-free live telemetry (architecture §16, M2 checkpoint 5) — pure.
 *
 * The browser records SAMPLES (an enumerated kind + coded fields + numbers),
 * folds them locally into one AGGREGATE per flush window (counts, per-reason
 * tallies, latency histograms with client-side p50/p95), and posts only the
 * aggregate to `POST /api/live/telemetry`. Nothing here can carry content: the
 * only strings the schema admits are enumerated kinds/channels/outcomes and
 * short machine codes matching {@link CODE_RE}; {@link validateAggregate}
 * rejects anything else, and the Worker runs the same validator (mirrored in
 * `conva_web/src/live/telemetry.js`). A canary test injects unique phrases
 * through every content path and asserts they never reach an aggregate.
 *
 * Latency is an ESTIMATE: speech → text is measured as
 * (client receive wall time − source audio wall start) − payload.end_ms,
 * i.e. the provider's end-of-speech time on the source's audio axis versus
 * when the envelope arrived. Good enough for §11 p50/p95 tracking; the field
 * is named `est` so nobody reads it as a clock-synchronised measurement.
 */

export const TELEMETRY_SCHEMA_VERSION = 1 as const;
/** Structural shape of a machine code: lower-case tokens joined by `_`, ≤ 48
 *  chars, no spaces/hyphens/punctuation. Shape alone is not a firewall (a
 *  four-word phrase fits), so codes are ALSO normalised against the known
 *  vocabulary below — anything unknown becomes `other` on both ends. */
export const CODE_RE = /^[a-z][a-z0-9]*(?:_[a-z0-9]+){0,4}$/;
export const CODE_MAX = 48;
/** Every code the client can legitimately emit (LiveSessionError codes, capture
 *  failures, bye reasons, Ally stream codes). Mirrored in conva_web/src/live/telemetry.js. */
export const KNOWN_CODES: ReadonlySet<string> = new Set([
  "none", "other", "ok", "error", "denied", "not_found", "no_audio_track", "cancelled", "insecure_context", "unsupported",
  "already_active", "signed_out", "not_entitled", "unconfigured", "concurrent_limit", "quota_exceeded", "connect_failed",
  "busy", "network", "no_session", "attach_failed", "unknown_source", "unsupported_source", "reconnect_exhausted",
  "reconnect_failed", "protocol_mismatch", "bad_frame", "unknown_source", "no_credit", "provider_unavailable", "internal",
  "stopped", "quota", "disconnect", "track_ended", "device_lost", "duplicate_request", "refusal", "upstream_error",
  "provider_unconfigured", "stream_truncated", "stream_interrupted", "empty_response", "invalid_json", "cross_origin",
  "bad_request_id", "bad_kind", "bad_question", "bad_segments", "too_large", "expected_websocket", "bad_ticket",
  "unsupported_mode", "bad_sources", "session_active",
]);
/** Parameterised codes: HTTP/upstream statuses and bye reasons. */
const CODE_PATTERNS = [/^http_[0-9]{3}$/, /^upstream_[0-9]{3}$/, /^bye_[a-z]+(?:_[a-z]+){0,2}$/];

/** Vocabulary normalisation: a known code stays, anything else is `other`. */
export function normalizeCode(code: string): string {
  if (code.length > CODE_MAX || !CODE_RE.test(code)) return "other";
  if (KNOWN_CODES.has(code)) return code;
  return CODE_PATTERNS.some((re) => re.test(code)) ? code : "other";
}
export const CHANNELS = ["self", "remote_mix", "remote_track"] as const;
/** A git sha prefix or "dev"/"unknown" — never free text. */
export const BUILD_RE = /^(?:[0-9a-f]{7,40}|dev|unknown)$/i;
export const OS_VALUES = ["windows", "macos", "linux", "ios", "android", "unknown"] as const;
export const ALLY_KINDS = ["suggest_reply", "summarize", "question"] as const;
/** Histogram bucket upper bounds (ms); the last bucket is "over". */
export const LATENCY_BUCKETS_MS = [250, 500, 800, 1500, 3000, 5000] as const;
/** Bounded reservoir for client-side quantiles. */
export const RESERVOIR = 500;
/** Payload cap the Worker enforces too. */
export const MAX_AGGREGATE_BYTES = 16 * 1024;

export type Channel = (typeof CHANNELS)[number];

export type TelemetrySample =
  | { kind: "session.start"; outcome: "ok" | "refused"; code?: string }
  | { kind: "session.end"; reason: string; duration_ms: number; sources: number }
  | { kind: "source.degraded"; channel: Channel; code: string }
  | { kind: "source.recovered"; channel: Channel }
  | { kind: "source.gap"; channel: Channel }
  | { kind: "source.reconnect"; attempt: number; outcome: "ok" | "failed" | "exhausted" }
  | { kind: "transcript"; channel: Channel; final: boolean; est_latency_ms: number }
  | { kind: "ally"; ally_kind: (typeof ALLY_KINDS)[number]; outcome: "ok" | "error" | "refused"; code?: string; first_token_ms?: number; total_ms: number };

export interface Hist {
  count: number;
  sum_ms: number;
  /** Counts per {@link LATENCY_BUCKETS_MS} bound, plus one trailing "over". */
  buckets: number[];
  p50_ms: number | null;
  p95_ms: number | null;
}

export interface TelemetryAggregate {
  schema: typeof TELEMETRY_SCHEMA_VERSION;
  client_build: string;
  os: (typeof OS_VALUES)[number];
  window_start_unix_ms: number;
  window_end_unix_ms: number;
  samples: number;
  session_start: { ok: number; refused: number; refused_by_code: Record<string, number> };
  session_end: { count: number; by_reason: Record<string, number>; duration_ms: Hist; sources_sum: number };
  source: {
    degraded_by_channel: Record<string, number>;
    degraded_by_code: Record<string, number>;
    recovered_by_channel: Record<string, number>;
    gaps_by_channel: Record<string, number>;
    reconnect: { attempts: number; ok: number; failed: number; exhausted: number };
  };
  transcript: { partial_by_channel: Record<string, Hist>; final_by_channel: Record<string, Hist> };
  ally: { by_kind: Record<string, number>; by_outcome: Record<string, number>; by_code: Record<string, number>; first_token_ms: Hist; total_ms: Hist };
}

// ── histograms ──────────────────────────────────────────────────────────────

interface LiveHist extends Hist {
  reservoir: number[];
}

function newHist(): LiveHist {
  return { count: 0, sum_ms: 0, buckets: new Array(LATENCY_BUCKETS_MS.length + 1).fill(0), p50_ms: null, p95_ms: null, reservoir: [] };
}

function histAdd(h: LiveHist, ms: number): void {
  if (!Number.isFinite(ms) || ms < 0) return;
  const v = Math.round(ms);
  h.count += 1;
  h.sum_ms += v;
  let i = 0;
  while (i < LATENCY_BUCKETS_MS.length && v > LATENCY_BUCKETS_MS[i]!) i++;
  h.buckets[i]! += 1;
  // Reservoir sampling (Algorithm R): every value has RESERVOIR/count odds of being kept.
  if (h.reservoir.length < RESERVOIR) h.reservoir.push(v);
  else {
    const j = Math.floor(Math.random() * h.count);
    if (j < RESERVOIR) h.reservoir[j] = v;
  }
}

/** Nearest-rank quantile of a sample list. */
export function quantile(values: readonly number[], q: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return sorted[rank]!;
}

function histFreeze(h: LiveHist): Hist {
  return { count: h.count, sum_ms: h.sum_ms, buckets: [...h.buckets], p50_ms: quantile(h.reservoir, 0.5), p95_ms: quantile(h.reservoir, 0.95) };
}

function bump(rec: Record<string, number>, key: string): void {
  rec[key] = (rec[key] ?? 0) + 1;
}

/** Codes are defensive: anything outside the known vocabulary becomes `other`. */
export function safeCode(code: string | undefined | null): string {
  if (typeof code !== "string") return "none";
  return normalizeCode(code.toLowerCase());
}

// ── collector ───────────────────────────────────────────────────────────────

export interface CollectorOptions {
  clientBuild: string;
  os: (typeof OS_VALUES)[number];
  now?: () => number;
}

export class TelemetryCollector {
  private readonly now: () => number;
  private windowStart: number;
  private samples = 0;
  private sessionStart = { ok: 0, refused: 0, refused_by_code: {} as Record<string, number> };
  private sessionEnd = { count: 0, by_reason: {} as Record<string, number>, duration: newHist(), sources_sum: 0 };
  private source = {
    degraded_by_channel: {} as Record<string, number>,
    degraded_by_code: {} as Record<string, number>,
    recovered_by_channel: {} as Record<string, number>,
    gaps_by_channel: {} as Record<string, number>,
    reconnect: { attempts: 0, ok: 0, failed: 0, exhausted: 0 },
  };
  private transcript = { partial: new Map<string, LiveHist>(), final: new Map<string, LiveHist>() };
  private ally = { by_kind: {} as Record<string, number>, by_outcome: {} as Record<string, number>, by_code: {} as Record<string, number>, first: newHist(), total: newHist() };

  constructor(private readonly opts: CollectorOptions) {
    this.now = opts.now ?? Date.now;
    this.windowStart = this.now();
  }

  get size(): number {
    return this.samples;
  }

  record(s: TelemetrySample): void {
    this.samples += 1;
    switch (s.kind) {
      case "session.start":
        if (s.outcome === "ok") this.sessionStart.ok += 1;
        else {
          this.sessionStart.refused += 1;
          bump(this.sessionStart.refused_by_code, safeCode(s.code));
        }
        return;
      case "session.end":
        this.sessionEnd.count += 1;
        bump(this.sessionEnd.by_reason, safeCode(s.reason));
        histAdd(this.sessionEnd.duration, s.duration_ms);
        this.sessionEnd.sources_sum += Math.max(0, Math.floor(s.sources));
        return;
      case "source.degraded":
        bump(this.source.degraded_by_channel, s.channel);
        bump(this.source.degraded_by_code, safeCode(s.code));
        return;
      case "source.recovered":
        bump(this.source.recovered_by_channel, s.channel);
        return;
      case "source.gap":
        bump(this.source.gaps_by_channel, s.channel);
        return;
      case "source.reconnect":
        this.source.reconnect.attempts += 1;
        this.source.reconnect[s.outcome] += 1;
        return;
      case "transcript": {
        const map = s.final ? this.transcript.final : this.transcript.partial;
        let h = map.get(s.channel);
        if (!h) {
          h = newHist();
          map.set(s.channel, h);
        }
        histAdd(h, s.est_latency_ms);
        return;
      }
      case "ally":
        bump(this.ally.by_kind, s.ally_kind);
        bump(this.ally.by_outcome, s.outcome);
        if (s.outcome !== "ok") bump(this.ally.by_code, safeCode(s.code));
        if (typeof s.first_token_ms === "number") histAdd(this.ally.first, s.first_token_ms);
        histAdd(this.ally.total, s.total_ms);
        return;
    }
  }

  /** The window's aggregate (null when nothing was recorded); resets the window. */
  flush(): TelemetryAggregate | null {
    if (this.samples === 0) return null;
    const freeze = (m: Map<string, LiveHist>) => Object.fromEntries([...m.entries()].map(([k, h]) => [k, histFreeze(h)]));
    const agg: TelemetryAggregate = {
      schema: TELEMETRY_SCHEMA_VERSION,
      client_build: BUILD_RE.test(this.opts.clientBuild) ? this.opts.clientBuild.toLowerCase() : "unknown",
      os: this.opts.os,
      window_start_unix_ms: this.windowStart,
      window_end_unix_ms: this.now(),
      samples: this.samples,
      session_start: { ...this.sessionStart, refused_by_code: { ...this.sessionStart.refused_by_code } },
      session_end: { count: this.sessionEnd.count, by_reason: { ...this.sessionEnd.by_reason }, duration_ms: histFreeze(this.sessionEnd.duration), sources_sum: this.sessionEnd.sources_sum },
      source: {
        degraded_by_channel: { ...this.source.degraded_by_channel },
        degraded_by_code: { ...this.source.degraded_by_code },
        recovered_by_channel: { ...this.source.recovered_by_channel },
        gaps_by_channel: { ...this.source.gaps_by_channel },
        reconnect: { ...this.source.reconnect },
      },
      transcript: { partial_by_channel: freeze(this.transcript.partial), final_by_channel: freeze(this.transcript.final) },
      ally: { by_kind: { ...this.ally.by_kind }, by_outcome: { ...this.ally.by_outcome }, by_code: { ...this.ally.by_code }, first_token_ms: histFreeze(this.ally.first), total_ms: histFreeze(this.ally.total) },
    };
    this.reset();
    return agg;
  }

  private reset(): void {
    this.windowStart = this.now();
    this.samples = 0;
    this.sessionStart = { ok: 0, refused: 0, refused_by_code: {} };
    this.sessionEnd = { count: 0, by_reason: {}, duration: newHist(), sources_sum: 0 };
    this.source = { degraded_by_channel: {}, degraded_by_code: {}, recovered_by_channel: {}, gaps_by_channel: {}, reconnect: { attempts: 0, ok: 0, failed: 0, exhausted: 0 } };
    this.transcript = { partial: new Map(), final: new Map() };
    this.ally = { by_kind: {}, by_outcome: {}, by_code: {}, first: newHist(), total: newHist() };
  }
}

// ── validator (mirrored in conva_web/src/live/telemetry.js) ──────────────────

export type Violation = { path: string; reason: string };

/**
 * Structural + allow-list validation of an aggregate: only the keys above,
 * only numbers where numbers belong, only enumerated strings or CODE_RE codes
 * where strings belong (as map keys too), bounded sizes. Returns the list of
 * violations (empty = valid). Anything that could carry free text is a
 * violation — that is the point.
 */
export function validateAggregate(input: unknown): Violation[] {
  const out: Violation[] = [];
  const bad = (path: string, reason: string) => out.push({ path, reason });
  if (!input || typeof input !== "object" || Array.isArray(input)) return [{ path: "", reason: "object expected" }];
  const a = input as Record<string, unknown>;
  const allowedTop = new Set(["schema", "client_build", "os", "window_start_unix_ms", "window_end_unix_ms", "samples", "session_start", "session_end", "source", "transcript", "ally"]);
  for (const k of Object.keys(a)) if (!allowedTop.has(k)) bad(k, "unknown key");
  if (a.schema !== TELEMETRY_SCHEMA_VERSION) bad("schema", "unsupported schema");
  if (typeof a.client_build !== "string" || !BUILD_RE.test(a.client_build)) bad("client_build", "build id expected");
  if (!(OS_VALUES as readonly string[]).includes(a.os as string)) bad("os", "not an os enum");
  num(a.window_start_unix_ms, "window_start_unix_ms");
  num(a.window_end_unix_ms, "window_end_unix_ms");
  num(a.samples, "samples");

  obj(a.session_start, "session_start", ["ok", "refused", "refused_by_code"], (o, p) => {
    num(o.ok, `${p}.ok`);
    num(o.refused, `${p}.refused`);
    codeMap(o.refused_by_code, `${p}.refused_by_code`);
  });
  obj(a.session_end, "session_end", ["count", "by_reason", "duration_ms", "sources_sum"], (o, p) => {
    num(o.count, `${p}.count`);
    codeMap(o.by_reason, `${p}.by_reason`);
    hist(o.duration_ms, `${p}.duration_ms`);
    num(o.sources_sum, `${p}.sources_sum`);
  });
  obj(a.source, "source", ["degraded_by_channel", "degraded_by_code", "recovered_by_channel", "gaps_by_channel", "reconnect"], (o, p) => {
    channelMap(o.degraded_by_channel, `${p}.degraded_by_channel`);
    codeMap(o.degraded_by_code, `${p}.degraded_by_code`);
    channelMap(o.recovered_by_channel, `${p}.recovered_by_channel`);
    channelMap(o.gaps_by_channel, `${p}.gaps_by_channel`);
    obj(o.reconnect, `${p}.reconnect`, ["attempts", "ok", "failed", "exhausted"], (r, rp) => {
      for (const k of ["attempts", "ok", "failed", "exhausted"]) num(r[k], `${rp}.${k}`);
    });
  });
  obj(a.transcript, "transcript", ["partial_by_channel", "final_by_channel"], (o, p) => {
    histMap(o.partial_by_channel, `${p}.partial_by_channel`);
    histMap(o.final_by_channel, `${p}.final_by_channel`);
  });
  obj(a.ally, "ally", ["by_kind", "by_outcome", "by_code", "first_token_ms", "total_ms"], (o, p) => {
    enumMap(o.by_kind, `${p}.by_kind`, ALLY_KINDS);
    enumMap(o.by_outcome, `${p}.by_outcome`, ["ok", "error", "refused"]);
    codeMap(o.by_code, `${p}.by_code`);
    hist(o.first_token_ms, `${p}.first_token_ms`);
    hist(o.total_ms, `${p}.total_ms`);
  });
  return out;

  function num(v: unknown, path: string): void {
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1e15) bad(path, "non-negative finite number expected");
  }
  function obj(v: unknown, path: string, keys: string[], body: (o: Record<string, unknown>, path: string) => void): void {
    if (!v || typeof v !== "object" || Array.isArray(v)) {
      bad(path, "object expected");
      return;
    }
    const o = v as Record<string, unknown>;
    for (const k of Object.keys(o)) if (!keys.includes(k)) bad(`${path}.${k}`, "unknown key");
    body(o, path);
  }
  function mapOf(v: unknown, path: string, keyOk: (k: string) => boolean, valOk: (val: unknown, p: string) => void): void {
    if (!v || typeof v !== "object" || Array.isArray(v)) {
      bad(path, "object expected");
      return;
    }
    const o = v as Record<string, unknown>;
    const keys = Object.keys(o);
    if (keys.length > 64) bad(path, "too many keys");
    for (const k of keys) {
      // Paths never echo a key: a rejected key IS the suspected content.
      if (!keyOk(k)) bad(`${path}.<key>`, "key not allowed");
      valOk(o[k], `${path}.<key>`);
    }
  }
  function codeMap(v: unknown, path: string): void {
    mapOf(v, path, (k) => k.length <= CODE_MAX && CODE_RE.test(k), num);
  }
  function channelMap(v: unknown, path: string): void {
    mapOf(v, path, (k) => (CHANNELS as readonly string[]).includes(k), num);
  }
  function enumMap(v: unknown, path: string, allowed: readonly string[]): void {
    mapOf(v, path, (k) => allowed.includes(k), num);
  }
  function hist(v: unknown, path: string): void {
    obj(v, path, ["count", "sum_ms", "buckets", "p50_ms", "p95_ms"], (h, p) => {
      num(h.count, `${p}.count`);
      num(h.sum_ms, `${p}.sum_ms`);
      if (!Array.isArray(h.buckets) || h.buckets.length !== LATENCY_BUCKETS_MS.length + 1) bad(`${p}.buckets`, `array of ${LATENCY_BUCKETS_MS.length + 1} numbers expected`);
      else h.buckets.forEach((b, i) => num(b, `${p}.buckets[${i}]`));
      for (const q of ["p50_ms", "p95_ms"]) if (h[q] !== null) num(h[q], `${p}.${q}`);
    });
  }
  function histMap(v: unknown, path: string): void {
    mapOf(v, path, (k) => (CHANNELS as readonly string[]).includes(k), hist);
  }
}

/** Serialize for the wire, refusing anything the validator rejects or oversize. */
export function serializeAggregate(agg: TelemetryAggregate): string | null {
  if (validateAggregate(agg).length > 0) return null;
  const s = JSON.stringify(agg);
  return s.length > MAX_AGGREGATE_BYTES ? null : s;
}

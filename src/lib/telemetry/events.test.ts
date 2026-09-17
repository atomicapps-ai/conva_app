import { describe, expect, it } from "vitest";

import { charsBucket, EVENTS_SCHEMA_VERSION, TAXONOMY, validateEvent } from "./events";

function event(over: Record<string, unknown> = {}) {
  return {
    ev: "ally_asked",
    seq: 1,
    t: 1_700_000_000_000,
    schema_v: EVENTS_SCHEMA_VERSION,
    session_id: "live_abc123",
    app_version: "0.4.0",
    platform: "desktop",
    fields: { feature: "ally_question", provider: "anthropic", model: "claude-sonnet-5", in_tokens: 10, out_tokens: 5, latency_ms: 400, ok: true },
    ...over,
  };
}

const MINIMAL_FIELDS: Record<string, Record<string, unknown> | undefined> = {
  app_started: { cold_start: true, gpu_backend: "vulkan" },
  app_quit: { uptime_ms: 60000 },
  signed_in: { method: "google" },
  session_started: { capture_mode: "both_sides" },
  session_ended: { duration_ms: 60000, turns: 4 },
  asr_engine: { backend: "whisper_cpp", realtime_factor: 1.2, dropped_frames: 0 },
  ally_asked: { feature: "ally_question", provider: "anthropic", model: "claude-sonnet-5", in_tokens: 10, out_tokens: 5, latency_ms: 400, ok: true },
  ally_answer_action: { action: "kept", ms_to_action: 1200 },
  radar_question_tapped: undefined,
  tracking_item_created: { kind: "commitment" },
  context_created: { doc_count: 3 },
  doc_ingested: { type: "pdf", size_bucket: "under_1mb" },
  conversation_saved: { duration_ms: 120000 },
  error: { code: "network", scrubbed_message: "connect_failed" },
  log_dropped: { count: 2 },
  research_search: { count: 1 },
  tts_synthesized: { chars_bucket: "under_500" },
};

describe("validateEvent", () => {
  it("accepts every taxonomy event's minimal valid example", () => {
    expect(new Set(Object.keys(MINIMAL_FIELDS))).toEqual(new Set(TAXONOMY));
    for (const ev of TAXONOMY) {
      const v = validateEvent(event({ ev, fields: MINIMAL_FIELDS[ev] }));
      expect(v, `${ev}: ${JSON.stringify(v)}`).toEqual([]);
    }
  });

  it("rejects an unknown taxonomy name", () => {
    expect(validateEvent(event({ ev: "totally_made_up_event" })).length).toBeGreaterThan(0);
  });

  it("rejects an unknown top-level key and an unknown fields key", () => {
    expect(validateEvent(event({ note: "hello" })).length).toBeGreaterThan(0);
    const v = validateEvent(event({ fields: { ...event().fields, extra: "nope" } }));
    expect(v.some((x) => x.path === "fields.extra")).toBe(true);
  });

  it("rejects free text shaped like a sentence, and never echoes the value in the violation", () => {
    const smuggled = "customer said the deal is off";
    const v = validateEvent(event({ ev: "error", fields: { code: "network", scrubbed_message: smuggled } }));
    expect(v.length).toBeGreaterThan(0);
    expect(JSON.stringify(v).includes(smuggled)).toBe(false);
  });

  it("rejects a negative/non-integer seq, a bad schema_v, and a bad platform", () => {
    expect(validateEvent(event({ seq: -1 })).length).toBeGreaterThan(0);
    expect(validateEvent(event({ seq: 1.5 })).length).toBeGreaterThan(0);
    expect(validateEvent(event({ schema_v: 2 })).length).toBeGreaterThan(0);
    expect(validateEvent(event({ platform: "toaster" })).length).toBeGreaterThan(0);
  });

  it("accepts a model id with hyphens/dots but rejects one with spaces", () => {
    expect(validateEvent(event({ fields: { ...event().fields, model: "gpt-5.2" } }))).toEqual([]);
    expect(validateEvent(event({ fields: { ...event().fields, model: "some model with spaces" } })).length).toBeGreaterThan(0);
  });

  it("rejects a non-object input outright", () => {
    expect(validateEvent(null).length).toBeGreaterThan(0);
    expect(validateEvent("text").length).toBeGreaterThan(0);
    expect(validateEvent([]).length).toBeGreaterThan(0);
  });
});

describe("charsBucket", () => {
  it("matches the Rust mirror's boundaries", () => {
    expect(charsBucket(0)).toBe("under_500");
    expect(charsBucket(500)).toBe("under_500");
    expect(charsBucket(501)).toBe("under_2000");
    expect(charsBucket(2000)).toBe("under_2000");
    expect(charsBucket(2001)).toBe("under_10000");
    expect(charsBucket(10_001)).toBe("over_10000");
  });
});

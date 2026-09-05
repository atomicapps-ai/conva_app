import { describe, expect, it } from "vitest";

import { LATENCY_BUCKETS_MS, TelemetryCollector, quantile, safeCode, serializeAggregate, validateAggregate, type TelemetryAggregate } from "@/lib/live/telemetry";

function collector(now = () => 1_000) {
  return new TelemetryCollector({ clientBuild: "abc1234", os: "windows", now });
}

describe("TelemetryCollector — samples fold into one content-free aggregate", () => {
  it("counts starts/ends/sources, histograms latencies with p50/p95, and resets on flush", () => {
    let t = 1_000;
    const c = collector(() => t);
    expect(c.flush()).toBeNull();
    c.record({ kind: "session.start", outcome: "refused", code: "not_entitled" });
    c.record({ kind: "session.start", outcome: "ok" });
    for (const ms of [100, 300, 700, 1200, 2000, 4000, 9000]) c.record({ kind: "transcript", channel: "self", final: true, est_latency_ms: ms });
    c.record({ kind: "transcript", channel: "remote_mix", final: false, est_latency_ms: 450 });
    c.record({ kind: "source.gap", channel: "self" });
    c.record({ kind: "source.degraded", channel: "remote_mix", code: "track_ended" });
    c.record({ kind: "source.recovered", channel: "remote_mix" });
    c.record({ kind: "source.reconnect", attempt: 1, outcome: "failed" });
    c.record({ kind: "source.reconnect", attempt: 2, outcome: "ok" });
    c.record({ kind: "ally", ally_kind: "question", outcome: "ok", first_token_ms: 420, total_ms: 2100 });
    c.record({ kind: "ally", ally_kind: "summarize", outcome: "error", code: "upstream_529", total_ms: 800 });
    c.record({ kind: "session.end", reason: "stopped", duration_ms: 65_000, sources: 2 });
    t = 31_000;
    const a = c.flush()!;
    expect(a.schema).toBe(1);
    expect(a.client_build).toBe("abc1234");
    expect(a.os).toBe("windows");
    expect(a.window_start_unix_ms).toBe(1_000);
    expect(a.window_end_unix_ms).toBe(31_000);
    expect(a.samples).toBe(18);
    expect(a.session_start).toEqual({ ok: 1, refused: 1, refused_by_code: { not_entitled: 1 } });
    expect(a.session_end.count).toBe(1);
    expect(a.session_end.by_reason).toEqual({ stopped: 1 });
    expect(a.session_end.sources_sum).toBe(2);
    const fin = a.transcript.final_by_channel.self!;
    expect(fin.count).toBe(7);
    expect(fin.buckets).toEqual([1, 1, 1, 1, 1, 1, 1]);
    expect(fin.buckets).toHaveLength(LATENCY_BUCKETS_MS.length + 1);
    expect(fin.p50_ms).toBe(1200);
    expect(fin.p95_ms).toBe(9000);
    expect(a.transcript.partial_by_channel.remote_mix!.count).toBe(1);
    expect(a.source).toEqual({
      degraded_by_channel: { remote_mix: 1 },
      degraded_by_code: { track_ended: 1 },
      recovered_by_channel: { remote_mix: 1 },
      gaps_by_channel: { self: 1 },
      reconnect: { attempts: 2, ok: 1, failed: 1, exhausted: 0 },
    });
    expect(a.ally.by_kind).toEqual({ question: 1, summarize: 1 });
    expect(a.ally.by_outcome).toEqual({ ok: 1, error: 1 });
    expect(a.ally.by_code).toEqual({ upstream_529: 1 });
    expect(a.ally.first_token_ms.count).toBe(1);
    expect(a.ally.total_ms.count).toBe(2);
    expect(validateAggregate(a)).toEqual([]);
    expect(c.flush()).toBeNull();
    expect(c.size).toBe(0);
  });

  it("quantile is nearest-rank; safeCode never lets free text through", () => {
    expect(quantile([], 0.5)).toBeNull();
    expect(quantile([5, 1, 3], 0.5)).toBe(3);
    expect(quantile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.95)).toBe(10);
    expect(safeCode("Not_Entitled")).toBe("not_entitled");
    expect(safeCode("the customer said hello")).toBe("other");
    expect(safeCode("we_lost_the_deal")).toBe("other", "shape alone is not enough — vocabulary decides");
    expect(safeCode("upstream_529")).toBe("upstream_529");
    expect(safeCode("bye_quota")).toBe("bye_quota");
    expect(safeCode(undefined)).toBe("none");
    const c = collector();
    c.record({ kind: "session.start", outcome: "refused", code: "Please call me back at 555-0100" });
    c.record({ kind: "session.end", reason: "Live session ended: the gateway reported an error.", duration_ms: 1, sources: 1 });
    const a = c.flush()!;
    expect(a.session_start.refused_by_code).toEqual({ other: 1 });
    expect(a.session_end.by_reason).toEqual({ other: 1 });
    expect(JSON.stringify(a)).not.toMatch(/555|customer|gateway reported/);
  });
});

describe("validateAggregate — the allow-list is the content firewall", () => {
  const valid = (): TelemetryAggregate => {
    const c = collector();
    c.record({ kind: "session.start", outcome: "ok" });
    return c.flush()!;
  };

  it("accepts a real aggregate and rejects every way of smuggling text", () => {
    expect(validateAggregate(valid())).toEqual([]);
    const cases: Array<[string, (a: TelemetryAggregate) => unknown]> = [
      ["free text as a code key", (a) => ({ ...a, session_start: { ...a.session_start, refused_by_code: { "hello world": 1 } } })],
      ["unknown top-level key", (a) => ({ ...a, note: "the caller mentioned pricing" })],
      ["unknown nested key", (a) => ({ ...a, source: { ...a.source, transcript_text: "hi" } })],
      ["string where a number belongs", (a) => ({ ...a, samples: "twelve" })],
      ["unknown channel", (a) => ({ ...a, source: { ...a.source, gaps_by_channel: { "Bob's mic": 1 } } })],
      ["wrong bucket count", (a) => ({ ...a, ally: { ...a.ally, total_ms: { ...a.ally.total_ms, buckets: [1, 2] } } })],
      ["bad os", (a) => ({ ...a, os: "toaster" })],
      ["bad build", (a) => ({ ...a, client_build: "build with spaces" })],
      ["hyphenated slug as a code key", (a) => ({ ...a, ally: { ...a.ally, by_code: { "canary-telemetry-saffron-66": 1 } } })],
      ["over-long code key", (a) => ({ ...a, ally: { ...a.ally, by_code: { ["a".repeat(49)]: 1 } } })],
      ["wrong schema", (a) => ({ ...a, schema: 2 })],
      ["negative number", (a) => ({ ...a, samples: -1 })],
      ["array instead of object", () => []],
      ["ally kind not in enum", (a) => ({ ...a, ally: { ...a.ally, by_kind: { poem: 1 } } })],
    ];
    for (const [name, mutate] of cases) {
      const v = validateAggregate(mutate(valid()));
      expect(v.length, name).toBeGreaterThan(0);
      expect(JSON.stringify(v), `${name}: violation paths must not echo keys`).not.toMatch(/hello world|Bob|poem|canary|pricing/);
    }
    expect(serializeAggregate(valid())).toContain('"schema":1');
    expect(serializeAggregate({ ...valid(), os: "toaster" } as unknown as TelemetryAggregate)).toBeNull();
  });
});

import { describe, expect, it } from "vitest";

import { fetchLiveUsage, toUsageSummary } from "@/lib/live/usage";
import type { LiveUsage } from "@/lib/live/protocol";

const USAGE: LiveUsage = {
  day: "2027-01-15",
  day_start_unix: 1_799_971_200,
  resets_at_unix: 1_800_057_600,
  live: { used_ms: 240_000, audio_ms: 200_000, limit_ms: 10_800_000, remaining_ms: 10_560_000, sessions: 1, active_sessions: 0, max_concurrent_sessions: 1, max_duration_s: 10_800 },
  ally: { requests: 3, failed: 1, limit: 200, remaining: 197, input_tokens: 120, output_tokens: 18 },
  limits: { max_minutes_per_day: 180, max_concurrent_sessions: 1, max_duration_s: 10_800, ally_max_requests_per_day: 200 },
  beta_access: true,
};

describe("hosted usage → legacy UsageSummary", () => {
  it("folds Ally counters into one anthropic bucket and time listening into listening_ms", () => {
    const s = toUsageSummary(USAGE, "claude-opus-5", 5_000);
    expect(s.providers).toEqual([{ provider: "anthropic", input_tokens: 120, output_tokens: 18, requests: 3 }]);
    expect(s.llm_features).toEqual([{ feature: "ally", provider: "anthropic", model: "claude-opus-5", input_tokens: 120, output_tokens: 18, requests: 3, failed_requests: 1 }]);
    expect(s.total_requests).toBe(3);
    expect(s.listening_ms).toBe(240_000);
    expect(s.since_unix_ms).toBe(1_799_971_200_000);
    expect(s.updated_at_unix_ms).toBe(5_000);
    expect(s.tavily_searches).toBe(0);
    const empty = toUsageSummary({ ...USAGE, ally: { ...USAGE.ally, requests: 0, input_tokens: 0, output_tokens: 0 } }, null);
    expect(empty.providers).toEqual([]);
    expect(empty.llm_features).toEqual([]);
  });

  it("fetchLiveUsage: cookie credentials; coded refusals for 401/503/network", async () => {
    let seen: RequestInit | undefined;
    const ok = (async (_u: string | URL | Request, init?: RequestInit) => {
      seen = init;
      return new Response(JSON.stringify(USAGE), { status: 200 });
    }) as typeof fetch;
    expect(await fetchLiveUsage(ok)).toEqual(USAGE);
    expect(seen?.credentials).toBe("same-origin");
    const refuse = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as typeof fetch;
    await expect(fetchLiveUsage(refuse(401, { error: "signed_out" }))).rejects.toMatchObject({ code: "signed_out" });
    await expect(fetchLiveUsage(refuse(503, { error: "unconfigured", reason: "session backend: no KV" }))).rejects.toMatchObject({ code: "unconfigured", message: "session backend: no KV" });
    await expect(fetchLiveUsage(refuse(500, "oops"))).rejects.toMatchObject({ code: "http_500" });
    const net = (async () => {
      throw new TypeError("Failed to fetch");
    }) as typeof fetch;
    await expect(fetchLiveUsage(net)).rejects.toMatchObject({ code: "network" });
  });
});

import { describe, expect, it } from "vitest";

import { formatRelativeTime } from "@/lib/relativeTime";

const NOW = new Date("2026-08-28T12:00:00Z").getTime();

describe("formatRelativeTime", () => {
  it("shows 'just now' under a minute", () => {
    expect(formatRelativeTime(NOW - 30_000, NOW)).toBe("just now");
  });

  it("shows minutes under an hour", () => {
    expect(formatRelativeTime(NOW - 5 * 60_000, NOW)).toBe("5m ago");
  });

  it("shows hours under a day", () => {
    expect(formatRelativeTime(NOW - 3 * 3_600_000, NOW)).toBe("3h ago");
  });

  it("shows days under a month", () => {
    expect(formatRelativeTime(NOW - 6 * 86_400_000, NOW)).toBe("6d ago");
  });

  it("falls back to a short date beyond a month", () => {
    const overAMonthAgo = NOW - 40 * 86_400_000;
    const result = formatRelativeTime(overAMonthAgo, NOW);
    expect(result).not.toMatch(/ago$/);
    expect(result.length).toBeGreaterThan(0);
  });
});

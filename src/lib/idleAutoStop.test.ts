import { describe, expect, it } from "vitest";

import { shouldIdleStop } from "@/lib/idleAutoStop";

describe("shouldIdleStop", () => {
  const NOW = 1_000_000_000;

  it("fires once the elapsed silence reaches the threshold", () => {
    const threshold = 5;
    const justUnder = NOW - (threshold * 60_000 - 1);
    const atThreshold = NOW - threshold * 60_000;
    expect(shouldIdleStop(justUnder, NOW, threshold)).toBe(false);
    expect(shouldIdleStop(atThreshold, NOW, threshold)).toBe(true);
  });

  it("is disabled by null, zero, or negative thresholds", () => {
    const longAgo = NOW - 60 * 60_000;
    expect(shouldIdleStop(longAgo, NOW, null)).toBe(false);
    expect(shouldIdleStop(longAgo, NOW, 0)).toBe(false);
    expect(shouldIdleStop(longAgo, NOW, -5)).toBe(false);
  });
});

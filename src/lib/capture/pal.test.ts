import { describe, expect, it } from "vitest";

import { coverageOf, type CaptureStatus } from "./pal";

const st = (channel: CaptureStatus["channel"], phase: CaptureStatus["phase"]): CaptureStatus => ({
  source_id: `${channel}-${phase}`, kind: channel === "self" ? "mic" : "display", channel, phase, reason: null,
});

describe("coverageOf", () => {
  it("derives both / self_only / remote_only / none from CAPTURING sources only", () => {
    expect(coverageOf([])).toBe("none");
    expect(coverageOf([st("self", "capturing")])).toBe("self_only");
    expect(coverageOf([st("self", "capturing"), st("remote_mix", "capturing")])).toBe("both");
    expect(coverageOf([st("self", "capturing"), st("remote_mix", "degraded")])).toBe("self_only");
    expect(coverageOf([st("self", "ended"), st("remote_mix", "capturing")])).toBe("remote_only");
    expect(coverageOf([st("self", "prompting")])).toBe("none");
  });
});

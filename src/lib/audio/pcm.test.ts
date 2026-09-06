import { describe, expect, it } from "vitest";

import { downmix, floatToPcm16, LinearResampler, rmsDbfs } from "./pcm";

describe("pcm helpers", () => {
  it("downmix averages channels; single channel passes through", () => {
    const l = Float32Array.from([1, 0, -1]);
    const r = Float32Array.from([0, 0, 1]);
    expect([...downmix([l, r])]).toEqual([0.5, 0, 0]);
    expect(downmix([l])).toBe(l);
    expect(downmix([]).length).toBe(0);
  });
  it("floatToPcm16 scales and clips", () => {
    expect([...floatToPcm16(Float32Array.from([0, 1, -1, 2, -2, 0.5]))]).toEqual([0, 32767, -32768, 32767, -32768, 16384]);
  });
  it("rmsDbfs: silence → -90, full-scale square → 0", () => {
    expect(rmsDbfs(new Float32Array(100))).toBe(-90);
    expect(rmsDbfs(Float32Array.from([1, -1, 1, -1]))).toBeCloseTo(0, 5);
    expect(rmsDbfs(new Float32Array(0))).toBe(-90);
  });
  it("LinearResampler 48k→16k yields ~1/3 the samples and preserves a DC level, across blocks", () => {
    const rs = new LinearResampler(48_000, 16_000);
    let total = 0;
    for (let b = 0; b < 10; b++) {
      const out = rs.process(new Float32Array(480).fill(0.25));
      total += out.length;
      for (const v of out) expect(v).toBeCloseTo(0.25, 6);
    }
    expect(total).toBeGreaterThanOrEqual(1590);
    expect(total).toBeLessThanOrEqual(1610);
  });
  it("LinearResampler is identity at equal rates and rejects bad rates", () => {
    const rs = new LinearResampler(16_000, 16_000);
    const x = Float32Array.from([0.1, 0.2]);
    expect(rs.process(x)).toBe(x);
    expect(() => new LinearResampler(0, 16_000)).toThrow(RangeError);
  });
});

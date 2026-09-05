import { describe, expect, it } from "vitest";

import { AudioBatcher } from "./batcher";

const block = (n: number, v = 1) => new Int16Array(n).fill(v);

describe("AudioBatcher", () => {
  it("cuts 200 ms frames (3200 samples) with monotonic seq and source-clock timestamps", () => {
    const b = new AudioBatcher(0, { frameMs: 200 });
    b.push(block(1600), 0);
    expect(b.readyCount).toBe(0);
    b.push(block(1600), 100);
    b.push(block(4800, 2), 200);
    expect(b.readyCount).toBe(2);
    const [f0, f1] = b.take(5);
    expect(f0!.seq).toBe(0);
    expect(f0!.captured_at_ms).toBe(0);
    expect(f0!.samples.length).toBe(3200);
    expect(f1!.seq).toBe(1);
    expect(f1!.captured_at_ms).toBe(200);
    expect(f1!.samples[0]).toBe(2);
    expect(b.readyCount).toBe(0);
  });
  it("flush emits the partial trailing frame; resetEpoch restarts seq", () => {
    const b = new AudioBatcher(1);
    b.push(block(100), 0);
    const [f] = b.flush();
    expect(f!.samples.length).toBe(100);
    expect(f!.source_index).toBe(1);
    expect(f!.seq).toBe(0);
    b.resetEpoch();
    b.push(block(3200), 500);
    expect(b.take(1)[0]!.seq).toBe(0);
  });
  it("caps unsent audio at MAX_BUFFERED_MS by dropping the OLDEST frames and recording a gap", () => {
    const b = new AudioBatcher(0, { frameMs: 200, maxBufferedMs: 1000 });
    for (let i = 0; i < 10; i++) b.push(block(3200), i * 200); // 2 s queued, cap 1 s
    expect(b.readyCount).toBe(5);
    expect(b.gaps.length).toBeGreaterThanOrEqual(1);
    expect(b.droppedMs).toBe(1000);
    const first = b.take(1)[0]!;
    expect(first.captured_at_ms).toBe(1000); // oldest kept frame
    expect(b.gaps[0]!.from_ms).toBe(0);
  });
  it("clamps frame size into the protocol range", () => {
    expect(new AudioBatcher(0, { frameMs: 10 }).frameSamples).toBe(1600);
    expect(new AudioBatcher(0, { frameMs: 5000 }).frameSamples).toBe(4000);
  });
});

/**
 * Audio batcher — pure. Collects PCM16 mono blocks from a source into
 * gateway-sized frames (100–250 ms), assigns per-epoch sequence numbers, and
 * enforces the unsent-audio cap: when more than MAX_BUFFERED_MS is waiting
 * (no credit / socket stalled) the oldest audio is DROPPED and a gap is
 * recorded, never buffered without bound (architecture §11/§12). No I/O.
 * Unit-tested in batcher.test.ts.
 */
import { FRAME_MS_MAX, FRAME_MS_MIN, MAX_BUFFERED_MS, SAMPLE_RATE_HZ, type AudioFrame } from "@/lib/live/protocol";

export interface Gap {
  /** Source-clock ms where dropped audio started / ended. */
  from_ms: number;
  to_ms: number;
  dropped_ms: number;
}

export interface BatcherOptions {
  sampleRateHz?: number;
  frameMs?: number;
  maxBufferedMs?: number;
}

export class AudioBatcher {
  readonly sampleRateHz: number;
  readonly frameSamples: number;
  readonly maxBufferedSamples: number;
  private sourceIndex: number;
  private seq = 0;
  private pending: Int16Array[] = [];
  private pendingSamples = 0;
  /** Source clock (ms) of the first pending sample. */
  private pendingStartMs = 0;
  private ready: AudioFrame[] = [];
  private readySamples = 0;
  readonly gaps: Gap[] = [];
  private droppedSamples = 0;

  constructor(sourceIndex: number, opts: BatcherOptions = {}) {
    this.sourceIndex = sourceIndex;
    this.sampleRateHz = opts.sampleRateHz ?? SAMPLE_RATE_HZ;
    const frameMs = Math.min(FRAME_MS_MAX, Math.max(FRAME_MS_MIN, opts.frameMs ?? 200));
    this.frameSamples = Math.round((frameMs * this.sampleRateHz) / 1000);
    this.maxBufferedSamples = Math.round(((opts.maxBufferedMs ?? MAX_BUFFERED_MS) * this.sampleRateHz) / 1000);
  }

  /** The server assigns the index on attach; a reconnect may re-assign it. */
  setSourceIndex(i: number): void {
    this.sourceIndex = i;
  }

  /** New epoch (reconnect): sequence restarts, buffered audio is kept. */
  resetEpoch(): void {
    this.seq = 0;
  }

  /** Feed a block captured at `capturedAtMs` (source clock, first sample). */
  push(samples: Int16Array, capturedAtMs: number): void {
    if (samples.length === 0) return;
    if (this.pendingSamples === 0) this.pendingStartMs = capturedAtMs;
    this.pending.push(samples);
    this.pendingSamples += samples.length;
    while (this.pendingSamples >= this.frameSamples) this.cutFrame();
    this.enforceCap();
  }

  /** Frames ready to send, oldest first (does not remove them — see `take`). */
  get readyCount(): number {
    return this.ready.length;
  }

  /** Remove and return up to `n` ready frames (credit-limited by the caller). */
  take(n: number): AudioFrame[] {
    const out = this.ready.splice(0, Math.max(0, n));
    for (const f of out) this.readySamples -= f.samples.length;
    return out;
  }

  /** Flush a partial trailing frame (on stop). */
  flush(): AudioFrame[] {
    if (this.pendingSamples > 0) this.cutFrame(this.pendingSamples);
    return this.take(this.ready.length);
  }

  /** Total dropped so far, in ms — a content-free health metric. */
  get droppedMs(): number {
    return (this.droppedSamples * 1000) / this.sampleRateHz;
  }

  private cutFrame(size = this.frameSamples): void {
    const frame = new Int16Array(size);
    let filled = 0;
    while (filled < size && this.pending.length > 0) {
      const head = this.pending[0]!;
      const need = size - filled;
      if (head.length <= need) {
        frame.set(head, filled);
        filled += head.length;
        this.pending.shift();
      } else {
        frame.set(head.subarray(0, need), filled);
        this.pending[0] = head.subarray(need);
        filled += need;
      }
    }
    this.pendingSamples -= filled;
    const capturedAtMs = this.pendingStartMs;
    this.pendingStartMs += (filled * 1000) / this.sampleRateHz;
    this.ready.push({ source_index: this.sourceIndex, seq: this.seq++, captured_at_ms: Math.round(capturedAtMs), samples: frame });
    this.readySamples += filled;
  }

  /** Drop the OLDEST ready frames until under the cap; record one gap span. */
  private enforceCap(): void {
    if (this.readySamples + this.pendingSamples <= this.maxBufferedSamples) return;
    let from: number | null = null;
    let to: number | null = null;
    let dropped = 0;
    while (this.ready.length > 0 && this.readySamples + this.pendingSamples > this.maxBufferedSamples) {
      const f = this.ready.shift()!;
      this.readySamples -= f.samples.length;
      dropped += f.samples.length;
      from ??= f.captured_at_ms;
      to = f.captured_at_ms + (f.samples.length * 1000) / this.sampleRateHz;
    }
    if (dropped > 0 && from !== null && to !== null) {
      this.droppedSamples += dropped;
      this.gaps.push({ from_ms: from, to_ms: Math.round(to), dropped_ms: Math.round((dropped * 1000) / this.sampleRateHz) });
    }
  }
}

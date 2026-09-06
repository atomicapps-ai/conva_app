/**
 * Pure PCM helpers for the browser capture path — no DOM, no React, no I/O.
 * Used by the AudioWorklet-fed batcher (main thread/worker side) to turn what
 * the browser gives us (float32, device rate, 1–2 channels) into what the
 * gateway takes (PCM16 mono at 16 kHz — protocol.ts SAMPLE_RATE_HZ).
 * Unit-tested in pcm.test.ts.
 */

/** Average N interleaved-per-channel planar buffers into one mono buffer. */
export function downmix(channels: readonly Float32Array[]): Float32Array {
  if (channels.length === 0) return new Float32Array(0);
  if (channels.length === 1) return channels[0]!;
  const n = channels[0]!.length;
  const out = new Float32Array(n);
  for (const ch of channels) for (let i = 0; i < n; i++) out[i] = (out[i] ?? 0) + (ch[i] ?? 0);
  const k = 1 / channels.length;
  for (let i = 0; i < n; i++) out[i] = (out[i] ?? 0) * k;
  return out;
}

/**
 * Linear-interpolation resampler with carry-over state so consecutive blocks
 * join without clicks. Good enough for speech to 16 kHz (the desktop engine
 * does the same job with a higher-order filter; quality is validated later
 * against the synthetic corpus, not assumed).
 */
export class LinearResampler {
  private readonly ratio: number;
  /** Fractional read position carried into the next block. */
  private pos = 0;
  /** Last input sample of the previous block, for interpolation across blocks. */
  private last: number | null = null;

  constructor(
    readonly fromHz: number,
    readonly toHz: number,
  ) {
    if (fromHz <= 0 || toHz <= 0) throw new RangeError("sample rates must be positive");
    this.ratio = fromHz / toHz;
  }

  process(input: Float32Array): Float32Array {
    if (this.fromHz === this.toHz) return input;
    // Virtual input = [last, ...input]; positions are relative to `last` at -1.
    const out: number[] = [];
    const n = input.length;
    let p = this.pos;
    const at = (i: number): number => (i < 0 ? (this.last ?? input[0] ?? 0) : (input[i] ?? 0));
    while (p < n - 1 || (this.last !== null && p < n - 1 + 1e-9)) {
      const i0 = Math.floor(p);
      const frac = p - i0;
      const a = at(i0);
      const b = at(i0 + 1);
      out.push(a + (b - a) * frac);
      p += this.ratio;
    }
    this.pos = p - n;
    this.last = n > 0 ? (input[n - 1] ?? 0) : this.last;
    return Float32Array.from(out);
  }
}

/** Float32 [-1, 1] → Int16 with clipping. */
export function floatToPcm16(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const v = Math.max(-1, Math.min(1, input[i] ?? 0));
    out[i] = v < 0 ? Math.round(v * 32768) : Math.round(v * 32767);
  }
  return out;
}

/** RMS level in dBFS of a float block; −90 for silence (clamped). */
export function rmsDbfs(input: Float32Array): number {
  if (input.length === 0) return -90;
  let acc = 0;
  for (let i = 0; i < input.length; i++) {
    const v = input[i] ?? 0;
    acc += v * v;
  }
  const rms = Math.sqrt(acc / input.length);
  if (rms <= 0) return -90;
  return Math.max(-90, 20 * Math.log10(rms));
}

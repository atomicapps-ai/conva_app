/**
 * Browser-only glue: MediaStream → AudioContext → AudioWorklet → blocks.
 * Nothing here is unit-tested (it needs a real AudioContext); everything that
 * can be pure lives in pcm.ts / batcher.ts and IS tested. Each source gets its
 * own context so a failing device never takes the other side down.
 */
import { floatToPcm16, LinearResampler, rmsDbfs } from "./pcm";
import { SAMPLE_RATE_HZ } from "@/lib/live/protocol";

export interface PcmBlock {
  /** Source clock, ms since this graph started (first sample of the block). */
  capturedAtMs: number;
  samples: Int16Array;
  /** Level of the block before conversion (for the meter; ≤10 Hz publish is the caller's job). */
  rmsDbfs: number;
}

export interface AudioGraph {
  stop(): Promise<void>;
}

const WORKLET_URL = new URL("./worklet/pcm-capture.worklet.js", import.meta.url);

/**
 * Start feeding `onBlock` with 16 kHz PCM16 mono blocks from `stream`.
 * `capturedAtMs` uses the AudioContext clock normalized to 0 at start.
 */
export async function startAudioGraph(
  stream: MediaStream,
  onBlock: (block: PcmBlock) => void,
): Promise<AudioGraph> {
  const ctx = new AudioContext();
  await ctx.audioWorklet.addModule(WORKLET_URL);
  const source = ctx.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(ctx, "pcm-capture", { numberOfOutputs: 0 });
  const resampler = new LinearResampler(ctx.sampleRate, SAMPLE_RATE_HZ);
  let t0: number | null = null;
  node.port.onmessage = (e: MessageEvent<{ t: number; samples: Float32Array }>) => {
    const { t, samples } = e.data;
    if (t0 === null) t0 = t;
    const level = rmsDbfs(samples);
    const pcm = floatToPcm16(resampler.process(samples));
    if (pcm.length > 0) onBlock({ capturedAtMs: Math.round((t - t0) * 1000), samples: pcm, rmsDbfs: level });
  };
  source.connect(node);
  return {
    async stop() {
      node.port.onmessage = null;
      try {
        source.disconnect();
        node.disconnect();
      } finally {
        await ctx.close().catch(() => {});
      }
    },
  };
}

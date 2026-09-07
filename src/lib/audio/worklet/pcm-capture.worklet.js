/* conva — AudioWorkletProcessor for the browser capture path.
 *
 * Runs on the audio render thread. It does ONE thing: copy each render
 * quantum's channels (downmixed to mono, float32, device sample rate) to the
 * main thread over the port. No allocation beyond the outgoing buffer, no
 * network, no logging, no resampling here (architecture §7A.4 / §11) — the
 * batcher (src/lib/audio/batcher.ts) resamples/encodes off this thread.
 *
 * Message: { t: <currentTime seconds>, samples: Float32Array } (transferred).
 */
class PcmCaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const n = input[0].length;
    const mono = new Float32Array(n);
    if (input.length === 1) {
      mono.set(input[0]);
    } else {
      const k = 1 / input.length;
      for (let c = 0; c < input.length; c++) {
        const ch = input[c];
        for (let i = 0; i < n; i++) mono[i] += ch[i] * k;
      }
    }
    this.port.postMessage({ t: currentTime, samples: mono }, [mono.buffer]);
    return true;
  }
}

registerProcessor("pcm-capture", PcmCaptureProcessor);

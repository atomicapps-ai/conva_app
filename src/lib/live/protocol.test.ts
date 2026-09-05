import { describe, expect, it } from "vitest";

import { decodeAudioFrame, encodeAudioFrame, frameDurationMs, helloFrame, parseClientFrame, parseServerFrame, AUDIO_HEADER_BYTES } from "./protocol";

describe("live protocol — audio frame codec", () => {
  it("round-trips header + PCM16 little-endian", () => {
    const samples = Int16Array.from([0, 1, -1, 32767, -32768]);
    const buf = encodeAudioFrame({ source_index: 3, seq: 99, captured_at_ms: 4_000_000_000, samples });
    expect(buf.byteLength).toBe(AUDIO_HEADER_BYTES + 10);
    const f = decodeAudioFrame(buf)!;
    expect(f.source_index).toBe(3);
    expect(f.seq).toBe(99);
    expect(f.captured_at_ms).toBe(4_000_000_000);
    expect([...f.samples]).toEqual([...samples]);
    expect(new DataView(buf).getInt16(AUDIO_HEADER_BYTES + 6, true)).toBe(32767);
  });
  it("rejects short, mismatched and wrong-version frames", () => {
    const buf = encodeAudioFrame({ source_index: 0, seq: 0, captured_at_ms: 0, samples: new Int16Array(4) });
    expect(decodeAudioFrame(buf.slice(0, 10))).toBeNull();
    expect(decodeAudioFrame(buf.slice(0, buf.byteLength - 2))).toBeNull();
    const bad = buf.slice(0);
    new DataView(bad).setUint8(0, 2);
    expect(decodeAudioFrame(bad)).toBeNull();
    expect(() => encodeAudioFrame({ source_index: 300, seq: 0, captured_at_ms: 0, samples: new Int16Array(0) })).toThrow(RangeError);
  });
  it("frameDurationMs at 16 kHz", () => {
    expect(frameDurationMs(1600)).toBe(100);
    expect(frameDurationMs(4000)).toBe(250);
  });
});

describe("live protocol — control frames", () => {
  it("parses valid server frames and rejects malformed ones", () => {
    expect(parseServerFrame(JSON.stringify({ type: "ready", protocol: 1, session_id: "s", provider: "deepgram", initial_credit: 10 }))?.type).toBe("ready");
    expect(parseServerFrame(JSON.stringify({ type: "ready", protocol: 2, session_id: "s", provider: "x", initial_credit: 1 }))).toBeNull();
    expect(parseServerFrame(JSON.stringify({ type: "credit", source_id: "a", frames: -1 }))).toBeNull();
    expect(parseServerFrame(JSON.stringify({ type: "transcript", event: { schema_version: 2 } }))).toBeNull();
    expect(parseServerFrame(JSON.stringify({ type: "error", code: "internal", message: "x", fatal: true }))?.type).toBe("error");
    expect(parseServerFrame(JSON.stringify({ type: "hello" }))).toBeNull();
    expect(parseServerFrame("{")).toBeNull();
  });
  it("parses valid client frames, rejects wrong rate/format", () => {
    expect(parseClientFrame(JSON.stringify(helloFrame("abc")))?.type).toBe("hello");
    const attach = { type: "source.attach", source_id: "m", kind: "mic", channel: "self", epoch: 0, sample_rate_hz: 16000, format: "pcm16" };
    expect(parseClientFrame(JSON.stringify(attach))?.type).toBe("source.attach");
    expect(parseClientFrame(JSON.stringify({ ...attach, format: "opus" }))).toBeNull();
    expect(parseClientFrame(JSON.stringify({ type: "cancel" }))).toBeNull();
  });
});

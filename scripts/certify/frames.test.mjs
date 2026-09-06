import { describe, expect, it } from "vitest";
import { acceptKey, decodeAudioFrame, decodeFrames, encodeFrame, fixtureEventsFor, summarizeSource, synthWav, EXPECTED_FINALS } from "./lib.mjs";

describe("certification harness helpers", () => {
  it("WebSocket accept key and frame codec (small, 16-bit, masked) round-trip", () => {
    expect(acceptKey("dGhlIHNhbXBsZSBub25jZQ==")).toBe("s3pPLMBiTxaQ9kYGzzhZRbK+xOo=");
    const text = encodeFrame(1, "hello");
    expect([...text.subarray(0, 2)]).toEqual([0x81, 5]);
    const big = encodeFrame(2, Buffer.alloc(300, 7));
    expect(big[1]).toBe(126);
    expect(big.readUInt16BE(2)).toBe(300);
    // a masked client frame
    const payload = Buffer.from('{"type":"hello"}');
    const mask = Buffer.from([1, 2, 3, 4]);
    const masked = Buffer.from(payload.map((b, i) => b ^ mask[i & 3]));
    const client = Buffer.concat([Buffer.from([0x81, 0x80 | payload.length]), mask, masked]);
    const { frames, rest } = decodeFrames(Buffer.concat([client, client.subarray(0, 3)]));
    expect(frames).toHaveLength(1);
    expect(frames[0].opcode).toBe(1);
    expect(frames[0].payload.toString()).toBe('{"type":"hello"}');
    expect(rest.length).toBe(3);
  });

  it("fixture events follow the contract: partials then a final per utterance, monotonic seq, correct channel/speaker, expected finals", () => {
    const { events, nextSeq } = fixtureEventsFor("self", { id: "mic-self", kind: "mic" }, "live_x", 0, 0, 1_000);
    expect(nextSeq).toBe(5);
    expect(events.map((e) => e.event.seq)).toEqual([0, 1, 2, 3, 4]);
    expect(events.filter((e) => e.event.payload.is_final).map((e) => e.event.payload.text)).toEqual(EXPECTED_FINALS.filter((f) => f.channel === "self").map((f) => f.text));
    expect(events.every((e) => e.event.channel === "self" && e.event.payload.speaker_ref === "self" && e.event.schema_version === 1)).toBe(true);
    expect(events[1].event.payload.replaces_event_id).toBe(events[0].event.event_id);
    expect(events[0].atMs).toBeLessThan(events[1].atMs);
    const remote = fixtureEventsFor("remote_mix", { id: "share-remote", kind: "display" }, "live_x", 0, 5, 1_000);
    expect(remote.events[0].event.seq).toBe(5);
    expect(remote.events[0].event.payload.speaker_ref).toBe("remote:unknown");
    expect(remote.events[0].event.payload.segment_id).toBe("inbound-1");
  });

  it("synthWav is a valid mono 16-bit RIFF with sound during the fixture's utterances and silence between", () => {
    const wav = synthWav({ sampleRate: 16_000, seconds: 12 });
    expect(wav.toString("ascii", 0, 4)).toBe("RIFF");
    expect(wav.readUInt16LE(22)).toBe(1);
    expect(wav.readUInt32LE(24)).toBe(16_000);
    const pcm = new Int16Array(wav.buffer, wav.byteOffset + 44, (wav.length - 44) / 2);
    const rms = (from, to) => Math.sqrt(pcm.subarray(from * 16, to * 16).reduce((a, s) => a + s * s, 0) / ((to - from) * 16));
    expect(rms(500, 1500)).toBeGreaterThan(3000); // inside self utterance 1
    expect(rms(3500, 4500)).toBe(0); // remote speaks, mic silent
    expect(rms(7500, 8500)).toBeGreaterThan(3000); // self utterance 2
  });

  it("decodeAudioFrame reads the 16-byte header and PCM stats; summarizeSource derives seconds and dBFS", () => {
    const samples = 3200;
    const buf = Buffer.alloc(16 + samples * 2);
    buf[0] = 1;
    buf[1] = 0;
    buf.writeUInt32LE(7, 4);
    buf.writeUInt32LE(1200, 8);
    buf.writeUInt32LE(samples, 12);
    for (let i = 0; i < samples; i++) buf.writeInt16LE(i % 2 ? 1000 : -1000, 16 + i * 2);
    const f = decodeAudioFrame(buf);
    expect(f).toMatchObject({ source_index: 0, seq: 7, captured_at_ms: 1200, samples, peak: 1000 });
    expect(Math.round(f.rms)).toBe(1000);
    expect(decodeAudioFrame(Buffer.alloc(10))).toBeNull();
    const sum = summarizeSource({ id: "mic-self", kind: "mic", channel: "self", frames: 50, samples: 160_000, rmsSum: 50 * 1000, peak: 1000, seqGaps: 0, voicedFrames: 20 });
    expect(sum.audio_seconds).toBe(10);
    expect(sum.mean_frame_ms).toBe(200);
    expect(sum.rms_dbfs).toBe(-30.3);
  });
});

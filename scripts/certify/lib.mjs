/* Certification harness — pure helpers (unit-tested): a minimal RFC 6455 frame
 * codec for the fake gateway, a synthetic WAV for Chromium's fake microphone,
 * the two-channel fixture script as gateway-side transcript events, and PCM
 * statistics. No I/O in here. */
import { createHash } from "node:crypto";

// ── WebSocket frames (server side: receive masked, send unmasked) ───────────
export const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
export function acceptKey(key) {
  return createHash("sha1").update(key + WS_GUID).digest("base64");
}

/** Encode one server→client frame. opcode 1 text, 2 binary, 8 close, 9 ping, 10 pong. */
export function encodeFrame(opcode, payload) {
  const data = typeof payload === "string" ? Buffer.from(payload, "utf8") : Buffer.from(payload || []);
  let header;
  if (data.length < 126) header = Buffer.from([0x80 | opcode, data.length]);
  else if (data.length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(data.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(data.length), 2);
  }
  return Buffer.concat([header, data]);
}

/** Decode as many complete frames as `buf` holds; returns { frames, rest }. Fragmentation is not needed by our client. */
export function decodeFrames(buf) {
  const frames = [];
  let off = 0;
  while (buf.length - off >= 2) {
    const b0 = buf[off];
    const b1 = buf[off + 1];
    const opcode = b0 & 0x0f;
    const masked = (b1 & 0x80) !== 0;
    let len = b1 & 0x7f;
    let p = off + 2;
    if (len === 126) {
      if (buf.length - p < 2) break;
      len = buf.readUInt16BE(p);
      p += 2;
    } else if (len === 127) {
      if (buf.length - p < 8) break;
      len = Number(buf.readBigUInt64BE(p));
      p += 8;
    }
    let mask = null;
    if (masked) {
      if (buf.length - p < 4) break;
      mask = buf.subarray(p, p + 4);
      p += 4;
    }
    if (buf.length - p < len) break;
    const payload = Buffer.from(buf.subarray(p, p + len));
    if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
    frames.push({ opcode, payload });
    off = p + len;
  }
  return { frames, rest: buf.subarray(off) };
}

// ── the fixture script (mirror of src/lib/capture/fixtures/twoChannel.ts) ───
export const FIXTURE_SCRIPT = [
  { who: "self", n: 1, startMs: 0, texts: ["morning", "morning did the vendor", "Morning — did the vendor send the revised quote?"] },
  { who: "remote", n: 1, startMs: 3200, texts: ["they did", "they did it's fourteen", "They did, it's fourteen thousand now, down from forty."] },
  { who: "self", n: 2, startMs: 7000, texts: ["great let's", "Great, let's lock it in before Friday."] },
  { who: "remote", n: 2, startMs: 9400, texts: ["I'll send the", "I'll send the paperwork tonight."] },
];
export const EXPECTED_FINALS = FIXTURE_SCRIPT.map((u) => ({ channel: u.who === "self" ? "self" : "remote_mix", text: u.texts[u.texts.length - 1] }));
/** Partial cadence and the final's delay after the utterance start (ms). */
export const PARTIAL_STEP_MS = 450;
export const FINAL_LATENCY_MS = 320;

/**
 * Gateway-side transcript events for one attached source, per the capture
 * contract (schema 1). `seqStart` continues the per-source seq; the caller
 * schedules each event at `atMs` (relative to first audio of that source).
 */
export function fixtureEventsFor(channel, source, sessionId, epoch = 0, seqStart = 0, nowUnixMs = Date.now()) {
  const who = channel === "self" ? "self" : "remote";
  const out = [];
  let seq = seqStart;
  for (const u of FIXTURE_SCRIPT.filter((x) => x.who === who)) {
    const segment_id = `${channel === "self" ? "outbound" : "inbound"}-${u.n}`;
    let prevId = null;
    u.texts.forEach((text, i) => {
      const isFinal = i === u.texts.length - 1;
      const atMs = u.startMs + (isFinal ? PARTIAL_STEP_MS * (u.texts.length - 1) + FINAL_LATENCY_MS : PARTIAL_STEP_MS * (i + 1));
      const event_id = `${source.id}-e${epoch}-s${seq}`;
      out.push({
        atMs,
        event: {
          schema_version: 1,
          event_id,
          session_id: sessionId,
          source_id: source.id,
          source_kind: source.kind,
          channel,
          epoch,
          seq,
          captured_at_ms: u.startMs,
          emitted_at_unix_ms: nowUnixMs + atMs,
          payload: {
            segment_id,
            text,
            is_final: isFinal,
            start_ms: u.startMs,
            end_ms: u.startMs + Math.max(400, atMs - u.startMs),
            confidence: isFinal ? 0.92 : null,
            latency_ms: FINAL_LATENCY_MS,
            revision: i,
            replaces_event_id: prevId,
            speaker_ref: channel === "self" ? "self" : "remote:unknown",
            display_label: null,
          },
        },
      });
      prevId = event_id;
      seq += 1;
    });
  }
  return { events: out, nextSeq: seq };
}

// ── synthetic WAV for --use-file-for-fake-audio-capture ─────────────────────
/** Mono 16-bit PCM WAV: tone bursts (distinct per utterance) over the fixture's timing, silence elsewhere. */
export function synthWav({ sampleRate = 48_000, seconds = 14, who = "self" } = {}) {
  const n = Math.floor(sampleRate * seconds);
  const pcm = new Int16Array(n);
  const bursts = FIXTURE_SCRIPT.filter((u) => u.who === who).map((u, i) => ({ from: u.startMs, to: u.startMs + 2400, hz: 330 + 110 * i }));
  for (let i = 0; i < n; i++) {
    const tMs = (i / sampleRate) * 1000;
    const b = bursts.find((x) => tMs >= x.from && tMs < x.to);
    if (!b) continue;
    const env = Math.min(1, (tMs - b.from) / 60, (b.to - tMs) / 60);
    pcm[i] = Math.round(Math.sin((2 * Math.PI * b.hz * i) / sampleRate) * 0.35 * 32767 * env);
  }
  const data = Buffer.from(pcm.buffer);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

// ── audio frame header (mirror of src/lib/live/protocol.ts) ─────────────────
export const AUDIO_HEADER_BYTES = 16;
export function decodeAudioFrame(buf) {
  if (buf.length < AUDIO_HEADER_BYTES || buf[0] !== 1) return null;
  const count = buf.readUInt32LE(12);
  if (buf.length !== AUDIO_HEADER_BYTES + count * 2) return null;
  let sumSq = 0;
  let peak = 0;
  for (let i = 0; i < count; i++) {
    const s = buf.readInt16LE(AUDIO_HEADER_BYTES + i * 2);
    sumSq += s * s;
    if (Math.abs(s) > peak) peak = Math.abs(s);
  }
  return { source_index: buf[1], seq: buf.readUInt32LE(4), captured_at_ms: buf.readUInt32LE(8), samples: count, rms: count ? Math.sqrt(sumSq / count) : 0, peak };
}

/** Fold per-frame stats into a per-source summary. */
export function summarizeSource(s) {
  const seconds = s.samples / 16_000;
  const rmsDbfs = s.rmsSum > 0 && s.frames > 0 ? 20 * Math.log10(s.rmsSum / s.frames / 32768) : -Infinity;
  return {
    id: s.id,
    kind: s.kind,
    channel: s.channel,
    frames: s.frames,
    samples: s.samples,
    audio_seconds: Math.round(seconds * 100) / 100,
    mean_frame_ms: s.frames ? Math.round((seconds * 1000) / s.frames) : 0,
    rms_dbfs: Number.isFinite(rmsDbfs) ? Math.round(rmsDbfs * 10) / 10 : null,
    peak: s.peak,
    seq_gaps: s.seqGaps,
    voiced_frames: s.voicedFrames,
  };
}

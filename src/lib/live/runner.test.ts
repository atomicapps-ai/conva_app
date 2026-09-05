import { describe, expect, it, vi } from "vitest";

import type { MediaAdapter, StreamLike, TrackLike } from "@/lib/audio/captureCoordinator";
import type { PcmBlock } from "@/lib/audio/audioGraph";
import type { SessionStateEvent, TranscriptSegment } from "@/lib/ipc";

import { LiveSessionRunner, MIC_SOURCE_ID } from "./runner";
import type { SocketLike } from "./liveClient";
import { decodeAudioFrame, type ServerFrame } from "./protocol";

function track(): TrackLike & { stopped: boolean } {
  const t = { kind: "audio" as const, readyState: "live" as const, stopped: false, onended: null, stop() { t.stopped = true; } };
  return t;
}
class FakeSocket implements SocketLike {
  readyState = 0; binaryType = ""; sent: Array<string | ArrayBuffer> = [];
  onopen: ((ev: unknown) => void) | null = null; onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code: number; reason: string; wasClean: boolean }) => void) | null = null; onerror: ((ev: unknown) => void) | null = null;
  send(d: string | ArrayBuffer) { this.sent.push(d); }
  close(code = 1000, reason = "") { this.readyState = 3; this.onclose?.({ code, reason, wasClean: true }); }
  open() { this.readyState = 1; this.onopen?.(null); }
  serverSend(f: ServerFrame) { this.onmessage?.({ data: JSON.stringify(f) }); }
}

describe("LiveSessionRunner — fake mic → batcher → socket → transcript → legacy segment", () => {
  it("runs the whole pipeline and stops cleanly", async () => {
    const t = track();
    const stream: StreamLike = { getAudioTracks: () => [t], getVideoTracks: () => [] };
    const media: MediaAdapter = { getUserMedia: async () => stream, getDisplayMedia: async () => stream };
    let feed: ((b: PcmBlock) => void) | null = null;
    let graphStopped = false;
    const sockets: FakeSocket[] = [];
    const states: SessionStateEvent[] = [];
    const segments: TranscriptSegment[] = [];
    const levels: number[] = [];
    let now = 1_000_000;
    const runner = new LiveSessionRunner(
      {
        media,
        startGraph: async (_s, onBlock) => { feed = onBlock; return { stop: async () => { graphStopped = true; } }; },
        client: {
          fetch: vi.fn(async () => new Response(JSON.stringify({ session_id: "live_9", ticket: "t", stream_url: "/api/live/stream", expires_at_unix: 0, limits: { max_duration_s: 1, max_sources: 2 } }), { status: 201 })) as unknown as typeof fetch,
          socket: () => { const s = new FakeSocket(); sockets.push(s); return s; },
          setTimeout: () => 0,
        },
        now: () => now,
        meterIntervalMs: 100,
      },
      { sessionState: (e) => states.push(e), transcriptSegment: (s) => segments.push(s), audioLevel: (l) => levels.push(l.rms_dbfs) },
    );

    const started = runner.start({ processing_mode: "hosted", retention_mode: "ephemeral", context_id: null });
    for (let i = 0; i < 50 && sockets.length === 0; i++) await new Promise((r) => setTimeout(r, 0));
    const s = sockets[0]!;
    s.open();
    s.serverSend({ type: "ready", protocol: 1, session_id: "live_9", provider: "fake", initial_credit: 5 });
    expect(await started).toBe("live_9");
    expect(states.map((e) => e.state)).toEqual(["preparing", "preparing", "listening"]);
    expect(runner.session.phase).toBe("live");
    expect(feed).not.toBeNull();

    s.serverSend({ type: "source.attached", source_id: "mic-self", source_index: 0, epoch: 0 });
    s.serverSend({ type: "credit", source_id: "mic-self", frames: 5 });
    // 400 ms of audio in 100 ms blocks → two 200 ms frames.
    for (let i = 0; i < 4; i++) { now += 100; feed!({ capturedAtMs: i * 100, samples: new Int16Array(1600).fill(7), rmsDbfs: -20 }); }
    const audio = s.sent.filter((x): x is ArrayBuffer => x instanceof ArrayBuffer).map((b) => decodeAudioFrame(b)!);
    expect(audio.map((f) => f.seq)).toEqual([0, 1]);
    expect(audio[1]!.captured_at_ms).toBe(200);
    expect(levels.length).toBeGreaterThanOrEqual(2); // throttled to ≤10 Hz

    s.serverSend({ type: "transcript", event: { schema_version: 1, event_id: "e1", session_id: "live_9", source_id: "mic-self", source_kind: "mic", channel: "self", epoch: 0, seq: 0, captured_at_ms: 0, emitted_at_unix_ms: now,
      payload: { segment_id: "self-0-1", text: "hello from the browser", is_final: true, start_ms: 0, end_ms: 400, confidence: 0.9, latency_ms: 0, revision: 0, replaces_event_id: null, speaker_ref: "self", display_label: null, language: "en", provider: "fake", legacy: null } } });
    expect(segments.length).toBe(1);
    expect(segments[0]).toMatchObject({ side: "outbound", text: "hello from the browser", is_final: true });

    await runner.stop();
    await runner.stop();
    expect(graphStopped).toBe(true);
    expect(t.stopped).toBe(true);
    expect(runner.session.phase).toBe("finalized");
    expect(states.at(-1)).toEqual({ state: "idle" });
    expect(s.sent.filter((x) => typeof x === "string" && JSON.parse(x).type === "stop").length).toBe(1);
  });

  it("a denied microphone fails the start with a precise error and never touches the network", async () => {
    const media: MediaAdapter = { getUserMedia: async () => { throw Object.assign(new Error("denied"), { name: "NotAllowedError" }); }, getDisplayMedia: async () => { throw new Error("no"); } };
    const fetchMock = vi.fn();
    const states: SessionStateEvent[] = [];
    const runner = new LiveSessionRunner({ media, startGraph: async () => ({ stop: async () => {} }), client: { fetch: fetchMock as unknown as typeof fetch, socket: () => new FakeSocket() } }, { sessionState: (e) => states.push(e) });
    await expect(runner.start({ processing_mode: "hosted", retention_mode: "ephemeral", context_id: null })).rejects.toMatchObject({ code: "denied" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(states.at(-1)).toMatchObject({ state: "error" });
  });

  it("a refused server session releases the microphone", async () => {
    const t = track();
    const stream: StreamLike = { getAudioTracks: () => [t], getVideoTracks: () => [] };
    const media: MediaAdapter = { getUserMedia: async () => stream, getDisplayMedia: async () => stream };
    const runner = new LiveSessionRunner({ media, startGraph: async () => ({ stop: async () => {} }), client: { fetch: (async () => new Response(JSON.stringify({ error: "not_entitled" }), { status: 403 })) as unknown as typeof fetch, socket: () => new FakeSocket() } });
    await expect(runner.start({ processing_mode: "hosted", retention_mode: "ephemeral", context_id: null })).rejects.toMatchObject({ code: "not_entitled" });
    expect(t.stopped).toBe(true);
    expect(runner.session.phase).toBe("failed");
  });
});

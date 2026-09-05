import { describe, expect, it, vi } from "vitest";

import type { MediaAdapter, StreamLike, TrackLike } from "@/lib/audio/captureCoordinator";
import type { PcmBlock } from "@/lib/audio/audioGraph";
import type { SessionStateEvent, TranscriptSegment } from "@/lib/ipc";

import { LiveSessionRunner, MIC_SOURCE_ID } from "./runner";
import type { SocketLike } from "./liveClient";
import { decodeAudioFrame, type ServerFrame } from "./protocol";

function track(): TrackLike & { stopped: boolean; fireEnded: () => void } {
  const listeners: Array<() => void> = [];
  const t = {
    kind: "audio" as "audio" | "video",
    readyState: "live" as "live" | "ended",
    stopped: false,
    onended: null as (() => void) | null,
    stop() { t.stopped = true; t.readyState = "ended"; },
    addEventListener(_: "ended", cb: () => void) { listeners.push(cb); },
    fireEnded() { t.readyState = "ended"; for (const l of listeners) l(); },
  };
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

describe("LiveSessionRunner — share call audio as a second source", () => {
  function shareHarness(shareTracks: () => { audio: TrackLike[]; video: TrackLike[] }) {
    const micTrack = track();
    const micStream: StreamLike = { getAudioTracks: () => [micTrack], getVideoTracks: () => [] };
    let shareStream: StreamLike | null = null;
    const media: MediaAdapter = {
      getUserMedia: async () => micStream,
      getDisplayMedia: async () => {
        const t = shareTracks();
        shareStream = { getAudioTracks: () => t.audio, getVideoTracks: () => t.video };
        return shareStream;
      },
    };
    const feeds = new Map<StreamLike, (b: PcmBlock) => void>();
    const stopped: StreamLike[] = [];
    const sockets: FakeSocket[] = [];
    const statuses: string[][] = [];
    const notices: string[] = [];
    const runner = new LiveSessionRunner(
      {
        media,
        startGraph: async (s, onBlock) => { feeds.set(s, onBlock); return { stop: async () => { stopped.push(s); } }; },
        client: {
          fetch: vi.fn(async () => new Response(JSON.stringify({ session_id: "live_s", ticket: "t", stream_url: "/api/live/stream", expires_at_unix: 0, limits: { max_duration_s: 1, max_sources: 2 } }), { status: 201 })) as unknown as typeof fetch,
          socket: () => { const s = new FakeSocket(); sockets.push(s); return s; },
          setTimeout: () => 0,
        },
        now: () => 1,
      },
      { captureStatus: (s) => statuses.push(s.map((x) => `${x.source_id}:${x.phase}`)), notice: (c) => notices.push(c) },
    );
    const startAndReady = async () => {
      const started = runner.start({ processing_mode: "hosted", retention_mode: "ephemeral", context_id: null });
      for (let i = 0; i < 50 && sockets.length === 0; i++) await new Promise((r) => setTimeout(r, 0));
      const s = sockets[0]!;
      s.open();
      s.serverSend({ type: "ready", protocol: 1, session_id: "live_s", provider: "fake", initial_credit: 5 });
      await started;
      s.serverSend({ type: "source.attached", source_id: "mic-self", source_index: 0, epoch: 0 });
      s.serverSend({ type: "credit", source_id: "mic-self", frames: 5 });
      return s;
    };
    return { runner, startAndReady, feeds, stopped, sockets, statuses, notices, micStream, micTrack, get shareStream() { return shareStream; } };
  }

  it("attaches the shared source to the same socket, routes its audio with its own index, and reports both sides", async () => {
    const audio = track();
    const video = track();
    (video as { kind: string }).kind = "video";
    const h = shareHarness(() => ({ audio: [audio], video: [video] }));
    const s = await h.startAndReady();
    expect(h.statuses.at(-1)).toEqual(["mic-self:capturing"]);

    const id = await h.runner.startShare("share-op-1");
    expect(id).toBe("share-remote");
    expect((video as { stopped: boolean }).stopped).toBe(true);
    const attach = s.sent.filter((x): x is string => typeof x === "string").map((x) => JSON.parse(x)).find((f) => f.type === "source.attach" && f.source_id === "share-remote");
    expect(attach).toMatchObject({ kind: "display", channel: "remote_mix", epoch: 0 });
    expect(h.statuses.at(-1)).toEqual(["mic-self:capturing", "share-remote:capturing"]);

    s.serverSend({ type: "source.attached", source_id: "share-remote", source_index: 1, epoch: 0 });
    s.serverSend({ type: "credit", source_id: "share-remote", frames: 5 });
    const shareFeed = h.feeds.get(h.shareStream!)!;
    shareFeed({ capturedAtMs: 0, samples: new Int16Array(3200).fill(3), rmsDbfs: -30 });
    const frames = s.sent.filter((x): x is ArrayBuffer => x instanceof ArrayBuffer).map((b) => decodeAudioFrame(b)!);
    expect(frames.at(-1)!.source_index).toBe(1);

    await h.runner.stopSource("share-remote");
    expect(h.stopped).toContain(h.shareStream);
    expect(audio.stopped).toBe(true);
    expect(h.micTrack.stopped).toBe(false);
    const detach = s.sent.filter((x): x is string => typeof x === "string").map((x) => JSON.parse(x)).find((f) => f.type === "source.detach");
    expect(detach).toMatchObject({ source_id: "share-remote", reason: "user" });
    expect(h.notices).toContain("share_ended");
    expect(h.statuses.at(-1)).toEqual(["mic-self:capturing", "share-remote:ended"]);
    expect(h.runner.session.phase).toBe("live");
  });

  it("a selection without audio is a truthful failure and the mic keeps running; sharing before Start is refused", async () => {
    const video = track();
    (video as { kind: string }).kind = "video";
    const h = shareHarness(() => ({ audio: [], video: [video] }));
    await expect(h.runner.startShare("early")).rejects.toMatchObject({ code: "no_session" });
    await h.startAndReady();
    await expect(h.runner.startShare("share-op")).rejects.toMatchObject({ code: "no_audio_track" });
    expect((video as { stopped: boolean }).stopped).toBe(true);
    expect(h.runner.session.phase).toBe("live");
    expect(h.statuses.at(-1)).toEqual(["mic-self:capturing", "share-remote:idle"]);
  });

  it("when the shared track ends, the share is torn down (detach + graph stop) and the session is 'you only'; sharing again works", async () => {
    const audios: ReturnType<typeof track>[] = [];
    const h = shareHarness(() => { const a = track(); audios.push(a); return { audio: [a], video: [] }; });
    const s = await h.startAndReady();
    await h.runner.startShare("share-1");
    audios[0]!.fireEnded();
    await new Promise((r) => setTimeout(r, 0));
    expect(h.statuses.at(-1)).toEqual(["mic-self:capturing", "share-remote:ended"]);
    expect(s.sent.filter((x): x is string => typeof x === "string").map((x) => JSON.parse(x)).some((f) => f.type === "source.detach" && f.reason === "ended")).toBe(true);
    expect(h.runner.session.phase).toBe("live");
    const again = await h.runner.startShare("share-2");
    expect(again).toBe("share-remote");
    expect(h.statuses.at(-1)).toEqual(["mic-self:capturing", "share-remote:capturing"]);
  });

  it("recover(shareId) re-opens the chooser for an ended share; the mic and unknown ids are refused with codes", async () => {
    const audios: ReturnType<typeof track>[] = [];
    const h = shareHarness(() => { const a = track(); audios.push(a); return { audio: [a], video: [] }; });
    await h.startAndReady();
    await h.runner.startShare("share-1");
    audios[0]!.fireEnded();
    await new Promise((r) => setTimeout(r, 0));
    expect(h.statuses.at(-1)).toEqual(["mic-self:capturing", "share-remote:ended"]);
    expect(await h.runner.recover("share-remote", "rec-1")).toBe("share-remote");
    expect(h.statuses.at(-1)).toEqual(["mic-self:capturing", "share-remote:capturing"]);
    await expect(h.runner.recover("mic-self", "rec-2")).rejects.toMatchObject({ code: "unsupported_source" });
    await expect(h.runner.recover("ghost", "rec-3")).rejects.toMatchObject({ code: "unknown_source" });
  });
});

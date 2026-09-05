import { describe, expect, it } from "vitest";

import { CaptureCoordinator, classifyMediaError, type MediaAdapter, type StreamLike, type TrackLike } from "./captureCoordinator";

function track(kind: "audio" | "video"): TrackLike & { stopped: boolean; fireEnded: () => void } {
  const t = {
    kind,
    readyState: "live" as "live" | "ended",
    stopped: false,
    onended: null as (() => void) | null,
    listeners: [] as Array<() => void>,
    stop() { t.stopped = true; t.readyState = "ended"; },
    addEventListener(_: "ended", cb: () => void) { t.listeners.push(cb); },
    fireEnded() { t.readyState = "ended"; for (const l of t.listeners) l(); t.onended?.(); },
  };
  return t;
}
function stream(tracks: TrackLike[]): StreamLike {
  return { getAudioTracks: () => tracks.filter((t) => t.kind === "audio"), getVideoTracks: () => tracks.filter((t) => t.kind === "video") };
}
/** A media adapter whose prompts resolve when the test says so. */
function media() {
  const pending: Array<{ resolve: (s: StreamLike) => void; reject: (e: unknown) => void; kind: "mic" | "share" }> = [];
  const adapter: MediaAdapter = {
    getUserMedia: () => new Promise((resolve, reject) => pending.push({ resolve, reject, kind: "mic" })),
    getDisplayMedia: () => new Promise((resolve, reject) => pending.push({ resolve, reject, kind: "share" })),
  };
  return { adapter, pending };
}
const err = (name: string) => Object.assign(new Error(name), { name });

describe("CaptureCoordinator", () => {
  it("never prompts on construction; startMic prompts, granted → capturing with the stream kept", async () => {
    const m = media();
    const c = new CaptureCoordinator(m.adapter);
    expect(m.pending.length).toBe(0);
    const p = c.startMic("mic", "op1");
    expect(c.sources.get("mic")!.phase).toBe("prompting");
    const a = track("audio");
    m.pending[0]!.resolve(stream([a]));
    const out = await p;
    expect(out.ok).toBe(true);
    expect(c.sources.get("mic")!.phase).toBe("capturing");
    expect(c.stream("mic")).toBeDefined();
  });
  it("denied / not found map to precise reasons and return the source to idle", async () => {
    const m = media();
    const c = new CaptureCoordinator(m.adapter);
    const p = c.startMic("mic", "op1");
    m.pending[0]!.reject(err("NotAllowedError"));
    const out = await p;
    expect(out).toMatchObject({ ok: false, reason: "denied" });
    expect(c.sources.get("mic")!.phase).toBe("idle");
    expect(classifyMediaError(err("NotFoundError")).reason).toBe("not_found");
    expect(classifyMediaError(err("NotSupportedError")).reason).toBe("unsupported");
    expect(classifyMediaError(new Error("boom")).reason).toBe("error");
  });
  it("a stream arriving after cancel is released (tracks stopped), never captured", async () => {
    const m = media();
    const c = new CaptureCoordinator(m.adapter);
    const p = c.startMic("mic", "op1");
    expect(c.cancel("op1")).toBe(true);
    const a = track("audio");
    m.pending[0]!.resolve(stream([a]));
    const out = await p;
    expect(out).toMatchObject({ ok: false, reason: "cancelled" });
    expect(a.stopped).toBe(true);
    expect(c.stream("mic")).toBeUndefined();
    expect(c.sources.get("mic")!.phase).toBe("idle");
  });
  it("share with no audio track is a truthful no_audio_track failure and the video is released", async () => {
    const m = media();
    const c = new CaptureCoordinator(m.adapter);
    const p = c.startShare("share", "op1");
    const v = track("video");
    m.pending[0]!.resolve(stream([v]));
    const out = await p;
    expect(out).toMatchObject({ ok: false, reason: "no_audio_track" });
    expect(v.stopped).toBe(true);
  });
  it("share with audio keeps audio, stops video; a track ending degrades only that source", async () => {
    const m = media();
    const changes: string[] = [];
    const c = new CaptureCoordinator(m.adapter, { onSourceChange: (s, ev) => changes.push(`${s.id}:${ev.type}`) });
    const mic = c.startMic("mic", "op1");
    m.pending[0]!.resolve(stream([track("audio")]));
    await mic;
    const sh = c.startShare("share", "op2");
    const a = track("audio");
    const v = track("video");
    m.pending[1]!.resolve(stream([a, v]));
    const out = await sh;
    expect(out.ok).toBe(true);
    expect(v.stopped).toBe(true);
    expect(a.stopped).toBe(false);
    a.fireEnded();
    expect(c.sources.get("share")!.phase).toBe("degraded");
    expect(c.sources.get("mic")!.phase).toBe("capturing");
    expect(changes).toContain("share:degrade");
  });
  it("a second start on an active source is refused; stopAll is idempotent and ends every source", async () => {
    const m = media();
    const c = new CaptureCoordinator(m.adapter);
    const p = c.startMic("mic", "op1");
    const a = track("audio");
    m.pending[0]!.resolve(stream([a]));
    await p;
    expect((await c.startMic("mic", "op2")).ok).toBe(false);
    c.stopAll();
    c.stopAll();
    expect(a.stopped).toBe(true);
    expect(c.sources.get("mic")!.phase).toBe("ended");
  });
});

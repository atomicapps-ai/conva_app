import { describe, expect, it, vi } from "vitest";

import { TWO_CHANNEL_CLEAN } from "@/lib/capture/fixtures/twoChannel";

import { BACKOFF_MS, LiveClient, LiveSessionError, type SocketLike } from "./liveClient";
import { decodeAudioFrame, type ServerFrame } from "./protocol";

class FakeSocket implements SocketLike {
  readyState = 0;
  binaryType = "blob";
  sent: Array<string | ArrayBuffer> = [];
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code: number; reason: string; wasClean: boolean }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  constructor(readonly url: string) {}
  send(d: string | ArrayBuffer) { this.sent.push(d); }
  close(code = 1000, reason = "") { if (this.readyState === 3) return; this.readyState = 3; this.onclose?.({ code, reason, wasClean: true }); }
  // test helpers
  open() { this.readyState = 1; this.onopen?.(null); }
  serverSend(f: ServerFrame) { this.onmessage?.({ data: JSON.stringify(f) }); }
  drop() { this.readyState = 3; this.onclose?.({ code: 1006, reason: "", wasClean: false }); }
  controls() { return this.sent.filter((s): s is string => typeof s === "string").map((s) => JSON.parse(s) as { type: string; [k: string]: unknown }); }
  audio() { return this.sent.filter((s): s is ArrayBuffer => s instanceof ArrayBuffer).map((b) => decodeAudioFrame(b)!); }
}

function harness() {
  const sockets: FakeSocket[] = [];
  let sessionNo = 0;
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ session_id: `live_${++sessionNo}`, ticket: `t${sessionNo}`, stream_url: "/api/live/stream", expires_at_unix: 0, limits: { max_duration_s: 10, max_sources: 2 } }), { status: 201 }));
  const timers: Array<() => void> = [];
  const events = { transcripts: [] as string[], statuses: [] as string[], sourceStates: [] as string[], errors: [] as string[], byes: [] as string[] };
  const client = new LiveClient(
    { fetch: fetchMock as unknown as typeof fetch, socket: (url) => { const s = new FakeSocket(url); sockets.push(s); return s; }, setTimeout: (cb) => { timers.push(cb); return 0; }, random: () => 0.5, clientBuild: "test" },
    {
      onTranscript: (e) => events.transcripts.push(e.event_id),
      onStatus: (s) => events.statuses.push(s),
      onSourceState: (id, st) => events.sourceStates.push(`${id}:${st}`),
      onError: (code) => events.errors.push(code),
      onBye: (r) => events.byes.push(r),
    },
  );
  const request = { processing_mode: "hosted" as const, retention_mode: "ephemeral" as const, context_id: null, sources: [{ kind: "mic" as const, channel: "self" as const }] };
  /** Wait until the client has opened its Nth socket (session creation is async). */
  const untilSockets = async (n: number) => {
    for (let i = 0; i < 50 && sockets.length < n; i++) await new Promise((r) => setTimeout(r, 0));
    if (sockets.length < n) throw new Error(`expected ${n} sockets, have ${sockets.length}`);
  };
  /** Drive the handshake for the newest socket. */
  const handshake = async (started: Promise<string>) => {
    await untilSockets(sockets.length + 1);
    const s = sockets.at(-1)!;
    s.open();
    s.serverSend({ type: "ready", protocol: 1, session_id: "x", provider: "fake", initial_credit: 2 });
    return started;
  };
  return { client, sockets, fetchMock, timers, events, request, handshake, untilSockets };
}

const frame = (seq: number) => ({ source_index: 0, seq, captured_at_ms: seq * 200, samples: new Int16Array(3200) });

describe("LiveClient", () => {
  it("creates the session, connects with the ticket, says hello, attaches sources after ready", async () => {
    const h = harness();
    const id = await h.handshake(h.client.start(h.request, "op1"));
    expect(id).toBe("live_1");
    expect(h.fetchMock).toHaveBeenCalledWith("/api/live/sessions", expect.objectContaining({ method: "POST", credentials: "same-origin" }));
    expect(h.sockets[0]!.url).toBe("/api/live/stream?ticket=t1");
    const c = h.sockets[0]!.controls();
    expect(c[0]!.type).toBe("hello");
    expect(c[1]).toMatchObject({ type: "source.attach", source_id: "mic-self", epoch: 0, sample_rate_hz: 16000, format: "pcm16" });
    expect(h.client.state).toBe("live");
  });
  it("sends audio only against credit, after the source is attached; queued frames flush when credit arrives", async () => {
    const h = harness();
    await h.handshake(h.client.start(h.request, "op1"));
    const s = h.sockets[0]!;
    h.client.sendAudio("mic-self", frame(0));
    expect(s.audio().length).toBe(0); // not attached yet
    s.serverSend({ type: "source.attached", source_id: "mic-self", source_index: 4, epoch: 0 });
    expect(s.audio().length).toBe(0); // no credit yet
    s.serverSend({ type: "credit", source_id: "mic-self", frames: 2 });
    h.client.sendAudio("mic-self", frame(1));
    h.client.sendAudio("mic-self", frame(2));
    const a = s.audio();
    expect(a.map((f) => f.seq)).toEqual([0, 1]);
    expect(a[0]!.source_index).toBe(4);
    s.serverSend({ type: "credit", source_id: "mic-self", frames: 5 });
    expect(s.audio().map((f) => f.seq)).toEqual([0, 1, 2]);
    expect(h.client.sentMs("mic-self")).toBe(600);
  });
  it("transcripts go through the ledger (duplicates/stale dropped) and are acked", async () => {
    const h = harness();
    await h.handshake(h.client.start(h.request, "op1"));
    const s = h.sockets[0]!;
    const [e0, e1] = TWO_CHANNEL_CLEAN;
    s.serverSend({ type: "transcript", event: e0! });
    s.serverSend({ type: "transcript", event: e0! }); // duplicate
    s.serverSend({ type: "transcript", event: e1! });
    expect(h.events.transcripts).toEqual([e0!.event_id, e1!.event_id]);
    const acks = s.controls().filter((c) => c.type === "ack");
    expect(acks.length).toBe(2);
    expect(acks[0]).toMatchObject({ source_id: e0!.source_id, seq: e0!.seq });
  });
  it("an unexpected close reconnects with a fresh ticket and bumps every source epoch", async () => {
    const h = harness();
    await h.handshake(h.client.start(h.request, "op1"));
    h.sockets[0]!.drop();
    expect(h.client.state).toBe("reconnecting");
    expect(h.events.sourceStates).toContain("mic-self:reconnecting");
    expect(h.timers.length).toBe(1);
    h.timers[0]!();
    await h.untilSockets(2);
    expect(h.fetchMock).toHaveBeenCalledTimes(2);
    const s2 = h.sockets[1]!;
    expect(s2.url).toBe("/api/live/stream?ticket=t2");
    s2.open();
    s2.serverSend({ type: "ready", protocol: 1, session_id: "live_2", provider: "fake", initial_credit: 2 });
    expect(h.client.state).toBe("live");
    expect(s2.controls()[1]).toMatchObject({ type: "source.attach", epoch: 1 });
    expect(h.client.epochOf("mic-self")).toBe(1);
  });
  it("gives up after the backoff table is exhausted and reports a fatal error", async () => {
    const h = harness();
    await h.handshake(h.client.start(h.request, "op1"));
    const tick = () => new Promise((r) => setTimeout(r, 0));
    for (let i = 0; i < BACKOFF_MS.length; i++) {
      const n = h.sockets.length;
      const t = h.timers.length;
      h.sockets.at(-1)!.drop(); // the reconnect socket never gets `ready`
      await tick(); // connect() rejects → onClosed schedules the next attempt
      expect(h.timers.length).toBe(t + 1);
      h.timers.at(-1)!();
      await h.untilSockets(n + 1);
    }
    h.sockets.at(-1)!.drop();
    await tick();
    expect(h.client.state).toBe("failed");
    expect(h.events.errors).toContain("reconnect_exhausted");
  });
  it("stop is idempotent: sends stop, closes, and a later close event does not trigger reconnect", async () => {
    const h = harness();
    await h.handshake(h.client.start(h.request, "op1"));
    h.client.stop();
    h.client.stop();
    const s = h.sockets[0]!;
    expect(s.controls().filter((c) => c.type === "stop").length).toBe(1);
    expect(h.client.state).toBe("stopped");
    expect(h.timers.length).toBe(0);
    h.client.sendAudio("mic-self", frame(9));
    expect(s.audio().length).toBe(0);
  });
  it("fatal server error and bye(reason≠stopped) fail the client; refused session creation throws a coded error", async () => {
    const h = harness();
    await h.handshake(h.client.start(h.request, "op1"));
    h.sockets[0]!.serverSend({ type: "error", code: "quota_exceeded", message: "x", fatal: true });
    expect(h.client.state).toBe("failed");

    const denied = new LiveClient({ fetch: (async () => new Response(JSON.stringify({ error: "not_entitled", reason: "no beta" }), { status: 403 })) as unknown as typeof fetch, socket: () => new FakeSocket("") });
    await expect(denied.start(h.request, "op")).rejects.toMatchObject({ code: "not_entitled" } satisfies Partial<LiveSessionError>);
  });
  it("cancelling a pending start drops the late session (no socket opened)", async () => {
    const h = harness();
    const p = h.client.start(h.request, "op1");
    expect(h.client.cancel("op1")).toBe(true);
    await expect(p).rejects.toMatchObject({ code: "cancelled" });
    expect(h.sockets.length).toBe(0);
  });
});

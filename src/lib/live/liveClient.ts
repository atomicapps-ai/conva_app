/**
 * LiveClient — the browser side of the live-session protocol (protocol.ts).
 *
 *  • creates the server session (POST /api/live/sessions → ticket),
 *  • opens the WebSocket, says hello, attaches sources,
 *  • sends audio frames ONLY against server credits (flow control),
 *  • feeds transcript envelopes through the M0 EventLedger (dedupe / order /
 *    stale-epoch) before handing them to the app,
 *  • on an unexpected close: re-mints a ticket, reconnects, re-attaches every
 *    source with epoch+1 (bounded backoff 1/2/4/8 s with jitter),
 *  • stop is idempotent; cancelled operations drop late results.
 *
 * The socket and fetch are injected so the whole thing is unit-tested with a
 * fake socket (liveClient.test.ts). No React, no DOM globals beyond what's
 * injected. Audio *capture* is the coordinator's job; this only transports.
 */
import type { CaptureChannel, CaptureSourceKind, TranscriptEvent } from "@/lib/capture/contract";
import { EventLedger } from "@/lib/capture/ledger";
import { OperationRegistry } from "@/lib/capture/operations";

import {
  encodeAudioFrame,
  helloFrame,
  parseServerFrame,
  type AudioFrame,
  type ClientFrame,
  type CreateSessionRequest,
  type CreateSessionResponse,
  type ServerFrame,
  type SourceState,
} from "./protocol";

/** Minimal socket surface (matches the DOM WebSocket; fakes implement it). */
export interface SocketLike {
  readonly readyState: number;
  binaryType: string;
  send(data: string | ArrayBuffer): void;
  close(code?: number, reason?: string): void;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: { code: number; reason: string; wasClean: boolean }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
}

export type SocketFactory = (url: string) => SocketLike;

export interface LiveClientDeps {
  fetch: typeof fetch;
  socket: SocketFactory;
  /** Same-origin API base (default /api/live). */
  base?: string;
  clientBuild?: string;
  /** Injected timer for tests. */
  setTimeout?: (cb: () => void, ms: number) => unknown;
  random?: () => number;
}

export interface LiveClientEvents {
  onTranscript?(event: TranscriptEvent): void;
  onSourceState?(sourceId: string, state: SourceState, reason?: string): void;
  onStatus?(status: LiveClientStatus, detail?: string): void;
  onError?(code: string, message: string, fatal: boolean): void;
  onBye?(reason: string, usage: Record<string, number>): void;
}

export type LiveClientStatus = "idle" | "creating" | "connecting" | "live" | "reconnecting" | "stopping" | "stopped" | "failed";

interface AttachedSource {
  id: string;
  kind: CaptureSourceKind;
  channel: CaptureChannel;
  epoch: number;
  index: number | null;
  credit: number;
  /** Frames waiting for credit/attachment, oldest first (bounded by the batcher upstream). */
  queue: AudioFrame[];
  sentMs: number;
}

export const BACKOFF_MS = [1000, 2000, 4000, 8000] as const;
export class LiveSessionError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "LiveSessionError";
  }
}

export class LiveClient {
  private readonly base: string;
  private readonly setTimer: (cb: () => void, ms: number) => unknown;
  private readonly rand: () => number;
  private socket: SocketLike | null = null;
  private sessionId: string | null = null;
  private status: LiveClientStatus = "idle";
  private readonly sources = new Map<string, AttachedSource>();
  private readonly byIndex = new Map<number, string>();
  private ledger: EventLedger | null = null;
  readonly operations = new OperationRegistry();
  private request: CreateSessionRequest | null = null;
  private reconnectAttempt = 0;
  private stopping = false;
  private lastUsage: Record<string, number> = {};

  constructor(
    private readonly deps: LiveClientDeps,
    private readonly events: LiveClientEvents = {},
  ) {
    this.base = deps.base ?? "/api/live";
    this.setTimer = deps.setTimeout ?? ((cb, ms) => setTimeout(cb, ms));
    this.rand = deps.random ?? Math.random;
  }

  get state(): LiveClientStatus {
    return this.status;
  }
  get id(): string | null {
    return this.sessionId;
  }
  /** Current epoch of a source (0 before any reconnect). */
  epochOf(sourceId: string): number | null {
    return this.sources.get(sourceId)?.epoch ?? null;
  }

  private setStatus(s: LiveClientStatus, detail?: string): void {
    this.status = s;
    this.events.onStatus?.(s, detail);
  }

  // ── lifecycle ─────────────────────────────────────────────────────────────

  /** Create the server session and connect. Throws LiveSessionError on refusal. */
  async start(request: CreateSessionRequest, operationId: string): Promise<string> {
    if (this.status !== "idle" && this.status !== "stopped" && this.status !== "failed") {
      throw new LiveSessionError("busy", `live client is ${this.status}`);
    }
    this.stopping = false;
    this.request = request;
    this.operations.begin(operationId, "live.start");
    this.setStatus("creating");
    const created = await this.createSession(request);
    if (!this.operations.accept(operationId)) {
      // Cancelled while the server was creating the session: nothing to keep.
      this.setStatus("stopped", "cancelled");
      throw new LiveSessionError("cancelled", "start was cancelled");
    }
    this.sessionId = created.session_id;
    this.ledger = new EventLedger();
    for (const src of request.sources) {
      const id = `${src.kind}-${src.channel}`;
      this.sources.set(id, { id, kind: src.kind, channel: src.channel, epoch: 0, index: null, credit: 0, queue: [], sentMs: 0 });
    }
    await this.connect(created);
    return created.session_id;
  }

  private async createSession(request: CreateSessionRequest): Promise<CreateSessionResponse> {
    const res = await this.deps.fetch(`${this.base}/sessions`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(request),
    });
    const body = (await res.json().catch(() => ({}))) as Partial<CreateSessionResponse> & { error?: string; reason?: string };
    if (res.status === 201 && body.session_id && body.ticket && body.stream_url) return body as CreateSessionResponse;
    const code = body.error ?? (res.status === 401 ? "signed_out" : res.status === 403 ? "not_entitled" : res.status === 503 ? "unconfigured" : `http_${res.status}`);
    throw new LiveSessionError(code, body.reason ?? `Could not create a live session (${res.status}).`);
  }

  private connect(created: CreateSessionResponse): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.setStatus(this.reconnectAttempt > 0 ? "reconnecting" : "connecting");
      const ws = this.deps.socket(`${created.stream_url}?ticket=${encodeURIComponent(created.ticket)}`);
      ws.binaryType = "arraybuffer";
      this.socket = ws;
      let settled = false;
      ws.onopen = () => {
        this.sendControl(helloFrame(this.deps.clientBuild ?? "dev"));
      };
      ws.onmessage = (ev) => {
        if (typeof ev.data !== "string") return; // server never sends binary
        const frame = parseServerFrame(ev.data);
        if (!frame) {
          this.events.onError?.("bad_frame", "unparseable server frame", false);
          return;
        }
        if (frame.type === "ready" && !settled) {
          settled = true;
          this.onReady();
          resolve();
          return;
        }
        this.handle(frame);
      };
      ws.onerror = () => {
        if (!settled) {
          settled = true;
          reject(new LiveSessionError("connect_failed", "WebSocket connection failed"));
        }
      };
      ws.onclose = (ev) => {
        if (this.socket !== ws) return;
        this.socket = null;
        if (!settled) {
          settled = true;
          reject(new LiveSessionError("connect_failed", `socket closed before ready (${ev.code})`));
          return;
        }
        this.onClosed(ev);
      };
    });
  }

  private onReady(): void {
    this.setStatus("live");
    this.reconnectAttempt = 0;
    for (const s of this.sources.values()) {
      s.index = null;
      s.credit = 0;
      this.sendControl({
        type: "source.attach",
        source_id: s.id,
        kind: s.kind,
        channel: s.channel,
        epoch: s.epoch,
        sample_rate_hz: 16_000,
        format: "pcm16",
      });
    }
  }

  private handle(frame: ServerFrame): void {
    switch (frame.type) {
      case "source.attached": {
        const s = this.sources.get(frame.source_id);
        if (!s) return;
        s.index = frame.source_index;
        this.byIndex.set(frame.source_index, s.id);
        this.pump(s);
        return;
      }
      case "credit": {
        const s = this.sources.get(frame.source_id);
        if (!s) return;
        s.credit += frame.frames;
        this.pump(s);
        return;
      }
      case "source.state":
        this.events.onSourceState?.(frame.source_id, frame.state, frame.reason);
        return;
      case "transcript": {
        if (!this.ledger) return;
        const decision = this.ledger.offer(frame.event);
        if (decision.apply) {
          this.events.onTranscript?.(frame.event);
          this.sendControl({ type: "ack", source_id: frame.event.source_id, epoch: frame.event.epoch, seq: frame.event.seq });
        }
        return;
      }
      case "error":
        this.events.onError?.(frame.code, frame.message, frame.fatal);
        if (frame.fatal) {
          this.stopping = true;
          this.setStatus("failed", frame.code);
        }
        return;
      case "bye":
        this.lastUsage = frame.usage.audio_ms_by_source;
        this.stopping = true;
        this.events.onBye?.(frame.reason, frame.usage.audio_ms_by_source);
        this.setStatus(frame.reason === "stopped" || frame.reason === "cancelled" ? "stopped" : "failed", frame.reason);
        return;
      case "ready":
        return; // duplicate ready ignored
    }
  }

  private onClosed(ev: { code: number; reason: string; wasClean: boolean }): void {
    if (this.stopping || this.status === "stopped" || this.status === "failed") {
      if (this.status !== "failed") this.setStatus("stopped", ev.reason || "closed");
      return;
    }
    // Unexpected close → reconnect as a NEW epoch per source (never dedupe
    // across epochs; the server's cursor resets too).
    if (this.reconnectAttempt >= BACKOFF_MS.length) {
      this.setStatus("failed", "reconnect_exhausted");
      this.events.onError?.("reconnect_exhausted", "Could not reconnect to the live gateway.", true);
      return;
    }
    const delay = BACKOFF_MS[this.reconnectAttempt]! * (0.5 + this.rand() * 0.5);
    this.reconnectAttempt += 1;
    this.setStatus("reconnecting", `attempt ${this.reconnectAttempt}`);
    for (const s of this.sources.values()) {
      s.epoch += 1;
      s.index = null;
      s.credit = 0;
      this.events.onSourceState?.(s.id, "reconnecting", "connection lost");
    }
    this.setTimer(() => {
      if (this.stopping || !this.request) return;
      void this.createSession(this.request)
        .then((created) => {
          this.sessionId = created.session_id;
          return this.connect(created);
        })
        .catch((e: unknown) => {
          this.events.onError?.("reconnect_failed", e instanceof Error ? e.message : String(e), false);
          // Fake a close to run the backoff again.
          this.onClosed({ code: 1006, reason: "reconnect_failed", wasClean: false });
        });
    }, delay);
  }

  // ── audio ─────────────────────────────────────────────────────────────────

  /** Queue an audio frame for a source; sent when attached and credit allows. */
  sendAudio(sourceId: string, frame: AudioFrame): void {
    const s = this.sources.get(sourceId);
    if (!s || this.stopping) return;
    s.queue.push(frame);
    this.pump(s);
  }

  private pump(s: AttachedSource): void {
    if (!this.socket || this.socket.readyState !== 1 || s.index === null) return;
    while (s.credit > 0 && s.queue.length > 0) {
      const f = s.queue.shift()!;
      this.socket.send(encodeAudioFrame({ ...f, source_index: s.index }));
      s.credit -= 1;
      s.sentMs += (f.samples.length * 1000) / 16_000;
    }
  }

  /** Content-free: ms of audio actually sent per source this connection. */
  sentMs(sourceId: string): number {
    return this.sources.get(sourceId)?.sentMs ?? 0;
  }

  detachSource(sourceId: string, reason: "user" | "ended" | "device_lost" | "error"): void {
    if (!this.sources.has(sourceId)) return;
    this.sendControl({ type: "source.detach", source_id: sourceId, reason });
  }

  /** Idempotent stop: tells the server, then closes. */
  stop(): void {
    if (this.status === "stopped" || this.status === "idle") return;
    this.stopping = true;
    this.operations.cancelAll();
    if (this.socket && this.socket.readyState === 1) {
      this.setStatus("stopping");
      this.sendControl({ type: "stop" });
      this.socket.close(1000, "stop");
    } else {
      this.socket?.close(1000, "stop");
      this.socket = null;
      this.setStatus("stopped");
    }
  }

  /** Cancel a pending start (late session creation is dropped). */
  cancel(operationId: string): boolean {
    const was = this.operations.cancel(operationId);
    if (was && this.status === "creating") this.stopping = true;
    return was;
  }

  usage(): Record<string, number> {
    return { ...this.lastUsage };
  }

  private sendControl(frame: ClientFrame): void {
    if (this.socket && this.socket.readyState === 1) this.socket.send(JSON.stringify(frame));
  }
}

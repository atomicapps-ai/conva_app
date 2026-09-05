/**
 * LiveSessionRunner — composes capture (coordinator + audio graph + batcher)
 * with transport (LiveClient) into the ONE object the web adapter drives for
 * `session.start()` / `session.stop()`, and fans out the legacy UI events
 * (`sessionState`, `transcriptSegment`, `audioLevel`) plus typed envelopes.
 *
 * Browser specifics (navigator.mediaDevices, the AudioWorklet graph) are
 * injected through {@link RunnerDeps}, so runner.test.ts drives the whole
 * pipeline with fakes: fake mic → batcher → fake socket → transcript → legacy
 * segment. No React.
 */
import type { AudioLevelEvent, SessionStateEvent, TranscriptSegment } from "@/lib/ipc";
import { transcriptEventToLegacy, type TranscriptEvent } from "@/lib/capture/contract";
import { AudioBatcher } from "@/lib/audio/batcher";
import { CaptureCoordinator, type MediaAdapter, type StreamLike } from "@/lib/audio/captureCoordinator";
import { newSession, sessionFailed, sessionFinalized, sessionLive, sessionStopping, type SessionRecord } from "@/lib/audio/sourceMachine";
import type { PcmBlock } from "@/lib/audio/audioGraph";

import type { CaptureStatus } from "@/lib/capture/pal";

import { LiveClient, LiveSessionError, type LiveClientDeps } from "./liveClient";
import type { CreateSessionRequest } from "./protocol";

export interface GraphHandle {
  stop(): Promise<void>;
}
export type GraphStarter = (stream: StreamLike, onBlock: (b: PcmBlock) => void) => Promise<GraphHandle>;

export interface RunnerDeps {
  media: MediaAdapter;
  startGraph: GraphStarter;
  client: LiveClientDeps;
  /** Wall clock for `started_at_unix_ms`. */
  now?: () => number;
  /** Meter publish throttle in ms (architecture §11: ≤10 Hz). */
  meterIntervalMs?: number;
}

export interface RunnerEvents {
  sessionState?(e: SessionStateEvent): void;
  transcriptSegment?(s: TranscriptSegment): void;
  transcriptEvent?(e: TranscriptEvent): void;
  audioLevel?(e: AudioLevelEvent): void;
  /** Content-free notice for the UI (source degraded, gap, reconnect…). */
  notice?(code: string, message: string): void;
  /** Every source's phase after any change (drives "both sides" / "you only"). */
  captureStatus?(statuses: CaptureStatus[]): void;
}

export const MIC_SOURCE_ID = "mic-self";
export const SHARE_SOURCE_ID = "share-remote";

export class LiveSessionRunner {
  private readonly coordinator: CaptureCoordinator;
  private readonly client: LiveClient;
  private graphs = new Map<string, GraphHandle>();
  private batchers = new Map<string, AudioBatcher>();
  private lastMeterAt = new Map<string, number>();
  session: SessionRecord = newSession();
  private startedAt = 0;
  private opCounter = 0;

  constructor(
    private readonly deps: RunnerDeps,
    private readonly events: RunnerEvents = {},
  ) {
    this.coordinator = new CaptureCoordinator(deps.media, {
      onSourceChange: (source, ev) => {
        if (ev.type === "degrade") {
          this.events.notice?.("source_degraded", `${source.channel === "self" ? "Your microphone" : "Call audio"}: ${ev.reason}`);
          // A shared source whose track ended is over for this session: tell the
          // gateway, release the graph, and leave the mic alone ("you only").
          if (source.id === SHARE_SOURCE_ID) void this.teardownSource(SHARE_SOURCE_ID, "ended");
        }
        this.publishStatus();
      },
    });
    this.client = new LiveClient(deps.client, {
      onTranscript: (e) => {
        this.events.transcriptEvent?.(e);
        this.events.transcriptSegment?.(transcriptEventToLegacy(e));
      },
      onSourceState: (_id, state, reason) => {
        if (state === "reconnecting") this.events.notice?.("reconnecting", reason ?? "Reconnecting to the live gateway…");
      },
      onError: (code, message, fatal) => {
        this.events.notice?.(code, message);
        if (fatal) this.fail(message);
      },
      onBye: (reason) => {
        if (reason !== "stopped" && reason !== "cancelled") this.fail(`Live session ended: ${reason}`);
      },
    });
  }

  private nextOp(kind: string): string {
    return `${kind}-${++this.opCounter}`;
  }

  /** Every declared source's phase (content-free). */
  statuses(): CaptureStatus[] {
    return [...this.coordinator.sources.values()].map((s) => ({
      source_id: s.id,
      kind: s.kind,
      channel: s.channel,
      phase: s.phase,
      reason: s.reason,
    }));
  }

  private publishStatus(): void {
    this.events.captureStatus?.(this.statuses());
  }

  private emitState(e: SessionStateEvent): void {
    this.events.sessionState?.(e);
  }

  /**
   * Start: mic prompt (explicit user action), then server session + socket,
   * then the audio graph feeds the batcher → client. Rejects with a
   * LiveSessionError carrying a stable code when any step is refused.
   */
  async start(request: Omit<CreateSessionRequest, "sources">): Promise<string> {
    if (this.session.phase === "live" || this.session.phase === "creating" && this.session.id) {
      return this.session.id ?? "";
    }
    this.session = newSession();
    this.emitState({ state: "preparing", message: "Waiting for microphone permission…" });
    const micOp = this.nextOp("mic");
    const mic = await this.coordinator.startMic(MIC_SOURCE_ID, micOp);
    if (!mic.ok) {
      this.emitState({ state: "error", message: mic.message });
      this.session.phase = "failed";
      throw new LiveSessionError(mic.reason, mic.message);
    }
    this.emitState({ state: "preparing", message: "Connecting to the live gateway…" });
    let sessionId: string;
    try {
      sessionId = await this.client.start({ ...request, sources: [{ kind: "mic", channel: "self" }] }, this.nextOp("live"));
    } catch (e) {
      this.coordinator.stopAll("start_failed");
      const msg = e instanceof Error ? e.message : String(e);
      this.emitState({ state: "error", message: msg });
      this.session.phase = "failed";
      throw e;
    }
    sessionLive(this.session, sessionId);
    this.session.sources.set(MIC_SOURCE_ID, mic.source);
    this.startedAt = (this.deps.now ?? Date.now)();
    await this.attachGraph(MIC_SOURCE_ID, mic.stream, "outbound");
    this.emitState({ state: "listening", session_id: sessionId, started_at_unix_ms: this.startedAt });
    this.publishStatus();
    return sessionId;
  }

  private async attachGraph(sourceId: string, stream: StreamLike, side: "inbound" | "outbound"): Promise<void> {
    const batcher = new AudioBatcher(0);
    this.batchers.set(sourceId, batcher);
    const graph = await this.deps.startGraph(stream, (block) => this.onBlock(sourceId, side, block));
    this.graphs.set(sourceId, graph);
  }

  /**
   * "Share call audio": the explicit second action (architecture §7A.3). Must
   * be called from a user gesture. Attaches a `display` / `remote_mix` source
   * to the SAME live session; the mic keeps running whatever happens here.
   * Rejects with a LiveSessionError code when the session isn't live, the
   * chooser is cancelled, or the selection carries no audio.
   */
  async startShare(operationId: string): Promise<string> {
    if (this.session.phase !== "live") throw new LiveSessionError("no_session", "Start listening before sharing call audio.");
    if (this.coordinator.sources.get(SHARE_SOURCE_ID)?.phase === "capturing") return SHARE_SOURCE_ID;
    // A previous share that ended leaves an `ended` record; start fresh.
    if (this.coordinator.sources.get(SHARE_SOURCE_ID)?.phase === "ended") this.coordinator.sources.delete(SHARE_SOURCE_ID);
    const out = await this.coordinator.startShare(SHARE_SOURCE_ID, operationId);
    this.publishStatus();
    if (!out.ok) throw new LiveSessionError(out.reason, out.message);
    if (!this.client.attachSource(SHARE_SOURCE_ID, "display", "remote_mix")) {
      this.coordinator.stopSource(SHARE_SOURCE_ID, "attach_failed");
      this.publishStatus();
      throw new LiveSessionError("attach_failed", "Could not attach call audio to the live session.");
    }
    await this.attachGraph(SHARE_SOURCE_ID, out.stream, "inbound");
    this.publishStatus();
    return SHARE_SOURCE_ID;
  }

  /** Stop one source (idempotent). Stopping the mic source is `stop()`. */
  async stopSource(sourceId: string): Promise<void> {
    if (sourceId === MIC_SOURCE_ID) return this.stop();
    await this.teardownSource(sourceId, "user");
  }

  private async teardownSource(sourceId: string, reason: "user" | "ended" | "device_lost" | "error"): Promise<void> {
    const batcher = this.batchers.get(sourceId);
    if (batcher) for (const f of batcher.flush()) this.client.sendAudio(sourceId, f);
    this.batchers.delete(sourceId);
    const graph = this.graphs.get(sourceId);
    this.graphs.delete(sourceId);
    if (graph) await graph.stop().catch(() => {});
    this.client.detachSource(sourceId, reason);
    this.coordinator.stopSource(sourceId, reason);
    if (sourceId === SHARE_SOURCE_ID) this.events.notice?.("share_ended", reason === "user" ? "Call audio sharing stopped — transcribing you only." : "Call audio ended — transcribing you only. Share again to resume.");
    this.publishStatus();
  }

  /** Cancel a pending prompt/operation (e.g. the share chooser). */
  cancel(operationId: string): boolean {
    return this.coordinator.cancel(operationId);
  }

  private onBlock(sourceId: string, side: "inbound" | "outbound", block: PcmBlock): void {
    const batcher = this.batchers.get(sourceId);
    if (!batcher || this.session.phase !== "live") return;
    batcher.push(block.samples, block.capturedAtMs);
    const before = batcher.gaps.length;
    for (const f of batcher.take(batcher.readyCount)) this.client.sendAudio(sourceId, f);
    if (batcher.gaps.length > before) this.events.notice?.("audio_gap", "Network is behind — some audio was dropped to stay live.");
    const now = (this.deps.now ?? Date.now)();
    const interval = this.deps.meterIntervalMs ?? 100;
    if (now - (this.lastMeterAt.get(sourceId) ?? 0) >= interval) {
      this.lastMeterAt.set(sourceId, now);
      this.events.audioLevel?.({ side, rms_dbfs: block.rmsDbfs, healthy: true });
    }
  }

  /** Idempotent stop: flush, tell the server, release every track. */
  async stop(): Promise<void> {
    if (!sessionStopping(this.session)) return;
    if (this.session.phase === "finalized") return;
    for (const [id, batcher] of this.batchers) for (const f of batcher.flush()) this.client.sendAudio(id, f);
    this.client.stop();
    await Promise.all([...this.graphs.values()].map((g) => g.stop().catch(() => {})));
    this.graphs.clear();
    this.batchers.clear();
    this.coordinator.stopAll("user");
    sessionFinalized(this.session);
    this.emitState({ state: "idle" });
    this.publishStatus();
  }

  private fail(message: string): void {
    if (this.session.phase === "failed" || this.session.phase === "finalized") return;
    sessionFailed(this.session, message);
    void Promise.all([...this.graphs.values()].map((g) => g.stop().catch(() => {})));
    this.graphs.clear();
    this.batchers.clear();
    this.coordinator.stopAll("failed");
    this.emitState({ state: "error", message });
    this.publishStatus();
  }

  get liveClient(): LiveClient {
    return this.client;
  }
}

/** The real browser MediaAdapter (navigator.mediaDevices). Not unit-tested. */
export function browserMedia(): MediaAdapter {
  return {
    getUserMedia: (c) => navigator.mediaDevices.getUserMedia(c as MediaStreamConstraints) as Promise<StreamLike>,
    getDisplayMedia: (c) => navigator.mediaDevices.getDisplayMedia(c as DisplayMediaStreamOptions) as Promise<StreamLike>,
  };
}

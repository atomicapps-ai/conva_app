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
import type { TelemetrySample } from "./telemetry";

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
  /** Content-free telemetry samples (telemetry.ts); the adapter aggregates + posts them. */
  telemetry?(sample: TelemetrySample): void;
}

export const MIC_SOURCE_ID = "mic-self";
export const SHARE_SOURCE_ID = "share-remote";

/** Content-free copy for a server-ended session, by bye reason. */
const BYE_COPY: Record<string, string> = {
  quota: "Live session ended: today's listening budget for this account is used up (it resets at midnight UTC).",
  error: "Live session ended: the gateway reported an error.",
};

export class LiveSessionRunner {
  private readonly coordinator: CaptureCoordinator;
  private readonly client: LiveClient;
  private graphs = new Map<string, GraphHandle>();
  private batchers = new Map<string, AudioBatcher>();
  private lastMeterAt = new Map<string, number>();
  session: SessionRecord = newSession();
  private startedAt = 0;
  private opCounter = 0;
  /** Wall time of each source's first audio block minus its capture clock → source audio wall start (latency estimate). */
  private audioWallStart = new Map<string, number>();

  constructor(
    private readonly deps: RunnerDeps,
    private readonly events: RunnerEvents = {},
  ) {
    this.coordinator = new CaptureCoordinator(deps.media, {
      onSourceChange: (source, ev) => {
        if (ev.type === "degrade") {
          this.events.notice?.("source_degraded", `${source.channel === "self" ? "Your microphone" : "Call audio"}: ${ev.reason}`);
          this.tel({ kind: "source.degraded", channel: source.channel, code: "track_ended" });
          // A shared source whose track ended is over for this session: tell the
          // gateway, release the graph, and leave the mic alone ("you only").
          if (source.id === SHARE_SOURCE_ID) void this.teardownSource(SHARE_SOURCE_ID, "ended");
          // The mic stays part of the session (degraded) so "Reconnect
          // microphone" can re-acquire it under a new epoch — recover().
          if (source.id === MIC_SOURCE_ID) void this.releaseGraph(MIC_SOURCE_ID);
        }
        this.publishStatus();
      },
    });
    this.client = new LiveClient(deps.client, {
      onTranscript: (e) => {
        this.events.transcriptEvent?.(e);
        this.events.transcriptSegment?.(transcriptEventToLegacy(e));
        const wallStart = this.audioWallStart.get(e.source_id);
        if (wallStart !== undefined) {
          const est = (this.deps.now ?? Date.now)() - wallStart - e.payload.end_ms;
          if (est >= 0) this.tel({ kind: "transcript", channel: e.channel, final: e.payload.is_final, est_latency_ms: est });
        }
      },
      onReconnect: (attempt, outcome) => this.tel({ kind: "source.reconnect", attempt, outcome }),
      onSourceState: (_id, state, reason) => {
        if (state === "reconnecting") this.events.notice?.("reconnecting", reason ?? "Reconnecting to the live gateway…");
      },
      onError: (code, message, fatal) => {
        this.events.notice?.(code, message);
        if (fatal) this.fail(message, code);
      },
      onBye: (reason) => {
        if (reason !== "stopped" && reason !== "cancelled") this.fail(BYE_COPY[reason] ?? `Live session ended: ${reason}`, `bye_${reason}`);
      },
    });
  }

  private nextOp(kind: string): string {
    return `${kind}-${++this.opCounter}`;
  }

  private tel(sample: TelemetrySample): void {
    this.events.telemetry?.(sample);
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
      this.tel({ kind: "session.start", outcome: "refused", code: mic.reason });
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
      this.tel({ kind: "session.start", outcome: "refused", code: e instanceof LiveSessionError ? e.code : "error" });
      throw e;
    }
    this.tel({ kind: "session.start", outcome: "ok" });
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
    const wasEnded = this.coordinator.sources.get(SHARE_SOURCE_ID)?.phase === "ended";
    if (wasEnded) this.coordinator.sources.delete(SHARE_SOURCE_ID);
    const out = await this.coordinator.startShare(SHARE_SOURCE_ID, operationId);
    this.publishStatus();
    if (!out.ok) throw new LiveSessionError(out.reason, out.message);
    if (!this.client.attachSource(SHARE_SOURCE_ID, "display", "remote_mix")) {
      this.coordinator.stopSource(SHARE_SOURCE_ID, "attach_failed");
      this.publishStatus();
      throw new LiveSessionError("attach_failed", "Could not attach call audio to the live session.");
    }
    await this.attachGraph(SHARE_SOURCE_ID, out.stream, "inbound");
    if (wasEnded) this.tel({ kind: "source.recovered", channel: "remote_mix" });
    this.publishStatus();
    return SHARE_SOURCE_ID;
  }

  /**
   * Re-acquire a source that ended or degraded inside the same live session
   * (architecture §8 `recover(sourceId)`). Shared call audio: the chooser opens
   * again (user gesture) and the source re-attaches under the same id. The
   * microphone (M2 cp5): the device is re-prompted and the SAME gateway source
   * is re-attached under a new epoch (fresh provider stream, sequence reset) —
   * the session, the other source and the transcript so far all stay.
   */
  async recover(sourceId: string, operationId: string): Promise<string> {
    if (sourceId === SHARE_SOURCE_ID) return this.startShare(operationId);
    if (sourceId === MIC_SOURCE_ID) return this.recoverMic(operationId);
    throw new LiveSessionError("unknown_source", `No source ${sourceId} in this session.`);
  }

  private async recoverMic(operationId: string): Promise<string> {
    if (this.session.phase !== "live") throw new LiveSessionError("no_session", "There is no live session to recover the microphone into.");
    const current = this.coordinator.sources.get(MIC_SOURCE_ID);
    if (current?.phase === "capturing" || current?.phase === "prompting") return MIC_SOURCE_ID;
    // The degraded/ended record is terminal for the state machine: release it
    // and prompt afresh under the same id.
    await this.releaseGraph(MIC_SOURCE_ID);
    this.coordinator.stopSource(MIC_SOURCE_ID, "recovering");
    this.coordinator.sources.delete(MIC_SOURCE_ID);
    const mic = await this.coordinator.startMic(MIC_SOURCE_ID, operationId);
    this.publishStatus();
    if (!mic.ok) throw new LiveSessionError(mic.reason, mic.message);
    if (this.client.reattachSource(MIC_SOURCE_ID) === null) {
      this.coordinator.stopSource(MIC_SOURCE_ID, "attach_failed");
      this.publishStatus();
      throw new LiveSessionError("attach_failed", "Could not re-attach the microphone to the live session.");
    }
    this.session.sources.set(MIC_SOURCE_ID, mic.source);
    await this.attachGraph(MIC_SOURCE_ID, mic.stream, "outbound");
    this.events.notice?.("mic_recovered", "Microphone reconnected — transcribing you again.");
    this.tel({ kind: "source.recovered", channel: "self" });
    this.publishStatus();
    return MIC_SOURCE_ID;
  }

  /** Stop a source's graph + batcher (flushing what it had) without touching the gateway attachment. */
  private async releaseGraph(sourceId: string): Promise<void> {
    const batcher = this.batchers.get(sourceId);
    if (batcher) for (const f of batcher.flush()) this.client.sendAudio(sourceId, f);
    this.batchers.delete(sourceId);
    this.audioWallStart.delete(sourceId);
    const graph = this.graphs.get(sourceId);
    this.graphs.delete(sourceId);
    if (graph) await graph.stop().catch(() => {});
  }

  /** Stop one source (idempotent). Stopping the mic source is `stop()`. */
  async stopSource(sourceId: string): Promise<void> {
    if (sourceId === MIC_SOURCE_ID) return this.stop();
    await this.teardownSource(sourceId, "user");
  }

  private async teardownSource(sourceId: string, reason: "user" | "ended" | "device_lost" | "error"): Promise<void> {
    await this.releaseGraph(sourceId);
    this.client.detachSource(sourceId, reason);
    this.coordinator.stopSource(sourceId, reason);
    if (sourceId === SHARE_SOURCE_ID) this.events.notice?.("share_ended", reason === "user" ? "Call audio sharing stopped — transcribing you only." : "Call audio ended — transcribing you only. Share again to resume.");
    this.publishStatus();
  }

  /** Share recovery re-uses startShare; bookkeeping for telemetry lives there. */

  /** Cancel a pending prompt/operation (e.g. the share chooser). */
  cancel(operationId: string): boolean {
    return this.coordinator.cancel(operationId);
  }

  private onBlock(sourceId: string, side: "inbound" | "outbound", block: PcmBlock): void {
    const batcher = this.batchers.get(sourceId);
    if (!batcher || this.session.phase !== "live") return;
    const now = (this.deps.now ?? Date.now)();
    if (!this.audioWallStart.has(sourceId)) this.audioWallStart.set(sourceId, now - block.capturedAtMs);
    batcher.push(block.samples, block.capturedAtMs);
    const before = batcher.gaps.length;
    for (const f of batcher.take(batcher.readyCount)) this.client.sendAudio(sourceId, f);
    if (batcher.gaps.length > before) {
      this.events.notice?.("audio_gap", "Network is behind — some audio was dropped to stay live.");
      this.tel({ kind: "source.gap", channel: side === "outbound" ? "self" : "remote_mix" });
    }
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
    this.audioWallStart.clear();
    this.tel({ kind: "session.end", reason: "stopped", duration_ms: Math.max(0, (this.deps.now ?? Date.now)() - this.startedAt), sources: this.session.sources.size });
    this.emitState({ state: "idle" });
    this.publishStatus();
  }

  private fail(message: string, code = "error"): void {
    if (this.session.phase === "failed" || this.session.phase === "finalized") return;
    sessionFailed(this.session, message);
    this.audioWallStart.clear();
    this.tel({ kind: "session.end", reason: code, duration_ms: this.startedAt ? Math.max(0, (this.deps.now ?? Date.now)() - this.startedAt) : 0, sources: this.session.sources.size });
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

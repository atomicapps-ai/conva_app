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
}

export const MIC_SOURCE_ID = "mic-self";

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
        if (ev.type === "degrade") this.events.notice?.("source_degraded", `${source.channel === "self" ? "Your microphone" : "Call audio"}: ${ev.reason}`);
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
    const batcher = new AudioBatcher(0);
    this.batchers.set(MIC_SOURCE_ID, batcher);
    const graph = await this.deps.startGraph(mic.stream, (block) => this.onBlock(MIC_SOURCE_ID, "outbound", block));
    this.graphs.set(MIC_SOURCE_ID, graph);
    this.emitState({ state: "listening", session_id: sessionId, started_at_unix_ms: this.startedAt });
    return sessionId;
  }

  private onBlock(sourceId: string, side: "inbound" | "outbound", block: PcmBlock): void {
    const batcher = this.batchers.get(sourceId);
    if (!batcher || this.session.phase !== "live") return;
    batcher.push(block.samples, block.capturedAtMs);
    const before = batcher.gaps.length;
    for (const f of batcher.take(batcher.readyCount)) this.client.sendAudio(`mic-self`, f);
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
    for (const [id, batcher] of this.batchers) for (const f of batcher.flush()) this.client.sendAudio(id === MIC_SOURCE_ID ? "mic-self" : id, f);
    this.client.stop();
    await Promise.all([...this.graphs.values()].map((g) => g.stop().catch(() => {})));
    this.graphs.clear();
    this.batchers.clear();
    this.coordinator.stopAll("user");
    sessionFinalized(this.session);
    this.emitState({ state: "idle" });
  }

  private fail(message: string): void {
    if (this.session.phase === "failed" || this.session.phase === "finalized") return;
    sessionFailed(this.session, message);
    void Promise.all([...this.graphs.values()].map((g) => g.stop().catch(() => {})));
    this.graphs.clear();
    this.batchers.clear();
    this.coordinator.stopAll("failed");
    this.emitState({ state: "error", message });
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

/**
 * Browser capture coordinator — owns the SOURCES of a live session (mic, and
 * later shared call audio) without touching React or the network.
 *
 * Rules it enforces (architecture §3 baseline, §7A, §12):
 *  • No capture starts on page load — every prompt is an explicit call the UI
 *    makes from a user action.
 *  • A prompt can stay unanswered; cancelling the operation makes a LATE
 *    stream get released (tracks stopped) instead of captured.
 *  • Losing one source never stops another; a track ending degrades that
 *    source with a reason.
 *  • Display capture is checked for an AUDIO track: video-only sharing is a
 *    truthful "no audio" outcome, and the video track is stopped when the
 *    browser lets audio survive without it.
 *
 * The browser APIs are behind {@link MediaAdapter} so this is unit-testable
 * with a fake (captureCoordinator.test.ts). The AudioWorklet graph lives in
 * audioGraph.ts (browser-only glue).
 */
import type { CaptureChannel, CaptureSourceKind } from "@/lib/capture/contract";
import { OperationRegistry } from "@/lib/capture/operations";

import { newSource, transition, type SourceRecord, type SourceEvent } from "./sourceMachine";

/** The slice of a MediaStreamTrack we depend on (structural, so fakes are trivial). */
export interface TrackLike {
  kind: "audio" | "video";
  readyState: "live" | "ended";
  stop(): void;
  onended: (() => void) | null;
  addEventListener?(type: "ended", cb: () => void): void;
}

export interface StreamLike {
  getAudioTracks(): TrackLike[];
  getVideoTracks(): TrackLike[];
}

export interface MediaAdapter {
  getUserMedia(constraints: { audio: MediaTrackConstraints | boolean }): Promise<StreamLike>;
  getDisplayMedia(constraints: { video: boolean; audio: boolean }): Promise<StreamLike>;
}

export type CaptureOutcome =
  | { ok: true; source: SourceRecord; stream: StreamLike }
  | { ok: false; source: SourceRecord; reason: CaptureFailure; message: string };

export type CaptureFailure =
  | "denied"
  | "not_found"
  | "no_audio_track"
  | "cancelled"
  | "insecure_context"
  | "unsupported"
  | "already_active"
  | "error";

export interface CoordinatorEvents {
  onSourceChange?(source: SourceRecord, ev: SourceEvent): void;
}

const MIC_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  channelCount: 1,
};

export class CaptureCoordinator {
  readonly sources = new Map<string, SourceRecord>();
  private readonly streams = new Map<string, StreamLike>();
  readonly operations = new OperationRegistry();

  constructor(
    private readonly media: MediaAdapter,
    private readonly events: CoordinatorEvents = {},
  ) {}

  private apply(source: SourceRecord, ev: SourceEvent): void {
    const t = transition(source, ev);
    if (t.ok) this.events.onSourceChange?.(source, ev);
  }

  /** Register a source slot without prompting (so the UI can render it idle). */
  declare(id: string, kind: CaptureSourceKind, channel: CaptureChannel): SourceRecord {
    const existing = this.sources.get(id);
    if (existing) return existing;
    const s = newSource(id, kind, channel);
    this.sources.set(id, s);
    return s;
  }

  /**
   * Prompt for the microphone. `operationId` lets the caller cancel while the
   * browser prompt is open; a stream that arrives after cancellation is
   * stopped and reported as `cancelled`, never captured.
   */
  async startMic(id: string, operationId: string): Promise<CaptureOutcome> {
    const source = this.declare(id, "mic", "self");
    return this.acquire(source, operationId, () => this.media.getUserMedia({ audio: MIC_CONSTRAINTS }), false);
  }

  /** Prompt to share call audio (tab/display). Must be called from a user gesture. */
  async startShare(id: string, operationId: string): Promise<CaptureOutcome> {
    const source = this.declare(id, "display", "remote_mix");
    return this.acquire(source, operationId, () => this.media.getDisplayMedia({ video: true, audio: true }), true);
  }

  private async acquire(
    source: SourceRecord,
    operationId: string,
    open: () => Promise<StreamLike>,
    isShare: boolean,
  ): Promise<CaptureOutcome> {
    if (source.phase !== "idle") {
      return { ok: false, source, reason: "already_active", message: `source ${source.id} is ${source.phase}` };
    }
    this.operations.begin(operationId, isShare ? "capture.share" : "capture.mic");
    this.apply(source, { type: "prompt" });
    let stream: StreamLike;
    try {
      stream = await open();
    } catch (e) {
      this.operations.complete(operationId);
      const { reason, message } = classifyMediaError(e);
      this.apply(source, { type: "denied", reason: message });
      return { ok: false, source, reason, message };
    }
    // Late result for a cancelled operation → release, never capture.
    if (!this.operations.accept(operationId)) {
      releaseStream(stream);
      this.apply(source, { type: "denied", reason: "cancelled" });
      return { ok: false, source, reason: "cancelled", message: "Capture was cancelled before the browser answered." };
    }
    const audio = stream.getAudioTracks().filter((t) => t.readyState === "live");
    if (audio.length === 0) {
      releaseStream(stream);
      this.apply(source, { type: "denied", reason: "no_audio_track" });
      return {
        ok: false,
        source,
        reason: "no_audio_track",
        message: isShare
          ? "Sharing succeeded but included no audio. Pick a tab or screen and enable “share audio”."
          : "No live microphone track was returned.",
      };
    }
    if (isShare) {
      // Video is never processed or sent; stop it when the browser lets audio
      // outlive it (certification verifies per browser — architecture §7A.3).
      for (const v of stream.getVideoTracks()) v.stop();
    }
    this.streams.set(source.id, stream);
    for (const t of audio) {
      const onEnded = () => {
        if (source.phase === "capturing" || source.phase === "reconnecting") {
          this.apply(source, { type: "degrade", reason: "The audio track ended (device removed or sharing stopped)." });
        }
      };
      if (t.addEventListener) t.addEventListener("ended", onEnded);
      else t.onended = onEnded;
    }
    this.apply(source, { type: "granted" });
    return { ok: true, source, stream };
  }

  /** Cancel an in-flight prompt/operation. Returns true if it was running. */
  cancel(operationId: string): boolean {
    return this.operations.cancel(operationId);
  }

  /** Stop one source (idempotent): tracks stopped, phase → ended. */
  stopSource(id: string, reason = "user"): void {
    const s = this.sources.get(id);
    if (!s) return;
    const stream = this.streams.get(id);
    if (stream) releaseStream(stream);
    this.streams.delete(id);
    if (s.phase !== "ended") this.apply(s, { type: "end", reason });
  }

  /** Stop everything (idempotent). */
  stopAll(reason = "user"): void {
    for (const id of [...this.sources.keys()]) this.stopSource(id, reason);
    this.operations.cancelAll();
  }

  stream(id: string): StreamLike | undefined {
    return this.streams.get(id);
  }
}

export function releaseStream(stream: StreamLike): void {
  for (const t of [...stream.getAudioTracks(), ...stream.getVideoTracks()]) {
    try {
      t.stop();
    } catch {
      /* already stopped */
    }
  }
}

/** Map browser MediaDevices errors to a stable, content-free reason. */
export function classifyMediaError(e: unknown): { reason: CaptureFailure; message: string } {
  const name = (e as { name?: string } | null)?.name ?? "";
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return { reason: "denied", message: "Permission was denied or the prompt was dismissed." };
    case "NotFoundError":
    case "OverconstrainedError":
      return { reason: "not_found", message: "No matching audio device was found." };
    case "AbortError":
      return { reason: "cancelled", message: "The browser aborted the request." };
    case "NotSupportedError":
    case "TypeError":
      return { reason: "unsupported", message: "This browser does not support the requested capture." };
    default:
      return { reason: "error", message: e instanceof Error ? e.message : "Capture failed." };
  }
}

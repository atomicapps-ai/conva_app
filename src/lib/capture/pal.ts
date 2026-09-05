/**
 * PAL-only capture types for the `ConvaBackend.capture` group (browser
 * architecture §8: `capture.enumerateSources/prepare/start/stop/status`).
 * These never cross the Rust IPC boundary, so — unlike contract.ts — they have
 * no `capture_contract.rs` mirror. Pure types.
 */
import type { Availability, CaptureChannel, CaptureSourceKind } from "./contract";

/** Per-source lifecycle phase (mirrors `src/lib/audio/sourceMachine.ts`). */
export type CaptureSourcePhase = "idle" | "prompting" | "capturing" | "degraded" | "reconnecting" | "ended";

/** What `capture.prepare(kind)` tells the UI BEFORE any prompt opens. */
export interface CapturePrepare {
  kind: CaptureSourceKind;
  channel: CaptureChannel;
  availability: Availability;
  /** The browser requires the start call to run inside a user gesture (display capture always does). */
  requires_user_gesture: boolean;
  /** Content-free notice to show next to the control (what will be captured, where it goes). */
  notice: string;
}

/** One source's live status in the current session. */
export interface CaptureStatus {
  source_id: string;
  kind: CaptureSourceKind;
  channel: CaptureChannel;
  phase: CaptureSourcePhase;
  /** Content-free reason for degraded/ended/idle-after-failure, else null. */
  reason: string | null;
}

/** "Both sides" / "you only" / nothing — derived, never guessed. */
export type CaptureCoverage = "none" | "self_only" | "remote_only" | "both";

export function coverageOf(statuses: readonly CaptureStatus[]): CaptureCoverage {
  const live = (ch: CaptureChannel) => statuses.some((s) => s.channel === ch && s.phase === "capturing");
  const self = live("self");
  const remote = live("remote_mix") || live("remote_track");
  if (self && remote) return "both";
  if (self) return "self_only";
  if (remote) return "remote_only";
  return "none";
}

/**
 * Per-source and session state machines (architecture §12) — pure.
 *
 *   session: creating → live → stopping → finalized | failed
 *   source : idle → prompting → capturing ⇄ degraded ⇄ reconnecting → ended
 *
 * One source's failure never overwrites another's truth; every stop is
 * idempotent; a reconnect bumps the source epoch. No I/O, no DOM.
 * Unit-tested in sourceMachine.test.ts.
 */
import type { CaptureChannel, CaptureSourceKind } from "@/lib/capture/contract";

export type SessionPhase = "creating" | "live" | "stopping" | "finalized" | "failed";
export type SourcePhase = "idle" | "prompting" | "capturing" | "degraded" | "reconnecting" | "ended";

export interface SourceRecord {
  id: string;
  kind: CaptureSourceKind;
  channel: CaptureChannel;
  phase: SourcePhase;
  epoch: number;
  /** Human, content-free reason for degraded/ended/idle-after-failure. */
  reason: string | null;
  /** Gateway-assigned index for audio frames; null until attached. */
  sourceIndex: number | null;
}

export type SourceEvent =
  | { type: "prompt" }
  | { type: "granted"; sourceIndex?: number }
  | { type: "denied"; reason: string }
  | { type: "attached"; sourceIndex: number }
  | { type: "degrade"; reason: string }
  | { type: "recover" }
  | { type: "disconnect"; reason: string }
  | { type: "reconnected"; sourceIndex: number }
  | { type: "end"; reason: string };

export interface Transition {
  ok: boolean;
  from: SourcePhase;
  to: SourcePhase;
  /** True when this transition started a new epoch. */
  epochBumped: boolean;
}

export function newSource(id: string, kind: CaptureSourceKind, channel: CaptureChannel): SourceRecord {
  return { id, kind, channel, phase: "idle", epoch: 0, reason: null, sourceIndex: null };
}

/** Apply an event; returns the transition (ok=false = ignored, state unchanged). */
export function transition(s: SourceRecord, ev: SourceEvent): Transition {
  const from = s.phase;
  const ignore = (): Transition => ({ ok: false, from, to: from, epochBumped: false });
  const go = (to: SourcePhase, epochBumped = false): Transition => {
    s.phase = to;
    return { ok: true, from, to, epochBumped };
  };
  if (from === "ended") return ignore(); // terminal
  switch (ev.type) {
    case "prompt":
      return from === "idle" ? go("prompting") : ignore();
    case "granted":
      if (from !== "prompting") return ignore();
      s.reason = null;
      if (typeof ev.sourceIndex === "number") s.sourceIndex = ev.sourceIndex;
      return go("capturing");
    case "denied":
      if (from !== "prompting") return ignore();
      s.reason = ev.reason;
      return go("idle");
    case "attached":
      s.sourceIndex = ev.sourceIndex;
      return { ok: true, from, to: from, epochBumped: false };
    case "degrade":
      if (from !== "capturing" && from !== "reconnecting") return ignore();
      s.reason = ev.reason;
      return go("degraded");
    case "recover":
      if (from !== "degraded") return ignore();
      s.reason = null;
      return go("capturing");
    case "disconnect":
      if (from !== "capturing" && from !== "degraded") return ignore();
      s.reason = ev.reason;
      return go("reconnecting");
    case "reconnected":
      if (from !== "reconnecting") return ignore();
      s.epoch += 1;
      s.sourceIndex = ev.sourceIndex;
      s.reason = null;
      return go("capturing", true);
    case "end":
      s.reason = ev.reason;
      return go("ended");
  }
}

export interface SessionRecord {
  id: string | null;
  phase: SessionPhase;
  sources: Map<string, SourceRecord>;
  reason: string | null;
}

export function newSession(): SessionRecord {
  return { id: null, phase: "creating", sources: new Map(), reason: null };
}

export function sessionLive(sess: SessionRecord, id: string): boolean {
  if (sess.phase !== "creating") return false;
  sess.id = id;
  sess.phase = "live";
  return true;
}

/** Idempotent: a second stop is a no-op that still reports success. */
export function sessionStopping(sess: SessionRecord): boolean {
  if (sess.phase === "finalized" || sess.phase === "failed") return true;
  if (sess.phase === "stopping") return true;
  sess.phase = "stopping";
  return true;
}

export function sessionFinalized(sess: SessionRecord): void {
  if (sess.phase === "failed") return;
  sess.phase = "finalized";
  for (const s of sess.sources.values()) if (s.phase !== "ended") transition(s, { type: "end", reason: "session_stopped" });
}

export function sessionFailed(sess: SessionRecord, reason: string): void {
  sess.phase = "failed";
  sess.reason = reason;
  for (const s of sess.sources.values()) if (s.phase !== "ended") transition(s, { type: "end", reason });
}

/** Summary the UI can show without reading every source: "both sides",
 *  "you only", etc. Content-free. */
export function sessionSummary(sess: SessionRecord): {
  self: SourcePhase | null;
  remote: SourcePhase | null;
  anyCapturing: boolean;
} {
  let self: SourcePhase | null = null;
  let remote: SourcePhase | null = null;
  for (const s of sess.sources.values()) {
    if (s.channel === "self") self = s.phase;
    else remote = s.phase;
  }
  return { self, remote, anyCapturing: [...sess.sources.values()].some((s) => s.phase === "capturing") };
}

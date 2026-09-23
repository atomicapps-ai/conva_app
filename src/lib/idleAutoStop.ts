import { useEffect, useRef } from "react";

import { useAppStore } from "@/state/app";
import { useTranscriptStore } from "@/state/transcript";

/** How often the idle check runs while a session is listening. Coarser than
 *  the shortest configurable threshold (5 min) by a wide margin, so it costs
 *  nothing worth measuring. */
const POLL_MS = 15_000;

/**
 * Pure idle-auto-stop decision: has it been at least `thresholdMinutes` since
 * `lastActivityMs`? `thresholdMinutes` of `null`/`0`/negative disables the
 * feature (matches `AppConfig.idle_stop_minutes`'s `null` = off).
 */
export function shouldIdleStop(
  lastActivityMs: number,
  nowMs: number,
  thresholdMinutes: number | null,
): boolean {
  if (thresholdMinutes == null || thresholdMinutes <= 0) return false;
  return nowMs - lastActivityMs >= thresholdMinutes * 60_000;
}

/**
 * Auto-stops a listening session after `config.idle_stop_minutes` of no new
 * transcribed speech on either side — releases the mic/loopback devices and
 * finalizes any recording (the same full `stop()` the control bar's Stop
 * button calls) instead of burning resources unattended. Records the
 * threshold that fired into `idleStoppedMinutes` so the Live view can offer
 * a "Resume listening?" banner. Mount once at the app root (`App.tsx`,
 * alongside `useIpcBridge`) — not in the partner window, which doesn't own
 * session control.
 */
export function useIdleAutoStop(): void {
  const sessionState = useTranscriptStore((s) => s.session.state);
  const firedRef = useRef(false);

  useEffect(() => {
    if (sessionState !== "listening") return;
    firedRef.current = false;
    const id = window.setInterval(() => {
      if (firedRef.current) return;
      const { session, lastActivityMs } = useTranscriptStore.getState();
      if (session.state !== "listening" || lastActivityMs == null) return;
      const minutes = useAppStore.getState().config?.idle_stop_minutes ?? null;
      if (!shouldIdleStop(lastActivityMs, Date.now(), minutes)) return;
      firedRef.current = true;
      useAppStore.setState({ idleStoppedMinutes: minutes });
      void useAppStore.getState().stop();
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [sessionState]);
}

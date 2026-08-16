import { useEffect, useRef, useState } from "react";

/** ms → "mm:ss". */
export function clock(ms: number): string {
  const t = Math.floor(ms / 1000);
  const m = Math.floor(t / 60);
  const s = t % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** Elapsed mm:ss since `active` went true; resets when it goes false. Shared
 *  by TopBar's Stop-listening label and WindowChrome's "LIVE mm:ss" pill —
 *  both need the same clock, ticking from the same moment. */
export function useElapsed(active: boolean): string {
  const [ms, setMs] = useState(0);
  const startRef = useRef<number | null>(null);
  useEffect(() => {
    if (!active) {
      startRef.current = null;
      setMs(0);
      return;
    }
    startRef.current = Date.now();
    setMs(0);
    const id = setInterval(
      () => setMs(Date.now() - (startRef.current ?? Date.now())),
      1000,
    );
    return () => clearInterval(id);
  }, [active]);
  return clock(ms);
}

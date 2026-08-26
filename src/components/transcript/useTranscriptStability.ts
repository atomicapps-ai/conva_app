import { useRef } from "react";

import type { TranscriptSegment } from "@/lib/ipc";
import { segmentKey } from "@/lib/turns";
import {
  advanceConfirmed,
  diffWords,
  tentativeTail,
  type DiffWord,
} from "@/lib/transcriptStability";

interface StabilityEntry {
  confirmedPrefix: string;
  lastRaw: string | null;
  /** Guards `advanceConfirmed` specifically: it treats "lastRaw equals the
   *  current text" as a genuine second independent tick agreeing, so
   *  re-running it against its own just-written output (e.g. an unrelated
   *  re-render with identical segments) would wrongly fast-forward
   *  confirmation. Comparing against the raw text we last actually
   *  processed makes repeat invocations for the same text a no-op. */
  lastProcessedRaw: string | null;
  /** What was last shown on screen for this segment while it was still
   *  in-flight (confirmed + tentative, joined) — the baseline the one-time
   *  finalize diff compares against. Empty if this segment finalized
   *  without ever being shown as a partial first. */
  lastDisplayed: string;
}

export interface StabilityUnit {
  key: string;
  text: string;
  /** Non-null only when the true final text actually differs from what
   *  was last shown for this segment — almost always `null`, since the
   *  confirmed prefix already survived two decode passes. Recomputed fresh
   *  every render from two values that are frozen once a segment
   *  finalizes, so — unlike the in-flight advance step above — this needs
   *  no re-render guard; it's already idempotent by construction. */
  diff: DiffWord[] | null;
}

export interface StabilityResult {
  /** One entry per finalized segment in this turn, in order. */
  finalUnits: StabilityUnit[];
  /** The current in-flight segment's confirmed prefix (plain text) — empty
   *  if there's no segment currently streaming. */
  liveConfirmed: string;
  /** The current in-flight segment's still-unconfirmed tail (existing
   *  muted/tentative style) — empty once it exactly matches confirmed. */
  liveTentative: string;
}

/**
 * Turns one turn's raw segments into a stable rendering plan (F13 — see
 * docs/superpowers/specs/2026-08-21-transcript-stabilization-design.md).
 * Per-segment state (keyed by `segmentKey` — side+seq, so a new utterance
 * always starts fresh) is tracked across renders in a ref.
 */
export function useTranscriptStability(segments: TranscriptSegment[]): StabilityResult {
  const store = useRef(new Map<string, StabilityEntry>());
  const finalUnits: StabilityUnit[] = [];
  let liveConfirmed = "";
  let liveTentative = "";

  for (const seg of segments) {
    const key = segmentKey(seg);
    let entry = store.current.get(key);
    if (!entry) {
      entry = {
        confirmedPrefix: "",
        lastRaw: null,
        lastProcessedRaw: null,
        lastDisplayed: "",
      };
      store.current.set(key, entry);
    }

    if (seg.is_final) {
      const finalText = seg.text.trim();
      if (!finalText) continue;
      let diff: DiffWord[] | null = null;
      if (entry.lastDisplayed && entry.lastDisplayed !== finalText) {
        const d = diffWords(entry.lastDisplayed, finalText);
        if (d.some((w) => w.changed)) diff = d;
      }
      finalUnits.push({ key, text: finalText, diff });
    } else {
      const raw = seg.text.trim();
      if (!raw) continue;
      if (entry.lastProcessedRaw !== raw) {
        entry.confirmedPrefix = advanceConfirmed(entry.confirmedPrefix, entry.lastRaw, raw);
        entry.lastRaw = raw;
        entry.lastProcessedRaw = raw;
      }
      const tail = tentativeTail(entry.confirmedPrefix, raw);
      entry.lastDisplayed = [entry.confirmedPrefix, tail].filter(Boolean).join(" ");
      liveConfirmed = entry.confirmedPrefix;
      liveTentative = tail;
    }
  }

  return { finalUnits, liveConfirmed, liveTentative };
}

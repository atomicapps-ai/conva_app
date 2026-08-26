import type { Capture } from "@/lib/ipc";

/**
 * FANER prompt/label helpers (F11 handoff, 2026-08-20 — see PR #44's
 * comment thread for the original spec). The inline-mark helpers that used
 * to live here (hit collection, word-boundary matching, span accents) were
 * retired 2026-08-26 (owner decision — keep FANER's Highlighter, retire the
 * inline live-transcript marks); the dev-only `FanerReplayPanel.tsx` keeps
 * its own local copies. `fanerPrompt` remains:
 * it phrases the ask sent to Ally when the user taps a capture chip in the
 * panel's Terms group.
 */

/** A short, human label for the popover header — mirrors the raw-capture
 *  row's `[tier·kind]` formatting in the dev panel. */
export function fanerLabel(c: Capture): string {
  const qualifier = c.kind ?? c.tier;
  return qualifier ? `${c.action} · ${qualifier}` : c.action;
}

/** The prompt sent to Ally when the user acts on a FANER-marked span —
 *  phrased by the capture's routed action so "ask about this" reads right
 *  whether FANER thinks it's a term to define, something to recall, a task
 *  to assist with, or a synthesis opportunity. */
export function fanerPrompt(capture: Capture, phrase: string): string {
  switch (capture.action) {
    case "RECALL":
      return `What did we cover earlier about "${phrase}"?`;
    case "ASSIST":
      return `Help me with "${phrase}" right now.`;
    case "SYNTHESIZE":
      return `Pull together what we know so far about "${phrase}".`;
    case "EXPLAIN":
    default:
      return capture.kind === "problem"
        ? `What's the standard fix for "${phrase}"?`
        : `Define "${phrase}" concisely, in the context of this conversation.`;
  }
}

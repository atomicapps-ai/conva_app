import type { Capture } from "@/lib/ipc";

/**
 * FANER inline-highlight helpers (F11 handoff, 2026-08-20 — see PR #44's
 * comment thread for the full spec). Pure/testable logic shared by
 * `TranscriptView.tsx`'s live rendering and (conceptually) the dev-only
 * `FanerReplayPanel.tsx`, whose `collectHits`/`captureAccent` this is ported
 * from — kept here instead of imported from that dev panel so the shipping
 * transcript doesn't depend on dev-only code.
 */

export interface FanerHit {
  phrase: string;
  capture: Capture;
}

/**
 * Every (capture, literal-argument-found-in-text) pair for one piece of
 * text, longest phrase first so a longer match wins over a shorter one
 * nested inside it. `question`-trigger captures are always skipped — their
 * `arguments` are the model's paraphrase of the whole question, not a
 * literal span, so highlighting them would point at the wrong words (the
 * remaining triggers — `task_frame`, `prep_reference`, `gap` — are exactly
 * the ones the owner approved for span-marking).
 */
export function collectFanerHits(text: string, captures: Capture[]): FanerHit[] {
  if (captures.length === 0) return [];
  const lower = text.toLowerCase();
  const hits: FanerHit[] = [];
  for (const c of captures) {
    if (c.trigger === "question") continue;
    for (const arg of c.arguments) {
      const phrase = arg.trim();
      if (phrase.length >= 3 && lower.includes(phrase.toLowerCase())) {
        hits.push({ phrase, capture: c });
      }
    }
  }
  return hits.sort((a, b) => b.phrase.length - a.phrase.length);
}

/** Text-color accent for a FANER-marked span, color-coded by what it's for
 *  — same action→color mapping as `FanerReplayPanel.tsx`'s `captureAccent`,
 *  minus its border-color half (that panel dashes a *hover-only* border;
 *  the live transcript's span is a persistent `underline`, which already
 *  inherits this color via `currentColor` — no border is drawn). */
export function fanerAccent(c: Capture): string {
  if (c.action === "RECALL") return "text-violet-300";
  if (c.action === "ASSIST") return "text-emerald-300";
  if (c.action === "SYNTHESIZE") return "text-fuchsia-300";
  if (c.kind === "problem") return "text-amber-300";
  return "text-sky-300"; // EXPLAIN · concept (or unclassified)
}

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

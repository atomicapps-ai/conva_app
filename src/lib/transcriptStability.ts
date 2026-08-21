/**
 * Live-transcript stabilization (F13 — see docs/superpowers/specs/2026-08-21-
 * transcript-stabilization-design.md for the full rationale). Whisper
 * re-decodes an entire utterance from scratch on every partial tick with no
 * memory of its own previous guess (`asr.rs`'s `set_no_context(true)`), so an
 * earlier word can genuinely change between ticks — there is no incremental
 * decoding happening anywhere in the pipeline. These pure functions
 * implement the published LocalAgreement-2 policy (arXiv:2307.14743,
 * ufal/whisper_streaming) at the display layer instead: a word is only
 * treated as "confirmed" once two consecutive raw hypotheses agree on it.
 */

function words(s: string): string[] {
  return s.trim().split(/\s+/).filter(Boolean);
}

/**
 * The LocalAgreement-2 step. `lastRaw` is the previous raw partial
 * hypothesis for this same in-flight segment (or `null` on the segment's
 * very first partial, when there's nothing yet to agree with).
 * `currentRaw` is the newest raw hypothesis. Returns the longest
 * word-prefix `lastRaw` and `currentRaw` agree on, WHICHEVER IS LONGER
 * between that and the already-`confirmedPrefix` passed in — confirmation
 * is monotonic and never shrinks, even if a later hypothesis revises an
 * already-confirmed word.
 */
export function advanceConfirmed(
  confirmedPrefix: string,
  lastRaw: string | null,
  currentRaw: string,
): string {
  if (lastRaw === null) return confirmedPrefix;
  const a = words(lastRaw);
  const b = words(currentRaw);
  let agree = 0;
  while (agree < a.length && agree < b.length && a[agree] === b[agree]) agree++;
  const confirmedWordCount = words(confirmedPrefix).length;
  if (agree <= confirmedWordCount) return confirmedPrefix;
  return b.slice(0, agree).join(" ");
}

/** Whatever `currentRaw` has past `confirmedPrefix` — the short, still-
 *  unconfirmed tail that renders in the existing muted/tentative style. */
export function tentativeTail(confirmedPrefix: string, currentRaw: string): string {
  const confirmedWordCount = words(confirmedPrefix).length;
  return words(currentRaw).slice(confirmedWordCount).join(" ");
}

export interface DiffWord {
  text: string;
  changed: boolean;
}

/**
 * Word-level diff between what was last displayed for a segment and its
 * true final text — used once, when a segment finalizes, to animate only
 * the words that actually differ. A simple positional compare (not a full
 * LCS diff): `before` and `after` are almost always near-identical (the
 * confirmed prefix already survived two decode passes), differing only in
 * the last word or two, so this is both simpler and sufficient for that
 * case.
 */
export function diffWords(before: string, after: string): DiffWord[] {
  const beforeWords = words(before);
  const afterWords = words(after);
  return afterWords.map((word, i) => ({
    text: word,
    changed: beforeWords[i] !== word,
  }));
}

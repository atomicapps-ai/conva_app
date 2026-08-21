import type { AllyCard } from "@/state/ally";
import { isFanerBoundaryMatch } from "@/lib/faner";

/**
 * Matches a starred card's remembered quote back into the transcript text
 * it was asked from (F12 — Live panel redesign; see
 * docs/superpowers/specs/2026-08-21-live-panel-starred-board-design.md §5–§6).
 * Mirrors `collectFanerHits` in `faner.ts`, but matches an exact remembered
 * quote rather than a fuzzy jargon argument — a starred card already knows
 * the literal text the user asked about, so there's no paraphrase risk to
 * guard against the way FANER's `question`-trigger captures have.
 */
export interface StarHit {
  phrase: string;
  card: AllyCard;
}

/** Case-insensitive search for `phraseLower` in `lower` that skips past any
 *  mid-word false positive and only returns a word-boundary-safe occurrence
 *  (or -1 if none exists). A deliberate near-duplicate of the private
 *  helper of the same name in `faner.ts` rather than an import from it:
 *  FANER's own capture-routing logic is developed independently elsewhere
 *  in this codebase, so this module's only dependency on it is the already
 *  -exported, stable `isFanerBoundaryMatch` — kept small to avoid coupling
 *  to code that changes on its own schedule. */
function findBoundedIndex(lower: string, phraseLower: string): number {
  let from = 0;
  for (;;) {
    const idx = lower.indexOf(phraseLower, from);
    if (idx === -1) return -1;
    if (isFanerBoundaryMatch(lower, idx, phraseLower.length)) return idx;
    from = idx + 1;
  }
}

/**
 * Every starred card tied to `turnKey` whose `sourceQuote` appears in
 * `text` at a real word boundary, longest phrase first (same "longer match
 * wins" rule `collectFanerHits` uses, in case two starred quotes nest).
 */
export function collectStarHits(
  text: string,
  turnKey: string,
  cards: AllyCard[],
  starred: Set<string>,
): StarHit[] {
  if (starred.size === 0) return [];
  const lower = text.toLowerCase();
  const hits: StarHit[] = [];
  for (const c of cards) {
    if (!starred.has(c.id)) continue;
    if (c.sourceKey !== turnKey) continue;
    const quote = (c.sourceQuote ?? "").trim();
    if (quote.length < 3) continue;
    if (findBoundedIndex(lower, quote.toLowerCase()) !== -1) {
      hits.push({ phrase: quote, card: c });
    }
  }
  return hits.sort((a, b) => b.phrase.length - a.phrase.length);
}

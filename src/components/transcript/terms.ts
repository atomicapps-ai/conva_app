import type { Capture } from "@/lib/ipc";

/** One chip in the Terms tab (words only; info opens on click). */
export interface TermChip {
  /** Stable key within the rendered list. */
  id: string;
  label: string;
  /** "capture" = detected live (FANER); "doc" = grounded-context term. */
  source: "capture" | "doc";
  capture?: Capture;
}

/** The FANER tag shown on a chip's info card ("concept", "fix", "recall", …). */
export function chipKindTag(chip: TermChip): string {
  const c = chip.capture;
  if (!c) return "term";
  if (c.kind) return c.kind === "problem" ? "fix" : c.kind;
  return c.action.toLowerCase();
}

/**
 * The Terms tab's chip lists: live captures first ("detected in
 * conversation"), then the grounded context's terms ("from your documents").
 * A doc term whose label matches a capture case-insensitively is dropped —
 * the capture wins, it carries the preview.
 */
export function buildTermChips(
  captures: readonly Capture[],
  docTerms: readonly string[],
): { detected: TermChip[]; docs: TermChip[] } {
  const detected: TermChip[] = [];
  const seen = new Set<string>();
  captures.forEach((c, i) => {
    const label = captureTermLabel(c);
    if (!label) return;
    detected.push({ id: `c-${i}-${label}`, label, source: "capture", capture: c });
    seen.add(label.toLowerCase());
  });
  const docs = docTerms
    .filter((t) => !seen.has(t.toLowerCase()))
    .map((t): TermChip => ({ id: `d-${t}`, label: t, source: "doc" }));
  return { detected, docs };
}

/** Display label for a FANER capture in the Terms tab — its matched keywords. */
export function captureTermLabel(capture: Capture): string {
  return capture.arguments.join(" ").trim();
}

/**
 * The Terms tab's "From your documents" list: the grounded context's
 * user-declared key terms first, then the digest glossary, case-insensitively
 * deduped and trimmed (the two lists routinely overlap).
 */
export function buildDocTerms(
  keyTerms: readonly string[] | undefined,
  glossary: readonly string[] | undefined,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of [...(keyTerms ?? []), ...(glossary ?? [])]) {
    const term = raw.trim();
    const key = term.toLowerCase();
    if (!term || seen.has(key)) continue;
    seen.add(key);
    out.push(term);
  }
  return out;
}

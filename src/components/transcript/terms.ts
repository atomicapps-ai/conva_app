import type { Capture } from "@/lib/ipc";

/** One chip in the Terms tab (words only; info opens on click). */
export interface TermChip {
  /** Stable key within the rendered list. */
  id: string;
  label: string;
  /** "capture" = FANER-routed; "live" = underlined in the transcript (RAG
   *  highlight or a user-selected phrase); "doc" = grounded-context term. */
  source: "capture" | "live" | "doc";
  capture?: Capture;
  /** The cached definition Ally already wrote for this term in its
   *  generated documents, when one exists — lets Define resolve instantly
   *  instead of a live Ally call (spec 2026-08-26). Doc-sourced chips
   *  only; captures/live terms never have one. */
  definition?: string;
}

/** The FANER tag shown on a chip's info card ("concept", "fix", "recall", …). */
export function chipKindTag(chip: TermChip): string {
  const c = chip.capture;
  if (!c) return "term";
  if (c.kind) return c.kind === "problem" ? "fix" : c.kind;
  return c.action.toLowerCase();
}

/**
 * The Terms tab's chip lists. "Detected in conversation" = FANER captures
 * first (they carry previews), then the words actually underlined in the
 * transcript (`liveTerms`: RAG highlights + user-selected phrases, in the
 * order given). "From your documents" = the grounded context's terms. Later
 * lists drop labels an earlier list already covers (case-insensitive) — the
 * richer source wins.
 */
export function buildTermChips(
  captures: readonly Capture[],
  liveTerms: readonly string[],
  docTerms: readonly string[],
  docDefinitions?: Record<string, string>,
): { detected: TermChip[]; docs: TermChip[] } {
  const detected: TermChip[] = [];
  const seen = new Set<string>();
  captures.forEach((c, i) => {
    const label = captureTermLabel(c);
    if (!label) return;
    detected.push({ id: `c-${i}-${label}`, label, source: "capture", capture: c });
    seen.add(label.toLowerCase());
  });
  for (const t of liveTerms) {
    const label = t.trim();
    if (!label || seen.has(label.toLowerCase())) continue;
    seen.add(label.toLowerCase());
    detected.push({ id: `l-${label}`, label, source: "live" });
  }
  const docs = docTerms
    .filter((t) => !seen.has(t.toLowerCase()))
    .map((t): TermChip => ({
      id: `d-${t}`,
      label: t,
      source: "doc",
      definition: docDefinitions?.[t],
    }));
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

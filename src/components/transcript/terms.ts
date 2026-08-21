import type { Capture } from "@/lib/ipc";

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

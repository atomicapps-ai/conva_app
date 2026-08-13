/**
 * Pure resolution math for the session-grounding picker
 * (`conva_core/docs/technical/conversation-context-session-grounding.md`).
 *
 * The picker lets the user check any mix of whole contexts + individual
 * library documents; this module is the "no duplicates allowed" part — it
 * merges everything checked into one deduped grounding payload. Fetching
 * (which contexts/docs are involved) and the fast-path-vs-quick-create
 * decision live in the component; this stays pure and testable.
 */

export interface GroundingSource {
  docIds: string[];
  keyTerms: string[];
}

export interface ResolvedGrounding {
  /** Deduped union of every source's docs, first-seen order. */
  docIds: string[];
  /** Deduped union (case-insensitive) of every source's key terms. */
  keyTerms: string[];
}

/** Merge checked contexts + individually checked library docs into one
 *  deduped grounding payload — the quick-create context's source material. */
export function resolveGrounding(
  contexts: GroundingSource[],
  extraDocIds: string[],
): ResolvedGrounding {
  const docIds: string[] = [];
  const seenDocs = new Set<string>();
  const addDoc = (id: string) => {
    if (id && !seenDocs.has(id)) {
      seenDocs.add(id);
      docIds.push(id);
    }
  };
  for (const c of contexts) for (const id of c.docIds) addDoc(id);
  for (const id of extraDocIds) addDoc(id);

  const keyTerms: string[] = [];
  const seenTerms = new Set<string>();
  for (const c of contexts) {
    for (const raw of c.keyTerms) {
      const term = raw.trim();
      const key = term.toLowerCase();
      if (term && !seenTerms.has(key)) {
        seenTerms.add(key);
        keyTerms.push(term);
      }
    }
  }
  return { docIds, keyTerms };
}

/** Auto-name a quick-created context from what's grounding it — no prompt,
 *  editable later. "<first label>" alone, "<first> + N more" for a mix, or a
 *  timestamped fallback if nothing has a usable label. */
export function autoNameGrounding(labels: string[]): string {
  const clean = labels.map((l) => l.trim()).filter(Boolean);
  if (clean.length === 0) {
    const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
    return `Quick context — ${stamp}`;
  }
  if (clean.length === 1) return clean.join("");
  return `${clean.slice(0, 1).join("")} + ${clean.length - 1} more`;
}

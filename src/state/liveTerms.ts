import { create } from "zustand";

/**
 * Terms surfaced from the live transcript for the Terms tab (owner,
 * 2026-08-21: "I should see the words that are underlined on the left ready
 * for me to click on the right"):
 *
 * - `spoken` — the RAG-highlighted terms each bubble detects (reported by
 *   `Bubble`'s analyze pass), aggregated conversation-wide.
 * - `added` — phrases the user selected in the transcript and sent to Ally
 *   (selection → lightbulb). These also get underlined back in the
 *   transcript, same treatment as detected terms.
 *
 * Cleared with the conversation (`newConversation`/discard).
 */
interface LiveTermsState {
  spoken: string[];
  added: string[];
  reportSpoken: (terms: string[]) => void;
  addUserTerm: (term: string) => void;
  clear: () => void;
}

/** Longest phrase worth treating as a term chip / highlight. */
export const MAX_TERM_LEN = 60;

function mergeUnique(current: string[], incoming: string[]): string[] {
  const seen = new Set(current.map((t) => t.toLowerCase()));
  const out = [...current];
  for (const raw of incoming) {
    const term = raw.trim();
    const key = term.toLowerCase();
    if (!term || term.length > MAX_TERM_LEN || seen.has(key)) continue;
    seen.add(key);
    out.push(term);
  }
  return out;
}

export const useLiveTermsStore = create<LiveTermsState>((set) => ({
  spoken: [],
  added: [],

  reportSpoken: (terms) =>
    set((s) => {
      const next = mergeUnique(s.spoken, terms);
      return next === s.spoken || next.length === s.spoken.length
        ? s
        : { ...s, spoken: next };
    }),

  addUserTerm: (term) =>
    set((s) => {
      const next = mergeUnique(s.added, [term]);
      return next.length === s.added.length ? s : { ...s, added: next };
    }),

  clear: () => set({ spoken: [], added: [] }),
}));

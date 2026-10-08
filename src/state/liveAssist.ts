import { create } from "zustand";

import type { LiveAssistResult } from "@/lib/ipc";
import { isFinalLifecycle } from "@/lib/ipc";

/** Results kept in memory; older finished ones are dropped first. */
const MAX_RESULTS = 30;

interface LiveAssistState {
  /** Oldest first, in the order each `result_id` was first seen. */
  results: LiveAssistResult[];
  /**
   * Fold in one emission. A result id keeps only its highest revision, so a
   * late or repeated event can never roll a finished grid back to its holding
   * response.
   */
  apply: (result: LiveAssistResult) => void;
  clear: () => void;
}

export const useLiveAssistStore = create<LiveAssistState>((set) => ({
  results: [],
  apply: (result) =>
    set((state) => {
      const at = state.results.findIndex((r) => r.result_id === result.result_id);
      if (at >= 0) {
        if (result.revision <= state.results[at]!.revision) return {};
        const next = state.results.slice();
        next[at] = result;
        return { results: next };
      }
      let next = [...state.results, result];
      while (next.length > MAX_RESULTS) {
        const drop = next.findIndex((r) => isFinalLifecycle(r.lifecycle));
        next = next.filter((_, i) => i !== (drop >= 0 ? drop : 0));
      }
      return { results: next };
    }),
  clear: () => set({ results: [] }),
}));

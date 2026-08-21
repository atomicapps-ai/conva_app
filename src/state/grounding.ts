import { create } from "zustand";

/** UI-side mirror of the active session-grounding context (backend state:
 *  `AppState.active_context_terms` + `active_context_doc_ids`, set via the
 *  `activate_context`/`deactivate_context` commands). Lets the TopBar show
 *  what's grounding the next session without a round-trip on every render.
 *  See `conva_core/docs/technical/conversation-context-session-grounding.md`. */
interface GroundingState {
  activeId: string | null;
  activeTitle: string | null;
  /** Bumped on EVERY activation, including re-activating the same context —
   *  consumers that fetch per-activation data (the Terms tab's doc terms)
   *  key their reload on this, not just `activeId`, so re-grounding the
   *  same context (whose glossary may have just been backfilled or
   *  regenerated backend-side) still refreshes. */
  activationNonce: number;
  /** True while the picker is quick-creating + generating a context. */
  activating: boolean;
  setActivating: (v: boolean) => void;
  setActive: (id: string, title: string) => void;
  clear: () => void;
}

export const useGroundingStore = create<GroundingState>((set) => ({
  activeId: null,
  activeTitle: null,
  activationNonce: 0,
  activating: false,

  setActivating: (v) => set({ activating: v }),
  setActive: (id, title) =>
    set((s) => ({
      activeId: id,
      activeTitle: title,
      activating: false,
      activationNonce: s.activationNonce + 1,
    })),
  clear: () => set({ activeId: null, activeTitle: null, activating: false }),
}));

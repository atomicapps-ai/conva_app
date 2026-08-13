import { create } from "zustand";

/** UI-side mirror of the active session-grounding context (backend state:
 *  `AppState.active_context_terms` + `active_context_doc_ids`, set via the
 *  `activate_context`/`deactivate_context` commands). Lets the TopBar show
 *  what's grounding the next session without a round-trip on every render.
 *  See `conva_core/docs/technical/conversation-context-session-grounding.md`. */
interface GroundingState {
  activeId: string | null;
  activeTitle: string | null;
  /** True while the picker is quick-creating + generating a context. */
  activating: boolean;
  setActivating: (v: boolean) => void;
  setActive: (id: string, title: string) => void;
  clear: () => void;
}

export const useGroundingStore = create<GroundingState>((set) => ({
  activeId: null,
  activeTitle: null,
  activating: false,

  setActivating: (v) => set({ activating: v }),
  setActive: (id, title) => set({ activeId: id, activeTitle: title, activating: false }),
  clear: () => set({ activeId: null, activeTitle: null, activating: false }),
}));

import { create } from "zustand";

interface ContextsQuickOpenState {
  pendingId: string | null;
  /** Queue a context id to jump straight to its detail page next time
   *  ContextsView mounts. */
  request: (id: string) => void;
  /** Read-and-clear — call once on mount so a stale id can't reopen the
   *  same detail page on every subsequent visit. */
  consume: () => string | null;
}

/**
 * One-shot cross-navigation intent, same pattern as `libraryQuickAdd.ts`:
 * Conversations' "Rehearse" tab lists contexts and needs to jump straight
 * into one's detail page (Step 3/4 — personas, start rehearsal) on click,
 * without duplicating `SimConDetail` or exposing ContextsView's internal
 * `mode` state globally. `request(id)` + `setView("simcon")`, consumed once
 * in `ContextsView`'s mode initializer.
 */
export const useContextsQuickOpen = create<ContextsQuickOpenState>((set, get) => ({
  pendingId: null,
  request: (id) => set({ pendingId: id }),
  consume: () => {
    const id = get().pendingId;
    if (id) set({ pendingId: null });
    return id;
  },
}));

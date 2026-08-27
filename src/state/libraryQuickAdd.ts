import { create } from "zustand";

export type QuickAddAction = "upload" | "paste" | "new_context";

interface LibraryQuickAddState {
  pending: QuickAddAction | null;
  request: (action: QuickAddAction) => void;
  /** Read-and-clear — the Contexts screen calls this once on mount so a
   *  stale request never re-fires on a later visit. */
  consume: () => QuickAddAction | null;
}

/**
 * A one-shot signal so ⌘K's "Add a document…" / "Paste a note…" / "New
 * context…" commands can trigger the right flow on the Contexts & Library
 * screen from anywhere in the app — owner request: adding a document,
 * pasting text, or starting a context should be easy "at any time", not
 * gated behind first navigating there by hand. `request()` sets the intent
 * and the caller navigates to `"context"`; the screen `consume()`s it once
 * on mount.
 */
export const useLibraryQuickAdd = create<LibraryQuickAddState>((set, get) => ({
  pending: null,
  request: (action) => set({ pending: action }),
  consume: () => {
    const action = get().pending;
    if (action) set({ pending: null });
    return action;
  },
}));

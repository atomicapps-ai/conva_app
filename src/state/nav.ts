import { create } from "zustand";

/**
 * Studio navigation state (UI overhaul M2). The app is a single instrument
 * with a left icon rail selecting the active {@link View}; "live" is the
 * transcript/Ally cockpit, the rest are the former dropdown panels promoted
 * to first-class routed views. The ⌘K command palette floats over any view.
 */
export type View =
  | "dashboard"
  | "live"
  | "conversations"
  | "context"
  | "library"
  | "coaching"
  | "features"
  | "whatsnew"
  | "releases"
  | "about"
  | "models"
  | "settings"
  | "profile"
  | "recordings";

interface NavState {
  view: View;
  setView: (view: View) => void;
  /** A Settings group to open on arrival (a sub-view's back button returns to
   *  the group it came from, not the default). Read once by the Settings
   *  shell, which clears it. */
  pendingSettingsGroup: string | null;
  openSettingsGroup: (group: string) => void;

  /** ⌘K command palette visibility. */
  paletteOpen: boolean;
  openPalette: () => void;
  closePalette: () => void;
  togglePalette: () => void;
}

export const useNavStore = create<NavState>((set) => ({
  view: "dashboard",
  setView: (view) => set({ view, paletteOpen: false }),
  pendingSettingsGroup: null,
  openSettingsGroup: (group) => set({ view: "settings", pendingSettingsGroup: group, paletteOpen: false }),

  paletteOpen: false,
  openPalette: () => set({ paletteOpen: true }),
  closePalette: () => set({ paletteOpen: false }),
  togglePalette: () => set((s) => ({ paletteOpen: !s.paletteOpen })),
}));

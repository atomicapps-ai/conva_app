import { create } from "zustand";

/**
 * Dev-only "debug chrome" visibility — persisted to localStorage. Gates the
 * UI elements that exist only to help develop the app (currently just the
 * FANER replay panel, `App.tsx`), so a dev build (`import.meta.env.DEV`,
 * always true under `npm run tauri:gpu`) can still be toggled to preview
 * what a real, production window looks like without a full release build.
 *
 * Default ON (`true`) — matches today's always-on behavior until someone
 * turns it off. Meaningless outside a dev build; callers should still gate
 * on `import.meta.env.DEV` themselves (this store doesn't know or care).
 */
const KEY = "conva.dev.debugChromeVisible";

interface DevModeState {
  debugChromeVisible: boolean;
  setDebugChromeVisible: (visible: boolean) => void;
  toggleDebugChrome: () => void;
}

export const useDevMode = create<DevModeState>((set) => ({
  debugChromeVisible: localStorage.getItem(KEY) !== "0",
  setDebugChromeVisible: (visible) => {
    localStorage.setItem(KEY, visible ? "1" : "0");
    set({ debugChromeVisible: visible });
  },
  toggleDebugChrome: () =>
    set((s) => {
      const next = !s.debugChromeVisible;
      localStorage.setItem(KEY, next ? "1" : "0");
      return { debugChromeVisible: next };
    }),
}));

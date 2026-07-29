import { create } from "zustand";

/**
 * Floating HUD panel state. The only knob today is the background opacity
 * behind the panel content — the customizable "how see-through is the HUD"
 * slider. Opacity is applied as a CSS alpha on the panel *background* only, so
 * the text/controls stay fully crisp while the fill fades (OS-level whole-
 * window alpha would dim the content too, which is wrong for a readable HUD).
 *
 * Persisted to localStorage so the choice survives HUD open/close and app
 * restarts without touching the Rust AppConfig surface.
 */

const STORAGE_KEY = "conva.hud.opacity";
const DEFAULT_OPACITY = 0.72;
const MIN_OPACITY = 0.15;
const MAX_OPACITY = 1;

function clamp(v: number): number {
  if (Number.isNaN(v)) return DEFAULT_OPACITY;
  return Math.min(MAX_OPACITY, Math.max(MIN_OPACITY, v));
}

function loadOpacity(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw != null) return clamp(parseFloat(raw));
  } catch {
    // localStorage unavailable (e.g. SSR / locked-down webview) — use default.
  }
  return DEFAULT_OPACITY;
}

interface HudState {
  /** Background opacity of the panel fill, 0.15–1. */
  opacity: number;
  setOpacity: (opacity: number) => void;
}

export const useHudStore = create<HudState>((set) => ({
  opacity: loadOpacity(),
  setOpacity: (opacity) => {
    const next = clamp(opacity);
    try {
      localStorage.setItem(STORAGE_KEY, String(next));
    } catch {
      // Best-effort persistence; never block the slider on storage.
    }
    set({ opacity: next });
  },
}));

export const HUD_OPACITY_BOUNDS = { min: MIN_OPACITY, max: MAX_OPACITY } as const;

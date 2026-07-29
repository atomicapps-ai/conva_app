import { useEffect } from "react";

import { Icon } from "@/components/ui/Icon";
import { closeHud } from "@/lib/commands";
import { isTauri } from "@/lib/ipc";
import { HUD_OPACITY_BOUNDS, useHudStore } from "@/state/hud";

/**
 * The floating HUD panel view. This is the entire content of the `hud` window
 * (see `src-tauri/src/hud.rs`); `main.tsx` renders it instead of the Studio
 * shell when the window is opened with `?hud=1`.
 *
 * The window itself is borderless + transparent and floats non-activating on
 * top; this component draws the only visible surface — a rounded, alpha-blended
 * card. The header is a drag handle (`data-tauri-drag-region`) so the frameless
 * window can still be moved, and the opacity slider fades the card's *fill*
 * (not its text) live.
 */
export function HudPanel() {
  const opacity = useHudStore((s) => s.opacity);
  const setOpacity = useHudStore((s) => s.setOpacity);

  // Drive the fill alpha through a CSS variable so the change is a cheap,
  // GPU-composited repaint (smooth alpha, no React re-layout of the content).
  useEffect(() => {
    document.documentElement.style.setProperty("--hud-alpha", String(opacity));
  }, [opacity]);

  const dismiss = () => {
    if (isTauri()) void closeHud().catch(() => {});
  };

  return (
    <div className="hud-root">
      <header className="hud-drag" data-tauri-drag-region>
        <span className="hud-title" data-tauri-drag-region>
          conva
        </span>
        <button
          type="button"
          className="hud-close"
          aria-label="Close HUD"
          title="Close HUD"
          onClick={dismiss}
        >
          <Icon name="close" size={13} />
        </button>
      </header>

      <div className="hud-body">
        <p className="hud-hint">
          Floating HUD — always on top, click-safe (it never steals focus).
        </p>
      </div>

      <footer className="hud-footer">
        <label className="hud-opacity" title="Background opacity">
          <Icon name="expand" size={12} />
          <input
            type="range"
            min={HUD_OPACITY_BOUNDS.min}
            max={HUD_OPACITY_BOUNDS.max}
            step={0.01}
            value={opacity}
            aria-label="Background opacity"
            onChange={(e) => setOpacity(parseFloat(e.target.value))}
          />
          <span className="hud-opacity-val">{Math.round(opacity * 100)}%</span>
        </label>
      </footer>
    </div>
  );
}

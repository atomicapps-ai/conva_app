import { useEffect, useState } from "react";
import type { Window as TauriWindow } from "@tauri-apps/api/window";

import mark from "@/assets/brand/conva-mark-cutout-white.svg";
import { Icon } from "@/components/ui/Icon";
import { isTauri } from "@/lib/ipc";
import { useElapsed } from "@/lib/useElapsed";
import { useNavStore } from "@/state/nav";
import { useTranscriptStore } from "@/state/transcript";

/**
 * The custom title bar V4.0 replaces the OS one with (`conva_core/brand/UI/
 * AppUI_V4.0` — the mockup's very top strip: mark, a "● LIVE mm:ss" pill
 * while a session is running, and its own minimize/maximize/close). Desktop
 * only — `decorations: false` on the main window (`tauri.conf.json`) turns
 * off the native chrome this replaces; `capabilities/default.json` grants
 * the window permissions this needs (start-dragging, minimize, maximize,
 * unmaximize, toggle-maximize, is-maximized, close).
 *
 * The whole bar is a drag region (`data-tauri-drag-region`) EXCEPT the
 * button hit-areas — a button nested inside a drag region stays clickable
 * in Tauri; the region only captures drags that start on empty background.
 */
export function WindowChrome() {
  const setView = useNavStore((s) => s.setView);
  const session = useTranscriptStore((s) => s.session);
  const listening = session.state === "listening";
  const elapsed = useElapsed(listening);
  const [maximized, setMaximized] = useState(false);

  // Track maximized state to swap the restore/maximize glyph — resize covers
  // both dragging the edge and clicking the maximize button itself.
  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    void (async () => {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const win = getCurrentWindow();
      const sync = () =>
        void win.isMaximized().then((m) => !cancelled && setMaximized(m));
      sync();
      unlisten = await win.onResized(sync);
    })();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  /** Run a window action, deferring the (type-only-imported) module load
   *  until an actual click — same lazy-import pattern as compact.ts. */
  const winAction = (fn: (win: TauriWindow) => Promise<void>) => {
    if (!isTauri()) return;
    void import("@tauri-apps/api/window").then(({ getCurrentWindow }) =>
      fn(getCurrentWindow()),
    );
  };

  return (
    <header
      data-tauri-drag-region
      className="flex h-8 shrink-0 select-none items-center gap-2.5 border-b border-border bg-bg-2 pl-3"
    >
      {/* Click → home. This used to live on the (now-removed) global
          TopBar's wordmark — moved here so "click the mark to go home"
          keeps working now that TopBar is gone. */}
      <button
        type="button"
        onClick={() => setView("dashboard")}
        title="conva — go home"
        aria-label="Go home"
        className="flex items-center gap-2.5 rounded transition hover:opacity-80"
      >
        {/* ~20% up from h-4/text-[11px] (owner, 2026-08-17) — this is now
            the ONLY mark in the window (NavRail's own duplicate mark was
            removed the same day), so it carries the full weight of "where's
            the brand" alone and reads better with room to breathe. */}
        <img
          src={mark}
          alt=""
          draggable={false}
          className="h-[19px] w-[19px] opacity-90"
          aria-hidden
        />
        <span className="font-mono text-[13px] font-bold tracking-[0.14em] text-fg-faint">
          CONVA
        </span>
      </button>

      {listening && (
        <span className="flex items-center gap-1.5 rounded-full border border-rec/40 bg-rec/10 px-2 py-0.5 text-[10.5px] font-bold text-rec">
          <span className="h-[6px] w-[6px] animate-pulse rounded-full bg-rec" aria-hidden />
          LIVE {elapsed}
        </span>
      )}

      <span className="flex-1" aria-hidden />

      <div className="flex h-full shrink-0 items-stretch">
        <button
          type="button"
          onClick={() => winAction((win) => win.minimize())}
          title="Minimize"
          aria-label="Minimize"
          className="grid w-11 place-items-center text-fg-faint transition hover:bg-white/[0.06] hover:text-fg"
        >
          {/* Standard OS glyphs (dash / square) rather than app iconography —
              these are system affordances, not product-specific meaning. */}
          <span className="h-[1.5px] w-[10px] bg-current" aria-hidden />
        </button>
        <button
          type="button"
          onClick={() => winAction((win) => win.toggleMaximize())}
          title={maximized ? "Restore" : "Maximize"}
          aria-label={maximized ? "Restore" : "Maximize"}
          className="grid w-11 place-items-center text-fg-faint transition hover:bg-white/[0.06] hover:text-fg"
        >
          {maximized ? (
            <span className="relative h-[10px] w-[10px]" aria-hidden>
              <span className="absolute right-0 top-0 h-[8px] w-[8px] border border-current" />
              <span className="absolute bottom-0 left-0 h-[8px] w-[8px] border border-current bg-bg-2" />
            </span>
          ) : (
            <span className="h-[10px] w-[10px] border border-current" aria-hidden />
          )}
        </button>
        <button
          type="button"
          onClick={() => winAction((win) => win.close())}
          title="Close"
          aria-label="Close"
          className="grid w-11 place-items-center text-fg-faint transition hover:bg-rec hover:text-primary-ink"
        >
          <Icon name="close" size={13} />
        </button>
      </div>
    </header>
  );
}

import { useEffect, useRef, useState } from "react";

import { ConsentGate } from "@/components/ConsentGate";
import { PreparingOverlay } from "@/components/PreparingOverlay";
import { RehearsalBar } from "@/components/simcon/RehearsalBar";
import { SaveConversationDialog } from "@/components/SaveConversationDialog";
import { CommandPalette } from "@/components/studio/CommandPalette";
import { NavRail } from "@/components/studio/NavRail";
import { StatusBar } from "@/components/studio/StatusBar";
import { ViewRouter } from "@/components/studio/ViewRouter";
import { WindowChrome } from "@/components/studio/WindowChrome";
import { Icon } from "@/components/ui/Icon";
import { UpdateBanner } from "@/components/UpdateBanner";
import { useAppStore } from "@/state/app";
import { useNavStore } from "@/state/nav";

/**
 * The DESKTOP shell (V4.0 full rebuild): a left NavRail selecting the active
 * view, and a routed content area (ViewRouter). There is no global per-view
 * strip anymore — the mockup doesn't have one; each view owns its own crown
 * (`ViewShell`'s breadcrumb/title for most views, `LiveTopBar` +
 * `LiveControlBar` for Live specifically, which is also where Start/Stop
 * live now — see the note at the top of `TranscriptView.tsx`). Web uses a
 * separate WebShell over the same views. ⌘K opens the command palette from
 * anywhere.
 */
export function StudioShell() {
  const togglePalette = useNavStore((s) => s.togglePalette);
  const compact = useAppStore((s) => s.compact);
  const toggleCompact = useAppStore((s) => s.toggleCompact);

  // Global ⌘K / Ctrl+K → command palette.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        togglePalette();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePalette]);

  // Responsive tiers (V4.0 §"Responsive"): shed order is label text →
  // secondary pane → breadcrumb depth → the rail, driven by actual
  // available width, not just the manual Compact toggle. The packet's own
  // real-window mapping is "~1240 wide / ~900 medium" — below 900 the rail
  // drops its labels automatically, same threshold semantics as the Ally
  // panel's own already-existing width-driven drawer collapse at 640
  // (TranscriptView.tsx) — labels shed first, at the wider breakpoint, the
  // secondary pane second, at the narrower one, matching the stated order.
  // `narrow` is additive to the manual `compact` store flag, never a
  // replacement for it — Compact still does its own (window-resizing) thing.
  const shellRef = useRef<HTMLDivElement>(null);
  const [shellWidth, setShellWidth] = useState(0);
  useEffect(() => {
    const el = shellRef.current;
    if (!el) return;
    const ro = new ResizeObserver((es) => {
      const r = es[0];
      if (r) setShellWidth(r.contentRect.width);
    });
    ro.observe(el);
    setShellWidth(el.getBoundingClientRect().width);
    return () => ro.disconnect();
  }, []);
  const narrow = shellWidth > 0 && shellWidth < 900;

  return (
    <div className="flex h-full flex-col">
      <WindowChrome />
      <UpdateBanner />
      <div ref={shellRef} className="flex min-h-0 flex-1 gap-1 p-1">
        <NavRail narrow={narrow} />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <main className="min-h-0 flex-1 overflow-hidden">
            <ViewRouter />
          </main>
          <StatusBar />
        </div>
      </div>

      {/* Compact mode shrinks the window to a narrow strip; the header's
          Compact toggle can scroll out of reach, so guarantee a way back with
          an always-visible floating Expand control. top-10, not top-2 — sits
          below WindowChrome's own h-8 bar + its minimize/maximize/close
          controls in the same top-right corner. */}
      {compact && (
        <button
          type="button"
          onClick={() => void toggleCompact()}
          title="Expand — leave compact mode"
          aria-label="Expand — leave compact mode"
          className="fixed right-2 top-10 z-50 flex items-center gap-1.5 rounded-full border border-border-strong bg-panel-raised px-3 py-1.5 text-[11px] font-semibold text-fg shadow-lg transition hover:brightness-110"
        >
          <Icon name="expand" size={14} />
          Expand
        </button>
      )}

      {/* Overlays — render above any view. */}
      <RehearsalBar />
      <ConsentGate />
      <PreparingOverlay />
      <SaveConversationDialog />
      <CommandPalette />
    </div>
  );
}

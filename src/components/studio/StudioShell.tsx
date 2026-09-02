import { useEffect, useRef, useState } from "react";

import { ConsentGate } from "@/components/ConsentGate";
import { PreparingOverlay } from "@/components/PreparingOverlay";
import { RehearsalBar } from "@/components/context/RehearsalBar";
import { SaveConversationDialog } from "@/components/SaveConversationDialog";
import { CommandPalette } from "@/components/studio/CommandPalette";
import { NavRail } from "@/components/studio/NavRail";
import { StatusBar } from "@/components/studio/StatusBar";
import { ViewRouter } from "@/components/studio/ViewRouter";
import { WindowChrome } from "@/components/studio/WindowChrome";
import { Icon } from "@/components/ui/Icon";
import { UpdateToast } from "@/components/UpdateToast";
import { resolveLayout } from "@/lib/responsive";
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

  // Responsive tiers — AppUI V5.0 §10. The shed order is FIXED: label → Ally
  // → breadcrumb → rail, and the transcript never shrinks first. The tier
  // table itself lives in `lib/responsive.ts` (pure + unit-tested); this
  // component only measures the shell and renders what the tier asks for.
  // Manual Compact (which physically shrinks the OS window) is additive: it
  // forces the icon rail but can't re-expand a rail that already became a ☰.
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
  // Width 0 = not measured yet; assume the 1280×800 default window rather
  // than flashing the ☰ tier on first paint.
  const layout = resolveLayout(shellWidth || 1280, compact);
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    if (layout.railMode !== "menu") setMenuOpen(false);
  }, [layout.railMode]);

  return (
    <div className="flex h-full flex-col">
      <WindowChrome />
      <UpdateToast />
      {/* One continuous frame — rail and content sit flush, joined by
          NavRail's own right border, not a gap between two floating cards.
          No padding/gap here: the window's own edges are the frame boundary
          (WindowChrome plays the role of the mockup's `.appframe` top edge). */}
      <div ref={shellRef} className="relative flex min-h-0 flex-1">
        {layout.railMode === "menu" ? (
          <>
            {/* Very compact (<700): the rail becomes a ☰ menu. Order and
                labels are preserved inside the drawer — only its placement
                changes (§1 "Responsive shed order"). */}
            <button
              type="button"
              onClick={() => setMenuOpen(true)}
              aria-label="Open navigation"
              aria-expanded={menuOpen}
              title="Navigation"
              className="absolute left-2 top-2 z-30 grid h-9 w-9 place-items-center rounded-[var(--radius)] border border-border-strong bg-panel-raised text-fg-muted transition hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path
                  d="M4 7h16M4 12h16M4 17h16"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
              </svg>
            </button>
            {menuOpen && (
              <>
                <button
                  type="button"
                  aria-label="Close navigation"
                  onClick={() => setMenuOpen(false)}
                  className="fixed inset-0 z-40 cursor-default bg-black/50"
                />
                <div className="absolute inset-y-0 left-0 z-50 shadow-[var(--shadow-lg)]">
                  <NavRail mode="expanded" onNavigate={() => setMenuOpen(false)} />
                </div>
              </>
            )}
          </>
        ) : (
          <NavRail mode={layout.railMode} />
        )}
        {/* bg-bg — the window ground the V5.0 palette puts behind page
            content; cards inside views step UP to bg-panel. */}
        <div className="flex min-w-0 flex-1 flex-col bg-bg">
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

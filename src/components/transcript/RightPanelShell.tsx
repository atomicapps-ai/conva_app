import type { ReactNode } from "react";

import { Icon } from "@/components/ui/Icon";
import type { PanelMode } from "@/state/ally";

/**
 * Owns the right panel's collapse/expand chrome and Starred/Dock mode
 * switch (F12 — see docs/superpowers/specs/2026-08-21-live-panel-starred-
 * board-design.md §4) — a thin arrow-column that stays visible even when
 * collapsed. Mounts whichever content (`StarredBoard` or `AllyMetaPanel`)
 * the caller passes as `children`; neither content component knows this
 * shell exists. Deliberately the component that becomes the fast-follow's
 * detached-window content later (design doc §4, §9) — the detach button
 * below is present but inert in v1.
 */
export function RightPanelShell({
  collapsed,
  onToggleCollapsed,
  mode,
  onSetMode,
  starredCount,
  children,
}: {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  mode: PanelMode;
  onSetMode: (mode: PanelMode) => void;
  /** Badge count for the Starred mode button. */
  starredCount: number;
  children: ReactNode;
}) {
  return (
    <div className="flex h-full shrink-0">
      {!collapsed && <div className="flex h-full min-w-0">{children}</div>}

      {/* Arrow column — always visible, even collapsed, so the panel is
          never more than one click away (design doc goal 4). */}
      <div className="flex w-7 shrink-0 flex-col items-center gap-1 border-l border-border bg-bg-2 py-2">
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-expanded={!collapsed}
          title={collapsed ? "Expand" : "Collapse"}
          aria-label={collapsed ? "Expand the right panel" : "Collapse the right panel"}
          className="grid h-6 w-6 place-items-center rounded text-fg-faint transition-colors hover:bg-ai/10 hover:text-ai"
        >
          <Icon name="chevron" size={14} className={collapsed ? "-rotate-90" : "rotate-90"} />
        </button>

        <span className="my-0.5 h-px w-4 bg-border" aria-hidden />

        <button
          type="button"
          onClick={() => onSetMode("starred")}
          aria-pressed={mode === "starred"}
          title="Starred"
          aria-label={`Show starred cards${starredCount > 0 ? ` (${starredCount})` : ""}`}
          className={`grid h-6 w-6 place-items-center rounded transition-colors ${
            mode === "starred" ? "bg-ai/15 text-ai" : "text-fg-faint hover:text-ai"
          }`}
        >
          <Icon name="star" size={13} filled={mode === "starred"} />
        </button>
        <button
          type="button"
          onClick={() => onSetMode("dock")}
          aria-pressed={mode === "dock"}
          title="Summary / Threads / Grounding"
          aria-label="Show summary, threads, and grounding"
          className={`grid h-6 w-6 place-items-center rounded transition-colors ${
            mode === "dock" ? "bg-ai/15 text-ai" : "text-fg-faint hover:text-ai"
          }`}
        >
          <Icon name="ally" size={13} />
        </button>

        <span className="my-0.5 h-px w-4 bg-border" aria-hidden />

        {/* Detach — inert in v1 (design doc §3, §9): the real
            detach-to-a-separate-window is an explicit fast-follow. Present
            now so its eventual wiring doesn't need new chrome. */}
        <button
          type="button"
          disabled
          title="Detach into its own window — coming soon"
          aria-label="Detach into its own window (coming soon)"
          className="grid h-6 w-6 cursor-not-allowed place-items-center rounded text-fg-faint/40"
        >
          <Icon name="expand" size={12} />
        </button>
      </div>
    </div>
  );
}

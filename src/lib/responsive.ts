/**
 * Responsive tiers — AppUI V5.0 §10 ("Responsive tiers & the external
 * viewer"), plus its component spec's FIXED interaction rules.
 *
 * Retuned for a smaller-screens-first default (owner, 2026-09-02): the
 * default and minimum window shrank, and every breakpoint/pane width moved
 * down with it so the full experience kicks in sooner rather than later.
 *
 * > One layout that sheds in a known order. New-window target 960×640;
 * > minimum full shell 560×440. Opening Contexts never force-resizes a window
 * > the user sized.
 *
 * | Tier          | Width        | Rail       | Contexts panes            | Library |
 * | ------------- | ------------ | ---------- | ------------------------- | ------- |
 * | Wide          | ≥ 1024       | labels     | list + workspace + dock   | docked  |
 * | Compact       | 560 – 1023   | icons only | master/detail             | overlay |
 * | Very compact  | < 560        | ☰ menu     | master/detail             | overlay |
 *
 * Shed order (FIXED): label → Ally → breadcrumb → rail. The transcript never
 * shrinks first, and the Contexts centre (Q&A/workspace) pane never goes
 * below 360px — which is why the dock becomes an overlay under 1024 rather
 * than squeezing it.
 *
 * Pure — no React, no DOM. `useLayoutTier()` (in `useLayoutTier.ts`) is the
 * hook that feeds it a measured width.
 */

export type LayoutTier = "wide" | "compact" | "tiny";

/** Minimum the Contexts centre (Q&A/workspace) pane may ever occupy. */
export const CENTER_MIN_PX = 360;
/** Pane A — the Contexts list (default; resizable 190–280). */
export const CONTEXT_LIST_PX = 220;
/** Pane C — the contextual Library dock (default; resizable 230–320). */
export const LIBRARY_DOCK_PX = 260;
/** Expanded rail width (text + icon). */
export const RAIL_EXPANDED_PX = 184;
/** Icon-only rail width. */
export const RAIL_ICONS_PX = 52;

export const TIER_BREAKPOINTS = {
  /** ≥ this → "wide" (expanded text-and-icon navigation). */
  wide: 1024,
  /** ≥ this (and < wide) → "compact" (icon-only nav); below it → "tiny" (☰). */
  compact: 560,
} as const;

/** Classify a measured shell width into a tier. */
export function layoutTier(width: number): LayoutTier {
  if (width >= TIER_BREAKPOINTS.wide) return "wide";
  if (width >= TIER_BREAKPOINTS.compact) return "compact";
  return "tiny";
}

export type RailMode = "expanded" | "icons" | "menu";

export interface Layout {
  tier: LayoutTier;
  /** How the primary navigation renders at this width. */
  railMode: RailMode;
  /** Whether the contextual Library sits in the flow (`true`) or overlays. */
  libraryDocked: boolean;
  /** Whether the Contexts list and workspace can both be on screen. */
  showsListAndWorkspace: boolean;
}

/**
 * Resolve the whole layout from a measured width.
 *
 * `manualCompact` is the app's own Compact mode (which physically shrinks the
 * OS window). It forces the icon rail but never expands it — a width that has
 * already shed the rail to a ☰ menu stays a menu.
 */
export function resolveLayout(width: number, manualCompact = false): Layout {
  const tier = layoutTier(width);
  let railMode: RailMode =
    tier === "wide" ? "expanded" : tier === "tiny" ? "menu" : "icons";
  if (manualCompact && railMode === "expanded") railMode = "icons";
  return {
    tier,
    railMode,
    libraryDocked: tier === "wide",
    showsListAndWorkspace: tier === "wide",
  };
}

/**
 * Can the Library stay docked at this width without crushing the centre pane?
 * Used by the dock's Pin control: "Pin keeps it docked only when the 360px
 * centre floor remains" (§10).
 */
export function canDockLibrary(
  shellWidth: number,
  railPx: number,
  listPx = CONTEXT_LIST_PX,
  dockPx = LIBRARY_DOCK_PX,
): boolean {
  return shellWidth - railPx - listPx - dockPx >= CENTER_MIN_PX;
}

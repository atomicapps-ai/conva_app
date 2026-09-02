/**
 * Responsive tiers — AppUI V5.0 §10 ("Responsive tiers & the external
 * viewer"), plus its component spec's FIXED interaction rules.
 *
 * > One layout that sheds in a known order. New-window target 1280×800;
 * > minimum full shell 700×600. Opening Contexts never force-resizes a window
 * > the user sized.
 *
 * | Tier          | Width        | Rail       | Contexts panes            | Library |
 * | ------------- | ------------ | ---------- | ------------------------- | ------- |
 * | Wide          | ≥ 1380       | labels     | list + workspace + dock   | docked  |
 * | Standard      | 1040 – 1379  | icons only | list + workspace          | overlay |
 * | Compact       | 700 – 1039   | icons only | master/detail             | overlay |
 * | Very compact  | < 700        | ☰ menu     | master/detail             | overlay |
 *
 * Shed order (FIXED): label → Ally → breadcrumb → rail. The transcript never
 * shrinks first, and the Contexts centre pane never goes below 520px — which
 * is why the dock becomes an overlay under 1380 rather than squeezing it.
 *
 * Pure — no React, no DOM. `useLayoutTier()` (in `useLayoutTier.ts`) is the
 * hook that feeds it a measured width.
 */

export type LayoutTier = "wide" | "standard" | "compact" | "tiny";

/** Minimum the Contexts centre pane may ever occupy (FIXED, §12). */
export const CENTER_MIN_PX = 520;
/** Pane A — the Contexts list (FIXED default; resizable 260–380). */
export const CONTEXT_LIST_PX = 300;
/** Pane C — the contextual Library dock (FIXED default; resizable 320–440). */
export const LIBRARY_DOCK_PX = 360;
/** Expanded rail width (OPT default from §12). */
export const RAIL_EXPANDED_PX = 240;
/** Icon-only rail width (OPT default from §12: "icon-only ~64"). */
export const RAIL_ICONS_PX = 64;

export const TIER_BREAKPOINTS = {
  /** ≥ this → "wide". */
  wide: 1380,
  /** ≥ this (and < wide) → "standard". */
  standard: 1040,
  /** ≥ this (and < standard) → "compact"; below it → "tiny". */
  compact: 700,
} as const;

/** Classify a measured shell width into a tier. */
export function layoutTier(width: number): LayoutTier {
  if (width >= TIER_BREAKPOINTS.wide) return "wide";
  if (width >= TIER_BREAKPOINTS.standard) return "standard";
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
    showsListAndWorkspace: tier === "wide" || tier === "standard",
  };
}

/**
 * Can the Library stay docked at this width without crushing the centre pane?
 * Used by the dock's Pin control: "Pin keeps it docked only when the 520px
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

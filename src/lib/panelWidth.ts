/** Ally panel (3) width, pure so the web fallback's floor is testable.
 *
 * Desktop: the panel is the 340px Questions/Tracking/Terms accordion, and View
 * (4) is its own OS window. Web fallback (no second window): `ViewPanel` is
 * embedded beside the accordion inside the same panel, so at the 340px desktop
 * width it got ~155px and its Say-now text and Pin/Copy row ran off the right
 * edge. Embedded, the panel therefore never starts narrower than
 * `EMBEDDED_VIEW_MIN_PANEL_PX` (the drag handle still widens it to the pref
 * max). The window clamp still wins: the conversation keeps ~320px. */
export const EMBEDDED_VIEW_MIN_PANEL_PX = 520;
const CONVERSATION_MIN_PX = 320;
const PANEL_FLOOR_PX = 280;

export function effectivePanelWidth(opts: {
  panelWidthPx: number;
  windowWidthPx: number;
  embeddedView: boolean;
}): number {
  const base = opts.embeddedView
    ? Math.max(opts.panelWidthPx, EMBEDDED_VIEW_MIN_PANEL_PX)
    : opts.panelWidthPx;
  return opts.windowWidthPx > 0
    ? Math.min(base, Math.max(PANEL_FLOOR_PX, opts.windowWidthPx - CONVERSATION_MIN_PX))
    : base;
}

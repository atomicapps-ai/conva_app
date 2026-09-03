/**
 * Locked brand vectors — imported verbatim from the canonical pack.
 *
 * Source: `conva_core/brand/UI/AppUI_V4.0/icons/locked/` (manifest.json is the
 * authoritative location→file mapping; AppUI V5.0's HANDOFF.md consumes exactly
 * this pack). Every `d`/`cx`/`r`/`stroke-width` below is copied character for
 * character from the committed SVG files — **do not redraw, re-trace, swap in
 * an icon library, or "clean up" the geometry.** The pack's own README:
 *
 * > Import the files directly. Do not redraw them, use an icon library, or
 * > generate substitutes. All icons use transparent backgrounds and
 * > `currentColor`. Preserve each viewBox and render navigation/utilities at
 * > 20px unless the consuming specification says otherwise. Active/inactive
 * > states change color and surrounding surface only; they never change SVG
 * > geometry.
 *
 * These are inlined as React elements rather than shipped as `.svg` files on
 * purpose: the app is CSP-locked (`img-src 'self' data: blob:`) and every other
 * icon in the codebase is already inline (`Icon.tsx`, `Core.tsx`), so tinting
 * happens through `currentColor` + a text-* utility with no extra fetch.
 *
 * Primary navigation is SIX items. Settings is deliberately absent — its gear
 * is `utility-settings`, in the account utility row (V5.0 §1).
 */

import type { ReactNode } from "react";

export type LockedIconName =
  // manifest.primaryNavigation
  | "nav-home"
  | "nav-live-session"
  | "nav-contexts"
  | "nav-library"
  | "nav-coaching"
  | "nav-whats-coming"
  // manifest.accountUtilities
  | "utility-notifications"
  | "utility-settings"
  | "utility-sign-out"
  // manifest.actions
  | "action-start-listening";

type Locked = { viewBox: string; body: ReactNode };

// The mark's `d` data, verbatim — same coordinate string as {@link LockedMark}
// below. Declared here (rather than only near `LockedMark`) so `LOCKED`'s
// `nav-live-session` entry can reuse it without a forward reference.
const MARK_D =
  "M489.65 333.91L486.54 171.27 379.61 48.68 218.9 23.51 79.6 107.52 26.91 261.42 85.46 413.19 227.87 491.81 387.5 460.5 483.19 468.83 445.91 391.29 489.65 333.91ZM402.78 307.14 337.17 388.44 234.64 408.55 143.18 358.06 105.57 260.58 139.42 161.74 228.88 107.78 332.1 123.95 400.78 202.68 354.84 222.55 309.68 168.7 240.48 156.47 241.61 204.11 179.6 191.59 155.54 257.62 179.55 323.67 240.4 358.83 309.62 346.65 354.81 292.83 402.78 307.14Z";

const LOCKED: Record<LockedIconName, Locked> = {
  // nav-home.svg
  "nav-home": {
    viewBox: "0 0 24 24",
    body: (
      <path
        d="M3.5 10.6 12 3.7l8.5 6.9v9.7H15v-6.1H9v6.1H3.5v-9.7Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    ),
  },
  // nav-live-session — the sitewide brand mark (owner, 2026-09-03: "the
  // icon at the top should be the sitewide logo for live session, update
  // the icon on the left navigation"), not a bespoke glyph. Same `MARK_D`
  // path as {@link LockedMark}, verbatim — not a second trace of the mark.
  "nav-live-session": {
    viewBox: "0 0 512 512",
    body: <path d={MARK_D} fill="currentColor" fillRule="evenodd" />,
  },
  // nav-contexts.svg
  "nav-contexts": {
    viewBox: "0 0 24 24",
    body: (
      <>
        <path
          d="m12 3.2-8.5 4.5L12 12l8.5-4.3L12 3.2Z"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="m4.2 12 7.8 4.1 7.8-4.1M4.2 16.4l7.8 4.1 7.8-4.1"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </>
    ),
  },
  // nav-library.svg
  "nav-library": {
    viewBox: "0 0 24 24",
    body: (
      <path
        d="M5.2 4.5v14.8M9.3 4.5v14.8M13.4 5l3.7 13.8M4 20h16"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    ),
  },
  // nav-coaching.svg
  "nav-coaching": {
    viewBox: "0 0 24 24",
    body: (
      <>
        <circle cx="10.5" cy="13.5" r="7.8" stroke="currentColor" strokeWidth="1.8" />
        <circle cx="10.5" cy="13.5" r="4.2" stroke="currentColor" strokeWidth="1.8" />
        <circle cx="10.5" cy="13.5" r="1.2" fill="currentColor" />
        <path
          d="m13.6 10.4 7-7M16.6 3.4h4v4"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </>
    ),
  },
  // nav-whats-coming.svg
  "nav-whats-coming": {
    viewBox: "0 0 24 24",
    body: (
      <>
        <path
          d="M8.4 15.2c-1.5-1.1-2.4-2.8-2.4-4.8a6 6 0 1 1 12 0c0 2-.9 3.7-2.4 4.8-.8.6-1.1 1.2-1.1 2H9.5c0-.8-.3-1.4-1.1-2Z"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M9.6 20h4.8M10 17.2h4"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      </>
    ),
  },
  // utility-notifications.svg
  "utility-notifications": {
    viewBox: "0 0 24 24",
    body: (
      <>
        <path
          d="M5.2 17.2h13.6l-1.6-2.3V10a5.2 5.2 0 0 0-10.4 0v4.9l-1.6 2.3Z"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M9.6 19.4a2.7 2.7 0 0 0 4.8 0"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      </>
    ),
  },
  // utility-settings.svg
  "utility-settings": {
    viewBox: "0 0 24 24",
    body: (
      <>
        <path
          d="M9.5 3h5l.5 2.1c.6.2 1.2.6 1.8 1l2-.6 2.5 4.3-1.6 1.5a8 8 0 0 1 0 2.1l1.6 1.5-2.5 4.3-2-.6c-.6.4-1.2.8-1.8 1l-.5 2.1h-5L9 19.6c-.6-.2-1.2-.6-1.8-1l-2 .6-2.5-4.3 1.6-1.5a8 8 0 0 1 0-2.1L2.7 9.8l2.5-4.3 2 .6c.6-.4 1.2-.8 1.8-1L9.5 3Z"
          stroke="currentColor"
          strokeWidth="1.55"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="12" cy="12.35" r="3.1" stroke="currentColor" strokeWidth="1.7" />
      </>
    ),
  },
  // utility-sign-out.svg
  "utility-sign-out": {
    viewBox: "0 0 24 24",
    body: (
      <>
        <path
          d="M10 4H5.5A1.5 1.5 0 0 0 4 5.5v13A1.5 1.5 0 0 0 5.5 20H10"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
        <path
          d="M13 8.2 16.8 12 13 15.8M8.5 12h8.3"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M17.2 5.5H20v13h-2.8"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </>
    ),
  },
  // action-start-listening.svg — listening bars. NEVER a play triangle or a
  // mic (V5.0 §2, "locked Start Listening component").
  "action-start-listening": {
    viewBox: "0 0 24 24",
    body: (
      <path
        d="M4 10v4M7.2 7.5v9M10.4 4.5v15M13.6 6v12M16.8 8v8M20 10.2v3.6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    ),
  },
};

/**
 * Render one locked vector. Colour comes from `currentColor` (tint with a
 * `text-*` class); geometry never varies by state.
 */
export function LockedIcon({
  name,
  size = 20,
  className = "",
}: {
  name: LockedIconName;
  size?: number;
  className?: string;
}) {
  const it = LOCKED[name];
  return (
    <svg
      width={size}
      height={size}
      viewBox={it.viewBox}
      fill="none"
      className={className}
      aria-hidden="true"
    >
      {it.body}
    </svg>
  );
}

/**
 * The conva wordmark — `conva-wordmark.svg`, verbatim. Per V5.0's component
 * spec this is the LOCKED VECTOR, never a font plus letter-spacing.
 * Intrinsic 180×38; the rail renders it at 112 wide.
 */
export function LockedWordmark({
  width = 112,
  className = "",
  title = "conva",
}: {
  width?: number;
  className?: string;
  title?: string;
}) {
  return (
    <svg
      width={width}
      height={(width * 38) / 180}
      viewBox="0 0 180 38"
      fill="none"
      role="img"
      aria-label={title}
      className={className}
    >
      <g
        stroke="currentColor"
        strokeWidth="3.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M31 7H15C9 7 6 11 6 19s3 12 9 12h16" />
        <rect x="40" y="7" width="27" height="24" rx="8" />
        <path d="M77 31V7l23 24V7" />
        <path d="M109 7l11 24h4l11-24" />
        <path d="M143 31l10-24h6l10 24M148 21h16" />
      </g>
    </svg>
  );
}

/**
 * The compact octagonal mark — `conva-mark.svg`, verbatim (the same two-form
 * silhouette + "C" counter as the shipped `conva-mark-cutout-white.svg`, in
 * `currentColor` form). Used at the top of the icon-only rail.
 */
export function LockedMark({
  size = 30,
  className = "",
  title = "conva",
}: {
  size?: number;
  className?: string;
  title?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 512 512"
      role="img"
      aria-label={title}
      className={className}
    >
      <path fill="currentColor" fillRule="evenodd" d={MARK_D} />
    </svg>
  );
}

/** Just the mark's OUTER two-form silhouette (its first sub-path — the same
 *  `d` data as {@link LockedMark} above, verbatim, truncated at the first
 *  `Z`) with no "C" cutout. Not a retrace: it's the identical coordinate
 *  string, used as its own closed region for {@link LockedMarkBadge}'s
 *  backing fill + outline below. */
const MARK_SILHOUETTE_D =
  "M489.65 333.91L486.54 171.27 379.61 48.68 218.9 23.51 79.6 107.52 26.91 261.42 85.46 413.19 227.87 491.81 387.5 460.5 483.19 468.83 445.91 391.29 489.65 333.91Z";

/**
 * The mark as a blue-rimmed, glowing badge — a bright "C" cut out of a dark
 * bubble, a blue outline traced around the bubble's own silhouette, and an
 * outer glow that follows that same silhouette (not a generic circle).
 * Layering, back to front: a solid light disc in the exact mark shape (no
 * cutout) → the real locked mark on top, dark, with its "C" cutout — the
 * cutout is what lets the light disc show through as the "C" → the outline
 * traced along the silhouette. `filter: drop-shadow` (not `box-shadow`,
 * which would just glow the square bounding box) is what makes the glow
 * hug the actual bubble shape.
 */
export function LockedMarkBadge({
  size = 80,
  bubbleColor = "#0b1220",
  cColor = "#eef1ff",
  ringColor = "#4fb8ff",
  title = "conva",
}: {
  size?: number;
  /** Fill of the bubble body (everywhere the "C" isn't). */
  bubbleColor?: string;
  /** What shows through the "C" cutout. */
  cColor?: string;
  /** Outline + glow color. */
  ringColor?: string;
  title?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 512 512"
      role="img"
      aria-label={title}
      style={{
        filter: `drop-shadow(0 0 ${size * 0.09}px ${ringColor}99) drop-shadow(0 0 ${size * 0.2}px ${ringColor}4d)`,
      }}
    >
      <path d={MARK_SILHOUETTE_D} fill={cColor} />
      <path d={MARK_D} fill={bubbleColor} fillRule="evenodd" />
      <path d={MARK_SILHOUETTE_D} fill="none" stroke={ringColor} strokeWidth={11} strokeLinejoin="round" />
    </svg>
  );
}

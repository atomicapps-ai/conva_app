/**
 * conva icon set — hand-drawn inline SVG line icons.
 *
 * Dependency-free (no icon package) so nothing has to reach the network under
 * the app's locked-down CSP, and every glyph shares one stroke language:
 * 24×24 grid, 1.6 stroke, round caps/joins, `currentColor` so callers tint
 * with text-* utilities. Matches the inline-SVG idiom already used by <Core>.
 */

import type { ReactNode } from "react";

export type IconName =
  | "live"
  | "library"
  | "sessions"
  | "conversations"
  | "settings"
  | "record"
  | "sidecar"
  | "search"
  | "command"
  | "close";

const PATHS: Record<IconName, ReactNode> = {
  // Live cockpit — a sound/signal waveform.
  live: (
    <>
      <path d="M4 12h2l1.5-5 3 12L13 5l2 9 1.5-2H20" />
    </>
  ),
  // Reference library — stacked documents.
  library: (
    <>
      <path d="M5 4.5h9l3 3V19.5H5z" />
      <path d="M13.5 4.5v3.5H17" />
      <path d="M8 12h6M8 15h6" />
    </>
  ),
  // Sessions — clock / history.
  sessions: (
    <>
      <circle cx="12" cy="12" r="7.5" />
      <path d="M12 8v4.3l3 1.8" />
    </>
  ),
  // Conversations — two chat bubbles.
  conversations: (
    <>
      <path d="M4 6.5h10v7H8l-3 2.5v-2.5H4z" />
      <path d="M17 9.5h3v6h-1v2l-2.2-2H12.5" />
    </>
  ),
  // Settings — sliders.
  settings: (
    <>
      <path d="M4 8h9M17 8h3M4 16h3M11 16h9" />
      <circle cx="15" cy="8" r="2" />
      <circle cx="9" cy="16" r="2" />
    </>
  ),
  record: <circle cx="12" cy="12" r="5" fill="currentColor" stroke="none" />,
  // Sidecar — a docked right panel.
  sidecar: (
    <>
      <rect x="4" y="5" width="16" height="14" rx="2" />
      <path d="M14 5v14" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6" />
      <path d="M20 20l-4.5-4.5" />
    </>
  ),
  // The ⌘ command glyph.
  command: (
    <path d="M9 9V7.5A2.5 2.5 0 1 0 6.5 10H9m0 0v5m0-5h6m0 0V7.5A2.5 2.5 0 1 1 17.5 10H15m0 0v5m0 0v1.5A2.5 2.5 0 1 0 17.5 14H15m0 0H9m0 0v1.5A2.5 2.5 0 1 1 6.5 14H9" />
  ),
  close: <path d="M6 6l12 12M18 6L6 18" />,
};

export function Icon({
  name,
  size = 20,
  className = "",
  strokeWidth = 1.6,
}: {
  name: IconName;
  size?: number;
  className?: string;
  strokeWidth?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  );
}

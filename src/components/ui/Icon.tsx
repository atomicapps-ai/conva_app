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
  | "compact"
  | "search"
  | "filter"
  | "command"
  | "close"
  | "chevron"
  | "unfoldMore"
  | "unfoldLess"
  | "bubbleCollapse"
  | "mic"
  | "system"
  | "account"
  | "expand"
  | "lightbulb"
  | "thumbUp"
  | "thumbDown"
  | "book"
  | "info"
  | "howto"
  | "question"
  | "target"
  | "elaborate"
  | "simicon"
  | "edit"
  | "reasoning"
  | "summarize"
  | "more"
  | "copy"
  | "trash"
  | "sparkle"
  | "file"
  | "clipboard"
  | "upload"
  | "download"
  | "dragHandle"
  | "check"
  | "pin"
  | "lock"
  | "unlock"
  | "save"
  | "add"
  | "link"
  | "home"
  | "ally"
  | "rehearsal"
  | "pause"
  | "eye"
  | "eyeOff"
  | "personaMale"
  | "personaFemale"
  | "star"
  | "starFilled"
  | "camera";

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
  // Simicon — the icon for Conversation Contexts (formerly "Sim Con"): a
  // knowledge hub (a network of connected nodes) briefed for a person, per
  // the mockup's `i-contexts` glyph verbatim
  // (`conva_core/brand/UI/AppUI_V4.0`) — was a two-speech-bubbles glyph that
  // didn't match the reference (owner feedback 2026-08-17).
  simicon: (
    <>
      <g fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
        <circle cx="14.5" cy="9" r="4.8" />
        <path d="M19.3 9h1.8M17.89 12.39l1.28 1.28M14.5 13.8v1.8M11.11 12.39l-1.28 1.28M9.7 9H7.9M11.11 5.61 9.83 4.33M14.5 4.2V2.4M17.89 5.61l1.28-1.28" />
      </g>
      <g fill="currentColor">
        <circle cx="11.6" cy="9" r="0.85" />
        <circle cx="14.5" cy="9" r="0.85" />
        <circle cx="17.4" cy="9" r="0.85" />
        <circle cx="6.4" cy="15.6" r="2.4" />
        <path d="M2.4 22a4 4 0 0 1 8 0z" />
      </g>
    </>
  ),
  // Edit — a pencil.
  edit: (
    <>
      <path d="M16.5 3.5l4 4L8 20l-4.5 1 1-4.5z" />
      <path d="M14 6l4 4" />
    </>
  ),
  // Trash — delete.
  trash: (
    <>
      <path d="M4 7h16" />
      <path d="M9 7V5.2A1.7 1.7 0 0 1 10.7 3.5h2.6A1.7 1.7 0 0 1 15 5.2V7" />
      <path d="M6 7l1 12.3A1.7 1.7 0 0 0 8.7 21h6.6A1.7 1.7 0 0 0 17 19.3L18 7" />
      <path d="M10 11v6M14 11v6" />
    </>
  ),
  // Summarize — condensed lines (a short recap).
  summarize: (
    <>
      <path d="M4 6h16M4 10h16M4 14h11M4 18h7" />
    </>
  ),
  // Copy — two overlapping sheets.
  copy: (
    <>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M6 15H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1" />
    </>
  ),
  // Overflow menu — kebab (three vertical dots).
  more: (
    <>
      <circle cx="12" cy="5" r="1.1" />
      <circle cx="12" cy="12" r="1.1" />
      <circle cx="12" cy="19" r="1.1" />
    </>
  ),
  // Reasoning / "thinking" — a thought bubble with an ellipsis (details behind).
  reasoning: (
    <>
      <path d="M5 5.5h11a3 3 0 0 1 3 3v3a3 3 0 0 1-3 3h-5.5L7 18v-3.5H5a3 3 0 0 1-3-3v-3a3 3 0 0 1 3-3z" />
      <circle cx="8" cy="10" r="0.9" />
      <circle cx="11.5" cy="10" r="0.9" />
      <circle cx="15" cy="10" r="0.9" />
    </>
  ),
  // What's New — a sparkle (release highlights).
  sparkle: (
    <>
      <path d="M12 3.5l1.9 5.1 5.1 1.9-5.1 1.9L12 17.5l-1.9-5.1L5 10.5l5.1-1.9z" />
      <path d="M18.5 4l.6 1.6 1.6.6-1.6.6-.6 1.6-.6-1.6-1.6-.6 1.6-.6z" />
    </>
  ),
  // Sessions — clock / history.
  sessions: (
    <>
      <circle cx="12" cy="12" r="7.5" />
      <path d="M12 8v4.3l3 1.8" />
    </>
  ),
  // Conversations — the mockup's `live-sessions.svg` glyph verbatim
  // (`conva_core/brand/UI/AppUI_V4.0/icons`): two chat bubbles over two
  // people, for the merged Conversations page (owner decision, 2026-08-17
  // — folds in the former standalone "History"/sessions list, see
  // ConversationsPanel.tsx). Was a plain two-bubble glyph that didn't say
  // "this holds your past calls." Bubble outlines keep the source's own
  // butt cap (not the app's default round) — the shape reads as bloated
  // with round corners.
  conversations: (
    <>
      <path
        d="M4.3 3.2h7a1.6 1.6 0 0 1 1.6 1.6v2.7a1.6 1.6 0 0 1-1.6 1.6H7.5l-1.9 1.8V9.1h-1.3A1.6 1.6 0 0 1 2.7 7.5V4.8a1.6 1.6 0 0 1 1.6-1.6Z"
        strokeLinecap="butt"
      />
      <path
        d="M13.4 5.6h4.9a1.5 1.5 0 0 1 1.5 1.5v2.4a1.5 1.5 0 0 1-1.5 1.5h-.9v1.7l-1.9-1.7h-2.1a1.5 1.5 0 0 1-1.5-1.5"
        strokeLinecap="butt"
      />
      <path d="M5.1 5.4h5M5.1 6.9h5" />
      <path d="M14.4 7.6h3.1M14.4 9.1h2.1" />
      <circle cx="7.9" cy="15" r="2.3" />
      <path d="M4.2 21v-1a3.7 3.7 0 0 1 7.4 0v1" />
      <circle cx="16.1" cy="15.4" r="2.3" />
      <path d="M12.4 21v-1a3.7 3.7 0 0 1 7.4 0v1" />
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
  // Pause — two bars (V4.0 control bar; not yet wired to a backend command).
  pause: (
    <>
      <path d="M9 6v12" />
      <path d="M15 6v12" />
    </>
  ),
  // Compact — a docked right panel.
  compact: (
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
  // Filter — a funnel (search-bar filter-property popover trigger).
  filter: <path d="M22 3H2l8 9.46V19l4 2v-8.54z" />,
  // The ⌘ command glyph.
  command: (
    <path d="M9 9V7.5A2.5 2.5 0 1 0 6.5 10H9m0 0v5m0-5h6m0 0V7.5A2.5 2.5 0 1 1 17.5 10H15m0 0v5m0 0v1.5A2.5 2.5 0 1 0 17.5 14H15m0 0H9m0 0v1.5A2.5 2.5 0 1 1 6.5 14H9" />
  ),
  close: <path d="M6 6l12 12M18 6L6 18" />,
  // Single chevron (points down; rotate via CSS for an expand/collapse caret).
  chevron: <path d="M6 9l6 6 6-6" />,
  // Expand-all — chevrons pointing apart.
  unfoldMore: <path d="M8 9l4-4 4 4M8 15l4 4 4-4" />,
  // Collapse-all — chevrons pointing together.
  unfoldLess: <path d="M8 5l4 4 4-4M8 19l4-4 4 4" />,
  // Chat bubble with an arrow — toggles whether "your" turns start
  // collapsed by default. Distinct from the plain "chevron" (one turn's
  // own collapse toggle) and unfoldMore/unfoldLess (every turn at once);
  // the arrow flips via the caller's className (rotate-180), same
  // convention as "chevron".
  bubbleCollapse: (
    <>
      <path d="M4 5h16a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H10l-4 3v-3H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z" />
      <path d="M9 9.5l3 3 3-3" />
    </>
  ),
  // Microphone — the "you" stream.
  mic: (
    <>
      <path d="M12 4a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0V7a3 3 0 0 1 3-3z" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </>
  ),
  // System audio bars — the "them" stream.
  system: <path d="M5 9v6M9 5v14M15 7v10M19 10v4" />,
  // Account — user head + shoulders.
  account: (
    <>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5.5 19.5a6.5 6.5 0 0 1 13 0" />
    </>
  ),
  // Expand — four corner arrows (leave compact / go full size).
  expand: <path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" />,
  // Ask Ally — a lightbulb with a lightning filament (initiates AI).
  lightbulb: (
    <>
      <path d="M12 3a6 6 0 0 0-3.6 10.8c.6.45 1.1 1.15 1.1 1.95V17h5v-1.25c0-.8.5-1.5 1.1-1.95A6 6 0 0 0 12 3z" />
      <path d="M9.7 20h4.6M10.7 22.2h2.6" />
      <path d="M12.7 7.2l-2.2 3.7h2.5L11 15" />
    </>
  ),
  // Feedback — thumbs up / down (useful / not useful).
  thumbUp: (
    <>
      <path d="M7 10v10H4.5a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1H7z" />
      <path d="M7 10l3.6-6.4a1.8 1.8 0 0 1 1.9 1.8V8h5.3a1.8 1.8 0 0 1 1.8 2.1l-1.1 7a1.8 1.8 0 0 1-1.8 1.5H7" />
    </>
  ),
  thumbDown: (
    <>
      <path d="M17 14V4h2.5a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H17z" />
      <path d="M17 14l-3.6 6.4a1.8 1.8 0 0 1-1.9-1.8V16H6.2a1.8 1.8 0 0 1-1.8-2.1l1.1-7A1.8 1.8 0 0 1 7.3 5.4H17" />
    </>
  ),
  // Definition — an open book.
  book: (
    <>
      <path d="M12 6.5C10.5 5 8 4.5 4 4.8v12.4c4-.3 6.5.2 8 1.7 1.5-1.5 4-2 8-1.7V4.8c-4-.3-6.5.2-8 1.7z" />
      <path d="M12 6.5v12.1" />
    </>
  ),
  // Info — a lower-case "i" in a circle (context-row detail popover).
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5.5" />
      <path d="M12 8h.01" />
    </>
  ),
  // How-to — a question mark in a rounded square.
  howto: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="4" />
      <path d="M9.5 9.2a2.6 2.6 0 0 1 5 .9c0 1.7-2.5 2-2.5 3.6" />
      <path d="M12 17h.01" />
    </>
  ),
  // Questions section — a speech bubble carrying a question mark.
  question: (
    <>
      <path d="M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-7l-4 3.5V17H6a2 2 0 0 1-2-2z" />
      <path d="M10.2 8.6a2 2 0 0 1 3.8.7c0 1.3-1.9 1.5-1.9 2.7" />
      <path d="M12.1 14.4h.01" />
    </>
  ),
  // Tracking section — a target/crosshair (things being watched live).
  target: (
    <>
      <circle cx="12" cy="12" r="7" />
      <circle cx="12" cy="12" r="2.5" />
      <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3" />
    </>
  ),
  // Elaborate — expand outward (plus with radiating arrows).
  elaborate: (
    <>
      <path d="M12 8v8M8 12h8" />
      <path d="M5 5l2 2M19 5l-2 2M5 19l2-2M19 19l-2-2" />
    </>
  ),
  // File — generic document with a folded corner (library rows).
  file: (
    <>
      <path d="M6.5 3.5h7l4 4v13a1 1 0 0 1-1 1h-10a1 1 0 0 1-1-1v-16a1 1 0 0 1 1-1z" />
      <path d="M13.5 3.5v4h4" />
    </>
  ),
  // Clipboard — pasted-note provenance + the paste-from-clipboard action.
  clipboard: (
    <>
      <rect x="6" y="4.5" width="12" height="16.5" rx="2" />
      <path d="M9.3 4.5V3.6a1.1 1.1 0 0 1 1.1-1.1h3.2a1.1 1.1 0 0 1 1.1 1.1v.9" />
      <path d="M9 11h6M9 14.5h4" />
    </>
  ),
  // Upload — add a document (file picker).
  upload: (
    <>
      <path d="M12 15V4M8.5 7.5 12 4l3.5 3.5" />
      <path d="M5 15v3.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V15" />
    </>
  ),
  // Download — write a library document back to disk.
  download: (
    <>
      <path d="M12 4v11M8.5 11.5 12 15l3.5-3.5" />
      <path d="M5 15v3.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V15" />
    </>
  ),
  // Check — a passing checklist line.
  check: (
    <>
      <path d="M5 12.5l4.5 4.5L19 7" />
    </>
  ),
  // Drag handle — a 2x3 grip of dots (draggable library rows).
  dragHandle: (
    <>
      <circle cx="9" cy="6" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="15" cy="6" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="9" cy="12" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="15" cy="12" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="9" cy="18" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="15" cy="18" r="1.1" fill="currentColor" stroke="none" />
    </>
  ),
  // Pin — a thumbtack, for pinning a thread/card to the top of a list.
  pin: (
    <>
      <path d="M9 3h6l1 6-2 2h-6l-2-2 1-6z" />
      <path d="M12 17v5" />
    </>
  ),
  // Lock — partner window follows the app (closed shackle).
  lock: (
    <>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </>
  ),
  // Unlock — partner window floats free (open shackle).
  unlock: (
    <>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 7.6-1.7" />
    </>
  ),
  // Save — a floppy disk, for committing the live/current state as a named
  // record (distinct from "download," which writes an existing library
  // document to a user-chosen disk path).
  save: (
    <>
      <path d="M5 4.5h11.5l2.5 2.5V19a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5.5a1 1 0 0 1 1-1z" />
      <path d="M8 4.5v4h6.5v-4" />
      <path d="M8 20v-5.5h8V20" />
    </>
  ),
  // Add / new — a circled plus, for starting a fresh record.
  add: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 8v8M8 12h8" />
    </>
  ),
  // Link — two overlapping chain links, for attaching a library doc to the
  // open conversation.
  link: (
    <>
      <path d="M9.3 14.7a3 3 0 0 0 4.4.2l2-2a3 3 0 0 0-4.3-4.3l-1 1" />
      <path d="M14.7 9.3a3 3 0 0 0-4.4-.2l-2 2a3 3 0 0 0 4.3 4.3l1-1" />
    </>
  ),
  // Home — a simple roofline + base, for the "go home" rail shortcut.
  home: (
    <>
      <path d="M4 11.5 12 4l8 7.5" />
      <path d="M6 10v9.5a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V10" />
      <path d="M10 20.5V15h4v5.5" />
    </>
  ),
  // Ally — the mockup's `i-ally` glyph verbatim (`conva_core/brand/UI/
  // AppUI_V4.0`): a faceted gem with a live pulse/waveform line replacing
  // its top edge. Was a plain gem with no pulse line — didn't match the
  // reference (owner feedback 2026-08-17). Thinner stroke (1.1 vs. the
  // 1.6 app default) is the mockup's own value — the pulse line packs a
  // lot of detail into a small area and needs it to stay legible.
  ally: (
    <g fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4.5 9.5H19.5" />
      <path d="M4.5 9.5 12 20.5 19.5 9.5" />
      <path d="M9 9.5 12 20.5M15 9.5 12 20.5" />
      <path d="M4.5 9.5 7.5 5.5M19.5 9.5 16.5 5.5" />
      <path d="M7.5 5.5 9 9.5M16.5 5.5 15 9.5" />
      <path d="M4 5.5H7L7.7 3.8 8.4 6 9.1 3.2 9.8 5.8 10.5 1.8 11.15 8 11.55 10.5 12 6.5 12.5 3 13.2 5.8 13.9 4.4 14.7 6 15.6 5 17 5.5H20" />
    </g>
  ),
  // Rehearsal — a repeat/practice-run loop.
  rehearsal: (
    <>
      <path d="M4 12a8 8 0 0 1 8-8 8 8 0 0 1 6.5 3.3" />
      <path d="M20 12a8 8 0 0 1-8 8 8 8 0 0 1-6.5-3.3" />
      <path d="M18.5 3.5v4h-4M5.5 20.5v-4h4" />
    </>
  ),
  // Eye — visible/preview state (e.g. the dev-chrome toggle, "on").
  eye: (
    <>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  // Eye-off — hidden state (the same eye, struck through).
  eyeOff: (
    <>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="3" />
      <path d="M4 4l16 16" />
    </>
  ),
  // Counterparty persona avatars — same head, two body silhouettes (owner,
  // 2026-08-30). Male mirrors the existing generic `account` shape; female
  // gets the flared "dress" silhouette — the same duo public-signage icons
  // use, chosen for instant recognizability at 24-32px card sizes.
  personaMale: (
    <>
      <circle cx="12" cy="7.5" r="3.2" />
      <path d="M8 20v-4.5a4 4 0 0 1 8 0V20" />
    </>
  ),
  personaFemale: (
    <>
      <circle cx="12" cy="7" r="3.2" />
      <path d="M10 12h4l3.5 8h-11z" />
    </>
  ),
  // The counterparty card's "choose this persona" control — outline when
  // not chosen, filled when it is (same two-glyph-per-state idiom as
  // lock/unlock and eye/eyeOff above).
  star: <path d="M12 3.5l2.6 5.6 6.1.7-4.5 4.2 1.2 6-5.4-3-5.4 3 1.2-6-4.5-4.2 6.1-.7z" />,
  starFilled: (
    <path
      d="M12 3.5l2.6 5.6 6.1.7-4.5 4.2 1.2 6-5.4-3-5.4 3 1.2-6-4.5-4.2 6.1-.7z"
      fill="currentColor"
    />
  ),
  // Screenshot button — a compact camera body with a viewfinder bump and lens.
  camera: (
    <>
      <path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2l1-1.5h7l1 1.5h2A1.5 1.5 0 0 1 20 8.5v9A1.5 1.5 0 0 1 18.5 19h-13A1.5 1.5 0 0 1 4 17.5Z" />
      <circle cx="12" cy="12.5" r="3.2" />
    </>
  ),
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

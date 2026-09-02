import type { LockedIconName } from "@/components/ui/LockedIcon";
import type { View } from "@/state/nav";

/**
 * The one source of truth for the app's primary navigation, consumed by BOTH
 * the desktop left rail (NavRail) and the web top nav (WebTopNav).
 *
 * ── AppUI V5.0 (owner-approved, `conva_core@1b007ed`,
 *    `brand/UI/AppUI_V5.0/HANDOFF.md` §"Navigation (fixed)") ─────────────────
 *
 * Primary navigation is EXACTLY these six destinations, in this order:
 *
 *   Home · Live Session · Contexts · Library · Coaching · What's Coming
 *
 * and they are the whole rail. The rules that came with that decision, written
 * down here so they don't have to be re-derived from the mockup:
 *
 * 1. **Settings is NOT a rail row.** It opens from the gear in the account
 *    utility row below the user's identity, alongside Notifications and Sign
 *    out (`NavRail.tsx`). No rail row is active while Settings is open.
 * 2. **Conversations is a sub-view, not a destination** — reached from Home
 *    ("View all conversations"), from Live, and from ⌘K. It keeps its `View`
 *    and its `ViewShell` back/breadcrumb, per CLAUDE.md rule 9.
 * 3. **Library and Coaching are first-class destinations.** Library was folded
 *    inside Contexts (2026-08-16) and Rehearsal was folded into Conversations
 *    (2026-08-17); V5.0 promotes both. The contextual Library dock inside the
 *    Contexts workspace stays — same documents, different job (attach vs.
 *    manage), see `LibraryView.tsx`'s header comment.
 * 4. **Rehearsals is renamed Coaching everywhere**, and Coaching is the
 *    umbrella: practice templates → coaching setups → coaching sessions.
 * 5. There is no "Insights" destination, and Ally is still not a rail row —
 *    it is the Live cockpit's right panel (owner, 2026-08-17; unchanged).
 * 6. Icons are the **locked** pack (`icons/locked/manifest.json`), rendered by
 *    `LockedIcon`. Active/inactive change colour and surface only, never
 *    geometry — so this list stores the locked asset name, not a drawing.
 *
 * `only` omitted → shown on both platforms; set it to gate a row to one.
 */
export type NavItem = {
  view: View;
  /** Canonical locked asset (`icons/locked/manifest.json`). */
  icon: LockedIconName;
  label: string;
  only?: "web" | "desktop";
};

export const NAV_ITEMS: NavItem[] = [
  { view: "dashboard", icon: "nav-home", label: "Home" },
  { view: "live", icon: "nav-live-session", label: "Live Session" },
  { view: "context", icon: "nav-contexts", label: "Contexts" },
  { view: "library", icon: "nav-library", label: "Library" },
  { view: "coaching", icon: "nav-coaching", label: "Coaching" },
  // `view: "whatsnew"` → WhatsComingView; the view name predates the page
  // rename and is left as-is to avoid a wider rename.
  { view: "whatsnew", icon: "nav-whats-coming", label: "What's Coming" },
];

/** Views that are rail destinations — used to decide whether a view gets a
 *  breadcrumb/back control (CLAUDE.md rule 9: two levels, never a third). */
export const RAIL_VIEWS: ReadonlySet<View> = new Set(NAV_ITEMS.map((i) => i.view));

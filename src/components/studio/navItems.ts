import type { IconName } from "@/components/ui/Icon";
import type { View } from "@/state/nav";

/**
 * The one source of truth for the app's primary navigation, consumed by BOTH
 * the desktop left rail (NavRail) and the web top nav (WebTopNav). `only`
 * omitted → shown on both platforms; set it to gate a row to one.
 */
export type NavItem = {
  view: View;
  icon: IconName;
  label: string;
  only?: "web" | "desktop";
};

/**
 * Order + labels follow the V4.0 "Instrument" reference nav closely (Live
 * session · Contexts · Ally · Rehearsal · History), with the items the
 * mockup doesn't cover — Home and Conversations — appended after it rather
 * than dropped (owner decision, 2026-08-16). "dashboard" (Home) is filtered
 * OUT of the desktop rail specifically in NavRail.tsx — the mockup has no
 * Home row there, only the WindowChrome mark + a small icon above the
 * account block — but stays here so WebTopNav (no equivalent rail-bottom
 * shortcut) still shows it.
 *
 * Library is NOT its own rail item (owner decision, 2026-08-16, reversing
 * an earlier un-merge of the same date): it lives inside the Contexts
 * screen (`ContextsView` + `LibraryPane`) instead of a separate
 * destination — "don't have library separate... make it part of
 * conversation [Contexts]". Quick-add (add a document / paste a note / new
 * context) from anywhere in the app is ⌘K → the palette jumps to Contexts
 * and triggers the flow — see `state/libraryQuickAdd.ts`.
 *
 * The three product/marketing pages (What conva does / What's Coming /
 * What's New) and the Floating HUD toggle used to live here too but were
 * moved out of primary nav entirely (owner decision) onto their own hub page
 * (`AboutMoreView`, `view: "about"`), reachable from Settings → About. They
 * stay real routed views (`features`/`whatsnew`/`releases` in `View`) — just
 * not in this list, so `RAIL_ITEMS`/`WebTopNav` no longer surface them.
 */
export const NAV_ITEMS: NavItem[] = [
  { view: "dashboard", icon: "home", label: "Home" },
  { view: "live", icon: "live", label: "Live session" },
  { view: "simcon", icon: "simicon", label: "Contexts" },
  // Placeholders (owner decision, 2026-08-16): the reference lists these as
  // real destinations but neither has a specced screen yet — Ally is today
  // only the Live view's side panel, Rehearsal only a floating overlay bar
  // during a Sim Con run. Land here as an honest "not built yet" page until
  // scoped for real.
  { view: "ally", icon: "ally", label: "Ally" },
  { view: "rehearsal", icon: "rehearsal", label: "Rehearsal" },
  { view: "sessions", icon: "sessions", label: "History" },
  { view: "conversations", icon: "conversations", label: "Conversations" },
  { view: "settings", icon: "settings", label: "Settings" },
];

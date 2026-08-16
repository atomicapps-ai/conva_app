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
 * Order + labels follow the V4.0 "Instrument" reference nav exactly
 * (Live session · Contexts · Library · Ally · Rehearsal · History), with the
 * items the mockup doesn't cover — Home and Conversations — appended after
 * it rather than dropped (owner decision, 2026-08-16). "dashboard" (Home) is
 * filtered OUT of the desktop rail specifically in NavRail.tsx — the mockup
 * has no Home row there, only the WindowChrome mark + a small icon above the
 * account block — but stays here so WebTopNav (no equivalent rail-bottom
 * shortcut) still shows it.
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
  // Contexts & Library were one unified page (conversation-context-ui.md);
  // un-merged back into two rail items to match the reference exactly
  // (owner decision, 2026-08-16) — the cross-pane drag-to-attach flow that
  // depended on both panes being visible together no longer has a home and
  // needs a replacement interaction; see ContextsPane/LibraryPane TODOs.
  { view: "simcon", icon: "simicon", label: "Contexts" },
  { view: "library", icon: "library", label: "Library" },
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

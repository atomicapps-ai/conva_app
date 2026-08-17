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
 * Order + labels follow the V4.0 "Instrument" reference nav's Live/Contexts
 * rows, with the items the mockup doesn't cover — Home and Conversations —
 * appended after it rather than dropped (owner decision, 2026-08-16).
 * "dashboard" (Home) is filtered OUT of the desktop rail specifically in
 * NavRail.tsx — the mockup has no Home row there, only the WindowChrome
 * mark + a small icon above the account block — but stays here so
 * WebTopNav (no equivalent rail-bottom shortcut) still shows it.
 *
 * Ally is NOT its own rail item (owner decision, 2026-08-17). It's the
 * Live session's side panel per the original designer brief
 * (`designer-handoff-2026-08/BRIEF-app-ui.md`, `conva_core`): "an ALLY
 * panel on the right" of the live screen, not its own page — the earlier
 * 2026-08-16 pass added a placeholder page for it by copying the V4.0
 * mockup's reference nav (which lists four rows — Live/Contexts/Ally/
 * Rehearsal — as if they were four independent destinations) without
 * checking whether the app had four separable things to put behind them.
 * `AllyView.tsx` (the placeholder) is deleted, not just unlisted.
 *
 * Rehearsal IS a rail item (owner decision, 2026-08-17), but it doesn't
 * get a page of its own — `view: "rehearsal"` renders the SAME
 * `ContextsView` component as `view: "simcon"` (see `ViewRouter.tsx`).
 * Rehearsal has never been separate code from Contexts: it's Sim Con
 * Phase D, built into it from the start (`roadmap.md` lists "Sim Con
 * rehearsal" under the already-built Conversation Context feature;
 * `conversation-context-ui.md`, owner-approved 2026-08-12, `conva_core`,
 * decision #2: "Rehearsal stays reachable from a context's detail"). A
 * standalone `RehearsalView.tsx` placeholder existed briefly and was
 * deleted — the fix isn't a second page, it's reusing the one Contexts
 * already has (open a ready context → Step 4 → generate personas →
 * rehearse), just reachable by a second rail door into identical code.
 *
 * "History" is NOT its own rail item (owner decision, 2026-08-17): it was
 * the automatic per-run session log (`session.rs`) with no UI ever
 * explaining how that differed from Conversations (the named, saved
 * records) — two rail rows for what read as one job. Sessions still get
 * logged exactly as before; they're reachable as the "All activity" filter
 * inside `ConversationsPanel` instead of a sibling destination.
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
  { view: "rehearsal", icon: "rehearsal", label: "Rehearsal" },
  { view: "conversations", icon: "conversations", label: "Conversations" },
  { view: "settings", icon: "settings", label: "Settings" },
];

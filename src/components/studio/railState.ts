import { RAIL_VIEWS } from "@/components/studio/navItems";
import type { View } from "@/state/nav";

/**
 * Which rail row (if any) should read as active for the current view.
 *
 * AppUI V5.0 keeps CLAUDE.md rule 9's two-level model: rail destinations, and
 * sub-views drilled into from one. A sub-view keeps its parent's row lit so the
 * rail still answers "where am I" — except for the account surfaces, which are
 * explicitly NOT rail destinations:
 *
 * > Settings is not a rail row — it opens from the gear in the account utility
 * > row below [the user]. **No nav row is active while on Settings.**
 * > — `AppUI_V5.0/…redesign….dc.html` §8
 *
 * Pure and unit-tested (`railState.test.ts`) so the mapping can't drift
 * silently when a view is added.
 */

/** Sub-views that belong to a rail destination, and which one. */
const SUBVIEW_PARENT: Partial<Record<View, View>> = {
  // Conversations is a sub-view now (V5.0 decision 2), reached from Home,
  // Live and ⌘K. Home owns it — it's Home's "View all conversations".
  conversations: "dashboard",
  // Roadmap/marketing surfaces reached from What's Coming.
  features: "whatsnew",
  releases: "whatsnew",
};

/** Account surfaces — reached from the account block, never the rail. */
const ACCOUNT_VIEWS: ReadonlySet<View> = new Set<View>(["settings", "profile", "about"]);

/**
 * The rail row to light for `view`, or `null` when none should be
 * (the account surfaces).
 */
export function activeRailView(view: View): View | null {
  if (ACCOUNT_VIEWS.has(view)) return null;
  if (RAIL_VIEWS.has(view)) return view;
  return SUBVIEW_PARENT[view] ?? null;
}

/** True when `view` is a rail destination in its own right — i.e. it must NOT
 *  render a breadcrumb/back control (CLAUDE.md rule 9). */
export function isRailDestination(view: View): boolean {
  return RAIL_VIEWS.has(view);
}

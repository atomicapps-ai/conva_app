/**
 * The Context workspace's tab strip — AppUI V5.0 §3.
 *
 * > **Overview, Q&A, Briefing, Research are the only first-level Context
 * > tabs.** … Q&A is the default tab when prepared Q&A exists. State preserved
 * > on switch; empty tabs explain how content is produced + one action.
 *
 * And from the FIXED interaction rules (§12): "Tabs use roles + arrow keys."
 * This module is the pure part of both — the tab list, which one opens first,
 * and what an arrow key does — so the behaviour is unit-tested instead of
 * being an untested keydown handler.
 */

export type ContextTab = "overview" | "qa" | "briefing" | "research";

export const CONTEXT_TABS: { id: ContextTab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "qa", label: "Q&A" },
  { id: "briefing", label: "Briefing" },
  { id: "research", label: "Research" },
];

/** Q&A when the context has prepared Q&A, Overview otherwise. */
export function defaultTab(hasPreparedQa: boolean): ContextTab {
  return hasPreparedQa ? "qa" : "overview";
}

/**
 * Roving-tabindex arrow behaviour: Left/Right move by one and wrap; Home/End
 * jump to the ends. Any other key returns the current tab unchanged so the
 * caller knows not to preventDefault.
 */
export function tabForKey(current: ContextTab, key: string): ContextTab {
  const ids = CONTEXT_TABS.map((t) => t.id);
  const i = ids.indexOf(current);
  if (i < 0) return current;
  switch (key) {
    case "ArrowRight":
      return ids[(i + 1) % ids.length] as ContextTab;
    case "ArrowLeft":
      return ids[(i - 1 + ids.length) % ids.length] as ContextTab;
    case "Home":
      return ids[0] as ContextTab;
    case "End":
      return ids[ids.length - 1] as ContextTab;
    default:
      return current;
  }
}

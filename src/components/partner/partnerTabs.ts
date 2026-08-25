import type { PartnerPayload } from "@/lib/ipc";

/**
 * Pure tab-list logic for the partner window (spec §4.1) — the window
 * accumulates every delivered payload into tabs instead of replacing its
 * content. Two tab kinds: an "item" (a term or an already-answered card,
 * exactly what the window rendered pre-tabs) and a "document" (a library
 * document opened from a citation line, spec §4.3).
 */
export type PartnerTab =
  | { key: string; kind: "item"; payload: PartnerPayload }
  | { key: string; kind: "document"; docId: string; fileName: string };

/** Dedupe signature for a delivered payload — same term reopened with the
 *  same (or no) answer focuses the existing tab; a different answer is a
 *  genuinely different item. (The old `openedFor` redelivery guard,
 *  generalized.) */
export function tabKey(p: PartnerPayload): string {
  return `item::${p.term}::${p.answer ?? ""}`;
}

export function documentKey(docId: string): string {
  return `doc::${docId}`;
}

export function itemTab(p: PartnerPayload): PartnerTab {
  return { key: tabKey(p), kind: "item", payload: p };
}

export function documentTab(docId: string, fileName: string): PartnerTab {
  return { key: documentKey(docId), kind: "document", docId, fileName };
}

export function tabLabel(tab: PartnerTab): string {
  return tab.kind === "item" ? tab.payload.term : tab.fileName;
}

/** Append `tab` (or keep the existing one with the same key); either way it
 *  becomes active. */
export function addOrFocus(
  tabs: PartnerTab[],
  tab: PartnerTab,
): { tabs: PartnerTab[]; activeKey: string } {
  if (tabs.some((t) => t.key === tab.key)) {
    return { tabs, activeKey: tab.key };
  }
  return { tabs: [...tabs, tab], activeKey: tab.key };
}

/** Remove the tab at `key`. Closing the active tab activates its right
 *  neighbor, else its left, else nothing (empty state). */
export function closeTab(
  tabs: PartnerTab[],
  key: string,
  activeKey: string | null,
): { tabs: PartnerTab[]; activeKey: string | null } {
  const idx = tabs.findIndex((t) => t.key === key);
  if (idx === -1) return { tabs, activeKey };
  const next = tabs.filter((t) => t.key !== key);
  if (key !== activeKey) return { tabs: next, activeKey };
  const neighbor = next[idx] ?? next[idx - 1] ?? null;
  return { tabs: next, activeKey: neighbor?.key ?? null };
}

import type { FoundItem } from "@/components/transcript/foundGroups";

/**
 * Pure list ops for the View half (spec §3.3): only the items the user
 * selected, in selection order. `seq` orders entries against the answer
 * cards they interleave with (the panel assigns one monotone counter to
 * both). Cards default collapsed (height-capped); `expanded` is the
 * per-card more/less state.
 */
export interface ViewEntry {
  /** = the FoundItem id — selecting the same item focuses, not duplicates. */
  key: string;
  item: FoundItem;
  seq: number;
  expanded: boolean;
}

export function appendOrFocus(
  entries: ViewEntry[],
  item: FoundItem,
  seq: number,
): { entries: ViewEntry[]; focusKey: string; appended: boolean } {
  if (entries.some((e) => e.key === item.id)) {
    return { entries, focusKey: item.id, appended: false };
  }
  return {
    entries: [...entries, { key: item.id, item, seq, expanded: false }],
    focusKey: item.id,
    appended: true,
  };
}

export function removeEntry(entries: ViewEntry[], key: string): ViewEntry[] {
  return entries.filter((e) => e.key !== key);
}

export function toggleExpanded(
  entries: ViewEntry[],
  key: string,
): ViewEntry[] {
  return entries.map((e) =>
    e.key === key ? { ...e, expanded: !e.expanded } : e,
  );
}

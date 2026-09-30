import type { AllyFocusItem } from "@/components/transcript/allyFocus";
import type { ViewItem, ViewState } from "@/lib/ipc";

/**
 * View (4) is rendered by the partner window, a separate webview. The main
 * window owns the truth (radar, tracker, captures and Ally cards live there),
 * so it pushes `ViewState` — a plain, serializable copy of the UI's
 * `AllyFocusItem`s — and the partner window mirrors it. These pure functions
 * are the two-way conversion between the UI shape (camelCase) and the wire
 * shape mirrored from `ipc.rs` (snake_case).
 */
export function toViewItem(item: AllyFocusItem): ViewItem {
  return {
    id: item.id,
    group: item.group,
    question: item.question,
    answer: item.answer,
    source_label: item.sourceLabel,
    source_files: item.sourceFiles ?? [],
    status: item.status,
    card_id: item.cardId ?? null,
    found_id: item.foundId ?? null,
    tier: item.tier ?? null,
    kind: item.kind ?? null,
    facts: item.facts ?? [],
    table: item.table ?? null,
    choice: item.choice ?? null,
    stale: item.stale ?? false,
  };
}

export function fromViewItem(item: ViewItem): AllyFocusItem {
  return {
    id: item.id,
    group: item.group,
    question: item.question,
    answer: item.answer,
    sourceLabel: item.source_label,
    sourceFiles: item.source_files,
    status: item.status,
    ...(item.card_id ? { cardId: item.card_id } : {}),
    ...(item.found_id ? { foundId: item.found_id } : {}),
    ...(item.tier ? { tier: item.tier } : {}),
    ...(item.kind ? { kind: item.kind } : {}),
    ...(item.facts.length > 0 ? { facts: item.facts } : {}),
    ...(item.table ? { table: item.table } : {}),
    ...(item.choice ? { choice: item.choice } : {}),
    ...(item.stale ? { stale: true } : {}),
  };
}

export function toViewState(
  items: readonly AllyFocusItem[],
  activeId: string | null,
  pinnedIds: ReadonlySet<string>,
): ViewState {
  return {
    items: items.map(toViewItem),
    active_id: activeId,
    pinned_ids: [...pinnedIds],
  };
}

/** True when two states would render identically — lets the publisher skip
 *  redundant pushes during streaming. */
export function sameViewState(a: ViewState | null, b: ViewState): boolean {
  return a !== null && JSON.stringify(a) === JSON.stringify(b);
}

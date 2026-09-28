/**
 * Which `FoundItem` ids are new since the Active panel last acknowledged
 * them — drives the accordion's per-header NEW badge (owner, 2026-09-28,
 * "live-panel-4-panel-split" plan). Pure: the cockpit owns the
 * `seen: Set<string>` and calls these on every `foundGroups` recompute and
 * whenever a section opens or one of its items is selected.
 */

export function unseenIn(ids: readonly string[], seen: ReadonlySet<string>): string[] {
  return ids.filter((id) => !seen.has(id));
}

export function markSeen(seen: ReadonlySet<string>, ids: readonly string[]): Set<string> {
  const next = new Set(seen);
  for (const id of ids) next.add(id);
  return next;
}

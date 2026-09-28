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

/**
 * Returns the SAME `seen` instance (by reference) when every id is already
 * present, rather than always allocating a new Set. The caller (TranscriptView)
 * feeds this into `setSeenIds` from an effect that reruns on every
 * `foundGroups` recompute — i.e. on essentially every live transcript/ASR
 * tick — so an unconditional new Set forced a React state update, and a full
 * re-render of the whole panel, on every tick even when nothing was new.
 * That doubled render/commit frequency throughout a live session and was the
 * cause of a visible flicker bug (owner report, 2026-09-28).
 */
export function markSeen(seen: ReadonlySet<string>, ids: readonly string[]): Set<string> {
  if (ids.every((id) => seen.has(id))) return seen as Set<string>;
  const next = new Set(seen);
  for (const id of ids) next.add(id);
  return next;
}

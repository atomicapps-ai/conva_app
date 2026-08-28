/**
 * ContextDetail's accordion (Contexts-screen-redesign spec, requirement 8):
 * three sections, at most one expanded at a time. Mirrors the Live
 * cockpit's exclusive-accordion shape (panelSections.ts's `selectSection`)
 * but simpler — ContextDetail has no pinned/always-open section, so
 * clicking the currently-open one collapses back to all-closed instead of
 * being a no-op.
 */
export type DetailSectionId = "counterparty" | "knowledge" | "rehearse";

export function toggleDetailSection(
  current: DetailSectionId | null,
  id: DetailSectionId,
): DetailSectionId | null {
  return current === id ? null : id;
}

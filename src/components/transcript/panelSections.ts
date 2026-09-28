import type { IconName } from "@/components/ui/Icon";

/**
 * The Active panel's spine-icon accordion pure state model. Three sections
 * in a FIXED stacking order, exactly one open at a time (owner, 2026-09-28
 * — the Answers dock/pin machinery this file used to carry is retired: its
 * content now lives in the View panel, always visible, never a fourth
 * accordion section). The spine icons render at each section's top edge and
 * slide with it — order never changes.
 */
export type PanelSectionId = "questions" | "tracking" | "terms";

export const SECTION_ORDER: readonly PanelSectionId[] = [
  "questions",
  "tracking",
  "terms",
];

export const SECTION_META: Record<
  PanelSectionId,
  { label: string; icon: IconName; tone: "ai" | "primary" }
> = {
  questions: { label: "Questions", icon: "question", tone: "primary" },
  tracking: { label: "Tracking", icon: "target", tone: "primary" },
  terms: { label: "Terms", icon: "book", tone: "primary" },
};

export interface PanelState {
  open: PanelSectionId;
}

/** Exclusive accordion select. No-op: re-selecting the open section. */
export function selectSection(state: PanelState, id: PanelSectionId): PanelState {
  if (id === state.open) return state;
  return { ...state, open: id };
}

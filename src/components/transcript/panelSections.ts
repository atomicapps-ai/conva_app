import type { IconName } from "@/components/ui/Icon";

/**
 * The spine-icon accordion's pure state model (spec 2026-08-26): four
 * sections in a FIXED stacking order, exactly one content section open;
 * Answers can be pinned as an always-visible bottom dock, in which case
 * `open` names one of the three content sections. The spine icons render
 * at each section's top edge and slide with it — order never changes.
 */
export type PanelSectionId = "questions" | "tracking" | "terms" | "answers";

export const SECTION_ORDER: readonly PanelSectionId[] = [
  "questions",
  "tracking",
  "terms",
  "answers",
];

export const SECTION_META: Record<
  PanelSectionId,
  { label: string; icon: IconName; tone: "ai" | "primary" }
> = {
  questions: { label: "Questions", icon: "question", tone: "primary" },
  tracking: { label: "Tracking", icon: "target", tone: "primary" },
  terms: { label: "Terms", icon: "book", tone: "primary" },
  answers: { label: "Answers", icon: "ally", tone: "ai" },
};

export interface PanelState {
  open: PanelSectionId;
  answersPinned: boolean;
}

/** Exclusive accordion select. No-ops: re-selecting the open section, and
 *  selecting Answers while it's pinned (the dock is already on screen). */
export function selectSection(state: PanelState, id: PanelSectionId): PanelState {
  if (id === state.open) return state;
  if (id === "answers" && state.answersPinned) return state;
  return { ...state, open: id };
}

/** Pin toggle with open-section handoff: unpinning makes Answers the open
 *  section (it was visible — keep it visible); pinning while Answers was
 *  the open section falls back to Terms. */
export function togglePin(state: PanelState): PanelState {
  if (state.answersPinned) return { open: "answers", answersPinned: false };
  return {
    open: state.open === "answers" ? "terms" : state.open,
    answersPinned: true,
  };
}

/** "Asking is choosing" — make sure a streaming answer is on screen:
 *  pinned → the dock already is; unpinned → open the Answers section. */
export function revealAnswers(state: PanelState): PanelState {
  if (state.answersPinned || state.open === "answers") return state;
  return { ...state, open: "answers" };
}

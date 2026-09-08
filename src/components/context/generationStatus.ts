import type { ConversationContext } from "@/lib/ipc";

export type GenerationStageState = "ready" | "included" | "skipped" | "blocked" | "failed";

export interface GenerationStage {
  key: "knowledge" | "research" | "qa";
  label: string;
  state: GenerationStageState;
  detail: string;
}

/**
 * Converts the legacy all-or-nothing generate response into an honest stage report.
 * The backend currently returns a Context even when optional web stages cannot run,
 * so the UI must distinguish generated, intentionally skipped, and blocked output.
 */
export function generationStages(
  context: ConversationContext,
  hasResearchKey: boolean,
): GenerationStage[] {
  const knowledgeReady = Boolean(context.dossier_doc_id);
  const stages: GenerationStage[] = [
    {
      key: "knowledge",
      label: "Context Intelligence Pack",
      state: knowledgeReady ? "ready" : "failed",
      detail: knowledgeReady
        ? "Compiled and indexed as this Context's single live retrieval source."
        : "No Context Intelligence Pack was returned.",
    },
  ];

  if (!context.research_enabled) {
    stages.push({
      key: "research",
      label: "Web research",
      state: "skipped",
      detail: "Turned off in Context setup.",
    });
  } else if (!hasResearchKey) {
    stages.push({
      key: "research",
      label: "Web research",
      state: "blocked",
      detail: "Add a Tavily key in Settings → Ally → Web research, then regenerate.",
    });
  } else {
    stages.push({
      key: "research",
      label: "Web research",
      state: context.research_doc_id ? "ready" : "failed",
      detail: context.research_doc_id
        ? "Generated with cited sources for review; its supported findings are compiled into Context Intelligence."
        : "Enabled, but no research document was returned. Try again or review the search key.",
    });
  }

  const qaLabel = context.category === "interview" ? "Interview Q&A" : "Prepared Q&A";
  stages.push({
    key: "qa",
    label: qaLabel,
    state: context.qa_doc_id ? "ready" : "failed",
    detail: context.qa_doc_id
      ? context.category === "interview" && context.deep_qa_enabled
        ? "Generated as a separate review resource using the expanded interview research pass, then compiled into Context Intelligence."
        : "Generated as a separate review resource, then compiled into Context Intelligence for fast matching."
      : "No prepared Q&A resource was returned.",
  });

  return stages;
}

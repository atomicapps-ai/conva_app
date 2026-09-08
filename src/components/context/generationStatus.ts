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
      label: "Context Knowledge",
      state: knowledgeReady ? "ready" : "failed",
      detail: knowledgeReady
        ? "Generated and indexed for this Context."
        : "No Context Knowledge document was returned.",
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
        ? "Generated with cited sources and indexed."
        : "Enabled, but no research document was returned. Try again or review the search key.",
    });
  }

  if (context.category !== "interview") {
    stages.push({
      key: "qa",
      label: "Likely questions & answers",
      state: knowledgeReady ? "included" : "failed",
      detail: knowledgeReady
        ? "Included inside Context Knowledge for this conversation type."
        : "Could not be included because Context Knowledge was not generated.",
    });
  } else if (!context.deep_qa_enabled) {
    stages.push({
      key: "qa",
      label: "Interview Q&A",
      state: "skipped",
      detail: "Deep interview Q&A is turned off in Context setup.",
    });
  } else if (!context.research_enabled) {
    stages.push({
      key: "qa",
      label: "Interview Q&A",
      state: "blocked",
      detail: "Deep Q&A needs web research enabled.",
    });
  } else if (!hasResearchKey) {
    stages.push({
      key: "qa",
      label: "Interview Q&A",
      state: "blocked",
      detail: "Add a Tavily key in Settings → Ally → Web research, then regenerate.",
    });
  } else {
    stages.push({
      key: "qa",
      label: "Interview Q&A",
      state: context.qa_doc_id ? "ready" : "failed",
      detail: context.qa_doc_id
        ? "Generated as a separate prepared Q&A resource."
        : "Enabled, but no Q&A document was returned. Try again or review the search key.",
    });
  }

  return stages;
}

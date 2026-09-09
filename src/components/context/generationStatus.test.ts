import { describe, expect, it } from "vitest";

import { generationStages, researchStage } from "@/components/context/generationStatus";
import type { ConversationContext } from "@/lib/ipc";

const context = (overrides: Partial<ConversationContext> = {}) =>
  ({
    id: "c1",
    title: "Nolan Wells Case",
    category: "live_stream",
    dossier_doc_id: "knowledge-1",
    research_enabled: true,
    ...overrides,
  }) as ConversationContext;

describe("generationStages", () => {
  it("explains partial Live Stream output when research has no key", () => {
    const stages = generationStages(context({ qa_doc_id: "qa-1" }), false);
    expect(stages.map((stage) => [stage.key, stage.state])).toEqual([
      ["knowledge", "ready"],
      ["research", "blocked"],
      ["qa", "ready"],
    ]);
  });

  it("names the actual active provider in the blocked hint, not a stale hardcoded one", () => {
    const withProvider = (provider: "firecrawl" | "anthropic_web_search" | "tavily") =>
      generationStages(context({ qa_doc_id: "qa-1" }), false, provider).find((s) => s.key === "research");
    expect(withProvider("firecrawl")?.detail).toContain("Firecrawl key");
    expect(withProvider("tavily")?.detail).toContain("Tavily key");
    // Regression: this used to unconditionally say "Add a Tavily key" even
    // when Firecrawl (the current default) or Claude web search was active.
    expect(withProvider("firecrawl")?.detail).not.toContain("Tavily");
  });

  it("reports a separate interview Q&A document when deep research succeeds", () => {
    const stages = generationStages(
      context({ category: "interview", deep_qa_enabled: true, qa_doc_id: "qa-1", research_doc_id: "r-1" }),
      true,
    );
    expect(stages.find((stage) => stage.key === "qa")?.state).toBe("ready");
  });
});

describe("researchStage", () => {
  it("is the same 'blocked' chip generationStages would show, usable before Generate is even clicked", () => {
    // This is the proactive pre-run advisory: same shape, same wording, so
    // it never drifts from the post-run report generationStages produces.
    const pre = researchStage(true, false, "firecrawl");
    expect(pre).toEqual(
      generationStages(context({ research_doc_id: null }), false, "firecrawl").find((s) => s.key === "research"),
    );
    expect(pre.state).toBe("blocked");
    expect(pre.detail).toContain("Add a Firecrawl key");
  });

  it("stays quiet when research is off, or a key is present for the active provider", () => {
    expect(researchStage(false, false, "firecrawl").state).toBe("skipped");
    expect(researchStage(true, true, "firecrawl").state).not.toBe("blocked");
    // Claude web search never has its own key to be missing — callers always
    // pass hasResearchKey=true for it (it reuses the Anthropic key), so it
    // never reaches "blocked" in practice.
    expect(researchStage(true, true, "anthropic_web_search").state).not.toBe("blocked");
  });
});

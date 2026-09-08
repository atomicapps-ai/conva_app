import { describe, expect, it } from "vitest";

import { generationStages } from "@/components/context/generationStatus";
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
    const stages = generationStages(context(), false);
    expect(stages.map((stage) => [stage.key, stage.state])).toEqual([
      ["knowledge", "ready"],
      ["research", "blocked"],
      ["qa", "included"],
    ]);
  });

  it("reports a separate interview Q&A document when deep research succeeds", () => {
    const stages = generationStages(
      context({ category: "interview", deep_qa_enabled: true, qa_doc_id: "qa-1", research_doc_id: "r-1" }),
      true,
    );
    expect(stages.find((stage) => stage.key === "qa")?.state).toBe("ready");
  });
});

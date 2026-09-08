import { describe, expect, it } from "vitest";

import {
  buildAllyFocusItems,
  isTermDefinitionCard,
  makeTermDefinitionRequestId,
} from "@/components/transcript/allyFocus";
import type { ViewEntry } from "@/components/transcript/viewEntries";
import type { AllyCard } from "@/state/ally";

function card(overrides: Partial<AllyCard> = {}): AllyCard {
  return {
    id: "a-1",
    seq: 1,
    kind: "question",
    question: "What changed?",
    text: "The launch moved to Friday.",
    done: true,
    error: null,
    sources: [],
    startedAtMs: 1,
    sourceKey: null,
    sourceQuote: null,
    summary: null,
    ...overrides,
  };
}

describe("Ally focus items", () => {
  it("keeps normal answers and excludes term-definition requests", () => {
    const definition = card({ id: "term-definition:10:1:conversion" });
    const items = buildAllyFocusItems(
      [
        definition,
        card({
          sources: [
            {
              document_id: "doc-1",
              file_name: "vendor-brief.md",
              location: "Delivery",
              text: "Six weeks.",
              score: 1,
            },
          ],
        }),
      ],
      [],
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: "card:a-1",
      status: "ready",
      sourceFiles: ["vendor-brief.md"],
    });
    expect(isTermDefinitionCard(definition)).toBe(true);
  });

  it("adds prepared and Radar question entries", () => {
    const entries: ViewEntry[] = [
      {
        key: "prep-1",
        seq: 1,
        expanded: false,
        item: {
          id: "prep-1",
          group: "prep",
          label: "Why this company?",
          detail: "Because…",
          prep: {
            question: "Why this company?",
            answer: "Because the role matches my experience.",
            source: "ally",
            theme: "Motivation",
          },
        },
      },
    ];
    expect(buildAllyFocusItems([], entries)[0]).toMatchObject({
      id: "entry:prep-1",
      status: "instant",
      answer: "Because the role matches my experience.",
    });
  });

  it("builds stable, recognizable definition request ids", () => {
    expect(makeTermDefinitionRequestId(" API Gateway ", 42, 3)).toBe(
      "term-definition:42:3:api-gateway",
    );
  });
});

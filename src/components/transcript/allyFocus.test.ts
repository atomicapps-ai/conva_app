import { describe, expect, it } from "vitest";

import {
  buildAllyFocusItems,
  isTermDefinitionCard,
  makeTermDefinitionRequestId,
} from "@/components/transcript/allyFocus";
import type { FoundItem } from "@/components/transcript/foundGroups";
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
  it("keeps normal answers and tags a term-definition card with group 'term'", () => {
    const definition = card({ id: "term-definition:10:1:conversion", presentation: "term" });
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
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ id: "card:term-definition:10:1:conversion", group: "term" });
    expect(items[1]).toMatchObject({
      id: "card:a-1",
      group: "question",
      status: "ready",
      sourceFiles: ["vendor-brief.md"],
    });
    expect(isTermDefinitionCard(definition)).toBe(true);
  });

  it("builds an instant item directly from a prepared Q&A FoundItem", () => {
    const prep: FoundItem = {
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
    };
    expect(buildAllyFocusItems([], [prep])[0]).toMatchObject({
      id: "found:prep-1",
      group: "prep",
      status: "instant",
      answer: "Because the role matches my experience.",
    });
  });

  it("builds an instant item directly from a term FoundItem's cached definition", () => {
    const term: FoundItem = {
      id: "t-l-Lambda",
      group: "term",
      label: "Lambda",
      detail: "A serverless compute service.",
    };
    expect(buildAllyFocusItems([], [term])[0]).toMatchObject({
      id: "found:t-l-Lambda",
      group: "term",
      status: "instant",
      answer: "A serverless compute service.",
      sourceLabel: "Term",
    });
  });

  it("a term FoundItem with no cached definition yet still shows, non-instant", () => {
    const term: FoundItem = { id: "t-x", group: "term", label: "Kinesis", detail: null };
    expect(buildAllyFocusItems([], [term])[0]).toMatchObject({
      status: "ready",
      answer: "No detail yet — Elaborate for one.",
    });
  });

  it("a commitment/mention FoundItem is labeled Commitment/Mentioned", () => {
    const commitment: FoundItem = {
      id: "c-1",
      group: "commitment",
      label: "send the deck",
      detail: "you · due Friday",
    };
    const mention: FoundItem = { id: "m-1", group: "mention", label: "Kinesis", detail: null };
    expect(buildAllyFocusItems([], [commitment])[0]).toMatchObject({ sourceLabel: "Commitment" });
    expect(buildAllyFocusItems([], [mention])[0]).toMatchObject({ sourceLabel: "Mentioned" });
  });

  it("builds stable, recognizable definition request ids", () => {
    expect(makeTermDefinitionRequestId(" API Gateway ", 42, 3)).toBe(
      "term-definition:42:3:api-gateway",
    );
  });
});

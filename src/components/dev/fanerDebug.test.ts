import { describe, expect, it } from "vitest";

import type { FanerEvalResult } from "@/lib/ipc";

import {
  highlighterText,
  parseLines,
  parseManualCases,
  parseTerms,
  toFixture,
} from "./fanerDebug";

describe("fanerDebug helpers", () => {
  it("parses speaker-labelled lines, defaulting to the other party", () => {
    expect(parseLines("THEM: hi\nyou: hello\nplain")).toEqual([
      { speaker: "them", text: "hi" },
      { speaker: "you", text: "hello" },
      { speaker: "them", text: "plain" },
    ]);
  });

  it("strips speaker labels for the highlighter so THEM never reads as an acronym", () => {
    expect(highlighterText("THEM: Explain API gateway\nYOU: Sure")).toBe(
      "Explain API gateway\nSure",
    );
  });

  it("parses comma/newline term lists", () => {
    expect(parseTerms("API Gateway, AWS Lambda\n S3 ,")).toEqual([
      "API Gateway",
      "AWS Lambda",
      "S3",
    ]);
  });

  it("parses manual cases with optional expectations", () => {
    const cases = parseManualCases(
      "how API gateway works => API Gateway; Lambda\njust text",
      ["API Gateway"],
    );
    expect(cases).toHaveLength(2);
    expect(cases[0]).toMatchObject({
      transcript: "how API gateway works",
      expected_terms: ["API Gateway", "Lambda"],
      known_terms: ["API Gateway"],
    });
    expect(cases[1]?.expected_terms).toEqual([]);
  });

  it("builds a compact reproducible fixture", () => {
    const result: FanerEvalResult = {
      case: {
        id: "seed7-3",
        seed: 7,
        transcript: "the api gateway",
        known_terms: ["API Gateway"],
        expected_terms: ["API Gateway"],
        forbidden_terms: [],
      },
      actual_terms: ["api gateway"],
      passed: true,
      failures: [],
      trace: [
        {
          term: "api gateway",
          key: "api gateway",
          score: 1,
          signals: [{ source: "context term", weight: 1 }],
          spans: [],
          decision: "selected",
          reason: "selected",
        },
      ],
    };
    const fx = toFixture(result);
    expect(fx).toMatchObject({
      seed: 7,
      transcript: "the api gateway",
      known_terms: ["API Gateway"],
      expected_terms: ["API Gateway"],
      actual_terms: ["api gateway"],
    });
    expect(fx.trace[0]?.signals).toEqual(["context term"]);
  });
});

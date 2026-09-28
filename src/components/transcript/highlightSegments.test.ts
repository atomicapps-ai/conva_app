import { describe, expect, it } from "vitest";

import { buildHighlightSegments } from "./highlightSegments";

const hits = (text: string, terms: string[]) =>
  buildHighlightSegments(text, terms)
    .filter((s) => s.hit)
    .map((s) => s.text);

describe("buildHighlightSegments", () => {
  it("returns the text untouched with no terms", () => {
    expect(buildHighlightSegments("hello", [])).toEqual([
      { text: "hello", hit: false },
    ]);
  });

  it("prefers the longer phrase over a nested shorter term", () => {
    expect(hits("how API gateway works", ["API", "API Gateway"])).toEqual([
      "API gateway",
    ]);
    // Order of the term list must not matter.
    expect(hits("how API gateway works", ["API Gateway", "API"])).toEqual([
      "API gateway",
    ]);
  });

  it("still highlights a separate standalone occurrence of the shorter term", () => {
    expect(
      hits("API Gateway is fine but the API is slow", ["API Gateway", "API"]),
    ).toEqual(["API Gateway", "API"]);
  });

  it("is case-insensitive and word-bounded", () => {
    expect(hits("rapid apigateway api gateway", ["API Gateway"])).toEqual([
      "api gateway",
    ]);
  });

  it("reconstructs the original text exactly", () => {
    const text = "Explain API Gateway, then Lambda.";
    const segs = buildHighlightSegments(text, ["API Gateway", "Lambda"]);
    expect(segs.map((s) => s.text).join("")).toBe(text);
  });
});

import { describe, expect, it } from "vitest";

import { isPending, suggestionKey, visibleSuggestionValue } from "@/components/contexts/suggestionReview";

describe("Context suggestion review", () => {
  it("uses stable section-scoped keys", () => {
    expect(suggestionKey("qa", " Answer ")).toBe(suggestionKey("qa", "Answer"));
    expect(suggestionKey("qa", "Answer")).not.toBe(suggestionKey("briefing", "Answer"));
  });

  it("treats an absent decision as pending and displays accepted edits", () => {
    expect(isPending()).toBe(true);
    expect(isPending({ status: "accepted" })).toBe(false);
    expect(visibleSuggestionValue("Ally text", { status: "accepted", edited_value: "My text" })).toBe("My text");
  });
});

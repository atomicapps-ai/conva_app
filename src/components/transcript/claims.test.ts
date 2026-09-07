import { describe, expect, it } from "vitest";

import {
  CLAIM_STATE_META,
  sortClaimsForTracking,
  type ClaimDisplayItem,
} from "@/components/transcript/claims";

function claim(
  id: string,
  consequence: ClaimDisplayItem["consequence"],
  state: ClaimDisplayItem["state"],
): ClaimDisplayItem {
  return {
    id,
    proposition: id,
    state,
    attribution: null,
    consequence,
    exactQuote: id,
    attributionDetail: null,
    referenceDetail: null,
    nextAction: "Review it.",
    evidenceSummary: null,
    processingDisclosure: null,
    safeWording: null,
    evidence: [],
    primaryAction: "verify",
    primaryActionLabel: "Check claim",
  };
}

describe("claim presentation model", () => {
  it("provides the five approved compact state labels", () => {
    expect(Object.values(CLAIM_STATE_META).map((state) => state.label)).toEqual([
      "Attributed",
      "Checking",
      "Supported",
      "Conflict",
      "Needs context",
    ]);
  });

  it("sorts consequence before actionability and preserves stable ties", () => {
    const ordered = sortClaimsForTracking([
      claim("medium supported", "medium", "supported"),
      claim("high attributed", "high", "attributed"),
      claim("high conflict", "high", "conflict"),
      claim("high conflict second", "high", "conflict"),
      claim("low context", "low", "needs_context"),
    ]);
    expect(ordered.map((item) => item.id)).toEqual([
      "high conflict",
      "high conflict second",
      "high attributed",
      "medium supported",
      "low context",
    ]);
  });

  it("does not mutate the supplied snapshot", () => {
    const supplied = [
      claim("low", "low", "attributed"),
      claim("high", "high", "attributed"),
    ];
    sortClaimsForTracking(supplied);
    expect(supplied.map((item) => item.id)).toEqual(["low", "high"]);
  });
});

import { describe, expect, it } from "vitest";

import {
  pointsLabel,
  sayNowLabel,
  splitAnswer,
  talkingPoints,
} from "./viewContent";

describe("splitAnswer — dots that do not end a sentence", () => {
  it("keeps a file name inside its sentence", () => {
    const r = splitAnswer("One moment, I'm working that out from Q3-district-sales.csv.");
    expect(r.sayNow).toBe("One moment, I'm working that out from Q3-district-sales.csv.");
    expect(r.points).toBe("");
  });

  it("keeps decimals and currency inside their sentence, and still splits real sentences", () => {
    const r = splitAnswer(
      "The total amount is $439,519.85. South is the largest at $141,875.25. A third sentence follows here.",
    );
    expect(r.sayNow).toBe(
      "The total amount is $439,519.85. South is the largest at $141,875.25.",
    );
    expect(r.points).toBe("A third sentence follows here.");
  });
});

describe("splitAnswer", () => {
  it("uses the first bullet as Say now and keeps the rest as points", () => {
    const r = splitAnswer("- **Retry** transient errors\n- Compensate per step\n- Alert on the rest");
    expect(r.sayNow).toBe("**Retry** transient errors");
    expect(r.points).toBe("- Compensate per step\n- Alert on the rest");
    expect(r.background).toBe("");
  });

  it("takes the first sentence(s) of a prose answer and keeps every other word", () => {
    const text =
      "Make each step idempotent. Retry with backoff. Use compensating actions for anything you can't retry.\n\nSecond paragraph stays.";
    const r = splitAnswer(text);
    expect(r.sayNow).toBe("Make each step idempotent. Retry with backoff.");
    expect(r.points).toContain("Use compensating actions for anything you can't retry.");
    expect(r.points).toContain("Second paragraph stays.");
  });

  it("splits deeper background at the --- line", () => {
    const r = splitAnswer("- Fast fact\n- Second\n\n---\nLong background here.");
    expect(r.sayNow).toBe("Fast fact");
    expect(r.points).toBe("- Second");
    expect(r.background).toBe("Long background here.");
  });

  it("skips bare headings and blank lines before the lead", () => {
    expect(splitAnswer("\n### Answer\n\nA definition. More detail.").sayNow).toBe(
      "A definition. More detail.",
    );
  });

  it("never loses text: sayNow + points reassemble the answer's words", () => {
    const text = "One. Two. Three. Four.\nfive";
    const r = splitAnswer(text);
    const words = (s: string) => s.replace(/\s+/g, " ").trim();
    expect(words(`${r.sayNow} ${r.points}`)).toBe(words(text));
  });

  it("handles empty input", () => {
    expect(splitAnswer("")).toEqual({ sayNow: "", points: "", background: "" });
  });
});

describe("labels", () => {
  it("leads a problem term with the fix", () => {
    expect(sayNowLabel({ group: "term", kind: "problem" })).toBe("The fix");
    expect(pointsLabel({ group: "term", kind: "problem" })).toBe("What it is");
    expect(sayNowLabel({ group: "term", kind: "concept" })).toBe("Definition");
    expect(sayNowLabel({ group: "question" })).toBe("Say now");
    expect(pointsLabel({ group: "question" })).toBe("Key points");
  });

  it("copies plain talking points without markdown markers", () => {
    expect(talkingPoints({ sayNow: "**Retry** it", points: "- `x` first", background: "" })).toBe(
      "Retry it\n\n- x first",
    );
  });
});

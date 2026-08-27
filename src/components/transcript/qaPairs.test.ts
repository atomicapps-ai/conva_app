import { describe, expect, it } from "vitest";

import {
  buildQaMarkdown,
  parseQaImport,
  parseQaPairs,
} from "@/components/transcript/qaPairs";

describe("parseQaPairs — canonical bold-bullet form", () => {
  it("parses themed bold bullets with multi-line answers", () => {
    const md = [
      "## Behavioral",
      "- **Q: Tell me about a conflict** A: I focus on the shared goal",
      "  and de-personalize the disagreement.",
      "- **Q: Biggest weakness?** A: Over-engineering early drafts.",
      "## Technical",
      "- **Q: Design a rate limiter** A: Token bucket per client key.",
    ].join("\n");
    const pairs = parseQaPairs(md, "ally");
    expect(pairs).toHaveLength(3);
    expect(pairs[0]).toEqual({
      question: "Tell me about a conflict",
      answer: "I focus on the shared goal and de-personalize the disagreement.",
      theme: "Behavioral",
      source: "ally",
    });
    expect(pairs[2]?.theme).toBe("Technical");
  });

  it("de-duplicates by normalized question, first wins", () => {
    const md = [
      "- **Q: Same question** A: first answer",
      "- **Q:   same QUESTION  ** A: second answer",
    ].join("\n");
    const pairs = parseQaPairs(md, "ally");
    expect(pairs).toHaveLength(1);
    expect(pairs[0]?.answer).toBe("first answer");
  });

  it("skips a pair with an empty answer", () => {
    const pairs = parseQaPairs("- **Q: Question with nothing after** A:", "x");
    expect(pairs).toHaveLength(0);
  });
});

describe("parseQaPairs — loose Q:/A: line form", () => {
  it("parses plain prep-sheet lines, answer running to the next Q", () => {
    const text = [
      "Q: Why this company?",
      "A: Mission fit and the team's",
      "engineering culture.",
      "",
      "Q: Salary expectations?",
      "A: Market rate for the level.",
    ].join("\n");
    const pairs = parseQaPairs(text, "my-prep.md");
    expect(pairs).toHaveLength(2);
    expect(pairs[0]?.answer).toBe("Mission fit and the team's engineering culture.");
    expect(pairs[1]?.question).toBe("Salary expectations?");
    expect(pairs[0]?.source).toBe("my-prep.md");
  });

  it("skips a Q line never followed by an A line", () => {
    const pairs = parseQaPairs("Q: Orphan question\nSome unrelated prose.", "d");
    expect(pairs).toHaveLength(0);
  });

  it("returns nothing for a document with no Q&A shapes (e.g. a resume)", () => {
    const pairs = parseQaPairs(
      "## Experience\n- Senior Engineer, 2017-2024\n- Led a team of 6.",
      "resume.pdf",
    );
    expect(pairs).toHaveLength(0);
  });
});

describe("parseQaImport — 'Q|A' paste lines", () => {
  it("splits on the FIRST pipe only; answers may contain pipes", () => {
    const { pairs, skipped } = parseQaImport(
      [
        "Why us?|Mission fit | strong team | growth",
        "Weakness?|Over-engineering",
        "",
      ].join("\n"),
    );
    expect(skipped).toBe(0);
    expect(pairs).toHaveLength(2);
    expect(pairs[0]).toEqual({
      question: "Why us?",
      answer: "Mission fit | strong team | growth",
      theme: null,
      source: "import",
    });
  });

  it("counts malformed lines (no pipe, empty side, duplicate) as skipped", () => {
    const { pairs, skipped } = parseQaImport(
      [
        "no pipe here",
        "|answer with no question",
        "question with no answer|",
        "Good?|Yes",
        "good?|duplicate question",
      ].join("\n"),
    );
    expect(pairs).toHaveLength(1);
    expect(skipped).toBe(4);
  });
});

describe("buildQaMarkdown", () => {
  it("round-trips through parseQaPairs", () => {
    const { pairs } = parseQaImport("Why us?|Mission fit\nWeakness?|Over-engineering");
    const md = buildQaMarkdown(pairs);
    const back = parseQaPairs(md, "import.txt");
    expect(back.map((p) => [p.question, p.answer])).toEqual([
      ["Why us?", "Mission fit"],
      ["Weakness?", "Over-engineering"],
    ]);
    expect(back[0]?.theme).toBe("Imported Q&A");
  });
});

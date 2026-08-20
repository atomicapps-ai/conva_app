import { describe, expect, it } from "vitest";

import type { Capture } from "@/lib/ipc";
import {
  collectFanerHits,
  fanerAccent,
  fanerLabel,
  fanerPrompt,
  isFanerBoundaryMatch,
} from "@/lib/faner";

function capture(overrides: Partial<Capture> = {}): Capture {
  return {
    trigger: "task_frame",
    action: "EXPLAIN",
    arguments: ["Terraform state locking"],
    tier: "specialized",
    kind: "concept",
    preview: "Terraform locks remote state during an apply to avoid races.",
    ...overrides,
  };
}

describe("collectFanerHits", () => {
  it("matches a literal argument found in the text", () => {
    const hits = collectFanerHits(
      "Walk me through Terraform state locking with a team.",
      [capture()],
    );
    expect(hits).toHaveLength(1);
    expect(hits[0]?.phrase).toBe("Terraform state locking");
  });

  it("is case-insensitive", () => {
    const hits = collectFanerHits("terraform STATE LOCKING matters", [capture()]);
    expect(hits).toHaveLength(1);
  });

  it("skips question-trigger captures — their arguments are a paraphrase, not literal text", () => {
    const hits = collectFanerHits("Walk me through Terraform state locking with a team.", [
      capture({ trigger: "question", arguments: ["how they handle state"] }),
    ]);
    expect(hits).toHaveLength(0);
  });

  it("keeps prep_reference and gap triggers", () => {
    const hits = collectFanerHits("Terraform state locking again", [
      capture({ trigger: "prep_reference" }),
      capture({ trigger: "gap" }),
    ]);
    expect(hits).toHaveLength(2);
  });

  it("sorts longest phrase first so a longer match wins over a nested shorter one", () => {
    const hits = collectFanerHits("Terraform state locking is tricky", [
      capture({ arguments: ["state"] }),
      capture({ arguments: ["Terraform state locking"] }),
    ]);
    expect(hits[0]?.phrase).toBe("Terraform state locking");
  });

  it("drops arguments shorter than 3 characters (too noisy to anchor a highlight)", () => {
    const hits = collectFanerHits("go to it", [capture({ arguments: ["it"] })]);
    expect(hits).toHaveLength(0);
  });

  it("returns nothing when no capture's argument appears in the text", () => {
    const hits = collectFanerHits("unrelated sentence entirely", [capture()]);
    expect(hits).toHaveLength(0);
  });

  it("short-circuits on an empty capture list without scanning", () => {
    expect(collectFanerHits("any text", [])).toEqual([]);
  });

  it("does not match a phrase that only appears mid-word", () => {
    // "REST" is a substring of "interested" but not a whole word there —
    // matching it would bold+underline half of an unrelated word.
    const hits = collectFanerHits("I'm interested in how you scaled the backend.", [
      capture({ arguments: ["REST"] }),
    ]);
    expect(hits).toHaveLength(0);
  });

  it("still matches a phrase found as a whole word elsewhere in the same capture", () => {
    // Same phrase, but this time it also occurs as a real word ("REST API") —
    // one bad mid-word occurrence shouldn't hide a good one.
    const hits = collectFanerHits("The REST API felt slower than I'm interested in.", [
      capture({ arguments: ["REST"] }),
    ]);
    expect(hits).toHaveLength(1);
  });

  it("matches a phrase immediately next to punctuation, not just whitespace", () => {
    const hits = collectFanerHits("We used REST, then gRPC later.", [
      capture({ arguments: ["REST"] }),
    ]);
    expect(hits).toHaveLength(1);
  });

  it("matches a phrase at the very start or end of the text", () => {
    expect(collectFanerHits("REST was the obvious choice", [capture({ arguments: ["REST"] })])).toHaveLength(1);
    expect(collectFanerHits("the obvious choice was REST", [capture({ arguments: ["REST"] })])).toHaveLength(1);
  });
});

describe("isFanerBoundaryMatch", () => {
  it("rejects a match with a word character immediately before or after", () => {
    const lower = "interested";
    // "rest" at index 2..6 inside "inteREsted" — word chars on both sides.
    expect(isFanerBoundaryMatch(lower, 2, 4)).toBe(false);
  });

  it("accepts a match bounded by whitespace, punctuation, or string edges", () => {
    expect(isFanerBoundaryMatch("rest api", 0, 4)).toBe(true); // start of string
    expect(isFanerBoundaryMatch("the rest.", 4, 4)).toBe(true); // space before, "." after
    expect(isFanerBoundaryMatch("(rest)", 1, 4)).toBe(true); // parens both sides
  });
});

describe("fanerAccent", () => {
  it("gives each action its own accent", () => {
    expect(fanerAccent(capture({ action: "RECALL" }))).toContain("violet");
    expect(fanerAccent(capture({ action: "ASSIST" }))).toContain("emerald");
    expect(fanerAccent(capture({ action: "SYNTHESIZE" }))).toContain("fuchsia");
  });

  it("gives EXPLAIN·problem a distinct accent from EXPLAIN·concept", () => {
    const problem = fanerAccent(capture({ action: "EXPLAIN", kind: "problem" }));
    const concept = fanerAccent(capture({ action: "EXPLAIN", kind: "concept" }));
    expect(problem).not.toBe(concept);
  });
});

describe("fanerLabel", () => {
  it("qualifies EXPLAIN with its kind", () => {
    expect(fanerLabel(capture({ action: "EXPLAIN", kind: "concept" }))).toBe(
      "EXPLAIN · concept",
    );
  });

  it("falls back to the bare action when there's no tier or kind", () => {
    expect(fanerLabel(capture({ action: "ASSIST", tier: null, kind: null }))).toBe("ASSIST");
  });
});

describe("fanerPrompt", () => {
  it("phrases each action distinctly", () => {
    expect(fanerPrompt(capture({ action: "RECALL" }), "X")).toMatch(/earlier/i);
    expect(fanerPrompt(capture({ action: "ASSIST" }), "X")).toMatch(/help/i);
    expect(fanerPrompt(capture({ action: "SYNTHESIZE" }), "X")).toMatch(/pull together/i);
  });

  it("phrases EXPLAIN·problem as a fix, not a definition", () => {
    expect(fanerPrompt(capture({ action: "EXPLAIN", kind: "problem" }), "X")).toMatch(/fix/i);
  });

  it("phrases EXPLAIN·concept as a definition", () => {
    expect(fanerPrompt(capture({ action: "EXPLAIN", kind: "concept" }), "X")).toMatch(
      /define/i,
    );
  });
});

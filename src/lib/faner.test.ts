import { describe, expect, it } from "vitest";

import type { Capture } from "@/lib/ipc";
import { fanerLabel, fanerPrompt } from "@/lib/faner";

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

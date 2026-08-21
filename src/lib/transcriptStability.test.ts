import { describe, expect, it } from "vitest";

import { advanceConfirmed, diffWords, tentativeTail } from "@/lib/transcriptStability";

describe("advanceConfirmed", () => {
  it("confirms nothing on a segment's very first partial (lastRaw is null)", () => {
    expect(advanceConfirmed("", null, "walk me through")).toBe("");
  });

  it("confirms the common prefix once two consecutive hypotheses agree", () => {
    // Tick 1: lastRaw=null -> confirmed stays "". Tick 2: the two most
    // recent raw hypotheses ("walk me through" vs "walk me through AWS")
    // agree on "walk me through" -> that becomes confirmed.
    const confirmed = advanceConfirmed("", "walk me through", "walk me through AWS");
    expect(confirmed).toBe("walk me through");
  });

  it("never shrinks confirmed text even if a later hypothesis disagrees on it", () => {
    // Already confirmed "walk me through Terraform" from earlier ticks;
    // a new (mid-utterance re-decode) hypothesis revises "Terraform" to
    // "AWS" — that revision must NOT be pulled into the live display.
    const confirmed = advanceConfirmed(
      "walk me through Terraform",
      "walk me through Terraform state",
      "walk me through AWS state locking",
    );
    expect(confirmed).toBe("walk me through Terraform");
  });

  it("extends confirmed text as agreement grows further", () => {
    const confirmed = advanceConfirmed(
      "walk me through",
      "walk me through Terraform state",
      "walk me through Terraform state locking",
    );
    expect(confirmed).toBe("walk me through Terraform state");
  });

  it("is word-boundary-safe, not a character prefix", () => {
    // "wal" is a character-prefix of both but not a shared whole word.
    const confirmed = advanceConfirmed("", "walking the dog", "walk me through");
    expect(confirmed).toBe("");
  });
});

describe("tentativeTail", () => {
  it("returns whatever the current hypothesis has past the confirmed prefix", () => {
    expect(tentativeTail("walk me through", "walk me through Terraform state")).toBe(
      "Terraform state",
    );
  });

  it("returns an empty string once the hypothesis exactly matches confirmed", () => {
    expect(tentativeTail("walk me through", "walk me through")).toBe("");
  });
});

describe("diffWords", () => {
  it("marks no words changed when the texts already match", () => {
    const diff = diffWords("walk me through Terraform", "walk me through Terraform");
    expect(diff.every((w) => !w.changed)).toBe(true);
  });

  it("marks only the words that actually differ", () => {
    const diff = diffWords("walk me through Terraform", "walk me through AWS Step Functions");
    expect(diff.map((w) => ({ text: w.text, changed: w.changed }))).toEqual([
      { text: "walk", changed: false },
      { text: "me", changed: false },
      { text: "through", changed: false },
      { text: "AWS", changed: true },
      { text: "Step", changed: true },
      { text: "Functions", changed: true },
    ]);
  });

  it("marks trailing words appended past the old length as changed", () => {
    const diff = diffWords("walk me", "walk me through");
    expect(diff[2]).toEqual({ text: "through", changed: true });
  });
});

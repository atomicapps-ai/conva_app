import { describe, expect, it } from "vitest";
import {
  CUT_OFF_NOTE,
  NO_ANSWER_ERROR,
  REFUSED_ERROR,
  settleFinishedAnswer,
  stopReasonFromHosted,
} from "./stopReason";

describe("stopReasonFromHosted", () => {
  it("maps the Messages API values the way the Rust enum does", () => {
    expect(stopReasonFromHosted("end_turn")).toBe("complete");
    expect(stopReasonFromHosted("stop_sequence")).toBe("complete");
    expect(stopReasonFromHosted("tool_use")).toBe("complete");
    expect(stopReasonFromHosted("max_tokens")).toBe("truncated");
    expect(stopReasonFromHosted("model_context_window_exceeded")).toBe("truncated");
    expect(stopReasonFromHosted("refusal")).toBe("refused");
    expect(stopReasonFromHosted("pause_turn")).toBe("other");
  });

  it("treats a missing value as unknown, not complete or truncated", () => {
    expect(stopReasonFromHosted(null)).toBe("unknown");
  });
});

describe("settleFinishedAnswer", () => {
  it("leaves a complete answer alone", () => {
    expect(settleFinishedAnswer("- bullet", null, "complete")).toEqual({ text: "- bullet", error: null });
    expect(settleFinishedAnswer("- bullet", null, undefined)).toEqual({ text: "- bullet", error: null });
    expect(settleFinishedAnswer("- bullet", null, "unknown")).toEqual({ text: "- bullet", error: null });
  });

  it("marks a truncated answer instead of presenting it as whole", () => {
    const got = settleFinishedAnswer("- first point\n- second poi", null, "truncated");
    expect(got.error).toBeNull();
    expect(got.text.startsWith("- first point\n- second poi\n\n")).toBe(true);
    expect(got.text.endsWith(CUT_OFF_NOTE)).toBe(true);
  });

  it("turns a blank answer into a plain message", () => {
    expect(settleFinishedAnswer("  \n", null, "complete")).toEqual({ text: "  \n", error: NO_ANSWER_ERROR });
    expect(settleFinishedAnswer("", null, undefined).error).toBe(NO_ANSWER_ERROR);
  });

  it("turns a refusal into a plain message even when some text arrived", () => {
    expect(settleFinishedAnswer("I can't", null, "refused").error).toBe(REFUSED_ERROR);
  });

  it("never overrides a stream error", () => {
    expect(settleFinishedAnswer("", "HTTP 529", "truncated")).toEqual({ text: "", error: "HTTP 529" });
  });
});

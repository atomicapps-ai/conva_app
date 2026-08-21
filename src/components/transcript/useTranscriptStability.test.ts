import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useTranscriptStability } from "@/components/transcript/useTranscriptStability";
import type { TranscriptSegment } from "@/lib/ipc";

function seg(overrides: Partial<TranscriptSegment> = {}): TranscriptSegment {
  return {
    side: "inbound",
    seq: 1,
    text: "",
    is_final: false,
    start_ms: 0,
    end_ms: 0,
    confidence: null,
    latency_ms: 0,
    ...overrides,
  };
}

describe("useTranscriptStability", () => {
  it("shows nothing confirmed on a segment's first-ever partial", () => {
    const { result } = renderHook(({ segments }) => useTranscriptStability(segments), {
      initialProps: { segments: [seg({ text: "walk me through" })] },
    });
    expect(result.current.liveConfirmed).toBe("");
    expect(result.current.liveTentative).toBe("walk me through");
  });

  it("confirms the agreed prefix once a second partial for the same segment agrees", () => {
    const { result, rerender } = renderHook(
      ({ segments }) => useTranscriptStability(segments),
      { initialProps: { segments: [seg({ text: "walk me through" })] } },
    );
    rerender({ segments: [seg({ text: "walk me through Terraform" })] });
    expect(result.current.liveConfirmed).toBe("walk me through");
    expect(result.current.liveTentative).toBe("Terraform");
  });

  it("does not pull a later revision of an already-confirmed word into the live view", () => {
    const { result, rerender } = renderHook(
      ({ segments }) => useTranscriptStability(segments),
      { initialProps: { segments: [seg({ text: "walk me through" })] } },
    );
    rerender({ segments: [seg({ text: "walk me through Terraform" })] }); // confirms "walk me through"
    rerender({ segments: [seg({ text: "walk me through AWS state" })] }); // revises "Terraform" -> "AWS"
    expect(result.current.liveConfirmed).toBe("walk me through");
  });

  it("starts a fresh segment (new seq) with no memory of a previous one", () => {
    const { result, rerender } = renderHook(
      ({ segments }) => useTranscriptStability(segments),
      { initialProps: { segments: [seg({ seq: 1, text: "walk me through" })] } },
    );
    rerender({ segments: [seg({ seq: 1, text: "walk me through Terraform" })] });
    expect(result.current.liveConfirmed).toBe("walk me through");
    // A new utterance (seq 2) starts with nothing confirmed, even though
    // seq 1 had confirmed text.
    rerender({ segments: [seg({ seq: 2, text: "next utterance" })] });
    expect(result.current.liveConfirmed).toBe("");
    expect(result.current.liveTentative).toBe("next utterance");
  });

  it("renders a finalized segment with no diff when it matches what was last shown", () => {
    const { result, rerender } = renderHook(
      ({ segments }) => useTranscriptStability(segments),
      { initialProps: { segments: [seg({ text: "walk me through" })] } },
    );
    rerender({ segments: [seg({ text: "walk me through Terraform" })] }); // confirms "walk me through", tentative "Terraform"
    rerender({
      segments: [seg({ text: "walk me through Terraform", is_final: true })],
    });
    expect(result.current.finalUnits).toEqual([
      { key: "inbound-1", text: "walk me through Terraform", diff: null },
    ]);
  });

  it("attaches a diff only for the words that changed when the final text corrects the tentative tail", () => {
    const { result, rerender } = renderHook(
      ({ segments }) => useTranscriptStability(segments),
      { initialProps: { segments: [seg({ text: "walk me through" })] } },
    );
    rerender({ segments: [seg({ text: "walk me through Terraform" })] }); // tentative tail: "Terraform"
    rerender({
      segments: [seg({ text: "walk me through AWS Step Functions", is_final: true })],
    });
    const unit = result.current.finalUnits[0];
    expect(unit?.text).toBe("walk me through AWS Step Functions");
    expect(unit?.diff?.map((w) => w.changed)).toEqual([false, false, false, true, true, true]);
  });

  it("renders a segment that finalizes without ever having been shown as a partial, with no diff", () => {
    const { result } = renderHook(({ segments }) => useTranscriptStability(segments), {
      initialProps: {
        segments: [seg({ text: "quick final", is_final: true })],
      },
    });
    expect(result.current.finalUnits).toEqual([
      { key: "inbound-1", text: "quick final", diff: null },
    ]);
  });

  it("is stable across an unrelated re-render with the exact same segments (no duplicate work)", () => {
    const segments = [seg({ text: "walk me through" })];
    const { result, rerender } = renderHook(
      ({ segments }) => useTranscriptStability(segments),
      { initialProps: { segments } },
    );
    const first = result.current;
    rerender({ segments });
    expect(result.current.liveConfirmed).toBe(first.liveConfirmed);
    expect(result.current.liveTentative).toBe(first.liveTentative);
  });
});

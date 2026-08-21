import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ScrambleText } from "@/components/transcript/ScrambleText";
import type { DiffWord } from "@/lib/transcriptStability";

afterEach(cleanup);

function words(...w: DiffWord[]): DiffWord[] {
  return w;
}

describe("ScrambleText", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders unchanged words plainly, immediately", () => {
    render(
      <ScrambleText
        words={words({ text: "walk", changed: false }, { text: "me", changed: false })}
      />,
    );
    expect(screen.getByText(/walk/)).toBeInTheDocument();
    expect(screen.getByText(/me/)).toBeInTheDocument();
  });

  it("does not show a changed word's real text immediately — it scrambles first", () => {
    render(<ScrambleText words={words({ text: "Terraform", changed: true })} />);
    expect(screen.queryByText("Terraform")).toBeNull();
  });

  it("settles on the real word after the scramble ticks finish", () => {
    render(<ScrambleText words={words({ text: "Terraform", changed: true })} />);
    // The interval's final tick fires synchronously via fake timers, but the
    // resulting state update still needs to be flushed/committed before the
    // assertion below reads the DOM — wrap the timer advance in act() so
    // React commits that last setDisplay before we check for "Terraform".
    act(() => {
      vi.runAllTimers();
    });
    expect(screen.getByText("Terraform")).toBeInTheDocument();
  });

  it("respects prefers-reduced-motion — shows the real word immediately, no scramble", () => {
    const matchMedia = vi.fn().mockReturnValue({ matches: true });
    vi.stubGlobal("matchMedia", matchMedia);
    render(<ScrambleText words={words({ text: "Terraform", changed: true })} />);
    expect(screen.getByText("Terraform")).toBeInTheDocument();
    vi.unstubAllGlobals();
  });
});

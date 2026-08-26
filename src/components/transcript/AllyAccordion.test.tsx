import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AllyAccordion } from "@/components/transcript/AllyAccordion";
import type { PanelState } from "@/components/transcript/panelSections";

afterEach(cleanup);

function setup(state: PanelState, onState = vi.fn()) {
  render(
    <AllyAccordion
      state={state}
      onState={onState}
      counts={{ questions: 2, tracking: 1, terms: 3, answers: 1 }}
      splitRatio={0.5}
      onSplitRatio={() => {}}
      renderSection={(id) => <div data-testid={`content-${id}`} />}
    />,
  );
  return onState;
}

describe("AllyAccordion", () => {
  it("renders all four spine icons by section label and marks the open one", () => {
    // Unpinned: all four sections stack in the accordion, each with a real
    // spine button. (Pinned mode's dock chip is decorative — see below.)
    setup({ open: "terms", answersPinned: false });
    for (const label of ["Questions", "Tracking", "Terms", "Answers"]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
    expect(screen.getByTestId("content-terms")).toBeInTheDocument();
    expect(screen.queryByTestId("content-questions")).toBeNull();
  });

  it("selecting a collapsed section reports the accordion swap", () => {
    const onState = setup({ open: "terms", answersPinned: true });
    fireEvent.click(screen.getByRole("button", { name: "Questions" }));
    expect(onState).toHaveBeenCalledWith({
      open: "questions",
      answersPinned: true,
    });
  });

  it("pinned: answers dock is always visible with a pressed pin toggle", () => {
    setup({ open: "terms", answersPinned: true });
    // Dock content sits alongside the open content section.
    expect(screen.getByTestId("content-answers")).toBeInTheDocument();
    expect(screen.getByTestId("content-terms")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /pin answers/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("unpinned: no answers content while another section is open", () => {
    setup({ open: "questions", answersPinned: false });
    expect(screen.queryByTestId("content-answers")).toBeNull();
    expect(screen.getByRole("button", { name: /pin answers/i })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("unpinned: answers content renders when answers is the open section", () => {
    setup({ open: "answers", answersPinned: false });
    expect(screen.getByTestId("content-answers")).toBeInTheDocument();
  });
});

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

describe("AllyAccordion — Questions mode chips (split-source spec 2026-08-27)", () => {
  function setupChips(over: {
    questionsMode?: "live" | "prep";
    liveUnseen?: boolean;
    onQuestionsMode?: (m: "live" | "prep") => void;
    onState?: (s: PanelState) => void;
  } = {}) {
    render(
      <AllyAccordion
        state={{ open: "terms", answersPinned: true }}
        onState={over.onState ?? (() => {})}
        counts={{ questions: 2, tracking: 1, terms: 3, answers: 1 }}
        questionsMode={over.questionsMode ?? "live"}
        onQuestionsMode={over.onQuestionsMode ?? (() => {})}
        prepCount={24}
        liveUnseen={over.liveUnseen ?? false}
        splitRatio={0.5}
        onSplitRatio={() => {}}
        renderSection={(id) => <div data-testid={`content-${id}`} />}
      />,
    );
  }

  it("renders both chips with their own counts, active one pressed", () => {
    setupChips({ questionsMode: "prep" });
    const live = screen.getByRole("button", { name: "Live questions (2)" });
    const prep = screen.getByRole("button", { name: "Prepared Q&A (24)" });
    expect(live).toHaveAttribute("aria-pressed", "false");
    expect(prep).toHaveAttribute("aria-pressed", "true");
  });

  it("clicking a chip switches the mode AND opens Questions, without toggling the section itself", () => {
    const onQuestionsMode = vi.fn();
    const onState = vi.fn();
    setupChips({ onQuestionsMode, onState });
    fireEvent.click(screen.getByRole("button", { name: "Prepared Q&A (24)" }));
    expect(onQuestionsMode).toHaveBeenCalledWith("prep");
    expect(onState).toHaveBeenCalledWith({ open: "questions", answersPinned: true });
  });

  it("no chips on other sections' headers", () => {
    setupChips({});
    expect(screen.queryByRole("button", { name: /Prepared Q&A/ })).toBeInTheDocument();
    // Terms keeps its plain count badge (3), Questions' own numeric badge is gone.
    expect(screen.getByText("3")).toBeInTheDocument();
  });
});

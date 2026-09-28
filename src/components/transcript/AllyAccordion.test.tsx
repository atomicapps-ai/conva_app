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
      counts={{ questions: 2, tracking: 1, terms: 3 }}
      renderSection={(id) => <div data-testid={`content-${id}`} />}
    />,
  );
  return onState;
}

describe("AllyAccordion", () => {
  it("renders all three spine icons by section label and marks the open one", () => {
    setup({ open: "terms" });
    for (const label of ["Questions", "Tracking", "Terms"]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
    expect(screen.getByTestId("content-terms")).toBeInTheDocument();
    expect(screen.queryByTestId("content-questions")).toBeNull();
  });

  it("selecting a collapsed section reports the accordion swap", () => {
    const onState = setup({ open: "terms" });
    fireEvent.click(screen.getByRole("button", { name: "Questions" }));
    expect(onState).toHaveBeenCalledWith({ open: "questions" });
  });

  it("shows a NEW badge on a section with unseen items, none when there are none", () => {
    render(
      <AllyAccordion
        state={{ open: "terms" }}
        onState={() => {}}
        counts={{ questions: 2, tracking: 1, terms: 3 }}
        newCounts={{ terms: 2 }}
        renderSection={(id) => <div data-testid={`content-${id}`} />}
      />,
    );
    expect(screen.getByLabelText("New")).toBeInTheDocument();
  });

  it("no NEW badge when newCounts is omitted or a section has zero", () => {
    setup({ open: "terms" });
    expect(screen.queryByLabelText("New")).toBeNull();
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
        state={{ open: "terms" }}
        onState={over.onState ?? (() => {})}
        counts={{ questions: 2, tracking: 1, terms: 3 }}
        questionsMode={over.questionsMode ?? "live"}
        onQuestionsMode={over.onQuestionsMode ?? (() => {})}
        prepCount={24}
        liveUnseen={over.liveUnseen ?? false}
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
    expect(onState).toHaveBeenCalledWith({ open: "questions" });
  });

  it("no chips on other sections' headers", () => {
    setupChips({});
    expect(screen.queryByRole("button", { name: /Prepared Q&A/ })).toBeInTheDocument();
    // Terms keeps its plain count badge (3), Questions' own numeric badge is gone.
    expect(screen.getByText("3")).toBeInTheDocument();
  });
});

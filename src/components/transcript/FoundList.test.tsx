import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FoundList } from "@/components/transcript/FoundList";
import type { FoundGroups } from "@/components/transcript/foundGroups";

afterEach(cleanup);

const groups: FoundGroups = {
  questions: [
    {
      id: "q-what is rrf?",
      group: "question",
      label: "What is RRF?",
      detail: null,
      radar: {
        turn_id: "turn-1",
        source_key: "inbound-1",
        question: "What is RRF?",
        outcome: "miss",
        confidence: 0,
        bridge: { kind: "definition", text: "Define it, then explain why it matters." },
        sources: [],
      },
    },
  ],
  commitments: [
    {
      id: "c-you-send the deck",
      group: "commitment",
      label: "send the deck",
      detail: "you · due Friday",
      commitment: { who: "you", what: "send the deck", due: "Friday" },
    },
  ],
  terms: [
    {
      id: "t-l-Lambda",
      group: "term",
      label: "Lambda",
      detail: null,
      chip: { id: "l-Lambda", label: "Lambda", source: "live" },
    },
  ],
  mentions: [
    {
      id: "m-kinesis",
      group: "mention",
      label: "Kinesis",
      detail: "AWS streaming service",
      entity: { label: "Kinesis", detail: "AWS streaming service" },
    },
  ],
  prepQa: [
    {
      id: "p-why this company?",
      group: "prep",
      label: "Why this company?",
      detail: "Mission fit.",
      prep: {
        question: "Why this company?",
        answer: "Mission fit.",
        theme: "Behavioral",
        source: "ally",
      },
    },
    {
      id: "p-salary expectations?",
      group: "prep",
      label: "Salary expectations?",
      detail: "Market rate.",
      prep: {
        question: "Salary expectations?",
        answer: "Market rate.",
        theme: null,
        source: "my-prep.md",
      },
    },
  ],
};

describe("FoundList", () => {
  it("renders all four group headers and their items", () => {
    render(<FoundList groups={groups} onSelect={() => {}} />);
    for (const h of ["They asked", "Commitments", "Terms", "Mentioned"]) {
      expect(screen.getByText(h)).toBeInTheDocument();
    }
    expect(screen.getByText("What is RRF?")).toBeInTheDocument();
    expect(screen.getByText("Say now")).toBeInTheDocument();
    expect(
      screen.getByText("Define it, then explain why it matters."),
    ).toBeInTheDocument();
    expect(screen.getByText("send the deck")).toBeInTheDocument();
    expect(screen.getByText("Lambda")).toBeInTheDocument();
    expect(screen.getByText("Kinesis")).toBeInTheDocument();
  });

  it("hides an empty group's header", () => {
    render(
      <FoundList
        groups={{ ...groups, questions: [], commitments: [] }}
        onSelect={() => {}}
      />,
    );
    expect(screen.queryByText("They asked")).toBeNull();
    expect(screen.queryByText("Commitments")).toBeNull();
  });

  it("selecting any item calls onSelect with it", () => {
    const onSelect = vi.fn();
    render(<FoundList groups={groups} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: /What is RRF\?/ }));
    expect(onSelect).toHaveBeenCalledWith(groups.questions[0]);
    fireEvent.click(screen.getByRole("button", { name: /Kinesis/ }));
    expect(onSelect).toHaveBeenCalledWith(groups.mentions[0]);
  });

  it("shows the all-empty placeholder when nothing has been found yet", () => {
    render(
      <FoundList
        groups={{ questions: [], commitments: [], terms: [], mentions: [], prepQa: [] }}
        onSelect={() => {}}
      />,
    );
    expect(
      screen.getByText(/appear here as the conversation runs/),
    ).toBeInTheDocument();
  });

  it("renders only the requested group with no eyebrow headers in only-mode", () => {
    render(<FoundList groups={groups} onSelect={() => {}} only="questions" />);
    // question rows present…
    expect(screen.getByText("What is RRF?")).toBeInTheDocument();
    // …no group eyebrows, and no other groups' items
    expect(screen.queryByText("They asked")).toBeNull();
    expect(screen.queryByText("Commitments")).toBeNull();
    expect(screen.queryByText("send the deck")).toBeNull();
    expect(screen.queryByText("Lambda")).toBeNull();
    expect(screen.queryByText("Kinesis")).toBeNull();
  });

  it("only=tracking renders commitments and mentions together", () => {
    render(<FoundList groups={groups} onSelect={() => {}} only="tracking" />);
    expect(screen.getByText("send the deck")).toBeInTheDocument();
    expect(screen.getByText("Kinesis")).toBeInTheDocument();
    expect(screen.queryByText("Commitments")).toBeNull();
    expect(screen.queryByText("Mentioned")).toBeNull();
    expect(screen.queryByText("What is RRF?")).toBeNull();
  });
});

describe("FoundList — Questions prep mode (split-source spec 2026-08-27)", () => {
  it("prep mode renders themed prep rows, never the live feed", () => {
    render(
      <FoundList
        groups={groups}
        onSelect={() => {}}
        only="questions"
        questionsMode="prep"
      />,
    );
    expect(screen.getByText("Behavioral")).toBeInTheDocument();
    expect(screen.getByText("Why this company?")).toBeInTheDocument();
    // Null theme falls under the "Prepared" group.
    expect(screen.getByText("Prepared")).toBeInTheDocument();
    expect(screen.getByText("Salary expectations?")).toBeInTheDocument();
    // Source tags: "ally" for the generated doc, file name otherwise.
    expect(screen.getByText("ally")).toBeInTheDocument();
    expect(screen.getByText("my-prep.md")).toBeInTheDocument();
    // The live feed stays out of prep mode.
    expect(screen.queryByText("What is RRF?")).toBeNull();
  });

  it("selecting a prep row calls onSelect with the prep item", () => {
    const onSelect = vi.fn();
    render(
      <FoundList
        groups={groups}
        onSelect={onSelect}
        only="questions"
        questionsMode="prep"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Why this company\?/ }));
    expect(onSelect).toHaveBeenCalledWith(groups.prepQa[0]);
  });

  it("empty prep mode explains how to get pairs", () => {
    render(
      <FoundList
        groups={{ ...groups, prepQa: [] }}
        onSelect={() => {}}
        only="questions"
        questionsMode="prep"
      />,
    );
    expect(screen.getByText(/No prepared Q&A yet/)).toBeInTheDocument();
  });

  it("live mode (the default) still renders the radar feed", () => {
    render(<FoundList groups={groups} onSelect={() => {}} only="questions" />);
    expect(screen.getByText("What is RRF?")).toBeInTheDocument();
    expect(screen.queryByText("Why this company?")).toBeNull();
  });
});

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
      radar: { question: "What is RRF?", sources: [] },
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
};

describe("FoundList", () => {
  it("renders all four group headers and their items", () => {
    render(<FoundList groups={groups} onSelect={() => {}} />);
    for (const h of ["They asked", "Commitments", "Terms", "Mentioned"]) {
      expect(screen.getByText(h)).toBeInTheDocument();
    }
    expect(screen.getByText("What is RRF?")).toBeInTheDocument();
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
        groups={{ questions: [], commitments: [], terms: [], mentions: [] }}
        onSelect={() => {}}
      />,
    );
    expect(
      screen.getByText(/appear here as the conversation runs/),
    ).toBeInTheDocument();
  });
});

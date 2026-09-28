import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AllyFocusCanvas } from "@/components/transcript/AllyFocusCanvas";
import type { AllyFocusItem } from "@/components/transcript/allyFocus";

afterEach(cleanup);

const items: AllyFocusItem[] = [
  {
    id: "card:a1",
    group: "question",
    question: "Has the crash been confirmed?",
    answer: "The report is attributed but not independently confirmed.",
    sourceLabel: "A1",
    sourceFiles: ["vendor-brief.md"],
    status: "ready",
    cardId: "a1",
  },
  {
    id: "card:a2",
    group: "question",
    question: "How many people were on the boat?",
    answer: "Seven people were visible in the cited video.",
    sourceLabel: "A2",
    status: "streaming",
    cardId: "a2",
  },
];

const term: AllyFocusItem = {
  id: "found:t-x",
  group: "term",
  question: "Kubernetes",
  answer: "A container orchestration platform.",
  sourceLabel: "Term",
  status: "instant",
};

describe("AllyFocusCanvas", () => {
  it("keeps the active answer front and center; the question is a tooltip, not a heading", () => {
    render(
      <AllyFocusCanvas
        items={items}
        activeId="card:a1"
        activeType="questions"
        pinnedIds={new Set()}
        onSelect={() => {}}
        onSelectType={() => {}}
        onTogglePin={() => {}}
        onRefresh={() => {}}
        onOpen={() => {}}
      />,
    );
    // The question text appears once, as the tab label — not repeated as a heading.
    expect(screen.getAllByText("Has the crash been confirmed?")).toHaveLength(1);
    expect(
      screen.getByText("The report is attributed but not independently confirmed."),
    ).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Ready");
    expect(screen.getByText("Grounded in vendor-brief.md")).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: 'Questions: "Has the crash been confirmed?"' }),
    ).toBeInTheDocument();
  });

  it("switches threads and exposes pin, elaborate, and expand actions", () => {
    const onSelect = vi.fn();
    const onTogglePin = vi.fn();
    const onRefresh = vi.fn();
    const onOpen = vi.fn();
    render(
      <AllyFocusCanvas
        items={items}
        activeId="card:a1"
        activeType="questions"
        pinnedIds={new Set(["card:a1"])}
        onSelect={onSelect}
        onSelectType={() => {}}
        onTogglePin={onTogglePin}
        onRefresh={onRefresh}
        onOpen={onOpen}
      />,
    );

    fireEvent.click(
      screen.getByRole("tab", { name: "How many people were on the boat?" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Pinned" }));
    fireEvent.click(screen.getByRole("button", { name: "Elaborate" }));
    fireEvent.click(screen.getByRole("button", { name: /Expand/ }));

    expect(onSelect).toHaveBeenCalledWith("card:a2");
    expect(onTogglePin).toHaveBeenCalledWith("card:a1");
    expect(onRefresh).toHaveBeenCalledWith(items[0]);
    expect(onOpen).toHaveBeenCalledWith(items[0]);
  });

  it("supports keyboard movement between item tabs", () => {
    const onSelect = vi.fn();
    render(
      <AllyFocusCanvas
        items={items}
        activeId="card:a1"
        activeType="questions"
        pinnedIds={new Set()}
        onSelect={onSelect}
        onSelectType={() => {}}
        onTogglePin={() => {}}
        onRefresh={() => {}}
        onOpen={() => {}}
      />,
    );
    fireEvent.keyDown(
      screen.getByRole("tab", { name: "Has the crash been confirmed?" }),
      { key: "ArrowRight" },
    );
    expect(onSelect).toHaveBeenCalledWith("card:a2");
  });

  it("shows an outer type tab row only once more than one type is present, and switches type", () => {
    const onSelectType = vi.fn();
    const { rerender } = render(
      <AllyFocusCanvas
        items={items}
        activeId="card:a1"
        activeType="questions"
        pinnedIds={new Set()}
        onSelect={() => {}}
        onSelectType={onSelectType}
        onTogglePin={() => {}}
        onRefresh={() => {}}
        onOpen={() => {}}
      />,
    );
    expect(screen.queryByRole("tablist", { name: "Item type" })).toBeNull();

    rerender(
      <AllyFocusCanvas
        items={[...items, term]}
        activeId="card:a1"
        activeType="questions"
        pinnedIds={new Set()}
        onSelect={() => {}}
        onSelectType={onSelectType}
        onTogglePin={() => {}}
        onRefresh={() => {}}
        onOpen={() => {}}
      />,
    );
    expect(screen.getByRole("tablist", { name: "Item type" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Terms" }));
    expect(onSelectType).toHaveBeenCalledWith("terms");
  });

  it("falls back to the first item of the current type when activeId belongs to another type", () => {
    render(
      <AllyFocusCanvas
        items={[...items, term]}
        activeId="found:t-x"
        activeType="questions"
        pinnedIds={new Set()}
        onSelect={() => {}}
        onSelectType={() => {}}
        onTogglePin={() => {}}
        onRefresh={() => {}}
        onOpen={() => {}}
      />,
    );
    expect(
      screen.getByText("The report is attributed but not independently confirmed."),
    ).toBeInTheDocument();
  });

  it("labels the content section by group — Definition for a term", () => {
    render(
      <AllyFocusCanvas
        items={[term]}
        activeId="found:t-x"
        activeType="terms"
        pinnedIds={new Set()}
        onSelect={() => {}}
        onSelectType={() => {}}
        onTogglePin={() => {}}
        onRefresh={() => {}}
        onOpen={() => {}}
      />,
    );
    expect(screen.getByText("Definition")).toBeInTheDocument();
  });
});

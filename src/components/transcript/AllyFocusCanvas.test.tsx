import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AllyFocusCanvas } from "@/components/transcript/AllyFocusCanvas";
import type { AllyFocusItem } from "@/components/transcript/allyFocus";

afterEach(cleanup);

const items: AllyFocusItem[] = [
  {
    id: "card:a1",
    question: "Has the crash been confirmed?",
    answer: "The report is attributed but not independently confirmed.",
    sourceLabel: "A1",
    status: "ready",
    cardId: "a1",
  },
  {
    id: "card:a2",
    question: "How many people were on the boat?",
    answer: "Seven people were visible in the cited video.",
    sourceLabel: "A2",
    status: "streaming",
    cardId: "a2",
  },
];

describe("AllyFocusCanvas", () => {
  it("keeps the active question and full answer together", () => {
    render(
      <AllyFocusCanvas
        items={items}
        activeId="card:a1"
        pinnedIds={new Set()}
        onSelect={() => {}}
        onTogglePin={() => {}}
        onRefresh={() => {}}
        onOpen={() => {}}
      />,
    );
    expect(screen.getAllByText("Has the crash been confirmed?")).toHaveLength(2);
    expect(
      screen.getByText("The report is attributed but not independently confirmed."),
    ).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Ready");
  });

  it("switches threads and exposes pin, refresh, and expand actions", () => {
    const onSelect = vi.fn();
    const onTogglePin = vi.fn();
    const onRefresh = vi.fn();
    const onOpen = vi.fn();
    render(
      <AllyFocusCanvas
        items={items}
        activeId="card:a1"
        pinnedIds={new Set(["card:a1"])}
        onSelect={onSelect}
        onTogglePin={onTogglePin}
        onRefresh={onRefresh}
        onOpen={onOpen}
      />,
    );

    fireEvent.click(
      screen.getByRole("tab", { name: "How many people were on the boat?" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Pinned" }));
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    fireEvent.click(screen.getByRole("button", { name: "Expand" }));

    expect(onSelect).toHaveBeenCalledWith("card:a2");
    expect(onTogglePin).toHaveBeenCalledWith("card:a1");
    expect(onRefresh).toHaveBeenCalledWith(items[0]);
    expect(onOpen).toHaveBeenCalledWith(items[0]);
  });

  it("supports keyboard movement between question tabs", () => {
    const onSelect = vi.fn();
    render(
      <AllyFocusCanvas
        items={items}
        activeId="card:a1"
        pinnedIds={new Set()}
        onSelect={onSelect}
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
});

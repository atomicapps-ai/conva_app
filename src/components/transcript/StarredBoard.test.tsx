import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StarredBoard } from "@/components/transcript/StarredBoard";
import type { AllyCard } from "@/state/ally";

afterEach(cleanup);

function card(overrides: Partial<AllyCard> = {}): AllyCard {
  return {
    id: "c1",
    seq: 1,
    kind: "question",
    question: null,
    text: "",
    done: false,
    error: null,
    sources: [],
    startedAtMs: 0,
    sourceKey: "them-1",
    sourceQuote: "Terraform state locking",
    ...overrides,
  };
}

describe("StarredBoard", () => {
  it("shows an empty-state hint when nothing is starred", () => {
    render(
      <StarredBoard cards={[]} starredIds={new Set()} onUnstar={vi.fn()} onOpenViewer={vi.fn()} barPad="" />,
    );
    expect(screen.getByText(/Star a quote/i)).toBeInTheDocument();
  });

  it("renders only starred cards, with a loading state while a card streams", () => {
    const starred = card({ id: "c1", done: false });
    const notStarred = card({ id: "c2", sourceQuote: "gRPC" });
    render(
      <StarredBoard
        cards={[notStarred, starred]}
        starredIds={new Set(["c1"])}
        onUnstar={vi.fn()}
        onOpenViewer={vi.fn()}
        barPad=""
      />,
    );
    expect(screen.getByText("thinking…")).toBeInTheDocument();
    expect(screen.getByText(/Terraform state locking/)).toBeInTheDocument();
    expect(screen.queryByText(/gRPC/)).toBeNull();
  });

  it("unstars a card via its star button", () => {
    const onUnstar = vi.fn();
    const starred = card({ id: "c1", done: true, text: "Answer text." });
    render(
      <StarredBoard
        cards={[starred]}
        starredIds={new Set(["c1"])}
        onUnstar={onUnstar}
        onOpenViewer={vi.fn()}
        barPad=""
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Unstar A1/i }));
    expect(onUnstar).toHaveBeenCalledWith("c1");
  });

  it("opens the viewer via the expand icon", () => {
    const onOpenViewer = vi.fn();
    const starred = card({ id: "c1", done: true, text: "Answer text." });
    render(
      <StarredBoard
        cards={[starred]}
        starredIds={new Set(["c1"])}
        onUnstar={vi.fn()}
        onOpenViewer={onOpenViewer}
        barPad=""
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Open A1 in the viewer/i }));
    expect(onOpenViewer).toHaveBeenCalledWith(starred);
  });
});

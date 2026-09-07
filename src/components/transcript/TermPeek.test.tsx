import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TermPeek } from "@/components/transcript/TermPeek";

afterEach(cleanup);

describe("TermPeek", () => {
  it("shows a cached contextual definition without using Answers", () => {
    render(
      <TermPeek
        model={{
          term: "conversion",
          definition: "The percentage of prospects who complete the desired action.",
          sourceLabel: "Grounded Context glossary",
          status: "cached",
          pinned: false,
        }}
        canOpenDetails
        onClose={() => {}}
        onTogglePin={() => {}}
        onAskMore={() => {}}
        onOpenDetails={() => {}}
      />,
    );
    expect(screen.getByRole("dialog", { name: "Definition of conversion" })).toBeInTheDocument();
    expect(screen.getByText("From this Context")).toBeInTheDocument();
    expect(screen.getByText(/percentage of prospects/)).toBeInTheDocument();
  });

  it("supports pin, ask-more, details, and close actions", () => {
    const onClose = vi.fn();
    const onTogglePin = vi.fn();
    const onAskMore = vi.fn();
    const onOpenDetails = vi.fn();
    render(
      <TermPeek
        model={{
          term: "FANER",
          definition: "Conversation intelligence routing.",
          sourceLabel: "Defined by Ally",
          status: "ready",
          pinned: false,
        }}
        canOpenDetails
        onClose={onClose}
        onTogglePin={onTogglePin}
        onAskMore={onAskMore}
        onOpenDetails={onOpenDetails}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Pin" }));
    fireEvent.click(screen.getByRole("button", { name: "Ask more" }));
    fireEvent.click(screen.getByRole("button", { name: "Details" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Close term definition" })[1]!);
    expect(onTogglePin).toHaveBeenCalledOnce();
    expect(onAskMore).toHaveBeenCalledOnce();
    expect(onOpenDetails).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("does not claim desktop details support when unavailable", () => {
    render(
      <TermPeek
        model={{
          term: "FANER",
          definition: "",
          sourceLabel: "",
          status: "streaming",
          pinned: false,
        }}
        canOpenDetails={false}
        onClose={() => {}}
        onTogglePin={() => {}}
        onAskMore={() => {}}
        onOpenDetails={() => {}}
      />,
    );
    expect(screen.getByText("Defining…")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Details" })).toBeNull();
  });
});

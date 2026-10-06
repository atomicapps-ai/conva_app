import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AllyFocusItem } from "@/components/transcript/allyFocus";
import { itemFromLiveAssist } from "@/components/transcript/allyFocus";
import { ViewPanel } from "@/components/transcript/ViewPanel";
import {
  assistResult,
  choiceResult,
  completedResult,
} from "@/test/liveAssistFixtures";

afterEach(cleanup);

const question: AllyFocusItem = {
  id: "card:a1",
  group: "question",
  question: "How do you handle partial failures?",
  answer:
    "- Make each step **idempotent**\n- Retry with backoff\n- Compensate what you can't retry\n\n---\nDeeper background text.",
  sourceLabel: "A1",
  sourceFiles: ["baseline briefing.txt"],
  status: "ready",
  cardId: "a1",
};
const term: AllyFocusItem = {
  id: "found:t-sf",
  group: "term",
  question: "Step Functions",
  answer: "A managed workflow service. It runs state machines.",
  sourceLabel: "Term",
  status: "instant",
  tier: "specialized",
  kind: "concept",
};
const problem: AllyFocusItem = {
  id: "found:t-cs",
  group: "term",
  question: "cold start",
  answer: "Use provisioned concurrency. Shrink the package.",
  sourceLabel: "Term",
  status: "instant",
  tier: "field",
  kind: "problem",
};
const commitment: AllyFocusItem = {
  id: "found:c-you-runbook",
  group: "commitment",
  question: "Ship the runbook",
  answer: "you · due after the call",
  sourceLabel: "Commitment",
  status: "instant",
  facts: [
    { label: "Who", value: "You" },
    { label: "When", value: "after the call" },
  ],
};

function panel(over: Partial<React.ComponentProps<typeof ViewPanel>> = {}) {
  const props = {
    items: [question, term],
    activeId: "card:a1",
    pinnedIds: new Set<string>(),
    onSelect: vi.fn(),
    onTogglePin: vi.fn(),
    onRefresh: vi.fn(),
    ...over,
  };
  render(<ViewPanel {...props} />);
  return props;
}

describe("ViewPanel", () => {
  it("shows Say now first, then key points and background, with nothing collapsed", () => {
    panel();
    expect(screen.getByText("Say now")).toBeInTheDocument();
    // The lead is the first bullet, rendered with inline markdown.
    expect(screen.getByText("idempotent").tagName).toBe("STRONG");
    expect(screen.getByText("Key points")).toBeInTheDocument();
    expect(screen.getByText("Retry with backoff")).toBeInTheDocument();
    expect(screen.getByText("Compensate what you can't retry")).toBeInTheDocument();
    expect(screen.getByText("Background")).toBeInTheDocument();
    expect(screen.getByText("Deeper background text.")).toBeInTheDocument();
  });

  it("tells the reader to check figures, dates and names under a written answer, but not on a commitment", () => {
    panel();
    expect(screen.getByTestId("answer-check-notice")).toHaveTextContent(
      /check figures, dates and names/i,
    );
    cleanup();
    panel({ items: [commitment], activeId: "found:c-you-runbook" });
    expect(screen.queryByTestId("answer-check-notice")).not.toBeInTheDocument();
  });

  it("keeps the source as a tooltip icon, not a heading", () => {
    panel();
    const icon = screen.getByRole("img", {
      name: 'Questions: "How do you handle partial failures?"',
    });
    expect(icon).toHaveAttribute("title", 'Questions: "How do you handle partial failures?"');
    // The question text appears once — as the tab label — never as a heading.
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
  });

  it("has one tab strip of items; selecting a tab calls onSelect", () => {
    const p = panel();
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(2);
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    fireEvent.click(screen.getByRole("tab", { name: /Step Functions/ }));
    expect(p.onSelect).toHaveBeenCalledWith("found:t-sf");
  });

  it("floats pinned tabs first", () => {
    panel({ pinnedIds: new Set(["found:t-sf"]) });
    const labels = screen.getAllByRole("tab").map((t) => t.textContent);
    expect(labels[0]).toContain("Step Functions");
  });

  it("puts a NEW dot on an item that arrives while another is open, and clears it on open", () => {
    const props = {
      items: [question] as readonly AllyFocusItem[],
      activeId: "card:a1" as string | null,
      pinnedIds: new Set<string>(),
      onSelect: vi.fn(),
      onTogglePin: vi.fn(),
      onRefresh: vi.fn(),
    };
    const { rerender } = render(<ViewPanel {...props} />);
    expect(screen.queryByRole("img", { name: "New" })).not.toBeInTheDocument();
    rerender(<ViewPanel {...props} items={[question, term]} />);
    expect(screen.getByRole("img", { name: "New" })).toBeInTheDocument();
    // The open item did not change — arrival never steals the view.
    expect(screen.getAllByRole("tab")[0]).toHaveAttribute("aria-selected", "true");
    rerender(<ViewPanel {...props} items={[question, term]} activeId="found:t-sf" />);
    expect(screen.queryByRole("img", { name: "New" })).not.toBeInTheDocument();
  });

  it("Pin, Copy and Elaborate live in the fixed top row", () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const p = panel();
    fireEvent.click(screen.getByRole("button", { name: /Pin/ }));
    expect(p.onTogglePin).toHaveBeenCalledWith("card:a1");
    fireEvent.click(screen.getByRole("button", { name: /Elaborate/ }));
    expect(p.onRefresh).toHaveBeenCalledWith(question);
    fireEvent.click(screen.getByRole("button", { name: "Copy as talking points" }));
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText.mock.calls[0]![0]).toContain("Make each step idempotent");
    expect(writeText.mock.calls[0]![0]).not.toContain("**");
  });

  it("leads a problem term with the fix and shows its tier and kind", () => {
    panel({ items: [problem], activeId: "found:t-cs" });
    expect(screen.getByText("The fix")).toBeInTheDocument();
    expect(screen.getByText("field")).toBeInTheDocument();
    expect(screen.getByText("problem")).toBeInTheDocument();
  });

  it("shows a term as Definition with its tier", () => {
    panel({ items: [term], activeId: "found:t-sf" });
    expect(screen.getByText("Definition")).toBeInTheDocument();
    expect(screen.getByText("specialized")).toBeInTheDocument();
  });

  it("shows a commitment's facts", () => {
    panel({ items: [commitment], activeId: "found:c-you-runbook" });
    const dl = screen.getByText("Who").closest("dl")!;
    expect(within(dl).getByText("You")).toBeInTheDocument();
    expect(within(dl).getByText("after the call")).toBeInTheDocument();
  });

  it("lists grounding files and opens them when supported", () => {
    const onOpenSource = vi.fn();
    panel({ onOpenSource });
    fireEvent.click(screen.getByRole("button", { name: 'Open "baseline briefing.txt"' }));
    expect(onOpenSource).toHaveBeenCalledWith("baseline briefing.txt");
  });

  it("shows sources as plain text when they can't be opened", () => {
    panel();
    expect(screen.getByText("baseline briefing.txt")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Open "/ })).not.toBeInTheDocument();
  });

  it("asks a follow-up about the active item", () => {
    const onAsk = vi.fn();
    panel({ onAsk });
    const input = screen.getByLabelText("Ask a follow-up");
    fireEvent.change(input, { target: { value: "what about retries?" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onAsk).toHaveBeenCalledWith(question, "what about retries?");
  });

  it("shows raw markdown on request", () => {
    panel();
    fireEvent.click(screen.getByRole("button", { name: /Formatted/ }));
    expect(screen.getByText(/- Make each step \*\*idempotent\*\*/)).toBeInTheDocument();
  });

  it("shows an error item in red without splitting it", () => {
    panel({
      items: [{ ...question, status: "error", answer: "Model unavailable" }],
    });
    expect(screen.getByText("Model unavailable")).toHaveClass("text-rec");
    expect(screen.queryByText("Say now")).not.toBeInTheDocument();
  });

  it("shows an empty state when nothing is open", () => {
    panel({ items: [], activeId: null });
    expect(screen.getByText(/Pick something in Ally/)).toBeInTheDocument();
  });
});

describe("ViewPanel — live assist answers", () => {
  const holding = itemFromLiveAssist(assistResult());
  const done = itemFromLiveAssist(completedResult());

  function props(item: AllyFocusItem) {
    return {
      items: [item],
      activeId: item.id,
      pinnedIds: new Set<string>(),
      onSelect: vi.fn(),
      onTogglePin: vi.fn(),
      onRefresh: vi.fn(),
    };
  }

  it("progresses from a holding response to a readable grid in the same tab", () => {
    const { rerender } = render(<ViewPanel {...props(holding)} />);
    // Holding: the speakable line and an honest status, no grid yet.
    expect(screen.getByRole("status")).toHaveTextContent("Answering…");
    expect(screen.getByText(/One moment, I'm working that out/)).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    const tabsBefore = screen.getAllByRole("tab");
    expect(tabsBefore).toHaveLength(1);

    // The completed revision arrives under the same item id.
    expect(done.id).toBe(holding.id);
    rerender(<ViewPanel {...props(done)} />);
    expect(screen.getByRole("status")).toHaveTextContent("Ready");
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByText("$439,519.85")).toBeInTheDocument();
    expect(screen.getByText(/South is the largest at \$141,875\.25/)).toBeInTheDocument();
    expect(screen.getAllByRole("tab")).toHaveLength(1);
    // Provenance stays reachable, and the source file is listed.
    expect(screen.getByText("From your documents")).toBeInTheDocument();
    expect(screen.getByText("Q3-district-sales.csv")).toBeInTheDocument();
  });

  it("shows a choice and reports the pick against the item", () => {
    const item = itemFromLiveAssist(choiceResult());
    const onChoose = vi.fn();
    render(<ViewPanel {...props(item)} onChoose={onChoose} />);
    expect(screen.getByText("Which column do you want to add up?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Net amount/ }));
    expect(onChoose).toHaveBeenCalledWith(item, "2");
  });

  it("marks a replaced answer instead of silently keeping it live", () => {
    const stale = itemFromLiveAssist({ ...completedResult(), lifecycle: "superseded" });
    render(<ViewPanel {...props(stale)} />);
    expect(screen.getByText(/replaced this one before it finished/)).toBeInTheDocument();
    // Still readable.
    expect(screen.getByRole("table")).toBeInTheDocument();
  });

  it("copies the speakable line and the grid together", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    render(<ViewPanel {...props(done)} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy as talking points" }));
    expect(writeText).toHaveBeenCalledTimes(1);
    const text = writeText.mock.calls[0]![0] as string;
    expect(text).toContain("The total amount is $439,519.85.");
    expect(text).toContain("North\t$128,430.50\t1");
  });

  it("still renders every non-table item exactly as before", () => {
    panel();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByText("Key points")).toBeInTheDocument();
  });
});

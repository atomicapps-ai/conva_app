import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ViewHistory } from "@/components/transcript/ViewHistory";
import type { ViewEntry } from "@/components/transcript/viewEntries";

afterEach(cleanup);

function entry(overrides: Partial<ViewEntry> & { key: string }): ViewEntry {
  return {
    item: {
      id: overrides.key,
      group: "term",
      label: overrides.key,
      detail: null,
      chip: { id: overrides.key, label: overrides.key, source: "live" },
    },
    seq: 0,
    expanded: false,
    ...overrides,
  } as ViewEntry;
}

const noop = {
  onToggleExpanded: () => {},
  onRemove: () => {},
  onFetchInfo: () => {},
  onDefine: () => {},
  onElaborate: () => {},
  onOpenInViewer: () => {},
  renderAnswerCards: () => null,
};

describe("ViewHistory", () => {
  it("shows the empty state when nothing has been chosen", () => {
    render(<ViewHistory entries={[]} focusKey={null} {...noop} />);
    expect(screen.getByText(/Select anything above/)).toBeInTheDocument();
  });

  it("renders chosen entries in order with their labels", () => {
    render(
      <ViewHistory
        entries={[entry({ key: "Lambda", seq: 1 }), entry({ key: "Kinesis", seq: 2 })]}
        focusKey={null}
        {...noop}
      />,
    );
    const cards = screen.getAllByRole("article");
    expect(cards).toHaveLength(2);
    expect(cards[0]).toHaveTextContent("Lambda");
    expect(cards[1]).toHaveTextContent("Kinesis");
  });

  it("more/less toggle calls onToggleExpanded with the entry key", () => {
    const onToggleExpanded = vi.fn();
    render(
      <ViewHistory
        entries={[entry({ key: "Lambda", seq: 1 })]}
        focusKey={null}
        {...noop}
        onToggleExpanded={onToggleExpanded}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    expect(onToggleExpanded).toHaveBeenCalledWith("Lambda");
  });

  it("remove calls onRemove; question entries render their instant sources", () => {
    const onRemove = vi.fn();
    render(
      <ViewHistory
        entries={[
          {
            key: "q-1",
            seq: 1,
            expanded: false,
            item: {
              id: "q-1",
              group: "question",
              label: "What is RRF?",
              detail: null,
              radar: {
                turn_id: "turn-1",
                source_key: "inbound-1",
                question: "What is RRF?",
                outcome: "evidence_hit",
                confidence: 1,
                bridge: {
                  kind: "evidence",
                  text: "RRF combines independently ranked result lists.",
                },
                sources: [
                  {
                    file_name: "rag.md",
                    location: "¶3",
                    text: "Reciprocal rank fusion merges rankings.",
                    score: 1,
                  },
                ],
              },
            },
          },
        ]}
        focusKey={null}
        {...noop}
        onRemove={onRemove}
      />,
    );
    expect(
      screen.getByText(/Reciprocal rank fusion merges rankings\./),
    ).toBeInTheDocument();
    expect(screen.getByText("Say now")).toBeInTheDocument();
    expect(
      screen.getByText("RRF combines independently ranked result lists."),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: 'Remove "What is RRF?"' }));
    expect(onRemove).toHaveBeenCalledWith("q-1");
  });

  it("keeps a useful Say now bridge visible when Context retrieval misses", () => {
    render(
      <ViewHistory
        entries={[
          {
            key: "q-miss",
            seq: 1,
            expanded: false,
            item: {
              id: "q-miss",
              group: "question",
              label: "What is the exact failure rate?",
              detail: null,
              radar: {
                turn_id: "turn-miss",
                source_key: "inbound-2",
                question: "What is the exact failure rate?",
                outcome: "miss",
                confidence: 0,
                bridge: {
                  kind: "boundary",
                  text: "I don't want to guess at the exact detail.",
                },
                sources: [],
              },
            },
          },
        ]}
        focusKey={null}
        {...noop}
      />,
    );
    expect(screen.getByText("Say now")).toBeInTheDocument();
    expect(
      screen.getByText("I don't want to guess at the exact detail."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/No confident match in this Context/),
    ).toBeInTheDocument();
  });
});

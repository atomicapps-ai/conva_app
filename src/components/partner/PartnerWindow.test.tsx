import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ClaimRecord, PartnerPayload } from "@/lib/ipc";
import { useAllyStore } from "@/state/ally";
import { useUiPrefs } from "@/state/uiPrefs";

const subscribers: Record<string, (p: unknown) => void> = {};
const backend = {
  partner: {
    payload: vi.fn().mockResolvedValue(null),
    viewState: vi.fn().mockResolvedValue(null),
    sendViewAction: vi.fn().mockResolvedValue(undefined),
    redock: vi.fn().mockResolvedValue(undefined),
    locked: vi.fn().mockResolvedValue(true),
    setLocked: vi.fn().mockResolvedValue(undefined),
  },
  rag: {
    list: vi.fn().mockResolvedValue([]),
    documentText: vi.fn().mockResolvedValue("full document body"),
  },
  ally: { run: vi.fn().mockResolvedValue(undefined) },
  subscribe: vi.fn((event: string, cb: (p: unknown) => void) => {
    subscribers[event] = cb;
    return Promise.resolve(() => {});
  }),
};

vi.mock("@/lib/useIpcBridge", () => ({ useIpcBridge: () => {} }));
vi.mock("@/lib/backend", () => ({
  useBackend: () => backend,
  getBackend: () => backend,
}));

import { PartnerWindow } from "@/components/partner/PartnerWindow";

function payload(overrides: Partial<PartnerPayload> = {}): PartnerPayload {
  return {
    term: "API Gateway",
    kind: "concept",
    preview: null,
    answer: "It fronts your APIs.",
    source_lines: [],
    doc_id: null,
    claim: null,
    ...overrides,
  };
}

async function deliver(p: PartnerPayload) {
  await act(async () => {
    subscribers["partnerTerm"]?.(p);
  });
}

function typedClaim(overrides: Partial<ClaimRecord> = {}): ClaimRecord {
  return {
    id: "claim-1",
    source_segment_ids: ["segment-1"],
    speaker_side: "inbound",
    speaker_label: "Guest",
    exact_quote: "ABC News is reporting that both people died.",
    normalized_proposition: "Both people died.",
    predicate: "died",
    subject: "both people",
    object: null,
    frame_kind: "attributed_claim",
    attribution_chain: [
      {
        source_label: "ABC News",
        reporting_verb: "is reporting",
        directness: "reported_by_speaker",
      },
    ],
    qualifiers: [],
    references: [],
    modality: "reported",
    negated: false,
    sensitivity: "public",
    consequence: "high",
    importance_reasons: ["consequence_if_wrong"],
    state: "attributed",
    recommended_action: "verify",
    policy_id: "live-stream-claims",
    policy_version: 2,
    extraction_confidence: "high",
    resolution_confidence: "medium",
    claim_confidence: "none",
    evidence: [],
    corrections: [],
    created_at_unix_ms: 1,
    updated_at_unix_ms: 1,
    ...overrides,
  };
}

afterEach(cleanup);

describe("PartnerWindow tabs", () => {
  beforeEach(() => {
    useAllyStore.getState().clear();
    for (const k of Object.keys(subscribers)) delete subscribers[k];
    vi.clearAllMocks();
    backend.partner.payload.mockResolvedValue(null);
    backend.partner.viewState.mockResolvedValue(null);
    backend.partner.locked.mockResolvedValue(true);
    backend.rag.list.mockResolvedValue([]);
  });

  it("accumulates delivered payloads as tabs instead of replacing", async () => {
    await act(async () => {
      render(<PartnerWindow />);
    });
    await deliver(payload({ term: "API Gateway" }));
    await deliver(payload({ term: "Lambda" }));
    expect(
      screen.getByRole("tab", { name: /API Gateway/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Lambda/ })).toBeInTheDocument();
    // Newest delivery is the active tab.
    expect(screen.getByRole("tab", { name: /Lambda/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("re-delivering an identical payload focuses the existing tab", async () => {
    await act(async () => {
      render(<PartnerWindow />);
    });
    await deliver(payload({ term: "API Gateway" }));
    await deliver(payload({ term: "Lambda" }));
    await deliver(payload({ term: "API Gateway" }));
    expect(screen.getAllByRole("tab", { name: /API Gateway/ })).toHaveLength(1);
    expect(screen.getByRole("tab", { name: /API Gateway/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("switching tabs switches the rendered content", async () => {
    await act(async () => {
      render(<PartnerWindow />);
    });
    await deliver(payload({ term: "API Gateway", answer: "Fronts APIs." }));
    await deliver(payload({ term: "Lambda", answer: "Runs functions." }));
    expect(screen.getByText("Runs functions.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: /API Gateway/ }));
    expect(screen.getByText("Fronts APIs.")).toBeInTheDocument();
    expect(screen.queryByText("Runs functions.")).toBeNull();
  });

  it("closing the active tab activates its neighbor; closing the last falls back to View", async () => {
    await act(async () => {
      render(<PartnerWindow />);
    });
    await deliver(payload({ term: "API Gateway" }));
    await deliver(payload({ term: "Lambda" }));
    fireEvent.click(screen.getByRole("button", { name: 'Close "Lambda"' }));
    expect(screen.queryByRole("tab", { name: /Lambda/ })).toBeNull();
    expect(screen.getByRole("tab", { name: /API Gateway/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    fireEvent.click(
      screen.getByRole("button", { name: 'Close "API Gateway"' }),
    );
    // Nothing left open: the fixed View (4) tab takes over, empty.
    expect(screen.getByRole("tab", { name: "View" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByText(/Pick something in Ally/)).toBeInTheDocument();
  });

  it("researches a fresh term tagged to its tab, so another tab's answer never bleeds in", async () => {
    await act(async () => {
      render(<PartnerWindow />);
    });
    await deliver(payload({ term: "Fresh term", answer: null }));
    // The window issued a research request tagged partner::<tabKey>.
    const card = useAllyStore.getState().cards[0];
    expect(card?.sourceKey).toMatch(/^partner::item::Fresh term::/);
    // Stream an answer into that card, then open a second tab: the first
    // tab's answer must not render under the second.
    act(() => {
      useAllyStore.getState().applyChunk({
        request_id: card!.id,
        token: "Streamed answer.",
        done: true,
        error: null,
      });
    });
    await deliver(payload({ term: "Other", answer: "Other's answer." }));
    expect(screen.getByText("Other's answer.")).toBeInTheDocument();
    expect(screen.queryByText("Streamed answer.")).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: /Fresh term/ }));
    expect(screen.getByText("Streamed answer.")).toBeInTheDocument();
  });

  it("renders a typed claim without starting term research", async () => {
    await act(async () => {
      render(<PartnerWindow />);
    });
    await deliver(
      payload({
        term: "Both people died.",
        kind: "claim",
        answer: null,
        claim: typedClaim(),
      }),
    );

    expect(screen.getByTestId("claim-evidence-view")).toBeInTheDocument();
    expect(
      screen.getByText("Four separate confidence axes"),
    ).toBeInTheDocument();
    expect(useAllyStore.getState().cards).toHaveLength(0);
  });

  it("refreshes an open claim tab from a newer cumulative snapshot", async () => {
    await act(async () => {
      render(<PartnerWindow />);
    });
    await deliver(
      payload({
        term: "Both people died.",
        kind: "claim",
        answer: null,
        claim: typedClaim(),
      }),
    );

    act(() => {
      useAllyStore.setState({
        claimSnapshot: {
          contract_version: 2,
          session_id: "session-1",
          epoch: 1,
          revision: 2,
          claims: [
            typedClaim({
              normalized_proposition: "One person died.",
              claim_confidence: "limited",
              updated_at_unix_ms: 2,
            }),
          ],
        },
      });
    });

    expect(screen.getAllByText("One person died.")).toHaveLength(2);
    // The fixed View tab plus the one claim tab.
    expect(screen.getAllByRole("tab")).toHaveLength(2);
  });
});

describe("PartnerWindow font menu", () => {
  beforeEach(() => {
    useAllyStore.getState().clear();
    for (const k of Object.keys(subscribers)) delete subscribers[k];
    vi.clearAllMocks();
    backend.partner.payload.mockResolvedValue(null);
    backend.partner.locked.mockResolvedValue(true);
    backend.rag.list.mockResolvedValue([]);
    localStorage.removeItem("conva.partner.fontPx");
    // The uiPrefs store is a module singleton — clearing localStorage alone
    // doesn't reset the in-memory value bumped by an earlier test.
    useUiPrefs.setState({ partnerFontPx: 14 });
  });

  it("A+ bumps the persisted partner font size", async () => {
    await act(async () => {
      render(<PartnerWindow />);
    });
    fireEvent.click(screen.getByRole("button", { name: "Text size" }));
    fireEvent.click(screen.getByRole("button", { name: "Larger text" }));
    expect(localStorage.getItem("conva.partner.fontPx")).toBe("15");
  });

  it("applies the font size to the content body", async () => {
    await act(async () => {
      render(<PartnerWindow />);
    });
    fireEvent.click(screen.getByRole("button", { name: "Text size" }));
    fireEvent.click(screen.getByRole("button", { name: "Larger text" }));
    expect(document.querySelector('[data-testid="partner-body"]')).toHaveStyle({
      fontSize: "15px",
    });
  });
});

describe("PartnerWindow document tabs", () => {
  beforeEach(() => {
    useAllyStore.getState().clear();
    for (const k of Object.keys(subscribers)) delete subscribers[k];
    vi.clearAllMocks();
    backend.partner.payload.mockResolvedValue(null);
    backend.partner.locked.mockResolvedValue(true);
    backend.rag.list.mockResolvedValue([{ id: "doc-1", file_name: "aws.pdf" }]);
    backend.rag.documentText.mockResolvedValue("full document body");
  });

  it("a source line matching a library document opens it as a tab with its text", async () => {
    await act(async () => {
      render(<PartnerWindow />);
    });
    await deliver(
      payload({
        term: "API Gateway",
        answer: "Fronts APIs.",
        source_lines: ["aws.pdf — ¶1–4", "missing.txt — ¶2"],
      }),
    );
    // The matching line is a button; the unmatched one is plain text.
    const openDoc = await screen.findByRole("button", {
      name: 'Open "aws.pdf"',
    });
    expect(
      screen.queryByRole("button", { name: 'Open "missing.txt"' }),
    ).toBeNull();
    fireEvent.click(openDoc);
    expect(screen.getByRole("tab", { name: /aws\.pdf/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(await screen.findByText("full document body")).toBeInTheDocument();
    expect(backend.rag.documentText).toHaveBeenCalledWith("doc-1");
  });

  it("shows the unavailable message when the document text is null", async () => {
    backend.rag.documentText.mockResolvedValue(null);
    await act(async () => {
      render(<PartnerWindow />);
    });
    await deliver(payload({ answer: "x", source_lines: ["aws.pdf — ¶1"] }));
    fireEvent.click(
      await screen.findByRole("button", { name: 'Open "aws.pdf"' }),
    );
    expect(
      await screen.findByText("This document's text isn't available."),
    ).toBeInTheDocument();
  });

  it("a delivered payload with doc_id opens straight to a document tab (e.g. 'view' on a Library row)", async () => {
    await act(async () => {
      render(<PartnerWindow />);
    });
    await deliver(payload({ term: "aws.pdf", doc_id: "doc-1", answer: null }));
    expect(screen.getByRole("tab", { name: /aws\.pdf/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(await screen.findByText("full document body")).toBeInTheDocument();
    expect(backend.rag.documentText).toHaveBeenCalledWith("doc-1");
    // Not researched as a term — it's a document, no "ANSWER" heading path.
    expect(useAllyStore.getState().cards).toHaveLength(0);
  });

  it("renders generated document Markdown in formatted mode by default", async () => {
    backend.rag.documentText.mockResolvedValue(
      "# Context Intelligence\n\nThe boat had **seven people** aboard.",
    );
    await act(async () => {
      render(<PartnerWindow />);
    });
    await deliver(
      payload({
        term: "Nolan Wells — Context Intelligence Pack.txt",
        doc_id: "doc-1",
        answer: null,
      }),
    );

    expect(
      await screen.findByRole("heading", { name: "Context Intelligence" }),
    ).toBeInTheDocument();
    expect(screen.getByText("seven people").tagName).toBe("STRONG");
    expect(screen.queryByText(/\*\*seven people\*\*/)).toBeNull();
    expect(screen.getByRole("button", { name: "Raw" })).toBeInTheDocument();
  });

  it("the same doc_id delivered twice focuses the one tab instead of duplicating", async () => {
    await act(async () => {
      render(<PartnerWindow />);
    });
    await deliver(payload({ term: "aws.pdf", doc_id: "doc-1" }));
    await deliver(payload({ term: "Lambda" }));
    await deliver(payload({ term: "aws.pdf", doc_id: "doc-1" }));
    expect(screen.getAllByRole("tab", { name: /aws\.pdf/ })).toHaveLength(1);
    expect(screen.getByRole("tab", { name: /aws\.pdf/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });
});

describe("PartnerWindow lock toggle", () => {
  beforeEach(() => {
    useAllyStore.getState().clear();
    for (const k of Object.keys(subscribers)) delete subscribers[k];
    vi.clearAllMocks();
    backend.partner.payload.mockResolvedValue(null);
    backend.partner.locked.mockResolvedValue(true);
    backend.rag.list.mockResolvedValue([]);
  });

  it("shows the locked state from the shell and toggles to unlocked", async () => {
    await act(async () => {
      render(<PartnerWindow />);
    });
    const toggle = await screen.findByRole("button", {
      name: /Locked to the app/,
    });
    fireEvent.click(toggle);
    expect(backend.partner.setLocked).toHaveBeenCalledWith(false);
    expect(
      screen.getByRole("button", { name: /Floating/ }),
    ).toBeInTheDocument();
  });

  it("updates the icon when the shell releases the lock (drag)", async () => {
    await act(async () => {
      render(<PartnerWindow />);
    });
    await screen.findByRole("button", { name: /Locked to the app/ });
    await act(async () => {
      subscribers["partnerLock"]?.({ locked: false });
    });
    expect(
      screen.getByRole("button", { name: /Floating/ }),
    ).toBeInTheDocument();
  });
});


describe("PartnerWindow View (4) tab", () => {
  const viewState = (over: Partial<import("@/lib/ipc").ViewState> = {}) => ({
    items: [
      {
        id: "card:a1",
        group: "question" as const,
        question: "How do you handle partial failures?",
        answer: "- Make each step idempotent\n- Retry with backoff",
        source_label: "A1",
        source_files: ["baseline briefing.txt"],
        status: "ready" as const,
        card_id: "a1",
        found_id: null,
        tier: null,
        kind: null,
        facts: [],
      },
    ],
    active_id: "card:a1",
    pinned_ids: [] as string[],
    ...over,
  });

  beforeEach(() => {
    useAllyStore.getState().clear();
    for (const k of Object.keys(subscribers)) delete subscribers[k];
    vi.clearAllMocks();
    backend.partner.payload.mockResolvedValue(null);
    backend.partner.viewState.mockResolvedValue(null);
    backend.partner.locked.mockResolvedValue(true);
    backend.rag.list.mockResolvedValue([]);
  });

  it("opens on the View tab, titled 'Ally — View'", async () => {
    await act(async () => {
      render(<PartnerWindow />);
    });
    expect(screen.getByRole("tab", { name: "View" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByText(/Ally — View/)).toBeInTheDocument();
  });

  it("renders the state the main window last pushed (read on boot)", async () => {
    backend.partner.viewState.mockResolvedValue(viewState());
    await act(async () => {
      render(<PartnerWindow />);
    });
    expect(screen.getByText("Say now")).toBeInTheDocument();
    expect(screen.getByText("Make each step idempotent")).toBeInTheDocument();
    expect(screen.getByText("Retry with backoff")).toBeInTheDocument();
  });

  it("follows live pushes from the main window", async () => {
    await act(async () => {
      render(<PartnerWindow />);
    });
    expect(screen.getByText(/Pick something in Ally/)).toBeInTheDocument();
    await act(async () => {
      subscribers["partnerViewState"]?.(viewState());
    });
    expect(screen.getByText("Make each step idempotent")).toBeInTheDocument();
  });

  it("sends select, pin, elaborate and ask back to the main window", async () => {
    backend.partner.viewState.mockResolvedValue(
      viewState({
        items: [
          ...viewState().items,
          {
            ...viewState().items[0]!,
            id: "found:t-x",
            group: "term" as const,
            question: "Step Functions",
            answer: "A workflow service.",
          },
        ],
      }),
    );
    await act(async () => {
      render(<PartnerWindow />);
    });
    fireEvent.click(screen.getByRole("tab", { name: /Step Functions/ }));
    expect(backend.partner.sendViewAction).toHaveBeenCalledWith({
      kind: "select",
      id: "found:t-x",
    });
    fireEvent.click(screen.getByRole("button", { name: /Pin/ }));
    expect(backend.partner.sendViewAction).toHaveBeenCalledWith({
      kind: "pin",
      id: "found:t-x",
    });
    fireEvent.click(screen.getByRole("button", { name: /Elaborate/ }));
    expect(backend.partner.sendViewAction).toHaveBeenCalledWith({
      kind: "elaborate",
      id: "found:t-x",
    });
    const input = screen.getByLabelText("Ask a follow-up");
    fireEvent.change(input, { target: { value: "and retries?" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(backend.partner.sendViewAction).toHaveBeenCalledWith({
      kind: "ask",
      id: "found:t-x",
      text: "and retries?",
    });
  });

  it("opens a grounding file as a document tab next to View", async () => {
    backend.rag.list.mockResolvedValue([
      { id: "doc-1", file_name: "baseline briefing.txt" },
    ]);
    backend.partner.viewState.mockResolvedValue(viewState());
    await act(async () => {
      render(<PartnerWindow />);
    });
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: 'Open "baseline briefing.txt"' }),
      );
    });
    expect(
      screen.getByRole("tab", { name: /baseline briefing.txt/ }),
    ).toHaveAttribute("aria-selected", "true");
    // The View tab is still there to go back to.
    expect(screen.getByRole("tab", { name: "View" })).toBeInTheDocument();
  });
});


describe("PartnerWindow View (4) — live assist grid", () => {
  const wireItem = (over: Partial<import("@/lib/ipc").ViewItem> = {}) => ({
    id: "found:q-s1:them:4",
    group: "question" as const,
    question: "What's the total amount per district?",
    answer: "The total amount is $439,519.85.",
    source_label: "Table answer",
    source_files: ["Q3-district-sales.csv"],
    status: "ready" as const,
    card_id: null,
    found_id: "q-s1:them:4",
    tier: null,
    kind: null,
    facts: [],
    ...over,
  });
  const state = (item: ReturnType<typeof wireItem>) => ({
    items: [item],
    active_id: item.id,
    pinned_ids: [] as string[],
  });

  beforeEach(() => {
    useAllyStore.getState().clear();
    for (const k of Object.keys(subscribers)) delete subscribers[k];
    vi.clearAllMocks();
    backend.partner.payload.mockResolvedValue(null);
    backend.partner.locked.mockResolvedValue(true);
    backend.rag.list.mockResolvedValue([]);
  });

  it("shows the holding response, then the grid when the main window pushes the finished result", async () => {
    backend.partner.viewState.mockResolvedValue(
      state(
        wireItem({
          answer: "One moment, I'm working that out from Q3-district-sales.csv.",
          status: "streaming",
        }),
      ),
    );
    await act(async () => {
      render(<PartnerWindow />);
    });
    expect(screen.getByRole("status")).toHaveTextContent("Answering…");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();

    const { DISTRICT_GRID } = await import("@/test/liveAssistFixtures");
    await act(async () => {
      subscribers["partnerViewState"]?.(state(wireItem({ table: DISTRICT_GRID })));
    });
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getAllByText("$439,519.85").length).toBeGreaterThan(0);
    expect(screen.getByRole("status")).toHaveTextContent("Ready");
  });

  it("sends a tapped choice back to the main window as a 'choose' action", async () => {
    backend.partner.viewState.mockResolvedValue(
      state(
        wireItem({
          id: "assist:la-2",
          found_id: null,
          answer: "Let me check which one you mean.",
          status: "instant",
          choice: {
            question: "Which column do you want to add up?",
            options: [
              { id: "1", label: "Amount", detail: "column 2" },
              { id: "2", label: "Net amount", detail: "column 3" },
            ],
          },
        }),
      ),
    );
    await act(async () => {
      render(<PartnerWindow />);
    });
    fireEvent.click(screen.getByRole("button", { name: /Net amount/ }));
    expect(backend.partner.sendViewAction).toHaveBeenCalledWith({
      kind: "choose",
      id: "assist:la-2",
      text: "2",
    });
  });
});

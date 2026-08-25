import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PartnerPayload } from "@/lib/ipc";
import { useAllyStore } from "@/state/ally";
import { useUiPrefs } from "@/state/uiPrefs";

const subscribers: Record<string, (p: unknown) => void> = {};
const backend = {
  partner: {
    payload: vi.fn().mockResolvedValue(null),
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
    ...overrides,
  };
}

async function deliver(p: PartnerPayload) {
  await act(async () => {
    subscribers["partnerTerm"]?.(p);
  });
}

afterEach(cleanup);

describe("PartnerWindow tabs", () => {
  beforeEach(() => {
    useAllyStore.getState().clear();
    for (const k of Object.keys(subscribers)) delete subscribers[k];
    vi.clearAllMocks();
    backend.partner.payload.mockResolvedValue(null);
    backend.partner.locked.mockResolvedValue(true);
    backend.rag.list.mockResolvedValue([]);
  });

  it("accumulates delivered payloads as tabs instead of replacing", async () => {
    await act(async () => {
      render(<PartnerWindow />);
    });
    await deliver(payload({ term: "API Gateway" }));
    await deliver(payload({ term: "Lambda" }));
    expect(screen.getByRole("tab", { name: /API Gateway/ })).toBeInTheDocument();
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

  it("closing the active tab activates its neighbor; closing the last shows the empty state", async () => {
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
    fireEvent.click(screen.getByRole("button", { name: 'Close "API Gateway"' }));
    expect(screen.getByText(/Open a term from the Terms tab/)).toBeInTheDocument();
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

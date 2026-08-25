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

describe("PartnerWindow document tabs", () => {
  beforeEach(() => {
    useAllyStore.getState().clear();
    for (const k of Object.keys(subscribers)) delete subscribers[k];
    vi.clearAllMocks();
    backend.partner.payload.mockResolvedValue(null);
    backend.partner.locked.mockResolvedValue(true);
    backend.rag.list.mockResolvedValue([
      { id: "doc-1", file_name: "aws.pdf" },
    ]);
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
    expect(screen.queryByRole("button", { name: 'Open "missing.txt"' })).toBeNull();
    fireEvent.click(openDoc);
    expect(
      screen.getByRole("tab", { name: /aws\.pdf/ }),
    ).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByText("full document body")).toBeInTheDocument();
    expect(backend.rag.documentText).toHaveBeenCalledWith("doc-1");
  });

  it("shows the unavailable message when the document text is null", async () => {
    backend.rag.documentText.mockResolvedValue(null);
    await act(async () => {
      render(<PartnerWindow />);
    });
    await deliver(
      payload({ answer: "x", source_lines: ["aws.pdf — ¶1"] }),
    );
    fireEvent.click(await screen.findByRole("button", { name: 'Open "aws.pdf"' }));
    expect(
      await screen.findByText("This document's text isn't available."),
    ).toBeInTheDocument();
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

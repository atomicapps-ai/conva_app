import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ContextDetail } from "@/components/context/ContextDetail";
import { BackendProvider } from "@/lib/backend";
import type { ConvaBackend } from "@/lib/backend/ConvaBackend";
import type { ContextPersona, ConversationContext, KnowledgeProfile } from "@/lib/ipc";

afterEach(cleanup);

function session(overrides: Partial<ConversationContext> = {}): ConversationContext {
  return {
    id: "s1",
    title: "Amazon Interview",
    purpose: "Prep for the CFO panel",
    job_description: null,
    category: "interview",
    status: "ready",
    created_at_unix_ms: 0,
    updated_at_unix_ms: 0,
    source_doc_ids: [],
    auto_generate_context: true,
    knowledge_profile_id: "kp-1",
    personas: [],
    chosen_persona_id: null,
    conversation_id: null,
    dossier_doc_id: null,
    ...overrides,
  };
}

function persona(overrides: Partial<ContextPersona> = {}): ContextPersona {
  return {
    id: "p1",
    title: "Skeptical CFO",
    summary: "Direct, numbers-first.",
    style_tags: ["skeptical"],
    recommended: false,
    ...overrides,
  };
}

function profile(overrides: Partial<KnowledgeProfile> = {}): KnowledgeProfile {
  return {
    id: "kp-1",
    title: "Amazon Interview",
    created_at_unix_ms: 0,
    updated_at_unix_ms: 0,
    doc_ids: [],
    research: [],
    ready: true,
    ...overrides,
  };
}

function renderDetail(backend: Partial<ConvaBackend>) {
  render(
    <BackendProvider backend={backend as ConvaBackend}>
      <ContextDetail id="s1" onEdit={() => undefined} onBack={() => undefined} />
    </BackendProvider>,
  );
}

describe("ContextDetail", () => {
  it("starts with all three sections collapsed to a one-line summary", async () => {
    renderDetail({
      context: { load: vi.fn().mockResolvedValue(session()), loadProfile: vi.fn().mockResolvedValue(profile()) },
      rag: { list: vi.fn().mockResolvedValue([]) },
      capabilities: vi.fn().mockResolvedValue(null),
    });
    await screen.findByText("Counterparty");
    // Collapsed — the always-visible description prose from the old
    // Section component is gone; nothing but the summary line shows.
    expect(screen.queryByText(/choose who you'll rehearse against/i)).toBeNull();
    expect(screen.getByText(/no personas generated yet/i)).toBeInTheDocument();
  });

  it("expands exactly one section at a time", async () => {
    renderDetail({
      context: { load: vi.fn().mockResolvedValue(session()), loadProfile: vi.fn().mockResolvedValue(profile()) },
      rag: { list: vi.fn().mockResolvedValue([]) },
      capabilities: vi.fn().mockResolvedValue(null),
    });
    await screen.findByText("Counterparty");

    fireEvent.click(screen.getByRole("button", { name: /counterparty/i }));
    expect(screen.getByText(/generate the personas/i)).toBeInTheDocument();

    // Opening Rehearse closes Counterparty (exclusive accordion).
    fireEvent.click(screen.getByRole("button", { name: /rehearse/i }));
    expect(screen.queryByText(/generate the personas/i)).toBeNull();
    expect(screen.getByRole("button", { name: /start rehearsal/i })).toBeInTheDocument();
  });

  it("clicking the open section again collapses it back to a summary", async () => {
    renderDetail({
      context: { load: vi.fn().mockResolvedValue(session()), loadProfile: vi.fn().mockResolvedValue(profile()) },
      rag: { list: vi.fn().mockResolvedValue([]) },
      capabilities: vi.fn().mockResolvedValue(null),
    });
    await screen.findByText("Counterparty");
    const toggle = screen.getByRole("button", { name: /counterparty/i });
    fireEvent.click(toggle);
    expect(screen.getByText(/generate the personas/i)).toBeInTheDocument();
    fireEvent.click(toggle);
    expect(screen.queryByText(/generate the personas/i)).toBeNull();
  });

  it("viewing a card's bio never changes which persona is chosen; the star does", async () => {
    const choosePersona = vi.fn().mockImplementation((_id: string, personaId: string) =>
      Promise.resolve(
        session({
          personas: [persona({ id: "p1", title: "Skeptical CFO" }), persona({ id: "p2", title: "Warm VP", gender: "female" })],
          chosen_persona_id: personaId,
        }),
      ),
    );
    renderDetail({
      context: {
        load: vi.fn().mockResolvedValue(
          session({
            personas: [
              persona({ id: "p1", title: "Skeptical CFO" }),
              persona({ id: "p2", title: "Warm VP", gender: "female" }),
            ],
          }),
        ),
        loadProfile: vi.fn().mockResolvedValue(profile()),
        choosePersona,
      },
      rag: { list: vi.fn().mockResolvedValue([]) },
      capabilities: vi.fn().mockResolvedValue(null),
    });
    await screen.findByText("Counterparty");
    fireEvent.click(screen.getByRole("button", { name: /counterparty/i }));

    // Defaults to viewing the first persona's bio — no persona chosen yet.
    expect(await screen.findByText("Direct, numbers-first.")).toBeInTheDocument();
    expect(screen.queryByText("Chosen ✓")).toBeNull();

    // Viewing the second card's bio is just browsing — still nothing chosen.
    fireEvent.click(screen.getByRole("button", { name: /view warm vp/i }));
    expect(screen.getByText("Direct, numbers-first.")).toBeInTheDocument();
    expect(screen.queryByText("Chosen ✓")).toBeNull();
    expect(choosePersona).not.toHaveBeenCalled();

    // The star is the actual "choose" control.
    fireEvent.click(screen.getByRole("button", { name: /choose skeptical cfo for rehearsal/i }));
    expect(choosePersona).toHaveBeenCalledWith("s1", "p1");
  });

  it("Ally research renders one line per source, with a viewer-load icon only when the partner window is supported", async () => {
    const partnerOpen = vi.fn().mockResolvedValue(undefined);
    renderDetail({
      context: {
        load: vi.fn().mockResolvedValue(session()),
        loadProfile: vi.fn().mockResolvedValue(
          profile({
            research: [
              {
                title: "GAAP overview",
                url: "https://example.com/gaap",
                snippet: "A long snippet that used to render as its own line under the title.",
                fetched_at_unix_ms: 0,
              },
            ],
          }),
        ),
      },
      rag: { list: vi.fn().mockResolvedValue([]) },
      capabilities: vi.fn().mockResolvedValue({ system: { partnerWindow: true } }),
      partner: { open: partnerOpen },
    });
    await screen.findByText("Counterparty");
    fireEvent.click(screen.getByRole("button", { name: /knowledge base/i }));

    expect(await screen.findByText("GAAP overview")).toBeInTheDocument();
    // The snippet no longer renders inline — it moved into the viewer payload.
    expect(screen.queryByText(/long snippet that used to render/i)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /load gaap overview into the viewer/i }));
    expect(partnerOpen).toHaveBeenCalledWith(
      "GAAP overview",
      "research",
      "A long snippet that used to render as its own line under the title.",
      "A long snippet that used to render as its own line under the title.",
      ["https://example.com/gaap"],
      null,
    );
  });
});

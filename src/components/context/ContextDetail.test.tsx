import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ContextDetail } from "@/components/context/ContextDetail";
import { BackendProvider } from "@/lib/backend";
import type { ConvaBackend } from "@/lib/backend/ConvaBackend";
import type { ConversationContext, KnowledgeProfile } from "@/lib/ipc";

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
});

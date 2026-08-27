import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GroundPicker } from "@/components/contexts/GroundPicker";
import { BackendProvider } from "@/lib/backend";
import type { ConvaBackend } from "@/lib/backend/ConvaBackend";
import { DEFAULT_CONTEXT_ID, type RagDocument, type ConversationContext, type ContextSummary } from "@/lib/ipc";
import { useGroundingStore } from "@/state/grounding";

afterEach(cleanup);
beforeEach(() => {
  useGroundingStore.setState({ activeId: null, activeTitle: null, activating: false });
});

function summary(overrides: Partial<ContextSummary> = {}): ContextSummary {
  return {
    id: "ctx-1",
    title: "Acme interview",
    category: "interview",
    status: "ready",
    created_at_unix_ms: 0,
    updated_at_unix_ms: 0,
    source_doc_count: 1,
    has_key_terms: false,
    research_enabled: false,
    has_job_description: false,
    has_generated_resources: true,
    ...overrides,
  };
}

function session(overrides: Partial<ConversationContext> = {}): ConversationContext {
  return {
    id: "ctx-1",
    title: "Acme interview",
    purpose: "",
    job_description: null,
    category: "interview",
    status: "ready",
    created_at_unix_ms: 0,
    updated_at_unix_ms: 0,
    source_doc_ids: ["doc-1"],
    auto_generate_context: false,
    research_enabled: false,
    key_terms: ["GAAP"],
    glossary: [],
    knowledge_profile_id: "kp-1",
    personas: [],
    chosen_persona_id: null,
    conversation_id: null,
    dossier_doc_id: null,
    ...overrides,
  };
}

function defaultSession(): ConversationContext {
  return session({
    id: DEFAULT_CONTEXT_ID,
    title: "General conversation",
    category: "other",
    key_terms: [],
  });
}

// Selection is required — GroundPicker auto-activates the default on mount
// whenever nothing is active, so the fake must answer per-id like the real
// backend does, not with one fixed session regardless of the id requested.
function fakeBackend(overrides: Partial<ConvaBackend["context"]> = {}): ConvaBackend {
  return {
    context: {
      list: vi.fn().mockResolvedValue([summary()]),
      load: vi.fn().mockResolvedValue(session()),
      activateContext: vi
        .fn()
        .mockImplementation((id: string) =>
          Promise.resolve(id === DEFAULT_CONTEXT_ID ? defaultSession() : session()),
        ),
      deactivateContext: vi.fn().mockResolvedValue(undefined),
      ...overrides,
    },
    rag: {
      list: vi.fn().mockResolvedValue([
        { id: "doc-1", file_name: "resume.pdf" } as RagDocument,
      ]),
    },
  } as unknown as ConvaBackend;
}

describe("GroundPicker", () => {
  it("auto-activates the default context on mount — selection is required", async () => {
    const activateContext = vi.fn().mockResolvedValue(defaultSession());
    render(
      <BackendProvider backend={fakeBackend({ activateContext })}>
        <GroundPicker />
      </BackendProvider>,
    );
    await waitFor(() => expect(activateContext).toHaveBeenCalledWith(DEFAULT_CONTEXT_ID));
    expect(await screen.findByText("General conversation")).toBeInTheDocument();
  });

  it("does not auto-activate while disabled (a session is listening)", () => {
    const activateContext = vi.fn();
    render(
      <BackendProvider backend={fakeBackend({ activateContext })}>
        <GroundPicker disabled />
      </BackendProvider>,
    );
    expect(activateContext).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /select context/i })).toBeDisabled();
  });

  it("opens the picker and lists the fetched context", async () => {
    render(
      <BackendProvider backend={fakeBackend()}>
        <GroundPicker />
      </BackendProvider>,
    );
    // Let the mount auto-activation settle first.
    const trigger = await screen.findByText("General conversation");
    fireEvent.click(trigger);
    expect(await screen.findByText("Acme interview")).toBeInTheDocument();
  });

  it("checking a single Ready context and applying activates it instantly", async () => {
    render(
      <BackendProvider backend={fakeBackend()}>
        <GroundPicker />
      </BackendProvider>,
    );
    const trigger = await screen.findByText("General conversation");
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole("checkbox", { name: /include acme interview/i }));
    expect(screen.getByText(/instant/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^select$/i }));
    // apply() is async (fire-and-forget from the click handler) — flush the
    // pending promise chain before asserting the resulting pill text.
    await waitFor(() => {});
    // The trigger becomes the newly active context's pill.
    expect(await screen.findByText("Acme interview", {}, { timeout: 2000 })).toBeInTheDocument();
  });

  it("hides Reset when the default is already active, shows it otherwise", async () => {
    render(
      <BackendProvider backend={fakeBackend()}>
        <GroundPicker />
      </BackendProvider>,
    );
    await screen.findByText("General conversation");
    expect(screen.queryByRole("button", { name: /reset to general conversation/i })).toBeNull();

    fireEvent.click(screen.getByText("General conversation"));
    fireEvent.click(await screen.findByRole("checkbox", { name: /include acme interview/i }));
    fireEvent.click(screen.getByRole("button", { name: /^select$/i }));
    await screen.findByText("Acme interview");
    expect(screen.getByRole("button", { name: /reset to general conversation/i })).toBeInTheDocument();
  });
});

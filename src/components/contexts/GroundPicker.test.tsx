import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GroundPicker } from "@/components/contexts/GroundPicker";
import { BackendProvider } from "@/lib/backend";
import type { ConvaBackend } from "@/lib/backend/ConvaBackend";
import type { RagDocument, SimConSession, SimConSummary } from "@/lib/ipc";
import { useGroundingStore } from "@/state/grounding";

afterEach(cleanup);
beforeEach(() => {
  useGroundingStore.setState({ activeId: null, activeTitle: null, activating: false });
});

function summary(overrides: Partial<SimConSummary> = {}): SimConSummary {
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

function session(overrides: Partial<SimConSession> = {}): SimConSession {
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

function fakeBackend(overrides: Partial<ConvaBackend["simcon"]> = {}): ConvaBackend {
  return {
    simcon: {
      list: vi.fn().mockResolvedValue([summary()]),
      load: vi.fn().mockResolvedValue(session()),
      activateContext: vi.fn().mockResolvedValue(session()),
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
  it("opens the picker and lists the fetched context", async () => {
    render(
      <BackendProvider backend={fakeBackend()}>
        <GroundPicker />
      </BackendProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: /ground ally on/i }));
    expect(await screen.findByText("Acme interview")).toBeInTheDocument();
  });

  it("checking a single Ready context and applying activates it instantly", async () => {
    const activateContext = vi.fn().mockResolvedValue(session());
    render(
      <BackendProvider backend={fakeBackend({ activateContext })}>
        <GroundPicker />
      </BackendProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: /ground ally on/i }));
    fireEvent.click(await screen.findByRole("checkbox", { name: /include acme interview/i }));
    expect(screen.getByText(/instant/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /ground it/i }));
    await waitFor(() => expect(activateContext).toHaveBeenCalledWith("ctx-1"));
    // The trigger becomes the active-context pill.
    expect(await screen.findByText("Acme interview", {}, { timeout: 2000 })).toBeInTheDocument();
  });

  it("disables the trigger while a session is listening", () => {
    render(
      <BackendProvider backend={fakeBackend()}>
        <GroundPicker disabled />
      </BackendProvider>,
    );
    expect(screen.getByRole("button", { name: /ground ally on/i })).toBeDisabled();
  });
});

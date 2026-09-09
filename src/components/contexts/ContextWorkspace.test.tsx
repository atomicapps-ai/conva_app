import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ContextWorkspace } from "@/components/contexts/ContextWorkspace";
import { BackendProvider } from "@/lib/backend";
import type { ConvaBackend } from "@/lib/backend/ConvaBackend";
import type { ContextSummary, ConversationContext } from "@/lib/ipc";

afterEach(cleanup);

function summary(overrides: Partial<ContextSummary> = {}): ContextSummary {
  return {
    id: "c1",
    title: "Nolan Wells Case",
    category: "live_stream",
    status: "ready",
    created_at_unix_ms: 0,
    updated_at_unix_ms: 0,
    source_doc_count: 2,
    has_key_terms: true,
    research_enabled: true,
    has_job_description: false,
    has_generated_resources: true,
    resources_generated_at_unix_ms: Date.now(),
    ...overrides,
  };
}

function full(overrides: Partial<ConversationContext> = {}): ConversationContext {
  return {
    id: "c1",
    title: "Nolan Wells Case",
    purpose: "",
    job_description: null,
    category: "live_stream",
    status: "ready",
    created_at_unix_ms: 0,
    updated_at_unix_ms: 0,
    source_doc_ids: [],
    auto_generate_context: true,
    research_enabled: true,
    knowledge_profile_id: "kp-1",
    personas: [],
    chosen_persona_id: null,
    conversation_id: null,
    dossier_doc_id: null,
    qa_doc_id: null,
    research_doc_id: null,
    key_terms: [],
    glossary: [],
    glossary_definitions: {},
    ...overrides,
  } as ConversationContext;
}

function renderWorkspace(generating: boolean, backendOverrides: Partial<ConvaBackend> = {}) {
  const backend = {
    context: {
      load: vi.fn().mockResolvedValue(full()),
      ...backendOverrides.context,
    },
    rag: { documentText: vi.fn().mockResolvedValue(null), ...backendOverrides.rag },
    ...backendOverrides,
  } as unknown as ConvaBackend;

  render(
    <BackendProvider backend={backend}>
      <ContextWorkspace
        summary={summary()}
        generating={generating}
        onGenerate={() => undefined}
        onOpenDetail={() => undefined}
        onEdit={() => undefined}
        onActivate={() => undefined}
        isActive={false}
      />
    </BackendProvider>,
  );
}

describe("ContextWorkspace footer Generate/Regenerate control", () => {
  it("is a plain, uncolored button with no spinner when idle", async () => {
    renderWorkspace(false);
    const button = await screen.findByRole("button", { name: "Regenerate" });
    expect(button.className).not.toContain("text-ai");
    expect(button.querySelector(".animate-spin")).toBeNull();
    expect(screen.queryByRole("status", { name: /resource generation results/i })).toBeNull();
  });

  it("turns gold, shows a spinning ring, and a live progress bar while generating — the exact regression from the owner's screenshot (plain white 'Generating…' button, no color, no animation, no progress)", async () => {
    renderWorkspace(true);
    const button = await screen.findByRole("button", { name: "Generating…" });
    expect(button.className).toContain("text-ai");
    expect(button.querySelector(".animate-spin")).not.toBeNull();
    // The progress bar (role="status") renders above the button with a
    // starting label before any backend stage event has arrived.
    expect(await screen.findByText("Starting…")).toBeInTheDocument();
  });
});

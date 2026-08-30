import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ConversationsPanel } from "@/components/ConversationsPanel";
import { BackendProvider } from "@/lib/backend";
import type { ConvaBackend } from "@/lib/backend/ConvaBackend";
import type { ContextSummary } from "@/lib/ipc";
import { useContextsQuickOpen } from "@/state/contextsQuickOpen";
import { useNavStore } from "@/state/nav";

afterEach(cleanup);

function context(overrides: Partial<ContextSummary> = {}): ContextSummary {
  return {
    id: "c1",
    title: "Amazon Interview",
    category: "interview",
    status: "ready",
    created_at_unix_ms: 0,
    updated_at_unix_ms: 0,
    source_doc_count: 2,
    has_key_terms: true,
    research_enabled: false,
    has_job_description: false,
    has_generated_resources: false,
    ...overrides,
  };
}

function fakeBackend(contexts: ContextSummary[]): ConvaBackend {
  return {
    conversations: { list: vi.fn().mockResolvedValue([]) },
    sessions: { list: vi.fn().mockResolvedValue([]) },
    context: { list: vi.fn().mockResolvedValue(contexts) },
    rag: { list: vi.fn().mockResolvedValue([]) },
  } as unknown as ConvaBackend;
}

describe("ConversationsPanel", () => {
  it("is a top-level nav destination — no back button (owner, 2026-08-30)", async () => {
    render(
      <BackendProvider backend={fakeBackend([])}>
        <ConversationsPanel onClose={vi.fn()} />
      </BackendProvider>,
    );
    await screen.findByRole("heading", { name: "Conversations" });
    expect(screen.queryByRole("button", { name: /back/i })).toBeNull();
  });

  it("Rehearse navigates to the context's detail page, not Live", async () => {
    useNavStore.setState({ view: "conversations" });
    const onClose = vi.fn();
    render(
      <BackendProvider backend={fakeBackend([context()])}>
        <ConversationsPanel onClose={onClose} />
      </BackendProvider>,
    );
    await screen.findByRole("heading", { name: "Conversations" });

    fireEvent.click(screen.getByRole("button", { name: "Rehearsals" }));
    fireEvent.click(screen.getByRole("button", { name: /amazon interview/i }));

    // The whole point of Rehearse: land on the Contexts view with this
    // context's id queued, so ContextsView's mode initializer jumps
    // straight to its detail page. A stray extra navigation call here
    // (onClose, which always means "go to Live") used to silently clobber
    // this and leave the app on Live instead — ContextsView never even
    // mounted to consume the queued id.
    expect(useNavStore.getState().view).toBe("context");
    expect(useContextsQuickOpen.getState().pendingId).toBe("c1");
    expect(onClose).not.toHaveBeenCalled();
  });
});

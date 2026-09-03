import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ConversationsPanel } from "@/components/ConversationsPanel";
import { NAV_ITEMS } from "@/components/studio/navItems";
import { activeRailView } from "@/components/studio/railState";
import { BackendProvider } from "@/lib/backend";
import type { ConvaBackend } from "@/lib/backend/ConvaBackend";
import type { Conversation, ContextSummary, ConversationSummary, SessionSummary } from "@/lib/ipc";
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

function conversationRow(overrides: Partial<ConversationSummary> = {}): ConversationSummary {
  return {
    id: "conv-1",
    title: "Amazon interview prep",
    created_at_unix_ms: 0,
    updated_at_unix_ms: 1_000,
    segment_count: 5,
    linked_docs: [],
    preview: "",
    ...overrides,
  };
}

function sessionRow(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: "session-1",
    started_at_unix_ms: 2_000,
    segment_count: 3,
    preview: "hello",
    is_rehearsal: false,
    simcon_title: null,
    ...overrides,
  };
}

function fakeBackend(
  contexts: ContextSummary[],
  conversations: ConversationSummary[] = [],
  sessions: SessionSummary[] = [],
): ConvaBackend {
  return {
    conversations: {
      list: vi.fn().mockResolvedValue(conversations),
      delete: vi.fn().mockResolvedValue(undefined),
      load: vi.fn().mockImplementation(
        async (id: string): Promise<Conversation> => ({
          id,
          title: conversations.find((c) => c.id === id)?.title ?? "Untitled",
          created_at_unix_ms: 0,
          updated_at_unix_ms: 0,
          segments: [],
          linked_docs: [],
        }),
      ),
    },
    sessions: {
      list: vi.fn().mockResolvedValue(sessions),
      delete: vi.fn().mockResolvedValue(undefined),
      load: vi.fn().mockResolvedValue([]),
    },
    context: { list: vi.fn().mockResolvedValue(contexts) },
    rag: { list: vi.fn().mockResolvedValue([]) },
  } as unknown as ConvaBackend;
}

describe("ConversationsPanel", () => {
  // AppUI V5.0 decision 2 (owner-approved, conva_core@1b007ed) reverses the
  // 2026-08-30 call that made this a top-level destination: the rail is now
  // exactly six rows and Conversations is a SUB-VIEW of Home. Per CLAUDE.md
  // rule 9 that means it MUST carry the back control it previously refused.
  it("is a sub-view of Home — back control returns to it", async () => {
    const onClose = vi.fn();
    render(
      <BackendProvider backend={fakeBackend([])}>
        <ConversationsPanel onClose={onClose} />
      </BackendProvider>,
    );
    await screen.findByRole("heading", { name: "Conversations" });

    const back = screen.getByRole("button", { name: /back/i });
    fireEvent.click(back);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("is not one of the six rail destinations", () => {
    expect(NAV_ITEMS.some((i) => i.view === "conversations")).toBe(false);
    // …but it still lights Home, so the rail keeps answering "where am I".
    expect(activeRailView("conversations")).toBe("dashboard");
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

  it("opening a saved conversation row navigates to Live", async () => {
    // Regression: clicking a row loaded the transcript into the store but
    // never switched views, so the app stayed on whatever screen the
    // Conversations panel was opened from (Home/⌘K) and the loaded
    // conversation never actually appeared anywhere — only the search-hit
    // path (openSearchHit) called setView("live"); the plain row click
    // (open) didn't.
    useNavStore.setState({ view: "conversations" });
    const backend = fakeBackend([], [conversationRow({ title: "Amazon interview prep" })]);
    render(
      <BackendProvider backend={backend}>
        <ConversationsPanel onClose={vi.fn()} />
      </BackendProvider>,
    );
    await screen.findByRole("heading", { name: "Conversations" });

    fireEvent.click(screen.getByRole("button", { name: "Amazon interview prep" }));

    await waitFor(() => expect(backend.conversations.load).toHaveBeenCalledWith("conv-1"));
    expect(useNavStore.getState().view).toBe("live");
  });

  it("opening a past (unsaved) session row navigates to Live", async () => {
    useNavStore.setState({ view: "conversations" });
    const backend = fakeBackend([], [], [sessionRow({ preview: "hello there" })]);
    render(
      <BackendProvider backend={backend}>
        <ConversationsPanel onClose={vi.fn()} />
      </BackendProvider>,
    );
    await screen.findByRole("heading", { name: "Conversations" });

    // Default tab is "All activity" — a session row is visible with no tab
    // switch needed.
    fireEvent.click(screen.getByRole("button", { name: "hello there" }));

    await waitFor(() => expect(backend.sessions.load).toHaveBeenCalledWith("session-1"));
    expect(useNavStore.getState().view).toBe("live");
  });

  it("checking two rows shows the bulk bar with a count of 2", async () => {
    const backend = fakeBackend([], [conversationRow()], [sessionRow()]);
    render(
      <BackendProvider backend={backend}>
        <ConversationsPanel onClose={vi.fn()} />
      </BackendProvider>,
    );
    await screen.findByText("Amazon interview prep");

    fireEvent.click(screen.getByRole("checkbox", { name: /select amazon interview prep/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: /select hello/i }));

    expect(await screen.findByText("2 selected")).toBeInTheDocument();
  });

  it("bulk delete dispatches to the right backend call per row kind", async () => {
    const backend = fakeBackend([], [conversationRow()], [sessionRow()]);
    render(
      <BackendProvider backend={backend}>
        <ConversationsPanel onClose={vi.fn()} />
      </BackendProvider>,
    );
    await screen.findByText("Amazon interview prep");

    fireEvent.click(screen.getByRole("checkbox", { name: /select amazon interview prep/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: /select hello/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete selected" }));

    await waitFor(() => {
      expect(backend.conversations.delete).toHaveBeenCalledWith("conv-1");
      expect(backend.sessions.delete).toHaveBeenCalledWith("session-1");
    });
  });

  it("a session row's own trash can calls backend.sessions.delete", async () => {
    const backend = fakeBackend([], [], [sessionRow()]);
    render(
      <BackendProvider backend={backend}>
        <ConversationsPanel onClose={vi.fn()} />
      </BackendProvider>,
    );
    await screen.findByText("hello");

    fireEvent.click(screen.getByRole("button", { name: /delete hello/i }));

    await waitFor(() => expect(backend.sessions.delete).toHaveBeenCalledWith("session-1"));
  });

  it("switching filter tabs clears any selection", async () => {
    const backend = fakeBackend([], [conversationRow()], []);
    render(
      <BackendProvider backend={backend}>
        <ConversationsPanel onClose={vi.fn()} />
      </BackendProvider>,
    );
    await screen.findByText("Amazon interview prep");
    fireEvent.click(screen.getByRole("checkbox", { name: /select amazon interview prep/i }));
    await screen.findByText("1 selected");

    fireEvent.click(screen.getByRole("button", { name: "History" }));
    fireEvent.click(screen.getByRole("button", { name: "All activity" }));

    // The bulk bar stays mounted (collapsed to 0 height) even with nothing
    // selected, so assert no *non-zero* count is shown rather than that
    // no "selected" text exists at all.
    expect(screen.queryByText(/^[1-9]\d* selected$/)).toBeNull();
  });
});

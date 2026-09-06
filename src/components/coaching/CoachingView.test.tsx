import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CoachingView } from "@/components/coaching/CoachingView";
import { BackendProvider } from "@/lib/backend";
import { DESKTOP_CAPABILITIES } from "@/lib/backend/capabilities";
import type { ConvaBackend } from "@/lib/backend/ConvaBackend";
import {
  DEFAULT_CONTEXT_ID,
  type ContextSummary,
  type ConversationContext,
  type SessionSummary,
} from "@/lib/ipc";
import { useNavStore } from "@/state/nav";

afterEach(cleanup);
beforeEach(() => useNavStore.setState({ view: "coaching", paletteOpen: false }));

function summary(over: Partial<ContextSummary> = {}): ContextSummary {
  return {
    id: "c1",
    title: "Director of Product Interview",
    category: "interview",
    status: "ready",
    created_at_unix_ms: 1,
    updated_at_unix_ms: 2,
    source_doc_count: 12,
    has_key_terms: true,
    research_enabled: true,
    has_job_description: true,
    has_generated_resources: true,
    ...over,
  };
}

function full(over: Partial<ConversationContext> = {}): ConversationContext {
  return {
    id: "c1",
    title: "Director of Product Interview",
    purpose: "",
    job_description: null,
    category: "interview",
    status: "ready",
    created_at_unix_ms: 1,
    updated_at_unix_ms: 2,
    source_doc_ids: [],
    auto_generate_context: false,
    knowledge_profile_id: null,
    personas: [
      { id: "p1", title: "Hiring Manager", summary: "Direct.", style_tags: [], recommended: true },
    ],
    chosen_persona_id: "p1",
    conversation_id: null,
    dossier_doc_id: null,
    ...over,
  };
}

function fakeBackend({
  contexts = [summary()],
  fulls = { c1: full() } as Record<string, ConversationContext>,
  sessions = [] as SessionSummary[],
  listRejects = false,
}: {
  contexts?: ContextSummary[];
  fulls?: Record<string, ConversationContext>;
  sessions?: SessionSummary[];
  listRejects?: boolean;
} = {}): ConvaBackend {
  return {
    // `useCapabilities()` resolves through the backend — desktop defaults are
    // what Coaching's "Start session" gate reads.
    capabilities: vi.fn().mockResolvedValue(DESKTOP_CAPABILITIES),
    context: {
      list: listRejects
        ? vi.fn().mockRejectedValue(new Error("no backend"))
        : vi.fn().mockResolvedValue(contexts),
      load: vi.fn(async (id: string) => {
        const found = fulls[id];
        if (!found) throw new Error("missing");
        return found;
      }),
    },
    sessions: { list: vi.fn().mockResolvedValue(sessions) },
    // The template path hands off to the existing ContextSetup wizard, which
    // lists library documents on mount.
    rag: { list: vi.fn().mockResolvedValue([]) },
  } as unknown as ConvaBackend;
}

describe("CoachingView", () => {
  it("groups prepared setups apart from drafts and names the missing step", async () => {
    render(
      <BackendProvider
        backend={fakeBackend({
          contexts: [
            summary(),
            summary({ id: "c2", title: "Enterprise Discovery", has_generated_resources: false }),
          ],
          fulls: { c1: full(), c2: full({ id: "c2", personas: [], chosen_persona_id: null }) },
        })}
      >
        <CoachingView />
      </BackendProvider>,
    );

    expect(await screen.findByText("Prepared coaching")).toBeInTheDocument();
    expect(screen.getByText("Director of Product Interview")).toBeInTheDocument();
    expect(screen.getByText("Draft setups")).toBeInTheDocument();
    expect(screen.getByText("Enterprise Discovery")).toBeInTheDocument();
    expect(screen.getByText(/Generate its resources to finish/)).toBeInTheDocument();
  });

  it("never lists the always-present default context as a setup", async () => {
    render(
      <BackendProvider
        backend={fakeBackend({
          contexts: [summary({ id: DEFAULT_CONTEXT_ID, title: "General conversation" })],
          fulls: {},
        })}
      >
        <CoachingView />
      </BackendProvider>,
    );
    expect(await screen.findByText("No prepared setups yet")).toBeInTheDocument();
    expect(screen.queryByText("General conversation")).toBeNull();
  });

  it("shows an honest empty state — and NO analytics, scores or trends", async () => {
    render(
      <BackendProvider backend={fakeBackend({ contexts: [], fulls: {} })}>
        <CoachingView />
      </BackendProvider>,
    );
    expect(await screen.findByText("No prepared setups yet")).toBeInTheDocument();
    expect(screen.getByText("No coaching sessions yet")).toBeInTheDocument();
    // Decision 7: analytics stay hidden until real session data exists.
    for (const banned of [/score/i, /streak/i, /trend/i, /% improvement/i]) {
      expect(screen.queryByText(banned)).toBeNull();
    }
  });

  it("surfaces a load failure with a retry rather than an empty page", async () => {
    render(
      <BackendProvider backend={fakeBackend({ listRejects: true })}>
        <CoachingView />
      </BackendProvider>,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("Coaching unavailable");
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("lists recorded coaching sessions, newest first, without inventing metrics", async () => {
    render(
      <BackendProvider
        backend={fakeBackend({
          sessions: [
            {
              id: "s-old",
              started_at_unix_ms: 1,
              segment_count: 4,
              preview: "older",
              is_rehearsal: true,
              simcon_title: "Older run",
            },
            {
              id: "s-new",
              started_at_unix_ms: Date.now(),
              segment_count: 12,
              preview: "newer",
              is_rehearsal: true,
              simcon_title: "Newer run",
            },
            {
              id: "s-call",
              started_at_unix_ms: Date.now(),
              segment_count: 30,
              preview: "a real call",
              is_rehearsal: false,
              simcon_title: null,
            },
          ],
        })}
      >
        <CoachingView />
      </BackendProvider>,
    );

    const rows = await screen.findAllByText(/run$/);
    expect(rows.map((r) => r.textContent)).toEqual(["Newer run", "Older run"]);
    // A non-rehearsal session is an ordinary call — it belongs to Conversations.
    expect(screen.queryByText("a real call")).toBeNull();
  });

  it("starting from a practice template opens the setup flow, prefilled", async () => {
    render(
      <BackendProvider backend={fakeBackend()}>
        <CoachingView />
      </BackendProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: /Product Interview\s*Use/ }));
    // The template jumps straight into the Context wizard with its name in it.
    await waitFor(() =>
      expect(screen.getByDisplayValue("Product Interview")).toBeInTheDocument(),
    );
  });

  it("'+ New coaching setup' starts at step 1 — choose or create a Context", async () => {
    render(
      <BackendProvider backend={fakeBackend()}>
        <CoachingView />
      </BackendProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "+ New coaching setup" }));
    expect(await screen.findByText("Step 1 · Choose or create a Context")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "New coaching setup" })).toBeInTheDocument();
  });
});

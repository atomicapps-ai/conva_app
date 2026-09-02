import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DashboardView } from "@/components/dashboard/DashboardView";
import { BackendProvider } from "@/lib/backend";
import { DESKTOP_CAPABILITIES } from "@/lib/backend/capabilities";
import type { ConvaBackend } from "@/lib/backend/ConvaBackend";
import type { AuthStatus, ContextSummary, ConversationSummary, RagDocument } from "@/lib/ipc";
import { useAppStore } from "@/state/app";
import { useGroundingStore } from "@/state/grounding";
import { useNavStore } from "@/state/nav";

afterEach(cleanup);
beforeEach(() => {
  useNavStore.setState({ view: "dashboard", paletteOpen: false });
  useAppStore.setState({ config: null });
  useGroundingStore.setState({ activeId: null, activeTitle: null });
});

function fakeBackend({
  contexts = [] as ContextSummary[],
  conversations = [] as ConversationSummary[],
  documents = [] as RagDocument[],
  fails = false,
  auth = { signed_in: true, email: "maya.chen@example.com" } as Partial<AuthStatus>,
} = {}): ConvaBackend {
  const reject = () => Promise.reject(new Error("no backend"));
  return {
    capabilities: vi.fn().mockResolvedValue(DESKTOP_CAPABILITIES),
    auth: {
      status: vi.fn().mockResolvedValue({
        signed_in: false,
        email: null,
        user_id: null,
        expires_at_unix: null,
        last_sign_in_at: null,
        configured: true,
        ...auth,
      }),
      openUrl: vi.fn(),
    },
    context: {
      list: fails ? vi.fn(reject) : vi.fn().mockResolvedValue(contexts),
      load: vi.fn(reject),
    },
    conversations: { list: fails ? vi.fn(reject) : vi.fn().mockResolvedValue(conversations) },
    rag: {
      list: fails ? vi.fn(reject) : vi.fn().mockResolvedValue(documents),
      documentText: vi.fn().mockResolvedValue(null),
    },
  } as unknown as ConvaBackend;
}

describe("DashboardView — Home", () => {
  it("greets the signed-in user by their own name, never a fixture", async () => {
    useAppStore.setState({
      config: { profile_display_name: "Maya Chen", profile_role: "Senior PM" } as never,
    });
    render(
      <BackendProvider backend={fakeBackend()}>
        <DashboardView />
      </BackendProvider>,
    );
    expect(
      await screen.findByRole("heading", { name: /^Good (morning|afternoon|evening), Maya$/ }),
    ).toBeInTheDocument();
  });

  it("shows the first-run starter — and no fabricated counts", async () => {
    render(
      <BackendProvider backend={fakeBackend()}>
        <DashboardView />
      </BackendProvider>,
    );
    expect(
      await screen.findByRole("heading", { name: "Set Conva up for your first conversation" }),
    ).toBeInTheDocument();
    expect(screen.getByText("No documents yet")).toBeInTheDocument();
    // The hero's stats only exist for a real, grounded context.
    expect(screen.queryByText(/source files/)).toBeNull();
    expect(screen.queryByText(/prepared Q&A/)).toBeNull();
  });

  it("offers 'Choose a context' when nothing is grounding the next session", async () => {
    render(
      <BackendProvider
        backend={fakeBackend({
          contexts: [
            {
              id: "c1",
              title: "Board Strategy Review",
              category: "company_meeting",
              status: "ready",
              created_at_unix_ms: 1,
              updated_at_unix_ms: 2,
              source_doc_count: 8,
              has_key_terms: false,
              research_enabled: true,
              has_job_description: false,
              has_generated_resources: true,
            },
          ],
        })}
      >
        <DashboardView />
      </BackendProvider>,
    );
    expect(await screen.findByRole("heading", { name: "General conversation" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Choose a context" })).toBeInTheDocument();
  });

  it("surfaces a load failure in the hero with a retry", async () => {
    render(
      <BackendProvider backend={fakeBackend({ fails: true })}>
        <DashboardView />
      </BackendProvider>,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't load your workspace");
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("always offers exactly one Start Listening primary action", async () => {
    render(
      <BackendProvider backend={fakeBackend()}>
        <DashboardView />
      </BackendProvider>,
    );
    const buttons = await screen.findAllByRole("button", { name: "Start Listening" });
    expect(buttons).toHaveLength(1);
  });
});

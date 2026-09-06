import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DashboardView } from "@/components/dashboard/DashboardView";
import { BackendProvider } from "@/lib/backend";
import { DESKTOP_CAPABILITIES, type Capabilities } from "@/lib/backend/capabilities";
import type { ConvaBackend } from "@/lib/backend/ConvaBackend";
import { formatTranscriptForViewer } from "@/lib/formatTranscript";
import type {
  AuthStatus,
  Conversation,
  ContextSummary,
  ConversationSummary,
  RagDocument,
  TranscriptSegment,
} from "@/lib/ipc";
import { useAppStore } from "@/state/app";
import { useConversationStore } from "@/state/conversation";
import { useGroundingStore } from "@/state/grounding";
import { useNavStore } from "@/state/nav";

afterEach(cleanup);
beforeEach(() => {
  useNavStore.setState({ view: "dashboard", paletteOpen: false });
  useAppStore.setState({ config: null });
  useGroundingStore.setState({ activeId: null, activeTitle: null });
  useConversationStore.setState({ openId: null, title: null });
});

function fakeBackend({
  contexts = [] as ContextSummary[],
  conversations = [] as ConversationSummary[],
  documents = [] as RagDocument[],
  fails = false,
  auth = { signed_in: true, email: "maya.chen@example.com" } as Partial<AuthStatus>,
  capabilities = DESKTOP_CAPABILITIES,
  conversationLoad,
  partnerOpen = vi.fn().mockResolvedValue(undefined),
}: {
  contexts?: ContextSummary[];
  conversations?: ConversationSummary[];
  documents?: RagDocument[];
  fails?: boolean;
  auth?: Partial<AuthStatus>;
  capabilities?: Capabilities | null;
  conversationLoad?: (id: string) => Promise<Conversation>;
  partnerOpen?: ReturnType<typeof vi.fn>;
} = {}): ConvaBackend {
  const reject = () => Promise.reject(new Error("no backend"));
  return {
    capabilities: vi.fn().mockResolvedValue(capabilities),
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
    conversations: {
      list: fails ? vi.fn(reject) : vi.fn().mockResolvedValue(conversations),
      load: conversationLoad ? vi.fn(conversationLoad) : vi.fn(reject),
    },
    rag: {
      list: fails ? vi.fn(reject) : vi.fn().mockResolvedValue(documents),
      documentText: vi.fn().mockResolvedValue(null),
    },
    partner: { open: partnerOpen },
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

  it("clicking a Recent-conversations row loads it into Live, not just the Conversations page", async () => {
    // Regression (owner bug report, 2026-09-04): the row's onClick only
    // called setView("conversations") — it never loaded the specific
    // conversation, unlike the identical-looking row on the Conversations
    // page itself, which does (`ConversationsPanel.tsx`'s `open`).
    const conversationLoad = vi.fn().mockResolvedValue({
      id: "conv-1",
      title: "Amazon interview prep",
      created_at_unix_ms: 0,
      updated_at_unix_ms: 0,
      segments: [],
      linked_docs: [],
    } satisfies Conversation);
    render(
      <BackendProvider
        backend={fakeBackend({
          conversations: [
            {
              id: "conv-1",
              title: "Amazon interview prep",
              created_at_unix_ms: 0,
              updated_at_unix_ms: 1_000,
              segment_count: 5,
              linked_docs: [],
              preview: "",
            },
          ],
          conversationLoad,
        })}
      >
        <DashboardView />
      </BackendProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Amazon interview prep" }));

    await waitFor(() => expect(conversationLoad).toHaveBeenCalledWith("conv-1"));
    expect(useNavStore.getState().view).toBe("live");
    expect(useConversationStore.getState().title).toBe("Amazon interview prep");
  });

  it("the transcript-viewer icon opens the partner window with a formatted transcript, and stays on Home", async () => {
    const segments: TranscriptSegment[] = [
      {
        side: "inbound",
        seq: 0,
        text: "Walk me through your last project.",
        is_final: true,
        start_ms: 0,
        end_ms: 0,
        confidence: null,
        latency_ms: 0,
      },
    ];
    const partnerOpen = vi.fn().mockResolvedValue(undefined);
    render(
      <BackendProvider
        backend={fakeBackend({
          conversations: [
            {
              id: "conv-1",
              title: "Amazon interview prep",
              created_at_unix_ms: 0,
              updated_at_unix_ms: 1_000,
              segment_count: 1,
              linked_docs: [],
              preview: "",
            },
          ],
          conversationLoad: vi.fn().mockResolvedValue({
            id: "conv-1",
            title: "Amazon interview prep",
            created_at_unix_ms: 0,
            updated_at_unix_ms: 0,
            segments,
            linked_docs: [],
          } satisfies Conversation),
          partnerOpen,
        })}
      >
        <DashboardView />
      </BackendProvider>,
    );
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Open Amazon interview prep in the transcript viewer",
      }),
    );

    await waitFor(() =>
      expect(partnerOpen).toHaveBeenCalledWith(
        "Amazon interview prep",
        null,
        null,
        formatTranscriptForViewer(segments),
        [],
      ),
    );
    expect(useNavStore.getState().view).toBe("dashboard");
  });

  it("the Live icon on a Recent-conversations row opens it in Live", async () => {
    const conversationLoad = vi.fn().mockResolvedValue({
      id: "conv-1",
      title: "Amazon interview prep",
      created_at_unix_ms: 0,
      updated_at_unix_ms: 0,
      segments: [],
      linked_docs: [],
    } satisfies Conversation);
    render(
      <BackendProvider
        backend={fakeBackend({
          conversations: [
            {
              id: "conv-1",
              title: "Amazon interview prep",
              created_at_unix_ms: 0,
              updated_at_unix_ms: 1_000,
              segment_count: 5,
              linked_docs: [],
              preview: "",
            },
          ],
          conversationLoad,
        })}
      >
        <DashboardView />
      </BackendProvider>,
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Open Amazon interview prep in Live" }),
    );

    await waitFor(() => expect(conversationLoad).toHaveBeenCalledWith("conv-1"));
    expect(useNavStore.getState().view).toBe("live");
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

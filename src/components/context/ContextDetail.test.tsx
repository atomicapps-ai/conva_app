import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ContextDetail } from "@/components/context/ContextDetail";
import { BackendProvider } from "@/lib/backend";
import type { ConvaBackend } from "@/lib/backend/ConvaBackend";
import type { ContextGenerateProgressEvent, ContextPersona, ConversationContext, KnowledgeProfile } from "@/lib/ipc";

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
    favorite: false,
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

function renderDetail(
  backend: Partial<ConvaBackend> = {
    context: { load: vi.fn().mockResolvedValue(session()), loadProfile: vi.fn().mockResolvedValue(profile()) },
    rag: { list: vi.fn().mockResolvedValue([]) },
    capabilities: vi.fn().mockResolvedValue(null),
  } as Partial<ConvaBackend>,
) {
  render(
    <BackendProvider backend={backend as ConvaBackend}>
      <ContextDetail id="s1" onEdit={() => undefined} onBack={() => undefined} />
    </BackendProvider>,
  );
}

describe("ContextDetail", () => {
  it("reports the pack, blocked research, and separate Q&A after Live Stream generation", async () => {
    const live = session({
      category: "live_stream",
      title: "Nolan Wells Case",
      research_enabled: true,
      dossier_doc_id: null,
    });
    const generated = { ...live, dossier_doc_id: "knowledge-1", qa_doc_id: "qa-1" };
    renderDetail({
      context: {
        load: vi.fn().mockResolvedValue(live),
        loadProfile: vi.fn().mockResolvedValue(profile()),
        researchKeyStatus: vi.fn().mockResolvedValue(false),
        generateDossier: vi.fn().mockResolvedValue(generated),
      },
      rag: {
        list: vi.fn().mockResolvedValue([]),
        documentText: vi.fn().mockResolvedValue("# Context Knowledge"),
      },
      capabilities: vi.fn().mockResolvedValue(null),
    } as Partial<ConvaBackend>);

    await screen.findByText("Guest"); // live_stream's role label, not the default "interview"
    fireEvent.click(screen.getByRole("button", { name: /knowledge base/i }));
    await screen.findByText("Context Intelligence Pack");
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));

    expect(await screen.findByText("Add a Firecrawl key in Settings → Web research (Context), then regenerate.")).toBeInTheDocument();
    expect(screen.getByText(/Generated as a separate review resource, then compiled/i)).toBeInTheDocument();
    expect(screen.getByText("Compiled and indexed as this Context's single live retrieval source.")).toBeInTheDocument();
  });

  it("shows a live progress bar above the button while a generation is in flight", async () => {
    const live = session({ dossier_doc_id: null });
    let resolveGenerate: (value: ConversationContext) => void = () => {};
    const generateDossier = vi.fn(
      () => new Promise<ConversationContext>((resolve) => { resolveGenerate = resolve; }),
    );
    let progressHandler: ((e: ContextGenerateProgressEvent) => void) | undefined;
    const subscribe = vi.fn((event: string, handler: (e: ContextGenerateProgressEvent) => void) => {
      if (event === "contextGenerateProgress") progressHandler = handler;
      return Promise.resolve(() => {});
    });

    renderDetail({
      context: {
        load: vi.fn().mockResolvedValue(live),
        loadProfile: vi.fn().mockResolvedValue(profile()),
        researchKeyStatus: vi.fn().mockResolvedValue(true),
        generateDossier,
      },
      rag: { list: vi.fn().mockResolvedValue([]), documentText: vi.fn().mockResolvedValue("") },
      capabilities: vi.fn().mockResolvedValue(null),
      subscribe,
    } as unknown as Partial<ConvaBackend>);

    await screen.findByText("Interviewer");
    fireEvent.click(screen.getByRole("button", { name: /knowledge base/i }));
    await screen.findByText("Context Intelligence Pack");
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));

    // No stage event has arrived yet — the label starts here regardless.
    expect(await screen.findByText("Starting…")).toBeInTheDocument();

    act(() => {
      progressHandler?.({ stage: "writing_qa", context_id: "s1", percent: 45 });
    });
    expect(await screen.findByText("Writing prepared Q&A…")).toBeInTheDocument();

    await act(async () => {
      resolveGenerate({ ...live, dossier_doc_id: "knowledge-1", qa_doc_id: "qa-1" });
    });
    // The run finished — the progress bar (and its live stage label) is gone.
    await waitFor(() => expect(screen.queryByText("Writing prepared Q&A…")).toBeNull());
  });

  it("shows safe claim-policy defaults for a Context saved before policy persistence", async () => {
    renderDetail();
    const policy = await screen.findByRole("button", {
      name: /Claim checks & source policy/i,
    });
    expect(policy).toHaveTextContent("Candidate · automatic checks · 5 source classes");
    fireEvent.click(policy);
    expect(screen.getByText("Candidate")).toBeInTheDocument();
    expect(screen.getByText("Documents attached to this Context")).toBeInTheDocument();
    expect(screen.getByText(/normalized claim and necessary event qualifiers/i)).toBeInTheDocument();
  });

  it("starts with all four sections collapsed to a one-line summary", async () => {
    renderDetail({
      context: { load: vi.fn().mockResolvedValue(session()), loadProfile: vi.fn().mockResolvedValue(profile()) },
      rag: { list: vi.fn().mockResolvedValue([]) },
      capabilities: vi.fn().mockResolvedValue(null),
    });
    await screen.findByText("Interviewer");
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
    await screen.findByText("Interviewer");

    fireEvent.click(screen.getByRole("button", { name: /^interviewer/i }));
    expect(screen.getByText(/generate the personas/i)).toBeInTheDocument();

    // Opening Rehearse closes Interviewer (exclusive accordion).
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
    await screen.findByText("Interviewer");
    const toggle = screen.getByRole("button", { name: /^interviewer/i });
    fireEvent.click(toggle);
    expect(screen.getByText(/generate the personas/i)).toBeInTheDocument();
    fireEvent.click(toggle);
    expect(screen.queryByText(/generate the personas/i)).toBeNull();
  });

  it("viewing a card's bio never chooses it; the checkbox chooses, the star favorites — independently", async () => {
    const choosePersona = vi.fn().mockImplementation((_id: string, personaId: string) =>
      Promise.resolve(
        session({
          personas: [persona({ id: "p1", title: "Skeptical CFO" }), persona({ id: "p2", title: "Warm VP", gender: "female" })],
          chosen_persona_id: personaId,
        }),
      ),
    );
    const toggleFavoritePersona = vi.fn().mockImplementation((_id: string, personaId: string, favorite: boolean) =>
      Promise.resolve(
        session({
          personas: [
            persona({ id: "p1", title: "Skeptical CFO", favorite: personaId === "p1" ? favorite : false }),
            persona({ id: "p2", title: "Warm VP", gender: "female", favorite: personaId === "p2" ? favorite : false }),
          ],
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
        toggleFavoritePersona,
      },
      rag: { list: vi.fn().mockResolvedValue([]) },
      capabilities: vi.fn().mockResolvedValue(null),
    });
    await screen.findByText("Interviewer");
    fireEvent.click(screen.getByRole("button", { name: /^interviewer/i }));

    // Defaults to viewing the first persona's bio — no persona chosen yet,
    // and the required-selection instruction is showing.
    expect(await screen.findByText("Direct, numbers-first.")).toBeInTheDocument();
    expect(screen.queryByText("Chosen ✓")).toBeNull();
    expect(screen.getByText("Required")).toBeInTheDocument();

    // Viewing the second card's bio is just browsing — nothing is chosen.
    fireEvent.click(screen.getByRole("button", { name: /view warm vp's bio/i }));
    expect(choosePersona).not.toHaveBeenCalled();

    // The checkbox is the actual "choose for rehearsal" control.
    fireEvent.click(screen.getByRole("checkbox", { name: /select warm vp for rehearsal/i }));
    expect(choosePersona).toHaveBeenCalledWith("s1", "p2");

    // The star is a separate, independent "favorite" control.
    fireEvent.click(screen.getByRole("button", { name: /favorite skeptical cfo/i }));
    expect(toggleFavoritePersona).toHaveBeenCalledWith("s1", "p1", true);
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
    await screen.findByText("Interviewer");
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

  it("groups the Documents list by category slot when slot_doc_ids is populated", async () => {
    const resumeDoc = {
      id: "d1",
      file_name: "resume.pdf",
      enabled: true,
      chunk_count: 2,
      ingested_at_unix_ms: 0,
      source: "file" as const,
      context_ids: ["s1"],
      size_bytes: 1024,
    };
    const otherDoc = {
      id: "d2",
      file_name: "notes.txt",
      enabled: true,
      chunk_count: 1,
      ingested_at_unix_ms: 0,
      source: "file" as const,
      context_ids: ["s1"],
      size_bytes: 512,
    };
    renderDetail({
      context: {
        load: vi.fn().mockResolvedValue(session({
          source_doc_ids: ["d1", "d2"],
          slot_doc_ids: { resume: ["d1"] },
        })),
        loadProfile: vi.fn().mockResolvedValue(profile({ doc_ids: ["d1", "d2"] })),
      },
      rag: { list: vi.fn().mockResolvedValue([resumeDoc, otherDoc]) },
      capabilities: vi.fn().mockResolvedValue(null),
    });
    await screen.findByText("Interviewer");
    fireEvent.click(screen.getByRole("button", { name: /knowledge base/i }));

    expect(await screen.findByText("Résumé / CV (1)")).toBeInTheDocument();
    expect(screen.getByText("resume.pdf")).toBeInTheDocument();
    expect(screen.getByText("Other documents (1)")).toBeInTheDocument();
    expect(screen.getByText("notes.txt")).toBeInTheDocument();
    // Every slot renders even with zero docs — the "what's still missing"
    // signal the spec is for.
    expect(screen.getByText("Take-home / test (0)")).toBeInTheDocument();
    // The Job description SLOT was removed (step 1 already captures the job
    // description as text); it must not come back as an empty section.
    expect(screen.queryByText(/^Job description \(/)).not.toBeInTheDocument();
  });

  it("surfaces a doc still assigned to the retired job_description slot under Other documents", async () => {
    // Contexts created before that slot was removed still carry
    // `slot_doc_ids.job_description`. groupBySlot only claims docs for slots the
    // template still lists, so the rest fall through to Other — the doc must
    // stay visible rather than silently disappearing from the Context.
    const jdDoc = {
      id: "d9",
      file_name: "job-description.pdf",
      enabled: true,
      chunk_count: 3,
      ingested_at_unix_ms: 0,
      source: "file" as const,
      context_ids: ["s1"],
      size_bytes: 2048,
    };
    renderDetail({
      context: {
        load: vi.fn().mockResolvedValue(session({
          source_doc_ids: ["d9"],
          slot_doc_ids: { job_description: ["d9"] },
        })),
        loadProfile: vi.fn().mockResolvedValue(profile({ doc_ids: ["d9"] })),
      },
      rag: { list: vi.fn().mockResolvedValue([jdDoc]) },
      capabilities: vi.fn().mockResolvedValue(null),
    });
    await screen.findByText("Interviewer");
    fireEvent.click(screen.getByRole("button", { name: /knowledge base/i }));

    expect(await screen.findByText("Other documents (1)")).toBeInTheDocument();
    expect(screen.getByText("job-description.pdf")).toBeInTheDocument();
  });

  it("falls back to Other documents for every attached doc when slot_doc_ids is empty (pre-migration contexts)", async () => {
    const resumeDoc = {
      id: "d1",
      file_name: "resume.pdf",
      enabled: true,
      chunk_count: 2,
      ingested_at_unix_ms: 0,
      source: "file" as const,
      context_ids: ["s1"],
      size_bytes: 1024,
    };
    renderDetail({
      context: {
        load: vi.fn().mockResolvedValue(session({ source_doc_ids: ["d1"] })), // slot_doc_ids omitted entirely
        loadProfile: vi.fn().mockResolvedValue(profile({ doc_ids: ["d1"] })),
      },
      rag: { list: vi.fn().mockResolvedValue([resumeDoc]) },
      capabilities: vi.fn().mockResolvedValue(null),
    });
    await screen.findByText("Interviewer");
    fireEvent.click(screen.getByRole("button", { name: /knowledge base/i }));

    expect(await screen.findByText("Other documents (1)")).toBeInTheDocument();
    expect(screen.getByText("resume.pdf")).toBeInTheDocument();
    expect(screen.getByText("Résumé / CV (0)")).toBeInTheDocument();
  });
});

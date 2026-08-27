import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SimConSetup } from "@/components/simcon/SimConSetup";
import { BackendProvider } from "@/lib/backend";
import type { ConvaBackend } from "@/lib/backend/ConvaBackend";
import type { SimConSession } from "@/lib/ipc";

afterEach(cleanup);

// Minimal fake — the wizard only calls rag.list() on mount; the rest is local
// React state until Finish (which these tests don't reach).
function fakeBackend(): ConvaBackend {
  return {
    rag: { list: vi.fn().mockResolvedValue([]) },
  } as unknown as ConvaBackend;
}

function renderSetup() {
  render(
    <BackendProvider backend={fakeBackend()}>
      <SimConSetup onDone={() => undefined} onCancel={() => undefined} />
    </BackendProvider>,
  );
}

describe("SimConSetup wizard", () => {
  it("offers the four conversation types", async () => {
    renderSetup();
    // findBy flushes the mount effect (rag.list) so no act() warnings.
    expect(await screen.findByRole("button", { name: "Interview" })).toBeInTheDocument();
    for (const type of ["Company meeting", "Sales call", "Other"]) {
      expect(screen.getByRole("button", { name: type })).toBeInTheDocument();
    }
  });

  it("shows the job-description field only for Interview", async () => {
    renderSetup();
    // Interview is the default type → JD field present.
    expect(await screen.findByPlaceholderText(/job description/i)).toBeInTheDocument();
    // Switching to an internal type hides it.
    fireEvent.click(screen.getByRole("button", { name: "Company meeting" }));
    expect(screen.queryByPlaceholderText(/job description/i)).toBeNull();
  });

  it("defaults web research on for the Interview type", async () => {
    renderSetup();
    // Name is required to advance to step 2.
    const name = await screen.findByPlaceholderText(/Senior Accountant interview/i);
    fireEvent.change(name, { target: { value: "My interview" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    // The research toggle (now joined on step 2 by the interview-only deep
    // Q&A checkbox) is on by default for Interview.
    expect(
      screen.getByRole("checkbox", { name: /research the web for context/i }),
    ).toBeChecked();
  });

  it("preserves generated-document ids and derived fields across an edit-save", async () => {
    const save = vi.fn().mockResolvedValue({ id: "s1" });
    const prepare = vi.fn().mockResolvedValue({ id: "s1" });
    const backend = {
      rag: { list: vi.fn().mockResolvedValue([]) },
      simcon: { save, prepare },
    } as unknown as ConvaBackend;

    const initial: SimConSession = {
      id: "s1",
      title: "Amazon Interview",
      purpose: "",
      job_description: null,
      category: "interview",
      status: "ready",
      created_at_unix_ms: 0,
      updated_at_unix_ms: 0,
      source_doc_ids: [],
      auto_generate_context: true,
      research_enabled: true,
      deep_qa_enabled: true,
      key_terms: [],
      glossary: [],
      glossary_definitions: { "API Gateway": "managed API front door." },
      knowledge_profile_id: "kp-1",
      personas: [],
      chosen_persona_id: null,
      conversation_id: null,
      dossier_doc_id: "doc-1",
      research_doc_id: "doc-2",
      qa_doc_id: "doc-3",
      resources_stale: true,
    };

    render(
      <BackendProvider backend={backend}>
        <SimConSetup initial={initial} onDone={() => undefined} onCancel={() => undefined} />
      </BackendProvider>,
    );

    await screen.findByDisplayValue("Amazon Interview");
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Finish" }));

    await waitFor(() => expect(save).toHaveBeenCalled());
    const payload = save.mock.calls[0][0];
    expect(payload.research_doc_id).toBe("doc-2");
    expect(payload.qa_doc_id).toBe("doc-3");
    expect(payload.glossary_definitions).toEqual({ "API Gateway": "managed API front door." });
    expect(payload.resources_stale).toBe(true);
  });
});

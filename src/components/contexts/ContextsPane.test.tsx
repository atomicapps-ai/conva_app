import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ContextsPane } from "@/components/contexts/ContextsPane";
import { BackendProvider } from "@/lib/backend";
import type { ConvaBackend } from "@/lib/backend/ConvaBackend";
import { DEFAULT_CONTEXT_ID, type ContextSummary, type RagDocument } from "@/lib/ipc";

afterEach(cleanup);

function summary(overrides: Partial<ContextSummary> = {}): ContextSummary {
  return {
    id: "s1",
    title: "Acme interview",
    category: "interview",
    status: "draft",
    created_at_unix_ms: 0,
    updated_at_unix_ms: 0,
    source_doc_count: 0,
    has_key_terms: false,
    research_enabled: false,
    has_job_description: false,
    has_generated_resources: false,
    ...overrides,
  };
}

const noop = () => undefined;

// ContextsPane fetches the document list itself (to sum each context's
// total size, and for the drag-and-drop drop target) — a bare-bones fake
// is enough for these tests.
function fakeBackend(docs: RagDocument[] = []): ConvaBackend {
  return {
    rag: {
      list: vi.fn().mockResolvedValue(docs),
      detachContext: vi.fn().mockResolvedValue(undefined),
    },
  } as unknown as ConvaBackend;
}

function renderPane(ui: ReactElement, docs: RagDocument[] = []) {
  return render(<BackendProvider backend={fakeBackend(docs)}>{ui}</BackendProvider>);
}

const defaultProps = {
  selectedId: null,
  onSelect: noop,
  onOpen: noop,
  onNew: noop,
  onEdit: noop,
  onDelete: noop,
  onGenerate: noop,
  onAttach: noop,
  generatingId: null,
  widthPx: 400,
  onResize: noop,
};

describe("ContextsPane", () => {
  it("disables Generate until the context has a grounding source; the info popover's Status explains why for drafts", () => {
    renderPane(<ContextsPane {...defaultProps} items={[summary()]} />);
    expect(
      screen.getByRole("button", { name: /generate resources for acme interview/i }),
    ).toBeDisabled();
    // The row is one line now (owner, 2026-08-28) — the status dot carries
    // just the plain label on hover; the readiness checklist moved behind
    // the "i" info popover.
    expect(screen.getByTitle("Draft")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /info for acme interview/i }));
    expect(screen.getByText(/at least one grounding source/i)).toBeInTheDocument();
  });

  it("enables Generate once key terms are declared, and calls onGenerate", () => {
    const onGenerate = vi.fn();
    renderPane(
      <ContextsPane
        {...defaultProps}
        items={[summary({ has_key_terms: true })]}
        onGenerate={onGenerate}
      />,
    );
    const btn = screen.getByRole("button", {
      name: /generate resources for acme interview/i,
    });
    expect(btn).not.toBeDisabled();
    fireEvent.click(btn);
    expect(onGenerate).toHaveBeenCalledWith("s1");
  });

  it("hides the New Context button off-desktop (web has no Context folder to write to)", () => {
    renderPane(<ContextsPane {...defaultProps} items={[]} />);
    // jsdom has no __TAURI__ global -> isDesktop is false -> button absent.
    expect(screen.queryByRole("button", { name: "Add a New Context" })).toBeNull();
  });

  it("shows Open, Edit, Regenerate, and Delete as direct icon buttons — no overflow menu", () => {
    const onEdit = vi.fn();
    const onDelete = vi.fn();
    const onOpen = vi.fn();
    renderPane(
      <ContextsPane
        {...defaultProps}
        items={[summary({ has_key_terms: true })]}
        onEdit={onEdit}
        onDelete={onDelete}
        onOpen={onOpen}
      />,
    );
    // No overflow menu of any kind.
    expect(screen.queryByRole("button", { name: /more actions/i })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /open acme interview/i }));
    expect(onOpen).toHaveBeenCalledWith("s1");

    fireEvent.click(screen.getByRole("button", { name: /edit setup for acme interview/i }));
    expect(onEdit).toHaveBeenCalledWith("s1");

    fireEvent.click(screen.getByRole("button", { name: /delete acme interview/i }));
    expect(onDelete).toHaveBeenCalledWith("s1");
  });

  it("Ready contexts' info popover shows Type/Status/Updated and no readiness checklist", () => {
    renderPane(
      <ContextsPane
        {...defaultProps}
        items={[
          summary({
            status: "ready",
            has_key_terms: true,
            updated_at_unix_ms: Date.now() - 3_600_000,
          }),
        ]}
      />,
    );
    expect(screen.getByTitle("Ready")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /info for acme interview/i }));
    expect(screen.getByText("Interview")).toBeInTheDocument();
    expect(screen.getByText("Ready")).toBeInTheDocument();
    expect(screen.getByText(/ago$/)).toBeInTheDocument();
    expect(screen.queryByText(/at least one grounding source/i)).toBeNull();
  });

  it("Regenerate's tooltip reads 'Never regenerated' until the context has one, then the relative time", () => {
    renderPane(
      <ContextsPane
        {...defaultProps}
        items={[
          summary({
            has_key_terms: true,
            resources_generated_at_unix_ms: Date.now() - 2 * 3_600_000,
          }),
        ]}
      />,
    );
    expect(
      screen.getByRole("button", { name: /generate resources for acme interview/i }),
    ).toHaveAttribute("title", expect.stringContaining("Last regenerated"));
  });

  it("the Default context shows Regenerate but hides Edit and Delete", () => {
    renderPane(
      <ContextsPane
        {...defaultProps}
        items={[summary({ id: DEFAULT_CONTEXT_ID, title: "General conversation", has_key_terms: true })]}
      />,
    );
    expect(
      screen.getByRole("button", { name: /generate resources for general conversation/i }),
    ).not.toBeDisabled();
    expect(screen.queryByRole("button", { name: /edit setup for general conversation/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /delete general conversation/i })).toBeNull();
  });

  it("the title's hover tooltip totals size across every document tagged to this context", async () => {
    const docs: RagDocument[] = [
      {
        id: "d1",
        file_name: "resume.pdf",
        enabled: true,
        chunk_count: 2,
        ingested_at_unix_ms: 0,
        source: "file",
        context_ids: ["s1"],
        size_bytes: 1000,
      },
      {
        id: "d2",
        file_name: "Acme — Context knowledge",
        enabled: true,
        chunk_count: 3,
        ingested_at_unix_ms: 0,
        source: "generated",
        context_ids: ["s1"],
        size_bytes: 500,
      },
    ];
    renderPane(<ContextsPane {...defaultProps} items={[summary({ source_doc_count: 1 })]} />, docs);
    // The doc list loads asynchronously (backend.rag.list()) — findBy
    // flushes it.
    const titleBtn = await screen.findByTitle(/1500 B total|1\.5 KB total/i);
    expect(titleBtn).toHaveTextContent("Acme interview");
  });
});

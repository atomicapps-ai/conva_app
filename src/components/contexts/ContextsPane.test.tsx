import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ContextsPane } from "@/components/contexts/ContextsPane";
import { BackendProvider } from "@/lib/backend";
import type { ConvaBackend } from "@/lib/backend/ConvaBackend";
import type { ContextSummary } from "@/lib/ipc";

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

// ContextsPane fetches the document list itself (to render each context's
// expanded child-doc tree) — a bare-bones fake is enough for these tests,
// none of which expand a row.
function fakeBackend(): ConvaBackend {
  return {
    rag: {
      list: vi.fn().mockResolvedValue([]),
      detachContext: vi.fn().mockResolvedValue(undefined),
    },
  } as unknown as ConvaBackend;
}

function renderPane(ui: ReactElement) {
  return render(<BackendProvider backend={fakeBackend()}>{ui}</BackendProvider>);
}

describe("ContextsPane", () => {
  it("disables Generate until the context has a grounding source, and shows why", () => {
    renderPane(
      <ContextsPane
        items={[summary()]}
        selectedId={null}
        onSelect={noop}
        onOpen={noop}
        onNew={noop}
        onEdit={noop}
        onDelete={noop}
        onGenerate={noop}
        onAttach={noop}
        generatingId={null}
        widthPx={400}
        onResize={noop}
      />,
    );
    expect(
      screen.getByRole("button", { name: /generate resources for acme interview/i }),
    ).toBeDisabled();
    expect(
      screen.getByText(/at least one grounding source/i),
    ).toBeInTheDocument();
  });

  it("enables Generate once key terms are declared, and calls onGenerate", () => {
    const onGenerate = vi.fn();
    renderPane(
      <ContextsPane
        items={[summary({ has_key_terms: true })]}
        selectedId={null}
        onSelect={noop}
        onOpen={noop}
        onNew={noop}
        onEdit={noop}
        onDelete={noop}
        onGenerate={onGenerate}
        onAttach={noop}
        generatingId={null}
        widthPx={400}
        onResize={noop}
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
    renderPane(
      <ContextsPane
        items={[]}
        selectedId={null}
        onSelect={noop}
        onOpen={noop}
        onNew={noop}
        onEdit={noop}
        onDelete={noop}
        onGenerate={noop}
        onAttach={noop}
        generatingId={null}
        widthPx={400}
        onResize={noop}
      />,
    );
    // jsdom has no __TAURI__ global -> isDesktop is false -> button absent.
    expect(screen.queryByRole("button", { name: "Add a New Context" })).toBeNull();
  });

  it("keeps Open + Generate inline and tucks Edit/Delete behind the ⋮ menu", () => {
    const onEdit = vi.fn();
    const onDelete = vi.fn();
    renderPane(
      <ContextsPane
        items={[summary({ has_key_terms: true })]}
        selectedId={null}
        onSelect={noop}
        onOpen={noop}
        onNew={noop}
        onEdit={onEdit}
        onDelete={onDelete}
        onGenerate={noop}
        onAttach={noop}
        generatingId={null}
        widthPx={400}
        onResize={noop}
      />,
    );
    // Edit/Delete aren't inline row buttons — only behind the menu.
    expect(screen.queryByRole("button", { name: "Edit setup" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /more actions for acme interview/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /edit setup/i }));
    expect(onEdit).toHaveBeenCalledWith("s1");

    fireEvent.click(screen.getByRole("button", { name: /more actions for acme interview/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /delete/i }));
    expect(onDelete).toHaveBeenCalledWith("s1");
  });

  it("Ready contexts don't show the checklist", () => {
    renderPane(
      <ContextsPane
        items={[summary({ status: "ready", has_key_terms: true })]}
        selectedId={null}
        onSelect={noop}
        onOpen={noop}
        onNew={noop}
        onEdit={noop}
        onDelete={noop}
        onGenerate={noop}
        onAttach={noop}
        generatingId={null}
        widthPx={400}
        onResize={noop}
      />,
    );
    expect(screen.queryByText(/at least one grounding source/i)).toBeNull();
  });
});

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ContextsPane } from "@/components/contexts/ContextsPane";
import type { SimConSummary } from "@/lib/ipc";

afterEach(cleanup);

function summary(overrides: Partial<SimConSummary> = {}): SimConSummary {
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

describe("ContextsPane", () => {
  it("disables Generate until the context has a grounding source, and shows why", () => {
    render(
      <ContextsPane
        items={[summary()]}
        selectedId={null}
        onSelect={noop}
        onOpen={noop}
        onNew={noop}
        onEdit={noop}
        onDelete={noop}
        onAttach={noop}
        onGenerate={noop}
        generatingId={null}
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
    render(
      <ContextsPane
        items={[summary({ has_key_terms: true })]}
        selectedId={null}
        onSelect={noop}
        onOpen={noop}
        onNew={noop}
        onEdit={noop}
        onDelete={noop}
        onAttach={noop}
        onGenerate={onGenerate}
        generatingId={null}
      />,
    );
    const btn = screen.getByRole("button", {
      name: /generate resources for acme interview/i,
    });
    expect(btn).not.toBeDisabled();
    fireEvent.click(btn);
    expect(onGenerate).toHaveBeenCalledWith("s1");
  });

  it("hides the Prime Ally button off-desktop (web has no Sim Con folder to write to)", () => {
    render(
      <ContextsPane
        items={[]}
        selectedId={null}
        onSelect={noop}
        onOpen={noop}
        onNew={noop}
        onEdit={noop}
        onDelete={noop}
        onAttach={noop}
        onGenerate={noop}
        generatingId={null}
      />,
    );
    // jsdom has no __TAURI__ global -> isDesktop is false -> button absent.
    expect(screen.queryByRole("button", { name: "Prime Ally" })).toBeNull();
  });

  it("keeps Open + Generate inline and tucks Edit/Delete behind the ⋮ menu", () => {
    const onEdit = vi.fn();
    const onDelete = vi.fn();
    render(
      <ContextsPane
        items={[summary({ has_key_terms: true })]}
        selectedId={null}
        onSelect={noop}
        onOpen={noop}
        onNew={noop}
        onEdit={onEdit}
        onDelete={onDelete}
        onAttach={noop}
        onGenerate={noop}
        generatingId={null}
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
    render(
      <ContextsPane
        items={[summary({ status: "ready", has_key_terms: true })]}
        selectedId={null}
        onSelect={noop}
        onOpen={noop}
        onNew={noop}
        onEdit={noop}
        onDelete={noop}
        onAttach={noop}
        onGenerate={noop}
        generatingId={null}
      />,
    );
    expect(screen.queryByText(/at least one grounding source/i)).toBeNull();
  });
});

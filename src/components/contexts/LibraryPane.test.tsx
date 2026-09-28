import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LibraryPane } from "@/components/contexts/LibraryPane";
import { BackendProvider } from "@/lib/backend";
import type { ConvaBackend } from "@/lib/backend/ConvaBackend";
import type { RagDocument } from "@/lib/ipc";
import { useConversationStore } from "@/state/conversation";

afterEach(cleanup);

function doc(overrides: Partial<RagDocument> = {}): RagDocument {
  return {
    id: "d1",
    file_name: "resume.pdf",
    enabled: true,
    chunk_count: 2,
    ingested_at_unix_ms: 0,
    source: "file",
    context_ids: [],
    size_bytes: 1000,
    ...overrides,
  };
}

const noop = () => undefined;

function fakeBackend(
  docs: RagDocument[],
  overrides: Partial<{
    capabilities: unknown;
    partnerOpen: ReturnType<typeof vi.fn>;
    deleteDoc: ReturnType<typeof vi.fn>;
    attachContext: ReturnType<typeof vi.fn>;
    detachContext: ReturnType<typeof vi.fn>;
  }> = {},
): ConvaBackend {
  return {
    rag: {
      list: vi.fn().mockResolvedValue(docs),
      setEnabled: vi.fn().mockResolvedValue(undefined),
      delete: overrides.deleteDoc ?? vi.fn().mockResolvedValue(undefined),
      attachContext: overrides.attachContext ?? vi.fn().mockResolvedValue(undefined),
      detachContext: overrides.detachContext ?? vi.fn().mockResolvedValue(undefined),
    },
    partner: {
      open: overrides.partnerOpen ?? vi.fn().mockResolvedValue(undefined),
    },
    capabilities: vi.fn().mockResolvedValue(overrides.capabilities ?? null),
  } as unknown as ConvaBackend;
}

function renderPane(
  docs: RagDocument[],
  props: Partial<Parameters<typeof LibraryPane>[0]> = {},
  backendOverrides: Parameters<typeof fakeBackend>[1] = {},
) {
  return render(
    <BackendProvider backend={fakeBackend(docs, backendOverrides)}>
      <LibraryPane contextTitles={{}} onAttach={noop} {...props} />
    </BackendProvider>,
  );
}

describe("LibraryPane row", () => {
  it("labels an image as a visual asset and disables the misleading retrieval toggle", async () => {
    renderPane([doc({ file_name: "scene.png", enabled: false, chunk_count: 0 })]);
    await screen.findByText("scene.png");
    expect(
      screen.getByRole("checkbox", { name: /scene\.png is a visual asset and is not text-searchable/i }),
    ).toBeDisabled();
  });

  it("disables retrieval for a generated review-only resource", async () => {
    renderPane([
      doc({
        file_name: "Nolan Wells — Research findings.txt",
        source: "generated",
        enabled: false,
        searchable: false,
      }),
    ]);
    await screen.findByText("Nolan Wells — Research findings.txt");
    expect(
      screen.getByRole("checkbox", { name: /review-only resource/i }),
    ).toBeDisabled();
  });

  it("shows checkbox, source icon, and name — no drag-handle icon or generated-by badge", async () => {
    renderPane([doc({ source: "generated" })]);
    await screen.findByText("resume.pdf");
    expect(screen.getByRole("checkbox", { name: /include resume\.pdf in retrieval/i })).toBeInTheDocument();
    expect(screen.queryByText("conva")).toBeNull();
  });

  it("shows a context icon with a hover title naming the attached context(s), only when attached", async () => {
    renderPane([doc({ context_ids: ["c1"] })], { contextTitles: { c1: "Acme interview" } });
    await screen.findByText("resume.pdf");
    expect(screen.getByTitle("Acme interview")).toBeInTheDocument();

    cleanup();
    renderPane([doc({ context_ids: [] })]);
    await screen.findByText("resume.pdf");
    expect(screen.queryByTitle("Acme interview")).toBeNull();
  });

  it("focusContextId filters to that context's documents, with a clearable banner", async () => {
    const onClearFocus = vi.fn();
    renderPane(
      [
        doc({ id: "d1", file_name: "resume.pdf", context_ids: ["c1"] }),
        doc({ id: "d2", file_name: "cover-letter.pdf", context_ids: [] }),
      ],
      { contextTitles: { c1: "Acme interview" }, focusContextId: "c1", onClearFocus },
    );
    await screen.findByText("resume.pdf");
    expect(screen.queryByText("cover-letter.pdf")).toBeNull();
    expect(screen.getByText("Acme interview")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /clear filter/i }));
    expect(onClearFocus).toHaveBeenCalled();
  });

  it("the overflow menu shows only Delete when nothing else applies (no contexts, no partner window, no open conversation)", async () => {
    renderPane([doc()]);
    await screen.findByText("resume.pdf");
    fireEvent.click(screen.getByRole("button", { name: /more actions for resume\.pdf/i }));
    expect(screen.getByRole("menuitem", { name: /delete/i })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /attach to a context/i })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: /^view$/i })).toBeNull();
  });
});

describe("LibraryPane linkedContextId (owner bug report, 2026-09-22)", () => {
  it("lists documents already attached to the open context first (newest first), everything else below (also newest first)", async () => {
    renderPane(
      [
        doc({ id: "d1", file_name: "old-attached.pdf", context_ids: ["c1"], ingested_at_unix_ms: 100 }),
        doc({ id: "d2", file_name: "unattached-new.pdf", context_ids: [], ingested_at_unix_ms: 300 }),
        doc({ id: "d3", file_name: "new-attached.pdf", context_ids: ["c1"], ingested_at_unix_ms: 200 }),
        doc({ id: "d4", file_name: "unattached-old.pdf", context_ids: [], ingested_at_unix_ms: 50 }),
      ],
      { linkedContextId: "c1" },
    );
    await screen.findByText("old-attached.pdf");
    expect(screen.getByText("In this context")).toBeInTheDocument();
    expect(screen.getByText("Other documents")).toBeInTheDocument();

    const names = screen.getAllByRole("listitem").map((li) => li.textContent);
    // Linked group first, newest-attached before oldest-attached; then the
    // rest, also newest first.
    expect(names.findIndex((t) => t?.includes("new-attached.pdf"))).toBeLessThan(
      names.findIndex((t) => t?.includes("old-attached.pdf")),
    );
    expect(names.findIndex((t) => t?.includes("old-attached.pdf"))).toBeLessThan(
      names.findIndex((t) => t?.includes("unattached-new.pdf")),
    );
    expect(names.findIndex((t) => t?.includes("unattached-new.pdf"))).toBeLessThan(
      names.findIndex((t) => t?.includes("unattached-old.pdf")),
    );
  });

  it("checkbox reflects and toggles attachment to the open context, not the retrieval-enabled flag", async () => {
    const attachContext = vi.fn().mockResolvedValue(undefined);
    const detachContext = vi.fn().mockResolvedValue(undefined);
    renderPane(
      [
        doc({ id: "d1", file_name: "attached.pdf", context_ids: ["c1"], enabled: false }),
        doc({ id: "d2", file_name: "unattached.pdf", context_ids: [], enabled: true }),
      ],
      { linkedContextId: "c1" },
      { attachContext, detachContext },
    );
    await screen.findByText("attached.pdf");

    // Already attached (even though globally "disabled") shows checked.
    const attachedBox = screen.getByRole("checkbox", { name: /remove attached\.pdf from/i });
    expect(attachedBox).toBeChecked();
    fireEvent.click(attachedBox);
    expect(detachContext).toHaveBeenCalledWith("d1", "c1");

    // Not attached (even though globally "enabled") shows unchecked.
    const unattachedBox = screen.getByRole("checkbox", { name: /add unattached\.pdf to/i });
    expect(unattachedBox).not.toBeChecked();
    fireEvent.click(unattachedBox);
    expect(attachContext).toHaveBeenCalledWith("d2", "c1");
  });

  it("never hides a document in linked mode — an image or review-only doc can still be attached", async () => {
    renderPane(
      [doc({ id: "d1", file_name: "scene.png", enabled: false, chunk_count: 0, context_ids: [] })],
      { linkedContextId: "c1" },
    );
    await screen.findByText("scene.png");
    expect(screen.getByRole("checkbox", { name: /add scene\.png to/i })).toBeEnabled();
  });

  it("blocks attaching a second résumé to the same context and names the one already there", async () => {
    const attachContext = vi.fn().mockResolvedValue(undefined);
    renderPane(
      [
        doc({ id: "d1", file_name: "old-resume.pdf", context_ids: ["c1"] }),
        doc({ id: "d2", file_name: "new-resume.pdf", context_ids: [] }),
      ],
      { linkedContextId: "c1" },
      { attachContext },
    );
    await screen.findByText("new-resume.pdf");
    fireEvent.click(screen.getByRole("checkbox", { name: /add new-resume\.pdf to/i }));

    expect(attachContext).not.toHaveBeenCalled();
    expect(
      await screen.findByText(/only one résumé\/cv document per context — remove "old-resume\.pdf" first/i),
    ).toBeInTheDocument();
  });

  it("does not block a second document with no recognized role", async () => {
    const attachContext = vi.fn().mockResolvedValue(undefined);
    renderPane(
      [
        doc({ id: "d1", file_name: "meeting-notes.txt", context_ids: ["c1"] }),
        doc({ id: "d2", file_name: "more-notes.txt", context_ids: [] }),
      ],
      { linkedContextId: "c1" },
      { attachContext },
    );
    await screen.findByText("more-notes.txt");
    fireEvent.click(screen.getByRole("checkbox", { name: /add more-notes\.txt to/i }));
    expect(attachContext).toHaveBeenCalledWith("d2", "c1");
  });
});

describe("LibraryRowMenu", () => {
  it("Attach to a context… opens the context picker, which calls onAttach and closes", async () => {
    const onAttach = vi.fn();
    renderPane([doc()], { contextTitles: { c1: "Acme interview" }, onAttach });
    await screen.findByText("resume.pdf");

    fireEvent.click(screen.getByRole("button", { name: /more actions for resume\.pdf/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /attach to a context/i }));
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: /acme interview/i }));

    expect(onAttach).toHaveBeenCalledWith("d1", "c1");
    expect(screen.queryByRole("menuitemcheckbox")).toBeNull();
  });

  it("shows View only when the partner-window capability resolves true, and calls backend.partner.open", async () => {
    const partnerOpen = vi.fn().mockResolvedValue(undefined);
    renderPane([doc()], {}, { capabilities: { system: { partnerWindow: true } }, partnerOpen });
    await screen.findByText("resume.pdf");

    fireEvent.click(await screen.findByRole("button", { name: /more actions for resume\.pdf/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /^view$/i }));
    expect(partnerOpen).toHaveBeenCalledWith("resume.pdf", null, null, null, [], "d1");
  });

  it("Delete is always present and calls backend.rag.delete for this document", async () => {
    const deleteDoc = vi.fn().mockResolvedValue(undefined);
    renderPane([doc()], {}, { deleteDoc });
    await screen.findByText("resume.pdf");

    fireEvent.click(screen.getByRole("button", { name: /more actions for resume\.pdf/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /delete/i }));
    expect(deleteDoc).toHaveBeenCalledWith("d1");
  });

  it("shows Link to the open conversation, toggling on click", async () => {
    useConversationStore.setState({ openId: "conv1", title: "Weekly sync", linkedDocs: [] });
    try {
      renderPane([doc()]);
      await screen.findByText("resume.pdf");

      fireEvent.click(screen.getByRole("button", { name: /more actions for resume\.pdf/i }));
      expect(
        screen.getByRole("menuitem", { name: /link to "weekly sync"/i }),
      ).toBeInTheDocument();
    } finally {
      useConversationStore.setState({ openId: null, title: null, linkedDocs: [] });
    }
  });
});

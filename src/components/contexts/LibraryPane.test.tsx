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
    setEnabled: ReturnType<typeof vi.fn>;
  }> = {},
): ConvaBackend {
  return {
    rag: {
      list: vi.fn().mockResolvedValue(docs),
      setEnabled: overrides.setEnabled ?? vi.fn().mockResolvedValue(undefined),
      delete: overrides.deleteDoc ?? vi.fn().mockResolvedValue(undefined),
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
  it("shows no selected documents by default, regardless of the global retrieval flag", async () => {
    renderPane([
      doc({ id: "d1", file_name: "enabled.pdf", enabled: true }),
      doc({ id: "d2", file_name: "disabled.pdf", enabled: false }),
    ]);
    await screen.findByText("enabled.pdf");
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.getByText(/select a context to add or remove documents/i)).toBeInTheDocument();
  });

  it("keeps global retrieval as an explicit top-level Library action, not a selection checkbox", async () => {
    const setEnabled = vi.fn().mockResolvedValue(undefined);
    renderPane([doc({ enabled: true })], { variant: "page" }, { setEnabled });
    await screen.findByText("resume.pdf");
    expect(screen.queryByRole("checkbox")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /more actions for resume\.pdf/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /exclude from general retrieval/i }));
    expect(setEnabled).toHaveBeenCalledWith("d1", false);
  });

  it("does not offer general retrieval for an image or review-only resource", async () => {
    renderPane(
      [
        doc({ id: "image", file_name: "scene.png", enabled: false, chunk_count: 0 }),
        doc({
          id: "review",
          file_name: "Nolan Wells — Research findings.txt",
          source: "generated",
          enabled: false,
          searchable: false,
        }),
      ],
      { variant: "page" },
    );
    await screen.findByText("scene.png");
    fireEvent.click(screen.getByRole("button", { name: /more actions for scene\.png/i }));
    expect(screen.queryByRole("menuitem", { name: /general retrieval/i })).toBeNull();
    fireEvent.click(document.body);
    fireEvent.click(screen.getByRole("button", { name: /more actions for nolan wells/i }));
    expect(screen.queryByRole("menuitem", { name: /general retrieval/i })).toBeNull();
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

  it("selectedContextId groups attached documents first and uses one checkbox only for attachment", async () => {
    const onAttach = vi.fn();
    const onDetach = vi.fn();
    renderPane(
      [
        doc({ id: "d1", file_name: "cover-letter.pdf", context_ids: [], enabled: true }),
        doc({ id: "d2", file_name: "resume.pdf", context_ids: ["c1"], enabled: false }),
      ],
      { contextTitles: { c1: "Acme interview" }, selectedContextId: "c1", onAttach, onDetach },
    );
    await screen.findByText("resume.pdf");
    expect(screen.getByText("In this context · 1")).toBeInTheDocument();
    expect(screen.getByText("Other documents")).toBeInTheDocument();
    expect(screen.getByText("cover-letter.pdf")).toBeInTheDocument();
    const rows = screen.getAllByRole("listitem").map((li) => li.textContent ?? "");
    expect(rows[0]).toContain("resume.pdf");
    expect(rows[1]).toContain("cover-letter.pdf");
    expect(screen.getByText("Acme interview")).toBeInTheDocument();
    expect(screen.getAllByRole("checkbox")).toHaveLength(2);

    const checked = screen.getByRole("checkbox", { name: /remove resume\.pdf from acme interview/i });
    expect(checked).toBeChecked();
    fireEvent.click(checked);
    expect(onDetach).toHaveBeenCalledWith("d2", "c1");

    const unchecked = screen.getByRole("checkbox", { name: /add cover-letter\.pdf to acme interview/i });
    expect(unchecked).not.toBeChecked();
    fireEvent.click(unchecked);
    expect(onAttach).toHaveBeenCalledWith("d1", "c1");
  });

  it("allows visual assets to be attached to the selected context", async () => {
    const onAttach = vi.fn();
    renderPane(
      [doc({ file_name: "scene.png", enabled: false, chunk_count: 0 })],
      { contextTitles: { c1: "Acme interview" }, selectedContextId: "c1", onAttach },
    );
    await screen.findByText("scene.png");
    const checkbox = screen.getByRole("checkbox", { name: /add scene\.png to acme interview/i });
    expect(checkbox).toBeEnabled();
    fireEvent.click(checkbox);
    expect(onAttach).toHaveBeenCalledWith("d1", "c1");
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

describe("LibraryPane onDocumentsChange (#393)", () => {
  it("reports the fresh list after the initial load and after a refresh", async () => {
    const onDocumentsChange = vi.fn();
    const backend = fakeBackend([doc({ id: "d1", file_name: "a.pdf" })]);
    const view = render(
      <BackendProvider backend={backend}>
        <LibraryPane contextTitles={{}} onAttach={noop} onDocumentsChange={onDocumentsChange} />
      </BackendProvider>,
    );
    await screen.findByText("a.pdf");
    expect(onDocumentsChange).toHaveBeenLastCalledWith([expect.objectContaining({ id: "d1" })]);

    vi.mocked(backend.rag.list).mockResolvedValue([
      doc({ id: "d1", file_name: "a.pdf" }),
      doc({ id: "d2", file_name: "b.pdf" }),
    ]);
    view.rerender(
      <BackendProvider backend={backend}>
        <LibraryPane
          contextTitles={{}}
          onAttach={noop}
          onDocumentsChange={onDocumentsChange}
          refreshToken={1}
        />
      </BackendProvider>,
    );
    await screen.findByText("b.pdf");
    expect(onDocumentsChange).toHaveBeenLastCalledWith([
      expect.objectContaining({ id: "d1" }),
      expect.objectContaining({ id: "d2" }),
    ]);
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

  describe("menu placement near the bottom of the window (#394)", () => {
    const openMenuAt = async (buttonTop: number, menuHeight: number) => {
      vi.spyOn(window, "innerHeight", "get").mockReturnValue(600);
      vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(menuHeight);
      renderPane([doc()]);
      await screen.findByText("resume.pdf");
      const button = screen.getByRole("button", { name: /more actions for resume\.pdf/i });
      vi.spyOn(button, "getBoundingClientRect").mockReturnValue({
        top: buttonTop,
        bottom: buttonTop + 24,
        left: 300,
        right: 324,
        width: 24,
        height: 24,
        x: 300,
        y: buttonTop,
        toJSON: () => ({}),
      });
      fireEvent.click(button);
      return screen.getByRole("menu");
    };
    afterEach(() => vi.restoreAllMocks());

    it("opens below the button when there is room", async () => {
      const menu = await openMenuAt(100, 120);
      expect(menu.style.top).toBe("128px");
    });

    it("flips above the button when it would run off the bottom", async () => {
      const menu = await openMenuAt(560, 120);
      // button top 560 − 4 gap − 120 tall
      expect(menu.style.top).toBe("436px");
    });

    it("clamps inside the window when it fits neither below nor above", async () => {
      const menu = await openMenuAt(100, 590);
      expect(menu.style.top).toBe("8px");
    });
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

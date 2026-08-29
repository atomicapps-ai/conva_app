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
  }> = {},
): ConvaBackend {
  return {
    rag: {
      list: vi.fn().mockResolvedValue(docs),
      setEnabled: vi.fn().mockResolvedValue(undefined),
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

  it("the overflow menu shows only Delete when nothing else applies (no contexts, no partner window, no open conversation)", async () => {
    renderPane([doc()]);
    await screen.findByText("resume.pdf");
    fireEvent.click(screen.getByRole("button", { name: /more actions for resume\.pdf/i }));
    expect(screen.getByRole("menuitem", { name: /delete/i })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /attach to a context/i })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: /^view$/i })).toBeNull();
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

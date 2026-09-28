import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ArchiveExportDialog } from "@/components/ArchiveExportDialog";
import { ArchiveImportDialog } from "@/components/ArchiveImportDialog";
import { ContextsPane } from "@/components/contexts/ContextsPane";
import { ContextWorkspace } from "@/components/contexts/ContextWorkspace";
import { LibraryPane } from "@/components/contexts/LibraryPane";
import { ContextDetail } from "@/components/context/ContextDetail";
import { ContextSetup } from "@/components/context/ContextSetup";
import { EmptyState, PageView, PrimaryButton } from "@/components/studio/PageView";
import { Icon } from "@/components/ui/Icon";
import { useBackend } from "@/lib/backend";
import type { WebBackend } from "@/lib/backend/web";
import {
  DEFAULT_CONTEXT_ID,
  type ArchiveInspection,
  type ConversationContext,
  type ContextSummary,
} from "@/lib/ipc";
import { isDesktop } from "@/lib/platform";
import { CENTER_MIN_PX, resolveLayout } from "@/lib/responsive";
import { useContextsQuickOpen } from "@/state/contextsQuickOpen";
import { useGroundingStore } from "@/state/grounding";
import { useLibraryQuickAdd } from "@/state/libraryQuickAdd";
import { useUiPrefs } from "@/state/uiPrefs";

type Mode =
  | { k: "list" }
  | { k: "setup"; initial: ConversationContext | null }
  | { k: "detail"; id: string };

/**
 * Contexts — the three-pane workspace (AppUI V5.0 §3).
 *
 * > Context list (220px) · selected-context workspace (flex, min 360px) ·
 * > contextual Library dock (260px), all visible at wide width.
 * > Selecting a row updates B + filters C; **never a third-level page.**
 * > Dock collapses to a right-edge Library tab; reopening restores prior width.
 *
 * Responsive (§10): at wide the dock is Pane C in the flow; below 1024 it
 * becomes an **overlay** over the right portion rather than squeezing the
 * centre — the centre never goes below 360px. The dock's open/closed state is
 * remembered separately from the top-level Library page (`LibraryView`), which
 * is the same documents doing the *manage* job rather than the *attach* one.
 *
 * The persona / start-a-coaching-session drill-in is still `ContextDetail` —
 * a genuine sub-view with `ViewShell`'s breadcrumb + back (CLAUDE.md rule 9),
 * not a third pane level.
 *
 * Quick-add (⌘K's "Add a document…" / "Paste a note…" / "New context…") and
 * quick-open (jump straight to one context) keep working exactly as before —
 * both one-shot intents, consumed once on mount.
 */
export function ContextsView() {
  const backend = useBackend();
  const [items, setItems] = useState<ContextSummary[]>([]);
  const [libraryRefreshToken, setLibraryRefreshToken] = useState(0);
  const [quickAction] = useState(() => useLibraryQuickAdd.getState().consume());
  const [quickOpenId] = useState(() => useContextsQuickOpen.getState().consume());
  const [mode, setMode] = useState<Mode>(
    quickAction === "new_context" ? { k: "setup", initial: null } : { k: "list" },
  );
  /** Single source of truth for both Pane B and Pane C. The Library always
   *  attaches to the same Context whose details are visible in the middle. */
  const [workspaceId, setWorkspaceId] = useState<string | null>(quickOpenId);
  const leftWidthPx = useUiPrefs((s) => s.contextsLeftWidthPx);
  const setLeftWidthPx = useUiPrefs((s) => s.setContextsLeftWidthPx);
  const dockWidthPx = useUiPrefs((s) => s.libraryDockWidthPx);
  const setDockWidthPx = useUiPrefs((s) => s.setLibraryDockWidthPx);
  const [error, setError] = useState<string | null>(null);
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dockOpen, setDockOpen] = useState(true);
  const [importInspecting, setImportInspecting] = useState(false);
  const [importPreview, setImportPreview] = useState<{
    archiveDigest: string;
    operationId: string;
    inspection: ArchiveInspection;
  } | null>(null);
  const [exportTarget, setExportTarget] = useState<{
    kind: "context";
    id: string;
    title: string;
    operationId: string;
    linkedConversationId: string | null;
    linkedTitle: string | null;
  } | null>(null);
  const activeGroundingId = useGroundingStore((s) => s.activeId);
  const setGroundingActive = useGroundingStore((s) => s.setActive);

  // Measure the pane area so the dock can dock/overlay by the real tier.
  const areaRef = useRef<HTMLDivElement>(null);
  const [areaWidth, setAreaWidth] = useState(0);
  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    const ro = new ResizeObserver((es) => {
      const r = es[0];
      if (r) setAreaWidth(r.contentRect.width);
    });
    ro.observe(el);
    setAreaWidth(el.getBoundingClientRect().width);
    return () => ro.disconnect();
  }, [mode.k]);
  // The rail is outside this element, so measure against the pane area alone:
  // list + dock + the 360px centre floor is what actually has to fit.
  const canDock = areaWidth === 0 || areaWidth - leftWidthPx - dockWidthPx >= CENTER_MIN_PX;
  const tier = resolveLayout(areaWidth || 960).tier;
  const dockInFlow = canDock && dockOpen;

  // When the window narrows past the point where the dock still fits beside
  // the 520px centre, collapse it to its right-edge tab instead of throwing an
  // overlay across the workspace the user is reading. Reopening is one click,
  // and an explicit reopen sticks until the width changes again.
  const wasDockable = useRef(canDock);
  useEffect(() => {
    if (wasDockable.current && !canDock) setDockOpen(false);
    wasDockable.current = canDock;
  }, [canDock]);

  const contextTitles = useMemo(
    () => Object.fromEntries(items.map((s) => [s.id, s.title])),
    [items],
  );

  const refresh = useCallback(() => {
    backend.context
      .list()
      .then((list) => {
        // Pin the always-present default to the top regardless of recency.
        const sorted = [...list].sort((a, b) =>
          a.id === DEFAULT_CONTEXT_ID ? -1 : b.id === DEFAULT_CONTEXT_ID ? 1 : 0,
        );
        setItems(sorted);
        setError(null);
        // Open something useful in Pane B: the grounding context if it's a
        // real one, else the first user context. Never auto-select the
        // always-present default — an empty workspace is more honest than
        // pretending "General conversation" is prepared material.
        setWorkspaceId((cur) => {
          if (cur && sorted.some((c) => c.id === cur)) return cur;
          const grounded = sorted.find(
            (c) => c.id === activeGroundingId && c.id !== DEFAULT_CONTEXT_ID,
          );
          return grounded?.id ?? sorted.find((c) => c.id !== DEFAULT_CONTEXT_ID)?.id ?? null;
        });
      })
      .catch(() => setError("Contexts run on the desktop app for now."));
  }, [backend, activeGroundingId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const edit = async (id: string) => {
    try {
      setMode({ k: "setup", initial: await backend.context.load(id) });
    } catch {
      setError("Couldn't open that context.");
    }
  };

  const remove = async (id: string) => {
    try {
      await backend.context.delete(id);
      if (workspaceId === id) setWorkspaceId(null);
      refresh();
    } catch {
      /* best-effort; the list refresh reflects the real state */
    }
  };

  const backToList = () => {
    setMode({ k: "list" });
    refresh();
  };

  const generate = useCallback(
    async (id: string) => {
      setGeneratingId(id);
      setError(null);
      try {
        await backend.context.prepare(id);
        await backend.context.generateDossier(id);
      } catch (e) {
        setError(String(e));
      } finally {
        setGeneratingId(null);
        setLibraryRefreshToken((t) => t + 1);
        refresh();
      }
    },
    [backend, refresh],
  );

  // `.cva` portable archive (Checkpoints B/C). Desktop's `exportArchive`
  // opens the native save dialog itself (see `tauri.ts`) — a rejection
  // whose message names that cancellation is the user closing the dialog,
  // not a real failure, so it's swallowed rather than surfaced as an error
  // (`ArchiveExportDialog` itself treats it as a plain cancel).
  //
  // Finds the newest conversation linked back to this Context (if any) so
  // the export picker can offer bundling it in — a Context has no reverse
  // pointer of its own, so this is the one place that needs a fresh
  // `conversations.list()` rather than reading state already on screen.
  const exportContextArchive = async (id: string) => {
    const linked = await backend.conversations
      .list()
      .then((rows) =>
        rows
          .filter((r) => r.linked_context_id === id)
          .sort((a, b) => b.updated_at_unix_ms - a.updated_at_unix_ms)[0],
      )
      .catch(() => undefined);
    setExportTarget({
      kind: "context",
      id,
      title: contextTitles[id] ?? "Context",
      operationId: `archive-export-${Date.now()}`,
      linkedConversationId: linked?.id ?? null,
      linkedTitle: linked?.title ?? null,
    });
  };

  // Selecting a file only previews it (`inspectArchive` is side-effect-free)
  // — nothing is persisted until the owner confirms in `ArchiveImportDialog`
  // and the subsequent `importArchive` call. That dialog replaces a bare
  // `window.confirm()` (owner bug report, 2026-09-22): a WebView2 JS dialog
  // can render without stealing focus, so the import silently stalled with
  // no visible prompt and nothing persisted. `inspectArchive` itself has no
  // progress events (a single blocking read/validate), so the brief
  // "Reading archive…" state below is the only feedback available for that
  // step; the dialog picks up real progress once `importArchive` starts.
  // Shared by both platforms — desktop's `archiveDigest` is a file path,
  // web's is a `registerLocalArchiveFile`/`prepareLocalFile` content digest,
  // but `inspectArchive`/`importArchive` themselves take that string
  // opaquely either way (`ConvaBackend.ts`).
  const runImportFlow = async (archiveDigest: string) => {
    const operationId = `archive-import-${Date.now()}`;
    setImportInspecting(true);
    setNotice("Reading archive…");
    try {
      const inspection = await backend.archive.inspectArchive(archiveDigest, operationId);
      setNotice(null);
      setImportPreview({ archiveDigest, operationId, inspection });
    } catch (e) {
      setNotice(`Couldn't import: ${String(e)}`);
    } finally {
      setImportInspecting(false);
    }
  };

  // Desktop picks its own source path via a native dialog; web has no file
  // system, so `onImport` (below) clicks a hidden `<input type="file">`
  // instead (`importFileInputRef`) and `onImportFileSelected` registers the
  // picked bytes (`prepareLocalFile` — web-only, not part of the shared
  // `ConvaBackend` contract, same reasoning as desktop's dialog living only
  // in `tauri.ts`) before running the same `runImportFlow` both platforms
  // share.
  const importContextArchiveDesktop = async () => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const picked = await open({
      multiple: false,
      filters: [{ name: "conva archive", extensions: ["cva"] }],
    });
    if (!picked || Array.isArray(picked)) return;
    await runImportFlow(picked);
  };
  const importFileInputRef = useRef<HTMLInputElement>(null);
  const importContextArchive = () => {
    if (isDesktop) {
      void importContextArchiveDesktop();
    } else {
      importFileInputRef.current?.click();
    }
  };
  const onImportFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file next time
    if (!file) return;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const digest = await (backend as WebBackend).archive.prepareLocalFile(bytes);
      await runImportFlow(digest);
    } catch (err) {
      setNotice(`Couldn't import: ${String(err)}`);
    }
  };

  const activate = async (id: string) => {
    try {
      const ctx = await backend.context.activateContext(id);
      setGroundingActive(ctx.id, ctx.title);
      setNotice(`"${ctx.title}" will ground the next session.`);
    } catch (e) {
      setNotice(String(e));
    }
  };

  // Attach and detach both change a context's doc count AND Library's own
  // per-row context tags, so both refreshes fire.
  const bumpDocs = () => {
    setLibraryRefreshToken((t) => t + 1);
    refresh();
  };

  const attach = async (docId: string, contextId: string) => {
    try {
      await backend.rag.attachContext(docId, contextId);
      setNotice(`Attached to "${contextTitles[contextId] ?? "context"}".`);
      bumpDocs();
    } catch (e) {
      setNotice(String(e));
    }
  };

  const detach = async (docId: string, contextId: string) => {
    try {
      await backend.rag.detachContext(docId, contextId);
      setNotice(`Removed from "${contextTitles[contextId] ?? "context"}".`);
      bumpDocs();
    } catch (e) {
      setNotice(String(e));
    }
  };

  if (mode.k === "setup") {
    return (
      <ContextSetup
        initial={mode.initial ?? undefined}
        onDone={(id) => {
          // Auto-activate a freshly CREATED context (owner: "if I create a
          // context and go to live session, automatically select it as the
          // default context for the next live session") — editing an
          // existing context leaves the current grounding choice alone.
          const wasCreating = mode.initial == null;
          backToList();
          if (wasCreating) void activate(id);
        }}
        onCancel={() => setMode({ k: "list" })}
      />
    );
  }

  if (mode.k === "detail") {
    return (
      <ContextDetail
        id={mode.id}
        onEdit={() => void edit(mode.id)}
        onBack={backToList}
      />
    );
  }

  const workspace = workspaceId ? items.find((c) => c.id === workspaceId) : undefined;
  const userContextCount = items.filter((c) => c.id !== DEFAULT_CONTEXT_ID).length;

  return (
    <PageView
      fill
      bleed
      title="Contexts"
      subtitle="Ground Ally in your library, by conversation type — then generate its briefing."
      actions={
        <>
          {notice && <p className="text-[11px] text-fg-faint">{notice}</p>}
          <PrimaryButton onClick={() => setMode({ k: "setup", initial: null })}>
            <Icon name="add" size={15} />
            New context
          </PrimaryButton>
        </>
      }
    >
      {error ? (
        <p className="px-8 text-sm text-fg-muted">{error}</p>
      ) : (
        // Panes run edge to edge and are separated by their own borders, not
        // by gaps — §3's grid is `list | workspace | dock` with no gutter, and
        // the gutter is exactly what would push the centre under its 360 floor.
        <div ref={areaRef} className="relative flex min-h-0 flex-1 border-t border-border">
          {/* Pane A — the context list, at its default 220px (§3; resizable
              190–280 via the pane's own drag handle). It must carry the width
              itself: the flex row would otherwise size it from its content
              and push the centre pane under its 360px floor. */}
          <div
            className="flex min-h-0 shrink-0 flex-col border-r border-border"
            style={{ width: leftWidthPx }}
          >
          <ContextsPane
            items={items}
            selectedId={workspaceId}
            onSelect={setWorkspaceId}
            onOpen={(id) => setWorkspaceId(id)}
            onNew={() => setMode({ k: "setup", initial: null })}
            onEdit={(id) => void edit(id)}
            onDelete={(id) => void remove(id)}
            onGenerate={(id) => void generate(id)}
            onExport={(id) => void exportContextArchive(id)}
            onImport={importContextArchive}
            importBusy={importInspecting}
            onAttach={(contextId, docId) => void attach(docId, contextId)}
            generatingId={generatingId}
            refreshToken={libraryRefreshToken}
            widthPx={leftWidthPx}
            onResize={setLeftWidthPx}
          />
          </div>

          {/* Pane B — the selected context's workspace. */}
          <div
            className="flex min-h-0 min-w-0 flex-1 flex-col bg-bg"
            style={{ minWidth: tier === "compact" || tier === "tiny" ? undefined : CENTER_MIN_PX }}
          >
            {workspace ? (
              <ContextWorkspace
                summary={workspace}
                generating={generatingId === workspace.id}
                onGenerate={() => void generate(workspace.id)}
                onOpenDetail={() => setMode({ k: "detail", id: workspace.id })}
                onEdit={() => void edit(workspace.id)}
                onActivate={() => void activate(workspace.id)}
                isActive={activeGroundingId === workspace.id}
                refreshToken={libraryRefreshToken}
              />
            ) : (
              <div className="flex min-h-0 flex-1 items-center justify-center p-8">
                <EmptyState
                  className="max-w-[46ch]"
                  title={userContextCount === 0 ? "No contexts yet" : "Select a context"}
                  description={
                    userContextCount === 0
                      ? "Create one to prepare for a conversation — attach the documents Ally should answer from, then generate its briefing."
                      : "Pick a context on the left to see its overview, prepared Q&A, briefing and research."
                  }
                  action={
                    userContextCount === 0 ? (
                      <PrimaryButton onClick={() => setMode({ k: "setup", initial: null })}>
                        Create context
                      </PrimaryButton>
                    ) : undefined
                  }
                />
              </div>
            )}
          </div>

          {/* Pane C — the contextual Library dock, at its default 260px
              (resizable 230–320 via the pane's own left-edge drag handle,
              mirroring Pane A's). In the flow when it fits, an overlay over
              the right portion when it doesn't (§10). */}
          {dockInFlow ? (
            <div
              className="relative flex min-h-0 shrink-0 flex-col border-l border-border bg-bg-2 px-3 py-3"
              style={{ width: dockWidthPx }}
            >
              {/* Left-edge width handle — dragging left widens the dock. */}
              <div
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize Library dock"
                onPointerDown={(e) => {
                  const startX = e.clientX;
                  const startW = dockWidthPx;
                  const move = (ev: PointerEvent) =>
                    setDockWidthPx(startW - (ev.clientX - startX));
                  const up = () => {
                    window.removeEventListener("pointermove", move);
                    window.removeEventListener("pointerup", up);
                  };
                  window.addEventListener("pointermove", move);
                  window.addEventListener("pointerup", up);
                }}
                className="absolute inset-y-0 left-0 z-30 hidden w-[5px] cursor-col-resize hover:bg-panel-raised sm:block"
              />
              <DockHeader onClose={() => setDockOpen(false)} />
              <LibraryPane
                contextTitles={contextTitles}
                onAttach={(docId, contextId) => void attach(docId, contextId)}
                onDetach={(docId, contextId) => void detach(docId, contextId)}
                refreshToken={libraryRefreshToken}
                quickAction={quickAction === "upload" || quickAction === "paste" ? quickAction : null}
                selectedContextId={workspaceId}
              />
            </div>
          ) : dockOpen ? (
            <>
              <button
                type="button"
                aria-label="Close Library"
                onClick={() => setDockOpen(false)}
                className="absolute inset-0 z-30 cursor-default bg-black/40"
              />
              <div
                className="absolute inset-y-0 right-0 z-40 flex max-w-full flex-col border-l border-border-strong bg-bg-2 px-3 py-3 shadow-[var(--shadow-lg)]"
                style={{ width: dockWidthPx }}
              >
                <DockHeader onClose={() => setDockOpen(false)} />
                <LibraryPane
                  contextTitles={contextTitles}
                  onAttach={(docId, contextId) => void attach(docId, contextId)}
                  onDetach={(docId, contextId) => void detach(docId, contextId)}
                  refreshToken={libraryRefreshToken}
                  quickAction={
                    quickAction === "upload" || quickAction === "paste" ? quickAction : null
                  }
                  selectedContextId={workspaceId}
                />
              </div>
            </>
          ) : (
            /* Collapsed → a right-edge Library tab; reopening restores it. */
            <button
              type="button"
              onClick={() => setDockOpen(true)}
              title="Show Library"
              aria-label="Show Library"
              aria-expanded={false}
              className="flex w-9 shrink-0 items-center justify-center border-l border-border bg-bg-2 text-fg-muted transition hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              <span className="rotate-180 font-mono text-[10px] font-semibold uppercase tracking-[0.2em] [writing-mode:vertical-rl]">
                Library
              </span>
            </button>
          )}
        </div>
      )}
      {/* Hidden file picker behind the Import button's web path
          (Checkpoint E's import slice) — see importContextArchive above.
          Always mounted so the ref is stable; only ever clicked on web
          (`isDesktop` picks the native dialog instead). */}
      <input
        ref={importFileInputRef}
        type="file"
        accept=".cva"
        className="hidden"
        onChange={(e) => void onImportFileSelected(e)}
      />
      {importPreview && (
        <ArchiveImportDialog
          inspection={importPreview.inspection}
          operationId={importPreview.operationId}
          onCancel={() => setImportPreview(null)}
          onImport={(options) =>
            backend.archive.importArchive(
              importPreview.archiveDigest,
              options,
              importPreview.operationId,
            )
          }
          onImported={(result) => {
            setImportPreview(null);
            refresh();
            if (result.context_id) setWorkspaceId(result.context_id);
            const omitted = result.omitted_documents.length;
            setNotice(
              `Imported "${importPreview.inspection.title}".${omitted ? ` ${omitted} document(s) omitted — see the console for why.` : ""}`,
            );
            if (omitted) {
              // eslint-disable-next-line no-console -- best-effort detail, not worth a second dialog
              console.info("[cva import] omitted documents:", result.omitted_documents);
            }
          }}
          onError={(message) => {
            setImportPreview(null);
            setNotice(`Couldn't import: ${message}`);
          }}
        />
      )}
      {exportTarget && (
        <ArchiveExportDialog
          title={exportTarget.title}
          linkedItem={
            exportTarget.linkedConversationId && exportTarget.linkedTitle
              ? { kind: "conversation", title: exportTarget.linkedTitle }
              : null
          }
          operationId={exportTarget.operationId}
          onCancel={() => setExportTarget(null)}
          onExport={({ includeLinked, includeSourceDocuments }) =>
            backend.archive.exportArchive(
              includeLinked && exportTarget.linkedConversationId
                ? {
                    kind: "conversation",
                    conversation_id: exportTarget.linkedConversationId,
                    include_context: true,
                  }
                : { kind: "context", context_id: exportTarget.id },
              { include_source_documents: includeSourceDocuments },
              exportTarget.operationId,
            )
          }
          onExported={(result) => {
            setExportTarget(null);
            setNotice(`Exported to ${result.destination}.`);
          }}
          onError={(message) => {
            setExportTarget(null);
            setNotice(`Couldn't export: ${message}`);
          }}
        />
      )}
    </PageView>
  );
}

/** The dock's collapse control. No title — `LibraryPane` carries its own
 *  "LIBRARY" header, and two would read as two panels. */
function DockHeader({ onClose }: { onClose: () => void }) {
  return (
    <div className="mb-1 flex shrink-0 items-center justify-end">
      <button
        type="button"
        onClick={onClose}
        title="Hide Library"
        aria-label="Hide Library"
        className="grid h-6 w-6 place-items-center rounded-[5px] text-fg-faint transition hover:bg-panel-raised hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        <Icon name="close" size={13} />
      </button>
    </div>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ContextsPane } from "@/components/contexts/ContextsPane";
import { ContextWorkspace } from "@/components/contexts/ContextWorkspace";
import { LibraryPane } from "@/components/contexts/LibraryPane";
import { ContextDetail } from "@/components/context/ContextDetail";
import { ContextSetup } from "@/components/context/ContextSetup";
import { EmptyState, PageView, PrimaryButton } from "@/components/studio/PageView";
import { Icon } from "@/components/ui/Icon";
import { useBackend } from "@/lib/backend";
import { DEFAULT_CONTEXT_ID, type ConversationContext, type ContextSummary } from "@/lib/ipc";
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
  /** The context Pane B is showing. Selecting a row only changes THIS. */
  const [workspaceId, setWorkspaceId] = useState<string | null>(quickOpenId);
  /** Library's "In this Context" scope — the doc-count control in Pane A. */
  const [focusId, setFocusId] = useState<string | null>(null);
  const leftWidthPx = useUiPrefs((s) => s.contextsLeftWidthPx);
  const setLeftWidthPx = useUiPrefs((s) => s.setContextsLeftWidthPx);
  const dockWidthPx = useUiPrefs((s) => s.libraryDockWidthPx);
  const setDockWidthPx = useUiPrefs((s) => s.setLibraryDockWidthPx);
  const [error, setError] = useState<string | null>(null);
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dockOpen, setDockOpen] = useState(true);
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
      if (focusId === id) setFocusId(null);
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

  if (mode.k === "setup") {
    return (
      <ContextSetup
        initial={mode.initial ?? undefined}
        onDone={backToList}
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
            selectedId={focusId}
            onSelect={(id) => setFocusId((cur) => (cur === id ? null : id))}
            onOpen={(id) => setWorkspaceId(id)}
            onNew={() => setMode({ k: "setup", initial: null })}
            onEdit={(id) => void edit(id)}
            onDelete={(id) => void remove(id)}
            onGenerate={(id) => void generate(id)}
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
                refreshToken={libraryRefreshToken}
                quickAction={quickAction === "upload" || quickAction === "paste" ? quickAction : null}
                focusContextId={focusId}
                onClearFocus={() => setFocusId(null)}
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
                  refreshToken={libraryRefreshToken}
                  quickAction={
                    quickAction === "upload" || quickAction === "paste" ? quickAction : null
                  }
                  focusContextId={focusId}
                  onClearFocus={() => setFocusId(null)}
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

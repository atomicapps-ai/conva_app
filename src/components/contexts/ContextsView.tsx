import { useCallback, useEffect, useMemo, useState } from "react";

import { ContextsPane } from "@/components/contexts/ContextsPane";
import { LibraryPane } from "@/components/contexts/LibraryPane";
import { ContextDetail } from "@/components/context/ContextDetail";
import { ContextSetup } from "@/components/context/ContextSetup";
import { ViewShell } from "@/components/studio/ViewShell";
import { useBackend } from "@/lib/backend";
import { DEFAULT_CONTEXT_ID, type ConversationContext, type ContextSummary } from "@/lib/ipc";
import { useContextsQuickOpen } from "@/state/contextsQuickOpen";
import { useLibraryQuickAdd } from "@/state/libraryQuickAdd";
import { useUiPrefs } from "@/state/uiPrefs";

type Mode =
  | { k: "list" }
  | { k: "setup"; initial: ConversationContext | null }
  | { k: "detail"; id: string };

/**
 * The Conversation Contexts page — Contexts and Library on one screen
 * (owner decision, 2026-08-16, reversing an earlier same-day un-merge):
 * "do not have library separate... make it part of conversation [Contexts]."
 * `LibraryPane` sits alongside `ContextsPane`; attaching a document to a
 * context is still the click-to-pick popover (`AttachMenu`), not
 * drag-and-drop — that call stands regardless of the two panes being back
 * on one screen (see `LibraryPane.tsx`'s doc comment for the full why).
 *
 * Quick-add: ⌘K's "Add a document…" / "Paste a note…" / "New context…"
 * commands (`CommandPalette.tsx`) set an intent in `useLibraryQuickAdd` and
 * navigate here; consumed once on mount below, so a document/paste/context
 * flow is reachable from anywhere in the app, not just once you're already
 * on this screen.
 *
 * Quick-open: Conversations' "Rehearse" tab lists contexts and needs to
 * land directly on one's detail page (personas/rehearse, Step 3/4) rather
 * than the list — `useContextsQuickOpen`, same one-shot pattern, consumed
 * once below alongside `quickAction`.
 */
export function ContextsView() {
  const backend = useBackend();
  const [items, setItems] = useState<ContextSummary[]>([]);
  const [libraryRefreshToken, setLibraryRefreshToken] = useState(0);
  const [quickAction] = useState(() => useLibraryQuickAdd.getState().consume());
  const [quickOpenId] = useState(() => useContextsQuickOpen.getState().consume());
  const [mode, setMode] = useState<Mode>(
    quickOpenId
      ? { k: "detail", id: quickOpenId }
      : quickAction === "new_context"
        ? { k: "setup", initial: null }
        : { k: "list" },
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const leftWidthPx = useUiPrefs((s) => s.contextsLeftWidthPx);
  const setLeftWidthPx = useUiPrefs((s) => s.setContextsLeftWidthPx);
  const [error, setError] = useState<string | null>(null);
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const contextTitles = useMemo(
    () => Object.fromEntries(items.map((s) => [s.id, s.title])),
    [items],
  );

  const refresh = useCallback(() => {
    backend.context
      .list()
      .then((list) => {
        // Pin the always-present default to the top regardless of recency —
        // otherwise it sinks as the user creates newer contexts. Stable sort:
        // everything else keeps the backend's own (updated-at) order.
        setItems(
          [...list].sort((a, b) =>
            a.id === DEFAULT_CONTEXT_ID ? -1 : b.id === DEFAULT_CONTEXT_ID ? 1 : 0,
          ),
        );
        setError(null);
      })
      .catch(() => setError("Contexts run on the desktop app for now."));
  }, [backend]);

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
      if (selectedId === id) setSelectedId(null);
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
        refresh();
      }
    },
    [backend, refresh],
  );

  // Shared by attach and detach — either changes both a context's doc count
  // (needs `refresh()`) and Library's own per-row context tags (needs
  // `libraryRefreshToken` to bump, so LibraryPane re-fetches).
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

  return (
    <ViewShell
      icon="simicon"
      title="Conversation Contexts"
      subtitle="Ground Ally in your library, by conversation type — then generate its briefing."
      wide
      actions={
        error ? null : (
          <p className="text-[11px] text-fg-faint">
            {notice ?? `${items.length} context${items.length === 1 ? "" : "s"}`}
          </p>
        )
      }
    >
      {error && <p className="text-sm text-fg-muted">{error}</p>}

      {!error && (
        <div
          className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[var(--contexts-left-w)_minmax(0,1fr)]"
          style={{ "--contexts-left-w": `${leftWidthPx}px` } as React.CSSProperties}
        >
          <ContextsPane
            items={items}
            selectedId={selectedId}
            onSelect={(id) => setSelectedId((cur) => (cur === id ? null : id))}
            onOpen={(id) => setMode({ k: "detail", id })}
            onNew={() => setMode({ k: "setup", initial: null })}
            onEdit={(id) => void edit(id)}
            onDelete={(id) => void remove(id)}
            onGenerate={(id) => void generate(id)}
            onAttach={(contextId, docId) => void attach(docId, contextId)}
            onDocsChanged={bumpDocs}
            generatingId={generatingId}
            refreshToken={libraryRefreshToken}
            widthPx={leftWidthPx}
            onResize={setLeftWidthPx}
          />
          <LibraryPane
            contextTitles={contextTitles}
            onAttach={(docId, contextId) => void attach(docId, contextId)}
            refreshToken={libraryRefreshToken}
            quickAction={quickAction === "upload" || quickAction === "paste" ? quickAction : null}
          />
        </div>
      )}
    </ViewShell>
  );
}

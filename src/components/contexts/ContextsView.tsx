import { useCallback, useEffect, useMemo, useState } from "react";

import { ContextsPane } from "@/components/contexts/ContextsPane";
import { LibraryPane } from "@/components/contexts/LibraryPane";
import { SimConDetail } from "@/components/simcon/SimConDetail";
import { SimConSetup } from "@/components/simcon/SimConSetup";
import { ViewShell } from "@/components/studio/ViewShell";
import { useBackend } from "@/lib/backend";
import { DEFAULT_CONTEXT_ID, type SimConSession, type SimConSummary } from "@/lib/ipc";

type Mode =
  | { k: "list" }
  | { k: "setup"; initial: SimConSession | null }
  | { k: "detail"; id: string };

/**
 * The unified Conversation Contexts & Library page (design:
 * conva_core/docs/technical/conversation-context-ui.md). Two panes on one
 * screen — contexts on the left, the library on the right — so grounding a
 * context is drag-and-drop, not a modal. Replaces the standalone Sim Con and
 * Library views; both nav routes land here.
 */
export function ContextsView() {
  const backend = useBackend();
  const [items, setItems] = useState<SimConSummary[]>([]);
  const [mode, setMode] = useState<Mode>({ k: "list" });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  const [libraryRefreshToken, setLibraryRefreshToken] = useState(0);

  const refresh = useCallback(() => {
    backend.simcon
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

  const contextTitles = useMemo(
    () => Object.fromEntries(items.map((s) => [s.id, s.title])),
    [items],
  );
  const selected = items.find((s) => s.id === selectedId) ?? null;

  const edit = async (id: string) => {
    try {
      setMode({ k: "setup", initial: await backend.simcon.load(id) });
    } catch {
      setError("Couldn't open that context.");
    }
  };

  const remove = async (id: string) => {
    try {
      await backend.simcon.delete(id);
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

  // Drag- or click-attach a library document to a context: folds the doc id
  // into the context's own source_doc_ids (what the engine actually grounds
  // on) and tags the document (library filter/badge). Kept in sync — see
  // conversation-context-ui.md §2.
  const attach = useCallback(
    async (contextId: string, docId: string) => {
      try {
        const session = await backend.simcon.load(contextId);
        if (!session.source_doc_ids.includes(docId)) {
          await backend.simcon.save({
            ...session,
            source_doc_ids: [...session.source_doc_ids, docId],
          });
        }
        await backend.rag.attachContext(docId, contextId);
        refresh();
        setLibraryRefreshToken((t) => t + 1);
      } catch (e) {
        setError(String(e));
      }
    },
    [backend, refresh],
  );

  const generate = useCallback(
    async (id: string) => {
      setGeneratingId(id);
      setError(null);
      try {
        await backend.simcon.prepare(id);
        await backend.simcon.generateDossier(id);
      } catch (e) {
        setError(String(e));
      } finally {
        setGeneratingId(null);
        refresh();
        setLibraryRefreshToken((t) => t + 1);
      }
    },
    [backend, refresh],
  );

  if (mode.k === "setup") {
    return (
      <SimConSetup
        initial={mode.initial ?? undefined}
        onDone={backToList}
        onCancel={() => setMode({ k: "list" })}
      />
    );
  }

  if (mode.k === "detail") {
    return (
      <SimConDetail
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
            {items.length} context{items.length === 1 ? "" : "s"}
          </p>
        )
      }
    >
      {error && (
        <p className="text-sm text-fg-muted">{error}</p>
      )}

      {!error && (
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[1.3fr_1fr]">
          <ContextsPane
            items={items}
            selectedId={selectedId}
            onSelect={(id) => setSelectedId((cur) => (cur === id ? null : id))}
            onOpen={(id) => setMode({ k: "detail", id })}
            onNew={() => setMode({ k: "setup", initial: null })}
            onEdit={(id) => void edit(id)}
            onDelete={(id) => void remove(id)}
            onAttach={(contextId, docId) => void attach(contextId, docId)}
            onGenerate={(id) => void generate(id)}
            generatingId={generatingId}
          />
          <LibraryPane
            selectedContextId={selectedId}
            selectedContextTitle={selected?.title ?? null}
            contextTitles={contextTitles}
            onAttachToSelected={(docId) => {
              if (selectedId) void attach(selectedId, docId);
            }}
            refreshToken={libraryRefreshToken}
          />
        </div>
      )}
    </ViewShell>
  );
}

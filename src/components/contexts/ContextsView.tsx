import { useCallback, useEffect, useState } from "react";

import { ContextsPane } from "@/components/contexts/ContextsPane";
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
 * The Conversation Contexts page. Un-merged from Library back into its own
 * rail destination (V4.0 `conva_core/brand/UI/AppUI_V4.0` — the reference
 * nav lists them as two separate items; owner decision, 2026-08-16).
 *
 * The un-merge broke drag-and-drop attach (it used to be between the two
 * panes on one screen) — restored on the Library screen instead
 * (`AttachDropRow` in `LibraryView.tsx`), since that's the page with both a
 * drag source (each row) and something to drop onto (a context) in view at
 * once. `ContextsPane`'s own drop targets below are wired to the same real
 * mutation (`backend.rag.attachContext`) for correctness/forward-compat,
 * even though nothing on this screen currently drags — there's no document
 * list here to drag FROM.
 */
export function ContextsView() {
  const backend = useBackend();
  const [items, setItems] = useState<SimConSummary[]>([]);
  const [mode, setMode] = useState<Mode>({ k: "list" });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

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
      }
    },
    [backend, refresh],
  );

  const attach = useCallback(
    async (contextId: string, docId: string) => {
      try {
        await backend.rag.attachContext(docId, contextId);
        setNotice("Attached.");
        refresh();
      } catch (e) {
        setNotice(String(e));
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
            {notice ?? `${items.length} context${items.length === 1 ? "" : "s"}`}
          </p>
        )
      }
    >
      {error && <p className="text-sm text-fg-muted">{error}</p>}

      {!error && (
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
      )}
    </ViewShell>
  );
}

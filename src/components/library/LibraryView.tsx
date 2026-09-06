import { useCallback, useEffect, useMemo, useState } from "react";

import { LibraryPane } from "@/components/contexts/LibraryPane";
import { ErrorState, PageView } from "@/components/studio/PageView";
import { useBackend } from "@/lib/backend";
import type { ContextSummary, RagDocument } from "@/lib/ipc";
import { useLibraryQuickAdd } from "@/state/libraryQuickAdd";

/**
 * Library — a first-class rail destination (AppUI V5.0 §4, owner decision 4).
 *
 * > Full collection surface: search, filters, provenance, attached-context
 * > tags, upload / paste / sync, and bulk actions. **Distinct from the
 * > Contexts dock, which is relationship-focused. Same documents, different
 * > job.**
 *
 * That "same documents, different job" line is why this page composes the
 * SAME `LibraryPane` the Contexts workspace docks, rather than a second
 * implementation of ingest/attach/delete/sync that would drift from it. The
 * page supplies the V5 crown (title, real document count, the ⌘K-style
 * quick-add intents); the pane keeps owning every document action it already
 * had — upload, paste, sync-to-repo, enable/disable, download, attach/detach,
 * open in the Partner viewer, delete.
 *
 * Counts here are measured, never invented (decision 7): the subtitle reads
 * the real `rag.list()` length, and says "No documents yet" instead of "0
 * documents" when the library is empty.
 */
export function LibraryView() {
  const backend = useBackend();
  const [documents, setDocuments] = useState<RagDocument[]>([]);
  const [contexts, setContexts] = useState<ContextSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  // ⌘K's "Add a document…" / "Paste a note…" can now land here as well as on
  // Contexts. Consumed once, exactly like ContextsView does it, so a stale
  // intent can't re-fire the picker on a later visit.
  const [quickAction] = useState(() => {
    const pending = useLibraryQuickAdd.getState().consume();
    return pending === "upload" || pending === "paste" ? pending : null;
  });

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([backend.rag.list(), backend.context.list()])
      .then(([docs, ctx]) => {
        setDocuments(docs);
        setContexts(ctx);
        setError(null);
      })
      .catch(() => setError("The Library runs on the desktop app for now."))
      .finally(() => setLoading(false));
  }, [backend]);

  useEffect(load, [load, refreshToken]);

  const contextTitles = useMemo(
    () => Object.fromEntries(contexts.map((c) => [c.id, c.title])),
    [contexts],
  );

  const attach = async (docId: string, contextId: string) => {
    try {
      await backend.rag.attachContext(docId, contextId);
      setNotice(`Attached to "${contextTitles[contextId] ?? "context"}".`);
      setRefreshToken((t) => t + 1);
    } catch (e) {
      setNotice(String(e));
    }
  };

  const subtitle = loading
    ? "Reading your documents…"
    : error
      ? "Unavailable on this surface."
      : documents.length === 0
        ? "Everything Conva can draw on. Add a document or paste a note to begin."
        : `Everything Conva can draw on — ${documents.length} document${
            documents.length === 1 ? "" : "s"
          }.`;

  return (
    <PageView
      fill
      title="Library"
      subtitle={subtitle}
      actions={notice ? <p className="text-[11px] text-fg-faint">{notice}</p> : null}
    >
      {error ? (
        <ErrorState
          title="Library unavailable"
          description={error}
          onRetry={() => setRefreshToken((t) => t + 1)}
        />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <LibraryPane
            variant="page"
            contextTitles={contextTitles}
            onAttach={(docId, contextId) => void attach(docId, contextId)}
            refreshToken={refreshToken}
            quickAction={quickAction}
          />
        </div>
      )}
    </PageView>
  );
}

import { useCallback, useEffect, useState } from "react";

import { DOC_DRAG_MIME, LibraryPane } from "@/components/contexts/LibraryPane";
import { ViewShell } from "@/components/studio/ViewShell";
import { useBackend } from "@/lib/backend";

/**
 * A context chip that's also a native HTML5 drop target for a Library row's
 * drag payload (`DOC_DRAG_MIME`) — the un-merge's missing half. The drag
 * SOURCE (each row in `LibraryPane`, `draggable` since the unified-page
 * build) and the mutation (`backend.rag.attachContext`, labelled
 * "drag-attach" in its own doc comment) both already existed; only a drop
 * target survived nowhere once Contexts moved to its own screen. This row
 * puts one back on the screen that still has both docs and contexts in view.
 */
function AttachDropRow({
  contextTitles,
  onDrop,
}: {
  contextTitles: Record<string, string>;
  onDrop: (contextId: string, docId: string) => void;
}) {
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const entries = Object.entries(contextTitles);
  if (entries.length === 0) return null;
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-bg/40 p-2.5">
      <span className="shrink-0 text-[11px] font-semibold text-fg-faint">
        Drag a document here to attach it —
      </span>
      {entries.map(([id, title]) => {
        const over = dragOverId === id;
        return (
          <span
            key={id}
            onDragOver={(e) => {
              if (!e.dataTransfer.types.includes(DOC_DRAG_MIME)) return;
              e.preventDefault();
              setDragOverId(id);
            }}
            onDragLeave={() => setDragOverId((cur) => (cur === id ? null : cur))}
            onDrop={(e) => {
              e.preventDefault();
              setDragOverId(null);
              const docId = e.dataTransfer.getData(DOC_DRAG_MIME);
              if (docId) onDrop(id, docId);
            }}
            title={`Drop to attach to "${title}"`}
            className={[
              "rounded-full border px-2.5 py-1 text-[11px] font-semibold transition",
              over ? "border-ai/60 bg-ai/[0.1] text-ai" : "border-border-strong text-fg-muted",
            ].join(" ")}
          >
            {title}
          </span>
        );
      })}
    </div>
  );
}

/**
 * The Library page. Un-merged from Contexts back into its own rail
 * destination (V4.0 `conva_core/brand/UI/AppUI_V4.0` — the reference nav
 * lists them as two separate items; owner decision, 2026-08-16).
 *
 * Drag-and-drop attach is back (owner feedback, 2026-08-16): `AttachDropRow`
 * above the library list gives the drag a place to land now that Contexts
 * is a separate screen — drop a row on a chip, `backend.rag.attachContext`
 * runs, and `refreshToken` bumps `LibraryPane` to re-fetch so the row's own
 * context tag shows up immediately. The slower path (open a context's Edit
 * screen and check documents there) still works too.
 */
export function LibraryView() {
  const backend = useBackend();
  const [contextTitles, setContextTitles] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);

  const refreshContextTitles = useCallback(() => {
    backend.simcon
      .list()
      .then((list) =>
        setContextTitles(Object.fromEntries(list.map((s) => [s.id, s.title]))),
      )
      .catch(() => setContextTitles({}));
  }, [backend]);

  useEffect(() => {
    refreshContextTitles();
  }, [refreshContextTitles]);

  const attach = async (contextId: string, docId: string) => {
    try {
      await backend.rag.attachContext(docId, contextId);
      setNotice(`Attached to "${contextTitles[contextId] ?? "context"}".`);
      setRefreshToken((t) => t + 1);
    } catch (e) {
      setNotice(String(e));
    }
  };

  return (
    <ViewShell
      icon="library"
      title="Library"
      subtitle="Documents Ally answers from — add files, paste notes, drag one onto a context below to attach it."
      wide
      actions={notice ? <p className="text-[11px] text-fg-faint">{notice}</p> : null}
    >
      <AttachDropRow contextTitles={contextTitles} onDrop={(cid, did) => void attach(cid, did)} />
      <LibraryPane
        selectedContextId={null}
        selectedContextTitle={null}
        contextTitles={contextTitles}
        onAttachToSelected={() => {}}
        refreshToken={refreshToken}
      />
    </ViewShell>
  );
}

import { useCallback, useEffect, useState } from "react";

import { LibraryPane } from "@/components/contexts/LibraryPane";
import { ViewShell } from "@/components/studio/ViewShell";
import { useBackend } from "@/lib/backend";

/**
 * The Library page. Un-merged from Contexts back into its own rail
 * destination (V4.0 `conva_core/brand/UI/AppUI_V4.0` — the reference nav
 * lists them as two separate items; owner decision, 2026-08-16).
 *
 * Attaching a document to a context is a click-to-pick popover on each row
 * (`AttachMenu`, inside `LibraryPane`) — not drag-and-drop. An earlier pass
 * built drag-and-drop back (a row dragged onto a context chip here), but it
 * ran into real, hard-to-verify webview drag-and-drop gaps (Tauri's
 * window-level native drag interception, then a Chromium/WebView2 quirk
 * around custom MIME types during `dragover`) that were slow to diagnose
 * blind. Owner call, 2026-08-16: drop it — a click picker is just as fast,
 * has none of those failure modes, and works identically on every platform
 * this app targets (a future mobile companion included, where drag-and-drop
 * isn't a thing at all).
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

  const attach = async (docId: string, contextId: string) => {
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
      subtitle="Documents Ally answers from — add files, paste notes, attach one to a context from its row."
      wide
      actions={notice ? <p className="text-[11px] text-fg-faint">{notice}</p> : null}
    >
      <LibraryPane
        contextTitles={contextTitles}
        onAttach={(docId, contextId) => void attach(docId, contextId)}
        refreshToken={refreshToken}
      />
    </ViewShell>
  );
}

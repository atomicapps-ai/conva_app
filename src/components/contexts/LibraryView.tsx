import { useCallback, useEffect, useState } from "react";

import { LibraryPane } from "@/components/contexts/LibraryPane";
import { ViewShell } from "@/components/studio/ViewShell";
import { useBackend } from "@/lib/backend";

/**
 * The Library page. Un-merged from Contexts back into its own rail
 * destination (V4.0 `conva_core/brand/UI/AppUI_V4.0` — the reference nav
 * lists them as two separate items; owner decision, 2026-08-16).
 *
 * Standalone, there's no "selected context" to attach a document to
 * (that concept depended on the Contexts pane being visible alongside this
 * one) — `LibraryPane` already degrades gracefully for that (its attach
 * affordance simply doesn't render without one). Context tags on each row
 * still resolve correctly: this screen fetches its own lightweight context
 * list just to label them, independent of the Contexts screen's own state.
 */
export function LibraryView() {
  const backend = useBackend();
  const [contextTitles, setContextTitles] = useState<Record<string, string>>({});

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

  return (
    <ViewShell
      icon="library"
      title="Library"
      subtitle="Documents Ally answers from — add files, paste notes, attach them to a context from its Edit screen."
      wide
    >
      <LibraryPane
        selectedContextId={null}
        selectedContextTitle={null}
        contextTitles={contextTitles}
        onAttachToSelected={() => {}}
      />
    </ViewShell>
  );
}

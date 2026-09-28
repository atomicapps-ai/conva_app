import { useEffect, useState } from "react";

import { useBackend } from "@/lib/backend";
import type {
  ArchiveImportOptions,
  ArchiveImportResult,
  ArchiveInspection,
  ArchiveProgressEvent,
} from "@/lib/ipc";

function progressLabel(event: ArchiveProgressEvent | null): string {
  if (!event) return "Starting…";
  switch (event.phase) {
    case "validating":
      return "Validating archive…";
    case "importing":
      return event.total_items > 0
        ? `Importing documents… (${event.processed_items}/${event.total_items})`
        : "Importing…";
    case "completed":
      return "Finishing up…";
    case "cancelled":
      return "Cancelled.";
    case "failed":
      return `Failed: ${event.message}`;
    default:
      return "Working…";
  }
}

/**
 * In-app `.cva` import preview + progress (spec §8.3, first slice). Replaces
 * a bare `window.confirm()` — a WebView2 JS dialog can render without
 * stealing focus, so the whole import silently stalled with no visible
 * prompt and no persisted result (owner bug report, 2026-09-22). This
 * dialog is real page content: it can't get lost off-screen, and it wires
 * the archive pipeline's existing progress events (`archiveProgress`,
 * `archive.rs`'s `ArchiveProgressEvent`) which the old flow never listened
 * to, so a large archive no longer looks frozen.
 *
 * `fixed inset-0`, not `absolute` — this is mounted deep inside a page
 * (Contexts/Conversations), not at the shell root like
 * `SaveConversationDialog`, so it can't rely on a positioned ancestor to
 * confine `absolute`.
 */
export function ArchiveImportDialog({
  inspection,
  operationId,
  onCancel,
  onImport,
  onImported,
  onError,
}: {
  inspection: ArchiveInspection;
  operationId: string;
  onCancel: () => void;
  onImport: (options: ArchiveImportOptions) => Promise<ArchiveImportResult>;
  onImported: (result: ArchiveImportResult) => void;
  onError: (message: string) => void;
}) {
  const backend = useBackend();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<ArchiveProgressEvent | null>(null);
  // Only a real choice when the archive carries both — a single-record
  // archive has nothing to pick between (owner request 2026-09-22).
  const hasChoice = Boolean(inspection.context) && Boolean(inspection.conversation);
  const [includeContext, setIncludeContext] = useState(true);
  const [includeConversation, setIncludeConversation] = useState(true);
  const nothingSelected = hasChoice && !includeContext && !includeConversation;

  useEffect(() => {
    if (!busy || !backend.subscribe) return;
    let unsubscribe: (() => void) | undefined;
    let cancelled = false;
    void backend
      .subscribe("archiveProgress", (event) => {
        if (event.operation_id === operationId) setProgress(event);
      })
      .then((u) => {
        if (cancelled) u();
        else unsubscribe = u;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [busy, backend, operationId]);

  const includedDocs = inspection.documents.filter((d) => d.included);

  const runImport = async () => {
    setBusy(true);
    setProgress(null);
    try {
      const result = await onImport({
        include_document_ids: includedDocs.map((d) => d.portable_id),
        reuse_exact_document_ids: [],
        include_context: includeContext,
        include_conversation: includeConversation,
      });
      onImported(result);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg/70 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="archive-import-title"
        className="w-[26rem] max-w-[90vw] rounded-lg border border-border bg-panel p-4 shadow-xl"
      >
        <h2 id="archive-import-title" className="text-sm font-semibold text-fg">
          Import "{inspection.title}"?
        </h2>
        <dl className="mt-2 flex flex-col gap-1 text-[11px] text-fg-muted">
          {inspection.context && !hasChoice && (
            <div>
              Context: {inspection.context.title} ({inspection.context.category})
            </div>
          )}
          {inspection.conversation && !hasChoice && (
            <div>
              Conversation: {inspection.conversation.title},{" "}
              {inspection.conversation.segment_count} segment
              {inspection.conversation.segment_count === 1 ? "" : "s"}
            </div>
          )}
          {inspection.documents.length > 0 && (
            <div>
              {includedDocs.length} of {inspection.documents.length} document
              {inspection.documents.length === 1 ? "" : "s"} will be included
            </div>
          )}
          {inspection.warnings.length > 0 && (
            <div className="text-ai">
              {inspection.warnings.length} compatibility warning
              {inspection.warnings.length === 1 ? "" : "s"}
            </div>
          )}
        </dl>

        {hasChoice && (
          <fieldset className="mt-3 flex flex-col gap-1.5 rounded-md border border-border bg-bg-2 p-2.5">
            <legend className="px-1 text-[10px] font-semibold uppercase tracking-wide text-fg-faint">
              What to import
            </legend>
            <label className="flex items-center gap-2 text-[11px] text-fg">
              <input
                type="checkbox"
                checked={includeContext}
                disabled={busy}
                onChange={(e) => setIncludeContext(e.target.checked)}
              />
              Context — {inspection.context!.title} ({inspection.context!.category})
            </label>
            <label className="flex items-center gap-2 text-[11px] text-fg">
              <input
                type="checkbox"
                checked={includeConversation}
                disabled={busy}
                onChange={(e) => setIncludeConversation(e.target.checked)}
              />
              Conversation — {inspection.conversation!.title},{" "}
              {inspection.conversation!.segment_count} segment
              {inspection.conversation!.segment_count === 1 ? "" : "s"}
            </label>
          </fieldset>
        )}

        {busy && (
          <div
            role="status"
            aria-live="polite"
            className="mt-3 rounded-md border border-border bg-bg-2 px-2.5 py-2 text-[11px] text-fg-muted"
          >
            {progressLabel(progress)}
          </div>
        )}

        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="mr-auto rounded-md px-3 py-1 text-xs text-fg-faint hover:text-fg disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy || nothingSelected}
            title={nothingSelected ? "Select at least one of Context or Conversation" : undefined}
            onClick={() => void runImport()}
            className="rounded-md bg-ok/90 px-3 py-1 text-xs font-semibold text-bg hover:bg-ok disabled:opacity-50"
          >
            {busy ? "Importing…" : "Import"}
          </button>
        </div>
      </div>
    </div>
  );
}

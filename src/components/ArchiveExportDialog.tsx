import { useEffect, useState } from "react";

import { useBackend } from "@/lib/backend";
import type { ArchiveExportResult, ArchiveProgressEvent } from "@/lib/ipc";

function progressLabel(event: ArchiveProgressEvent | null): string {
  if (!event) return "Starting…";
  switch (event.phase) {
    case "hashing":
      return "Hashing files…";
    case "writing_entries":
      return event.total_items > 0
        ? `Writing archive… (${event.processed_items}/${event.total_items})`
        : "Writing archive…";
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
 * In-app "what to export" picker (owner request 2026-09-22 — export
 * previously always bundled source documents and, for a conversation,
 * always bundled its linked Context, with no way to see or change either
 * before the file got written). `linkedItem` is the other record this one
 * can optionally bundle — a Context's linked conversation, or a
 * conversation's linked Context — `null` when there isn't one to offer.
 */
export function ArchiveExportDialog({
  title,
  linkedItem,
  operationId,
  onCancel,
  onExport,
  onExported,
  onError,
}: {
  title: string;
  linkedItem: { kind: "context" | "conversation"; title: string } | null;
  operationId: string;
  onCancel: () => void;
  onExport: (options: {
    includeLinked: boolean;
    includeSourceDocuments: boolean;
  }) => Promise<ArchiveExportResult>;
  onExported: (result: ArchiveExportResult) => void;
  onError: (message: string) => void;
}) {
  const backend = useBackend();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<ArchiveProgressEvent | null>(null);
  const [includeLinked, setIncludeLinked] = useState(true);
  const [includeSourceDocuments, setIncludeSourceDocuments] = useState(true);

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

  const runExport = async () => {
    setBusy(true);
    setProgress(null);
    try {
      const result = await onExport({ includeLinked, includeSourceDocuments });
      onExported(result);
    } catch (e) {
      // The user closing the native save dialog without picking a
      // destination is a silent cancel, not a failure — same convention the
      // callers already used before this dialog existed.
      if (e instanceof Error && /destination file was chosen/.test(e.message)) {
        onCancel();
        return;
      }
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
        aria-labelledby="archive-export-title"
        className="w-[26rem] max-w-[90vw] rounded-lg border border-border bg-panel p-4 shadow-xl"
      >
        <h2 id="archive-export-title" className="text-sm font-semibold text-fg">
          Export "{title}"
        </h2>
        <p className="mt-1 text-[11px] text-fg-muted">Choose what to include in the .cva file.</p>

        <fieldset className="mt-3 flex flex-col gap-1.5 rounded-md border border-border bg-bg-2 p-2.5">
          <legend className="px-1 text-[10px] font-semibold uppercase tracking-wide text-fg-faint">
            What to include
          </legend>
          {linkedItem && (
            <label className="flex items-center gap-2 text-[11px] text-fg">
              <input
                type="checkbox"
                checked={includeLinked}
                disabled={busy}
                onChange={(e) => setIncludeLinked(e.target.checked)}
              />
              {linkedItem.kind === "conversation" ? "Conversation" : "Context"} —{" "}
              {linkedItem.title}
            </label>
          )}
          <label className="flex items-center gap-2 text-[11px] text-fg">
            <input
              type="checkbox"
              checked={includeSourceDocuments}
              disabled={busy}
              onChange={(e) => setIncludeSourceDocuments(e.target.checked)}
            />
            Source documents (original files, not just references)
          </label>
        </fieldset>

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
            disabled={busy}
            onClick={() => void runExport()}
            className="rounded-md bg-ok/90 px-3 py-1 text-xs font-semibold text-bg hover:bg-ok disabled:opacity-50"
          >
            {busy ? "Exporting…" : "Export"}
          </button>
        </div>
      </div>
    </div>
  );
}

import { useCallback, useEffect, useState } from "react";

import { DOC_DRAG_MIME } from "@/components/contexts/LibraryPane";
import { readinessOf } from "@/components/contexts/readiness";
import { rowStatus } from "@/components/contexts/rowStatus";
import { Icon } from "@/components/ui/Icon";
import { useBackend } from "@/lib/backend";
import { formatBytes } from "@/lib/formatBytes";
import { formatRelativeTime } from "@/lib/relativeTime";
import {
  DEFAULT_CONTEXT_ID,
  type RagDocument,
  type ContextCategory,
  type ContextSummary,
} from "@/lib/ipc";
import { isDesktop } from "@/lib/platform";

const CATEGORY_LABEL: Record<ContextCategory, string> = {
  interview: "Interview",
  company_meeting: "Company meeting",
  sales_call: "Sales call",
  other: "Other",
};

function formatDate(unixMs: number): string {
  return new Date(unixMs).toLocaleString();
}

/** Tooltip text for the title hover (requirement 6): full title, created +
 *  updated date-times, total size of everything tagged to this context
 *  (attached documents AND anything Ally generated for it — both are
 *  already tagged via RagDocument.context_ids, so no separate summing of
 *  source_doc_ids vs. dossier/research/qa_doc_id is needed). */
function titleTooltip(s: ContextSummary, totalBytes: number): string {
  return [
    s.title,
    `Created ${formatDate(s.created_at_unix_ms)}`,
    `Updated ${formatDate(s.updated_at_unix_ms)}`,
    `${formatBytes(totalBytes)} total`,
  ].join("\n");
}

/** Tooltip text for the Regenerate icon hover (requirement 5). */
function regenerateTooltip(s: ContextSummary): string {
  return s.resources_generated_at_unix_ms
    ? `Last regenerated ${formatRelativeTime(s.resources_generated_at_unix_ms)}`
    : "Never regenerated";
}

/** Tooltip text for the status pill, draft only (requirement 3-4's
 *  readiness-checklist relocation — rows no longer expand to show it
 *  inline, so it moves here). `undefined` when there's nothing to show
 *  (non-draft contexts never carried this checklist either). */
function readinessTooltip(s: ContextSummary): string | undefined {
  if (s.status !== "draft") return undefined;
  const { checks } = readinessOf(s);
  return checks
    .map((c) => `${c.ok ? "✓" : c.advisory ? "💡" : "✗"} ${c.label}`)
    .join("\n");
}

/**
 * The Contexts pane: create/edit/delete/generate, each row expandable to
 * show the documents grounding it (including anything Ally generated) —
 * and a drop target for a Library row's drag payload, so dragging a
 * document from the Library pane onto a context attaches it (owner
 * decision, 2026-08-16, reinstating drag-and-drop after Library moved back
 * onto this same screen — `AttachMenu`'s click-to-pick popover on the
 * Library row still works too; this is an additional, faster path now that
 * both panes are visible together again, not a replacement for it).
 *
 * `onDragOver`/`onDragEnter` call `preventDefault()` unconditionally rather
 * than gating on `dataTransfer.types.includes(DOC_DRAG_MIME)` first — some
 * Chromium-embedding webviews don't reliably populate `types` for custom
 * MIME types during `dragover`, only at `drop`; gating on it can silently
 * skip `preventDefault()` and block `drop` from ever firing. `getData()` on
 * drop is still the real gate.
 */
export function ContextsPane({
  items,
  selectedId,
  onSelect,
  onNew,
  onOpen,
  onEdit,
  onDelete,
  onGenerate,
  onAttach,
  generatingId,
  refreshToken,
  widthPx,
  onResize,
}: {
  items: ContextSummary[];
  selectedId: string | null;
  /** Focus this context in the library pane (filter) — does not navigate. */
  onSelect: (id: string) => void;
  /** Drill into the context's detail (personas / rehearse). */
  onOpen: (id: string) => void;
  onNew: () => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onGenerate: (contextId: string) => void;
  /** Attach `docId` to `contextId` — dropped from the Library pane. */
  onAttach: (contextId: string, docId: string) => void;
  generatingId: string | null;
  /** Bump this to re-fetch the child-doc list (e.g. after an attach). */
  refreshToken?: number;
  /** This pane's current width, px — Library fills the rest. Only takes
   *  visual effect at the `sm` breakpoint; see ContextsView.tsx. */
  widthPx: number;
  onResize: (px: number) => void;
}) {
  const backend = useBackend();
  const [docs, setDocs] = useState<RagDocument[]>([]);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  const refreshDocs = useCallback(() => {
    backend.rag.list().then(setDocs).catch(() => {});
  }, [backend]);

  useEffect(() => {
    refreshDocs();
  }, [refreshDocs, refreshToken]);

  return (
    <div className="card relative flex min-h-0 flex-col p-3">
      {/* Right-edge width handle (mirrors TranscriptView.tsx's AllyPanel
          left-edge handle) — dragging right widens this pane. */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize panes"
        onPointerDown={(e) => {
          const startX = e.clientX;
          const startW = widthPx;
          const move = (ev: PointerEvent) =>
            onResize(startW + (ev.clientX - startX));
          const up = () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
          };
          window.addEventListener("pointermove", move);
          window.addEventListener("pointerup", up);
        }}
        className="absolute inset-y-0 right-0 z-30 hidden w-[5px] cursor-col-resize hover:bg-panel-raised sm:block"
      />
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="min-w-0 truncate text-xs font-semibold uppercase tracking-wider text-fg-muted">
          Conversation contexts
        </h3>
        {isDesktop && (
          // Icon-only + tooltip (owner decision, 2026-08-17) — "Brief Ally"
          // as a label read as jargon; the + is the app's one "create new"
          // glyph (ConversationsPanel's "New conversation" uses the same
          // `add` icon), paired with the context glyph so it's unambiguous
          // which kind of "new" this is. A deliberate exception to the
          // mockup's own buttons rule (primary = icon + one word) — the
          // confusing word was the actual bug being fixed here.
          <button
            type="button"
            onClick={onNew}
            title="Add a New Context"
            aria-label="Add a New Context"
            className="btn btn-primary shrink-0 gap-1 px-2 py-1"
          >
            <Icon name="add" size={14} />
            <Icon name="simicon" size={13} />
          </button>
        )}
      </div>

      {items.length === 0 ? (
        <p className="px-1 py-6 text-center text-[11px] leading-relaxed text-fg-faint">
          Create a context to prep Ally for an interview, meeting, or call —
          ground it in your library, then generate its own briefing.
        </p>
      ) : (
        <ul className="min-h-0 flex-1 overflow-y-auto">
          {items.map((s) => {
            const readiness = readinessOf(s);
            const status = rowStatus(s);
            const isGenerating = generatingId === s.id;
            // The always-present default: not editable or deletable —
            // system-managed until the community/LLM evolution owns it.
            const isDefault = s.id === DEFAULT_CONTEXT_ID;
            const dragOver = dragOverId === s.id;
            // Every document tagged to this context — attached AND
            // anything Ally generated for it (both already carry this
            // context's id in context_ids at ingest time), so summing
            // size_bytes here covers requirement 6's "total size" without
            // needing to separately track source_doc_ids vs. the
            // dossier/research/qa doc ids.
            const contextDocs = docs.filter((d) => d.context_ids.includes(s.id));
            const totalBytes = contextDocs.reduce((sum, d) => sum + d.size_bytes, 0);
            return (
              <li
                key={s.id}
                onDragEnter={(e) => {
                  e.preventDefault();
                  setDragOverId(s.id);
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "link";
                  setDragOverId(s.id);
                }}
                onDragLeave={() => setDragOverId((id) => (id === s.id ? null : id))}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOverId(null);
                  const docId = e.dataTransfer.getData(DOC_DRAG_MIME);
                  if (docId) onAttach(s.id, docId);
                }}
                className={[
                  "mb-1.5 rounded-md border p-2 transition last:mb-0",
                  dragOver
                    ? "border-ai/60 bg-ai/[0.06]"
                    : selectedId === s.id
                      ? "border-primary/40 bg-primary/[0.06]"
                      : "border-border",
                ].join(" ")}
              >
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => onSelect(s.id)}
                    title={titleTooltip(s, totalBytes)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <p className="truncate text-[13px] font-semibold text-fg">{s.title}</p>
                  </button>
                  <span className="flex shrink-0 items-center gap-0.5 text-[11px] text-fg-faint">
                    <Icon name="file" size={11} />
                    {s.source_doc_count}
                  </span>
                  <button
                    type="button"
                    onClick={() => onOpen(s.id)}
                    aria-label={`Open ${s.title}`}
                    title="Open"
                    className="shrink-0 rounded-sm p-0.5 text-fg-faint transition hover:bg-panel-raised/60 hover:text-fg"
                  >
                    <Icon name="chevron" size={13} className="-rotate-90" />
                  </button>
                  {!isDefault && (
                    <button
                      type="button"
                      onClick={() => onEdit(s.id)}
                      aria-label={`Edit setup for ${s.title}`}
                      title="Edit setup"
                      className="shrink-0 rounded-sm p-0.5 text-fg-faint transition hover:bg-panel-raised/60 hover:text-fg"
                    >
                      <Icon name="edit" size={13} />
                    </button>
                  )}
                  {/* Unlike Edit/Delete, Regenerate applies to the Default
                      context too — it still generates/refreshes resources
                      just like any other context (owner, 2026-08-28: it's
                      the one context most people actually have at first,
                      so hiding Regenerate here read as "the icons are
                      missing" rather than "not applicable"). */}
                  <button
                    type="button"
                    disabled={!readiness.canGenerate || isGenerating}
                    onClick={() => onGenerate(s.id)}
                    aria-label={`Generate resources for ${s.title}`}
                    title={
                      readiness.canGenerate
                        ? regenerateTooltip(s)
                        : "Add a document, key terms, or enable research first"
                    }
                    className="shrink-0 rounded-sm p-0.5 text-fg-faint transition hover:bg-panel-raised/60 hover:text-ai disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-fg-faint"
                  >
                    <span className={isGenerating ? "inline-block animate-spin" : "inline-block"}>
                      <Icon name="sparkle" size={13} />
                    </span>
                  </button>
                  {!isDefault && (
                    <button
                      type="button"
                      onClick={() => onDelete(s.id)}
                      aria-label={`Delete ${s.title}`}
                      title="Delete"
                      className="shrink-0 rounded-sm p-0.5 text-fg-faint transition hover:bg-rec/10 hover:text-rec"
                    >
                      <Icon name="trash" size={13} />
                    </button>
                  )}
                </div>

                <div className="mt-1 flex items-center gap-2 pl-0">
                  {isDefault ? (
                    <span className="pill pill-sm pill-accent shrink-0">Default</span>
                  ) : (
                    <span className="pill pill-sm pill-idle shrink-0">
                      {CATEGORY_LABEL[s.category]}
                    </span>
                  )}
                  <span
                    className={`pill pill-sm shrink-0 ${status.tone}`}
                    title={
                      status.label === "Stale"
                        ? "Inputs changed since resources were generated — regenerate"
                        : readinessTooltip(s)
                    }
                  >
                    {isGenerating ? "Generating…" : status.label}
                  </span>
                  <span className="text-[11px] text-fg-faint">
                    Updated {formatRelativeTime(s.updated_at_unix_ms)}
                  </span>
                </div>

                {dragOver && contextDocs.length === 0 && (
                  <p className="mt-1 pl-0 text-[11px] text-fg-faint">Drop to attach</p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

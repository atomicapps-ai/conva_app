import { useCallback, useEffect, useState } from "react";

import { DOC_DRAG_MIME } from "@/components/contexts/LibraryPane";
import { readinessOf } from "@/components/contexts/readiness";
import { rowStatus, type RowStatus } from "@/components/contexts/rowStatus";
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

/** Click-triggered popover (owner, 2026-08-28 — the row went to one line,
 *  so Type/Status/Updated moved off the row itself and behind an "i" icon).
 *  Same open/close-on-outside-{click,resize,scroll} shape as
 *  `LibraryRowMenu` in `LibraryPane.tsx` and the retired `RowMenu`. */
function ContextInfoPopover({
  s,
  isDefault,
  status,
}: {
  s: ContextSummary;
  isDefault: boolean;
  status: RowStatus;
}) {
  const [open, setOpen] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(null);
    window.addEventListener("click", close);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [open]);

  const readinessChecks = s.status === "draft" ? readinessOf(s).checks : null;

  return (
    <span className="relative shrink-0">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          const r = e.currentTarget.getBoundingClientRect();
          const MARGIN = 8;
          const POPOVER_W = 220;
          const x = Math.max(MARGIN, Math.min(r.left, window.innerWidth - POPOVER_W - MARGIN));
          setOpen((o) => (o ? null : { x, y: r.bottom + 4 }));
        }}
        aria-label={`Info for ${s.title}`}
        aria-haspopup="dialog"
        aria-expanded={open !== null}
        title="Info"
        className="shrink-0 rounded-sm p-0.5 text-fg-faint transition hover:bg-panel-raised/60 hover:text-fg"
      >
        <Icon name="info" size={13} />
      </button>
      {open && (
        <div
          role="dialog"
          aria-label={`Info for ${s.title}`}
          onClick={(e) => e.stopPropagation()}
          style={{ position: "fixed", left: open.x, top: open.y, zIndex: 60 }}
          className="glass-raised w-[220px] rounded-lg border border-border p-2.5 shadow-[var(--shadow-lg)]"
        >
          <dl className="flex flex-col gap-1.5 text-[11px]">
            <div>
              <dt className="text-[9px] font-semibold uppercase tracking-wider text-fg-faint">
                Type
              </dt>
              <dd className="text-fg">{isDefault ? "Default" : CATEGORY_LABEL[s.category]}</dd>
            </div>
            <div>
              <dt className="text-[9px] font-semibold uppercase tracking-wider text-fg-faint">
                Status
              </dt>
              <dd className="text-fg">{status.label}</dd>
              {readinessChecks && (
                <ul className="mt-1 flex flex-col gap-0.5">
                  {readinessChecks.map((c) => (
                    <li
                      key={c.label}
                      className={`flex items-start gap-1 text-[10px] ${c.ok ? "text-ok" : c.advisory ? "text-fg-faint" : "text-rec"}`}
                    >
                      <Icon
                        name={c.ok ? "check" : advisoryOrClose(c.advisory)}
                        size={10}
                        className="mt-[1px] shrink-0"
                      />
                      <span>{c.label}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <dt className="text-[9px] font-semibold uppercase tracking-wider text-fg-faint">
                Updated
              </dt>
              <dd className="text-fg">{formatRelativeTime(s.updated_at_unix_ms)}</dd>
            </div>
          </dl>
        </div>
      )}
    </span>
  );
}

// A failing advisory check reads as a hint, not an error — matches the
// (now-retired) ChecklistLine's own ok/advisory/blocking icon choice.
function advisoryOrClose(advisory: boolean | undefined): "lightbulb" | "close" {
  return advisory ? "lightbulb" : "close";
}

/**
 * The Contexts pane: create/edit/delete/generate, each row a drop target
 * for a Library row's drag payload, so dragging a document from the
 * Library pane onto a context attaches it (owner decision, 2026-08-16,
 * reinstating drag-and-drop after Library moved back onto this same
 * screen — `LibraryRowMenu`'s "Attach to a context…" click-to-pick item on
 * the Library row still works too; this is an additional, faster path now
 * that both panes are visible together again, not a replacement for it).
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
          Contexts
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
                  "mb-1 rounded-md border px-2 py-1 transition last:mb-0",
                  dragOver
                    ? "border-ai/60 bg-ai/[0.06]"
                    : selectedId === s.id
                      ? "border-primary/40 bg-primary/[0.06]"
                      : "border-border",
                ].join(" ")}
              >
                <div className="flex items-center gap-1.5">
                  <span
                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${status.dotClass}`}
                    title={
                      isGenerating
                        ? "Generating…"
                        : status.label === "Stale"
                          ? "Stale — inputs changed since resources were generated"
                          : status.label
                    }
                    aria-hidden
                  />
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
                  <ContextInfoPopover s={s} isDefault={isDefault} status={status} />
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

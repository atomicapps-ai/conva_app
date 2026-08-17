import { useCallback, useEffect, useState } from "react";

import { DOC_DRAG_MIME } from "@/components/contexts/LibraryPane";
import { readinessOf } from "@/components/contexts/readiness";
import { Icon } from "@/components/ui/Icon";
import { useBackend } from "@/lib/backend";
import {
  DEFAULT_CONTEXT_ID,
  type RagDocument,
  type SimConCategory,
  type SimConStatus,
  type SimConSummary,
} from "@/lib/ipc";
import { isDesktop } from "@/lib/platform";

const CATEGORY_LABEL: Record<SimConCategory, string> = {
  interview: "Interview",
  company_meeting: "Company meeting",
  sales_call: "Sales call",
  other: "Other",
};

const STATUS_LABEL: Record<SimConStatus, string> = {
  draft: "Draft",
  ingesting: "Preparing…",
  ready: "Ready",
  running: "Running",
  ended: "Ended",
};

// Maps each session status to a shared `.pill-*` modifier (globals.css) —
// draft/ended read as idle (neutral), ready is the one true "state" pill,
// ingesting/running are transient chrome (azure), not a voice/state colour.
const STATUS_TONE: Record<SimConStatus, string> = {
  draft: "pill-idle",
  ingesting: "pill-accent",
  ready: "pill-ready",
  running: "pill-accent",
  ended: "pill-idle",
};

/** One checklist line — a check, or an advisory warning (never blocks). */
function ChecklistLine({ ok, label, advisory }: { ok: boolean; label: string; advisory?: boolean }) {
  return (
    <p className="flex items-center gap-1.5 text-[11px] text-fg-muted">
      <Icon
        name={ok ? "check" : advisory ? "lightbulb" : "close"}
        size={12}
        className={ok ? "text-ok" : advisory ? "text-fg-faint" : "text-rec"}
      />
      {label}
    </p>
  );
}

/** A row's overflow actions (Edit, Delete, …) behind one ⋮ button — the same
 *  fixed-position, close-on-outside-action popover pattern as the transcript's
 *  term menu, so row actions read consistently across the app. Keeps only
 *  Open + Generate inline on the row itself; this is where future per-context
 *  actions land as the feature grows. */
function RowMenu({
  title,
  onEdit,
  onDelete,
}: {
  title: string;
  onEdit: () => void;
  onDelete: () => void;
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

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          const r = e.currentTarget.getBoundingClientRect();
          setOpen((o) => (o ? null : { x: r.right, y: r.bottom }));
        }}
        aria-label={`More actions for ${title}`}
        aria-expanded={open !== null}
        title="More actions"
        className="shrink-0 rounded-sm p-1 text-fg-faint transition hover:bg-panel-raised/60 hover:text-fg"
      >
        <Icon name="more" size={13} />
      </button>
      {open && (
        <div
          role="menu"
          aria-label={`Actions for ${title}`}
          onClick={(e) => e.stopPropagation()}
          style={{ left: Math.min(open.x, window.innerWidth - 148) - 132, top: open.y + 4 }}
          className="glass-raised fixed z-50 w-[132px] rounded-lg p-1"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(null);
              onEdit();
            }}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] text-fg transition hover:bg-panel-raised/70"
          >
            <Icon name="edit" size={13} className="text-fg-muted" />
            Edit setup
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(null);
              onDelete();
            }}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] text-rec transition hover:bg-rec/10"
          >
            <Icon name="trash" size={13} />
            Delete
          </button>
        </div>
      )}
    </>
  );
}

/** One document nested under an expanded context — read-only aside from the
 *  detach action. Ally-generated docs (the prep dossier, etc.) get a small
 *  "conva" tag, same treatment as their Library row. */
function ChildDocRow({
  doc,
  onDetach,
}: {
  doc: RagDocument;
  onDetach: () => void;
}) {
  return (
    <li className="group flex items-center gap-1.5 py-1 pl-1 text-[11.5px]">
      <Icon
        name={doc.source === "generated" ? "sparkle" : "file"}
        size={12}
        className={doc.source === "generated" ? "shrink-0 text-ai" : "shrink-0 text-fg-faint"}
      />
      <span className="min-w-0 flex-1 truncate text-fg-muted" title={doc.file_name}>
        {doc.file_name}
      </span>
      {doc.source === "generated" && (
        <span className="shrink-0 rounded-full bg-ai/10 px-1.5 py-0.5 text-[9px] font-semibold text-ai">
          conva
        </span>
      )}
      <button
        type="button"
        onClick={onDetach}
        title={`Remove ${doc.file_name} from this context`}
        aria-label={`Remove ${doc.file_name} from this context`}
        className="shrink-0 rounded p-0.5 text-fg-faint opacity-0 transition hover:bg-rec/10 hover:text-rec group-hover:opacity-100"
      >
        <Icon name="close" size={11} />
      </button>
    </li>
  );
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
  onDocsChanged,
  generatingId,
  refreshToken,
}: {
  items: SimConSummary[];
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
  /** A detach here changed the doc's context tags — let the caller refresh
   *  the Library pane too (it holds its own, separate copy of the list). */
  onDocsChanged?: () => void;
  generatingId: string | null;
  /** Bump this to re-fetch the child-doc list (e.g. after an attach). */
  refreshToken?: number;
}) {
  const backend = useBackend();
  const [docs, setDocs] = useState<RagDocument[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  const refreshDocs = useCallback(() => {
    backend.rag.list().then(setDocs).catch(() => {});
  }, [backend]);

  useEffect(() => {
    refreshDocs();
  }, [refreshDocs, refreshToken]);

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const detach = (docId: string, contextId: string) => {
    void backend.rag.detachContext(docId, contextId).then(() => {
      refreshDocs();
      onDocsChanged?.();
    });
  };

  return (
    <div className="card flex min-h-0 flex-col p-3">
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
            const isGenerating = generatingId === s.id;
            // The always-present default: not editable or deletable —
            // system-managed until the community/LLM evolution owns it.
            const isDefault = s.id === DEFAULT_CONTEXT_ID;
            const isOpen = expanded.has(s.id);
            const dragOver = dragOverId === s.id;
            const children = docs.filter((d) => d.context_ids.includes(s.id));
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
                  if (docId) {
                    onAttach(s.id, docId);
                    setExpanded((prev) => new Set(prev).add(s.id));
                  }
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
                    onClick={() => toggleExpand(s.id)}
                    aria-expanded={isOpen}
                    aria-label={isOpen ? `Collapse ${s.title}` : `Expand ${s.title}`}
                    title={isOpen ? "Hide documents" : "Show documents"}
                    className="shrink-0 rounded-sm p-0.5 text-fg-faint transition hover:bg-panel-raised/60 hover:text-fg"
                  >
                    <Icon
                      name="chevron"
                      size={13}
                      className={isOpen ? "" : "-rotate-90"}
                    />
                  </button>
                  <button
                    type="button"
                    onClick={() => onSelect(s.id)}
                    title="Focus this context in the library"
                    className="min-w-0 flex-1 text-left"
                  >
                    <p className="truncate text-[13px] font-semibold text-fg">{s.title}</p>
                  </button>
                  <button
                    type="button"
                    onClick={() => onOpen(s.id)}
                    aria-label={`Open ${s.title}`}
                    title="Open"
                    className="shrink-0 rounded-sm p-0.5 text-fg-faint transition hover:bg-panel-raised/60 hover:text-fg"
                  >
                    <Icon name="chevron" size={13} className="-rotate-90" />
                  </button>
                  {isDefault ? (
                    <span className="pill pill-sm pill-accent shrink-0">Default</span>
                  ) : (
                    <span className="pill pill-sm pill-idle shrink-0">
                      {CATEGORY_LABEL[s.category]}
                    </span>
                  )}
                  <span className={`pill pill-sm shrink-0 ${STATUS_TONE[s.status]}`}>
                    {isGenerating ? "Generating…" : STATUS_LABEL[s.status]}
                  </span>
                </div>

                <div className="mt-1.5 flex items-center gap-2 pl-5">
                  <span className="text-[11px] text-fg-faint">
                    {s.source_doc_count} doc{s.source_doc_count === 1 ? "" : "s"}
                    {s.has_generated_resources ? " · generated" : ""}
                  </span>
                  <span className="flex-1" />
                  {!isDefault && (
                    <>
                      <button
                        type="button"
                        disabled={!readiness.canGenerate || isGenerating}
                        onClick={() => onGenerate(s.id)}
                        title={
                          readiness.canGenerate
                            ? "Generate resources"
                            : "Add a document, key terms, or enable research first"
                        }
                        aria-label={`Generate resources for ${s.title}`}
                        className="rounded-sm p-1 text-fg-faint transition hover:bg-panel-raised/60 hover:text-ai disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-fg-faint"
                      >
                        <span className={isGenerating ? "inline-block animate-spin" : "inline-block"}>
                          <Icon name="sparkle" size={14} />
                        </span>
                      </button>
                      <RowMenu
                        title={s.title}
                        onEdit={() => onEdit(s.id)}
                        onDelete={() => onDelete(s.id)}
                      />
                    </>
                  )}
                </div>

                {isOpen && (
                  <ul className="ml-5 mt-1 flex flex-col divide-y divide-border border-l border-border pl-2">
                    {children.length === 0 ? (
                      <li className="py-1 pl-1 text-[11px] text-fg-faint">
                        {dragOver
                          ? "Drop to attach"
                          : "No documents yet — drag one from the library, or use its Attach button."}
                      </li>
                    ) : (
                      children.map((d) => (
                        <ChildDocRow key={d.id} doc={d} onDetach={() => detach(d.id, s.id)} />
                      ))
                    )}
                  </ul>
                )}

                {s.status === "draft" && (
                  <div className="mt-1.5 flex flex-col gap-0.5 border-t border-border pt-1.5">
                    {readiness.checks.map((c) => (
                      <ChecklistLine key={c.label} {...c} />
                    ))}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

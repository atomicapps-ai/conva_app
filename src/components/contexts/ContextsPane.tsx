import { useEffect, useState } from "react";

import { readinessOf } from "@/components/contexts/readiness";
import { Icon } from "@/components/ui/Icon";
import { DEFAULT_CONTEXT_ID, type SimConCategory, type SimConStatus, type SimConSummary } from "@/lib/ipc";
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

const STATUS_TONE: Record<SimConStatus, string> = {
  draft: "border-border-strong text-fg-faint",
  ingesting: "border-primary/50 bg-primary/[0.12] text-fg",
  ready: "border-ok/50 bg-ok/10 text-ok",
  running: "border-primary/50 bg-primary/[0.12] text-fg",
  ended: "border-border text-fg-faint",
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

/**
 * The Contexts pane: create/edit/delete/generate. A Draft row shows its
 * readiness checklist inline so "why is Generate disabled" is always
 * visible. `onGenerate` is async — the pane owns only per-row busy UI
 * state, not the mutation itself.
 *
 * Used to also be a drop target for a library row's drag payload
 * (attach-by-drag) — retired (owner decision, 2026-08-16) in favor of a
 * click-to-attach picker living on the Library row itself
 * (`AttachMenu`/`LibraryPane`); see that file's doc comment for why.
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
  generatingId,
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
  generatingId: string | null;
}) {
  return (
    <div className="card flex min-h-0 flex-col p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="min-w-0 truncate text-xs font-semibold uppercase tracking-wider text-fg-muted">
          Conversation contexts
        </h3>
        {isDesktop && (
          <button
            type="button"
            onClick={onNew}
            title="Brief Ally — build a new context to ground it in for a call"
            className="btn btn-primary shrink-0 whitespace-nowrap px-2 py-1 text-[11px]"
          >
            <Icon name="simicon" size={13} />
            Brief Ally
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
            return (
              <li
                key={s.id}
                className={[
                  "mb-1.5 rounded-md border p-2 transition last:mb-0",
                  selectedId === s.id
                    ? "border-primary/40 bg-primary/[0.06]"
                    : "border-border",
                ].join(" ")}
              >
                <div className="flex items-center gap-1.5">
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
                    <span className="shrink-0 rounded-full border border-primary/40 bg-primary/[0.1] px-1.5 py-0.5 text-[10px] text-primary">
                      Default
                    </span>
                  ) : (
                    <span className="shrink-0 rounded-full border border-border-strong px-1.5 py-0.5 text-[10px] text-fg-faint">
                      {CATEGORY_LABEL[s.category]}
                    </span>
                  )}
                  <span
                    className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] ${STATUS_TONE[s.status]}`}
                  >
                    {isGenerating ? "Generating…" : STATUS_LABEL[s.status]}
                  </span>
                </div>

                <div className="mt-1.5 flex items-center gap-2">
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

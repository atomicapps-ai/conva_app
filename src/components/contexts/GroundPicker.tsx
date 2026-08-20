import { useEffect, useState } from "react";

import { autoNameGrounding, resolveGrounding } from "@/components/contexts/groundResolve";
import { readinessOf } from "@/components/contexts/readiness";
import { Icon } from "@/components/ui/Icon";
import { ResponsiveLabel } from "@/components/ui/ResponsiveLabel";
import { useBackend } from "@/lib/backend";
import { DEFAULT_CONTEXT_ID, type RagDocument, type SimConSession, type SimConSummary } from "@/lib/ipc";
import { useGroundingStore } from "@/state/grounding";

/** Per-context expansion state: fetched detail (doc ids + key terms) once
 *  expanded, and — only once the user cherry-picks within it — the doc ids
 *  actually kept (absent = "use them all", i.e. the context checked whole). */
interface ContextState {
  detail: SimConSession | null;
  loading: boolean;
  override: Set<string> | null;
}

/**
 * "Select context" — the session-grounding picker (design:
 * `conva_core/docs/technical/conversation-context-session-grounding.md`).
 * A checkbox tree of saved contexts (checked = use as a block; expand to
 * cherry-pick its documents) plus a flat, searchable library section. Checking
 * exactly one context untouched activates it instantly; any other
 * combination — multiple contexts, extras, a cherry-picked subset — quick-
 * creates (or finishes) a context for that exact mix, generates its digest,
 * then activates it. Lives next to Start Listening in the `TopBar`.
 *
 * Selection is **required**: Ally is always grounded in something. On mount
 * (and whenever nothing is active), this auto-activates the always-present
 * `DEFAULT_CONTEXT_ID` ("General conversation") rather than blocking Start
 * Listening — "required" is an invariant, not a gate the user must click
 * through every session.
 */
export function GroundPicker({ disabled }: { disabled?: boolean }) {
  const backend = useBackend();
  const activeId = useGroundingStore((s) => s.activeId);
  const activeTitle = useGroundingStore((s) => s.activeTitle);
  const activating = useGroundingStore((s) => s.activating);
  const setActivating = useGroundingStore((s) => s.setActivating);
  const setActive = useGroundingStore((s) => s.setActive);

  // Session grounding is required: Ally is always grounded in *something*.
  // Nothing active yet (first launch, or after a session ends) → fall back to
  // the always-present default rather than blocking Start Listening.
  useEffect(() => {
    if (activeId || disabled) return;
    void backend.simcon
      .activateContext(DEFAULT_CONTEXT_ID)
      .then((session) => setActive(session.id, session.title))
      .catch(() => {
        /* best-effort — Start Listening still works unscoped if this fails */
      });
  }, [activeId, disabled, backend, setActive]);

  const [open, setOpen] = useState<{ x: number; y: number } | null>(null);
  const [contexts, setContexts] = useState<SimConSummary[]>([]);
  const [docs, setDocs] = useState<RagDocument[]>([]);
  const [loadingLists, setLoadingLists] = useState(false);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);

  const [checkedContexts, setCheckedContexts] = useState<Set<string>>(new Set());
  const [contextState, setContextState] = useState<Record<string, ContextState>>({});
  const [checkedDocs, setCheckedDocs] = useState<Set<string>>(new Set());

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

  const openPicker = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (disabled) return;
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    // Clamp to the viewport (same pattern as ContextsPane's RowMenu and
    // TranscriptView's TermMenu) — anchoring purely off the trigger's left
    // edge pushed this 300px panel off-screen whenever the trigger sat far
    // enough right (e.g. GroundPicker's own default position in TopBar),
    // which is exactly the "menu opens too far right, can't see it" bug.
    const MARGIN = 8;
    const PANEL_W = 300;
    const PANEL_H = 420; // matches max-h-[420px] below
    const x = Math.max(MARGIN, Math.min(r.left, window.innerWidth - PANEL_W - MARGIN));
    const y = Math.max(MARGIN, Math.min(r.bottom + 4, window.innerHeight - PANEL_H - MARGIN));
    setOpen({ x, y });
    setError(null);
    setSearch("");
    setCheckedContexts(new Set());
    setContextState({});
    setCheckedDocs(new Set());
    setLoadingLists(true);
    void Promise.all([backend.simcon.list(), backend.rag.list()])
      .then(([cs, ds]) => {
        setContexts(cs);
        setDocs(ds);
      })
      .catch(() => setError("Couldn't load contexts or library."))
      .finally(() => setLoadingLists(false));
  };

  /** A total lookup — every updater spreads from this, never straight from
   *  `m[id]` (a possibly-`undefined` index under noUncheckedIndexedAccess). */
  const stateFor = (m: Record<string, ContextState>, id: string): ContextState =>
    m[id] ?? { detail: null, loading: false, override: null };

  const ensureDetail = async (id: string): Promise<SimConSession> => {
    const existing = contextState[id]?.detail;
    if (existing) return existing;
    setContextState((m) => ({ ...m, [id]: { ...stateFor(m, id), detail: null, loading: true } }));
    const full = await backend.simcon.load(id);
    setContextState((m) => ({ ...m, [id]: { ...stateFor(m, id), detail: full, loading: false } }));
    return full;
  };

  const toggleContext = (id: string) => {
    setCheckedContexts((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    // A fresh check always starts "whole" — drop any earlier cherry-pick.
    setContextState((m) => ({ ...m, [id]: { ...stateFor(m, id), override: null } }));
  };

  const expandContext = (id: string) => {
    const isOpen = contextState[id]?.detail != null;
    if (isOpen) {
      setContextState((m) => ({ ...m, [id]: { ...stateFor(m, id), detail: null } }));
    } else {
      void ensureDetail(id);
    }
  };

  const toggleDocInContext = (contextId: string, docId: string) => {
    const detail = contextState[contextId]?.detail;
    if (!detail) return;
    setContextState((m) => {
      const current = stateFor(m, contextId);
      const kept = current.override ?? new Set(detail.source_doc_ids);
      const next = new Set(kept);
      if (next.has(docId)) next.delete(docId);
      else next.add(docId);
      return { ...m, [contextId]: { ...current, override: next } };
    });
    setCheckedContexts((s) => new Set(s).add(contextId));
  };

  const toggleDoc = (id: string) => {
    setCheckedDocs((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Exactly one context checked, untouched, no extra docs — the fast path
  // (or, if it's not Ready yet, the "finish this context" path — either way
  // no NEW context gets created).
  const soleContextId =
    checkedContexts.size === 1 && checkedDocs.size === 0
      ? [...checkedContexts][0]
      : null;
  const soleContextTouched = soleContextId ? contextState[soleContextId]?.override != null : false;
  const soleContext =
    soleContextId && !soleContextTouched
      ? (contexts.find((c) => c.id === soleContextId) ?? null)
      : null;

  const canApply = checkedContexts.size > 0 || checkedDocs.size > 0;

  const apply = async () => {
    if (!canApply) return;
    setError(null);
    setActivating(true);
    try {
      if (soleContext) {
        if (soleContext.status === "ready") {
          const session = await backend.simcon.activateContext(soleContext.id);
          setActive(session.id, session.title);
        } else {
          if (!readinessOf(soleContext).canGenerate) {
            setError(`"${soleContext.title}" needs a document, key terms, or research enabled first.`);
            setActivating(false);
            return;
          }
          await backend.simcon.prepare(soleContext.id);
          await backend.simcon.generateDossier(soleContext.id);
          const session = await backend.simcon.activateContext(soleContext.id);
          setActive(session.id, session.title);
        }
      } else {
        const details = await Promise.all([...checkedContexts].map(ensureDetail));
        const sources = details.map((d) => {
          const override = contextState[d.id]?.override;
          return {
            docIds: override ? [...override] : d.source_doc_ids,
            keyTerms: d.key_terms ?? [],
          };
        });
        const resolved = resolveGrounding(sources, [...checkedDocs]);
        if (resolved.docIds.length === 0 && resolved.keyTerms.length === 0) {
          setError("Pick at least one document or context.");
          setActivating(false);
          return;
        }
        const labels = [
          ...details.map((d) => d.title),
          ...[...checkedDocs].map((id) => docs.find((x) => x.id === id)?.file_name ?? ""),
        ];
        const saved = await backend.simcon.save({
          id: "",
          title: autoNameGrounding(labels),
          purpose: "",
          job_description: null,
          category: "other",
          status: "draft",
          created_at_unix_ms: 0,
          updated_at_unix_ms: 0,
          source_doc_ids: resolved.docIds,
          auto_generate_context: false,
          research_enabled: false,
          key_terms: resolved.keyTerms,
          glossary: [],
          knowledge_profile_id: null,
          personas: [],
          chosen_persona_id: null,
          conversation_id: null,
          dossier_doc_id: null,
        });
        await backend.simcon.prepare(saved.id);
        await backend.simcon.generateDossier(saved.id);
        const session = await backend.simcon.activateContext(saved.id);
        setActive(session.id, session.title);
      }
      setOpen(null);
    } catch (e) {
      setError(String(e).replace(/^Error:\s*/, "") || "Couldn't ground Ally on that selection.");
      setActivating(false);
    }
  };

  const filteredDocs = docs.filter((d) =>
    d.file_name.toLowerCase().includes(search.trim().toLowerCase()),
  );

  return (
    <>
      {activeTitle ? (
        <div className="flex shrink-0 items-center gap-1 rounded-[4px] border border-primary/40 bg-primary/[0.08] pl-2.5 pr-1 text-xs">
          <button
            type="button"
            onClick={openPicker}
            disabled={disabled}
            title={disabled ? "Stop listening to change this" : "Change what Ally is grounded on"}
            className="flex h-[26px] items-center gap-1.5 font-semibold text-fg disabled:cursor-not-allowed"
          >
            <Icon name="simicon" size={13} className="text-primary" />
            <span className="max-w-[160px] truncate">{activeTitle}</span>
          </button>
          {activeId !== DEFAULT_CONTEXT_ID && (
            <button
              type="button"
              disabled={disabled}
              onClick={() => {
                void backend.simcon
                  .activateContext(DEFAULT_CONTEXT_ID)
                  .then((session) => setActive(session.id, session.title));
              }}
              aria-label="Reset to General conversation"
              title="Reset to General conversation"
              className="rounded-sm p-1 text-fg-faint transition hover:bg-panel-raised/60 hover:text-fg disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Icon name="close" size={12} />
            </button>
          )}
        </div>
      ) : (
        <button
          type="button"
          onClick={openPicker}
          disabled={disabled || activating}
          title={disabled ? "Stop listening to select a context" : "Select what Ally is grounded in"}
          className="flex h-[28px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[4px] border border-border bg-white/[0.035] px-3 text-xs font-semibold text-fg-muted transition hover:text-fg disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Icon name="simicon" size={14} />
          {activating ? (
            "Selecting…"
          ) : (
            <ResponsiveLabel full="Select context" short="Select" />
          )}
        </button>
      )}

      {open && (
        <div
          role="dialog"
          aria-label="Select context"
          onClick={(e) => e.stopPropagation()}
          style={{ left: open.x, top: open.y }}
          className="glass-raised fixed z-50 flex max-h-[420px] w-[300px] flex-col gap-2 rounded-lg p-2.5"
        >
          <p className="text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
            Select context
          </p>

          {loadingLists ? (
            <p className="py-4 text-center text-[11px] text-fg-faint">Loading…</p>
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto">
              {contexts.length > 0 && (
                <ul className="mb-2 flex flex-col gap-0.5">
                  {contexts.map((c) => {
                    const state = contextState[c.id];
                    const expanded = state?.detail != null;
                    return (
                      <li key={c.id}>
                        <div className="flex items-center gap-1.5 rounded-sm px-1 py-1 hover:bg-panel-raised/50">
                          <input
                            type="checkbox"
                            checked={checkedContexts.has(c.id)}
                            onChange={() => toggleContext(c.id)}
                            aria-label={`Include ${c.title}`}
                          />
                          <button
                            type="button"
                            onClick={() => expandContext(c.id)}
                            aria-label={expanded ? `Collapse ${c.title}` : `Expand ${c.title}`}
                            aria-expanded={expanded}
                            className="rounded-sm p-0.5 text-fg-faint hover:text-fg"
                          >
                            <Icon
                              name="chevron"
                              size={11}
                              className={expanded ? "" : "-rotate-90"}
                            />
                          </button>
                          <span className="min-w-0 flex-1 truncate text-[12px] text-fg">
                            {c.title}
                          </span>
                          <span className="shrink-0 text-[10px] text-fg-faint">
                            {c.source_doc_count} doc{c.source_doc_count === 1 ? "" : "s"}
                          </span>
                        </div>
                        {expanded && state?.detail && (
                          <ul className="ml-6 flex flex-col gap-0.5 border-l border-border pl-2">
                            {state.detail.source_doc_ids.length === 0 ? (
                              <li className="py-0.5 text-[11px] text-fg-faint">No documents.</li>
                            ) : (
                              state.detail.source_doc_ids.map((docId) => {
                                const doc = docs.find((d) => d.id === docId);
                                const kept = state.override
                                  ? state.override.has(docId)
                                  : true;
                                return (
                                  <li key={docId} className="flex items-center gap-1.5 py-0.5">
                                    <input
                                      type="checkbox"
                                      checked={kept}
                                      onChange={() => toggleDocInContext(c.id, docId)}
                                      aria-label={`Include ${doc?.file_name ?? docId}`}
                                    />
                                    <span className="min-w-0 flex-1 truncate text-[11px] text-fg-muted">
                                      {doc?.file_name ?? docId}
                                    </span>
                                  </li>
                                );
                              })
                            )}
                          </ul>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}

              <div className="border-t border-border pt-2">
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-fg-faint">
                  Library
                </p>
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search documents"
                  className="input mb-1.5 h-[26px] w-full text-[11px]"
                />
                {filteredDocs.length === 0 ? (
                  <p className="py-2 text-center text-[11px] text-fg-faint">No documents.</p>
                ) : (
                  <ul className="flex flex-col gap-0.5">
                    {filteredDocs.map((d) => (
                      <li key={d.id} className="flex items-center gap-1.5 py-0.5">
                        <input
                          type="checkbox"
                          checked={checkedDocs.has(d.id)}
                          onChange={() => toggleDoc(d.id)}
                          aria-label={`Include ${d.file_name}`}
                        />
                        <span className="min-w-0 flex-1 truncate text-[11px] text-fg">
                          {d.file_name}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}

          {error && <p className="text-[11px] text-rec">{error}</p>}

          <div className="flex items-center justify-between gap-2 border-t border-border pt-2">
            <span className="text-[10px] text-fg-faint">
              {soleContext
                ? soleContext.status === "ready"
                  ? "Instant — already grounded"
                  : "Will generate its digest"
                : canApply
                  ? "Will generate a combined digest"
                  : "Nothing selected"}
            </span>
            <button
              type="button"
              disabled={!canApply || activating}
              onClick={() => void apply()}
              className="btn btn-primary px-2.5 py-1 text-[11px] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {activating ? "Selecting…" : "Select"}
            </button>
          </div>
        </div>
      )}
    </>
  );
}

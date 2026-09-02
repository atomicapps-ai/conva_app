import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  CONTEXT_TABS,
  defaultTab,
  tabForKey,
  type ContextTab,
} from "@/components/contexts/contextTabs";
import { readinessOf } from "@/components/contexts/readiness";
import {
  EmptyState,
  ErrorState,
  Eyebrow,
  PrimaryButton,
  SecondaryButton,
  Skeleton,
} from "@/components/studio/PageView";
import { parseQaPairs, type PrepQaPair } from "@/components/transcript/qaPairs";
import { Icon } from "@/components/ui/Icon";
import { useBackend } from "@/lib/backend";
import type { ContextSummary, ConversationContext } from "@/lib/ipc";
import { formatRelativeTime } from "@/lib/relativeTime";

/**
 * Pane B of the Contexts workspace — AppUI V5.0 §3.
 *
 * > Context list (300px) · selected-context workspace (flex, min 520px) ·
 * > contextual Library dock (360px), all visible at wide width. Q&A is the
 * > default tab when prepared Q&A exists.
 *
 * The four tabs and what each owns (§3, "Context tabs — only four, no nested
 * strips"):
 *
 * - **Overview** — purpose/type, readiness checklist, core vocabulary,
 *   counterparty, source summary.
 * - **Q&A** — expandable pairs; the default tab when Q&A exists. Q badge
 *   azure, A badge Ally gold.
 * - **Briefing** — the Conva dossier, structured for pre-call scanning.
 * - **Research** — web findings, with their freshness and a regenerate.
 *
 * Selecting a row updates this pane; it is **never a third-level page**
 * (CLAUDE.md rule 9 — the drill-in to personas/rehearsal is still the
 * existing `ContextDetail` sub-view, reached from Overview).
 *
 * Tab state is preserved per context while the pane stays mounted, and empty
 * tabs explain how their content is produced and offer exactly one action.
 */
export function ContextWorkspace({
  summary,
  generating,
  onGenerate,
  onOpenDetail,
  onEdit,
  onActivate,
  isActive,
  refreshToken,
}: {
  summary: ContextSummary;
  generating: boolean;
  onGenerate: () => void;
  onOpenDetail: () => void;
  onEdit: () => void;
  onActivate: () => void;
  isActive: boolean;
  refreshToken?: number;
}) {
  const backend = useBackend();
  const [full, setFull] = useState<ConversationContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [qa, setQa] = useState<PrepQaPair[] | null>(null);
  const [briefing, setBriefing] = useState<string | null>(null);
  const [research, setResearch] = useState<string | null>(null);
  const [tab, setTab] = useState<ContextTab | null>(null);
  const [openQa, setOpenQa] = useState<number | null>(0);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    backend.context
      .load(summary.id)
      .then(async (ctx) => {
        setFull(ctx);
        const [qaText, briefText, researchText] = await Promise.all([
          ctx.qa_doc_id ? backend.rag.documentText(ctx.qa_doc_id).catch(() => null) : null,
          ctx.dossier_doc_id
            ? backend.rag.documentText(ctx.dossier_doc_id).catch(() => null)
            : null,
          ctx.research_doc_id
            ? backend.rag.documentText(ctx.research_doc_id).catch(() => null)
            : null,
        ]);
        const pairs = qaText ? parseQaPairs(qaText, "ally") : [];
        setQa(pairs);
        setBriefing(briefText);
        setResearch(researchText);
        // Only choose the default tab on first load for this context — a
        // refresh must not yank the user off the tab they're reading.
        setTab((t) => t ?? defaultTab(pairs.length > 0));
      })
      .catch(() => setError("Couldn't open that context."))
      .finally(() => setLoading(false));
  }, [backend, summary.id]);

  // Reset per-context state when the selection changes, then load.
  useEffect(() => {
    setTab(null);
    setQa(null);
    setBriefing(null);
    setResearch(null);
    setOpenQa(0);
  }, [summary.id]);
  useEffect(load, [load, refreshToken]);

  const activeTab = tab ?? "overview";
  const readiness = useMemo(() => readinessOf(summary), [summary]);

  const onTabKeyDown = (e: React.KeyboardEvent) => {
    const next = tabForKey(activeTab, e.key);
    if (next === activeTab) return;
    e.preventDefault();
    setTab(next);
    tabRefs.current[next]?.focus();
  };

  return (
    // Header + tabs pinned at the top, footer pinned at the bottom, only the
    // tab panel scrolls — otherwise the footer's `mt-auto` rides over the
    // content as soon as a long Q&A list overflows.
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {/* header */}
      <div className="flex shrink-0 flex-col gap-[18px] px-6 pb-0 pt-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="truncate text-[22px] font-bold leading-tight tracking-[-0.01em] text-fg">
            {summary.title}
          </h3>
          <span className="mt-2 flex flex-wrap items-center gap-x-3.5 gap-y-1 font-mono text-xs text-fg-faint">
            <span className="inline-flex items-center gap-1.5">
              <span
                className={`h-[7px] w-[7px] rounded-full ${
                  summary.has_generated_resources && !summary.resources_stale
                    ? "bg-ok"
                    : generating
                      ? "bg-primary"
                      : "bg-fg-faint"
                }`}
                aria-hidden
              />
              {generating
                ? "PREPARING"
                : summary.has_generated_resources
                  ? summary.resources_stale
                    ? "STALE"
                    : "READY"
                  : "NOT PREPARED"}
            </span>
            <span>
              {summary.source_doc_count} source{summary.source_doc_count === 1 ? "" : "s"}
            </span>
            {qa && qa.length > 0 && <span>{qa.length} prepared Q&amp;A</span>}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {isActive ? (
            <PrimaryButton onClick={onActivate} title="This context is grounding the next session">
              <span className="h-[7px] w-[7px] rounded-full bg-primary-ink" aria-hidden />
              Active
            </PrimaryButton>
          ) : (
            <SecondaryButton onClick={onActivate}>Use for next session</SecondaryButton>
          )}
          <SecondaryButton onClick={onEdit} title="Edit this context">
            <Icon name="edit" size={15} />
          </SecondaryButton>
        </div>
      </div>

      {/* tabs — roles + arrow keys (§12 FIXED) */}
      <div role="tablist" aria-label="Context sections" className="flex gap-6 border-b border-border">
        {CONTEXT_TABS.map((t) => {
          const selected = t.id === activeTab;
          return (
            <button
              key={t.id}
              ref={(el) => {
                tabRefs.current[t.id] = el;
              }}
              type="button"
              role="tab"
              id={`context-tab-${t.id}`}
              aria-selected={selected}
              aria-controls={`context-panel-${t.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setTab(t.id)}
              onKeyDown={onTabKeyDown}
              className={[
                "relative pb-3 text-[13px] transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
                selected ? "font-bold text-fg" : "font-semibold text-fg-muted hover:text-fg",
              ].join(" ")}
            >
              {t.label}
              {selected && (
                <span
                  className="absolute -bottom-px left-0 right-0 h-[2px] rounded-full bg-primary"
                  aria-hidden
                />
              )}
            </button>
          );
        })}
      </div>

      </div>

      <div
        role="tabpanel"
        id={`context-panel-${activeTab}`}
        aria-labelledby={`context-tab-${activeTab}`}
        className="flex min-h-0 flex-1 flex-col gap-[18px] overflow-y-auto px-6 py-[18px]"
      >
        {error ? (
          <ErrorState title="Couldn't load this context" description={error} onRetry={load} />
        ) : loading && !full ? (
          <Skeleton rows={6} />
        ) : activeTab === "overview" ? (
          <Overview
            summary={summary}
            full={full}
            readiness={readiness}
            onOpenDetail={onOpenDetail}
          />
        ) : activeTab === "qa" ? (
          <QaTab
            pairs={qa ?? []}
            open={openQa}
            onToggle={(i) => setOpenQa((cur) => (cur === i ? null : i))}
            generating={generating}
            onGenerate={onGenerate}
          />
        ) : activeTab === "briefing" ? (
          <DocumentTab
            text={briefing}
            emptyTitle="No briefing yet"
            emptyDescription="Conva writes the briefing from this context's sources when you generate its resources."
            generating={generating}
            onGenerate={onGenerate}
          />
        ) : (
          <DocumentTab
            text={research}
            emptyTitle="No research yet"
            emptyDescription={
              full?.research_enabled === false
                ? "Web research is switched off for this context. Turn it on in the context's settings, then generate its resources."
                : "Conva gathers web findings when you generate this context's resources."
            }
            generating={generating}
            onGenerate={onGenerate}
          />
        )}
      </div>

      {/* footer — regenerate, provenance, and the coaching hand-off */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-border px-6 py-4">
        <SecondaryButton onClick={onGenerate} disabled={generating}>
          <Icon name="rehearsal" size={15} />
          {generating ? "Generating…" : summary.has_generated_resources ? "Regenerate" : "Generate"}
        </SecondaryButton>
        {summary.resources_generated_at_unix_ms != null && (
          <span className="inline-flex items-center gap-2 font-mono text-[11px] text-fg-faint">
            <span className="h-2 w-2 rounded-[2px] bg-ai" aria-hidden />
            Generated by Conva ·{" "}
            {formatRelativeTime(summary.resources_generated_at_unix_ms)}
          </span>
        )}
        <SecondaryButton onClick={onOpenDetail}>
          Start coaching session
          <Icon name="chevron" size={15} className="-rotate-90" />
        </SecondaryButton>
      </div>
    </div>
  );
}

function Overview({
  summary,
  full,
  readiness,
  onOpenDetail,
}: {
  summary: ContextSummary;
  full: ConversationContext | null;
  readiness: ReturnType<typeof readinessOf>;
  onOpenDetail: () => void;
}) {
  const vocabulary = full?.glossary ?? [];
  const keyTerms = full?.key_terms ?? [];
  const persona = full?.personas.find((p) => p.id === full.chosen_persona_id) ?? null;

  return (
    <>
      {full?.purpose && (
        <div>
          <Eyebrow className="mb-2.5">Purpose</Eyebrow>
          <p className="max-w-[70ch] text-sm leading-relaxed text-fg-muted">{full.purpose}</p>
        </div>
      )}

      <div>
        <Eyebrow className="mb-2.5">Readiness</Eyebrow>
        <ul className="flex flex-col gap-2">
          {readiness.checks.map((c) => (
            <li key={c.label} className="flex items-start gap-2.5 text-[13px] leading-snug">
              <Icon
                name={c.ok ? "check" : "close"}
                size={15}
                className={`mt-px shrink-0 ${c.ok ? "text-ok" : c.advisory ? "text-notice" : "text-rec"}`}
              />
              <span className={c.ok ? "text-fg-muted" : "text-fg"}>
                {c.label}
                {!c.ok && c.advisory && (
                  <span className="ml-1.5 font-mono text-[10px] uppercase tracking-wider text-notice">
                    advisory
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {vocabulary.length > 0 && (
        <div>
          <Eyebrow className="mb-2.5">Core vocabulary</Eyebrow>
          <div className="flex flex-wrap gap-2">
            {vocabulary.slice(0, 24).map((v) => (
              <span
                key={v}
                className="rounded-[var(--radius)] border border-border bg-panel px-3 py-[7px] text-xs font-semibold text-fg-muted"
              >
                {v}
              </span>
            ))}
          </div>
        </div>
      )}

      {keyTerms.length > 0 && (
        <div>
          <Eyebrow className="mb-2.5">Your key points</Eyebrow>
          <div className="flex flex-wrap gap-2">
            {keyTerms.map((v) => (
              <span
                key={v}
                className="rounded-[var(--radius)] border border-primary/30 bg-primary/[0.08] px-3 py-[7px] text-xs font-semibold text-fg"
              >
                {v}
              </span>
            ))}
          </div>
        </div>
      )}

      <div>
        <Eyebrow className="mb-2.5">Counterparty</Eyebrow>
        {persona ? (
          <div className="flex flex-wrap items-center gap-3 rounded-[var(--radius)] border border-border bg-panel p-3.5">
            <Icon
              name={persona.gender === "female" ? "personaFemale" : "personaMale"}
              size={20}
              className="text-primary"
            />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-bold text-fg">{persona.title}</span>
              <span className="mt-0.5 block text-[11px] leading-relaxed text-fg-muted">
                {persona.summary}
              </span>
            </span>
            <SecondaryButton onClick={onOpenDetail}>Change</SecondaryButton>
          </div>
        ) : (
          <EmptyState
            title="No counterparty chosen"
            description="Ally builds three counterparty options from this context's material, then plays the one you pick during a coaching session."
            action={<PrimaryButton onClick={onOpenDetail}>Choose a counterparty</PrimaryButton>}
          />
        )}
      </div>

      <div>
        <Eyebrow className="mb-2.5">Sources</Eyebrow>
        <p className="text-[13px] text-fg-muted">
          {summary.source_doc_count === 0
            ? "No documents attached yet — attach them from the Library on the right."
            : `${summary.source_doc_count} document${
                summary.source_doc_count === 1 ? "" : "s"
              } attached${summary.research_enabled ? " · web research on" : ""}.`}
        </p>
      </div>
    </>
  );
}

function QaTab({
  pairs,
  open,
  onToggle,
  generating,
  onGenerate,
}: {
  pairs: PrepQaPair[];
  open: number | null;
  onToggle: (i: number) => void;
  generating: boolean;
  onGenerate: () => void;
}) {
  if (pairs.length === 0) {
    return (
      <EmptyState
        title="No prepared Q&A yet"
        description="Conva drafts likely questions and your answers from this context's sources when you generate its resources."
        action={
          <PrimaryButton onClick={onGenerate} disabled={generating}>
            {generating ? "Generating…" : "Generate resources"}
          </PrimaryButton>
        }
      />
    );
  }
  return (
    <div className="flex flex-col gap-2.5">
      <Eyebrow>Prepared Q&amp;A</Eyebrow>
      {pairs.map((p, i) => {
        const expanded = open === i;
        return (
          <div
            key={`${p.question}-${i}`}
            className={`rounded-[var(--radius)] border bg-panel ${
              expanded ? "border-border-strong" : "border-border"
            }`}
          >
            <button
              type="button"
              onClick={() => onToggle(i)}
              aria-expanded={expanded}
              className="flex w-full items-start gap-3 px-[18px] py-3.5 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              <span
                className="grid h-[22px] w-[22px] shrink-0 place-items-center rounded-[5px] bg-primary/[0.14] font-mono text-[11px] font-bold text-primary"
                aria-hidden
              >
                Q
              </span>
              <span
                className={`min-w-0 flex-1 text-sm leading-snug text-fg ${expanded ? "font-bold" : "font-semibold"}`}
              >
                {p.question}
              </span>
              <Icon
                name="chevron"
                size={16}
                className={`mt-0.5 shrink-0 text-fg-faint transition ${expanded ? "" : "-rotate-90"}`}
              />
            </button>
            <div className="flex items-start gap-3 px-[18px] pb-3.5">
              <span
                className="grid h-[22px] w-[22px] shrink-0 place-items-center rounded-[5px] bg-ai/[0.14] font-mono text-[11px] font-bold text-ai"
                aria-hidden
              >
                A
              </span>
              <span
                className={`min-w-0 flex-1 whitespace-pre-wrap text-[13px] leading-relaxed text-fg-muted ${
                  expanded ? "" : "line-clamp-2"
                }`}
              >
                {p.answer}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Briefing / Research — a generated markdown document, shown for scanning. */
function DocumentTab({
  text,
  emptyTitle,
  emptyDescription,
  generating,
  onGenerate,
}: {
  text: string | null;
  emptyTitle: string;
  emptyDescription: string;
  generating: boolean;
  onGenerate: () => void;
}) {
  if (!text || !text.trim()) {
    return (
      <EmptyState
        title={emptyTitle}
        description={emptyDescription}
        action={
          <PrimaryButton onClick={onGenerate} disabled={generating}>
            {generating ? "Generating…" : "Generate resources"}
          </PrimaryButton>
        }
      />
    );
  }
  return (
    <article className="max-w-[80ch] whitespace-pre-wrap break-words text-[13px] leading-relaxed text-fg-muted">
      {text}
    </article>
  );
}

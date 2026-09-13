import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  CONTEXT_TABS,
  defaultTab,
  tabForKey,
  type ContextTab,
} from "@/components/contexts/contextTabs";
import { readinessOf } from "@/components/contexts/readiness";
import {
  isPending,
  suggestionKey,
  visibleSuggestionValue,
  type SuggestionSection,
} from "@/components/contexts/suggestionReview";
import { GenerationProgressBar } from "@/components/context/ResourceGenerationStatus";
import { useGenerationProgress } from "@/components/context/useGenerationProgress";
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
import { MarkdownDocument } from "@/components/ui/MarkdownDocument";
import { useBackend } from "@/lib/backend";
import type { ContextSummary, ConversationContext, SuggestionDecision } from "@/lib/ipc";
import { formatRelativeTime } from "@/lib/relativeTime";

/** Small spinning ring used inside the Generate/Regenerate controls below —
 *  gold so it stays visible against both the neutral SecondaryButton and the
 *  solid-fill PrimaryButton (see the CLAUDE.md-adjacent lesson in #266: a
 *  dark ring is invisible on anything but a bright fill; gold reads on
 *  either). */
function Spinner() {
  return <span className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-ai/30 border-t-ai" />;
}

function qaValue(pair: PrepQaPair, decision?: SuggestionDecision) {
  if (!decision?.edited_value) return { question: pair.question, answer: pair.answer };
  try {
    const value = JSON.parse(decision.edited_value) as { question?: string; answer?: string };
    return {
      question: value.question?.trim() || pair.question,
      answer: value.answer?.trim() || pair.answer,
    };
  } catch {
    return { question: pair.question, answer: decision.edited_value };
  }
}

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
  const [qaFilter, setQaFilter] = useState<"all" | "yours" | "ally" | "dismissed">("all");
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const generationProgress = useGenerationProgress(generating, summary.id);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    backend.context
      .load(summary.id)
      .then(async (ctx) => {
        setFull(ctx);
        const docs = await backend.rag.list().catch(() => []);
        const qaSources = [
          ...(ctx.qa_doc_id ? [{ id: ctx.qa_doc_id, source: "ally" }] : []),
          ...ctx.source_doc_ids
            .filter((id) => id !== ctx.qa_doc_id)
            .map((id) => ({ id, source: docs.find((doc) => doc.id === id)?.file_name ?? id })),
        ];
        const [qaTexts, briefText, researchText] = await Promise.all([
          Promise.all(
            qaSources.map(async ({ id, source }) => ({
              source,
              text: await backend.rag.documentText(id).catch(() => null),
            })),
          ),
          ctx.dossier_doc_id
            ? backend.rag.documentText(ctx.dossier_doc_id).catch(() => null)
            : null,
          ctx.research_doc_id
            ? backend.rag.documentText(ctx.research_doc_id).catch(() => null)
            : null,
        ]);
        const seen = new Set<string>();
        const pairs = qaTexts
          .flatMap(({ text, source }) => (text ? parseQaPairs(text, source) : []))
          .filter((pair) => {
            const key = pair.question.toLowerCase();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          });
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
  const decisions = full?.suggestion_decisions ?? {};
  const qaDecisionKey = (pair: PrepQaPair) =>
    suggestionKey("qa", `${pair.question}\n${pair.answer}`);
  const briefingKey = briefing ? suggestionKey("briefing", briefing) : null;
  const researchKey = research ? suggestionKey("research", research) : null;
  const pendingByTab: Record<ContextTab, number> = {
    overview: (full?.glossary ?? []).filter((term) =>
      isPending(decisions[suggestionKey("overview", term)]),
    ).length,
    qa: (qa ?? []).filter(
      (pair) => pair.source === "ally" && isPending(decisions[qaDecisionKey(pair)]),
    ).length,
    briefing: briefingKey && isPending(decisions[briefingKey]) ? 1 : 0,
    research: researchKey && isPending(decisions[researchKey]) ? 1 : 0,
  };
  const pendingTotal = Object.values(pendingByTab).reduce((sum, count) => sum + count, 0);

  const saveDecision = async (
    section: SuggestionSection,
    value: string,
    decision: SuggestionDecision | null,
  ) => {
    if (!full) return;
    try {
      const suggestion_decisions = { ...(full.suggestion_decisions ?? {}) };
      const key = suggestionKey(section, value);
      if (decision) suggestion_decisions[key] = decision;
      else delete suggestion_decisions[key];
      const saved = await backend.context.save({
        ...full,
        suggestion_decisions,
      });
      setFull(saved);
    } catch {
      setError("Couldn't save that review decision.");
    }
  };

  const reviewNext = () => {
    const next = CONTEXT_TABS.find((item) => pendingByTab[item.id] > 0);
    if (next) setTab(next.id);
  };

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
      <div className="flex shrink-0 flex-col gap-[18px] px-[18px] pb-0 pt-[18px]">
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
          {pendingTotal > 0 && (
            <SecondaryButton onClick={reviewNext} className="text-ai" title="Review Ally suggestions">
              <Icon name="sparkle" size={15} />
              Review {pendingTotal}
            </SecondaryButton>
          )}
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
              {pendingByTab[t.id] > 0 && (
                <span className="ml-1.5 rounded-sm bg-ai/15 px-1.5 py-0.5 font-mono text-[10px] text-ai">
                  {pendingByTab[t.id]}
                </span>
              )}
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
        className="flex min-h-0 flex-1 flex-col gap-[18px] overflow-y-auto px-[18px] py-[18px]"
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
            decisions={decisions}
            onDecision={(value, decision) => void saveDecision("overview", value, decision)}
          />
        ) : activeTab === "qa" ? (
          <QaTab
            pairs={qa ?? []}
            open={openQa}
            onToggle={(i) => setOpenQa((cur) => (cur === i ? null : i))}
            generating={generating}
            onGenerate={onGenerate}
            filter={qaFilter}
            onFilter={setQaFilter}
            decisions={decisions}
            onDecision={(value, decision) => void saveDecision("qa", value, decision)}
          />
        ) : activeTab === "briefing" ? (
          <DocumentTab
            section="briefing"
            text={briefing}
            emptyTitle="No briefing yet"
            emptyDescription="Conva writes the briefing from this context's sources when you generate its resources."
            generating={generating}
            onGenerate={onGenerate}
            decision={briefingKey ? decisions[briefingKey] : undefined}
            onDecision={(decision) => briefing && void saveDecision("briefing", briefing, decision)}
            onRestore={() => briefing && void saveDecision("briefing", briefing, null)}
          />
        ) : (
          <DocumentTab
            section="research"
            text={research}
            emptyTitle="No research yet"
            emptyDescription={
              full?.research_enabled === false
                ? "Web research is switched off for this context. Turn it on in the context's settings, then generate its resources."
                : "Conva gathers web findings when you generate this context's resources."
            }
            generating={generating}
            onGenerate={onGenerate}
            decision={researchKey ? decisions[researchKey] : undefined}
            onDecision={(decision) => research && void saveDecision("research", research, decision)}
            onRestore={() => research && void saveDecision("research", research, null)}
          />
        )}
      </div>

      {/* Compact action rail — maintenance stays quiet; coaching is primary. */}
      <div className="flex shrink-0 flex-col gap-2 border-t border-border px-[18px] py-2.5">
        {generating && <GenerationProgressBar {...generationProgress} />}
        <div className="flex min-w-0 items-center gap-2">
          {summary.has_generated_resources ? (
            <button
              type="button"
              onClick={onGenerate}
              disabled={generating}
              aria-label={generating ? "Generating context resources" : "Regenerate context resources"}
              title={generating ? "Generating context resources…" : "Regenerate context resources"}
              className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-sm border transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-60 ${
                generating
                  ? "border-ai/40 bg-ai/10 text-ai"
                  : "border-border-strong text-fg-muted hover:border-primary/50 hover:bg-panel-raised hover:text-fg"
              }`}
            >
              {generating ? <Spinner /> : <Icon name="rehearsal" size={15} />}
            </button>
          ) : (
            <SecondaryButton
              onClick={onGenerate}
              disabled={generating}
              className={generating ? "border-ai/40 bg-ai/10 text-ai" : ""}
            >
              {generating ? <Spinner /> : <Icon name="rehearsal" size={15} />}
              {generating ? "Generating…" : "Generate"}
            </SecondaryButton>
          )}
          {summary.resources_generated_at_unix_ms != null && (
            <span className="min-w-0 truncate font-mono text-[11px] text-fg-faint">
              <span className="h-2 w-2 rounded-[2px] bg-ai" aria-hidden />
              <span className="ml-2">Generated {formatRelativeTime(summary.resources_generated_at_unix_ms)}</span>
            </span>
          )}
          <PrimaryButton onClick={onOpenDetail} className="ml-auto shrink-0">
            Start coaching
            <Icon name="chevron" size={15} className="-rotate-90" />
          </PrimaryButton>
        </div>
      </div>
    </div>
  );
}

function Overview({
  summary,
  full,
  readiness,
  onOpenDetail,
  decisions,
  onDecision,
}: {
  summary: ContextSummary;
  full: ConversationContext | null;
  readiness: ReturnType<typeof readinessOf>;
  onOpenDetail: () => void;
  decisions: Record<string, SuggestionDecision>;
  onDecision: (value: string, decision: SuggestionDecision | null) => void;
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
            {vocabulary.slice(0, 24).map((v) => {
              const decision = decisions[suggestionKey("overview", v)];
              return (
                <span
                  key={v}
                  className={`inline-flex items-center gap-1.5 rounded-[var(--radius)] border border-border bg-panel px-2 py-1 text-xs font-semibold text-fg-muted ${
                    decision?.status === "dismissed" ? "opacity-50 line-through" : ""
                  }`}
                >
                  <OwnershipBadge yours={decision?.status === "accepted"} />
                  {visibleSuggestionValue(v, decision)}
                  {isPending(decision) && (
                    <ReviewActions
                      compact
                      onAccept={() => onDecision(v, { status: "accepted" })}
                      onDismiss={() => onDecision(v, { status: "dismissed" })}
                    />
                  )}
                  {decision?.status === "dismissed" && (
                    <ReviewActions compact onRestore={() => onDecision(v, null)} />
                  )}
                </span>
              );
            })}
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
  filter,
  onFilter,
  decisions,
  onDecision,
}: {
  pairs: PrepQaPair[];
  open: number | null;
  onToggle: (i: number) => void;
  generating: boolean;
  onGenerate: () => void;
  filter: "all" | "yours" | "ally" | "dismissed";
  onFilter: (filter: "all" | "yours" | "ally" | "dismissed") => void;
  decisions: Record<string, SuggestionDecision>;
  onDecision: (value: string, decision: SuggestionDecision | null) => void;
}) {
  const [editing, setEditing] = useState<{
    value: string;
    question: string;
    answer: string;
  } | null>(null);
  if (pairs.length === 0) {
    return (
      <EmptyState
        title="No prepared Q&A yet"
        description="Conva drafts likely questions and your answers from this context's sources when you generate its resources."
        action={
          <PrimaryButton onClick={onGenerate} disabled={generating}>
            {generating && <Spinner />}
            {generating ? "Generating…" : "Generate resources"}
          </PrimaryButton>
        }
      />
    );
  }
  const visible = pairs.filter((pair) => {
    const value = `${pair.question}\n${pair.answer}`;
    const decision = decisions[suggestionKey("qa", value)];
    if (decision?.status === "dismissed") return filter === "dismissed";
    if (filter === "dismissed") return false;
    const yours = pair.source !== "ally" || decision?.status === "accepted";
    return filter === "all" || (filter === "yours" ? yours : !yours);
  });
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between gap-2">
        <Eyebrow>Prepared Q&amp;A</Eyebrow>
        <div className="flex items-center gap-1" aria-label="Filter prepared Q&A">
          {(["all", "yours", "ally", "dismissed"] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => onFilter(value)}
              className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold transition ${
                filter === value
                  ? "border-primary/60 bg-primary/10 text-primary"
                  : "border-border text-fg-muted hover:text-fg"
              }`}
            >
              {value === "all"
                ? "All"
                : value === "yours"
                  ? "Yours"
                  : value === "ally"
                    ? "Ally suggestions"
                    : "Dismissed"}
            </button>
          ))}
        </div>
      </div>
      {visible.map((p) => {
        const originalValue = `${p.question}\n${p.answer}`;
        const decision = decisions[suggestionKey("qa", originalValue)];
        const yours = p.source !== "ally" || decision?.status === "accepted";
        const shown = qaValue(p, decision);
        const i = pairs.indexOf(p);
        const expanded = open === i;
        return (
          <div
            key={suggestionKey("qa", originalValue)}
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
                {shown.question}
              </span>
              <Icon
                name="chevron"
                size={16}
                className={`mt-0.5 shrink-0 text-fg-faint transition ${expanded ? "" : "-rotate-90"}`}
              />
              <OwnershipBadge yours={yours} />
            </button>
            {editing?.value === originalValue ? (
              <div className="mx-[18px] mb-3.5 rounded-sm border border-primary/50 bg-panel-raised p-3">
                <label className="block text-[11px] font-semibold text-fg-muted">
                  Question
                  <input
                    className="input mt-1"
                    value={editing.question}
                    onChange={(event) => setEditing({ ...editing, question: event.target.value })}
                  />
                </label>
                <label className="mt-2 block text-[11px] font-semibold text-fg-muted">
                  Answer
                  <textarea
                    className="input mt-1"
                    rows={4}
                    value={editing.answer}
                    onChange={(event) => setEditing({ ...editing, answer: event.target.value })}
                  />
                </label>
                <div className="mt-2 flex justify-end gap-2">
                  <SecondaryButton onClick={() => setEditing(null)}>Cancel</SecondaryButton>
                  <PrimaryButton
                    onClick={() => {
                      onDecision(originalValue, {
                        status: "accepted",
                        edited_value: JSON.stringify({
                          question: editing.question,
                          answer: editing.answer,
                        }),
                      });
                      setEditing(null);
                    }}
                    disabled={!editing.question.trim() || !editing.answer.trim()}
                  >
                    Save
                  </PrimaryButton>
                </div>
              </div>
            ) : (
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
                {shown.answer}
              </span>
              <ReviewActions
                onRestore={
                  decision?.status === "dismissed" ? () => onDecision(originalValue, null) : undefined
                }
                onAccept={
                  !yours && decision?.status !== "dismissed"
                    ? () => onDecision(originalValue, { status: "accepted" })
                    : undefined
                }
                onEdit={decision?.status !== "dismissed" ? () =>
                  setEditing({ value: originalValue, question: shown.question, answer: shown.answer }) : undefined
                }
                onDismiss={decision?.status !== "dismissed" ? () => onDecision(originalValue, { status: "dismissed" }) : undefined}
              />
            </div>
            )}
          </div>
        );
      })}
      {visible.length === 0 && (
        <p className="py-8 text-center text-sm text-fg-faint">No Q&amp;A matches this filter.</p>
      )}
    </div>
  );
}

/** Briefing / Research — a generated markdown document, shown for scanning. */
function DocumentTab({
  section,
  text,
  emptyTitle,
  emptyDescription,
  generating,
  onGenerate,
  decision,
  onDecision,
  onRestore,
}: {
  section: "briefing" | "research";
  text: string | null;
  emptyTitle: string;
  emptyDescription: string;
  generating: boolean;
  onGenerate: () => void;
  decision?: SuggestionDecision;
  onDecision: (decision: SuggestionDecision) => void;
  onRestore?: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  if (!text || !text.trim()) {
    return (
      <EmptyState
        title={emptyTitle}
        description={emptyDescription}
        action={
          <PrimaryButton onClick={onGenerate} disabled={generating}>
            {generating && <Spinner />}
            {generating ? "Generating…" : "Generate resources"}
          </PrimaryButton>
        }
      />
    );
  }
  if (decision?.status === "dismissed") {
    return (
      <EmptyState
        title={`${section === "briefing" ? "Briefing" : "Research"} suggestion dismissed`}
        description="Ally's generated version is hidden. Regenerate to receive a new proposal."
        action={<SecondaryButton onClick={onRestore ?? onGenerate}>Restore suggestion</SecondaryButton>}
      />
    );
  }
  const shown = visibleSuggestionValue(text, decision);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 rounded-sm border border-ai/30 bg-ai/[0.06] px-3 py-2">
        <OwnershipBadge yours={decision?.status === "accepted"} />
        <span className="min-w-0 flex-1 text-xs text-fg-muted">
          {decision?.status === "accepted"
            ? "Your reviewed version"
            : `Ally suggested this ${section}`}
        </span>
        <ReviewActions
          onAccept={isPending(decision) ? () => onDecision({ status: "accepted" }) : undefined}
          onEdit={() => {
            setDraft(shown);
            setEditing(true);
          }}
          onDismiss={() => onDecision({ status: "dismissed" })}
        />
      </div>
      {editing ? (
        <div className="rounded-sm border border-primary/50 bg-panel p-3">
          <textarea
            aria-label={`Edit ${section}`}
            className="input min-h-64 font-mono text-xs"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
          <div className="mt-2 flex justify-end gap-2">
            <SecondaryButton onClick={() => setEditing(false)}>Cancel</SecondaryButton>
            <PrimaryButton
              disabled={!draft.trim()}
              onClick={() => {
                onDecision({ status: "accepted", edited_value: draft });
                setEditing(false);
              }}
            >
              Save
            </PrimaryButton>
          </div>
        </div>
      ) : (
        <MarkdownDocument text={shown} />
      )}
    </div>
  );
}

function OwnershipBadge({ yours }: { yours: boolean }) {
  return (
    <span
      className={`shrink-0 rounded-sm px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider ${
        yours ? "bg-primary/15 text-primary" : "bg-ai/15 text-ai"
      }`}
    >
      {yours ? "You" : "Ally"}
    </span>
  );
}

function ReviewActions({
  onAccept,
  onEdit,
  onDismiss,
  onRestore,
  compact = false,
}: {
  onAccept?: () => void;
  onEdit?: () => void;
  onDismiss?: () => void;
  onRestore?: () => void;
  compact?: boolean;
}) {
  const actionClass = compact
    ? "grid h-5 w-5 place-items-center rounded-sm text-fg-faint hover:bg-panel-raised hover:text-fg"
    : "grid h-7 w-7 shrink-0 place-items-center rounded-sm text-fg-faint hover:bg-panel-raised hover:text-fg";
  return (
    <span className="inline-flex shrink-0 items-center gap-0.5">
      {onRestore && (
        <button type="button" className={actionClass} onClick={onRestore} title="Restore" aria-label="Restore">
          <Icon name="rehearsal" size={compact ? 12 : 14} />
        </button>
      )}
      {onAccept && (
        <button type="button" className={actionClass} onClick={onAccept} title="Accept suggestion" aria-label="Accept suggestion">
          <Icon name="check" size={compact ? 12 : 14} />
        </button>
      )}
      {onEdit && (
        <button type="button" className={actionClass} onClick={onEdit} title="Edit" aria-label="Edit">
          <Icon name="edit" size={compact ? 12 : 14} />
        </button>
      )}
      {onDismiss && (
        <button type="button" className={actionClass} onClick={onDismiss} title="Dismiss" aria-label="Dismiss">
          <Icon name="close" size={compact ? 12 : 14} />
        </button>
      )}
    </span>
  );
}

import { useEffect, useRef, useState } from "react";

import {
  sectionOfGroup,
  type AllyFocusItem,
} from "@/components/transcript/allyFocus";
import { SECTION_META } from "@/components/transcript/panelSections";
import {
  pointsLabel,
  sayNowLabel,
  splitAnswer,
  talkingPoints,
} from "@/components/transcript/viewContent";
import {
  ChoicePrompt,
  GridAnswer,
  gridAsText,
} from "@/components/transcript/GridAnswer";
import { Icon } from "@/components/ui/Icon";
import { AnswerBody, inlineMd } from "@/lib/allyMarkdown";

const STATUS_LABEL: Record<AllyFocusItem["status"], string> = {
  instant: "Ready now",
  streaming: "Answering…",
  ready: "Ready",
  error: "Needs attention",
};

/** Per-type accent — questions azure, terms gold (Ally), tracking green.
 *  Full class strings so Tailwind can see them. */
const ACCENT = {
  questions: {
    text: "text-primary",
    border: "border-primary",
    callout: "border-primary bg-primary/[0.08]",
  },
  terms: {
    text: "text-ai",
    border: "border-ai",
    callout: "border-ai bg-ai/[0.08]",
  },
  tracking: {
    text: "text-ok",
    border: "border-ok",
    callout: "border-ok bg-ok/[0.08]",
  },
} as const;

function tabLabel(item: AllyFocusItem): string {
  const compact = item.question.replace(/\s+/g, " ").trim();
  return compact.length > 26 ? `${compact.slice(0, 25)}…` : compact;
}

function Eyebrow({ children }: { children: string }) {
  return (
    <div className="mb-1.5 font-mono text-[0.62em] font-bold uppercase tracking-[0.16em] text-fg-faint">
      {children}
    </div>
  );
}

/**
 * View (4) — the content surface (owner-approved mockup, 2026-09-29). One
 * tab strip of open items (type icon + colour, pinned first, a dot on an
 * item that arrived while you were reading another — it never steals the
 * view). Every item reads the same way: a fixed top row (source icon,
 * status/type, Pin · Copy · Elaborate), **Say now** (the line you can read
 * aloud), the rest of the answer in full, facts, then the sources. Nothing
 * is collapsed. Rendered by the partner window (panel 4) and, only where no
 * second window exists (web), embedded beside Active (3).
 */
export function ViewPanel({
  items,
  activeId,
  pinnedIds,
  onSelect,
  onTogglePin,
  onRefresh,
  onOpenSource,
  canOpenSource = () => true,
  onAsk,
  onChoose,
}: {
  items: readonly AllyFocusItem[];
  activeId: string | null;
  pinnedIds: ReadonlySet<string>;
  onSelect: (id: string) => void;
  onTogglePin: (id: string) => void;
  /** "Elaborate" — ask Ally for a fuller pass on this item. */
  onRefresh: (item: AllyFocusItem) => void;
  /** Open a grounding file (by name) — omitted where it can't be opened. */
  onOpenSource?: (fileName: string) => void;
  /** Which grounding files can actually be opened (default: all). */
  canOpenSource?: (fileName: string) => boolean;
  /** Follow-up question about the active item — omitted = no composer. */
  onAsk?: (item: AllyFocusItem, text: string) => void;
  /** Answer a live-assist question (which column, which file). */
  onChoose?: (item: AllyFocusItem, optionId: string) => void;
}) {
  const [raw, setRaw] = useState(false);
  const [ask, setAsk] = useState("");
  const [copied, setCopied] = useState(false);

  // Items already present when this mounts count as read; anything that
  // arrives later and isn't the open item gets a NEW dot until you open it.
  const viewed = useRef<Set<string> | null>(null);
  if (viewed.current === null) viewed.current = new Set(items.map((i) => i.id));
  const [, bump] = useState(0);

  const ordered = [...items].sort(
    (a, b) => Number(pinnedIds.has(b.id)) - Number(pinnedIds.has(a.id)),
  );
  const active = ordered.find((i) => i.id === activeId) ?? ordered[0] ?? null;

  useEffect(() => {
    if (!active || viewed.current!.has(active.id)) return;
    viewed.current!.add(active.id);
    bump((n) => n + 1);
  }, [active]);

  if (!active) {
    return (
      <section
        aria-label="View"
        className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 text-center"
      >
        <p className="text-[0.9em] leading-relaxed text-fg-faint">
          Pick something in Ally — or click a highlighted term in the
          conversation. Its answer shows up here.
        </p>
      </section>
    );
  }

  const section = sectionOfGroup(active.group);
  const meta = SECTION_META[section];
  const accent = ACCENT[section];
  const pinned = pinnedIds.has(active.id);
  const isError = active.status === "error";
  const parts = splitAnswer(active.answer);
  const files = active.sourceFiles ?? [];
  const facts = active.facts ?? [];

  const copy = () => {
    const text = [talkingPoints(parts) || active.answer, active.table ? gridAsText(active.table) : ""]
      .filter(Boolean)
      .join("\n\n");
    void navigator.clipboard
      ?.writeText(text)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1200);
      })
      .catch(() => {});
  };
  const submit = () => {
    const q = ask.trim();
    if (!q || !onAsk) return;
    setAsk("");
    onAsk(active, q);
  };

  return (
    <section aria-label="View" className="flex min-h-0 flex-1 flex-col">
      <div
        role="tablist"
        aria-label="Open items"
        className="flex shrink-0 items-end gap-0.5 overflow-x-auto border-b border-border bg-bg-2 px-2.5 pt-2"
      >
        {ordered.map((item, index) => {
          const isActive = item.id === active.id;
          const a = ACCENT[sectionOfGroup(item.group)];
          const m = SECTION_META[sectionOfGroup(item.group)];
          const unseen = !isActive && !viewed.current!.has(item.id);
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              id={`view-tab-${index}`}
              aria-selected={isActive}
              aria-controls="view-panel"
              tabIndex={isActive ? 0 : -1}
              onClick={() => onSelect(item.id)}
              onKeyDown={(event) => {
                const next =
                  event.key === "ArrowRight"
                    ? (index + 1) % ordered.length
                    : event.key === "ArrowLeft"
                      ? (index - 1 + ordered.length) % ordered.length
                      : null;
                if (next == null) return;
                event.preventDefault();
                onSelect(ordered[next]!.id);
              }}
              className={[
                "relative flex shrink-0 items-center gap-1.5 rounded-t-md border border-b-0 px-2.5 py-1.5 text-[0.78em] font-semibold whitespace-nowrap transition",
                isActive
                  ? `bg-bg text-fg ${a.border}`
                  : "border-transparent text-fg-muted hover:text-fg",
              ].join(" ")}
            >
              <span
                className={`grid h-4 w-4 place-items-center rounded-full border ${isActive || unseen ? a.border : "border-border-strong"} ${a.text}`}
                aria-hidden
              >
                <Icon name={m.icon} size={9} />
              </span>
              {pinnedIds.has(item.id) && <span aria-hidden>●</span>}
              {tabLabel(item)}
              {unseen && (
                <span
                  role="img"
                  aria-label="New"
                  className="h-[7px] w-[7px] rounded-full bg-primary"
                />
              )}
            </button>
          );
        })}
      </div>

      <div
        id="view-panel"
        role="tabpanel"
        aria-labelledby={`view-tab-${ordered.findIndex((i) => i.id === active.id)}`}
        className="flex min-h-0 flex-1 flex-col"
      >
        {/* Fixed top row: never moves as content streams in. */}
        <div className="flex shrink-0 items-center gap-2 px-4 pb-1 pt-3">
          <span
            role="img"
            aria-label={`${meta.label}: "${active.question}"`}
            title={`${meta.label}: "${active.question}"`}
            className={`grid h-[26px] w-[26px] shrink-0 cursor-help place-items-center rounded-full border ${accent.border} ${accent.text}`}
          >
            <Icon name={meta.icon} size={13} />
          </span>
          <span
            role="status"
            className={[
              "font-mono text-[0.68em] tracking-wide",
              isError ? "text-rec" : "text-fg-faint",
            ].join(" ")}
          >
            {STATUS_LABEL[active.status]}
          </span>
          {active.tier && (
            <span className="rounded-full bg-ai/15 px-2 py-0.5 font-mono text-[0.62em] uppercase tracking-wider text-ai">
              {active.tier}
            </span>
          )}
          {active.kind === "problem" && (
            <span className="rounded-full bg-notice/15 px-2 py-0.5 font-mono text-[0.62em] uppercase tracking-wider text-notice">
              problem
            </span>
          )}
          <span className="flex-1" />
          <button
            type="button"
            aria-pressed={pinned}
            onClick={() => onTogglePin(active.id)}
            className={[
              "flex h-7 items-center gap-1 rounded-md border px-2 text-[0.72em] font-bold transition",
              pinned
                ? "border-ai bg-ai/15 text-ai"
                : "border-border-strong text-fg-muted hover:text-fg",
            ].join(" ")}
          >
            <Icon name="pin" size={12} />
            {pinned ? "Pinned" : "Pin"}
          </button>
          <button
            type="button"
            onClick={copy}
            aria-label="Copy as talking points"
            title="Copy as talking points"
            className="flex h-7 items-center gap-1 rounded-md border border-border-strong px-2 text-[0.72em] font-bold text-fg-muted transition hover:text-fg"
          >
            <Icon name="copy" size={12} />
            {copied ? "Copied" : "Copy"}
          </button>
          <button
            type="button"
            onClick={() => onRefresh(active)}
            className="flex h-7 items-center gap-1 rounded-md border border-primary bg-primary/10 px-2.5 text-[0.72em] font-bold text-primary transition hover:brightness-110"
          >
            <Icon name="elaborate" size={12} />
            Elaborate
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto px-4 pb-3 pt-2">
          {isError ? (
            <p className="text-[0.95em] leading-relaxed text-rec">{active.answer}</p>
          ) : !active.answer && !active.table && !active.choice ? (
            <p className="text-[0.95em] text-fg-muted">Ally is preparing the response…</p>
          ) : raw ? (
            <div>
              <div className="mb-1.5 flex items-center">
                <Eyebrow>Raw</Eyebrow>
                <RawToggle raw={raw} onToggle={() => setRaw(false)} />
              </div>
              <pre className="whitespace-pre-wrap break-words font-mono text-[0.82em] text-fg-muted">
                {active.answer}
              </pre>
            </div>
          ) : (
            <>
              {active.stale && (
                <p
                  role="status"
                  className="rounded-md border border-dashed border-border-strong px-2.5 py-1.5 text-[0.84em] text-fg-muted"
                >
                  A newer question replaced this one before it finished.
                </p>
              )}
              {parts.sayNow && (
                <div className={active.stale ? "opacity-60" : undefined}>
                  <div className="flex items-center">
                    <Eyebrow>{sayNowLabel(active)}</Eyebrow>
                    <RawToggle raw={raw} onToggle={() => setRaw(true)} />
                  </div>
                  <p
                    className={`rounded-r-lg border-l-[3px] px-3.5 py-2.5 text-[1.12em] font-semibold leading-snug text-fg ${accent.callout}`}
                  >
                    {inlineMd(parts.sayNow)}
                  </p>
                </div>
              )}
              {facts.length > 0 && (
                <dl className="grid grid-cols-[4.5rem_1fr] gap-x-3 gap-y-1.5 text-[0.9em]">
                  {facts.map((f) => (
                    <div key={f.label} className="contents">
                      <dt className="pt-0.5 font-mono text-[0.68em] uppercase tracking-[0.1em] text-fg-faint">
                        {f.label}
                      </dt>
                      <dd className="text-fg">{f.value}</dd>
                    </div>
                  ))}
                </dl>
              )}
              {active.choice && (
                <ChoicePrompt
                  question={active.choice.question}
                  options={active.choice.options}
                  onChoose={onChoose ? (optionId) => onChoose(active, optionId) : undefined}
                />
              )}
              {active.table && (
                <div className={active.stale ? "opacity-60" : undefined}>
                  <GridAnswer grid={active.table} />
                </div>
              )}
              {parts.points && (
                <div>
                  <Eyebrow>{pointsLabel(active)}</Eyebrow>
                  <div className="text-[0.95em] leading-relaxed text-fg">
                    <AnswerBody text={parts.points} />
                  </div>
                </div>
              )}
              {parts.background && (
                <div>
                  <Eyebrow>Background</Eyebrow>
                  <div className="text-[0.9em] leading-relaxed text-fg-muted">
                    <AnswerBody text={parts.background} />
                  </div>
                </div>
              )}
            </>
          )}

          {files.length > 0 && (
            <div>
              <Eyebrow>From your documents</Eyebrow>
              <ul className="flex flex-col gap-1.5">
                {files.map((file) => (
                  <li key={file}>
                    {onOpenSource && canOpenSource(file) ? (
                      <button
                        type="button"
                        onClick={() => onOpenSource(file)}
                        title={`Open "${file}"`}
                        aria-label={`Open "${file}"`}
                        className="flex w-full items-center gap-2 rounded-lg border border-border-strong bg-panel-raised px-2.5 py-2 text-left text-[0.86em] text-fg-muted transition hover:text-fg"
                      >
                        <Icon name="file" size={13} className="shrink-0 text-primary" />
                        <span className="min-w-0 flex-1 truncate font-semibold text-fg">
                          {file}
                        </span>
                        <span className="shrink-0 text-primary">open ›</span>
                      </button>
                    ) : (
                      <span className="flex items-center gap-2 rounded-lg border border-border-strong bg-panel-raised px-2.5 py-2 text-[0.86em] text-fg-muted">
                        <Icon name="file" size={13} className="shrink-0 text-primary" />
                        <span className="min-w-0 truncate font-semibold text-fg">{file}</span>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {onAsk && (
          <div className="shrink-0 border-t border-border px-3 py-2.5">
            <label className="flex h-9 items-center gap-2.5 rounded-[4px] border border-ai/30 bg-white/[0.04] px-3 transition-colors focus-within:border-ai/60">
              <Icon name="lightbulb" size={16} className="shrink-0 text-ai/70" />
              <input
                value={ask}
                onChange={(e) => setAsk(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submit()}
                placeholder="Ask a follow-up…"
                aria-label="Ask a follow-up"
                className="min-w-0 flex-1 bg-transparent text-[0.9em] text-fg placeholder:text-fg-faint focus:outline-none"
              />
              <button
                type="button"
                onClick={submit}
                disabled={!ask.trim()}
                title="Ask Ally"
                aria-label="Ask Ally"
                className="shrink-0 rounded-[4px] p-1.5 text-ai transition-colors hover:bg-ai/10 disabled:opacity-30"
              >
                <Icon name="chevron" size={16} className="rotate-90" />
              </button>
            </label>
          </div>
        )}
      </div>
    </section>
  );
}

function RawToggle({ raw, onToggle }: { raw: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      title={raw ? "Show formatted" : "Show raw markdown"}
      className="ml-auto rounded border border-border px-1.5 py-0.5 font-mono text-[0.6em] uppercase tracking-wide text-fg-faint transition hover:text-fg"
    >
      {raw ? "Raw" : "Formatted"}
    </button>
  );
}

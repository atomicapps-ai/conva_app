import { useEffect, useRef } from "react";

import type { ViewEntry } from "@/components/transcript/viewEntries";
import { Icon } from "@/components/ui/Icon";

/**
 * The View half (spec §3.3): ONLY what the user chose — selected Found
 * items (rendered as known-content cards below, newest selection first —
 * owner, 2026-08-27: a fresh pick pushes the rest down and lands in view
 * without scrolling) interleaved with the Ally answer cards the parent
 * renders via `renderAnswerCards` (asks are choices too). Every card is
 * height-capped with a More/Less toggle; ✕ removes; re-selecting an item
 * focuses (scroll + ring) instead of duplicating — the parent passes
 * `focusKey` to drive that.
 */
export function ViewHistory({
  entries,
  focusKey,
  onToggleExpanded,
  onRemove,
  onFetchInfo,
  onDefine,
  onElaborate,
  onOpenInViewer,
  renderAnswerCards,
}: {
  entries: ViewEntry[];
  focusKey: string | null;
  onToggleExpanded: (key: string) => void;
  onRemove: (key: string) => void;
  /** Term/mention cards: research this item (streams into Answers). */
  onFetchInfo: (entry: ViewEntry) => void;
  onDefine: (entry: ViewEntry) => void;
  /** Question cards: promote the instant hit to a real Ally answer. */
  onElaborate: (entry: ViewEntry) => void;
  onOpenInViewer: (entry: ViewEntry) => void;
  /** The parent's existing answer-card feed (asks/summaries), rendered
   *  after the chosen entries so the auto-scrolled bottom stays newest. */
  renderAnswerCards: () => React.ReactNode;
}) {
  const els = useRef(new Map<string, HTMLElement>());

  useEffect(() => {
    if (!focusKey) return;
    const el = els.current.get(focusKey);
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [focusKey]);

  return (
    <div className="flex flex-col gap-2">
      {entries.length === 0 && (
        <p className="px-1 py-3 text-[0.86em] text-fg-faint">
          Select anything above — or ask Ally below — and it shows here, in
          order.
        </p>
      )}
      {entries.map((e) => (
        <article
          key={e.key}
          ref={(el) => {
            if (el) els.current.set(e.key, el);
            else els.current.delete(e.key);
          }}
          aria-label={e.item.label}
          className={[
            "relative rounded-[var(--radius)] border bg-panel p-2",
            focusKey === e.key
              ? "border-primary/60 ring-1 ring-primary/40"
              : "border-border",
          ].join(" ")}
        >
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-[0.9em] font-bold text-fg">
              {e.item.label}
            </span>
            <span className="shrink-0 font-mono text-[9px] uppercase text-fg-faint">
              {e.item.group}
            </span>
            <span className="flex shrink-0 gap-1">
              {e.item.group === "question" || e.item.group === "prep" ? (
                <button
                  type="button"
                  title="Elaborate — Ally answers this properly"
                  aria-label={`Elaborate on "${e.item.label}"`}
                  onClick={() => onElaborate(e)}
                  className="grid h-[22px] w-[22px] place-items-center rounded-[5px] border border-ai/45 bg-ai/10 text-ai transition hover:brightness-110"
                >
                  <Icon name="search" size={12} />
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    title="Fetch info — Ally researches this"
                    aria-label={`Fetch info on "${e.item.label}"`}
                    onClick={() => onFetchInfo(e)}
                    className="grid h-[22px] w-[22px] place-items-center rounded-[5px] border border-ai/45 bg-ai/10 text-ai transition hover:brightness-110"
                  >
                    <Icon name="search" size={12} />
                  </button>
                  <button
                    type="button"
                    title="Define"
                    aria-label={`Define "${e.item.label}"`}
                    onClick={() => onDefine(e)}
                    className="grid h-[22px] w-[22px] place-items-center rounded-[5px] border border-ai/45 bg-ai/10 text-ai transition hover:brightness-110"
                  >
                    <Icon name="book" size={12} />
                  </button>
                </>
              )}
              <button
                type="button"
                title="Open in viewer"
                aria-label={`Open "${e.item.label}" in the viewer`}
                onClick={() => onOpenInViewer(e)}
                className="grid h-[22px] w-[22px] place-items-center rounded-[5px] border border-primary/50 bg-primary/[0.12] text-primary transition hover:brightness-110"
              >
                <Icon name="expand" size={12} />
              </button>
              <button
                type="button"
                title="Remove from history"
                aria-label={`Remove "${e.item.label}"`}
                onClick={() => onRemove(e.key)}
                className="grid h-[22px] w-[22px] place-items-center rounded-[5px] border border-border text-fg-faint transition hover:text-rec"
              >
                <Icon name="close" size={11} />
              </button>
            </span>
          </div>

          <div
            className={
              e.expanded ? "mt-1.5" : "mt-1.5 max-h-[180px] overflow-hidden"
            }
          >
            {e.item.group === "prep" && e.item.prep ? (
              // A prepared pair: the answer is already written — show it
              // directly, tagged with where it came from. No re-research
              // (Elaborate above is the explicit deeper dig).
              <div className="flex flex-col gap-1">
                <p className="whitespace-pre-line text-[0.86em] leading-relaxed text-fg">
                  {e.item.prep.answer}
                </p>
                <p className="font-mono text-[9px] text-fg-faint">
                  From{" "}
                  {e.item.prep.source === "ally"
                    ? "Ally's Q&A research"
                    : e.item.prep.source}
                  {e.item.prep.theme ? ` — ${e.item.prep.theme}` : ""}
                </p>
              </div>
            ) : e.item.group === "question" && e.item.radar ? (
              <div className="flex flex-col gap-1">
                <p className="font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-primary">
                  Say now
                </p>
                <p className="text-[0.9em] font-medium leading-relaxed text-fg">
                  {e.item.radar.bridge.text}
                </p>
                {e.item.radar.outcome === "miss" ? (
                  <p className="mt-1 text-[0.8em] text-fg-faint">
                    No confident match in this Context — a refined answer is
                    starting in Answers.
                  </p>
                ) : (
                  <div className="mt-1 border-t border-border/60 pt-1">
                    {e.item.radar.sources
                      .slice(0, e.expanded ? 8 : 2)
                      .map((s, i) => (
                        <p
                          key={i}
                          className="text-[0.82em] leading-relaxed text-fg-muted"
                        >
                          <span className="font-mono text-[9px] text-fg-faint">
                            {s.file_name} · {s.location} —{" "}
                          </span>
                          {s.text}
                        </p>
                      ))}
                  </div>
                )}
              </div>
            ) : (
              <p className="text-[0.86em] leading-relaxed text-fg-muted">
                {e.item.chip?.capture?.preview ??
                  e.item.detail ??
                  "Fetch info or Define to research this."}
              </p>
            )}
          </div>

          <button
            type="button"
            onClick={() => onToggleExpanded(e.key)}
            aria-label={e.expanded ? "Less" : "More"}
            className="mt-1 text-[10.5px] font-semibold text-ai transition hover:underline"
          >
            {e.expanded ? "Less" : "More"}
          </button>
        </article>
      ))}
      {renderAnswerCards()}
    </div>
  );
}

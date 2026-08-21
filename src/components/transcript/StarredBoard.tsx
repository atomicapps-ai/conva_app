import { AnswerBody, cardLabel, ReasoningBlock, splitReasoning } from "@/components/transcript/allyRender";
import { Icon } from "@/components/ui/Icon";
import type { AllyCard } from "@/state/ally";

/**
 * The live-call default view of the right panel (F12 — see
 * docs/superpowers/specs/2026-08-21-live-panel-starred-board-design.md §4.2,
 * §6) — every starred card, oldest-first, each with a loading state while
 * its answer streams in. Reuses `allyRender.tsx`'s markdown rendering so a
 * starred card reads identically here and in the inline transcript /
 * `ThreadViewer` — no second copy of "how an Ally answer renders."
 */
export function StarredBoard({
  cards,
  starredIds,
  onUnstar,
  onOpenViewer,
  barPad,
}: {
  cards: AllyCard[];
  starredIds: Set<string>;
  onUnstar: (id: string) => void;
  onOpenViewer: (card: AllyCard) => void;
  barPad: string;
}) {
  // `cards` is newest-first; the board reads oldest-first (design doc §4.2).
  const starredCards = [...cards].filter((c) => starredIds.has(c.id)).reverse();

  return (
    <aside className={`flex h-full w-[300px] shrink-0 flex-col border-l border-border bg-bg-2${barPad}`}>
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-4">
        <Icon name="star" size={14} filled className="text-ai" />
        <span className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-ai">
          Starred
        </span>
        <span className="ml-auto font-mono text-[10.5px] text-fg-faint">
          {starredCards.length} card{starredCards.length === 1 ? "" : "s"}
        </span>
      </div>

      <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-3">
        {starredCards.length === 0 ? (
          <p className="mt-6 text-center text-[12px] text-fg-faint">
            Star a quote in the transcript — click the star on any Ask Ally
            popover or selection menu — and it lands here.
          </p>
        ) : (
          starredCards.map((card) => {
            const label = cardLabel(card);
            const { answer, context } = splitReasoning(card.text);
            const sayText = answer || card.text;
            const loading = !card.done && !card.error;
            return (
              <div
                key={card.id}
                className="rounded-[var(--radius)] border border-ai/30 bg-panel p-3"
              >
                <div className="mb-1.5 flex items-center gap-2">
                  <span className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-ai">
                    {label}
                  </span>
                  {loading && (
                    <span className="text-[10.5px] text-fg-faint" role="status">
                      thinking…
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => onOpenViewer(card)}
                    title="Open in viewer"
                    aria-label={`Open A${card.seq} in the viewer`}
                    className="ml-auto rounded p-0.5 text-fg-faint transition-colors hover:text-ai"
                  >
                    <Icon name="expand" size={13} />
                  </button>
                  <button
                    type="button"
                    onClick={() => onUnstar(card.id)}
                    title="Remove from your board"
                    aria-label={`Unstar A${card.seq}`}
                    className="rounded p-0.5 text-ai transition-colors hover:text-fg"
                  >
                    <Icon name="star" size={13} filled />
                  </button>
                </div>
                {card.sourceQuote && (
                  <p className="mb-1.5 text-[11.5px] italic leading-relaxed text-fg-muted">
                    “{card.sourceQuote}”
                  </p>
                )}
                {card.error ? (
                  <p className="text-[12px] text-rec">{card.error}</p>
                ) : sayText ? (
                  <div className="text-[12.5px] leading-relaxed text-fg">
                    <AnswerBody text={sayText} />
                  </div>
                ) : (
                  <p className="text-[12px] text-fg-faint">…</p>
                )}
                {context && <ReasoningBlock text={context} />}
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
}

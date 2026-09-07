import type { ReactNode } from "react";

import type { AllyFocusItem } from "@/components/transcript/allyFocus";
import { Icon } from "@/components/ui/Icon";

const STATUS_LABEL: Record<AllyFocusItem["status"], string> = {
  instant: "Ready now",
  streaming: "Answering…",
  ready: "Ready",
  error: "Needs attention",
};

function tabLabel(item: AllyFocusItem): string {
  const compact = item.question.replace(/\s+/g, " ").trim();
  return compact.length > 34 ? `${compact.slice(0, 33)}…` : compact;
}

export function AllyFocusCanvas({
  items,
  activeId,
  pinnedIds,
  onSelect,
  onTogglePin,
  onRefresh,
  onOpen,
  canOpen = () => true,
  renderAnswer,
}: {
  items: readonly AllyFocusItem[];
  activeId: string | null;
  pinnedIds: ReadonlySet<string>;
  onSelect: (id: string) => void;
  onTogglePin: (id: string) => void;
  onRefresh: (item: AllyFocusItem) => void;
  onOpen: (item: AllyFocusItem) => void;
  canOpen?: (item: AllyFocusItem) => boolean;
  renderAnswer?: (text: string) => ReactNode;
}) {
  if (items.length === 0) return null;
  const active = items.find((item) => item.id === activeId) ?? items[0]!;
  const pinned = pinnedIds.has(active.id);
  const orderedItems = [...items].sort((a, b) => {
    const pinDelta = Number(pinnedIds.has(b.id)) - Number(pinnedIds.has(a.id));
    return pinDelta;
  });
  const activeTabIndex = orderedItems.findIndex((item) => item.id === active.id);

  return (
    <section
      aria-label="Question and answer focus"
      className="flex min-h-0 flex-[3] flex-col border-b border-border bg-panel"
    >
      <div
        role="tablist"
        aria-label="Active question threads"
        className="flex shrink-0 gap-1 overflow-x-auto border-b border-border px-2 py-1.5"
      >
        {orderedItems.map((item, index) => (
          <button
            key={item.id}
            id={`ally-focus-tab-${index}`}
            type="button"
            role="tab"
            aria-controls="ally-focus-panel"
            aria-selected={item.id === active.id}
            tabIndex={item.id === active.id ? 0 : -1}
            onClick={() => onSelect(item.id)}
            onKeyDown={(event) => {
              const current = orderedItems.findIndex(
                (candidate) => candidate.id === active.id,
              );
              const nextIndex =
                event.key === "ArrowRight"
                  ? (current + 1) % orderedItems.length
                  : event.key === "ArrowLeft"
                    ? (current - 1 + orderedItems.length) % orderedItems.length
                    : event.key === "Home"
                      ? 0
                      : event.key === "End"
                        ? orderedItems.length - 1
                        : null;
              if (nextIndex == null) return;
              event.preventDefault();
              onSelect(orderedItems[nextIndex]!.id);
            }}
            className={[
              "max-w-[180px] shrink-0 truncate rounded-full border px-2 py-1 text-[10px] font-medium transition",
              item.id === active.id
                ? "border-primary/55 bg-primary/10 text-primary"
                : "border-border bg-bg-2 text-fg-muted hover:text-fg",
            ].join(" ")}
          >
            {pinnedIds.has(item.id) && <span aria-hidden>● </span>}
            {tabLabel(item)}
          </button>
        ))}
      </div>

      <div
        id="ally-focus-panel"
        role="tabpanel"
        aria-labelledby={`ally-focus-tab-${activeTabIndex}`}
        className="flex min-h-0 flex-1 flex-col"
      >
        <div className="shrink-0 border-b border-border/70 px-3 py-2">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-primary">
              Question
            </span>
            <span className="ml-auto font-mono text-[9px] text-fg-faint">
              {active.sourceLabel}
            </span>
          </div>
          <p className="mt-1 text-[0.92em] font-semibold leading-snug text-fg">
            {active.question}
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2.5">
          <div className="mb-2 flex items-center gap-2">
            <span className="font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-ai">
              Answer
            </span>
            <span
              role="status"
              className={[
                "ml-auto text-[10px]",
                active.status === "error" ? "text-rec" : "text-fg-faint",
              ].join(" ")}
            >
              {STATUS_LABEL[active.status]}
            </span>
          </div>
          <div className="text-[0.9em] leading-relaxed text-fg">
            {active.answer
              ? renderAnswer?.(active.answer) ?? (
                  <p className="whitespace-pre-line">{active.answer}</p>
                )
              : "Ally is preparing the response…"}
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-t border-border/70 px-2.5 py-2">
          <button
            type="button"
            aria-pressed={pinned}
            onClick={() => onTogglePin(active.id)}
            className={[
              "flex h-7 items-center gap-1 rounded border px-2 text-[10.5px] transition",
              pinned
                ? "border-ai/55 bg-ai/10 text-ai"
                : "border-border text-fg-muted hover:text-fg",
            ].join(" ")}
          >
            <Icon name="pin" size={12} />
            {pinned ? "Pinned" : "Pin"}
          </button>
          <button
            type="button"
            onClick={() => onRefresh(active)}
            className="h-7 rounded border border-border px-2 text-[10.5px] text-fg-muted transition hover:text-fg"
          >
            Refresh
          </button>
          {canOpen(active) && (
            <button
              type="button"
              onClick={() => onOpen(active)}
              className="ml-auto flex h-7 items-center gap-1 rounded border border-primary/45 bg-primary/[0.08] px-2 text-[10.5px] text-primary transition hover:brightness-110"
            >
              <Icon name="expand" size={12} />
              Expand
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

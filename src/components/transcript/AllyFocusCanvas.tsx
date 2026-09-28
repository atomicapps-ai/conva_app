import { useState, type ReactNode } from "react";

import type { AllyFocusItem } from "@/components/transcript/allyFocus";
import type { FoundItem } from "@/components/transcript/foundGroups";
import {
  SECTION_META,
  SECTION_ORDER,
  type PanelSectionId,
} from "@/components/transcript/panelSections";
import { Icon, type IconName } from "@/components/ui/Icon";

const STATUS_LABEL: Record<AllyFocusItem["status"], string> = {
  instant: "Ready now",
  streaming: "Answering…",
  ready: "Ready",
  error: "Needs attention",
};

/** The bottom eyebrow above the content — "Answer" for a question, but a
 *  term/commitment/mention isn't being "answered," it's being defined or
 *  detailed (owner, 2026-09-28). */
const CONTENT_LABEL: Record<AllyFocusItem["group"], string> = {
  question: "Answer",
  prep: "Answer",
  term: "Definition",
  commitment: "Detail",
  mention: "Detail",
};

/** Maps a `FoundItem`/`AllyFocusItem` group to the Active panel section it
 *  belongs under — the same mapping the cockpit uses to keep Active (3) and
 *  View (4) in sync. */
export function sectionOfGroup(group: FoundItem["group"]): PanelSectionId {
  if (group === "question" || group === "prep") return "questions";
  if (group === "commitment" || group === "mention") return "tracking";
  return "terms";
}

function tabLabel(item: AllyFocusItem): string {
  const compact = item.question.replace(/\s+/g, " ").trim();
  return compact.length > 34 ? `${compact.slice(0, 33)}…` : compact;
}

/**
 * View (4) — content-first (owner, 2026-09-28,
 * "live-panel-4-panel-split" plan). An outer tab strip picks the TYPE
 * (Questions/Tracking/Terms, mirrors Active's accordion sections); within a
 * type, the existing per-item tab strip (unchanged from the original Focus
 * canvas) lets several asks of that type coexist, pinned ones floating
 * first. The header row shrinks the source item (question/term/phrase) to
 * one hover/focus-tooltip icon — Active already showed it in context — so
 * Pin and Elaborate, not the prompt, are what's in front of you; the
 * definition/answer text is the dominant element below.
 */
export function AllyFocusCanvas({
  items,
  activeId,
  activeType,
  pinnedIds,
  onSelect,
  onSelectType,
  onTogglePin,
  onRefresh,
  onOpen,
  canOpen = () => true,
  renderAnswer,
}: {
  items: readonly AllyFocusItem[];
  activeId: string | null;
  /** Which type-tab is showing. Driven by the same state as Active's open
   *  accordion section, so the two stay in lockstep. */
  activeType: PanelSectionId;
  pinnedIds: ReadonlySet<string>;
  onSelect: (id: string) => void;
  onSelectType: (t: PanelSectionId) => void;
  onTogglePin: (id: string) => void;
  /** "Elaborate" — ask Ally for a fuller pass on this item. */
  onRefresh: (item: AllyFocusItem) => void;
  onOpen: (item: AllyFocusItem) => void;
  canOpen?: (item: AllyFocusItem) => boolean;
  renderAnswer?: (text: string) => ReactNode;
}) {
  const [raw, setRaw] = useState(false);
  const typesPresent = SECTION_ORDER.filter((id) =>
    items.some((item) => sectionOfGroup(item.group) === id),
  );
  if (typesPresent.length === 0) return null;
  const type = typesPresent.includes(activeType) ? activeType : typesPresent[0]!;
  const typeItems = items.filter((item) => sectionOfGroup(item.group) === type);
  const active = typeItems.find((item) => item.id === activeId) ?? typeItems[0]!;
  const pinned = pinnedIds.has(active.id);
  const orderedItems = [...typeItems].sort((a, b) => {
    const pinDelta = Number(pinnedIds.has(b.id)) - Number(pinnedIds.has(a.id));
    return pinDelta;
  });
  const activeTabIndex = orderedItems.findIndex((item) => item.id === active.id);
  const typeMeta = SECTION_META[type];

  return (
    <section
      aria-label="View"
      className="flex min-h-0 flex-1 flex-col border-y border-r border-border bg-panel"
    >
      {/* Outer type tabs — mirrors Active's sections, always visible when
          more than one type has anything to show. */}
      {typesPresent.length > 1 && (
        <div
          role="tablist"
          aria-label="Item type"
          className="flex shrink-0 gap-1 overflow-x-auto border-b border-border px-2 py-1.5"
        >
          {typesPresent.map((id) => {
            const meta = SECTION_META[id];
            const lit = id === type;
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={lit}
                onClick={() => onSelectType(id)}
                className={[
                  "flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10.5px] font-semibold transition",
                  lit
                    ? "border-ai/55 bg-ai/10 text-ai"
                    : "border-border bg-bg-2 text-fg-muted hover:text-fg",
                ].join(" ")}
              >
                <Icon name={meta.icon} size={11} />
                {meta.label}
              </button>
            );
          })}
        </div>
      )}

      {orderedItems.length > 1 && (
        <div
          role="tablist"
          aria-label="Active threads"
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
      )}

      <div
        id="ally-focus-panel"
        role="tabpanel"
        aria-labelledby={
          orderedItems.length > 1 ? `ally-focus-tab-${activeTabIndex}` : undefined
        }
        className="flex min-h-0 flex-1 flex-col"
      >
        {/* Content-first header: the source item is one hover/focus
            tooltip icon, never a heading — Pin and Elaborate are the
            fast, always-visible actions. */}
        <div className="flex shrink-0 items-center gap-2 border-b border-border/70 px-3 py-2">
          <span
            role="img"
            aria-label={`${typeMeta.label}: "${active.question}"`}
            title={`${typeMeta.label}: "${active.question}"`}
            className="grid h-[26px] w-[26px] shrink-0 cursor-help place-items-center rounded-full border border-border-strong text-fg-muted"
          >
            <Icon name={typeMeta.icon as IconName} size={13} />
          </span>
          <span
            role="status"
            className={[
              "text-[10px]",
              active.status === "error" ? "text-rec" : "text-fg-faint",
            ].join(" ")}
          >
            {STATUS_LABEL[active.status]}
          </span>
          <span className="flex-1" />
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
            className="flex h-7 items-center gap-1 rounded border border-primary/45 bg-primary/[0.08] px-2 text-[10.5px] font-semibold text-primary transition hover:brightness-110"
          >
            Elaborate
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2.5">
          <div className="mb-2 flex items-center gap-2">
            <span className="font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-ai">
              {CONTENT_LABEL[active.group]}
            </span>
            {active.answer && renderAnswer && (
              <button
                type="button"
                onClick={() => setRaw((r) => !r)}
                title={raw ? "Show formatted" : "Show raw markdown"}
                className="ml-auto rounded border border-border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide text-fg-faint transition hover:text-fg"
              >
                {raw ? "Raw" : "Formatted"}
              </button>
            )}
          </div>
          <div className="text-[1.05em] font-medium leading-relaxed text-fg">
            {active.answer
              ? raw
                ? <pre className="whitespace-pre-wrap break-words font-mono text-[0.8em]">{active.answer}</pre>
                : (renderAnswer?.(active.answer) ?? (
                    <p className="whitespace-pre-line">{active.answer}</p>
                  ))
              : "Ally is preparing the response…"}
          </div>
          {active.sourceFiles && active.sourceFiles.length > 0 && (
            <p className="mt-2 flex items-center gap-1.5 font-mono text-[10px] text-fg-faint">
              <Icon name="file" size={12} className="shrink-0 text-ai" />
              <span className="min-w-0 truncate">
                Grounded in {active.sourceFiles.join(" · ")}
              </span>
            </p>
          )}
        </div>

        {canOpen(active) && (
          <div className="flex shrink-0 items-center border-t border-border/70 px-2.5 py-2">
            <button
              type="button"
              onClick={() => onOpen(active)}
              className="ml-auto flex h-7 items-center gap-1 rounded border border-primary/45 bg-primary/[0.08] px-2 text-[10.5px] text-primary transition hover:brightness-110"
            >
              <Icon name="expand" size={12} />
              Expand
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

import type { ReactNode } from "react";

import {
  SECTION_META,
  SECTION_ORDER,
  selectSection,
  togglePin,
  type PanelSectionId,
  type PanelState,
} from "@/components/transcript/panelSections";
import { Icon } from "@/components/ui/Icon";

/**
 * The spine-icon accordion (spec 2026-08-26). Each section renders its own
 * spine icon chip absolutely positioned ON the panel's left border
 * (`left-0 -translate-x-1/2`) at the section's top edge — icons slide with
 * their sections while the stacking order stays fixed. Exactly one content
 * section is expanded; Answers can be pinned as a bottom dock whose height
 * is the (1 − splitRatio) share, resized by the divider above it (the
 * pref is shared with the retired split view — same key, same clamps).
 */
export function AllyAccordion({
  state,
  onState,
  counts,
  splitRatio,
  onSplitRatio,
  renderSection,
  questionsMode = "live",
  onQuestionsMode = () => {},
  prepCount = 0,
  liveUnseen = false,
}: {
  state: PanelState;
  onState: (next: PanelState) => void;
  counts: Record<PanelSectionId, number>;
  splitRatio: number;
  onSplitRatio: (r: number) => void;
  renderSection: (id: PanelSectionId) => ReactNode;
  /** Questions sub-mode (split-source spec 2026-08-27): "live" = the radar
   *  feed (counts.questions), "prep" = the prepared Q&A bank (prepCount).
   *  The two chips live in the Questions header — the same in-header
   *  control slot Answers' pin uses; sections still switch ONLY via the
   *  spine icons. */
  questionsMode?: "live" | "prep";
  onQuestionsMode?: (m: "live" | "prep") => void;
  prepCount?: number;
  /** Live questions arrived while in prep mode — a dot on the ◉ chip;
   *  never auto-switches. */
  liveUnseen?: boolean;
}) {
  const select = (id: PanelSectionId) => {
    const next = selectSection(state, id);
    if (next !== state) onState(next);
  };

  const contentIds = SECTION_ORDER.filter(
    (id) => id !== "answers" || !state.answersPinned,
  );

  const sectionShell = (id: PanelSectionId) => {
    const meta = SECTION_META[id];
    const open = state.open === id;
    const lit = open || (id === "answers" && state.answersPinned);
    const count = counts[id];
    return (
      <div
        key={id}
        className={[
          "relative flex min-h-0 flex-col border-t border-border first:border-t-0",
          open ? "min-h-0 flex-1" : "shrink-0",
        ].join(" ")}
      >
        {/* Spine icon — overlays the center divider at this section's top. */}
        <button
          type="button"
          aria-label={meta.label}
          title={meta.label}
          onClick={() => select(id)}
          className={[
            "absolute left-0 top-1 z-40 grid h-[26px] w-[26px] -translate-x-1/2 place-items-center rounded-full border shadow-sm transition",
            lit
              ? meta.tone === "ai"
                ? "border-ai/60 bg-bg-2 text-ai"
                : "border-primary/60 bg-bg-2 text-primary"
              : "border-border bg-bg-2 text-fg-faint hover:text-fg",
          ].join(" ")}
        >
          <Icon name={meta.icon} size={14} />
        </button>
        <button
          type="button"
          onClick={() => select(id)}
          aria-expanded={open}
          className={[
            "flex h-8 shrink-0 items-center gap-2 pl-5 pr-2.5 text-left",
            open ? "text-fg" : "text-fg-muted hover:text-fg",
          ].join(" ")}
        >
          <span className="font-mono text-[10px] font-bold uppercase tracking-[0.18em]">
            {meta.label}
          </span>
          {id !== "questions" && count > 0 && (
            <span className="rounded-full border border-border px-1.5 text-[10px] text-fg-faint">
              {count}
            </span>
          )}
          {/* Questions mode chips (split-source spec 2026-08-27): ◉ Live
              (azure, the radar feed) · ◈ Prep (gold, the prepared bank).
              In-header controls like Answers' pin — they switch what this
              ONE section shows, never which section is open (though
              picking a mode does open Questions if it wasn't). */}
          {id === "questions" && (
            <span className="ml-auto flex items-center gap-1">
              {(["live", "prep"] as const).map((m) => {
                const active = questionsMode === m;
                const n = m === "live" ? count : prepCount;
                return (
                  <span
                    key={m}
                    role="button"
                    tabIndex={0}
                    aria-pressed={active}
                    aria-label={
                      m === "live"
                        ? `Live questions (${n})`
                        : `Prepared Q&A (${n})`
                    }
                    title={
                      m === "live"
                        ? "Live — questions the other side asks"
                        : "Prep — researched & imported Q&A"
                    }
                    onClick={(e) => {
                      e.stopPropagation();
                      onQuestionsMode(m);
                      select(id);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.stopPropagation();
                        onQuestionsMode(m);
                        select(id);
                      }
                    }}
                    className={[
                      "relative flex h-5 items-center gap-1 rounded-full border px-1.5 font-mono text-[9.5px] font-bold",
                      active
                        ? m === "live"
                          ? "border-primary/60 bg-primary/10 text-primary"
                          : "border-ai/60 bg-ai/10 text-ai"
                        : "border-border text-fg-faint hover:text-fg",
                    ].join(" ")}
                  >
                    <Icon name={m === "live" ? "live" : "howto"} size={10} />
                    {n}
                    {m === "live" && liveUnseen && !active && (
                      <span
                        aria-hidden
                        className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-primary"
                      />
                    )}
                  </span>
                );
              })}
            </span>
          )}
          {id === "answers" && (
            <span
              role="button"
              tabIndex={0}
              aria-pressed={state.answersPinned}
              aria-label="Pin Answers"
              title={state.answersPinned ? "Unpin Answers" : "Pin Answers"}
              onClick={(e) => {
                e.stopPropagation();
                onState(togglePin(state));
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.stopPropagation();
                  onState(togglePin(state));
                }
              }}
              className={`ml-auto grid h-6 w-6 place-items-center rounded ${
                state.answersPinned ? "text-ai" : "text-fg-faint hover:text-fg"
              }`}
            >
              <Icon name="pin" size={13} />
            </span>
          )}
        </button>
        {open && (
          <div className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-2">
            {renderSection(id)}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        style={
          state.answersPinned ? { flexBasis: `${splitRatio * 100}%` } : undefined
        }
        className={[
          "flex min-h-0 flex-col",
          state.answersPinned ? "shrink-0 grow-0" : "min-h-0 flex-1",
        ].join(" ")}
      >
        {contentIds.map(sectionShell)}
      </div>

      {state.answersPinned && (
        <>
          <div
            role="separator"
            aria-orientation="horizontal"
            aria-label="Resize Answers"
            onPointerDown={(e) => {
              const host = e.currentTarget.parentElement;
              if (!host) return;
              const rect = host.getBoundingClientRect();
              const move = (ev: PointerEvent) =>
                onSplitRatio((ev.clientY - rect.top) / rect.height);
              const up = () => {
                window.removeEventListener("pointermove", move);
                window.removeEventListener("pointerup", up);
              };
              window.addEventListener("pointermove", move);
              window.addEventListener("pointerup", up);
            }}
            className="h-[5px] shrink-0 cursor-row-resize border-y border-border bg-bg-2 hover:bg-panel-raised"
          />
          <div className="relative flex min-h-0 flex-1 flex-col">
            {(() => {
              const meta = SECTION_META.answers;
              return (
                <>
                  <span
                    aria-hidden
                    className="absolute left-0 top-1 z-40 grid h-[26px] w-[26px] -translate-x-1/2 place-items-center rounded-full border border-ai/60 bg-bg-2 text-ai shadow-sm"
                  >
                    <Icon name={meta.icon} size={14} />
                  </span>
                  <div className="flex h-8 shrink-0 items-center gap-2 pl-5 pr-2.5">
                    <span className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-fg">
                      {meta.label}
                    </span>
                    {counts.answers > 0 && (
                      <span className="rounded-full border border-border px-1.5 text-[10px] text-fg-faint">
                        {counts.answers}
                      </span>
                    )}
                    <button
                      type="button"
                      aria-pressed
                      aria-label="Pin Answers"
                      title="Unpin Answers"
                      onClick={() => onState(togglePin(state))}
                      className="ml-auto grid h-6 w-6 place-items-center rounded text-ai"
                    >
                      <Icon name="pin" size={13} />
                    </button>
                  </div>
                  <div className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-2">
                    {renderSection("answers")}
                  </div>
                </>
              );
            })()}
          </div>
        </>
      )}
    </div>
  );
}

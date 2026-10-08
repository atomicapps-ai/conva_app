import type { ReactNode } from "react";

import {
  SECTION_META,
  SECTION_ORDER,
  selectSection,
  type PanelSectionId,
  type PanelState,
} from "@/components/transcript/panelSections";
import { Icon } from "@/components/ui/Icon";

/**
 * Active (3) — the spine-icon accordion (spec 2026-08-26; Answers dock
 * retired 2026-09-28, its content now lives in View). Each section renders
 * its own spine icon chip absolutely positioned ON the panel's left border
 * (`left-0 -translate-x-1/2`) at the section's top edge — icons slide with
 * their sections while the stacking order stays fixed. Exactly one content
 * section is expanded. A section with unseen finds shows a NEW badge next
 * to its count, cleared the moment it's opened.
 */
export function AllyAccordion({
  state,
  onState,
  counts,
  newCounts = {},
  renderSection,
  questionsMode = "live",
  onQuestionsMode = () => {},
  prepCount = 0,
  liveUnseen = false,
}: {
  state: PanelState;
  onState: (next: PanelState) => void;
  counts: Record<PanelSectionId, number>;
  /** Unseen-item count per section (owner, 2026-09-28) — a section with a
   *  positive count here shows a NEW badge on its header. */
  newCounts?: Partial<Record<PanelSectionId, number>>;
  renderSection: (id: PanelSectionId) => ReactNode;
  /** Questions sub-mode (split-source spec 2026-08-27): "live" = the radar
   *  feed (counts.questions), "prep" = the prepared Q&A bank (prepCount).
   *  The two chips live in the Questions header; sections still switch only
   *  via the spine icons. */
  questionsMode?: "live" | "prep";
  onQuestionsMode?: (m: "live" | "prep") => void;
  prepCount?: number;
  /** Live questions arrived while in prep mode — a dot on the ◉ chip;
   *  never auto-switches. */
  liveUnseen?: boolean;
}) {
  const select = (id: PanelSectionId) => {
    const next = selectSection(state, id);
    if (next.open !== state.open) onState(next);
  };

  const sectionShell = (id: PanelSectionId) => {
    const meta = SECTION_META[id];
    const open = state.open === id;
    const count = counts[id];
    const isNew = (newCounts[id] ?? 0) > 0;
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
            open
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
          {isNew && (
            <span
              aria-label="New"
              className="rounded-full border border-ai/60 bg-ai/15 px-1.5 font-mono text-[9px] font-bold uppercase text-ai"
            >
              New
            </span>
          )}
          {/* Questions mode chips (split-source spec 2026-08-27): ◉ Live
              (azure, the radar feed) · ◈ Prep (gold, the prepared bank).
              In-header controls, never which section is open (though
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
      {SECTION_ORDER.map(sectionShell)}
    </div>
  );
}

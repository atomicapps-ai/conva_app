import { Icon } from "@/components/ui/Icon";

interface TranscriptBubbleHeaderProps {
  speakerLabel: string;
  speakerTone: "inbound" | "outbound";
  timeLabel: string;
  timeTitle: string;
  isFinal: boolean;
  collapsed: boolean;
  busy: boolean;
  onToggleCollapse: () => void;
  onResearch: () => void;
}

/**
 * The compact identity/action line for a transcript bubble.
 *
 * `speakerLabel` is deliberately data-agnostic: today it receives Them/You;
 * the speaker-aware pipeline can later pass New voice, Voice 2, a confirmed
 * name, or an explicitly uncertain label without changing bubble geometry.
 */
export function TranscriptBubbleHeader({
  speakerLabel,
  speakerTone,
  timeLabel,
  timeTitle,
  isFinal,
  collapsed,
  busy,
  onToggleCollapse,
  onResearch,
}: TranscriptBubbleHeaderProps) {
  const speakerClass =
    speakerTone === "inbound" ? "text-inbound" : "text-[var(--voice-you-text)]";

  return (
    <div className="mb-0.5 flex min-h-5 select-none items-center gap-1.5 border-b border-border/55 pb-0.5">
      <span
        className={`min-w-0 truncate font-mono text-[9px] font-semibold uppercase tracking-[0.12em] ${speakerClass}`}
        title={speakerLabel}
      >
        {speakerLabel}
      </span>
      <span className="h-1 w-1 shrink-0 rounded-full bg-border-strong" aria-hidden />
      <span
        title={timeTitle}
        className="shrink-0 cursor-help font-mono text-[9px] text-fg-faint"
      >
        {isFinal ? timeLabel : "live"}
      </span>
      <span className="ml-auto flex shrink-0 items-center gap-0.5">
        {isFinal && (
          <button
            type="button"
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              onToggleCollapse();
            }}
            aria-expanded={!collapsed}
            title={collapsed ? "Expand" : "Collapse"}
            aria-label={collapsed ? "Expand turn" : "Collapse turn"}
            className="grid h-5 w-5 place-items-center rounded text-fg-faint transition-colors hover:bg-bg/50 hover:text-fg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/70"
          >
            <Icon
              name="chevron"
              size={11}
              strokeWidth={2.6}
              className={collapsed ? "" : "rotate-180"}
            />
          </button>
        )}
        {isFinal && (
          <button
            type="button"
            disabled={busy}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={onResearch}
            title="Ask Ally about this turn"
            aria-label="Ask Ally about this turn"
            className="grid h-5 w-5 place-items-center rounded text-ai/65 transition-colors hover:bg-ai/10 hover:text-ai focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ai/70 disabled:opacity-40"
          >
            <Icon name="lightbulb" size={12} />
          </button>
        )}
      </span>
    </div>
  );
}

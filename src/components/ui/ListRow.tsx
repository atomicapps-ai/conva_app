import { Icon, type IconName } from "@/components/ui/Icon";

export type ListRowAccent = "primary" | "muted" | "ai";

const ACCENT_VAR: Record<ListRowAccent, string> = {
  primary: "var(--color-primary)",
  muted: "var(--color-fg-faint)",
  ai: "var(--color-ai)",
};

export interface ListRowProps {
  accent: ListRowAccent;
  title: string;
  /** Omit -> the icon column renders as an empty spacer (keeps column
   *  widths identical across every row in a list, same convention as
   *  `onSelectChange`/`onDelete` below). `color` is a raw CSS color (a
   *  `var(--color-*)` token or a hex value) — the icon itself and its
   *  tinted background swatch both use it. Same `{ icon, color }` shape
   *  as `ContextsPane.tsx`'s `CATEGORY_ICON`, so its entries pass straight
   *  through with no reshaping. */
  icon?: { icon: IconName; color: string };
  badge?: { text: string; tone: ListRowAccent };
  date: string;
  selected?: boolean;
  /** The conversation currently open in the transcript — a distinct cue
   *  from `selected` (bulk-delete checkbox state), so it uses its own
   *  gold ring rather than reusing the primary-tinted selected style. */
  open?: boolean;
  /** Omit -> the checkbox column renders as an empty spacer, not omitted
   *  (keeps column widths identical across every row in a list — see the
   *  Rehearsals tab in ConversationsPanel.tsx, which reuses this shape
   *  with neither optional prop wired). */
  onSelectChange?: (checked: boolean) => void;
  /** Omit -> the trash-can column renders as an empty spacer. */
  onDelete?: () => void;
  onClick: () => void;
}

/**
 * One consistent row shape for the Conversations page's All-activity/
 * History list (owner, 2026-08-30 — "each row simple 1 row high, like a
 * grid with the icons on the far right"). Fixed CSS Grid columns mean the
 * title cell can only truncate, never wrap — that's what actually fixes
 * the reported inconsistent row heights: the old flex rows had no width
 * constraint on their metadata fields, so at narrow window widths they
 * wrapped onto a second line, reading as a taller "header" row next to
 * shorter ones. `accent` carries the row's type in color: azure/`primary`
 * for a saved conversation, muted gray/`muted` for an unsaved session,
 * gold/`ai` for a rehearsal-tagged session — see the design doc for the
 * full rationale (`docs/superpowers/specs/2026-08-30-conversations-row-
 * redesign-design.md`).
 *
 * The row itself is the clickable "open" target — checkbox and trash-can
 * clicks call `event.stopPropagation()` so they don't also fire `onClick`.
 */
export function ListRow({
  accent,
  title,
  icon,
  badge,
  date,
  selected = false,
  open = false,
  onSelectChange,
  onDelete,
  onClick,
}: ListRowProps) {
  const accentVar = ACCENT_VAR[accent];
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      aria-label={title}
      className={[
        "grid h-[34px] cursor-pointer grid-cols-[3px_18px_14px_minmax(0,1fr)_auto_auto_20px]",
        "items-center gap-2 rounded-md border pr-2 transition",
        open
          ? "border-ai/60 bg-ai/[0.06]"
          : selected
            ? "border-primary/35 bg-primary/10"
            : "border-transparent bg-bg/40 hover:border-border hover:bg-panel-raised",
      ].join(" ")}
    >
      <span className="h-full rounded-sm" style={{ background: accentVar }} aria-hidden="true" />
      {icon ? (
        <span
          className="grid h-[18px] w-[18px] shrink-0 place-items-center rounded-md"
          style={{
            color: icon.color,
            background: `color-mix(in srgb, ${icon.color} 16%, transparent)`,
          }}
          aria-hidden="true"
        >
          <Icon name={icon.icon} size={11} />
        </span>
      ) : (
        <span aria-hidden="true" />
      )}
      {onSelectChange ? (
        <input
          type="checkbox"
          checked={selected}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => onSelectChange(e.target.checked)}
          aria-label={`Select ${title}`}
          className="h-3.5 w-3.5 cursor-pointer"
          style={{ accentColor: accentVar }}
        />
      ) : (
        <span aria-hidden="true" />
      )}
      <span className="min-w-0 truncate text-left text-xs text-fg">{title}</span>
      {badge ? (
        <span
          className="shrink-0 rounded-full px-1.5 py-0.5 font-mono text-[9px] tracking-wide"
          style={{
            background: `color-mix(in srgb, ${ACCENT_VAR[badge.tone]} 16%, transparent)`,
            color: ACCENT_VAR[badge.tone],
          }}
        >
          {badge.text}
        </span>
      ) : (
        <span />
      )}
      <span className="shrink-0 whitespace-nowrap font-mono text-[10px] text-fg-faint">
        {date}
      </span>
      {onDelete ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          aria-label={`Delete ${title}`}
          title="Delete"
          className="grid h-5 w-5 place-items-center rounded-sm text-fg-faint transition hover:bg-rec/10 hover:text-rec"
        >
          <Icon name="trash" size={12} />
        </button>
      ) : (
        <span aria-hidden="true" />
      )}
    </div>
  );
}

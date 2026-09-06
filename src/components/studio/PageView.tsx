import type { ReactNode } from "react";

import { LockedIcon } from "@/components/ui/LockedIcon";

/**
 * The crown every V5.0 **rail destination** wears: a large page title, a
 * one-line subtitle, and a right-hand action slot — and deliberately NO
 * breadcrumb and NO back button, because the rail itself is the "where am I /
 * how do I leave" control (CLAUDE.md rule 9, unchanged by V5.0).
 *
 * Sub-views drilled into from a destination keep using `ViewShell`, which
 * still owns the breadcrumb + back chevron. Two components, one rule each —
 * don't add a breadcrumb here.
 *
 * Type scale (smaller-screens-first pass, 2026-09-02): page titles 22/700,
 * greeting 28/700, body 13. Header padding tightened 2026-09-02 (owner
 * screenshot feedback — no page-level scrollbar at the 960×640 default) to
 * pt-4/pb-3 (was pt-7/pb-5); body padding/section gaps 16–20 (was 20–32).
 * This header shape is shared by every rail destination — a density change
 * here is app-wide, not a one-off page patch.
 */
export function PageView({
  title,
  subtitle,
  actions,
  children,
  /** Home's greeting is the one 32–36px title in the app. */
  large = false,
  /** Multi-pane pages (Contexts) manage their own scrolling. */
  fill = false,
  /**
   * Drop the body's page padding so panes run edge to edge. Contexts needs
   * this: §3's frame is `184px 220px 360px 260px` (rail/list/centre/dock)
   * across a 1024px window at the wide-tier floor, with NO page gutter — the
   * 360px centre floor only survives if the gutter isn't eating into it.
   */
  bleed = false,
  className = "",
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  large?: boolean;
  fill?: boolean;
  bleed?: boolean;
  className?: string;
}) {
  return (
    <section className={`flex h-full min-h-0 flex-col ${className}`}>
      <header className="flex shrink-0 flex-wrap items-start justify-between gap-4 px-5 pb-3 pt-4">
        <div className="min-w-0">
          <h2
            className={
              large
                ? "text-[28px] font-bold leading-[1.1] tracking-[-0.02em] text-fg"
                : "text-[22px] font-bold leading-[1.1] tracking-[-0.02em] text-fg"
            }
          >
            {title}
          </h2>
          {subtitle && (
            <p
              className={
                large
                  ? "mt-2 text-[13px] leading-relaxed text-fg-muted"
                  : "mt-1.5 text-[13px] leading-relaxed text-fg-muted"
              }
            >
              {subtitle}
            </p>
          )}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2.5">{actions}</div>}
      </header>
      {fill ? (
        <div className={`flex min-h-0 flex-1 flex-col ${bleed ? "" : "px-5 pb-5"}`}>
          {children}
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
          <div className="flex flex-col gap-4">{children}</div>
        </div>
      )}
    </section>
  );
}

/** A content surface — one step up from the page ground, 1px border, radius 8.
 *  In-flow depth is a surface step plus a hairline, never a shadow (§12). */
export function Panel({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-lg border border-border bg-panel ${className}`}>{children}</div>
  );
}

/** The small mono, uppercase, letter-spaced section label used everywhere. */
export function Eyebrow({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`font-mono text-[10px] font-semibold uppercase leading-tight tracking-[0.2em] text-fg-faint ${className}`}
    >
      {children}
    </div>
  );
}

/**
 * The LOCKED "Start Listening" control (§2). Waveform/listening bars — never
 * a play triangle, a mic, or a pale-cyan fill. Fill #1D66BB (the subtle
 * #1F68BE→#1B62B8 gradient), content #EEF1FF, radius 8. Bright azure
 * (#4FB8FF) stays the metric/focus/accent colour and is NOT this button.
 *
 * `compact` renders the icon-only square form; the label becomes the tooltip.
 */
export function StartListeningButton({
  onClick,
  disabled = false,
  compact = false,
  label = "Start Listening",
  className = "",
}: {
  onClick: () => void;
  disabled?: boolean;
  compact?: boolean;
  label?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={[
        "inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border-0 text-[13px] font-bold text-[#EEF1FF]",
        "bg-[linear-gradient(180deg,#1F68BE,#1B62B8)] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]",
        "transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
        // ~30% shorter than the pre-2026-09-02 px-5/py-[13px] shape (owner
        // screenshot feedback: "shrink the button .33 or so").
        compact ? "h-9 w-9" : "px-3.5 py-[7px]",
        className,
      ].join(" ")}
    >
      <LockedIcon name="action-start-listening" size={15} />
      {!compact && label}
    </button>
  );
}

/** Status as SHAPE + LABEL, never colour alone (§12, FIXED). */
export function StatusPill({
  tone,
  children,
}: {
  tone: "ready" | "progress" | "notice" | "error" | "idle";
  children: ReactNode;
}) {
  const tones = {
    ready: "border-ok/35 bg-ok/[0.12] text-ok",
    progress: "border-primary/35 bg-primary/[0.12] text-primary",
    notice: "border-notice/40 bg-notice/[0.1] text-notice",
    error: "border-rec/40 bg-rec/[0.1] text-rec",
    idle: "border-border-strong bg-panel-raised text-fg-muted",
  } as const;
  const dots = {
    ready: "bg-ok",
    progress: "bg-primary",
    notice: "bg-notice",
    error: "bg-rec",
    idle: "bg-fg-faint",
  } as const;
  return (
    <span
      className={`inline-flex h-6 items-center gap-2 rounded-full border px-3 font-mono text-[11px] font-bold uppercase leading-none tracking-[0.14em] ${tones[tone]}`}
    >
      <span className={`h-2 w-2 shrink-0 rounded-full ${dots[tone]}`} aria-hidden />
      {children}
    </span>
  );
}

/** Empty state — dashed frame, what it is, why it's empty, one action (§9). */
export function EmptyState({
  title,
  description,
  action,
  className = "",
}: {
  title: string;
  description: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-[var(--radius)] border border-dashed border-border-strong px-4 py-6 text-center ${className}`}
    >
      <p className="text-sm font-bold text-fg">{title}</p>
      <p className="mx-auto mt-1.5 max-w-[46ch] text-xs leading-relaxed text-fg-muted">
        {description}
      </p>
      {action && <div className="mt-3.5 flex justify-center">{action}</div>}
    </div>
  );
}

/** Error state — actionable, never presented as a success (§9). */
export function ErrorState({
  title,
  description,
  onRetry,
  retryLabel = "Retry",
  className = "",
}: {
  title: string;
  description: ReactNode;
  onRetry?: () => void;
  retryLabel?: string;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={`rounded-[var(--radius)] border border-rec/40 bg-rec/[0.06] p-4 ${className}`}
    >
      <p className="flex items-center gap-2 text-[13px] font-bold leading-tight text-rec">
        <span aria-hidden>⚠</span>
        {title}
      </p>
      <p className="mt-1.5 text-xs leading-relaxed text-fg-muted">{description}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 h-8 rounded-[var(--radius)] border border-rec/50 px-3.5 font-mono text-xs font-bold text-rec transition hover:bg-rec/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          {retryLabel}
        </button>
      )}
    </div>
  );
}

/**
 * Loading skeleton (§9). `animate-pulse` is a Tailwind animation, so it is
 * already suppressed by the reduced-motion rule in globals.css; the bars stay
 * visible either way, so the state still reads as "loading".
 */
export function Skeleton({ rows = 4, className = "" }: { rows?: number; className?: string }) {
  const widths = ["70%", "90%", "55%", "80%", "65%", "85%"];
  return (
    <div className={`flex flex-col gap-2.5 ${className}`} role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <span
          key={i}
          className="block h-3 animate-pulse rounded bg-panel-raised"
          style={{ width: widths[i % widths.length] }}
          aria-hidden
        />
      ))}
    </div>
  );
}

/** Secondary button — transparent, strong hairline (§9 "Buttons"). */
export function SecondaryButton({
  onClick,
  children,
  disabled = false,
  title,
  className = "",
}: {
  onClick: () => void;
  children: ReactNode;
  disabled?: boolean;
  title?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`inline-flex h-9 shrink-0 items-center gap-2 rounded-[var(--radius)] border border-border-strong px-4 text-[13px] font-semibold text-fg transition hover:bg-white/[0.045] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${className}`}
    >
      {children}
    </button>
  );
}

/** Primary (azure) button — the page-level affirmative action (§9). */
export function PrimaryButton({
  onClick,
  children,
  disabled = false,
  title,
  className = "",
}: {
  onClick: () => void;
  children: ReactNode;
  disabled?: boolean;
  title?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`inline-flex h-9 shrink-0 items-center gap-2 rounded-[var(--radius)] border-0 bg-primary px-4 text-[13px] font-bold text-primary-ink transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${className}`}
    >
      {children}
    </button>
  );
}

import type { ReactNode } from "react";

import { Icon, type IconName } from "@/components/ui/Icon";

/**
 * Shared chrome for every routed Studio view (UI overhaul M3). A consistent
 * crown — breadcrumb, gradient icon chip, title, optional subtitle/badge,
 * and a right-hand action slot — over a scrolling, width-capped body. Views
 * compose this with {@link Section} cards so Settings/Library/Sessions/
 * Conversations all read as one instrument rather than four ad-hoc panels.
 *
 * The breadcrumb is "always," per the app-UI brief's nav-zones rule
 * (`docs/product/designer-handoff-2026-08/BRIEF-app-ui.md` §4.1) — it's the
 * only place the user learns where they are, so every routed view built on
 * ViewShell gets one even when it's flat: with no `breadcrumb` parent, the
 * trail is just the view's own title, small and muted above the real
 * headline. Pass `breadcrumb` for genuine sub-views (Sim Con setup/detail,
 * reached from Contexts) to get a real two-level trail instead.
 *
 * One deliberate exception: Live (`TranscriptView`) doesn't compose
 * ViewShell at all, so it carries no breadcrumb/title crown — see the note
 * at the top of that file for why §4.3/§8 (never shrink the transcript;
 * it's the locked surface) outrank the "always" rule there.
 */
export function ViewShell({
  icon,
  breadcrumb,
  title,
  subtitle,
  badge,
  actions,
  onBack,
  children,
  className = "",
  wide = false,
}: {
  icon: IconName;
  /** Parent segment(s) — omit for a flat, top-level view. */
  breadcrumb?: string;
  title: string;
  subtitle?: ReactNode;
  badge?: ReactNode;
  actions?: ReactNode;
  /** A sub-view reached from somewhere (Sim Con setup/detail, Settings,
   *  Sessions, Conversations) gets a back control HERE — top-left, next to
   *  the icon chip — never in `actions` (top-right). Navigation controls and
   *  page-specific actions are different zones; don't mix them. */
  onBack?: () => void;
  children: ReactNode;
  className?: string;
  /** Drop the default `max-w-4xl` cap for multi-pane layouts (e.g. the
   *  Contexts & Library page) that need the full window width. */
  wide?: boolean;
}) {
  return (
    <section className={`flex h-full flex-col ${className}`}>
      <header className="flex shrink-0 items-center gap-3 px-6 py-4">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            title="Back"
            aria-label="Back"
            className="grid h-9 w-9 shrink-0 place-items-center rounded border border-border-strong bg-bg-2 text-fg-muted transition hover:text-fg"
          >
            <Icon name="chevron" size={16} className="rotate-90" />
          </button>
        )}
        <span
          className="brand-ring flex h-9 w-9 items-center justify-center rounded text-primary"
          aria-hidden
        >
          <Icon name={icon} size={19} />
        </span>
        <div className="min-w-0">
          <p className="truncate font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-fg-faint">
            {breadcrumb ? (
              <>
                {breadcrumb} <span aria-hidden>›</span> {title}
              </>
            ) : (
              title
            )}
          </p>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-extrabold tracking-tight text-fg">
              {title}
            </h2>
            {badge}
          </div>
          {subtitle && (
            <p className="truncate text-[11px] text-fg-faint">{subtitle}</p>
          )}
        </div>
        {actions && (
          <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
            {actions}
          </div>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-8">
        <div
          className={
            wide
              ? "flex h-full min-h-0 flex-col gap-4"
              : "mx-auto flex max-w-4xl flex-col gap-4"
          }
        >
          {children}
        </div>
      </div>
    </section>
  );
}

/** A titled glass card grouping related controls within a view. */
export function Section({
  title,
  description,
  children,
  className = "",
}: {
  title?: string;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`card p-4 ${className}`}>
      {(title || description) && (
        <div className="mb-3">
          {title && (
            <h3 className="text-xs font-semibold uppercase tracking-wider text-fg-muted">
              {title}
            </h3>
          )}
          {description && (
            <p className="mt-1 text-[11px] leading-relaxed text-fg-faint">
              {description}
            </p>
          )}
        </div>
      )}
      {children}
    </div>
  );
}

/** Consistent inline status/notice line used across views. */
export function Notice({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p className="text-[11px] text-fg-muted" role="status">
      {children}
    </p>
  );
}

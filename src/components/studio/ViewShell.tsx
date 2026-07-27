import type { ReactNode } from "react";

import { Icon, type IconName } from "@/components/ui/Icon";

/**
 * Shared chrome for every routed Studio view (UI overhaul M3). A consistent
 * crown — gradient icon chip, title, optional subtitle/badge, and a right-hand
 * action slot — over a scrolling, width-capped body. Views compose this with
 * {@link Section} cards so Settings/Library/Sessions/Conversations all read as
 * one instrument rather than four ad-hoc panels.
 */
export function ViewShell({
  icon,
  title,
  subtitle,
  badge,
  actions,
  children,
  className = "",
}: {
  icon: IconName;
  title: string;
  subtitle?: ReactNode;
  badge?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`flex h-full flex-col ${className}`}>
      <header className="flex shrink-0 items-center gap-3 px-6 py-4">
        <span
          className="brand-ring flex h-9 w-9 items-center justify-center rounded-xl text-inbound"
          aria-hidden
        >
          <Icon name={icon} size={19} />
        </span>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="font-display text-base font-semibold tracking-tight text-fg">
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
        <div className="mx-auto flex max-w-4xl flex-col gap-4">{children}</div>
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

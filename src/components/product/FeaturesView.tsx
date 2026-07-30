import { Section, ViewShell } from "@/components/studio/ViewShell";
import { Icon } from "@/components/ui/Icon";
import { AvailabilityTag } from "@/components/product/tags";
import { FEATURES } from "@/lib/product";

/**
 * Product details / feature list — the market-facing "what conva does" view.
 * Pure layout over {@link FEATURES}; renders identically on desktop and web
 * (an availability tag on each card keeps web/desktop parity honest).
 */
export function FeaturesView() {
  return (
    <ViewShell
      icon="book"
      title="What conva does"
      subtitle="A real-time conversation ally — private by default, grounded in your own documents."
    >
      <Section>
        <div className="grid gap-3 sm:grid-cols-2">
          {FEATURES.map((f) => (
            <div
              key={f.id}
              className="flex flex-col gap-2 rounded-xl border border-border bg-panel-raised/40 p-3.5"
            >
              <div className="flex items-center gap-2.5">
                <span
                  className="brand-ring flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-inbound"
                  aria-hidden
                >
                  <Icon name={f.icon} size={17} />
                </span>
                <h3 className="min-w-0 flex-1 text-sm font-bold tracking-tight text-fg">
                  {f.title}
                </h3>
              </div>
              <p className="text-[12px] leading-relaxed text-fg-muted">
                {f.blurb}
              </p>
              <div className="mt-auto pt-0.5">
                <AvailabilityTag value={f.availability} />
              </div>
            </div>
          ))}
        </div>
      </Section>

      <p className="px-1 text-[11px] leading-relaxed text-fg-faint">
        <span className="font-semibold text-fg-muted">Web + app</span> features
        work in your browser and the desktop app.{" "}
        <span className="font-semibold text-fg-muted">Desktop app</span>{" "}
        features need the installed app — a browser tab can't capture the other
        side of a call or run fully offline.
      </p>
    </ViewShell>
  );
}

import { Section, ViewShell } from "@/components/studio/ViewShell";
import { StatusTag } from "@/components/product/tags";
import { UPCOMING, type UpcomingItem } from "@/lib/product";

/**
 * "What's Coming" — a private preview of the roadmap, shown inside the app to
 * signed-in beta members. Mirrors conva_core/docs/product/roadmap.md via
 * {@link UPCOMING}. Grouped by the phase we're shipping in.
 */
const PHASES: UpcomingItem["phase"][] = ["Phase 1", "Phase 3"];

const PHASE_CAPTION: Record<string, string> = {
  "Phase 1": "Shipping now — getting web + app ready and opening the beta.",
  "Phase 3": "On the roadmap after the beta opens.",
};

export function WhatsComingView() {
  return (
    <ViewShell
      icon="lightbulb"
      title="What's Coming"
      subtitle="A private preview of the roadmap, shared with beta members."
      badge={
        <span className="inline-flex items-center rounded-full border border-border-strong bg-panel-raised/60 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-fg-faint">
          Private preview
        </span>
      }
    >
      {PHASES.map((phase) => {
        const items = UPCOMING.filter((i) => i.phase === phase);
        if (items.length === 0) return null;
        return (
          <Section key={phase} title={phase} description={PHASE_CAPTION[phase]}>
            <ul className="flex flex-col divide-y divide-border">
              {items.map((item) => (
                <li
                  key={item.id}
                  className="flex flex-col gap-1.5 py-3 first:pt-0 last:pb-0"
                >
                  <div className="flex items-start gap-2">
                    <h3 className="min-w-0 flex-1 text-sm font-bold tracking-tight text-fg">
                      {item.title}
                    </h3>
                    <StatusTag value={item.status} />
                  </div>
                  <p className="text-[12px] leading-relaxed text-fg-muted">
                    {item.blurb}
                  </p>
                </li>
              ))}
            </ul>
          </Section>
        );
      })}

      <p className="px-1 text-[11px] leading-relaxed text-fg-faint">
        Plans and timing can change — this is where you'll see them first.
        Have a request? Tell us from Settings → feedback.
      </p>
    </ViewShell>
  );
}

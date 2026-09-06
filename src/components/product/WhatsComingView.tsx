import { Eyebrow, PageView, Panel } from "@/components/studio/PageView";
import { StatusTag } from "@/components/product/tags";
import { LockedIcon } from "@/components/ui/LockedIcon";
import { UPCOMING, type UpcomingItem } from "@/lib/product";

/**
 * "What's Coming" — a rail destination (AppUI V5.0 §7), so it wears
 * `PageView`'s crown, not `ViewShell`'s breadcrumb.
 *
 * > Roadmap & private preview. **Forward-looking only — no live metrics;
 * > items that need real data (e.g. coaching analytics) stay off until that
 * > data exists.**
 *
 * Content still mirrors `conva_core/docs/product/roadmap.md` via
 * {@link UPCOMING}, grouped by the phase we're shipping in.
 */
const PHASES: UpcomingItem["phase"][] = ["Phase 1", "Phase 3"];

const PHASE_CAPTION: Record<string, string> = {
  "Phase 1": "Shipping now — getting web + app ready and opening the beta.",
  "Phase 3": "On the roadmap after the beta opens.",
};

export function WhatsComingView() {
  return (
    <PageView
      title="What's Coming"
      subtitle="Product roadmap and private preview, shared with beta members."
      actions={<span className="pill pill-sm pill-idle">Private preview</span>}
    >
      {PHASES.map((phase) => {
        const items = UPCOMING.filter((i) => i.phase === phase);
        if (items.length === 0) return null;
        return (
          <section key={phase}>
            <div className="mb-3.5">
              <Eyebrow>{phase}</Eyebrow>
              <p className="mt-1.5 text-[13px] text-fg-muted">{PHASE_CAPTION[phase]}</p>
            </div>
            <div className="flex flex-col gap-3">
              {items.map((item) => (
                <Panel key={item.id} className="flex items-start gap-4 px-5 py-[18px]">
                  <span
                    className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary/[0.08] text-primary"
                    aria-hidden
                  >
                    <LockedIcon name="nav-whats-coming" size={20} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="mb-1.5 flex flex-wrap items-center gap-2.5">
                      <h3 className="text-base font-bold leading-tight text-fg">{item.title}</h3>
                      <StatusTag value={item.status} />
                    </div>
                    <p className="max-w-[76ch] text-[13px] leading-relaxed text-fg-muted">
                      {item.blurb}
                    </p>
                  </div>
                </Panel>
              ))}
            </div>
          </section>
        );
      })}

      <p className="text-[11px] leading-relaxed text-fg-faint">
        Plans and timing can change — this is where you&apos;ll see them first.
        Have a request? Tell us from Settings → feedback.
      </p>
    </PageView>
  );
}

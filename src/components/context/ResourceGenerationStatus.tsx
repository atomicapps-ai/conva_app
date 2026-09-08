import type { GenerationStage } from "@/components/context/generationStatus";
import { Icon } from "@/components/ui/Icon";

const STATE_STYLE: Record<GenerationStage["state"], string> = {
  ready: "border-ok/30 bg-ok/[0.07] text-ok",
  included: "border-ai/30 bg-ai/[0.07] text-ai",
  skipped: "border-border bg-bg/30 text-fg-faint",
  blocked: "border-notice/35 bg-notice/[0.08] text-notice",
  failed: "border-rec/35 bg-rec/[0.08] text-rec",
};

const STATE_LABEL: Record<GenerationStage["state"], string> = {
  ready: "Ready",
  included: "Included",
  skipped: "Skipped",
  blocked: "Needs setup",
  failed: "Not generated",
};

export function GenerationStatus({ stages }: { stages: GenerationStage[] }) {
  return (
    <div className="mt-3 grid gap-2" role="status" aria-label="Resource generation results">
      {stages.map((stage) => (
        <div key={stage.key} className={`rounded-md border px-2.5 py-2 ${STATE_STYLE[stage.state]}`}>
          <div className="flex items-center gap-2">
            <Icon
              name={stage.state === "ready" || stage.state === "included" ? "check" : "info"}
              size={13}
              className="shrink-0"
            />
            <span className="text-[11px] font-bold text-fg">{stage.label}</span>
            <span className="ml-auto text-[9px] font-bold uppercase tracking-wider">
              {STATE_LABEL[stage.state]}
            </span>
          </div>
          <p className="mt-1 pl-5 text-[10px] leading-relaxed text-fg-muted">{stage.detail}</p>
        </div>
      ))}
    </div>
  );
}

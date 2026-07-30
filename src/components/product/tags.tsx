import { AVAILABILITY_META, type Availability } from "@/lib/product";

/** Honest "where does this work" tag used on feature cards + the dashboard. */
export function AvailabilityTag({ value }: { value: Availability }) {
  const meta = AVAILABILITY_META[value];
  const tone =
    meta.tone === "both"
      ? "border-ok/30 bg-ok/10 text-ok"
      : meta.tone === "desktop"
        ? "border-inbound/30 bg-inbound/10 text-inbound"
        : "border-border-strong bg-panel-raised/60 text-fg-faint";
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${tone}`}
    >
      {meta.label}
    </span>
  );
}

/** Roadmap status pill: "In progress" (violet) vs "Planned" (neutral). */
export function StatusTag({ value }: { value: "In progress" | "Planned" }) {
  const tone =
    value === "In progress"
      ? "border-outbound/34 bg-outbound/[0.14] text-[var(--voice-you-text)]"
      : "border-border-strong bg-panel-raised/60 text-fg-faint";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${tone}`}
    >
      {value === "In progress" && (
        <span className="h-1.5 w-1.5 rounded-full bg-outbound" aria-hidden />
      )}
      {value}
    </span>
  );
}

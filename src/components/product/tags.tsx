import { AVAILABILITY_META, type Availability } from "@/lib/product";

/** Honest "where does this work" tag used on feature cards + the dashboard.
 *  Rides the shared `.pill` family (globals.css): "both" reads as the one
 *  true ready/ok state, "desktop" is informational chrome (azure), anything
 *  else is idle/neutral — never a voice colour, this isn't a voice. */
export function AvailabilityTag({ value }: { value: Availability }) {
  const meta = AVAILABILITY_META[value];
  const tone =
    meta.tone === "both" ? "pill-ready" : meta.tone === "desktop" ? "pill-accent" : "pill-idle";
  return <span className={`pill pill-sm ${tone}`}>{meta.label}</span>;
}

/** Roadmap status pill: "In progress" (azure) vs "Planned" (neutral). */
export function StatusTag({ value }: { value: "In progress" | "Planned" }) {
  const tone = value === "In progress" ? "pill-accent" : "pill-idle";
  return (
    <span className={`pill pill-sm ${tone}`}>
      {value === "In progress" && <span className="d" aria-hidden />}
      {value}
    </span>
  );
}

import { groupSourcesByFile, type AllyCard } from "@/state/ally";
import type { PartnerPayload } from "@/lib/ipc";

/**
 * What the partner window's answer section shows: a live follow-up card
 * (asked in this window) always takes over from the payload's
 * already-answered content — asking something new means show the new thing.
 * Pure so the "which content wins" branching is unit-testable without the
 * window's IPC/backend plumbing (owner, 2026-08-22).
 */
export function derivePartnerAnswer(
  payload: PartnerPayload | null,
  liveCard: AllyCard | null,
): { heading: "FETCHED INFO" | "ANSWER"; text: string | null; error: string | null; sources: string[] } {
  if (liveCard) {
    return {
      heading: "FETCHED INFO",
      text: liveCard.error ? null : liveCard.text,
      error: liveCard.error,
      sources: groupSourcesByFile(liveCard.sources).map(
        (g) => `${g.file} — ${g.locations.join(", ")}`,
      ),
    };
  }
  return {
    heading: "ANSWER",
    text: payload?.answer ?? null,
    error: null,
    sources: payload?.source_lines ?? [],
  };
}

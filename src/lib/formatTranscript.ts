import { groupTurns } from "@/lib/turns";
import type { TranscriptSegment } from "@/lib/ipc";

/**
 * Render a conversation's segments as clean, readable plain text for the
 * partner-window transcript viewer (owner request, 2026-09-04 — "the
 * transcript view... formatted for easy and clear readability"). One
 * speaker-labeled paragraph per turn, using the same consecutive-same-
 * speaker grouping (`groupTurns`) the live cockpit renders as bubbles, so
 * the reopened transcript reads identically to how it looked live.
 * `PartnerWindow.tsx` renders the partner payload's `answer` with
 * `whitespace-pre-line`, so the blank line between turns here becomes a
 * real paragraph break, not a literal `\n\n` in the output.
 */
export function formatTranscriptForViewer(segments: TranscriptSegment[]): string {
  return groupTurns(segments)
    .map((turn) => {
      const label = turn.side === "outbound" ? "You" : "Them";
      const text = turn.segments
        .map((s) => s.text.trim())
        .filter(Boolean)
        .join(" ");
      return text ? `${label}\n${text}` : "";
    })
    .filter(Boolean)
    .join("\n\n");
}

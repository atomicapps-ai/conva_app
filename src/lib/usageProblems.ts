import type { LlmFeatureUsage } from "@/lib/ipc";

/**
 * Tooltip for a Settings → Usage request count: what, besides plain failures,
 * went wrong with this feature's replies (answer-integrity check C3). Returns
 * `undefined` when nothing did, so the cell shows no tooltip.
 */
export function usageProblemTitle(
  b: Pick<
    LlmFeatureUsage,
    "failed_requests" | "cut_off_requests" | "refused_requests" | "unusable_replies"
  >,
): string | undefined {
  const parts: string[] = [];
  if (b.failed_requests > 0) {
    parts.push(`${b.failed_requests.toLocaleString()} failed (partial tokens still billed)`);
  }
  if ((b.cut_off_requests ?? 0) > 0) {
    parts.push(`${(b.cut_off_requests ?? 0).toLocaleString()} cut off at the length limit ✂`);
  }
  if ((b.refused_requests ?? 0) > 0) {
    parts.push(`${(b.refused_requests ?? 0).toLocaleString()} declined by the model !`);
  }
  if ((b.unusable_replies ?? 0) > 0) {
    parts.push(`${(b.unusable_replies ?? 0).toLocaleString()} replies could not be used !`);
  }
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

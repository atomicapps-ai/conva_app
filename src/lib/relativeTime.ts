/**
 * "Xh ago"-style relative time (Contexts-screen-redesign spec, requirements
 * 5 & 3-4's "Updated Xh ago" row meta). `now` is injectable for tests;
 * defaults to the real clock. Falls back to a short absolute date once the
 * gap is more than a month — "42d ago" stops being a useful number.
 */
export function formatRelativeTime(
  unixMs: number,
  now: number = Date.now(),
): string {
  const diffSec = Math.floor((now - unixMs) / 1000);
  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}h ago`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 30) return `${diffDay}d ago`;
  return new Date(unixMs).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

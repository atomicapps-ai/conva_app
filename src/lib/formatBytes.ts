/**
 * Human-readable byte size, auto-scaled so the number itself never runs
 * long (Contexts-screen-redesign spec, requirement 6): whole numbers >= 10
 * in the chosen unit show no decimal; numbers < 10 get one decimal place.
 * Bytes never show a decimal (they're always whole). Caps at GB — a
 * personal document library has no realistic reason to reach TB.
 */
const UNITS = ["B", "KB", "MB", "GB"] as const;

export function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < UNITS.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const rounded =
    unitIndex === 0 || value >= 10
      ? Math.round(value)
      : Math.round(value * 10) / 10;
  return `${rounded} ${UNITS[unitIndex]}`;
}

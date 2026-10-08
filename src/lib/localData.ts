import { formatBytes } from "@/lib/formatBytes";
import type { LocalDataCategory } from "@/lib/ipc";

/** "1:12:40" or "48:05" — a recording's length. `null` (unreadable header) shows an em dash. */
export function formatDuration(ms: number | null): string {
  if (ms === null || ms < 0) return "—";
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** "Mon 5 Oct, 14:02" in the user's locale. */
export function formatRecordedAt(unixMs: number): string {
  return new Date(unixMs).toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

/** "3 files · 412 MB", or "None" when empty. */
export function describeCategory(c: LocalDataCategory, one: string, many?: string): string {
  if (c.count === 0 && c.bytes === 0) return "None";
  return `${plural(c.count, one, many)} · ${formatBytes(c.bytes)}`;
}

/** Everything an erase will remove, in bytes (models are kept and not counted). */
export function erasableBytes(s: {
  recordings: LocalDataCategory;
  conversations: LocalDataCategory;
  session_logs: LocalDataCategory;
  library: LocalDataCategory;
  contexts: LocalDataCategory;
  diagnostics: LocalDataCategory;
}): number {
  return (
    s.recordings.bytes +
    s.conversations.bytes +
    s.session_logs.bytes +
    s.library.bytes +
    s.contexts.bytes +
    s.diagnostics.bytes
  );
}

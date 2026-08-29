import type { ContextStatus, ContextSummary } from "@/lib/ipc";

/** The row's status: a label, the shared `.pill-*` tone (globals.css) for
 *  any full pill rendering, and a plain `bg-*` class for the compact status
 *  dot (owner, 2026-08-28 — the row went to one line, so the status pill's
 *  text shrank to a dot; same underlying color per status either way). */
export interface RowStatus {
  label: string;
  tone: string;
  dotClass: string;
}

const STATUS_LABEL: Record<ContextStatus, string> = {
  draft: "Draft",
  ingesting: "Preparing…",
  ready: "Ready",
  running: "Running",
  ended: "Ended",
};

const STATUS_TONE: Record<ContextStatus, string> = {
  draft: "pill-idle",
  ingesting: "pill-accent",
  ready: "pill-ready",
  running: "pill-accent",
  ended: "pill-idle",
};

// Mirrors STATUS_TONE's colors (pill-idle -> fg-faint, pill-accent ->
// primary, pill-ready -> ok) as plain bg-* classes for the dot.
const STATUS_DOT: Record<ContextStatus, string> = {
  draft: "bg-fg-faint",
  ingesting: "bg-primary",
  ready: "bg-ok",
  running: "bg-primary",
  ended: "bg-fg-faint",
};

/**
 * Status pill for a context row. One override on top of the base status
 * mapping (spec 2026-08-26, part 3): a settled context (ready/ended) whose
 * generated resources no longer match its inputs shows **Stale** in the
 * advisory gold tone — never mid-flight states, never contexts that have
 * nothing generated yet.
 */
export function rowStatus(s: ContextSummary): RowStatus {
  const settled = s.status === "ready" || s.status === "ended";
  if (settled && s.has_generated_resources && s.resources_stale) {
    // pill-ally's color (--color-ai) — same gold "Stale" mirrors elsewhere.
    return { label: "Stale", tone: "pill-ally", dotClass: "bg-ai" };
  }
  return {
    label: STATUS_LABEL[s.status],
    tone: STATUS_TONE[s.status],
    dotClass: STATUS_DOT[s.status],
  };
}

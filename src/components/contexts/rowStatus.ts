import type { ContextStatus, ContextSummary } from "@/lib/ipc";

/** The row's status pill: label + shared `.pill-*` tone (globals.css). */
export interface RowStatus {
  label: string;
  tone: string;
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
    return { label: "Stale", tone: "pill-ally" };
  }
  return { label: STATUS_LABEL[s.status], tone: STATUS_TONE[s.status] };
}

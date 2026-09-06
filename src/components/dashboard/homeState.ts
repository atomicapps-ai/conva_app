import type { ContextSummary } from "@/lib/ipc";

/**
 * Home's hero state machine — AppUI V5.0 §2's "Home states" table, as pure
 * logic so the five branches are testable without a render:
 *
 * | State                  | Hero behaviour                                          |
 * | ---------------------- | ------------------------------------------------------- |
 * | No documents/contexts  | Friendly starter: Create context + Add to Library.       |
 * |                        | **No fabricated counts.**                                |
 * | Context generating     | Progress; Start Listening stays available with honest    |
 * |                        | fallback grounding.                                      |
 * | Ready                  | Ready pill + REAL counts + Start Listening.              |
 * | Generation failed      | Inline actionable error + Retry; never presents Ready.   |
 * | No active context      | "General conversation" + a clear "Choose a context".      |
 *
 * Every count this feeds is measured, never invented (decision 7).
 */

export type HeroReadiness = "ready" | "stale" | "unprepared";

export type HeroState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  /** Nothing to work with yet — the first-run starter. */
  | { kind: "starter" }
  /** Contexts exist but none is grounding the next session. */
  | { kind: "none" }
  | { kind: "generating"; context: ContextSummary }
  | { kind: "failed"; context: ContextSummary; message: string }
  | { kind: "active"; context: ContextSummary; readiness: HeroReadiness };

export interface HeroInputs {
  loading: boolean;
  /** A load failure — the page can't say anything truthful without data. */
  error: string | null;
  contexts: ContextSummary[];
  /** Library document count; part of deciding "is this a fresh install". */
  documentCount: number;
  /** The context grounding the next session (`useGroundingStore.activeId`). */
  activeId: string | null;
  /** The context currently being prepared/generated, if any. */
  generatingId: string | null;
  /** Message from the most recent failed generate attempt, if any. */
  failure: string | null;
}

/**
 * The "General conversation" default context is always present, so it can't
 * be used to decide whether the user has done anything yet.
 */
export function isUserContext(c: ContextSummary): boolean {
  return c.id !== "default";
}

export function readinessOfContext(c: ContextSummary): HeroReadiness {
  if (!c.has_generated_resources) return "unprepared";
  if (c.resources_stale) return "stale";
  return c.status === "ready" || c.status === "ended" ? "ready" : "unprepared";
}

export function heroState(input: HeroInputs): HeroState {
  if (input.error) return { kind: "error", message: input.error };
  if (input.loading) return { kind: "loading" };

  const userContexts = input.contexts.filter(isUserContext);
  if (userContexts.length === 0 && input.documentCount === 0) return { kind: "starter" };

  const active = input.activeId
    ? (input.contexts.find((c) => c.id === input.activeId) ?? null)
    : null;
  // The always-present default is grounding, not a *chosen* context — Home
  // offers "Choose a context" rather than pretending one is prepared.
  if (!active || !isUserContext(active)) return { kind: "none" };

  if (input.generatingId === active.id || active.status === "ingesting") {
    return { kind: "generating", context: active };
  }
  // A failure never presents as Ready.
  if (input.failure) return { kind: "failed", context: active, message: input.failure };

  return { kind: "active", context: active, readiness: readinessOfContext(active) };
}

/** Documents added in the last 7 days — the Library summary's second stat. */
export function addedThisWeek(
  docs: { ingested_at_unix_ms: number }[],
  now: number = Date.now(),
): number {
  const week = 7 * 24 * 60 * 60 * 1000;
  return docs.filter((d) => now - d.ingested_at_unix_ms <= week).length;
}

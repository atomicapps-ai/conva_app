import type { SimConSummary } from "@/lib/ipc";

/** One line of the readiness checklist shown on a Draft context row. */
export interface ReadinessCheck {
  label: string;
  ok: boolean;
  /** A failing check that doesn't block Generate (shown, not gating). */
  advisory?: boolean;
}

export interface Readiness {
  checks: ReadinessCheck[];
  /** Generate is enabled once every non-advisory check passes. */
  canGenerate: boolean;
}

/**
 * The Generate gate (Conversation Context UI design, decision 3): name + type
 * are always set by the time a context is saved, so the real gate is having
 * at least one grounding source — an attached document, declared key terms,
 * or web research enabled. An Interview without a job description is flagged
 * but never blocks (advisory only).
 */
export function readinessOf(s: SimConSummary): Readiness {
  const hasSource = s.source_doc_count > 0 || s.has_key_terms || s.research_enabled;
  const checks: ReadinessCheck[] = [
    {
      label: "At least one grounding source (document, key terms, or research)",
      ok: hasSource,
    },
  ];
  if (s.category === "interview") {
    checks.push({
      label: "Job description attached (recommended for interviews)",
      ok: s.has_job_description,
      advisory: true,
    });
  }
  return { checks, canGenerate: hasSource };
}

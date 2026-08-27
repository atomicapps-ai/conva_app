import { describe, expect, it } from "vitest";

import { readinessOf } from "@/components/contexts/readiness";
import type { ContextSummary } from "@/lib/ipc";

function summary(overrides: Partial<ContextSummary> = {}): ContextSummary {
  return {
    id: "s1",
    title: "Acme interview",
    category: "interview",
    status: "draft",
    created_at_unix_ms: 0,
    updated_at_unix_ms: 0,
    source_doc_count: 0,
    has_key_terms: false,
    research_enabled: false,
    has_job_description: false,
    has_generated_resources: false,
    ...overrides,
  };
}

describe("readinessOf — the Generate gate", () => {
  it("blocks with no grounding source at all", () => {
    const r = readinessOf(summary());
    expect(r.canGenerate).toBe(false);
    expect(r.checks[0].ok).toBe(false);
  });

  it("a document alone satisfies the grounding check", () => {
    expect(readinessOf(summary({ source_doc_count: 1 })).canGenerate).toBe(true);
  });

  it("key terms alone satisfy the grounding check", () => {
    expect(readinessOf(summary({ has_key_terms: true })).canGenerate).toBe(true);
  });

  it("research alone satisfies the grounding check", () => {
    expect(readinessOf(summary({ research_enabled: true })).canGenerate).toBe(true);
  });

  it("interview without a job description is advisory, not blocking", () => {
    const r = readinessOf(summary({ has_key_terms: true, has_job_description: false }));
    expect(r.canGenerate).toBe(true);
    const jd = r.checks.find((c) => c.label.includes("Job description"));
    expect(jd?.ok).toBe(false);
    expect(jd?.advisory).toBe(true);
  });

  it("non-interview types never show the job-description check", () => {
    const r = readinessOf(
      summary({ category: "company_meeting", has_key_terms: true }),
    );
    expect(r.checks.some((c) => c.label.includes("Job description"))).toBe(false);
  });
});

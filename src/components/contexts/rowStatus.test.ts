import { describe, expect, it } from "vitest";

import { rowStatus } from "@/components/contexts/rowStatus";
import type { SimConSummary } from "@/lib/ipc";

function summary(overrides: Partial<SimConSummary> = {}): SimConSummary {
  return {
    id: "s1",
    title: "Acme interview",
    category: "interview",
    status: "ready",
    created_at_unix_ms: 0,
    updated_at_unix_ms: 0,
    source_doc_count: 1,
    has_key_terms: false,
    research_enabled: false,
    has_job_description: true,
    has_generated_resources: true,
    ...overrides,
  };
}

describe("rowStatus", () => {
  it("maps each base status", () => {
    expect(rowStatus(summary({ status: "draft", has_generated_resources: false }))).toEqual({
      label: "Draft",
      tone: "pill-idle",
    });
    expect(rowStatus(summary())).toEqual({ label: "Ready", tone: "pill-ready" });
    expect(rowStatus(summary({ status: "running" }))).toEqual({
      label: "Running",
      tone: "pill-accent",
    });
  });

  it("overrides ready/ended with Stale when generated resources are stale", () => {
    expect(rowStatus(summary({ resources_stale: true }))).toEqual({
      label: "Stale",
      tone: "pill-ally",
    });
    expect(rowStatus(summary({ status: "ended", resources_stale: true }))).toEqual({
      label: "Stale",
      tone: "pill-ally",
    });
  });

  it("never marks Stale mid-flight or without generated resources", () => {
    expect(rowStatus(summary({ status: "ingesting", resources_stale: true })).label).toBe(
      "Preparing…",
    );
    expect(rowStatus(summary({ status: "running", resources_stale: true })).label).toBe(
      "Running",
    );
    expect(
      rowStatus(summary({ resources_stale: true, has_generated_resources: false })).label,
    ).toBe("Ready");
  });
});

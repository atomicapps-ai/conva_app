import { describe, expect, it } from "vitest";

import {
  addedThisWeek,
  heroState,
  readinessOfContext,
  type HeroInputs,
} from "@/components/dashboard/homeState";
import { DEFAULT_CONTEXT_ID, type ContextSummary } from "@/lib/ipc";

function ctx(over: Partial<ContextSummary> = {}): ContextSummary {
  return {
    id: "c1",
    title: "Director of Product Interview",
    category: "interview",
    status: "ready",
    created_at_unix_ms: 1,
    updated_at_unix_ms: 2,
    source_doc_count: 12,
    has_key_terms: true,
    research_enabled: true,
    has_job_description: true,
    has_generated_resources: true,
    ...over,
  };
}

function inputs(over: Partial<HeroInputs> = {}): HeroInputs {
  return {
    loading: false,
    error: null,
    contexts: [ctx()],
    documentCount: 12,
    activeId: "c1",
    generatingId: null,
    failure: null,
    ...over,
  };
}

describe("heroState", () => {
  it("reports loading before anything is known", () => {
    expect(heroState(inputs({ loading: true })).kind).toBe("loading");
  });

  it("an error wins over loading — never show stale confidence", () => {
    const s = heroState(inputs({ loading: true, error: "backend unreachable" }));
    expect(s).toEqual({ kind: "error", message: "backend unreachable" });
  });

  it("shows the starter on a fresh install (no user contexts, no documents)", () => {
    expect(heroState(inputs({ contexts: [], documentCount: 0, activeId: null })).kind).toBe(
      "starter",
    );
  });

  it("does not count the always-present default context as user content", () => {
    const s = heroState(
      inputs({
        contexts: [ctx({ id: DEFAULT_CONTEXT_ID, title: "General conversation" })],
        documentCount: 0,
        activeId: DEFAULT_CONTEXT_ID,
      }),
    );
    expect(s.kind).toBe("starter");
  });

  it("is not the starter once documents exist, even with no contexts", () => {
    expect(heroState(inputs({ contexts: [], documentCount: 3, activeId: null })).kind).toBe("none");
  });

  it("offers 'choose a context' when nothing is grounding", () => {
    expect(heroState(inputs({ activeId: null })).kind).toBe("none");
  });

  it("treats the default context as 'no active context', not as prepared", () => {
    const s = heroState(
      inputs({
        contexts: [ctx(), ctx({ id: DEFAULT_CONTEXT_ID, title: "General conversation" })],
        activeId: DEFAULT_CONTEXT_ID,
      }),
    );
    expect(s.kind).toBe("none");
  });

  it("shows progress while a context is generating", () => {
    expect(heroState(inputs({ generatingId: "c1" })).kind).toBe("generating");
    expect(heroState(inputs({ contexts: [ctx({ status: "ingesting" })] })).kind).toBe("generating");
  });

  it("never presents Ready after a failed generation", () => {
    const s = heroState(inputs({ failure: "Generation failed" }));
    expect(s.kind).toBe("failed");
    if (s.kind === "failed") expect(s.message).toBe("Generation failed");
  });

  it("generating outranks a stale failure from a previous attempt", () => {
    expect(heroState(inputs({ generatingId: "c1", failure: "old error" })).kind).toBe("generating");
  });

  it("reports the active context when everything is prepared", () => {
    const s = heroState(inputs());
    expect(s.kind).toBe("active");
    if (s.kind === "active") {
      expect(s.readiness).toBe("ready");
      expect(s.context.source_doc_count).toBe(12);
    }
  });
});

describe("readinessOfContext", () => {
  it("is unprepared until resources are generated", () => {
    expect(readinessOfContext(ctx({ has_generated_resources: false, status: "draft" }))).toBe(
      "unprepared",
    );
  });

  it("is stale when the inputs changed after generation", () => {
    expect(readinessOfContext(ctx({ resources_stale: true }))).toBe("stale");
  });

  it("is ready only for a settled, freshly generated context", () => {
    expect(readinessOfContext(ctx({ status: "ready" }))).toBe("ready");
    expect(readinessOfContext(ctx({ status: "ended" }))).toBe("ready");
    expect(readinessOfContext(ctx({ status: "running" }))).toBe("unprepared");
  });
});

describe("addedThisWeek", () => {
  const now = Date.UTC(2026, 8, 2, 12, 0, 0);
  const day = 24 * 60 * 60 * 1000;

  it("counts only the last seven days", () => {
    const docs = [
      { ingested_at_unix_ms: now - day },
      { ingested_at_unix_ms: now - 6 * day },
      { ingested_at_unix_ms: now - 8 * day },
    ];
    expect(addedThisWeek(docs, now)).toBe(2);
  });

  it("is zero for an empty library rather than undefined", () => {
    expect(addedThisWeek([], now)).toBe(0);
  });
});

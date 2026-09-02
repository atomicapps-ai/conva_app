import { describe, expect, it } from "vitest";

import {
  CATEGORY_LABEL,
  draftSetups,
  missingForSetup,
  PRACTICE_TEMPLATES,
  preparedSetups,
  toCoachingSessions,
  toSetups,
} from "@/components/coaching/coachingModel";
import {
  DEFAULT_CONTEXT_ID,
  type ContextSummary,
  type ConversationContext,
  type SessionSummary,
} from "@/lib/ipc";

function summary(over: Partial<ContextSummary> = {}): ContextSummary {
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

function full(over: Partial<ConversationContext> = {}): ConversationContext {
  return {
    id: "c1",
    title: "Director of Product Interview",
    purpose: "",
    job_description: null,
    category: "interview",
    status: "ready",
    created_at_unix_ms: 1,
    updated_at_unix_ms: 2,
    source_doc_ids: [],
    auto_generate_context: false,
    knowledge_profile_id: null,
    personas: [
      { id: "p1", title: "Hiring Manager", summary: "", style_tags: [], recommended: true },
    ],
    chosen_persona_id: "p1",
    conversation_id: null,
    dossier_doc_id: null,
    ...over,
  };
}

function session(over: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: "s1",
    started_at_unix_ms: 100,
    segment_count: 20,
    preview: "So, tell me about yourself",
    is_rehearsal: true,
    simcon_title: "Director of Product Interview",
    ...over,
  };
}

describe("PRACTICE_TEMPLATES", () => {
  it("only offers categories the backend actually supports", () => {
    const allowed = new Set(Object.keys(CATEGORY_LABEL));
    for (const t of PRACTICE_TEMPLATES) expect(allowed.has(t.category)).toBe(true);
  });

  it("has unique ids and a seeded purpose for each", () => {
    expect(new Set(PRACTICE_TEMPLATES.map((t) => t.id)).size).toBe(PRACTICE_TEMPLATES.length);
    for (const t of PRACTICE_TEMPLATES) expect(t.purpose.length).toBeGreaterThan(0);
  });
});

describe("missingForSetup", () => {
  it("asks for grounding first", () => {
    expect(
      missingForSetup(
        summary({ source_doc_count: 0, has_key_terms: false, research_enabled: false }),
        null,
      ),
    ).toMatch(/document, key terms, or research/);
  });

  it("then asks for generated resources", () => {
    expect(missingForSetup(summary({ has_generated_resources: false }), null)).toMatch(
      /Generate its resources/,
    );
  });

  it("then asks for a persona, then for the choice", () => {
    expect(missingForSetup(summary(), full({ personas: [], chosen_persona_id: null }))).toMatch(
      /Generate a counterparty persona/,
    );
    expect(missingForSetup(summary(), full({ chosen_persona_id: null }))).toMatch(
      /Choose a counterparty persona/,
    );
  });

  it("is null once everything is in place", () => {
    expect(missingForSetup(summary(), full())).toBeNull();
  });

  it("does not demand a persona when the full record hasn't loaded", () => {
    // Half-loaded data must not invent a blocker the user can't see.
    expect(missingForSetup(summary(), null)).toBeNull();
  });
});

describe("toSetups", () => {
  it("never lists the always-present default context as a setup", () => {
    const setups = toSetups([summary({ id: DEFAULT_CONTEXT_ID, title: "General conversation" })]);
    expect(setups).toEqual([]);
  });

  it("splits prepared from draft and names the missing step", () => {
    const setups = toSetups(
      [summary(), summary({ id: "c2", title: "Enterprise Discovery", has_generated_resources: false })],
      { c1: full() },
    );
    expect(preparedSetups(setups).map((s) => s.id)).toEqual(["c1"]);
    expect(draftSetups(setups).map((s) => s.id)).toEqual(["c2"]);
    expect(draftSetups(setups)[0]?.missing).toMatch(/Generate its resources/);
  });

  it("carries the chosen persona title and the real mode label", () => {
    const [setup] = toSetups([summary()], { c1: full() });
    expect(setup?.personaTitle).toBe("Hiring Manager");
    expect(setup?.modeLabel).toBe("Interview candidate");
  });

  it("shows no persona rather than a placeholder when none is chosen", () => {
    const [setup] = toSetups([summary()], { c1: full({ chosen_persona_id: null }) });
    expect(setup?.personaTitle).toBeNull();
  });

  it("flags a stale setup", () => {
    const [setup] = toSetups([summary({ resources_stale: true })], { c1: full() });
    expect(setup?.stale).toBe(true);
  });
});

describe("toCoachingSessions", () => {
  it("keeps only rehearsal runs — ordinary calls belong to Conversations", () => {
    const out = toCoachingSessions([
      session(),
      session({ id: "s2", is_rehearsal: false, simcon_title: null }),
    ]);
    expect(out.map((s) => s.id)).toEqual(["s1"]);
  });

  it("sorts newest first", () => {
    const out = toCoachingSessions([
      session({ id: "old", started_at_unix_ms: 10 }),
      session({ id: "new", started_at_unix_ms: 900 }),
    ]);
    expect(out.map((s) => s.id)).toEqual(["new", "old"]);
  });

  it("falls back to the transcript preview when the setup title is missing", () => {
    const out = toCoachingSessions([session({ simcon_title: null, preview: "Opening question" })]);
    expect(out[0]?.title).toBe("Opening question");
    expect(out[0]?.setupTitle).toBeNull();
  });

  it("returns an empty list for an empty history rather than throwing", () => {
    expect(toCoachingSessions([])).toEqual([]);
  });
});

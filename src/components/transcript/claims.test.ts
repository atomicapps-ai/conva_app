import { describe, expect, it } from "vitest";

import {
  CLAIM_STATE_META,
  projectClaimRecords,
  sortClaimsForTracking,
  type ClaimDisplayItem,
} from "@/components/transcript/claims";
import type { ClaimRecord } from "@/lib/ipc";

function claim(
  id: string,
  consequence: ClaimDisplayItem["consequence"],
  state: ClaimDisplayItem["state"],
): ClaimDisplayItem {
  return {
    id,
    proposition: id,
    state,
    attribution: null,
    consequence,
    exactQuote: id,
    attributionDetail: null,
    referenceDetail: null,
    nextAction: "Review it.",
    evidenceSummary: null,
    processingDisclosure: null,
    safeWording: null,
    evidence: [],
    primaryAction: "verify",
    primaryActionLabel: "Check claim",
  };
}

function record(overrides: Partial<ClaimRecord> = {}): ClaimRecord {
  return {
    id: "claim-b",
    source_segment_ids: ["inbound-42"],
    speaker_side: "inbound",
    speaker_label: "Caller",
    exact_quote:
      "ABC News is reporting that both people died in that car crash in Arizona",
    normalized_proposition:
      "both people died in the referenced car crash in Arizona",
    predicate: "died",
    subject: "both people",
    object: null,
    frame_kind: "attributed_claim",
    attribution_chain: [
      {
        source_label: "ABC News",
        reporting_verb: "is reporting",
        directness: "reported_by_speaker",
      },
    ],
    qualifiers: [
      { kind: "quantity", value: "both", unit: "people" },
      { kind: "location", value: "Arizona", unit: null },
    ],
    references: [
      {
        surface_text: "that car crash",
        kind: "event",
        required_for_verification: true,
        resolved_target_id: null,
        candidates: [],
      },
    ],
    modality: "reported",
    negated: false,
    sensitivity: "public",
    consequence: "high",
    importance_reasons: ["consequence_if_wrong", "unresolved_reference"],
    state: "needs_clarification",
    recommended_action: "resolve",
    policy_id: "live-stream-claims-v1",
    extraction_confidence: "high",
    resolution_confidence: "low",
    claim_confidence: null,
    evidence: [],
    corrections: [],
    created_at_unix_ms: 1_000,
    updated_at_unix_ms: 1_000,
    ...overrides,
  };
}

describe("claim presentation model", () => {
  it("provides the five approved compact state labels", () => {
    expect(Object.values(CLAIM_STATE_META).map((state) => state.label)).toEqual([
      "Attributed",
      "Checking",
      "Supported",
      "Conflict",
      "Needs context",
    ]);
  });

  it("sorts consequence before actionability and preserves stable ties", () => {
    const ordered = sortClaimsForTracking([
      claim("medium supported", "medium", "supported"),
      claim("high attributed", "high", "attributed"),
      claim("high conflict", "high", "conflict"),
      claim("high conflict second", "high", "conflict"),
      claim("low context", "low", "needs_context"),
    ]);
    expect(ordered.map((item) => item.id)).toEqual([
      "high conflict",
      "high conflict second",
      "high attributed",
      "medium supported",
      "low context",
    ]);
  });

  it("does not mutate the supplied snapshot", () => {
    const supplied = [
      claim("low", "low", "attributed"),
      claim("high", "high", "attributed"),
    ];
    sortClaimsForTracking(supplied);
    expect(supplied.map((item) => item.id)).toEqual(["low", "high"]);
  });

  it("projects attributed speech without flattening attribution or unresolved references", () => {
    const [projected] = projectClaimRecords([record()]);
    expect(projected).toMatchObject({
      state: "needs_context",
      attribution: "Reported by ABC News",
      exactQuote:
        "ABC News is reporting that both people died in that car crash in Arizona",
      attributionDetail: "ABC News — is reporting",
      referenceDetail: "that car crash → unresolved",
      primaryAction: "correct_links",
      primaryActionLabel: "Resolve references",
      safeWording:
        "ABC News reported that both people died in the referenced car crash in Arizona.",
    });
  });

  it("shows admitted evidence only and preserves a canonical state label", () => {
    const quality = {
      authority: "strong" as const,
      directness: "strong" as const,
      specificity: "adequate" as const,
      freshness: "strong" as const,
      independence: "adequate" as const,
      completeness: "adequate" as const,
      provenance: "strong" as const,
    };
    const [projected] = projectClaimRecords([
      record({
        state: "partly_supported",
        references: [],
        evidence: [
          {
            source_id: "official-1",
            source_class: "primary_official",
            publisher: "Arizona DPS",
            title: "Collision report",
            url: "https://example.test/report",
            local_document_id: null,
            excerpt: "One fatality was confirmed.",
            addressed_claim_part: "fatalities",
            scope: "underlying_proposition",
            stance: "partly_supports",
            quality,
            independence_group: "az-dps",
            admission: { decision: "admitted" },
            admission_policy_id: "live-stream-claims-v1",
            admission_policy_version: 1,
            published_at_unix_ms: 900,
            retrieved_at_unix_ms: 1_100,
          },
          {
            source_id: "blocked-1",
            source_class: "general_web_discovery",
            publisher: "Unknown blog",
            title: "Unapproved account",
            url: "https://blocked.example/post",
            local_document_id: null,
            excerpt: "Two people died.",
            addressed_claim_part: "fatalities",
            scope: "underlying_proposition",
            stance: "supports",
            quality,
            independence_group: null,
            admission: {
              decision: "rejected",
              reason: "domain_not_allowed",
            },
            admission_policy_id: "live-stream-claims-v1",
            admission_policy_version: 1,
            published_at_unix_ms: null,
            retrieved_at_unix_ms: 1_100,
          },
        ],
      }),
    ]);

    expect(projected?.state).toBe("supported");
    expect(projected?.stateLabel).toBe("Partly supported");
    expect(projected?.evidence).toEqual([
      {
        label: "Collision report",
        location: "https://example.test/report",
      },
    ]);
    expect(projected?.evidenceSummary).toContain("1 admitted source");
  });

  it("omits superseded and dismissed records from active tracking", () => {
    expect(
      projectClaimRecords([
        record({ id: "old", state: "superseded" }),
        record({ id: "dismissed", state: "dismissed" }),
      ]),
    ).toEqual([]);
  });
});

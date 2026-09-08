import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ConversationClaimReview } from "@/components/conversations/ConversationClaimReview";
import {
  buildClaimReview,
  claimReviewFromConversation,
  type ConversationClaimReviewData,
} from "@/components/conversations/claimReview";
import type { ClaimEvidenceRecord, ClaimRecord } from "@/lib/ipc";

afterEach(cleanup);

const quality = {
  authority: "strong",
  directness: "strong",
  specificity: "strong",
  freshness: "adequate",
  independence: "adequate",
  completeness: "strong",
  provenance: "strong",
} as const;

function evidence(
  overrides: Partial<ClaimEvidenceRecord> = {},
): ClaimEvidenceRecord {
  return {
    source_id: "official-record",
    source_class: "primary_official",
    publisher: "Arizona DPS",
    title: "Collision report",
    url: "https://example.test/collision",
    local_document_id: null,
    excerpt: "Two occupants died.",
    addressed_claim_part: "two deaths",
    scope: "underlying_proposition",
    stance: "supports",
    quality,
    independence_group: "az-dps",
    admission: { decision: "admitted" },
    admission_policy_id: "live-stream-claims",
    admission_policy_version: 2,
    published_at_unix_ms: 900,
    retrieved_at_unix_ms: 1_100,
    ...overrides,
  };
}

function claim(overrides: Partial<ClaimRecord> = {}): ClaimRecord {
  return {
    id: "claim-1",
    source_segment_ids: ["segment-1"],
    speaker_side: "inbound",
    speaker_label: "Guest",
    exact_quote: "ABC News is reporting that both people died.",
    normalized_proposition: "Both people died in the Arizona crash.",
    predicate: "died",
    subject: "both people",
    object: null,
    frame_kind: "attributed_claim",
    attribution_chain: [
      {
        source_label: "ABC News",
        reporting_verb: "reported",
        directness: "reported_by_speaker",
      },
    ],
    qualifiers: [{ kind: "location", value: "Arizona", unit: null }],
    references: [],
    modality: "reported",
    negated: false,
    sensitivity: "public",
    consequence: "high",
    importance_reasons: ["consequence_if_wrong"],
    state: "supported",
    recommended_action: "verify",
    policy_id: "live-stream-claims",
    policy_version: 2,
    extraction_confidence: "high",
    resolution_confidence: "high",
    claim_confidence: "strong",
    evidence: [evidence()],
    corrections: [],
    created_at_unix_ms: 1_000,
    updated_at_unix_ms: 1_100,
    ...overrides,
  };
}

function review(claims: ClaimRecord[]): ConversationClaimReviewData {
  return { conversation_id: "conversation-1", claims };
}

describe("buildClaimReview", () => {
  it("separates outcome metrics while retaining corrected and dismissed claims", () => {
    const result = buildClaimReview(
      review([
        claim(),
        claim({
          id: "conflict",
          state: "conflicting_evidence",
          claim_confidence: "conflicted",
        }),
        claim({ id: "unresolved", state: "needs_clarification", evidence: [] }),
        claim({
          id: "corrected",
          state: "superseded",
          corrections: [
            {
              kind: "reference",
              previous_value: "that crash",
              corrected_value: "I-10 crash",
              corrected_by: "user",
              created_at_unix_ms: 1_200,
            },
          ],
        }),
        claim({ id: "dismissed", state: "dismissed", evidence: [] }),
      ]),
    );

    expect(result).toMatchObject({
      detected: 5,
      checked: 2,
      unresolved: 1,
      conflicts: 1,
      corrected: 1,
      dismissed: 1,
    });
  });

  it("deduplicates admitted active-policy sources and counts rejected or stale evidence", () => {
    const result = buildClaimReview(
      review([
        claim(),
        claim({
          id: "claim-2",
          evidence: [
            evidence(),
            evidence({
              source_id: "stale",
              admission_policy_version: 1,
            }),
            evidence({
              source_id: "blocked",
              admission: { decision: "rejected", reason: "blocked_domain" },
            }),
          ],
        }),
      ]),
    );

    expect(result.sources.map((source) => source.source_id)).toEqual([
      "official-record",
    ]);
    expect(result.rejectedSources).toBe(2);
  });

  it("shows only explicitly recorded decision dependencies", () => {
    const dependency = {
      id: "decision-1",
      kind: "decision" as const,
      label: "Hold the broadcast until the fatalities are confirmed.",
      claim_ids: ["unresolved"],
    };
    expect(
      buildClaimReview({
        ...review([claim({ id: "unresolved", state: "needs_clarification" })]),
        dependencies: [dependency],
      }).dependencies,
    ).toEqual([dependency]);
    expect(buildClaimReview(review([claim()])).dependencies).toEqual([]);
    expect(
      buildClaimReview({ ...review([claim()]), dependencies: [dependency] })
        .dependencies,
    ).toEqual([]);
  });
});

describe("claimReviewFromConversation", () => {
  it("uses only linked sessions and the newest cumulative snapshot per session", () => {
    const result = claimReviewFromConversation({
      id: "conversation-1",
      title: "Saved",
      created_at_unix_ms: 1,
      updated_at_unix_ms: 2,
      segments: [],
      linked_docs: [],
      source_session_ids: ["session-1"],
      claim_snapshots: [
        {
          contract_version: 2,
          session_id: "session-1",
          epoch: 0,
          revision: 1,
          claims: [claim({ id: "old" })],
        },
        {
          contract_version: 2,
          session_id: "session-1",
          epoch: 0,
          revision: 2,
          claims: [claim({ id: "new" })],
        },
        {
          contract_version: 2,
          session_id: "another-session",
          epoch: 0,
          revision: 3,
          claims: [claim({ id: "wrong-conversation" })],
        },
      ],
    });

    expect(result.claims.map((record) => record.id)).toEqual(["new"]);
  });
});

describe("ConversationClaimReview", () => {
  it("renders review evidence, corrections, and explicit unresolved dependencies", () => {
    const unresolved = claim({
      id: "unresolved",
      state: "needs_clarification",
      corrections: [
        {
          kind: "reference",
          previous_value: "that crash",
          corrected_value: "I-10 crash",
          corrected_by: "user",
          created_at_unix_ms: 1_200,
        },
      ],
    });
    const inspect = vi.fn();
    render(
      createElement(ConversationClaimReview, {
        title: "Nolan Wells coverage",
        data: {
          conversation_id: "conversation-1",
          claims: [unresolved],
          dependencies: [
            {
              id: "decision-1",
              kind: "decision",
              label: "Hold the broadcast until the event is resolved.",
              claim_ids: ["unresolved"],
            },
          ],
          feedback: [
            {
              id: "feedback-1",
              kind: "source_selection",
              note: "Prefer the primary collision report for fatality counts.",
              claim_id: "unresolved",
            },
          ],
        },
        onClose: vi.fn(),
        onInspectEvidence: inspect,
      }),
    );

    expect(
      screen.getByText("Both people died in the Arizona crash."),
    ).toBeInTheDocument();
    expect(screen.getByText(/Reference corrected/)).toHaveTextContent(
      "I-10 crash",
    );
    expect(screen.getByText("Collision report")).toBeInTheDocument();
    expect(
      screen.getByText("Hold the broadcast until the event is resolved."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Prefer the primary collision report for fatality counts.",
      ),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Inspect evidence" }));
    expect(inspect).toHaveBeenCalledWith(unresolved);
  });
});

import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ClaimEvidenceView } from "@/components/partner/ClaimEvidenceView";
import {
  claimConfidenceAxes,
  evidenceAuditGroups,
} from "@/components/partner/claimEvidence";
import type { ClaimEvidenceRecord, ClaimRecord } from "@/lib/ipc";

afterEach(cleanup);

const quality = {
  authority: "strong",
  directness: "adequate",
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
    source_id: "abc-report",
    source_class: "recognized_reporting",
    publisher: "ABC News",
    title: "ABC News live report",
    url: "https://example.test/abc-report",
    local_document_id: null,
    excerpt: "Authorities told ABC News that two occupants died.",
    addressed_claim_part: "ABC News reported two deaths",
    scope: "attribution",
    stance: "supports",
    quality,
    independence_group: "abc",
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
    id: "claim-arizona",
    source_segment_ids: ["segment-1"],
    speaker_side: "inbound",
    speaker_label: "Guest",
    exact_quote:
      "ABC news is reporting that both people died in that car crash in Arizona",
    normalized_proposition:
      "Both people died in the referenced car crash in Arizona.",
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
    state: "attributed",
    recommended_action: "verify",
    policy_id: "live-stream-claims",
    policy_version: 2,
    extraction_confidence: "high",
    resolution_confidence: "low",
    claim_confidence: "none",
    evidence: [
      evidence(),
      evidence({
        source_id: "social-post",
        source_class: "community_material",
        publisher: "Unknown account",
        title: "Reposted social clip",
        url: "https://social.example/post",
        excerpt: "Both are gone.",
        scope: "underlying_proposition",
        addressed_claim_part: "the two deaths",
        admission: { decision: "rejected", reason: "domain_not_allowed" },
      }),
    ],
    corrections: [],
    created_at_unix_ms: 1_000,
    updated_at_unix_ms: 1_100,
    ...overrides,
  };
}

describe("claim evidence audit model", () => {
  it("keeps rejected and stale-policy evidence out of the admitted group", () => {
    const stale = evidence({
      source_id: "stale",
      title: "Previously admitted report",
      admission_policy_version: 1,
    });
    const groups = evidenceAuditGroups(
      claim({ evidence: [evidence(), stale, claim().evidence[1]!] }),
    );

    expect(groups.admitted.map((row) => row.record.source_id)).toEqual([
      "abc-report",
    ]);
    expect(groups.rejected.map((row) => row.record.source_id)).toEqual([
      "stale",
      "social-post",
    ]);
    expect(groups.rejected[0]?.rejectionReason).toMatch(/stale/i);
  });

  it("returns exactly four non-interchangeable confidence axes", () => {
    expect(claimConfidenceAxes(claim()).map((axis) => axis.label)).toEqual([
      "Extraction",
      "Reference resolution",
      "Source quality",
      "Claim confidence",
    ]);
    expect(claimConfidenceAxes(claim())[2]?.detail).toContain(
      "not claim confidence",
    );
  });
});

describe("ClaimEvidenceView", () => {
  it("shows decomposition, exact excerpts, and admitted/rejected evidence separately", () => {
    render(<ClaimEvidenceView claim={claim()} />);

    expect(
      screen.getByText(
        "Both people died in the referenced car crash in Arizona.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/ABC news is reporting that both people died/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/ABC News · is reporting · Reported By Speaker/),
    ).toBeInTheDocument();
    expect(screen.getByText(/that car crash → Unresolved/)).toBeInTheDocument();

    const admitted = screen
      .getByText("Admitted evidence · 1")
      .closest("section")!;
    expect(
      within(admitted).getByText("ABC News live report"),
    ).toBeInTheDocument();
    expect(
      within(admitted).getByText(/Authorities told ABC News/),
    ).toBeInTheDocument();
    expect(within(admitted).getByText("Attribution")).toBeInTheDocument();

    const rejected = screen
      .getByText("Rejected evidence · 1")
      .closest("section")!;
    expect(
      within(rejected).getByText("Reposted social clip"),
    ).toBeInTheDocument();
    expect(
      within(rejected).getByText(/Excluded: Domain Not Allowed/),
    ).toBeInTheDocument();
    expect(
      within(rejected).getByText(/do not contribute to claim confidence/i),
    ).toBeInTheDocument();
  });

  it("does not turn attribution evidence into support for the underlying proposition", () => {
    render(<ClaimEvidenceView claim={claim()} />);
    const claimAxis = screen.getByText("Claim confidence").parentElement!;
    expect(within(claimAxis).getByText("None")).toBeInTheDocument();
    const admitted = screen
      .getByText("Admitted evidence · 1")
      .closest("section")!;
    expect(within(admitted).getByText("Attribution")).toBeInTheDocument();
    expect(within(admitted).queryByText("Underlying Proposition")).toBeNull();
  });

  it("opens a local evidence document through the supplied viewer callback", () => {
    const onOpenDocument = vi.fn();
    render(
      <ClaimEvidenceView
        claim={claim({
          evidence: [
            evidence({
              url: null,
              local_document_id: "doc-42",
              title: "Incident briefing",
              source_class: "context_document",
            }),
          ],
        })}
        onOpenDocument={onOpenDocument}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open document" }));
    expect(onOpenDocument).toHaveBeenCalledWith("doc-42", "Incident briefing");
  });

  it("opens external evidence through the platform URL handler", () => {
    const onOpenUrl = vi.fn();
    render(<ClaimEvidenceView claim={claim()} onOpenUrl={onOpenUrl} />);
    fireEvent.click(screen.getAllByRole("button", { name: "Open source" })[0]!);
    expect(onOpenUrl).toHaveBeenCalledWith("https://example.test/abc-report");
  });
});

import { describe, expect, it } from "vitest";

import {
  defaultParticipationLens,
  defaultSourcePolicy,
  effectiveParticipationLens,
  normalizeDomains,
  normalizeSourcePolicy,
  participationLenses,
  sourcePolicyDisclosure,
} from "@/components/context/claimPolicy";
import type { ContextCategory } from "@/lib/ipc";

const CATEGORIES: ContextCategory[] = [
  "interview",
  "company_meeting",
  "sales_call",
  "live_stream",
  "other",
];

describe("Context claim policy", () => {
  it("offers every documented participation lens and a compatible default", () => {
    expect(participationLenses("interview").map((lens) => lens.label)).toEqual([
      "Candidate",
      "Interviewer / hiring team",
      "Observer / coach",
    ]);
    expect(participationLenses("company_meeting")).toHaveLength(5);
    expect(participationLenses("sales_call")).toHaveLength(4);
    expect(participationLenses("live_stream")).toHaveLength(4);
    expect(participationLenses("other")).toHaveLength(5);
    for (const category of CATEGORIES) {
      expect(participationLenses(category).some((lens) => lens.value === defaultParticipationLens(category))).toBe(true);
    }
  });

  it("falls back when an older or mismatched lens is loaded", () => {
    expect(effectiveParticipationLens("interview", null)).toBe("interviewee");
    expect(effectiveParticipationLens("company_meeting", "live_host")).toBe("meeting_participant");
  });

  it("mirrors category source-policy defaults", () => {
    expect(defaultSourcePolicy("interview")).toMatchObject({
      allow_open_web: true,
      allow_normalized_claim_egress: true,
      allow_automatic_checks: true,
      freshness_window_hours: 720,
    });
    expect(defaultSourcePolicy("company_meeting")).toMatchObject({
      allowed_classes: ["context_document", "approved_internal_repository"],
      allow_open_web: false,
      allow_normalized_claim_egress: false,
    });
    expect(defaultSourcePolicy("live_stream")).toMatchObject({
      allow_cached_evidence: false,
      freshness_window_hours: 24,
    });
    expect(defaultSourcePolicy("other").allow_automatic_checks).toBe(false);
  });

  it("normalizes domains and removes model knowledge from persisted source admission", () => {
    expect(normalizeDomains(" HTTPS://News.Example.com/path, news.example.com.\nOFFICIAL.GOV ")).toEqual([
      "news.example.com",
      "official.gov",
    ]);
    const normalized = normalizeSourcePolicy("interview", {
      ...defaultSourcePolicy("interview"),
      allowed_classes: ["primary_official", "model_knowledge"],
      allow_open_web: false,
      allow_normalized_claim_egress: true,
      allow_private_claim_egress: true,
    });
    expect(normalized.allowed_classes).toEqual([]);
    expect(normalized.allow_normalized_claim_egress).toBe(false);
    expect(normalized.allow_private_claim_egress).toBe(false);
  });

  it("makes the processing boundary explicit", () => {
    expect(sourcePolicyDisclosure(defaultSourcePolicy("live_stream"))).toContain("normalized claim");
    expect(sourcePolicyDisclosure(defaultSourcePolicy("company_meeting"))).toContain("stays on this device");
  });
});

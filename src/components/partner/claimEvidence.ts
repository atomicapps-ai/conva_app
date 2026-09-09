import type {
  ClaimEvidenceRecord,
  ClaimRecord,
  Confidence,
  QualityAssessment,
} from "@/lib/ipc";

export interface EvidenceAuditRow {
  record: ClaimEvidenceRecord;
  rejectionReason: string | null;
}

export interface EvidenceAuditGroups {
  admitted: EvidenceAuditRow[];
  rejected: EvidenceAuditRow[];
}

export interface ClaimConfidenceAxis {
  key: "extraction" | "resolution" | "source_quality" | "claim";
  label: string;
  value: string;
  detail: string;
  tone: "neutral" | "good" | "caution" | "conflict";
}

export function humanizeClaimValue(value: string): string {
  return value
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function evidenceAuditGroups(claim: ClaimRecord): EvidenceAuditGroups {
  const admitted: EvidenceAuditRow[] = [];
  const rejected: EvidenceAuditRow[] = [];

  for (const record of claim.evidence) {
    if (record.admission.decision === "rejected") {
      rejected.push({
        record,
        rejectionReason: humanizeClaimValue(record.admission.reason),
      });
      continue;
    }

    if (
      record.admission_policy_id !== claim.policy_id ||
      record.admission_policy_version !== claim.policy_version
    ) {
      rejected.push({
        record,
        rejectionReason: "Source admission is stale under the active policy",
      });
      continue;
    }

    admitted.push({ record, rejectionReason: null });
  }

  return { admitted, rejected };
}

export function claimConfidenceAxes(claim: ClaimRecord): ClaimConfidenceAxis[] {
  const { admitted } = evidenceAuditGroups(claim);
  return [
    {
      key: "extraction",
      label: "Extraction",
      value: humanizeClaimValue(claim.extraction_confidence),
      detail: "How confidently FANER understood the utterance.",
      tone: confidenceTone(claim.extraction_confidence),
    },
    {
      key: "resolution",
      label: "Reference resolution",
      value: humanizeClaimValue(claim.resolution_confidence),
      detail: "How confidently people, events, and pronouns were linked.",
      tone: confidenceTone(claim.resolution_confidence),
    },
    {
      key: "source_quality",
      label: "Source quality",
      value:
        admitted.length === 0
          ? "No admitted sources"
          : `${admitted.length} admitted source${admitted.length === 1 ? "" : "s"}`,
      detail: "Assessed per source below; this is not claim confidence.",
      tone: admitted.length === 0 ? "caution" : "neutral",
    },
    {
      key: "claim",
      label: "Claim confidence",
      value: humanizeClaimValue(claim.claim_confidence ?? "none"),
      detail: "Conclusion from admitted evidence only.",
      tone: claimConfidenceTone(claim.claim_confidence ?? "none"),
    },
  ];
}

export function qualityEntries(
  record: ClaimEvidenceRecord,
): Array<{ label: string; value: QualityAssessment }> {
  return [
    { label: "Authority", value: record.quality.authority },
    { label: "Directness", value: record.quality.directness },
    { label: "Specificity", value: record.quality.specificity },
    { label: "Freshness", value: record.quality.freshness },
    { label: "Independence", value: record.quality.independence },
    { label: "Completeness", value: record.quality.completeness },
    { label: "Provenance", value: record.quality.provenance },
  ];
}

function confidenceTone(value: Confidence): ClaimConfidenceAxis["tone"] {
  if (value === "high") return "good";
  if (value === "low" || value === "unknown") return "caution";
  return "neutral";
}

function claimConfidenceTone(
  value: NonNullable<ClaimRecord["claim_confidence"]>,
): ClaimConfidenceAxis["tone"] {
  if (value === "strong") return "good";
  if (value === "conflicted") return "conflict";
  if (value === "none" || value === "limited") return "caution";
  return "neutral";
}

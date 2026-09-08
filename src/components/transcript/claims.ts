import type { ClaimRecord } from "@/lib/ipc";

/**
 * UI-domain projection for the FANER claim-intelligence snapshot. The full,
 * versioned IPC record remains lossless; this compact model contains only what
 * the Tracking row needs to render and disclose.
 */
export type ClaimDisplayState =
  | "attributed"
  | "checking"
  | "supported"
  | "conflict"
  | "needs_context";

export type ClaimConsequence = "high" | "medium" | "low";

export type ClaimPrimaryAction =
  | "verify"
  | "recheck"
  | "review_conflict"
  | "correct_links"
  | "request_evidence";

export type ClaimRowAction =
  | ClaimPrimaryAction
  | "open_evidence"
  | "dismiss";

export interface ClaimEvidenceSummary {
  label: string;
  location: string | null;
}

export interface ClaimDisplayItem {
  id: string;
  proposition: string;
  state: ClaimDisplayState;
  /** More specific canonical state while retaining the approved compact tone. */
  stateLabel?: string;
  attribution: string | null;
  consequence: ClaimConsequence;
  exactQuote: string;
  attributionDetail: string | null;
  referenceDetail: string | null;
  nextAction: string;
  evidenceSummary: string | null;
  processingDisclosure: string | null;
  safeWording: string | null;
  evidence: ClaimEvidenceSummary[];
  primaryAction: ClaimPrimaryAction;
  primaryActionLabel: string;
}

export const CLAIM_STATE_META: Record<
  ClaimDisplayState,
  { label: string; tone: "neutral" | "checking" | "supported" | "conflict" | "context" }
> = {
  attributed: { label: "Attributed", tone: "neutral" },
  checking: { label: "Checking", tone: "checking" },
  supported: { label: "Supported", tone: "supported" },
  conflict: { label: "Conflict", tone: "conflict" },
  needs_context: { label: "Needs context", tone: "context" },
};

const CONSEQUENCE_ORDER: Record<ClaimConsequence, number> = {
  high: 0,
  medium: 1,
  low: 2,
};

const ACTIONABILITY_ORDER: Record<ClaimDisplayState, number> = {
  conflict: 0,
  needs_context: 1,
  checking: 2,
  attributed: 3,
  supported: 4,
};

/** Highest consequence first, then the state most likely to need attention. */
export function sortClaimsForTracking(
  claims: readonly ClaimDisplayItem[],
): ClaimDisplayItem[] {
  return claims
    .map((claim, index) => ({ claim, index }))
    .sort(
      (a, b) =>
        CONSEQUENCE_ORDER[a.claim.consequence] -
          CONSEQUENCE_ORDER[b.claim.consequence] ||
        ACTIONABILITY_ORDER[a.claim.state] - ACTIONABILITY_ORDER[b.claim.state] ||
        a.index - b.index,
    )
    .map(({ claim }) => claim);
}

/** Project the versioned IPC record into the compact Tracking-row contract. */
export function projectClaimRecords(
  records: readonly ClaimRecord[],
): ClaimDisplayItem[] {
  return records
    .filter((record) => record.state !== "superseded" && record.state !== "dismissed")
    .map(projectClaimRecord);
}

function projectClaimRecord(record: ClaimRecord): ClaimDisplayItem {
  const unresolved = record.references.filter(
    (reference) => reference.required_for_verification && !reference.resolved_target_id,
  );
  const admitted = record.evidence.filter(
    (evidence) => evidence.admission.decision === "admitted",
  );
  const attribution = record.attribution_chain[0]?.source_label ?? null;
  const { state, label } = compactState(record.state);
  const { action, actionLabel } = primaryAction(record.state, unresolved.length > 0);
  return {
    id: record.id,
    proposition: record.normalized_proposition,
    state,
    stateLabel: label,
    attribution: attribution ? `Reported by ${attribution}` : null,
    consequence: record.consequence,
    exactQuote: record.exact_quote,
    attributionDetail:
      record.attribution_chain.length > 0
        ? record.attribution_chain
            .map((item) => `${item.source_label} — ${item.reporting_verb || "attributed"}`)
            .join("; ")
        : null,
    referenceDetail:
      record.references.length > 0
        ? record.references
            .map((reference) =>
              reference.resolved_target_id
                ? `${reference.surface_text} → ${reference.candidates.find((candidate) => candidate.target_id === reference.resolved_target_id)?.label ?? reference.resolved_target_id}`
                : `${reference.surface_text} → unresolved`,
            )
            .join("; ")
        : null,
    nextAction: nextAction(record.state, unresolved.length > 0),
    evidenceSummary:
      admitted.length > 0
        ? `${admitted.length} admitted source${admitted.length === 1 ? "" : "s"}; inspect before relying on this claim.`
        : "No admitted evidence yet.",
    processingDisclosure: `Source policy: ${record.policy_id} v${record.policy_version}.`,
    safeWording: attribution
      ? `${attribution} reported that ${record.normalized_proposition}.`
      : null,
    evidence: admitted.map((evidence) => ({
      label: evidence.title,
      location: evidence.url ?? evidence.local_document_id,
    })),
    primaryAction: action,
    primaryActionLabel: actionLabel,
  };
}

function compactState(state: ClaimRecord["state"]): {
  state: ClaimDisplayState;
  label?: string;
} {
  switch (state) {
    case "needs_clarification":
      return { state: "needs_context" };
    case "queued":
      return { state: "checking", label: "Queued" };
    case "checking":
      return { state: "checking" };
    case "supported":
      return { state: "supported" };
    case "partly_supported":
      return { state: "supported", label: "Partly supported" };
    case "conflicting_evidence":
      return { state: "conflict" };
    case "not_verified":
      return { state: "attributed", label: "Not verified" };
    case "not_externally_verifiable":
      return { state: "needs_context", label: "Not externally verifiable" };
    case "detected":
      return { state: "attributed", label: "Detected" };
    case "attributed":
    case "superseded":
    case "dismissed":
      return { state: "attributed" };
  }
}

function primaryAction(
  state: ClaimRecord["state"],
  unresolved: boolean,
): { action: ClaimPrimaryAction; actionLabel: string } {
  if (unresolved) return { action: "correct_links", actionLabel: "Resolve references" };
  if (state === "conflicting_evidence") {
    return { action: "review_conflict", actionLabel: "Review conflict" };
  }
  if (state === "supported" || state === "partly_supported") {
    return { action: "recheck", actionLabel: "Recheck" };
  }
  if (state === "not_verified" || state === "not_externally_verifiable") {
    return { action: "request_evidence", actionLabel: "Request evidence" };
  }
  return { action: "verify", actionLabel: "Check claim" };
}

function nextAction(state: ClaimRecord["state"], unresolved: boolean): string {
  if (unresolved) return "Resolve the required references before checking this claim.";
  if (state === "checking" || state === "queued") return "Wait for the admitted evidence check.";
  if (state === "conflicting_evidence") return "Compare the conflicting evidence and limitations.";
  if (state === "supported" || state === "partly_supported") return "Review the supporting evidence before relying on it.";
  if (state === "not_externally_verifiable") return "Ask for inspectable evidence or keep this as a conversational assertion.";
  return "Check this claim using the active Context source policy.";
}

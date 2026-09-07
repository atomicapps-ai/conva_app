/**
 * UI-domain claim types for the first FANER claim-intelligence slice.
 *
 * These are intentionally not IPC types yet. The live semantic/event contract
 * lands only after its Rust core model is defined and mirrored in TypeScript.
 * Until then, callers may explicitly inject claim snapshots for UI review and
 * tests without fabricating claims from production transcript text.
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

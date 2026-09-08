import {
  evidenceAuditGroups,
  humanizeClaimValue,
} from "@/components/partner/claimEvidence";
import type {
  ClaimEvidenceRecord,
  ClaimRecord,
  ClaimSnapshotEvent,
  Conversation,
} from "@/lib/ipc";

export interface ClaimDependency {
  id: string;
  kind: "decision" | "commitment";
  label: string;
  claim_ids: string[];
}

export interface ClaimReviewFeedback {
  id: string;
  kind: "extraction" | "source_selection";
  note: string;
  claim_id: string | null;
}

/**
 * UI-only input for checkpoint 3.6c. It is deliberately supplied by the
 * caller instead of being added to Conversation: claim persistence and the
 * producer that fills it are later checkpoints.
 */
export interface ConversationClaimReviewData {
  conversation_id: string;
  claims: ClaimRecord[];
  dependencies?: ClaimDependency[];
  feedback?: ClaimReviewFeedback[];
}

export interface ClaimReviewRow {
  claim: ClaimRecord;
  stateLabel: string;
  checked: boolean;
  unresolved: boolean;
  conflicted: boolean;
  corrected: boolean;
  dismissed: boolean;
  attribution: string | null;
  admittedSourceCount: number;
  rejectedSourceCount: number;
}

export interface ClaimReviewSummary {
  rows: ClaimReviewRow[];
  detected: number;
  checked: number;
  unresolved: number;
  conflicts: number;
  corrected: number;
  dismissed: number;
  rejectedSources: number;
  sources: ClaimEvidenceRecord[];
  dependencies: ClaimDependency[];
  feedback: ClaimReviewFeedback[];
}

const CHECKED_STATES = new Set<ClaimRecord["state"]>([
  "supported",
  "partly_supported",
  "conflicting_evidence",
  "not_verified",
  "not_externally_verifiable",
]);

const UNRESOLVED_STATES = new Set<ClaimRecord["state"]>([
  "detected",
  "attributed",
  "needs_clarification",
  "queued",
  "checking",
  "not_verified",
  "not_externally_verifiable",
]);

export function buildClaimReview(
  data: ConversationClaimReviewData,
): ClaimReviewSummary {
  const sources = new Map<string, ClaimEvidenceRecord>();
  let rejectedSources = 0;

  const rows = data.claims.map((claim): ClaimReviewRow => {
    const evidence = evidenceAuditGroups(claim);
    rejectedSources += evidence.rejected.length;
    for (const { record } of evidence.admitted) {
      sources.set(record.source_id, record);
    }
    return {
      claim,
      stateLabel: humanizeClaimValue(claim.state),
      checked: CHECKED_STATES.has(claim.state),
      unresolved: UNRESOLVED_STATES.has(claim.state),
      conflicted: claim.state === "conflicting_evidence",
      corrected: claim.state === "superseded" || claim.corrections.length > 0,
      dismissed: claim.state === "dismissed",
      attribution: claim.attribution_chain[0]?.source_label ?? null,
      admittedSourceCount: evidence.admitted.length,
      rejectedSourceCount: evidence.rejected.length,
    };
  });
  const unresolvedClaimIds = new Set(
    rows.filter((row) => row.unresolved).map((row) => row.claim.id),
  );

  return {
    rows,
    detected: rows.length,
    checked: rows.filter((row) => row.checked).length,
    unresolved: rows.filter((row) => row.unresolved).length,
    conflicts: rows.filter((row) => row.conflicted).length,
    corrected: rows.filter((row) => row.corrected).length,
    dismissed: rows.filter((row) => row.dismissed).length,
    rejectedSources,
    sources: [...sources.values()],
    dependencies: (data.dependencies ?? []).filter((dependency) =>
      dependency.claim_ids.some((claimId) => unresolvedClaimIds.has(claimId)),
    ),
    feedback: data.feedback ?? [],
  };
}

/** Build a review only from snapshots explicitly linked to this saved
 * conversation, selecting the newest cumulative event for each session. */
export function claimReviewFromConversation(
  conversation: Conversation,
): ConversationClaimReviewData {
  const linked = new Set(conversation.source_session_ids ?? []);
  const latest = new Map<string, ClaimSnapshotEvent>();
  for (const snapshot of conversation.claim_snapshots ?? []) {
    if (!linked.has(snapshot.session_id)) continue;
    const current = latest.get(snapshot.session_id);
    if (
      !current ||
      snapshot.epoch > current.epoch ||
      (snapshot.epoch === current.epoch && snapshot.revision > current.revision)
    ) {
      latest.set(snapshot.session_id, snapshot);
    }
  }
  const claims = (conversation.source_session_ids ?? []).flatMap(
    (sessionId) => latest.get(sessionId)?.claims ?? [],
  );
  return { conversation_id: conversation.id, claims };
}

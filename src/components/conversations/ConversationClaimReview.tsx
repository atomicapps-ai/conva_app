import { useMemo } from "react";

import {
  buildClaimReview,
  type ClaimReviewRow,
  type ConversationClaimReviewData,
} from "@/components/conversations/claimReview";
import { humanizeClaimValue } from "@/components/partner/claimEvidence";
import { Icon } from "@/components/ui/Icon";
import type { ClaimRecord } from "@/lib/ipc";

const STATE_TONE: Record<ClaimRecord["state"], string> = {
  detected: "border-border-strong bg-bg-2 text-fg-muted",
  attributed: "border-primary/35 bg-primary/10 text-primary",
  needs_clarification: "border-ai/40 bg-ai/10 text-ai",
  queued: "border-primary/35 bg-primary/10 text-primary",
  checking: "border-primary/35 bg-primary/10 text-primary",
  supported: "border-inbound/40 bg-inbound/10 text-inbound",
  partly_supported: "border-ai/40 bg-ai/10 text-ai",
  conflicting_evidence: "border-rec/45 bg-rec/10 text-rec",
  not_verified: "border-ai/40 bg-ai/10 text-ai",
  not_externally_verifiable: "border-ai/40 bg-ai/10 text-ai",
  superseded: "border-border-strong bg-bg-2 text-fg-faint",
  dismissed: "border-border-strong bg-bg-2 text-fg-faint",
};

export function ConversationClaimReview({
  title,
  data,
  onClose,
  onInspectEvidence,
}: {
  title: string;
  data: ConversationClaimReviewData;
  onClose: () => void;
  onInspectEvidence: (claim: ClaimRecord) => void;
}) {
  const review = useMemo(() => buildClaimReview(data), [data]);

  return (
    <section
      aria-label={`Claim review for ${title}`}
      className="flex flex-col gap-3"
    >
      <div className="card flex items-start gap-3 border-l-2 border-l-primary p-3">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded border border-primary/35 bg-primary/10 text-primary">
          <Icon name="check" size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[9px] font-bold uppercase tracking-[0.15em] text-primary">
            Conversation review
          </p>
          <h3 className="truncate text-sm font-extrabold text-fg">{title}</h3>
          <p className="mt-0.5 text-[11px] text-fg-faint">
            Claims, outcomes, corrections, admitted sources, and unresolved
            dependencies.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close claim review"
          title="Back to conversation list"
          className="grid h-8 w-8 shrink-0 place-items-center rounded border border-border-strong bg-bg-2 text-fg-muted transition hover:text-fg"
        >
          <Icon name="close" size={14} />
        </button>
      </div>

      {review.rows.length === 0 ? (
        <div className="card grid place-items-center px-6 py-14 text-center text-xs text-fg-faint">
          No claims were recorded for this conversation.
        </div>
      ) : (
        <div className="grid min-h-0 grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_15rem]">
          <section aria-labelledby="review-claims-heading" className="card p-3">
            <h4
              id="review-claims-heading"
              className="mb-2 font-mono text-[10px] font-bold uppercase tracking-[0.13em] text-fg-muted"
            >
              Claims from this conversation
            </h4>
            <div className="flex flex-col gap-2">
              {review.rows.map((row) => (
                <ClaimRow
                  key={row.claim.id}
                  row={row}
                  onInspectEvidence={onInspectEvidence}
                />
              ))}
            </div>
          </section>

          <aside
            className="flex flex-col gap-3"
            aria-label="Claim review summary"
          >
            <section className="card p-3">
              <h4 className="text-xs font-bold text-fg">Claim review</h4>
              <dl className="mt-2 grid grid-cols-2 gap-1.5">
                <Metric label="Detected" value={review.detected} />
                <Metric label="Checked" value={review.checked} />
                <Metric
                  label="Unresolved"
                  value={review.unresolved}
                  tone="text-ai"
                />
                <Metric
                  label="Conflicts"
                  value={review.conflicts}
                  tone="text-rec"
                />
                <Metric label="Corrected" value={review.corrected} />
                <Metric label="Dismissed" value={review.dismissed} />
              </dl>
              <p className="mt-2 border-t border-border pt-2 text-[10px] text-fg-faint">
                {review.rejectedSources} rejected or stale source
                {review.rejectedSources === 1 ? "" : "s"} kept for audit only.
              </p>
            </section>

            <section className="card p-3">
              <h4 className="text-xs font-bold text-fg">Sources used</h4>
              {review.sources.length === 0 ? (
                <p className="mt-2 text-[10px] leading-relaxed text-fg-faint">
                  No evidence was admitted under the active source policies.
                </p>
              ) : (
                <ul className="mt-2 flex flex-col gap-1.5">
                  {review.sources.map((source) => (
                    <li
                      key={source.source_id}
                      className="rounded border border-border bg-bg-2 p-2"
                    >
                      <p className="text-[10px] font-semibold leading-snug text-fg">
                        {source.title}
                      </p>
                      <p className="mt-0.5 font-mono text-[9px] text-fg-faint">
                        {source.publisher} ·{" "}
                        {humanizeClaimValue(source.source_class)}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="card p-3">
              <h4 className="text-xs font-bold text-fg">Dependent decisions</h4>
              {review.dependencies.length === 0 ? (
                <p className="mt-2 text-[10px] leading-relaxed text-fg-faint">
                  No decision or commitment dependencies were recorded. Conva
                  does not infer them after the fact.
                </p>
              ) : (
                <ul className="mt-2 flex flex-col gap-1.5">
                  {review.dependencies.map((dependency) => (
                    <li
                      key={dependency.id}
                      className="rounded border border-ai/25 bg-ai/[0.06] p-2"
                    >
                      <p className="font-mono text-[9px] uppercase text-ai">
                        {dependency.kind}
                      </p>
                      <p className="mt-0.5 text-[10px] leading-snug text-fg">
                        {dependency.label}
                      </p>
                      <p className="mt-1 text-[9px] text-fg-faint">
                        Depends on {dependency.claim_ids.length} claim
                        {dependency.claim_ids.length === 1 ? "" : "s"}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="card p-3">
              <h4 className="text-xs font-bold text-fg">Review feedback</h4>
              {review.feedback.length === 0 ? (
                <p className="mt-2 text-[10px] leading-relaxed text-fg-faint">
                  No extraction or source-selection feedback was recorded.
                  Corrections above remain visible without silently changing
                  policy.
                </p>
              ) : (
                <ul className="mt-2 flex flex-col gap-1.5">
                  {review.feedback.map((feedback) => (
                    <li
                      key={feedback.id}
                      className="rounded border border-border bg-bg-2 p-2"
                    >
                      <p className="font-mono text-[9px] uppercase text-fg-faint">
                        {humanizeClaimValue(feedback.kind)}
                      </p>
                      <p className="mt-0.5 text-[10px] leading-snug text-fg">
                        {feedback.note}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </aside>
        </div>
      )}
    </section>
  );
}

function ClaimRow({
  row,
  onInspectEvidence,
}: {
  row: ClaimReviewRow;
  onInspectEvidence: (claim: ClaimRecord) => void;
}) {
  return (
    <article className="rounded-md border border-border bg-bg/40 p-3">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h5 className="text-xs font-bold leading-snug text-fg">
            {row.claim.normalized_proposition}
          </h5>
          <p className="mt-1 text-[10px] leading-relaxed text-fg-faint">
            {row.attribution
              ? `Attributed to ${row.attribution}`
              : "Speaker assertion"}
            {" · "}
            {row.admittedSourceCount} admitted source
            {row.admittedSourceCount === 1 ? "" : "s"}
            {row.rejectedSourceCount > 0
              ? ` · ${row.rejectedSourceCount} rejected or stale`
              : ""}
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full border px-2 py-0.5 font-mono text-[9px] ${STATE_TONE[row.claim.state]}`}
        >
          {row.stateLabel}
        </span>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <Tag>{humanizeClaimValue(row.claim.consequence)} consequence</Tag>
        {row.unresolved && <Tag tone="caution">Unresolved</Tag>}
        {row.corrected && <Tag>Corrected</Tag>}
        <button
          type="button"
          onClick={() => onInspectEvidence(row.claim)}
          className="ml-auto inline-flex items-center gap-1 rounded border border-primary/35 bg-primary/10 px-2 py-1 text-[10px] font-bold text-primary transition hover:bg-primary/15"
        >
          <Icon name="expand" size={11} />
          Inspect evidence
        </button>
      </div>

      {row.claim.corrections.length > 0 && (
        <div className="mt-2 border-l-2 border-l-ai/50 pl-2 text-[10px] text-fg-muted">
          {row.claim.corrections.map((correction, index) => (
            <p key={`${correction.created_at_unix_ms}-${index}`}>
              {humanizeClaimValue(correction.kind)} corrected: “
              {correction.previous_value}” → “{correction.corrected_value}”
            </p>
          ))}
        </div>
      )}
    </article>
  );
}

function Metric({
  label,
  value,
  tone = "text-fg",
}: {
  label: string;
  value: number;
  tone?: string;
}) {
  return (
    <div className="rounded border border-border bg-bg-2 px-2 py-1.5">
      <dt className="font-mono text-[9px] text-fg-faint">{label}</dt>
      <dd className={`mt-0.5 text-base font-extrabold ${tone}`}>{value}</dd>
    </div>
  );
}

function Tag({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "caution";
}) {
  return (
    <span
      className={`rounded-full border px-1.5 py-0.5 font-mono text-[9px] ${
        tone === "caution"
          ? "border-ai/35 bg-ai/[0.07] text-ai"
          : "border-border bg-bg-2 text-fg-faint"
      }`}
    >
      {children}
    </span>
  );
}

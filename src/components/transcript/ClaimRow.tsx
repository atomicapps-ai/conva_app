import { useId, useState } from "react";

import {
  CLAIM_STATE_META,
  type ClaimDisplayItem,
  type ClaimRowAction,
} from "@/components/transcript/claims";
import { Icon } from "@/components/ui/Icon";

const STATE_TONE = {
  neutral: "border-border-strong bg-bg-2 text-fg-muted",
  checking: "border-primary/50 bg-primary/10 text-primary",
  supported: "border-inbound/50 bg-inbound/10 text-inbound",
  conflict: "border-rec/50 bg-rec/10 text-rec",
  context: "border-ai/50 bg-ai/10 text-ai",
} as const;

const CONSEQUENCE_LABEL = {
  high: "High consequence",
  medium: "Medium consequence",
  low: "Low consequence",
} as const;

export function ClaimRow({
  claim,
  canOpenEvidence,
  onAction,
  enabledActions,
}: {
  claim: ClaimDisplayItem;
  canOpenEvidence: boolean;
  onAction?: (claim: ClaimDisplayItem, action: ClaimRowAction) => void;
  /** Omit to enable every action when a handler exists. */
  enabledActions?: readonly ClaimRowAction[];
}) {
  const [expanded, setExpanded] = useState(false);
  const detailId = useId();
  const state = CLAIM_STATE_META[claim.state];
  const hasEvidence = Boolean(claim.evidenceSummary || claim.evidence.length);

  const action = (next: ClaimRowAction) => onAction?.(claim, next);
  const actionEnabled = (next: ClaimRowAction) =>
    Boolean(onAction) && (!enabledActions || enabledActions.includes(next));

  return (
    <article className="rounded-[var(--radius)] border border-border border-l-2 border-l-primary/70 bg-panel transition hover:border-border-strong hover:border-l-primary">
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={detailId}
        onClick={() => setExpanded((open) => !open)}
        className="flex w-full items-start gap-2 px-2.5 py-2 text-left"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-[0.92em] font-semibold leading-snug text-fg">
            {claim.proposition}
          </span>
          <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[9px] text-fg-faint">
            {claim.attribution && <span>{claim.attribution}</span>}
            <span>{CONSEQUENCE_LABEL[claim.consequence]}</span>
          </span>
        </span>
        <span
          role="status"
          aria-live="polite"
          className={`shrink-0 rounded-full border px-1.5 py-0.5 font-mono text-[9px] font-bold ${STATE_TONE[state.tone]}`}
        >
          {state.label}
        </span>
        <Icon
          name="chevron"
          size={12}
          className={`mt-1 shrink-0 text-fg-faint transition-transform ${expanded ? "rotate-180" : ""}`}
        />
      </button>

      {expanded && (
        <div id={detailId} className="border-t border-border px-2.5 pb-2.5 pt-2">
          <p className="text-[0.84em] italic leading-snug text-fg-muted">
            “{claim.exactQuote}”
          </p>

          <div className="mt-2 flex flex-col gap-2">
            {claim.attributionDetail && (
              <ClaimDetail label="Attribution" text={claim.attributionDetail} />
            )}
            {claim.referenceDetail && (
              <ClaimDetail label="References" text={claim.referenceDetail} />
            )}
            <ClaimDetail label="Next action" text={claim.nextAction} />
            {claim.evidenceSummary && (
              <ClaimDetail label="Evidence" text={claim.evidenceSummary} />
            )}
            {claim.processingDisclosure && (
              <ClaimDetail label="Processing" text={claim.processingDisclosure} />
            )}
          </div>

          <div className="mt-2.5 flex flex-wrap gap-1.5">
            <button
              type="button"
              disabled={!actionEnabled(claim.primaryAction)}
              onClick={() => action(claim.primaryAction)}
              className="rounded-full bg-primary px-2.5 py-1 text-[10.5px] font-bold text-bg transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {claim.primaryActionLabel}
            </button>
            {hasEvidence && (
              <button
                type="button"
                disabled={!actionEnabled("open_evidence") || !canOpenEvidence}
                title={
                  canOpenEvidence
                    ? "Open admitted evidence"
                    : "Evidence viewer is unavailable on this surface"
                }
                onClick={() => action("open_evidence")}
                className="rounded-full border border-border-strong px-2.5 py-1 text-[10.5px] font-semibold text-fg-muted transition hover:text-fg disabled:cursor-not-allowed disabled:opacity-40"
              >
                Evidence
              </button>
            )}
            {claim.referenceDetail && (
              <button
                type="button"
                disabled={!actionEnabled("correct_links")}
                onClick={() => action("correct_links")}
                className="rounded-full border border-border-strong px-2.5 py-1 text-[10.5px] font-semibold text-fg-muted transition hover:text-fg disabled:cursor-not-allowed disabled:opacity-40"
              >
                Correct links
              </button>
            )}
            <button
              type="button"
              disabled={!actionEnabled("dismiss")}
              onClick={() => action("dismiss")}
              className="rounded-full border border-border px-2.5 py-1 text-[10.5px] text-fg-faint transition hover:border-rec/40 hover:text-rec disabled:cursor-not-allowed disabled:opacity-40"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}
    </article>
  );
}

function ClaimDetail({ label, text }: { label: string; text: string }) {
  return (
    <div>
      <p className="font-mono text-[8.5px] font-bold uppercase tracking-[0.12em] text-fg-faint">
        {label}
      </p>
      <p className="mt-0.5 text-[0.82em] leading-snug text-fg-muted">{text}</p>
    </div>
  );
}

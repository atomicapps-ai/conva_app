import {
  claimConfidenceAxes,
  evidenceAuditGroups,
  humanizeClaimValue,
  qualityEntries,
  type EvidenceAuditRow,
} from "@/components/partner/claimEvidence";
import type { ClaimRecord } from "@/lib/ipc";

const AXIS_TONE = {
  neutral: "border-border-strong bg-bg-2",
  good: "border-inbound/45 bg-inbound/[0.06]",
  caution: "border-ai/45 bg-ai/[0.06]",
  conflict: "border-rec/50 bg-rec/[0.07]",
} as const;

export function ClaimEvidenceView({
  claim,
  onOpenDocument,
  onOpenUrl,
}: {
  claim: ClaimRecord;
  onOpenDocument?: (documentId: string, label: string) => void;
  onOpenUrl?: (url: string) => void;
}) {
  const groups = evidenceAuditGroups(claim);
  const axes = claimConfidenceAxes(claim);

  return (
    <div data-testid="claim-evidence-view" className="flex flex-col gap-4">
      <section className="border-l-2 border-l-primary bg-primary/[0.035] px-3 py-3">
        <p className="font-mono text-[0.68em] font-bold uppercase tracking-[0.16em] text-primary">
          Normalized proposition
        </p>
        <h2 className="mt-1 text-[1.18em] font-extrabold leading-snug text-fg">
          {claim.normalized_proposition}
        </h2>
        <div className="mt-2 flex flex-wrap gap-1.5 font-mono text-[0.66em]">
          <Badge>{humanizeClaimValue(claim.state)}</Badge>
          <Badge>{humanizeClaimValue(claim.frame_kind)}</Badge>
          <Badge>{humanizeClaimValue(claim.consequence)} consequence</Badge>
          {claim.speaker_label && <Badge>Speaker: {claim.speaker_label}</Badge>}
        </div>
      </section>

      <section aria-labelledby="claim-confidence-heading">
        <SectionHeading id="claim-confidence-heading">
          Four separate confidence axes
        </SectionHeading>
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {axes.map((axis) => (
            <article
              key={axis.key}
              className={`rounded-[var(--radius)] border p-2.5 ${AXIS_TONE[axis.tone]}`}
            >
              <p className="font-mono text-[0.64em] font-bold uppercase tracking-[0.12em] text-fg-faint">
                {axis.label}
              </p>
              <p className="mt-0.5 text-[0.9em] font-bold text-fg">
                {axis.value}
              </p>
              <p className="mt-1 text-[0.72em] leading-snug text-fg-muted">
                {axis.detail}
              </p>
            </article>
          ))}
        </div>
      </section>

      <section aria-labelledby="claim-breakdown-heading">
        <SectionHeading id="claim-breakdown-heading">
          Claim decomposition
        </SectionHeading>
        <div className="mt-2 rounded-[var(--radius)] border border-border bg-bg-2 p-3">
          <Detail label="Exact spoken text">
            <q className="italic">{claim.exact_quote}</q>
          </Detail>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Detail label="Subject">{claim.subject ?? "Not isolated"}</Detail>
            <Detail label="Predicate">
              {claim.predicate || "Not isolated"}
            </Detail>
            <Detail label="Object">{claim.object ?? "Not isolated"}</Detail>
          </div>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Detail label="Modality">
              {humanizeClaimValue(claim.modality)}
              {claim.negated ? " · negated" : ""}
            </Detail>
            <Detail label="Sensitivity">
              {humanizeClaimValue(claim.sensitivity)}
            </Detail>
          </div>
          {claim.attribution_chain.length > 0 && (
            <div className="mt-3">
              <Detail label="Attribution chain">
                {claim.attribution_chain.map((item, index) => (
                  <span key={`${item.source_label}-${index}`} className="block">
                    {item.source_label} · {item.reporting_verb || "attributed"}{" "}
                    · {humanizeClaimValue(item.directness)}
                  </span>
                ))}
              </Detail>
            </div>
          )}
          {claim.qualifiers.length > 0 && (
            <div className="mt-3">
              <Detail label="Qualifiers">
                {claim.qualifiers.map((item, index) => (
                  <span
                    key={`${item.kind}-${item.value}-${index}`}
                    className="mr-2 inline-block"
                  >
                    {humanizeClaimValue(item.kind)}: {item.value}
                    {item.unit ? ` ${item.unit}` : ""}
                  </span>
                ))}
              </Detail>
            </div>
          )}
          {claim.references.length > 0 && (
            <div className="mt-3">
              <Detail label="Reference links">
                {claim.references.map((reference, index) => {
                  const resolved = reference.candidates.find(
                    (candidate) =>
                      candidate.target_id === reference.resolved_target_id,
                  );
                  return (
                    <span
                      key={`${reference.surface_text}-${index}`}
                      className="block"
                    >
                      {reference.surface_text} →{" "}
                      {resolved?.label ??
                        reference.resolved_target_id ??
                        "Unresolved"}
                      {reference.required_for_verification
                        ? " · required for verification"
                        : ""}
                    </span>
                  );
                })}
              </Detail>
            </div>
          )}
        </div>
      </section>

      <EvidenceSection
        title={`Admitted evidence · ${groups.admitted.length}`}
        description="Only these sources may contribute to the claim conclusion under the active Context policy."
        rows={groups.admitted}
        admitted
        onOpenDocument={onOpenDocument}
        onOpenUrl={onOpenUrl}
      />

      <EvidenceSection
        title={`Rejected evidence · ${groups.rejected.length}`}
        description="Retained for audit. These sources do not contribute to claim confidence."
        rows={groups.rejected}
        admitted={false}
        onOpenDocument={onOpenDocument}
        onOpenUrl={onOpenUrl}
      />

      <p className="rounded-[var(--radius)] border border-border bg-bg-2 px-3 py-2 font-mono text-[0.68em] leading-relaxed text-fg-faint">
        Active source policy: {claim.policy_id} v{claim.policy_version}. This
        view displays supplied evidence only; opening it does not run a new
        verification.
      </p>
    </div>
  );
}

function EvidenceSection({
  title,
  description,
  rows,
  admitted,
  onOpenDocument,
  onOpenUrl,
}: {
  title: string;
  description: string;
  rows: EvidenceAuditRow[];
  admitted: boolean;
  onOpenDocument?: (documentId: string, label: string) => void;
  onOpenUrl?: (url: string) => void;
}) {
  return (
    <section>
      <SectionHeading>{title}</SectionHeading>
      <p className="mt-1 text-[0.74em] leading-snug text-fg-faint">
        {description}
      </p>
      <div className="mt-2 flex flex-col gap-2">
        {rows.length === 0 ? (
          <p className="rounded-[var(--radius)] border border-dashed border-border px-3 py-3 text-[0.8em] text-fg-faint">
            {admitted
              ? "No evidence is admitted yet."
              : "No sources have been rejected."}
          </p>
        ) : (
          rows.map((row) => (
            <EvidenceCard
              key={row.record.source_id}
              row={row}
              admitted={admitted}
              onOpenDocument={onOpenDocument}
              onOpenUrl={onOpenUrl}
            />
          ))
        )}
      </div>
    </section>
  );
}

function EvidenceCard({
  row,
  admitted,
  onOpenDocument,
  onOpenUrl,
}: {
  row: EvidenceAuditRow;
  admitted: boolean;
  onOpenDocument?: (documentId: string, label: string) => void;
  onOpenUrl?: (url: string) => void;
}) {
  const evidence = row.record;
  return (
    <article
      className={`rounded-[var(--radius)] border p-3 ${admitted ? "border-border-strong bg-bg-2" : "border-dashed border-border bg-bg-2/55"}`}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[0.86em] font-bold leading-snug text-fg">
            {evidence.title}
          </p>
          <p className="mt-0.5 text-[0.7em] text-fg-faint">
            {evidence.publisher} · {humanizeClaimValue(evidence.source_class)}
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full border px-1.5 py-0.5 font-mono text-[0.61em] font-bold uppercase ${admitted ? "border-inbound/45 text-inbound" : "border-rec/45 text-rec"}`}
        >
          {admitted ? "Admitted" : "Rejected"}
        </span>
      </div>

      {row.rejectionReason && (
        <p className="mt-2 rounded border border-rec/25 bg-rec/[0.05] px-2 py-1.5 text-[0.73em] text-rec">
          Excluded: {row.rejectionReason}
        </p>
      )}

      <div className="mt-2 flex flex-wrap gap-1.5 font-mono text-[0.62em] text-fg-muted">
        <Badge>{humanizeClaimValue(evidence.scope)}</Badge>
        <Badge>{humanizeClaimValue(evidence.stance)}</Badge>
        <Badge>Addresses: {evidence.addressed_claim_part}</Badge>
      </div>

      <blockquote className="mt-2 border-l-2 border-ai/45 pl-2.5 text-[0.8em] italic leading-relaxed text-fg-muted">
        “{evidence.excerpt}”
      </blockquote>

      <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 sm:grid-cols-4">
        {qualityEntries(evidence).map((quality) => (
          <div key={quality.label}>
            <p className="font-mono text-[0.58em] uppercase tracking-[0.08em] text-fg-faint">
              {quality.label}
            </p>
            <p className="text-[0.7em] font-semibold text-fg-muted">
              {humanizeClaimValue(quality.value)}
            </p>
          </div>
        ))}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.7em]">
        {evidence.url && onOpenUrl && (
          <button
            type="button"
            onClick={() => onOpenUrl(evidence.url!)}
            className="text-ai underline decoration-2 underline-offset-2"
          >
            Open source
          </button>
        )}
        {evidence.local_document_id && onOpenDocument && (
          <button
            type="button"
            onClick={() =>
              onOpenDocument(evidence.local_document_id!, evidence.title)
            }
            className="text-ai underline decoration-2 underline-offset-2"
          >
            Open document
          </button>
        )}
        <span className="font-mono text-fg-faint">
          Policy {evidence.admission_policy_id} v
          {evidence.admission_policy_version}
        </span>
      </div>
    </article>
  );
}

function SectionHeading({
  id,
  children,
}: {
  id?: string;
  children: React.ReactNode;
}) {
  return (
    <h3
      id={id}
      className="font-mono text-[0.7em] font-bold uppercase tracking-[0.16em] text-fg-muted"
    >
      {children}
    </h3>
  );
}

function Detail({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="font-mono text-[0.62em] font-bold uppercase tracking-[0.1em] text-fg-faint">
        {label}
      </p>
      <div className="mt-0.5 text-[0.78em] leading-relaxed text-fg-muted">
        {children}
      </div>
    </div>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border border-border-strong px-1.5 py-0.5 text-fg-muted">
      {children}
    </span>
  );
}

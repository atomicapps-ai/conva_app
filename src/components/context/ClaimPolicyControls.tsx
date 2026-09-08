import {
  SOURCE_CLASS_OPTIONS,
  participationLenses,
  sourceClassUsesOpenWeb,
  sourcePolicyDisclosure,
} from "@/components/context/claimPolicy";
import type {
  ContextCategory,
  ParticipationLens,
  SourceClass,
  SourcePolicy,
} from "@/lib/ipc";

export function ParticipationLensControl({
  category,
  value,
  onChange,
}: {
  category: ContextCategory;
  value: ParticipationLens;
  onChange: (lens: ParticipationLens) => void;
}) {
  const options = participationLenses(category);
  const selected = options.find((option) => option.value === value) ?? options[0]!;
  return (
    <label className="field">
      Your role in this conversation
      <select
        className="input"
        value={selected.value}
        onChange={(event) => onChange(event.target.value as ParticipationLens)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <span className="text-[11px] font-normal leading-relaxed text-fg-faint">
        {selected.description}
      </span>
    </label>
  );
}

export function ClaimPolicyControls({
  policy,
  onChange,
}: {
  policy: SourcePolicy;
  onChange: (policy: SourcePolicy) => void;
}) {
  const update = (patch: Partial<SourcePolicy>) => onChange({ ...policy, ...patch });
  const setOpenWeb = (allowed: boolean) =>
    update({
      allow_open_web: allowed,
      allowed_classes: allowed
        ? policy.allowed_classes
        : policy.allowed_classes.filter((sourceClass) => !sourceClassUsesOpenWeb(sourceClass)),
      allow_normalized_claim_egress: allowed
        ? policy.allow_normalized_claim_egress
        : false,
      allow_private_claim_egress: allowed ? policy.allow_private_claim_egress : false,
    });
  const setNormalizedEgress = (allowed: boolean) =>
    update({
      allow_normalized_claim_egress: allowed,
      allow_private_claim_egress: allowed ? policy.allow_private_claim_egress : false,
    });
  const toggleSource = (sourceClass: Exclude<SourceClass, "model_knowledge">) => {
    const selected = policy.allowed_classes.includes(sourceClass);
    const allowed = SOURCE_CLASS_OPTIONS.map((option) => option.value).filter((candidate) =>
      candidate === sourceClass ? !selected : policy.allowed_classes.includes(candidate),
    );
    update({ allowed_classes: allowed });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="rounded border border-border p-3 text-sm text-fg">
          <span className="flex items-start gap-2">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={policy.allow_automatic_checks}
              onChange={(event) => update({ allow_automatic_checks: event.target.checked })}
            />
            <span>
              <span className="block font-semibold">Automatically check valuable claims</span>
              <span className="mt-1 block text-[11px] font-normal leading-relaxed text-fg-faint">
                Conva may queue high-consequence, specific claims. A check never silently becomes fact.
              </span>
            </span>
          </span>
        </label>
        <label className="rounded border border-border p-3 text-sm text-fg">
          <span className="flex items-start gap-2">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={policy.allow_open_web}
              onChange={(event) => setOpenWeb(event.target.checked)}
            />
            <span>
              <span className="block font-semibold">Allow claim-specific web research</span>
              <span className="mt-1 block text-[11px] font-normal leading-relaxed text-fg-faint">
                Public sources are still admitted only when their class and provenance pass this policy.
              </span>
            </span>
          </span>
        </label>
      </div>

      <fieldset>
        <legend className="text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
          Allowed sources · ranked for this Context
        </legend>
        <div className="mt-2 flex flex-col divide-y divide-border rounded border border-border px-3">
          {SOURCE_CLASS_OPTIONS.map((source) => {
            const checked = policy.allowed_classes.includes(source.value);
            const rank = checked
              ? policy.allowed_classes.filter((sourceClass) => sourceClass !== "model_knowledge").indexOf(source.value) + 1
              : 0;
            const needsWeb = sourceClassUsesOpenWeb(source.value);
            return (
              <label key={source.value} className="flex items-center gap-2 py-2 text-[12px] text-fg">
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={needsWeb && !policy.allow_open_web}
                  onChange={() => toggleSource(source.value)}
                />
                <span className="min-w-0 flex-1">{source.label}</span>
                <span className="shrink-0 text-[10px] text-fg-faint">
                  {checked ? `${rank} · ${source.note}` : needsWeb && !policy.allow_open_web ? "web off" : "excluded"}
                </span>
              </label>
            );
          })}
        </div>
        {policy.allowed_classes.length === 0 && (
          <p role="alert" className="mt-1 text-[11px] text-rec">
            Select at least one source class before saving.
          </p>
        )}
      </fieldset>

      <label className="field">
        High-consequence claims
        <select
          className="input"
          value={policy.high_consequence_requirement}
          onChange={(event) =>
            update({
              high_consequence_requirement: event.target.value as SourcePolicy["high_consequence_requirement"],
            })
          }
        >
          <option value="primary_official_or_independent_reports">
            Require an official source or two independent admitted reports
          </option>
          <option value="primary_official_only">Require a primary official source</option>
        </select>
        <span className="text-[11px] font-normal leading-relaxed text-fg-faint">
          Attribution can be supported before the underlying claim. Source quality and claim confidence remain separate.
        </span>
      </label>

      <details className="rounded border border-border px-3 py-2">
        <summary className="cursor-pointer text-[12px] font-semibold text-fg-muted">
          Processing and evidence options
        </summary>
        <div className="mt-3 flex flex-col gap-2.5">
          <label className="flex items-start gap-2 text-[12px] text-fg">
            <input
              type="checkbox"
              className="mt-0.5"
              disabled={!policy.allow_open_web}
              checked={policy.allow_normalized_claim_egress}
              onChange={(event) => setNormalizedEgress(event.target.checked)}
            />
            Send the normalized claim and necessary qualifiers for approved research
          </label>
          <label className="flex items-start gap-2 text-[12px] text-fg">
            <input
              type="checkbox"
              className="mt-0.5"
              disabled={!policy.allow_normalized_claim_egress}
              checked={policy.allow_private_claim_egress}
              onChange={(event) => update({ allow_private_claim_egress: event.target.checked })}
            />
            Permit private transcript details to leave the device when a manual check requires them
          </label>
          <label className="flex items-start gap-2 text-[12px] text-fg">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={policy.allow_cached_evidence}
              onChange={(event) => update({ allow_cached_evidence: event.target.checked })}
            />
            Reuse admitted evidence while it is within the freshness window
          </label>
        </div>
      </details>

      <p className="rounded border border-amber-500/30 bg-amber-500/[0.04] px-3 py-2 text-[11px] leading-relaxed text-fg-muted">
        {sourcePolicyDisclosure(policy)} Hosted processing remains separately disclosed by the selected Ally provider.
      </p>
    </div>
  );
}

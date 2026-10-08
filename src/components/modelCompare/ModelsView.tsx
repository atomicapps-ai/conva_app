import { useMemo, useState } from "react";

import { CallTypeProfile } from "@/components/modelCompare/CallTypeProfile";
import { ModelScatter } from "@/components/modelCompare/ModelScatter";
import { Notice, Section, ViewShell } from "@/components/studio/ViewShell";
import {
  BENCHMARK_META,
  BENCHMARK_MODELS,
  MEASURES,
  type BenchmarkModel,
  type MeasureId,
} from "@/lib/modelCompare/benchmarkData";
import {
  LIVE_TARGET,
  PROVIDER_NAMES,
  formatCost,
  meetsLiveTarget,
  modelColor,
  scatterData,
} from "@/lib/modelCompare/compare";
import { useAppStore } from "@/state/app";
import { useNavStore } from "@/state/nav";

type Slot = "quality" | "fast";

/**
 * Settings → Compare models. Reviews the benchmark results so a user can see how
 * each model trades speed, quality and cost, then (on desktop, where the model
 * is the user's own choice) set it as the quality or fast slot.
 *
 * On the hosted web app the model is chosen by Conva on the server and there is
 * no settings store (`config === null`), so the same view is read-only there.
 * The numbers are static data (`lib/modelCompare/benchmarkData.ts`), not live.
 */
export function ModelsView() {
  const setView = useNavStore((s) => s.setView);
  const config = useAppStore((s) => s.config);
  const keyStatus = useAppStore((s) => s.keyStatus);
  const updateConfig = useAppStore((s) => s.updateConfig);

  const models = BENCHMARK_MODELS;
  const [measure, setMeasure] = useState<MeasureId>("technical");
  const [liveOnly, setLiveOnly] = useState(false);
  const [selectedId, setSelectedId] = useState<string>(
    () =>
      models.find((m) => m.id === config?.llm_quality.model)?.id ??
      "claude-haiku-4-5",
  );
  const [applied, setApplied] = useState<string | null>(null);

  const measureInfo = MEASURES.find((m) => m.id === measure) ?? MEASURES[0]!;
  const data = useMemo(
    () => scatterData(models, measure, liveOnly),
    [models, measure, liveOnly],
  );
  const selected = models.find((m) => m.id === selectedId) ?? models[0]!;
  const canSelect = config !== null;

  const useAs = async (m: BenchmarkModel, slot: Slot) => {
    const selection = { provider: m.provider, model: m.id };
    await updateConfig(slot === "quality" ? { llm_quality: selection } : { llm_fast: selection });
    setApplied(`${m.name} is now the ${slot} slot.`);
  };

  const providerName = PROVIDER_NAMES[selected.provider] ?? selected.provider;
  const missingKey = canSelect && keyStatus[selected.provider] === false;

  return (
    <ViewShell
      icon="target"
      breadcrumb="Settings"
      title="Compare models"
      subtitle={`Benchmarked ${BENCHMARK_META.runDate} on Conva's own call types.`}
      onBack={() => setView("settings")}
    >
      <Section
        title="Speed against quality"
        description="Each dot is a model. Left is faster to start answering, higher scored better, bigger costs more. The shaded band is the live first-token budget."
      >
        <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-2">
          <div role="radiogroup" aria-label="Quality measure" className="flex flex-wrap gap-2">
            {MEASURES.map((m) => (
              <button
                key={m.id}
                type="button"
                role="radio"
                aria-checked={measure === m.id}
                onClick={() => setMeasure(m.id)}
                className={`rounded-full border px-3 py-1 text-[12px] transition ${
                  measure === m.id
                    ? "border-primary bg-primary/15 text-fg"
                    : "border-border text-fg-muted hover:border-border-strong"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-[12px] text-fg-muted">
            <input
              type="checkbox"
              checked={liveOnly}
              onChange={(e) => setLiveOnly(e.target.checked)}
            />
            Only models that start inside {LIVE_TARGET.toS} s
          </label>
        </div>
        <p className="mb-2 text-[11px] text-fg-faint">{measureInfo.description}</p>

        <ModelScatter
          models={models}
          data={data}
          measureLabel={measureInfo.label}
          selectedId={selectedId}
          onSelect={(id) => {
            setSelectedId(id);
            setApplied(null);
          }}
        />

        {data.notMeasured.length > 0 && (
          <p className="mt-2 text-[11px] text-fg-muted" data-testid="not-measured">
            Not measured on this test yet: {data.notMeasured.map((m) => m.name).join(", ")}.
          </p>
        )}
        {data.filteredOut.length > 0 && (
          <p className="mt-1 text-[11px] text-fg-muted" data-testid="filtered-out">
            Hidden by the speed filter: {data.filteredOut.map((m) => m.name).join(", ")}.
          </p>
        )}
      </Section>

      <Section
        title={selected.name}
        description={`${providerName} · ${selected.id}`}
        actions={
          <span
            className="inline-block h-3 w-3 rounded-full"
            style={{ background: modelColor(models, selected.id) }}
            aria-hidden
          />
        }
      >
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-[12px] sm:grid-cols-4">
          <Stat label="First token (median / worst)" value={`${selected.firstTokenMedianS.toFixed(2)} / ${selected.firstTokenMaxS.toFixed(2)} s`} />
          <Stat label="Speed" value={`${selected.tokensPerSecond} tokens/s`} />
          <Stat
            label="Cost per answer"
            value={`${formatCost(selected.costPerAnswerUsd)}${selected.costAssumed ? " (assumed)" : ""}`}
          />
          <Stat
            label="Live budget"
            value={meetsLiveTarget(selected) ? "Inside 0.6 s" : "Too slow to start"}
          />
          {MEASURES.map((m) => (
            <Stat
              key={m.id}
              label={m.label}
              value={selected.scores[m.id] === undefined ? "Not measured" : `${selected.scores[m.id]}%`}
            />
          ))}
        </dl>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-[12px] text-fg-muted">
          {selected.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>

        {canSelect ? (
          <div className="mt-4 flex flex-col gap-2">
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn btn-primary" onClick={() => void useAs(selected, "quality")}>
                Use for the quality slot
              </button>
              <button type="button" className="btn" onClick={() => void useAs(selected, "fast")}>
                Use for the fast slot
              </button>
            </div>
            {!meetsLiveTarget(selected) && (
              <Notice>
                The fast slot runs all call long and should start inside 0.6 s; this model's median is{" "}
                {selected.firstTokenMedianS.toFixed(2)} s.
              </Notice>
            )}
            {missingKey && (
              <Notice>
                No {providerName} API key is saved yet. Add one in Settings → Ally before using this model.
              </Notice>
            )}
            {applied && <Notice>{applied}</Notice>}
            <p className="text-[11px] text-fg-faint">
              Current: quality {config.llm_quality.model}; fast {config.llm_fast?.model ?? "same as quality"}.
            </p>
          </div>
        ) : (
          <div className="mt-4">
            <Notice>
              On the web app Conva chooses the model for you, so this view is for reference. Switching models is available in the desktop app.
            </Notice>
          </div>
        )}
      </Section>

      <Section
        title="Where each model is strong"
        description="Score on each of Conva's call types, grouped by area. Only models run on the 55-item suite appear; more are added as they are tested."
      >
        <CallTypeProfile models={models} selectedId={selectedId} />
        <p className="mt-2 text-[11px] text-fg-faint">
          Call types with 2 items are anecdotes, not rates. The lines join neighbouring call types to show the shape; they do not imply a trend.
        </p>
      </Section>

      <Section title="All numbers" description="The same data as the charts, as a table. Select a row to inspect that model.">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-[12px]">
            <thead>
              <tr className="border-b border-border text-fg-faint">
                <th className="py-1.5 pr-3 font-medium">Model</th>
                <th className="px-2 py-1.5 text-right font-medium">First token</th>
                <th className="px-2 py-1.5 text-right font-medium">Tokens/s</th>
                <th className="px-2 py-1.5 text-right font-medium">$ / answer</th>
                {MEASURES.map((m) => (
                  <th key={m.id} className="px-2 py-1.5 text-right font-medium">
                    {m.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {models.map((m) => (
                <tr
                  key={m.id}
                  className={`border-b border-border/60 ${m.id === selectedId ? "bg-panel-raised/60" : ""}`}
                >
                  <td className="py-1.5 pr-3">
                    <button
                      type="button"
                      aria-pressed={m.id === selectedId}
                      onClick={() => {
                        setSelectedId(m.id);
                        setApplied(null);
                      }}
                      className="flex items-center gap-2 text-left text-fg hover:underline"
                    >
                      <span
                        className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ background: modelColor(models, m.id) }}
                        aria-hidden
                      />
                      {m.name}
                    </button>
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono tabular-nums text-fg-muted">
                    {m.firstTokenMedianS.toFixed(2)} s
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono tabular-nums text-fg-muted">
                    {m.tokensPerSecond}
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono tabular-nums text-fg-muted">
                    {formatCost(m.costPerAnswerUsd)}
                    {m.costAssumed ? "*" : ""}
                  </td>
                  {MEASURES.map((ms) => (
                    <td key={ms.id} className="px-2 py-1.5 text-right font-mono tabular-nums text-fg-muted">
                      {m.scores[ms.id] === undefined ? "—" : `${m.scores[ms.id]}%`}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[11px] text-fg-faint">* price assumed: not on the provider's standard pricing table.</p>
      </Section>

      <Notice>
        {BENCHMARK_META.summary} Treat these as a guide: other documents, networks and days will differ.
      </Notice>
    </ViewShell>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] text-fg-faint">{label}</dt>
      <dd className="font-mono text-fg">{value}</dd>
    </div>
  );
}

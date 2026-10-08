import type { ProviderId } from "@/lib/ipc";

import {
  type BenchmarkModel,
  type CallTypeScore,
  type MeasureId,
} from "./benchmarkData";

/** The live first-token budget from the product spec: 300-600 ms. */
export const LIVE_TARGET = { fromS: 0.3, toS: 0.6 } as const;

/** Colours are theme tokens so the chart follows the app theme. */
export const MODEL_COLORS = [
  "var(--color-primary)",
  "var(--color-ai)",
  "var(--color-inbound)",
  "var(--color-outbound)",
  "var(--color-notice)",
  "var(--color-fg)",
  "var(--color-fg-muted)",
] as const;

export const PROVIDER_NAMES: Partial<Record<ProviderId, string>> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  google: "Google",
  xai: "xAI",
  deepseek: "DeepSeek",
  ollama_local: "Local (Ollama)",
};

/** Same model, same colour, in every chart: by position in the data list. */
export function modelColor(models: readonly BenchmarkModel[], id: string): string {
  const i = Math.max(0, models.findIndex((m) => m.id === id));
  return MODEL_COLORS[i % MODEL_COLORS.length] as string;
}

/** The benchmark entry for a model Conva sends to `provider` as `modelId`. */
export function benchmarkFor(
  models: readonly BenchmarkModel[],
  provider: ProviderId,
  modelId: string,
): BenchmarkModel | undefined {
  return models.find((m) => m.provider === provider && m.id === modelId);
}

export function formatCost(usd: number): string {
  return `$${usd.toFixed(4)}`;
}

/** One line of measured facts for a model picker, e.g.
 *  "Measured: starts answering in about 0.89 s, about $0.0097 an answer." */
export function modelFacts(m: BenchmarkModel): string {
  const cost = `${formatCost(m.costPerAnswerUsd)} an answer${m.costAssumed ? " (price assumed)" : ""}`;
  return `Measured in our tests: starts answering in about ${m.firstTokenMedianS.toFixed(2)} s, about ${cost}.`;
}

/** Starts answering inside the live budget (median first token <= 0.6 s). */
export function meetsLiveTarget(m: BenchmarkModel): boolean {
  return m.firstTokenMedianS <= LIVE_TARGET.toS;
}

export interface ScatterPoint {
  id: string;
  label: string;
  /** Seconds to first token. */
  x: number;
  /** Score on the chosen measure, 0-100. */
  y: number;
  costUsd: number;
}

export interface ScatterData {
  points: ScatterPoint[];
  /** Models left off because they were not measured on this measure (or were
   *  filtered out): named so the chart never silently hides one. */
  notMeasured: BenchmarkModel[];
  filteredOut: BenchmarkModel[];
}

/** Which models plot on `measure`, honouring the "fast enough for live" filter. */
export function scatterData(
  models: readonly BenchmarkModel[],
  measure: MeasureId,
  liveOnly: boolean,
): ScatterData {
  const points: ScatterPoint[] = [];
  const notMeasured: BenchmarkModel[] = [];
  const filteredOut: BenchmarkModel[] = [];
  for (const m of models) {
    const y = m.scores[measure];
    if (y === undefined) {
      notMeasured.push(m);
    } else if (liveOnly && !meetsLiveTarget(m)) {
      filteredOut.push(m);
    } else {
      points.push({
        id: m.id,
        label: m.name,
        x: m.firstTokenMedianS,
        y,
        costUsd: m.costPerAnswerUsd,
      });
    }
  }
  return { points, notMeasured, filteredOut };
}

/** Round the y range outward to multiples of 10 so the axis reads cleanly. */
export function yDomain(points: readonly ScatterPoint[]): [number, number] {
  if (points.length === 0) return [50, 100];
  const min = Math.min(...points.map((p) => p.y));
  const lo = Math.max(0, Math.floor((min - 5) / 10) * 10);
  return [Math.min(lo, 90), 100];
}

/** x runs from 0 to the next whole second above the slowest point (min 1 s). */
export function xDomain(points: readonly ScatterPoint[]): [number, number] {
  const max = points.length === 0 ? 1 : Math.max(...points.map((p) => p.x));
  return [0, Math.max(1, Math.ceil(max))];
}

export function ticks([lo, hi]: [number, number], step: number): number[] {
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(v);
  return out;
}

export function linear(
  [d0, d1]: readonly [number, number],
  [r0, r1]: readonly [number, number],
) {
  const span = d1 - d0 || 1;
  return (v: number) => r0 + ((v - d0) / span) * (r1 - r0);
}

/** Dot radius from cost: area-ish scaling between 6 and 14 px. */
export function dotRadius(costUsd: number, maxCostUsd: number): number {
  if (maxCostUsd <= 0) return 8;
  return 6 + Math.sqrt(Math.max(0, costUsd) / maxCostUsd) * 8;
}

/**
 * Vertical label nudges so dots that sit almost on top of each other (two
 * models at 1.4 s and 89%) do not print their names over one another. Points
 * are in pixel space; a label is shifted down by `lineHeight` for each earlier
 * label it would collide with. Deterministic, order = input order.
 */
export function labelOffsets(
  pts: readonly { id: string; px: number; py: number }[],
  labelWidth = 120,
  lineHeight = 14,
): Record<string, number> {
  const placed: { px: number; py: number; dy: number }[] = [];
  const out: Record<string, number> = {};
  for (const p of pts) {
    let dy = 0;
    for (;;) {
      const clash = placed.some(
        (q) =>
          Math.abs(q.px - p.px) < labelWidth &&
          Math.abs(q.py + q.dy - (p.py + dy)) < lineHeight,
      );
      if (!clash) break;
      dy += lineHeight;
    }
    placed.push({ px: p.px, py: p.py, dy });
    out[p.id] = dy;
  }
  return out;
}

/** Models that have per-call-type results (they get a line in the profile). */
export function profileModels(models: readonly BenchmarkModel[]): BenchmarkModel[] {
  return models.filter((m) => (m.callTypes?.length ?? 0) > 0);
}

export interface CallTypeGroup {
  name: CallTypeScore["group"];
  from: number;
  to: number;
}

/** Contiguous runs of call types in the same product area, for the grey bands. */
export function callTypeGroups(callTypes: readonly CallTypeScore[]): CallTypeGroup[] {
  const groups: CallTypeGroup[] = [];
  callTypes.forEach((c, i) => {
    const last = groups.at(-1);
    if (last && last.name === c.group) last.to = i;
    else groups.push({ name: c.group, from: i, to: i });
  });
  return groups;
}

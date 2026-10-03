import type { ProviderId } from "@/lib/ipc";

/**
 * Benchmark results behind Settings → Compare models.
 *
 * Source of truth for the numbers: `conva_core`
 * `docs/technical/benchmarks/local-llm-cpa/results/2026-10-02/` (SUMMARY.md and
 * `v2-haiku-vs-mini/SUMMARY.md`). This file is DATA, not logic: adding a model
 * or a new measure is an edit here and nothing else. Keep every figure traceable
 * to those summaries and bump `BENCHMARK_META` when a run is added.
 *
 * Honest limits, repeated in the UI: one domain (accounting), one machine and
 * network, one day, small samples; first-token times include the network path.
 */

export type MeasureId = "technical" | "suite_v2";

export interface Measure {
  id: MeasureId;
  /** Short axis/selector label. */
  label: string;
  /** One sentence on what it is and how many models it covers. */
  description: string;
}

export interface CallTypeScore {
  id: string;
  label: string;
  /** Product area the call type belongs to (the line chart's grey bands). */
  group: "Fast slot" | "Live" | "Accuracy" | "Generation" | "Long";
  /** Items in the suite for this call type (2 repeats each). Small = anecdote. */
  items: number;
  /** Objective value, 0-100. */
  objective: number;
  /** Blind judge score on a 1-5 scale, where the call type is judged. */
  judge?: number;
}

export interface BenchmarkModel {
  /** The model id Conva sends to the provider. */
  id: string;
  provider: ProviderId;
  name: string;
  /** Median seconds to first token on Ally's question prompt. */
  firstTokenMedianS: number;
  firstTokenMaxS: number;
  tokensPerSecond: number;
  /** Mean list-price dollars per answer from measured tokens. */
  costPerAnswerUsd: number;
  /** True when the price is not on the provider's own standard table. */
  costAssumed?: boolean;
  /** Score per measure, 0-100. A model with no entry was not measured on it. */
  scores: Partial<Record<MeasureId, number>>;
  /** Plain-language findings worth reading before choosing. */
  notes: string[];
  /** Per-call-type results (suite v2). Present only for models run on it. */
  callTypes?: CallTypeScore[];
}

export const BENCHMARK_META = {
  runDate: "2026-10-02",
  summary:
    "One accounting-firm scenario, run from one Windows machine on a home network. First-token times include that network path. Costs are list prices from measured tokens.",
} as const;

export const MEASURES: Measure[] = [
  {
    id: "technical",
    label: "Technical answers",
    description:
      "24 questions in Ally's real prompt, scored by required concepts. All seven cloud models. Rewards longer answers, so it cannot separate the top models.",
  },
  {
    id: "suite_v2",
    label: "Conva call types",
    description:
      "55 items across 15 call types with the app's real prompts, scored on facts, format and honesty. Only two models measured so far.",
  },
];

const CALL_TYPES: Omit<CallTypeScore, "objective" | "judge">[] = [
  { id: "tracker", label: "Tracker", group: "Fast slot", items: 10 },
  { id: "capture", label: "Term capture", group: "Fast slot", items: 16 },
  { id: "semantic", label: "Semantic claims", group: "Fast slot", items: 6 },
  { id: "ask", label: "Live answers", group: "Live", items: 20 },
  { id: "sug", label: "Suggested reply", group: "Live", items: 6 },
  { id: "summary", label: "Call summary", group: "Live", items: 6 },
  { id: "cardsum", label: "Card summary", group: "Live", items: 6 },
  { id: "tab", label: "Exact numbers", group: "Accuracy", items: 14 },
  { id: "hon", label: "Honesty traps", group: "Accuracy", items: 10 },
  { id: "persona", label: "Personas", group: "Generation", items: 2 },
  { id: "rehearsal", label: "Rehearsal", group: "Generation", items: 6 },
  { id: "qa", label: "Prepared Q&A", group: "Generation", items: 2 },
  { id: "knowledge", label: "Knowledge pack", group: "Generation", items: 2 },
  { id: "analysis", label: "Post-call analysis", group: "Generation", items: 2 },
  { id: "lc", label: "Long context", group: "Long", items: 2 },
];

function callTypes(
  objective: Record<string, number>,
  judge: Record<string, number>,
): CallTypeScore[] {
  return CALL_TYPES.map((c) => ({
    ...c,
    objective: objective[c.id] as number,
    ...(judge[c.id] !== undefined ? { judge: judge[c.id] } : {}),
  }));
}

export const BENCHMARK_MODELS: BenchmarkModel[] = [
  {
    id: "claude-haiku-4-5",
    provider: "anthropic",
    name: "Claude Haiku 4.5",
    firstTokenMedianS: 0.5,
    firstTokenMaxS: 0.95,
    tokensPerSecond: 69,
    costPerAnswerUsd: 0.0028,
    scores: { technical: 82, suite_v2: 94 },
    notes: [
      "Every fast-slot answer began inside 0.6 s; the steadiest start of the two live-capable models.",
      "Long documents (prepared Q&A, knowledge pack) hit the 3,000-token cap and were cut off mid-sentence in all 4 runs.",
      "Logged a hypothetical as a commitment in the tracker, 2 of 2.",
    ],
    callTypes: callTypes(
      { tracker: 92, capture: 96, semantic: 100, ask: 94, sug: 92, summary: 89, cardsum: 96, tab: 89, hon: 95, persona: 100, rehearsal: 100, qa: 100, knowledge: 61, analysis: 96, lc: 100 },
      { ask: 3.87, sug: 3.94, summary: 3.56, hon: 3.93, persona: 3.67, rehearsal: 4.83, qa: 3.0, knowledge: 2.5, analysis: 3.67 },
    ),
  },
  {
    id: "gpt-5.4-mini",
    provider: "openai",
    name: "gpt-5.4-mini",
    firstTokenMedianS: 0.46,
    firstTokenMaxS: 0.71,
    tokensPerSecond: 146,
    costPerAnswerUsd: 0.0017,
    costAssumed: true,
    scores: { technical: 87, suite_v2: 96 },
    notes: [
      "Finishes the same job about 2 times sooner than Haiku 4.5; first token is level.",
      "Invented the user's own chargeable hours (2 of 2) and coached the candidate instead of staying the interviewer in rehearsal.",
      "Its price is not on OpenAI's standard table; the cost shown is an assumed third-party figure.",
    ],
    callTypes: callTypes(
      { tracker: 98, capture: 96, semantic: 94, ask: 92, sug: 100, summary: 100, cardsum: 100, tab: 93, hon: 92, persona: 100, rehearsal: 100, qa: 95, knowledge: 100, analysis: 96, lc: 100 },
      { ask: 3.98, sug: 3.61, summary: 4.39, hon: 3.97, persona: 4.83, rehearsal: 3.89, qa: 4.17, knowledge: 4.17, analysis: 3.0 },
    ),
  },
  {
    id: "claude-sonnet-5-5",
    provider: "anthropic",
    name: "Claude Sonnet 5.5",
    firstTokenMedianS: 0.89,
    firstTokenMaxS: 1.61,
    tokensPerSecond: 124,
    costPerAnswerUsd: 0.0097,
    scores: { technical: 97 },
    notes: [
      "Strongest technical answers among the Claude models at less than half Opus's cost.",
      "Volunteered an unsourced revenue range on a not-in-the-documents question, labelled as not the firm's data.",
    ],
  },
  {
    id: "gpt-5.5",
    provider: "openai",
    name: "gpt-5.5",
    firstTokenMedianS: 1.39,
    firstTokenMaxS: 2.79,
    tokensPerSecond: 111,
    costPerAnswerUsd: 0.0137,
    scores: { technical: 89 },
    notes: ["Cited the job description for follow-up questions it does not contain (minor)."],
  },
  {
    id: "gpt-6.1-sol",
    provider: "openai",
    name: "gpt-6.1-sol",
    firstTokenMedianS: 1.91,
    firstTokenMaxS: 5.83,
    tokensPerSecond: 43,
    costPerAnswerUsd: 0.0047,
    scores: { technical: 97 },
    notes: ["Slowest generator of the seven (43 tokens per second) and a median 1.9 s to first token."],
  },
  {
    id: "claude-opus-5-5",
    provider: "anthropic",
    name: "Claude Opus 5.5",
    firstTokenMedianS: 3.06,
    firstTokenMaxS: 11.56,
    tokensPerSecond: 126,
    costPerAnswerUsd: 0.0221,
    scores: { technical: 97 },
    notes: [
      "Thinks for a median 3 s before the first word and up to 11.6 s; cannot turn thinking off.",
      "Applied an unsourced revenue range to the firm on the revenue trap (a strict fail).",
      "2.3 times Sonnet 5.5's cost with no gain visible on this test.",
    ],
  },
  {
    id: "gpt-6-luna",
    provider: "openai",
    name: "gpt-6-luna",
    firstTokenMedianS: 1.41,
    firstTokenMaxS: 5.08,
    tokensPerSecond: 224,
    costPerAnswerUsd: 0.0003,
    scores: { technical: 89 },
    notes: ["Cheapest and fastest generator, but a median 1.4 s to first token."],
  },
];

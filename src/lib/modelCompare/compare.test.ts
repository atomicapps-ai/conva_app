import { describe, expect, it } from "vitest";

import { BENCHMARK_MODELS, MEASURES } from "./benchmarkData";
import {
  benchmarkFor,
  callTypeGroups,
  modelFacts,
  dotRadius,
  labelOffsets,
  linear,
  meetsLiveTarget,
  modelColor,
  profileModels,
  scatterData,
  ticks,
  xDomain,
  yDomain,
} from "./compare";

const byId = (id: string) => BENCHMARK_MODELS.find((m) => m.id === id)!;

describe("benchmark data", () => {
  it("has unique model ids and sane numbers", () => {
    const ids = BENCHMARK_MODELS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const m of BENCHMARK_MODELS) {
      expect(m.firstTokenMedianS).toBeGreaterThan(0);
      expect(m.firstTokenMaxS).toBeGreaterThanOrEqual(m.firstTokenMedianS);
      expect(m.costPerAnswerUsd).toBeGreaterThan(0);
      for (const v of Object.values(m.scores)) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(100);
      }
    }
  });

  it("scores only on declared measures, and every model has the technical score", () => {
    const declared = new Set(MEASURES.map((m) => m.id));
    for (const m of BENCHMARK_MODELS) {
      expect(m.scores.technical).toBeDefined();
      for (const k of Object.keys(m.scores)) expect(declared.has(k as never)).toBe(true);
    }
  });

  it("per-call-type results exist exactly for models scored on suite v2, with the same call types", () => {
    const withCalls = profileModels(BENCHMARK_MODELS);
    expect(withCalls.map((m) => m.id).sort()).toEqual(
      BENCHMARK_MODELS.filter((m) => m.scores.suite_v2 !== undefined)
        .map((m) => m.id)
        .sort(),
    );
    const first = withCalls[0]!.callTypes!.map((c) => c.id);
    for (const m of withCalls) {
      expect(m.callTypes!.map((c) => c.id)).toEqual(first);
      for (const c of m.callTypes!) {
        expect(c.objective).toBeGreaterThanOrEqual(0);
        expect(c.objective).toBeLessThanOrEqual(100);
        if (c.judge !== undefined) {
          expect(c.judge).toBeGreaterThanOrEqual(1);
          expect(c.judge).toBeLessThanOrEqual(5);
        }
      }
    }
  });

  it("keeps the figures the findings document reports", () => {
    expect(byId("claude-haiku-4-5").scores.suite_v2).toBe(94);
    expect(byId("gpt-5.4-mini").scores.suite_v2).toBe(96);
    expect(byId("claude-haiku-4-5").callTypes!.find((c) => c.id === "knowledge")!.objective).toBe(61);
    expect(byId("claude-opus-5-5").firstTokenMedianS).toBe(3.06);
  });
});

describe("meetsLiveTarget", () => {
  it("is true only for the two models inside 0.6 s", () => {
    const live = BENCHMARK_MODELS.filter(meetsLiveTarget).map((m) => m.id).sort();
    expect(live).toEqual(["claude-haiku-4-5", "gpt-5.4-mini"]);
  });
});

describe("scatterData", () => {
  it("plots every model on the technical measure", () => {
    const d = scatterData(BENCHMARK_MODELS, "technical", false);
    expect(d.points).toHaveLength(7);
    expect(d.notMeasured).toHaveLength(0);
  });

  it("names the models a measure did not cover instead of dropping them silently", () => {
    const d = scatterData(BENCHMARK_MODELS, "suite_v2", false);
    expect(d.points.map((p) => p.id).sort()).toEqual(["claude-haiku-4-5", "gpt-5.4-mini"]);
    expect(d.notMeasured).toHaveLength(5);
  });

  it("the live filter keeps only models inside the first-token budget and reports the rest", () => {
    const d = scatterData(BENCHMARK_MODELS, "technical", true);
    expect(d.points.map((p) => p.id).sort()).toEqual(["claude-haiku-4-5", "gpt-5.4-mini"]);
    expect(d.filteredOut).toHaveLength(5);
  });
});

describe("domains and scales", () => {
  it("rounds the y range outward and always tops out at 100", () => {
    const d = scatterData(BENCHMARK_MODELS, "technical", false);
    expect(yDomain(d.points)).toEqual([70, 100]);
    expect(yDomain([])).toEqual([50, 100]);
    expect(yDomain([{ id: "a", label: "a", x: 1, y: 30, costUsd: 0.01 }])).toEqual([20, 100]);
  });

  it("x runs from 0 to the next whole second", () => {
    expect(xDomain([{ id: "a", label: "a", x: 3.06, y: 1, costUsd: 1 }])).toEqual([0, 4]);
    expect(xDomain([])).toEqual([0, 1]);
  });

  it("ticks step through the domain", () => {
    expect(ticks([70, 100], 10)).toEqual([70, 80, 90, 100]);
    expect(ticks([0, 3], 1)).toEqual([0, 1, 2, 3]);
  });

  it("linear maps domain to range, including an inverted range", () => {
    const y = linear([0, 100], [200, 0]);
    expect(y(0)).toBe(200);
    expect(y(100)).toBe(0);
    expect(y(50)).toBe(100);
  });

  it("dot radius grows with cost between 6 and 14", () => {
    expect(dotRadius(0, 0.02)).toBe(6);
    expect(dotRadius(0.02, 0.02)).toBe(14);
    expect(dotRadius(0.005, 0.02)).toBeGreaterThan(6);
    expect(dotRadius(0.005, 0.02)).toBeLessThan(14);
  });
});

describe("labelOffsets", () => {
  it("leaves well-separated labels alone", () => {
    const o = labelOffsets([
      { id: "a", px: 10, py: 10 },
      { id: "b", px: 400, py: 10 },
    ]);
    expect(o).toEqual({ a: 0, b: 0 });
  });

  it("stacks labels for dots that nearly coincide (gpt-5.5 and gpt-6-luna)", () => {
    const o = labelOffsets([
      { id: "a", px: 300, py: 100 },
      { id: "b", px: 303, py: 101 },
      { id: "c", px: 306, py: 100 },
    ]);
    expect(o.a).toBe(0);
    expect(o.b).toBeGreaterThan(0);
    expect(o.c).toBeGreaterThan(o.b);
  });
});

describe("modelColor / callTypeGroups", () => {
  it("gives each model its own colour and keeps it stable", () => {
    expect(modelColor(BENCHMARK_MODELS, "claude-haiku-4-5")).toBe("var(--color-primary)");
    expect(modelColor(BENCHMARK_MODELS, "gpt-5.4-mini")).toBe("var(--color-ai)");
    const colours = BENCHMARK_MODELS.map((m) => modelColor(BENCHMARK_MODELS, m.id));
    expect(new Set(colours).size).toBe(colours.length);
  });

  it("no two models share a colour, and the two Anthropic/OpenAI near neighbours differ", () => {
    // Regression: gpt-6.1-sol used the same blue as Claude Haiku 4.5.
    expect(modelColor(BENCHMARK_MODELS, "gpt-6.1-sol")).not.toBe(
      modelColor(BENCHMARK_MODELS, "claude-haiku-4-5"),
    );
  });

  it("groups contiguous call types by product area", () => {
    const groups = callTypeGroups(byId("claude-haiku-4-5").callTypes!);
    expect(groups.map((g) => g.name)).toEqual(["Fast slot", "Live", "Accuracy", "Generation", "Long"]);
    expect(groups[0]).toEqual({ name: "Fast slot", from: 0, to: 2 });
    expect(groups.at(-1)).toEqual({ name: "Long", from: 14, to: 14 });
  });
});

describe("benchmarkFor / modelFacts", () => {
  it("finds a model by provider and id, and not by id alone across providers", () => {
    expect(benchmarkFor(BENCHMARK_MODELS, "anthropic", "claude-sonnet-5-5")?.name).toBe("Claude Sonnet 5.5");
    expect(benchmarkFor(BENCHMARK_MODELS, "openai", "claude-sonnet-5-5")).toBeUndefined();
    expect(benchmarkFor(BENCHMARK_MODELS, "openai", "gpt-5.2")).toBeUndefined();
  });

  it("states the measured speed and cost, and flags an assumed price", () => {
    expect(modelFacts(byId("claude-sonnet-5-5"))).toBe(
      "Measured in our tests: starts answering in about 0.89 s, about $0.0097 an answer.",
    );
    expect(modelFacts(byId("gpt-5.4-mini"))).toContain("(price assumed)");
  });
});

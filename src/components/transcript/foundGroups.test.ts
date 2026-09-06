import { describe, expect, it } from "vitest";

import { buildFoundGroups } from "@/components/transcript/foundGroups";
import type { RadarEvent, TrackerEvent } from "@/lib/ipc";

const tracker: TrackerEvent = {
  entities: [
    { label: "Kinesis", detail: "AWS streaming service" },
    { label: "API Gateway", detail: "front door" },
  ],
  commitments: [{ who: "you", what: "send the deck", due: "Friday" }],
};

const radar: RadarEvent[] = [
  {
    turn_id: "session-1:them:4",
    source_key: "inbound-4",
    question: "What is RRF?",
    outcome: "miss",
    confidence: 0,
    bridge: { kind: "definition", text: "Define it, then explain why it matters." },
    sources: [],
  },
];

describe("buildFoundGroups", () => {
  it("builds all four groups with stable ids", () => {
    const g = buildFoundGroups({
      radarHistory: radar,
      tracker,
      captures: [],
      liveTerms: ["API Gateway"],
      docTerms: ["Lambda"],
    });
    expect(g.questions.map((i) => i.label)).toEqual(["What is RRF?"]);
    expect(g.questions[0]?.id).toBe("q-session-1:them:4");
    expect(g.commitments[0]).toMatchObject({
      label: "send the deck",
      detail: "you · due Friday",
    });
    expect(g.terms.map((i) => i.label)).toEqual(["API Gateway", "Lambda"]);
    expect(g.mentions.map((i) => i.label)).toEqual(["Kinesis"]);
  });

  it("drops a mention already present as a term (case-insensitive)", () => {
    const g = buildFoundGroups({
      radarHistory: [],
      tracker,
      captures: [],
      liveTerms: ["api gateway"],
      docTerms: [],
    });
    expect(g.mentions.map((i) => i.label)).toEqual(["Kinesis"]);
  });

  it("handles a null tracker and empty inputs", () => {
    const g = buildFoundGroups({
      radarHistory: [],
      tracker: null,
      captures: [],
      liveTerms: [],
      docTerms: [],
    });
    expect(g.questions).toEqual([]);
    expect(g.commitments).toEqual([]);
    expect(g.terms).toEqual([]);
    expect(g.mentions).toEqual([]);
  });

  it("commitment detail omits the due part when empty", () => {
    const g = buildFoundGroups({
      radarHistory: [],
      tracker: {
        entities: [],
        commitments: [{ who: "them", what: "review the doc", due: "" }],
      },
      captures: [],
      liveTerms: [],
      docTerms: [],
    });
    expect(g.commitments[0]?.detail).toBe("them");
  });

  it("carries a doc term's cached definition into its detail line", () => {
    const groups = buildFoundGroups({
      radarHistory: [],
      tracker: null,
      captures: [],
      liveTerms: [],
      docTerms: ["API Gateway"],
      docDefinitions: { "API Gateway": "managed API front door." },
    });
    const gateway = groups.terms.find((t) => t.label === "API Gateway");
    expect(gateway?.detail).toBe("managed API front door.");
  });
});

describe("buildFoundGroups — prepQa (split-source spec 2026-08-27)", () => {
  it("maps prepared pairs into prep items carrying the pair", () => {
    const g = buildFoundGroups({
      radarHistory: [],
      tracker: null,
      captures: [],
      liveTerms: [],
      docTerms: [],
      prepQa: [
        { question: "Why us?", answer: "Mission fit.", theme: "Behavioral", source: "ally" },
      ],
    });
    expect(g.prepQa).toEqual([
      {
        id: "p-why us?",
        group: "prep",
        label: "Why us?",
        detail: "Mission fit.",
        prep: { question: "Why us?", answer: "Mission fit.", theme: "Behavioral", source: "ally" },
      },
    ]);
  });

  it("omitted prepQa yields an empty group", () => {
    const g = buildFoundGroups({
      radarHistory: [],
      tracker: null,
      captures: [],
      liveTerms: [],
      docTerms: [],
    });
    expect(g.prepQa).toEqual([]);
  });
});

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { FanerReplayPanel } from "@/components/dev/FanerReplayPanel";
import type {
  CandidateTrace,
  DebugHighlightResponse,
  FanerEvalResult,
  ReplayOutcome,
} from "@/lib/ipc";

const m = vi.hoisted(() => ({
  fanerReplay: vi.fn(),
  fanerDebugHighlight: vi.fn(),
  fanerDebugGenerateCases: vi.fn(),
  fanerDebugEvaluate: vi.fn(),
}));

vi.mock("@/lib/commands", () => m);

const cand = (over: Partial<CandidateTrace>): CandidateTrace => ({
  term: "API gateway",
  key: "api gateway",
  score: 1.5,
  signals: [{ source: "context term", weight: 1 }],
  spans: [
    {
      start: 20,
      end: 31,
      text: "API gateway",
      status: "selected",
      container: null,
    },
  ],
  decision: "selected",
  reason: "selected",
  ...over,
});

function highlightResponse(
  over: Partial<DebugHighlightResponse> = {},
): DebugHighlightResponse {
  return {
    terms: ["API gateway", "Lambda"],
    trace: [
      cand({}),
      cand({
        term: "API",
        key: "api",
        score: 0.5,
        signals: [{ source: "entity/acronym", weight: 0.5 }],
        spans: [
          {
            start: 20,
            end: 23,
            text: "API",
            status: "contained",
            container: "api gateway",
          },
        ],
        decision: "rejected",
        reason: 'contained in longer phrase "api gateway"',
      }),
    ],
    source: "manual",
    knownTerms: ["API Gateway", "AWS Lambda"],
    activeContextTerms: [],
    activeScopeDocCount: 0,
    ...over,
  };
}

async function openPanel() {
  const user = userEvent.setup();
  render(<FanerReplayPanel />);
  await user.click(screen.getByRole("button", { name: /FANER/ }));
  return user;
}

describe("FanerReplayPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.fanerDebugHighlight.mockResolvedValue(highlightResponse());
  });

  it("starts collapsed to the launcher button only", () => {
    render(<FanerReplayPanel />);
    expect(screen.getByRole("button", { name: /FANER/ })).toBeInTheDocument();
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
  });

  it("Highlighter mode calls the deterministic debug command, never faner_replay", async () => {
    const user = await openPanel();
    await user.click(screen.getByRole("button", { name: "Run highlighter" }));

    await waitFor(() => expect(m.fanerDebugHighlight).toHaveBeenCalledTimes(1));
    expect(m.fanerReplay).not.toHaveBeenCalled();
    const req = m.fanerDebugHighlight.mock.calls[0]?.[0];
    // Speaker label stripped; manual terms parsed; manual source by default.
    expect(req.text).toBe(
      "Can you explain how API gateway integrates with Lambda?",
    );
    expect(req.terms).toContain("API Gateway");
    expect(req.useActiveContext).toBe(false);
  });

  it("the preview prefers the longer phrase and shows the trace", async () => {
    const user = await openPanel();
    await user.click(screen.getByRole("button", { name: "Run highlighter" }));

    const preview = await screen.findByTestId("highlight-preview");
    const hits = within(preview)
      .getAllByTestId("highlight-hit")
      .map((n) => n.textContent);
    expect(hits).toEqual(["API gateway", "Lambda"]);
    expect(hits).not.toContain("API");

    const rows = screen.getAllByTestId("trace-row");
    expect(rows).toHaveLength(2);
    expect(rows[1]).toHaveTextContent("rejected");
    expect(rows[1]).toHaveTextContent('contained in longer phrase "api gateway"');
    expect(screen.getByTestId("selected-terms")).toHaveTextContent(
      "API gateway · Lambda",
    );
  });

  it("states whether manual terms or the active Context were used", async () => {
    const user = await openPanel();
    await user.click(screen.getByRole("button", { name: "Run highlighter" }));
    expect(await screen.findByTestId("term-source-banner")).toHaveTextContent(
      /manually supplied/i,
    );

    m.fanerDebugHighlight.mockResolvedValue(
      highlightResponse({
        source: "active_context",
        activeContextTerms: ["API Gateway"],
        activeScopeDocCount: 3,
      }),
    );
    await user.click(screen.getByLabelText(/Active application Context/));
    await user.click(screen.getByRole("button", { name: "Run highlighter" }));
    await waitFor(() =>
      expect(screen.getByTestId("term-source-banner")).toHaveTextContent(
        /active application Context.*1 term.*3 scoped docs/is,
      ),
    );
    expect(m.fanerDebugHighlight.mock.calls[1]?.[0].useActiveContext).toBe(true);
  });

  it("Capture mode still calls faner_replay and separates raw from resolved arguments", async () => {
    const outcome: ReplayOutcome = {
      raw: [
        {
          trigger: "gap",
          action: "EXPLAIN",
          arguments: ["API"],
          tier: "field",
          kind: "concept",
          preview: "An API front door.",
        },
      ],
      resolved: [
        {
          trigger: "gap",
          action: "EXPLAIN",
          arguments: ["API Gateway"],
          tier: "field",
          kind: "concept",
          preview: "An API front door.",
        },
      ],
      trace: [
        {
          capture_index: 0,
          raw: "API",
          resolved: "API Gateway",
          outcome: "rewritten",
          reason: "every occurrence is inside a longer known phrase that was spoken",
          container: "API Gateway",
          matched_text: "API gateway",
        },
      ],
    };
    m.fanerReplay.mockResolvedValue(outcome);

    const user = await openPanel();
    await user.click(screen.getByRole("tab", { name: "Capture router" }));
    await user.click(screen.getByRole("button", { name: "Route" }));

    await waitFor(() => expect(m.fanerReplay).toHaveBeenCalledTimes(1));
    expect(m.fanerDebugHighlight).not.toHaveBeenCalled();
    expect(m.fanerReplay.mock.calls[0]?.[0]).toBe("Software Engineer");

    expect(await screen.findByTestId("raw-args")).toHaveTextContent("“API”");
    expect(screen.getByTestId("raw-args")).not.toHaveTextContent("API Gateway");
    expect(screen.getByTestId("resolved-args")).toHaveTextContent(
      "“API Gateway”",
    );
    const row = screen.getByTestId("argument-trace");
    expect(row).toHaveTextContent("rewritten");
    expect(row).toHaveTextContent("“API” ⟶ “API Gateway”");
  });

  it("the capture preview underlines the longer resolved phrase, not its fragment", async () => {
    m.fanerReplay.mockResolvedValue({
      raw: [],
      resolved: [
        {
          trigger: "gap",
          action: "EXPLAIN",
          arguments: ["API"],
          tier: null,
          kind: null,
          preview: "",
        },
        {
          trigger: "gap",
          action: "EXPLAIN",
          arguments: ["API Gateway"],
          tier: null,
          kind: null,
          preview: "",
        },
      ],
      trace: [],
    } satisfies ReplayOutcome);
    const user = await openPanel();
    await user.click(screen.getByRole("tab", { name: "Capture router" }));
    // Replace the default transcript with the reported case.
    const box = screen.getByLabelText(/Transcript \(one line each/);
    await user.clear(box);
    await user.click(box);
    await user.paste("THEM: how API Gateway integrates");
    await user.click(screen.getByRole("button", { name: "Route" }));

    const preview = await screen.findByTestId("capture-preview");
    const hits = within(preview)
      .getAllByTestId("capture-hit")
      .map((n) => n.firstChild?.textContent);
    expect(hits).toEqual(["API Gateway"]);
  });

  it("Batch mode generates reproducible cases from seed+count and exports failing fixtures", async () => {
    const evalResult: FanerEvalResult = {
      case: {
        id: "seed5-1",
        seed: 5,
        transcript: "the api. gateway",
        known_terms: ["API Gateway"],
        expected_terms: [],
        forbidden_terms: ["API Gateway"],
      },
      actual_terms: ["api gateway"],
      passed: false,
      failures: ['phrase joined across a hard boundary: "API Gateway"'],
      trace: [cand({})],
    };
    m.fanerDebugGenerateCases.mockResolvedValue([evalResult.case]);
    m.fanerDebugEvaluate.mockResolvedValue([evalResult]);
    const user = await openPanel();
    // user-event installs its own clipboard stub in setup(); spy on that one.
    const writeText = vi.spyOn(navigator.clipboard, "writeText");
    await user.click(screen.getByRole("tab", { name: "Batch" }));
    const seed = screen.getByLabelText("Seed");
    await user.clear(seed);
    await user.type(seed, "5");
    const count = screen.getByLabelText("Case count");
    await user.clear(count);
    await user.type(count, "12");
    await user.click(screen.getByRole("button", { name: "Generate & run" }));

    await waitFor(() =>
      expect(m.fanerDebugGenerateCases).toHaveBeenCalledWith(
        5,
        12,
        expect.arrayContaining(["API Gateway"]),
      ),
    );
    expect(m.fanerDebugEvaluate).toHaveBeenCalledWith([evalResult.case]);
    expect(await screen.findByTestId("batch-summary")).toHaveTextContent(
      "0/1 graded cases passed",
    );

    await user.click(
      screen.getByRole("button", { name: /Copy failing fixtures/ }),
    );
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const fixture = JSON.parse(writeText.mock.calls[0]?.[0] as string);
    expect(fixture[0]).toMatchObject({
      seed: 5,
      transcript: "the api. gateway",
      known_terms: ["API Gateway"],
      forbidden_terms: ["API Gateway"],
      actual_terms: ["api gateway"],
    });
    expect(fixture[0].trace[0]).toMatchObject({ key: "api gateway" });
    expect(m.fanerReplay).not.toHaveBeenCalled();
  });
});

describe("debug-only mounting", () => {
  it("App still mounts the panel only in dev + desktop + visible debug chrome", () => {
    const src = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");
    expect(src).toMatch(
      /import\.meta\.env\.DEV\s*&&\s*!isWeb\s*&&\s*debugChromeVisible\s*&&\s*<FanerReplayPanel\s*\/>/,
    );
  });
});

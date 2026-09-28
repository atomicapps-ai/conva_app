import type { FanerReplayLine } from "@/lib/commands";
import type {
  CandidateTrace,
  FanerEvalCase,
  FanerEvalResult,
} from "@/lib/ipc";

/** Dev-panel helpers — pure, so they're unit-tested without React. */

/** `THEM: …` / `YOU: …` per line; an unprefixed line is the other party. */
export function parseLines(text: string): FanerReplayLine[] {
  const out: FanerReplayLine[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const m = /^(you|them)\s*:\s*(.*)$/i.exec(line);
    if (m && m[2] !== undefined) {
      out.push({
        speaker: m[1]?.toLowerCase() === "you" ? "you" : "them",
        text: m[2],
      });
    } else {
      out.push({ speaker: "them", text: line });
    }
  }
  return out;
}

/** Comma- or newline-separated term list. */
export function parseTerms(text: string): string[] {
  return text
    .split(/[,\n]/)
    .map((t) => t.trim())
    .filter(Boolean);
}

/**
 * The text the highlighter analyses: speaker labels stripped (a bare `THEM`
 * would read as an all-caps acronym entity), one line per turn. Lines stay
 * separated by a newline — a hard phrase boundary, exactly as separate turns
 * are never joined into one phrase.
 */
export function highlighterText(text: string): string {
  return parseLines(text)
    .map((l) => l.text)
    .join("\n");
}

/**
 * Manual batch cases, one per line: `transcript => expected; expected`.
 * Expectations are optional (a bare line is a free exploration case).
 */
export function parseManualCases(
  text: string,
  knownTerms: string[],
): FanerEvalCase[] {
  const cases: FanerEvalCase[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const [transcript = "", expected = ""] = line.split("=>");
    cases.push({
      id: `manual-${cases.length + 1}`,
      seed: 0,
      transcript: transcript.trim(),
      known_terms: knownTerms,
      expected_terms: expected
        .split(";")
        .map((t) => t.trim())
        .filter(Boolean),
      forbidden_terms: [],
    });
  }
  return cases;
}

/** Compact reproducible fixture for one evaluated case. */
export function toFixture(result: FanerEvalResult) {
  return {
    id: result.case.id,
    seed: result.case.seed,
    transcript: result.case.transcript,
    known_terms: result.case.known_terms,
    expected_terms: result.case.expected_terms,
    forbidden_terms: result.case.forbidden_terms,
    actual_terms: result.actual_terms,
    passed: result.passed,
    failures: result.failures,
    trace: compactTrace(result.trace),
  };
}

export function compactTrace(trace: CandidateTrace[]) {
  return trace.map((c) => ({
    term: c.term,
    key: c.key,
    decision: c.decision,
    score: c.score,
    signals: c.signals.map((s) => s.source),
    reason: c.reason,
  }));
}

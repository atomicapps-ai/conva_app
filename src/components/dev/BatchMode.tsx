import { useState } from "react";

import {
  fanerDebugEvaluate,
  fanerDebugGenerateCases,
} from "@/lib/commands";
import type { FanerEvalCase, FanerEvalResult } from "@/lib/ipc";

import { parseManualCases, parseTerms, toFixture } from "./fanerDebug";
import { TraceRow } from "./HighlighterMode";

/**
 * Batch mode — seeded, reproducible evaluation of the phrase resolver. Cases
 * are generated from the known terms (capitalization / hyphenation /
 * punctuation / position / repetition / competing terms / boundary traps) or
 * typed by hand as `transcript => expected; expected`. Every failure copies
 * out as a compact JSON fixture that reproduces it from its seed.
 */

const DEFAULT_MANUAL = `Explain how API gateway works => API Gateway
We changed the API. Gateway settings are next`;

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function BatchMode({ terms }: { terms: string }) {
  // Raw text, clamped only when a run starts — clamping per keystroke would
  // turn typing "12" after clearing into "112".
  const [seedText, setSeedText] = useState("1");
  const [countText, setCountText] = useState("25");
  const [manual, setManual] = useState(DEFAULT_MANUAL);
  const [results, setResults] = useState<FanerEvalResult[] | null>(null);
  const [cases, setCases] = useState<FanerEvalCase[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const evaluate = async (make: () => Promise<FanerEvalCase[]>) => {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const generated = await make();
      setCases(generated);
      setResults(await fanerDebugEvaluate(generated));
    } catch (e) {
      setResults(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const known = parseTerms(terms);
  const runSeeded = () => {
    const seed = Math.max(0, Math.floor(Number(seedText) || 0));
    const count = Math.min(500, Math.max(1, Math.floor(Number(countText) || 1)));
    return evaluate(() => fanerDebugGenerateCases(seed, count, known));
  };
  const runManual = () =>
    evaluate(() => Promise.resolve(parseManualCases(manual, known)));

  const failing = results?.filter((r) => r.passed === false) ?? [];
  const graded = results?.filter((r) => r.passed !== null) ?? [];

  const exportFixtures = async (which: "failing" | "all") => {
    if (!results) return;
    const chosen = which === "failing" ? failing : results;
    const json = JSON.stringify(chosen.map(toFixture), null, 1);
    setNote(
      (await copy(json))
        ? `Copied ${chosen.length} fixture(s) to the clipboard.`
        : "Clipboard unavailable in this webview.",
    );
  };

  return (
    <div className="flex flex-col gap-2">
      <p className="rounded border border-border bg-bg px-2 py-1 text-[11px] text-fg-muted">
        Free — deterministic, no LLM. Uses the <b>manual known terms</b> from
        the Highlighter tab (curated defaults when empty).
      </p>
      <div className="flex items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wider text-fg-faint">
            Seed
          </span>
          <input
            type="number"
            aria-label="Seed"
            value={seedText}
            min={0}
            onChange={(e) => setSeedText(e.target.value)}
            className="w-24 rounded border border-border bg-bg px-2 py-1 text-fg"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wider text-fg-faint">
            Cases
          </span>
          <input
            type="number"
            aria-label="Case count"
            value={countText}
            min={1}
            max={500}
            onChange={(e) => setCountText(e.target.value)}
            className="w-20 rounded border border-border bg-bg px-2 py-1 text-fg"
          />
        </label>
        <button
          type="button"
          onClick={runSeeded}
          disabled={busy}
          className="rounded border border-border bg-panel px-3 py-1 text-[12px] font-semibold text-fg hover:opacity-80 disabled:opacity-50"
        >
          {busy ? "Running…" : "Generate & run"}
        </button>
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-[10px] uppercase tracking-wider text-fg-faint">
          Manual cases — one per line: transcript =&gt; expected; expected
        </span>
        <textarea
          value={manual}
          onChange={(e) => setManual(e.target.value)}
          rows={4}
          className="resize-y rounded border border-border bg-bg px-2 py-1 font-mono text-[11px] text-fg"
        />
      </label>
      <button
        type="button"
        onClick={runManual}
        disabled={busy}
        className="self-start rounded border border-border bg-panel px-3 py-1 text-[12px] font-semibold text-fg hover:opacity-80 disabled:opacity-50"
      >
        Run manual cases
      </button>

      {error && <p className="font-mono text-[11px] text-fg">⚠ {error}</p>}

      {results && (
        <>
          <p data-testid="batch-summary" className="font-mono text-[11px] text-fg">
            {graded.length - failing.length}/{graded.length} graded cases passed
            {results.length !== graded.length
              ? ` · ${results.length - graded.length} ungraded`
              : ""}
            {cases[0] && cases[0].seed ? ` · seed ${cases[0].seed}` : ""}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => exportFixtures("failing")}
              disabled={failing.length === 0}
              className="rounded border border-border px-2 py-0.5 text-[11px] text-fg-muted hover:text-fg disabled:opacity-40"
            >
              Copy failing fixtures (JSON)
            </button>
            <button
              type="button"
              onClick={() => exportFixtures("all")}
              className="rounded border border-border px-2 py-0.5 text-[11px] text-fg-muted hover:text-fg"
            >
              Copy all (JSON)
            </button>
          </div>
          {note && <p className="text-[11px] text-fg-muted">{note}</p>}
          <ul className="flex flex-col gap-1">
            {results.map((r) => (
              <li
                key={r.case.id}
                data-testid="batch-result"
                className="rounded border border-border bg-bg p-1.5 font-mono text-[10.5px] leading-snug"
              >
                <div>
                  <span
                    className={
                      r.passed === false
                        ? "font-semibold text-rose-300"
                        : r.passed
                          ? "font-semibold text-emerald-300"
                          : "font-semibold text-fg-faint"
                    }
                  >
                    {r.passed === false ? "✗ FAIL" : r.passed ? "✓ pass" : "– ungraded"}
                  </span>{" "}
                  <span className="text-fg-faint">{r.case.id}</span>
                </div>
                <div className="text-fg">“{r.case.transcript}”</div>
                <div className="text-fg-muted">
                  expected [{r.case.expected_terms.join(", ")}]
                  {r.case.forbidden_terms.length > 0 &&
                    ` · forbidden [${r.case.forbidden_terms.join(", ")}]`}{" "}
                  · actual [{r.actual_terms.join(", ")}]
                </div>
                {r.failures.map((f, i) => (
                  <div key={i} className="text-rose-300">
                    ↳ {f}
                  </div>
                ))}
                {r.passed === false && (
                  <details>
                    <summary className="cursor-pointer text-fg-faint">
                      candidate trace
                    </summary>
                    <ul className="mt-1 flex flex-col gap-1">
                      {r.trace.map((c) => (
                        <TraceRow key={c.key} c={c} />
                      ))}
                    </ul>
                  </details>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

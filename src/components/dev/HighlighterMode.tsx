import { useState } from "react";

import {
  buildHighlightSegments,
  highlightHitClass,
  termKey,
} from "@/components/transcript/highlightSegments";
import { fanerDebugHighlight } from "@/lib/commands";
import type { CandidateTrace, DebugHighlightResponse } from "@/lib/ipc";

import { highlighterText, parseTerms } from "./fanerDebug";

/**
 * Highlighter mode — runs the REAL deterministic phrase resolver
 * (`faner_debug_highlight`: no LLM, no tokens) on arbitrary pasted text and
 * shows the preview exactly as a transcript bubble renders it, the selected
 * terms, and why every candidate was selected, rewritten, or rejected.
 */

/** Bundled domain packs offered in manual mode (the live pipeline picks its
 *  own from the active Context). */
export const MANUAL_PACKS = ["software-engineering"];

export const DEFAULT_HIGHLIGHT_TEXT =
  "THEM: Can you explain how API gateway integrates with Lambda?";

export function TraceRow({ c }: { c: CandidateTrace }) {
  const selected = c.decision === "selected";
  return (
    <li
      data-testid="trace-row"
      className="rounded border border-border bg-bg p-1.5 font-mono text-[10.5px] leading-snug"
    >
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span
          className={
            selected
              ? "font-semibold text-emerald-300"
              : "font-semibold text-rose-300"
          }
        >
          {selected ? "✓ selected" : "✗ rejected"}
        </span>
        <span className="text-fg">“{c.term}”</span>
        <span className="text-fg-faint">key {c.key}</span>
        <span className="text-fg-faint">score {c.score.toFixed(2)}</span>
        <span className="text-fg-faint">origin {c.origin}</span>
      </div>
      <div className="text-fg-muted">
        signals:{" "}
        {c.signals.map((s) => `${s.source} +${s.weight.toFixed(1)}`).join(", ")}
      </div>
      {c.spans.length > 0 && (
        <div className="text-fg-muted">
          spans:{" "}
          {c.spans
            .map((s) =>
              s.status === "contained"
                ? `“${s.text}” [${s.start}–${s.end}] contained in “${s.container}”`
                : `“${s.text}” [${s.start}–${s.end}]`,
            )
            .join(" · ")}
        </div>
      )}
      <div className="text-fg-faint">↳ {c.reason}</div>
    </li>
  );
}

export function HighlighterMode({
  terms,
  setTerms,
}: {
  terms: string;
  setTerms: (v: string) => void;
}) {
  const [text, setText] = useState(DEFAULT_HIGHLIGHT_TEXT);
  const [docText, setDocText] = useState("");
  const [useActive, setUseActive] = useState(false);
  // Domain pack in manual mode. On by default so the owner's recipe sentences
  // (`… ORM for modeling data`) show what the pack adds; untick to see the
  // baseline without it.
  const [usePack, setUsePack] = useState(true);
  const [result, setResult] = useState<DebugHighlightResponse | null>(null);
  const [analysed, setAnalysed] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const body = highlighterText(text);
      const r = await fanerDebugHighlight({
        text: body,
        terms: parseTerms(terms),
        docText,
        useActiveContext: useActive,
        lexiconPacks: usePack ? MANUAL_PACKS : [],
      });
      setAnalysed(body);
      setResult(r);
    } catch (e) {
      setResult(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const originByKey = new Map(
    (result?.terms ?? []).map((t, i) => [termKey(t), result?.origins[i]]),
  );

  return (
    <div className="flex flex-col gap-2">
      <fieldset className="flex flex-col gap-1 rounded border border-border p-2">
        <legend className="px-1 text-[10px] uppercase tracking-wider text-fg-faint">
          Known terms come from
        </legend>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="faner-term-source"
            checked={!useActive}
            onChange={() => setUseActive(false)}
          />
          <span>Manually supplied terms (below)</span>
        </label>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="faner-term-source"
            checked={useActive}
            onChange={() => setUseActive(true)}
          />
          <span>Active application Context (live pipeline)</span>
        </label>
      </fieldset>

      {!useActive && (
        <>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wider text-fg-faint">
              Prepared / context / document terms (comma-separated)
            </span>
            <input
              value={terms}
              onChange={(e) => setTerms(e.target.value)}
              className="rounded border border-border bg-bg px-2 py-1 text-fg"
            />
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={usePack}
              onChange={(e) => setUsePack(e.target.checked)}
            />
            <span>
              Apply domain pack{MANUAL_PACKS.length > 1 ? "s" : ""}:{" "}
              {MANUAL_PACKS.join(", ")}
            </span>
          </label>
          <details>
            <summary className="cursor-pointer text-[10px] uppercase tracking-wider text-fg-faint">
              Document text (optional — doc-overlap / doc-phrase signals)
            </summary>
            <textarea
              value={docText}
              onChange={(e) => setDocText(e.target.value)}
              rows={3}
              className="mt-1 w-full resize-y rounded border border-border bg-bg px-2 py-1 font-mono text-[11px] text-fg"
            />
          </details>
        </>
      )}

      <label className="flex flex-col gap-1">
        <span className="text-[10px] uppercase tracking-wider text-fg-faint">
          Conversation text (any pasted text; THEM:/YOU: labels are stripped)
        </span>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={5}
          className="resize-y rounded border border-border bg-bg px-2 py-1 font-mono text-[11px] text-fg"
        />
      </label>
      <button
        type="button"
        onClick={run}
        disabled={busy}
        className="self-start rounded border border-border bg-panel px-3 py-1 text-[12px] font-semibold text-fg hover:opacity-80 disabled:opacity-50"
      >
        {busy ? "Running…" : "Run highlighter"}
      </button>

      {error && <p className="font-mono text-[11px] text-fg">⚠ {error}</p>}

      {result && (
        <>
          <p
            data-testid="term-source-banner"
            className="rounded border border-border bg-bg px-2 py-1 text-[11px] text-fg-muted"
          >
            {result.source === "manual" ? (
              <>
                Using <b>manually supplied</b> terms ({result.knownTerms.length}
                ) — not the live Context. The app’s active Context has{" "}
                {result.activeContextTerms.length} term
                {result.activeContextTerms.length === 1 ? "" : "s"}.
              </>
            ) : (
              <>
                Using the <b>active application Context</b>:{" "}
                {result.activeContextTerms.length} term
                {result.activeContextTerms.length === 1 ? "" : "s"},{" "}
                {result.activeScopeDocCount} scoped doc
                {result.activeScopeDocCount === 1 ? "" : "s"} — the same
                pipeline transcript bubbles run (RAG, rarity, 👍/👎).
              </>
            )}
          </p>
          <p
            data-testid="pack-banner"
            className="rounded border border-border bg-bg px-2 py-1 text-[11px] text-fg-muted"
          >
            {result.packs.length > 0 ? (
              <>
                Domain packs used: <b>{result.packs.join(", ")}</b>.
              </>
            ) : result.source === "active_context" ? (
              <>
                <b>No domain pack</b> applies to the active Context (its title,
                purpose, job description and terms did not match any pack’s
                anchors).
              </>
            ) : (
              <>
                <b>No domain pack</b> applied to this run.
              </>
            )}{" "}
            {result.source === "manual" && (
              <>
                The active Context has{" "}
                {result.activePacks.length > 0
                  ? `selected: ${result.activePacks.join(", ")}`
                  : "selected none"}
                .
              </>
            )}
          </p>

          <div>
            <p className="mb-1 text-[10px] uppercase tracking-wider text-fg-faint">
              Preview — as a transcript bubble renders it
            </p>
            <div
              data-testid="highlight-preview"
              className="flex flex-col gap-1 rounded border border-border bg-bg p-2 text-[12px] leading-relaxed text-fg"
            >
              {analysed.split("\n").map((line, i) => (
                <p key={i}>
                  {buildHighlightSegments(line, result.terms).map((seg, j) =>
                    seg.hit ? (
                      <mark
                        key={j}
                        data-testid="highlight-hit"
                        data-origin={originByKey.get(termKey(seg.text))}
                        className={highlightHitClass(
                          originByKey.get(termKey(seg.text)),
                        )}
                      >
                        {seg.text}
                      </mark>
                    ) : (
                      <span key={j}>{seg.text}</span>
                    ),
                  )}
                </p>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-1 text-[10px] uppercase tracking-wider text-fg-faint">
              Selected terms ({result.terms.length})
            </p>
            <p data-testid="selected-terms" className="font-mono text-[11px]">
              {result.terms.length
                ? result.terms
                    .map((t, i) => `${t} (${result.origins[i] ?? "?"})`)
                    .join(" · ")
                : "(none)"}
            </p>
          </div>

          {result.activeContextTerms.length > 0 && (
            <details>
              <summary className="cursor-pointer text-[10px] uppercase tracking-wider text-fg-faint">
                App’s active_context_terms ({result.activeContextTerms.length})
              </summary>
              <p className="mt-1 font-mono text-[11px] text-fg-muted">
                {result.activeContextTerms.join(", ")}
              </p>
            </details>
          )}

          <div>
            <p className="mb-1 text-[10px] uppercase tracking-wider text-fg-faint">
              Candidate trace ({result.trace.length})
            </p>
            <ul className="flex flex-col gap-1">
              {result.trace.map((c) => (
                <TraceRow key={c.key} c={c} />
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}

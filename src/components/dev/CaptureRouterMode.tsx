import { useState } from "react";
import type { ReactNode } from "react";

import { fanerReplay } from "@/lib/commands";
import type { ArgumentTrace, Capture, ReplayOutcome } from "@/lib/ipc";
import { useAllyStore } from "@/state/ally";

import { parseLines, parseTerms } from "./fanerDebug";

/**
 * Capture Router mode — routes a scripted transcript through the LLM capture
 * rubric via `faner_replay` (spends real, metered tokens) and shows the
 * model's RAW arguments next to the deterministic phrase-RESOLVED ones, so an
 * `API` → `API Gateway` rewrite is visible.
 */

// Stable reference so the Zustand selector below never hands React a "new"
// empty array on every render (that causes an infinite re-render loop).
const EMPTY_CAPTURES: Capture[] = [];

export const DEFAULT_ROLE = "Software Engineer";
export const DEFAULT_TRANSCRIPT = `THEM: You've got Terraform on your resume — walk me through how you handle state when a whole team is applying changes. And how would you compare Terraform to something like CloudFormation or Pulumi?`;

function CaptureRow({ c }: { c: Capture }) {
  return (
    <li className="font-mono text-[11px] leading-relaxed text-fg-muted">
      <span className="text-fg-faint">{c.trigger}</span>
      {" → "}
      <span className="font-semibold text-fg">{c.action}</span>
      {(c.tier || c.kind) && (
        <span className="text-fg-faint">
          {" "}
          [{[c.tier, c.kind].filter(Boolean).join("·")}]
        </span>
      )}
      <span className="text-fg-muted">({c.arguments.join(", ")})</span>
      {c.preview && <div className="pl-4 text-fg-faint">↳ {c.preview}</div>}
    </li>
  );
}

const OUTCOME_STYLE: Record<string, string> = {
  rewritten: "text-amber-300",
  canonicalized: "text-sky-300",
  dropped: "text-rose-300",
  unverified: "text-fg-faint",
  kept: "text-fg-muted",
};

function ArgumentRow({ t }: { t: ArgumentTrace }) {
  return (
    <li
      data-testid="argument-trace"
      className="font-mono text-[11px] leading-relaxed"
    >
      <span className={OUTCOME_STYLE[t.outcome] ?? "text-fg-muted"}>
        {t.outcome}
      </span>{" "}
      <span className="text-fg-faint">#{t.capture_index}</span>{" "}
      <span className="text-fg">“{t.raw}”</span>
      {t.outcome !== "dropped" && t.resolved !== t.raw && (
        <>
          {" ⟶ "}
          <span className="font-semibold text-fg">“{t.resolved}”</span>
        </>
      )}
      <div className="pl-4 text-fg-faint">
        ↳ {t.reason}
        {t.matched_text ? ` (spoken: “${t.matched_text}”)` : ""}
      </div>
    </li>
  );
}

/** Border/text accent for an inline-highlighted term, by what it's for. */
function captureAccent(c: Capture): string {
  if (c.action === "RECALL") return "border-violet-400/70 text-violet-300";
  if (c.action === "ASSIST") return "border-emerald-400/70 text-emerald-300";
  if (c.action === "SYNTHESIZE") return "border-fuchsia-400/70 text-fuchsia-300";
  if (c.kind === "problem") return "border-amber-400/70 text-amber-300";
  return "border-sky-400/70 text-sky-300"; // EXPLAIN · concept (or unclassified)
}

interface Hit {
  phrase: string;
  capture: Capture;
}

/** Every (capture, literal-argument-found-in-text) pair, longest phrase
 *  first so a longer match wins over a shorter one nested inside it.
 *  `question`-trigger captures are skipped — their arguments are the
 *  model's paraphrase of the whole question, not a literal span, so
 *  highlighting them would point at the wrong words. */
export function collectHits(text: string, captures: Capture[]): Hit[] {
  const lower = text.toLowerCase();
  const hits: Hit[] = [];
  for (const c of captures) {
    if (c.trigger === "question") continue;
    for (const arg of c.arguments) {
      const phrase = arg.trim();
      if (phrase.length >= 3 && lower.includes(phrase.toLowerCase())) {
        hits.push({ phrase, capture: c });
      }
    }
  }
  return hits.sort((a, b) => b.phrase.length - a.phrase.length);
}

/** Render `text` with every matched hit wrapped in a hover-tooltip span —
 *  the actual preview of what mouse-over on the real transcript would do. */
export function renderHighlighted(text: string, hits: Hit[]): ReactNode {
  if (!hits.length) return text;
  const lower = text.toLowerCase();
  const nodes: ReactNode[] = [];
  let plainStart = 0;
  let key = 0;
  const flushPlain = (end: number) => {
    if (end > plainStart) nodes.push(text.slice(plainStart, end));
  };
  let i = 0;
  outer: while (i < text.length) {
    for (const h of hits) {
      const p = h.phrase.toLowerCase();
      if (p && lower.startsWith(p, i)) {
        flushPlain(i);
        const label = h.capture.kind ?? h.capture.action.toLowerCase();
        nodes.push(
          <span
            key={key++}
            data-testid="capture-hit"
            className={`group relative inline-block cursor-help border-b border-dashed ${captureAccent(h.capture)}`}
          >
            {text.slice(i, i + h.phrase.length)}
            <span className="invisible absolute left-0 top-full z-50 mt-1 w-64 max-w-[85vw] rounded border border-border bg-panel-raised p-2 text-[11px] normal-case leading-snug text-fg opacity-0 shadow-xl transition-opacity duration-100 group-hover:visible group-hover:opacity-100">
              <span className="mb-1 block font-mono text-[9px] uppercase tracking-wide text-fg-faint">
                {h.capture.action} · {label}
              </span>
              {h.capture.preview || "(no preview yet)"}
            </span>
          </span>,
        );
        i += h.phrase.length;
        plainStart = i;
        continue outer;
      }
    }
    i += 1;
  }
  flushPlain(text.length);
  return nodes;
}

export function CaptureRouterMode({
  terms,
  setTerms,
}: {
  terms: string;
  setTerms: (v: string) => void;
}) {
  const [role, setRole] = useState(DEFAULT_ROLE);
  const [transcript, setTranscript] = useState(DEFAULT_TRANSCRIPT);
  const [result, setResult] = useState<ReplayOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const liveCaptures = useAllyStore(
    (s) => s.capture?.captures ?? EMPTY_CAPTURES,
  );

  const route = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setResult(
        await fanerReplay(role.trim(), parseTerms(terms), parseLines(transcript)),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const lines = result ? parseLines(transcript) : [];
  // The preview shows what the LIVE path would surface: the resolved captures.
  const hits = result ? collectHits(transcript, result.resolved) : [];
  const rawArgs = result?.raw.flatMap((c) => c.arguments) ?? [];
  const resolvedArgs = result?.resolved.flatMap((c) => c.arguments) ?? [];

  return (
    <div className="flex flex-col gap-2">
      <p className="rounded border border-amber-400/40 bg-bg px-2 py-1 text-[11px] text-fg-muted">
        Spends real tokens (metered as “FANER replay (dev)”). For the free,
        deterministic phrase test use the Highlighter tab.
      </p>
      <label className="flex flex-col gap-1">
        <span className="text-[10px] uppercase tracking-wider text-fg-faint">
          Role
        </span>
        <input
          value={role}
          onChange={(e) => setRole(e.target.value)}
          className="rounded border border-border bg-bg px-2 py-1 text-fg"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[10px] uppercase tracking-wider text-fg-faint">
          Prepared terms (comma-separated)
        </span>
        <input
          value={terms}
          onChange={(e) => setTerms(e.target.value)}
          className="rounded border border-border bg-bg px-2 py-1 text-fg"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[10px] uppercase tracking-wider text-fg-faint">
          Transcript (one line each; prefix THEM: / YOU:) — drag the corner to
          resize
        </span>
        <textarea
          value={transcript}
          onChange={(e) => setTranscript(e.target.value)}
          rows={7}
          className="resize-y rounded border border-border bg-bg px-2 py-1 font-mono text-[11px] text-fg"
        />
      </label>
      <button
        type="button"
        onClick={route}
        disabled={busy}
        className="self-start rounded border border-border bg-panel px-3 py-1 text-[12px] font-semibold text-fg hover:opacity-80 disabled:opacity-50"
      >
        {busy ? "Routing…" : "Route"}
      </button>

      {error && <p className="font-mono text-[11px] text-fg">⚠ {error}</p>}

      {result && (
        <div>
          <p className="mb-1 text-[10px] uppercase tracking-wider text-fg-faint">
            Preview (resolved captures) — hover an underlined word
          </p>
          <div
            data-testid="capture-preview"
            className="flex flex-col gap-1.5 rounded border border-border bg-bg p-2 text-[12px] leading-relaxed text-fg"
          >
            {lines.length === 0 ? (
              <span className="text-fg-faint">(nothing to preview)</span>
            ) : (
              lines.map((l, i) => (
                <p key={i}>
                  <span className="mr-1 font-mono text-[10px] uppercase text-fg-faint">
                    {l.speaker}:
                  </span>
                  {renderHighlighted(l.text, hits)}
                </p>
              ))
            )}
          </div>
        </div>
      )}

      {result && (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <p className="mb-1 text-[10px] uppercase tracking-wider text-fg-faint">
              Raw model arguments ({rawArgs.length})
            </p>
            <p data-testid="raw-args" className="font-mono text-[11px]">
              {rawArgs.length ? rawArgs.map((a) => `“${a}”`).join(" · ") : "(none)"}
            </p>
          </div>
          <div>
            <p className="mb-1 text-[10px] uppercase tracking-wider text-fg-faint">
              Final resolved arguments ({resolvedArgs.length})
            </p>
            <p data-testid="resolved-args" className="font-mono text-[11px]">
              {resolvedArgs.length
                ? resolvedArgs.map((a) => `“${a}”`).join(" · ")
                : "(none)"}
            </p>
          </div>
        </div>
      )}

      {result && result.trace.length > 0 && (
        <div>
          <p className="mb-1 text-[10px] uppercase tracking-wider text-fg-faint">
            Phrase-resolver trace ({result.trace.length})
          </p>
          <ul className="flex flex-col gap-1">
            {result.trace.map((t, i) => (
              <ArgumentRow key={i} t={t} />
            ))}
          </ul>
        </div>
      )}

      {result && (
        <div>
          <p className="mb-1 text-[10px] uppercase tracking-wider text-fg-faint">
            Raw captures ({result.raw.length})
          </p>
          {result.raw.length === 0 ? (
            <p className="text-[11px] text-fg-faint">(none — stayed silent)</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {result.raw.map((c, i) => (
                <CaptureRow key={i} c={c} />
              ))}
            </ul>
          )}
        </div>
      )}

      {liveCaptures.length > 0 && (
        <div className="mt-1 border-t border-border pt-2">
          <p className="mb-1 text-[10px] uppercase tracking-wider text-fg-faint">
            Live session captures ({liveCaptures.length})
          </p>
          <ul className="flex flex-col gap-1">
            {liveCaptures.map((c, i) => (
              <CaptureRow key={i} c={c} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

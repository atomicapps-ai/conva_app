import { useState } from "react";
import type { ReactNode } from "react";

import { fanerReplay, type FanerReplayLine } from "@/lib/commands";
import type { Capture } from "@/lib/ipc";
import { useAllyStore } from "@/state/ally";

/**
 * Dev-only FANER validation panel (mounted behind `import.meta.env.DEV`).
 *
 * Three jobs, all for testing the capture routing without shipping the real
 * UI yet:
 *  - **Replay:** paste a scripted transcript (the golden conversations), hit
 *    Route, and see the captures the rubric produces via `faner_replay`.
 *  - **Preview:** the routed transcript re-rendered with FANER's own terms
 *    underlined — hover one to see exactly what the real inline
 *    highlight+popup (the eventual `TranscriptView` integration) would show.
 *  - **Live:** shows the cumulative captures the session worker has emitted
 *    (`useAllyStore.capture`), so a real conversation is observable too.
 */

// Stable reference so the Zustand selector below never hands React a "new"
// empty array on every render (that causes an infinite re-render loop).
const EMPTY_CAPTURES: Capture[] = [];

const MIN_WIDTH = 320;
const MAX_WIDTH = 720;
const DEFAULT_WIDTH = 420;
const MIN_HEIGHT = 280;
const DEFAULT_HEIGHT = 560;

const DEFAULT_TERMS = "AWS, SQL, Java, Python, Terraform";
const DEFAULT_TRANSCRIPT = `THEM: You've got Terraform on your resume — walk me through how you handle state when a whole team is applying changes. And how would you compare Terraform to something like CloudFormation or Pulumi?`;

function parseLines(text: string): FanerReplayLine[] {
  const out: FanerReplayLine[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const m = /^(you|them)\s*:\s*(.*)$/i.exec(line);
    if (m && m[2] !== undefined) {
      out.push({ speaker: m[1]?.toLowerCase() === "you" ? "you" : "them", text: m[2] });
    } else {
      out.push({ speaker: "them", text: line });
    }
  }
  return out;
}

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
function collectHits(text: string, captures: Capture[]): Hit[] {
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
function renderHighlighted(text: string, hits: Hit[]): ReactNode {
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

export function FanerReplayPanel() {
  const [open, setOpen] = useState(false);
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [height, setHeight] = useState(DEFAULT_HEIGHT);
  const [role, setRole] = useState("Software Engineer");
  const [terms, setTerms] = useState(DEFAULT_TERMS);
  const [transcript, setTranscript] = useState(DEFAULT_TRANSCRIPT);
  const [result, setResult] = useState<Capture[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const liveCaptures = useAllyStore((s) => s.capture?.captures ?? EMPTY_CAPTURES);

  // Shared drag-to-resize: `axis` picks which pointer coordinate to track and
  // which edge grows the box. The panel is anchored bottom-left, so width
  // grows from its RIGHT edge (dragging right = wider) and height grows from
  // its TOP edge (dragging up = taller, since the bottom stays put).
  const startResize = (axis: "width" | "height") => (e: React.PointerEvent) => {
    e.preventDefault();
    const start = axis === "width" ? e.clientX : e.clientY;
    const startSize = axis === "width" ? width : height;
    const onMove = (ev: PointerEvent) => {
      const current = axis === "width" ? ev.clientX : ev.clientY;
      const delta = axis === "width" ? current - start : start - current;
      const max = axis === "width" ? MAX_WIDTH : window.innerHeight - 24;
      const min = axis === "width" ? MIN_WIDTH : MIN_HEIGHT;
      const next = Math.min(max, Math.max(min, startSize + delta));
      if (axis === "width") setWidth(next);
      else setHeight(next);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const route = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const captures = await fanerReplay(
        role.trim(),
        terms
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
        parseLines(transcript),
      );
      setResult(captures);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-3 left-3 z-50 rounded-md border border-border bg-panel px-2 py-1 font-mono text-[10px] font-semibold uppercase tracking-widest text-fg-faint shadow-lg hover:text-fg"
      >
        FANER ▸
      </button>
    );
  }

  const lines = result ? parseLines(transcript) : [];
  const hits = result ? collectHits(transcript, result) : [];

  return (
    <div
      style={{ width, height }}
      className="fixed bottom-3 left-3 z-50 flex flex-col overflow-hidden rounded-lg border border-border bg-panel shadow-2xl"
    >
      {/* Drag-to-resize handles: right edge = width, top edge = height (the
          panel is bottom-anchored, so height grows upward from the top). */}
      <div
        onPointerDown={startResize("width")}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize FANER panel width"
        title="Drag to resize width"
        className="absolute right-0 top-0 z-10 h-full w-1.5 cursor-ew-resize hover:bg-fg-faint/30 active:bg-fg-faint/50"
      />
      <div
        onPointerDown={startResize("height")}
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize FANER panel height"
        title="Drag to resize height"
        className="absolute left-0 right-0 top-0 z-10 h-1.5 cursor-ns-resize hover:bg-fg-faint/30 active:bg-fg-faint/50"
      />

      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <span className="font-mono text-[11px] font-semibold uppercase tracking-widest text-fg-muted">
          FANER replay
        </span>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="ml-auto text-[11px] text-fg-faint hover:text-fg"
        >
          close
        </button>
      </div>

      {/* `min-h-0` is load-bearing: without it a flex child can't shrink
          below its content size, so this region silently overflows the
          panel (clipped by the outer overflow-hidden, no scrollbar) instead
          of scrolling internally. */}
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-3 py-2 text-[12px]">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wider text-fg-faint">Role</span>
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
            Transcript (one line each; prefix THEM: / YOU:) — drag the corner to resize
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
              Preview — hover an underlined word
            </p>
            <div className="flex flex-col gap-1.5 rounded border border-border bg-bg p-2 text-[12px] leading-relaxed text-fg">
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
          <div>
            <p className="mb-1 text-[10px] uppercase tracking-wider text-fg-faint">
              Raw captures ({result.length})
            </p>
            {result.length === 0 ? (
              <p className="text-[11px] text-fg-faint">(none — stayed silent)</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {result.map((c, i) => (
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
    </div>
  );
}

import { useState } from "react";

import { fanerReplay, type FanerReplayLine } from "@/lib/commands";
import type { Capture } from "@/lib/ipc";
import { useAllyStore } from "@/state/ally";

/**
 * Dev-only FANER validation panel (mounted behind `import.meta.env.DEV`).
 *
 * Two jobs, both for testing the capture routing without shipping UI yet:
 *  - **Replay:** paste a scripted transcript (the golden conversations), hit
 *    Route, and see the captures the rubric produces via `faner_replay`.
 *  - **Live:** shows the cumulative captures the session worker has emitted
 *    (`useAllyStore.capture`), so a real conversation is observable too.
 *
 * This is the seed of the eventual `CaptureRail`.
 */

// Stable reference so the Zustand selector below never hands React a "new"
// empty array on every render (that causes an infinite re-render loop).
const EMPTY_CAPTURES: Capture[] = [];

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
      <span className="text-fg-muted">({c.arguments.join(", ")})</span>
    </li>
  );
}

export function FanerReplayPanel() {
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState("Software Engineer");
  const [terms, setTerms] = useState(DEFAULT_TERMS);
  const [transcript, setTranscript] = useState(DEFAULT_TRANSCRIPT);
  const [result, setResult] = useState<Capture[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const liveCaptures = useAllyStore((s) => s.capture?.captures ?? EMPTY_CAPTURES);

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

  return (
    <div className="fixed bottom-3 left-3 z-50 flex max-h-[85vh] w-[380px] flex-col overflow-hidden rounded-lg border border-border bg-panel shadow-2xl">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
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

      <div className="flex flex-col gap-2 overflow-y-auto px-3 py-2 text-[12px]">
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
            Transcript (one line each; prefix THEM: / YOU:)
          </span>
          <textarea
            value={transcript}
            onChange={(e) => setTranscript(e.target.value)}
            rows={5}
            className="rounded border border-border bg-bg px-2 py-1 font-mono text-[11px] text-fg"
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
              Captures ({result.length})
            </p>
            {result.length === 0 ? (
              <p className="text-[11px] text-fg-faint">(none — stayed silent)</p>
            ) : (
              <ul className="flex flex-col gap-0.5">
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
            <ul className="flex flex-col gap-0.5">
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

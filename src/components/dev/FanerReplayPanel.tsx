import { useState } from "react";

import { BatchMode } from "./BatchMode";
import { CaptureRouterMode } from "./CaptureRouterMode";
import { HighlighterMode } from "./HighlighterMode";

/**
 * Dev-only FANER validation panel (mounted behind `import.meta.env.DEV` +
 * desktop + visible debug chrome — see `App.tsx`; it never ships in a release
 * build). Design: `conva_core/docs/technical/faner-phrase-resolution.md`.
 *
 * Three modes, deliberately separate because they exercise different code:
 *  - **Highlighter** — the deterministic phrase resolver behind transcript
 *    bubbles (`faner_debug_highlight`). Free: no LLM. Paste any text, supply
 *    known terms (or use the active app Context), see the bubble-accurate
 *    preview plus a per-candidate trace.
 *  - **Capture router** — the LLM capture rubric via `faner_replay`
 *    (spends real, metered tokens). Shows the model's RAW arguments beside
 *    the deterministic phrase-RESOLVED ones, and the live session captures.
 *  - **Batch** — seeded, reproducible evaluation with copyable JSON fixtures.
 */

type Mode = "highlighter" | "capture" | "batch";

const MODES: { id: Mode; label: string }[] = [
  { id: "highlighter", label: "Highlighter" },
  { id: "capture", label: "Capture router" },
  { id: "batch", label: "Batch" },
];

const MIN_WIDTH = 320;
const MAX_WIDTH = 720;
const DEFAULT_WIDTH = 460;
const MIN_HEIGHT = 280;
const DEFAULT_HEIGHT = 600;

const DEFAULT_TERMS = "API Gateway, AWS Lambda, AWS, SQL, Java, Python, Terraform";

export function FanerReplayPanel() {
  const [open, setOpen] = useState(false);
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [height, setHeight] = useState(DEFAULT_HEIGHT);
  const [mode, setMode] = useState<Mode>("highlighter");
  // Known terms are shared by every mode so one list drives all three.
  const [terms, setTerms] = useState(DEFAULT_TERMS);

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
          FANER debug
        </span>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="ml-auto text-[11px] text-fg-faint hover:text-fg"
        >
          close
        </button>
      </div>

      <div
        role="tablist"
        aria-label="FANER debug mode"
        className="flex shrink-0 gap-1 border-b border-border px-3 py-1.5"
      >
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            role="tab"
            aria-selected={mode === m.id}
            onClick={() => setMode(m.id)}
            className={`rounded px-2 py-0.5 text-[11px] font-semibold ${
              mode === m.id
                ? "bg-panel-raised text-fg"
                : "text-fg-faint hover:text-fg"
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {/* `min-h-0` is load-bearing: without it a flex child can't shrink
          below its content size, so this region silently overflows the
          panel (clipped by the outer overflow-hidden, no scrollbar) instead
          of scrolling internally. */}
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2 text-[12px]">
        {mode === "highlighter" && (
          <HighlighterMode terms={terms} setTerms={setTerms} />
        )}
        {mode === "capture" && (
          <CaptureRouterMode terms={terms} setTerms={setTerms} />
        )}
        {mode === "batch" && <BatchMode terms={terms} />}
      </div>
    </div>
  );
}

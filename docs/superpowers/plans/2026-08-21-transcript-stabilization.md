# Live Transcript Stabilization + Formatting Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the live transcript feel forward-only and stable instead of choppy — words are shown once they've survived two independent whisper decode passes (LocalAgreement-2), only the short unconfirmed tail is tentative/muted, and the rare correction on finalize animates visibly instead of snapping silently. Bundled: remove the `"|"` separators between sentence-units and simplify RAG-term highlights down to plain bold+underline.

**Architecture:** Frontend-only — whisper's own re-decode behavior in `asr.rs`/`vad.rs` is untouched. A new pure module (`transcriptStability.ts`) implements the LocalAgreement-2 prefix-confirmation and word-level diff; a new hook (`useTranscriptStability`) turns a turn's raw `TranscriptSegment[]` into a rendering plan; a new `ScrambleText` component animates only the rare corrected words, keyed by segment so React's own mount identity guarantees the animation plays exactly once.

**Tech Stack:** React 19, TypeScript, Vitest + `@testing-library/react` (including `renderHook`), Tailwind 4.

**Spec:** `docs/superpowers/specs/2026-08-21-transcript-stabilization-design.md` — read it first for the full LocalAgreement-2 rationale (arXiv:2307.14743 / ufal/whisper_streaming) and root-cause analysis; this plan implements it without re-deriving that reasoning.

---

## Before you start

- Branch `claude/transcript-stabilization` in `conva_app`, based on latest `main` — this branch does **not** have the separate F12 "Live panel" work from PR #52, so `TranscriptView.tsx` here still uses the original lightbulb icons (not stars). Don't assume F12's changes are present.
- Run `npm run build` once to confirm a clean starting baseline.
- Every `npx vitest run <path>` command below assumes the `conva_app` repo root.

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/transcriptStability.ts` | Create: pure LocalAgreement-2 + word-diff functions. |
| `src/lib/transcriptStability.test.ts` | Create: tests for the above. |
| `src/components/transcript/useTranscriptStability.ts` | Create: the stateful hook that turns a turn's segments into a rendering plan. |
| `src/components/transcript/useTranscriptStability.test.ts` | Create: tests for the hook (via `renderHook`). |
| `src/components/transcript/ScrambleText.tsx` | Create: the one-time word-correction animation. |
| `src/components/transcript/ScrambleText.test.tsx` | Create: tests for the above (fake timers). |
| `src/components/transcript/TranscriptView.tsx` | Modify: `FlowText` drops the `"|"` separator and takes stability-aware units; `HighlightedText`'s RAG-term span simplifies; `Bubble` wires the hook in place of the old `units`/`partialTail` computation. |

---

### Task 1: `transcriptStability.ts` — LocalAgreement-2 + word diff

**Files:**
- Create: `src/lib/transcriptStability.ts`
- Test: Create `src/lib/transcriptStability.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/transcriptStability.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { advanceConfirmed, diffWords, tentativeTail } from "@/lib/transcriptStability";

describe("advanceConfirmed", () => {
  it("confirms nothing on a segment's very first partial (lastRaw is null)", () => {
    expect(advanceConfirmed("", null, "walk me through")).toBe("");
  });

  it("confirms the common prefix once two consecutive hypotheses agree", () => {
    // Tick 1: lastRaw=null -> confirmed stays "". Tick 2: the two most
    // recent raw hypotheses ("walk me through" vs "walk me through AWS")
    // agree on "walk me through" -> that becomes confirmed.
    const confirmed = advanceConfirmed("", "walk me through", "walk me through AWS");
    expect(confirmed).toBe("walk me through");
  });

  it("never shrinks confirmed text even if a later hypothesis disagrees on it", () => {
    // Already confirmed "walk me through Terraform" from earlier ticks;
    // a new (mid-utterance re-decode) hypothesis revises "Terraform" to
    // "AWS" — that revision must NOT be pulled into the live display.
    const confirmed = advanceConfirmed(
      "walk me through Terraform",
      "walk me through Terraform state",
      "walk me through AWS state locking",
    );
    expect(confirmed).toBe("walk me through Terraform");
  });

  it("extends confirmed text as agreement grows further", () => {
    const confirmed = advanceConfirmed(
      "walk me through",
      "walk me through Terraform state",
      "walk me through Terraform state locking",
    );
    expect(confirmed).toBe("walk me through Terraform state");
  });

  it("is word-boundary-safe, not a character prefix", () => {
    // "wal" is a character-prefix of both but not a shared whole word.
    const confirmed = advanceConfirmed("", "walking the dog", "walk me through");
    expect(confirmed).toBe("");
  });
});

describe("tentativeTail", () => {
  it("returns whatever the current hypothesis has past the confirmed prefix", () => {
    expect(tentativeTail("walk me through", "walk me through Terraform state")).toBe(
      "Terraform state",
    );
  });

  it("returns an empty string once the hypothesis exactly matches confirmed", () => {
    expect(tentativeTail("walk me through", "walk me through")).toBe("");
  });
});

describe("diffWords", () => {
  it("marks no words changed when the texts already match", () => {
    const diff = diffWords("walk me through Terraform", "walk me through Terraform");
    expect(diff.every((w) => !w.changed)).toBe(true);
  });

  it("marks only the words that actually differ", () => {
    const diff = diffWords("walk me through Terraform", "walk me through AWS Step Functions");
    expect(diff.map((w) => ({ text: w.text, changed: w.changed }))).toEqual([
      { text: "walk", changed: false },
      { text: "me", changed: false },
      { text: "through", changed: false },
      { text: "AWS", changed: true },
      { text: "Step", changed: true },
      { text: "Functions", changed: true },
    ]);
  });

  it("marks trailing words appended past the old length as changed", () => {
    const diff = diffWords("walk me", "walk me through");
    expect(diff[2]).toEqual({ text: "through", changed: true });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/transcriptStability.test.ts`
Expected: FAIL — `src/lib/transcriptStability.ts` doesn't exist yet.

- [ ] **Step 3: Create `src/lib/transcriptStability.ts`**

```ts
/**
 * Live-transcript stabilization (F13 — see docs/superpowers/specs/2026-08-21-
 * transcript-stabilization-design.md for the full rationale). Whisper
 * re-decodes an entire utterance from scratch on every partial tick with no
 * memory of its own previous guess (`asr.rs`'s `set_no_context(true)`), so an
 * earlier word can genuinely change between ticks — there is no incremental
 * decoding happening anywhere in the pipeline. These pure functions
 * implement the published LocalAgreement-2 policy (arXiv:2307.14743,
 * ufal/whisper_streaming) at the display layer instead: a word is only
 * treated as "confirmed" once two consecutive raw hypotheses agree on it.
 */

function words(s: string): string[] {
  return s.trim().split(/\s+/).filter(Boolean);
}

/**
 * The LocalAgreement-2 step. `lastRaw` is the previous raw partial
 * hypothesis for this same in-flight segment (or `null` on the segment's
 * very first partial, when there's nothing yet to agree with).
 * `currentRaw` is the newest raw hypothesis. Returns the longest
 * word-prefix `lastRaw` and `currentRaw` agree on, WHICHEVER IS LONGER
 * between that and the already-`confirmedPrefix` passed in — confirmation
 * is monotonic and never shrinks, even if a later hypothesis revises an
 * already-confirmed word.
 */
export function advanceConfirmed(
  confirmedPrefix: string,
  lastRaw: string | null,
  currentRaw: string,
): string {
  if (lastRaw === null) return confirmedPrefix;
  const a = words(lastRaw);
  const b = words(currentRaw);
  let agree = 0;
  while (agree < a.length && agree < b.length && a[agree] === b[agree]) agree++;
  const confirmedWordCount = words(confirmedPrefix).length;
  if (agree <= confirmedWordCount) return confirmedPrefix;
  return b.slice(0, agree).join(" ");
}

/** Whatever `currentRaw` has past `confirmedPrefix` — the short, still-
 *  unconfirmed tail that renders in the existing muted/tentative style. */
export function tentativeTail(confirmedPrefix: string, currentRaw: string): string {
  const confirmedWordCount = words(confirmedPrefix).length;
  return words(currentRaw).slice(confirmedWordCount).join(" ");
}

export interface DiffWord {
  text: string;
  changed: boolean;
}

/**
 * Word-level diff between what was last displayed for a segment and its
 * true final text — used once, when a segment finalizes, to animate only
 * the words that actually differ. A simple positional compare (not a full
 * LCS diff): `before` and `after` are almost always near-identical (the
 * confirmed prefix already survived two decode passes), differing only in
 * the last word or two, so this is both simpler and sufficient for that
 * case.
 */
export function diffWords(before: string, after: string): DiffWord[] {
  const beforeWords = words(before);
  const afterWords = words(after);
  return afterWords.map((word, i) => ({
    text: word,
    changed: beforeWords[i] !== word,
  }));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/transcriptStability.test.ts`
Expected: PASS (11 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/transcriptStability.ts src/lib/transcriptStability.test.ts
git commit -m "feat(transcript): LocalAgreement-2 + word-diff pure functions

Implements the published LocalAgreement-2 policy (arXiv:2307.14743,
ufal/whisper_streaming) for stabilizing whisper's re-decode-from-scratch
partials at the display layer, plus a word-level diff for the one-time
final-correction animation."
```

---

### Task 2: `useTranscriptStability` — the stateful rendering-plan hook

**Files:**
- Create: `src/components/transcript/useTranscriptStability.ts`
- Test: Create `src/components/transcript/useTranscriptStability.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/components/transcript/useTranscriptStability.test.ts`:

```ts
import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useTranscriptStability } from "@/components/transcript/useTranscriptStability";
import type { TranscriptSegment } from "@/lib/ipc";

function seg(overrides: Partial<TranscriptSegment> = {}): TranscriptSegment {
  return {
    side: "inbound",
    seq: 1,
    text: "",
    is_final: false,
    start_ms: 0,
    end_ms: 0,
    confidence: null,
    latency_ms: 0,
    ...overrides,
  };
}

describe("useTranscriptStability", () => {
  it("shows nothing confirmed on a segment's first-ever partial", () => {
    const { result } = renderHook(({ segments }) => useTranscriptStability(segments), {
      initialProps: { segments: [seg({ text: "walk me through" })] },
    });
    expect(result.current.liveConfirmed).toBe("");
    expect(result.current.liveTentative).toBe("walk me through");
  });

  it("confirms the agreed prefix once a second partial for the same segment agrees", () => {
    const { result, rerender } = renderHook(
      ({ segments }) => useTranscriptStability(segments),
      { initialProps: { segments: [seg({ text: "walk me through" })] } },
    );
    rerender({ segments: [seg({ text: "walk me through Terraform" })] });
    expect(result.current.liveConfirmed).toBe("walk me through");
    expect(result.current.liveTentative).toBe("Terraform");
  });

  it("does not pull a later revision of an already-confirmed word into the live view", () => {
    const { result, rerender } = renderHook(
      ({ segments }) => useTranscriptStability(segments),
      { initialProps: { segments: [seg({ text: "walk me through" })] } },
    );
    rerender({ segments: [seg({ text: "walk me through Terraform" })] }); // confirms "walk me through"
    rerender({ segments: [seg({ text: "walk me through AWS state" })] }); // revises "Terraform" -> "AWS"
    expect(result.current.liveConfirmed).toBe("walk me through");
  });

  it("starts a fresh segment (new seq) with no memory of a previous one", () => {
    const { result, rerender } = renderHook(
      ({ segments }) => useTranscriptStability(segments),
      { initialProps: { segments: [seg({ seq: 1, text: "walk me through" })] } },
    );
    rerender({ segments: [seg({ seq: 1, text: "walk me through Terraform" })] });
    expect(result.current.liveConfirmed).toBe("walk me through");
    // A new utterance (seq 2) starts with nothing confirmed, even though
    // seq 1 had confirmed text.
    rerender({ segments: [seg({ seq: 2, text: "next utterance" })] });
    expect(result.current.liveConfirmed).toBe("");
    expect(result.current.liveTentative).toBe("next utterance");
  });

  it("renders a finalized segment with no diff when it matches what was last shown", () => {
    const { result, rerender } = renderHook(
      ({ segments }) => useTranscriptStability(segments),
      { initialProps: { segments: [seg({ text: "walk me through" })] } },
    );
    rerender({ segments: [seg({ text: "walk me through Terraform" })] }); // confirms "walk me through", tentative "Terraform"
    rerender({
      segments: [seg({ text: "walk me through Terraform", is_final: true })],
    });
    expect(result.current.finalUnits).toEqual([
      { key: "inbound-1", text: "walk me through Terraform", diff: null },
    ]);
  });

  it("attaches a diff only for the words that changed when the final text corrects the tentative tail", () => {
    const { result, rerender } = renderHook(
      ({ segments }) => useTranscriptStability(segments),
      { initialProps: { segments: [seg({ text: "walk me through" })] } },
    );
    rerender({ segments: [seg({ text: "walk me through Terraform" })] }); // tentative tail: "Terraform"
    rerender({
      segments: [seg({ text: "walk me through AWS Step Functions", is_final: true })],
    });
    const unit = result.current.finalUnits[0];
    expect(unit?.text).toBe("walk me through AWS Step Functions");
    expect(unit?.diff?.map((w) => w.changed)).toEqual([false, false, false, true, true, true]);
  });

  it("renders a segment that finalizes without ever having been shown as a partial, with no diff", () => {
    const { result } = renderHook(({ segments }) => useTranscriptStability(segments), {
      initialProps: {
        segments: [seg({ text: "quick final", is_final: true })],
      },
    });
    expect(result.current.finalUnits).toEqual([
      { key: "inbound-1", text: "quick final", diff: null },
    ]);
  });

  it("is stable across an unrelated re-render with the exact same segments (no duplicate work)", () => {
    const segments = [seg({ text: "walk me through" })];
    const { result, rerender } = renderHook(
      ({ segments }) => useTranscriptStability(segments),
      { initialProps: { segments } },
    );
    const first = result.current;
    rerender({ segments });
    expect(result.current.liveConfirmed).toBe(first.liveConfirmed);
    expect(result.current.liveTentative).toBe(first.liveTentative);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/components/transcript/useTranscriptStability.test.ts`
Expected: FAIL — the module doesn't exist yet.

- [ ] **Step 3: Create `src/components/transcript/useTranscriptStability.ts`**

```ts
import { useRef } from "react";

import type { TranscriptSegment } from "@/lib/ipc";
import { segmentKey } from "@/lib/turns";
import {
  advanceConfirmed,
  diffWords,
  tentativeTail,
  type DiffWord,
} from "@/lib/transcriptStability";

interface StabilityEntry {
  confirmedPrefix: string;
  lastRaw: string | null;
  /** Guards `advanceConfirmed` specifically: it treats "lastRaw equals the
   *  current text" as a genuine second independent tick agreeing, so
   *  re-running it against its own just-written output (e.g. an unrelated
   *  re-render with identical segments) would wrongly fast-forward
   *  confirmation. Comparing against the raw text we last actually
   *  processed makes repeat invocations for the same text a no-op. */
  lastProcessedRaw: string | null;
  /** What was last shown on screen for this segment while it was still
   *  in-flight (confirmed + tentative, joined) — the baseline the one-time
   *  finalize diff compares against. Empty if this segment finalized
   *  without ever being shown as a partial first. */
  lastDisplayed: string;
}

export interface StabilityUnit {
  key: string;
  text: string;
  /** Non-null only when the true final text actually differs from what
   *  was last shown for this segment — almost always `null`, since the
   *  confirmed prefix already survived two decode passes. Recomputed fresh
   *  every render from two values that are frozen once a segment
   *  finalizes, so — unlike the in-flight advance step above — this needs
   *  no re-render guard; it's already idempotent by construction. */
  diff: DiffWord[] | null;
}

export interface StabilityResult {
  /** One entry per finalized segment in this turn, in order. */
  finalUnits: StabilityUnit[];
  /** The current in-flight segment's confirmed prefix (plain text) — empty
   *  if there's no segment currently streaming. */
  liveConfirmed: string;
  /** The current in-flight segment's still-unconfirmed tail (existing
   *  muted/tentative style) — empty once it exactly matches confirmed. */
  liveTentative: string;
}

/**
 * Turns one turn's raw segments into a stable rendering plan (F13 — see
 * docs/superpowers/specs/2026-08-21-transcript-stabilization-design.md).
 * Per-segment state (keyed by `segmentKey` — side+seq, so a new utterance
 * always starts fresh) is tracked across renders in a ref.
 */
export function useTranscriptStability(segments: TranscriptSegment[]): StabilityResult {
  const store = useRef(new Map<string, StabilityEntry>());
  const finalUnits: StabilityUnit[] = [];
  let liveConfirmed = "";
  let liveTentative = "";

  for (const seg of segments) {
    const key = segmentKey(seg);
    let entry = store.current.get(key);
    if (!entry) {
      entry = {
        confirmedPrefix: "",
        lastRaw: null,
        lastProcessedRaw: null,
        lastDisplayed: "",
      };
      store.current.set(key, entry);
    }

    if (seg.is_final) {
      const finalText = seg.text.trim();
      if (!finalText) continue;
      let diff: DiffWord[] | null = null;
      if (entry.lastDisplayed && entry.lastDisplayed !== finalText) {
        const d = diffWords(entry.lastDisplayed, finalText);
        if (d.some((w) => w.changed)) diff = d;
      }
      finalUnits.push({ key, text: finalText, diff });
    } else {
      const raw = seg.text.trim();
      if (!raw) continue;
      if (entry.lastProcessedRaw !== raw) {
        entry.confirmedPrefix = advanceConfirmed(entry.confirmedPrefix, entry.lastRaw, raw);
        entry.lastRaw = raw;
        entry.lastProcessedRaw = raw;
      }
      const tail = tentativeTail(entry.confirmedPrefix, raw);
      entry.lastDisplayed = [entry.confirmedPrefix, tail].filter(Boolean).join(" ");
      liveConfirmed = entry.confirmedPrefix;
      liveTentative = tail;
    }
  }

  return { finalUnits, liveConfirmed, liveTentative };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/components/transcript/useTranscriptStability.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add src/components/transcript/useTranscriptStability.ts src/components/transcript/useTranscriptStability.test.ts
git commit -m "feat(transcript): useTranscriptStability — the rendering-plan hook"
```

---

### Task 3: `ScrambleText` — the one-time correction animation

**Files:**
- Create: `src/components/transcript/ScrambleText.tsx`
- Test: Create `src/components/transcript/ScrambleText.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `src/components/transcript/ScrambleText.test.tsx`:

```tsx
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ScrambleText } from "@/components/transcript/ScrambleText";
import type { DiffWord } from "@/lib/transcriptStability";

afterEach(cleanup);

function words(...w: DiffWord[]): DiffWord[] {
  return w;
}

describe("ScrambleText", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders unchanged words plainly, immediately", () => {
    render(
      <ScrambleText
        words={words({ text: "walk", changed: false }, { text: "me", changed: false })}
      />,
    );
    expect(screen.getByText(/walk/)).toBeInTheDocument();
    expect(screen.getByText(/me/)).toBeInTheDocument();
  });

  it("does not show a changed word's real text immediately — it scrambles first", () => {
    render(<ScrambleText words={words({ text: "Terraform", changed: true })} />);
    expect(screen.queryByText("Terraform")).toBeNull();
  });

  it("settles on the real word after the scramble ticks finish", () => {
    render(<ScrambleText words={words({ text: "Terraform", changed: true })} />);
    vi.runAllTimers();
    expect(screen.getByText("Terraform")).toBeInTheDocument();
  });

  it("respects prefers-reduced-motion — shows the real word immediately, no scramble", () => {
    const matchMedia = vi.fn().mockReturnValue({ matches: true });
    vi.stubGlobal("matchMedia", matchMedia);
    render(<ScrambleText words={words({ text: "Terraform", changed: true })} />);
    expect(screen.getByText("Terraform")).toBeInTheDocument();
    vi.unstubAllGlobals();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/components/transcript/ScrambleText.test.tsx`
Expected: FAIL — the module doesn't exist yet.

- [ ] **Step 3: Create `src/components/transcript/ScrambleText.tsx`**

```tsx
import { useEffect, useState } from "react";

import type { DiffWord } from "@/lib/transcriptStability";

const SCRAMBLE_CHARS = "abcdefghijklmnopqrstuvwxyz";
const TICK_MS = 60;
const TICKS = 6; // ~360ms total — brief, doesn't hold up reading

function randomWord(length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) {
    out += SCRAMBLE_CHARS[Math.floor(Math.random() * SCRAMBLE_CHARS.length)];
  }
  return out;
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * Renders a word-level diff (`transcriptStability.ts`'s `diffWords`) — the
 * one-time visible correction when a segment's true final text differs
 * from whatever was last shown for it (F13, design doc §4.3). Unchanged
 * words render immediately; each `changed` word briefly cycles randomized
 * same-length characters before settling on the real word, so a whisper
 * correction reads as a visible, intentional fix rather than a silent snap.
 * Caller keys this component by the segment's own key — that's what makes
 * "plays once" free: React only mounts a fresh instance (and runs its mount
 * effect) the first time a given segment appears here.
 */
export function ScrambleText({ words }: { words: DiffWord[] }) {
  return (
    <>
      {words.map((w, i) => (
        <span key={i}>
          {i > 0 && " "}
          {w.changed ? <ScrambleWord word={w.text} /> : w.text}
        </span>
      ))}
    </>
  );
}

function ScrambleWord({ word }: { word: string }) {
  const [display, setDisplay] = useState(() =>
    prefersReducedMotion() ? word : randomWord(word.length),
  );

  useEffect(() => {
    if (prefersReducedMotion()) {
      setDisplay(word);
      return;
    }
    let tick = 0;
    const id = window.setInterval(() => {
      tick += 1;
      if (tick >= TICKS) {
        setDisplay(word);
        window.clearInterval(id);
      } else {
        setDisplay(randomWord(word.length));
      }
    }, TICK_MS);
    return () => window.clearInterval(id);
    // Mount-once: this component is keyed by its caller to one specific
    // finalized segment, and `word` is fixed for its whole lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <span>{display}</span>;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/components/transcript/ScrambleText.test.tsx`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/components/transcript/ScrambleText.tsx src/components/transcript/ScrambleText.test.tsx
git commit -m "feat(transcript): ScrambleText — the one-time word-correction animation"
```

---

### Task 4: Remove `FlowText`'s `"|"` separator

**Files:**
- Modify: `src/components/transcript/TranscriptView.tsx` — `FlowText`'s `units.map` (currently around line 652–683; find by content, not line number, since earlier tasks in this plan don't touch this file yet).

- [ ] **Step 1: Find and remove the separator block**

Find, inside `FlowText`'s `units.map`:

```tsx
          {i > 0 && (
            <span className="mx-1 font-bold text-ai/70 select-none" aria-hidden>
              |
            </span>
          )}
```

Delete this block entirely (the `<FanerAwareText .../>` and the trailing ask-button that follow it in the same `units.map` stay — only this separator goes).

- [ ] **Step 2: Build**

Run: `npx tsc -b`
Expected: PASS — this is a pure JSX deletion, no prop/type changes.

- [ ] **Step 3: Run the full test suite**

Run: `npx vitest run`
Expected: PASS — no existing test asserts on the `"|"` separator's presence.

- [ ] **Step 4: Commit**

```bash
git add src/components/transcript/TranscriptView.tsx
git commit -m "feat(transcript): remove the \"|\" separator between sentence-units"
```

---

### Task 5: Simplify `HighlightedText`'s RAG-term highlight

**Files:**
- Modify: `src/components/transcript/TranscriptView.tsx` — `HighlightedText`'s term-chip button (currently around line 324–336).

- [ ] **Step 1: Simplify the className**

Find:

```tsx
        className="rounded-[3px] bg-ai/15 px-0.5 font-semibold text-ai underline decoration-ai/50 decoration-dotted underline-offset-2 hover:bg-ai/25 hover:decoration-ai"
```

Replace with:

```tsx
        className="font-semibold text-ai underline decoration-2 underline-offset-2 hover:decoration-ai"
```

(Drops the background pill (`rounded-[3px] bg-ai/15`, `px-0.5`) and the dotted-underline decoration (`decoration-ai/50 decoration-dotted`, `hover:bg-ai/25`) — matches the plain bold+underline treatment `FanerMark`/`StarMark` already use elsewhere. Keeps the `text-ai` color and a hover state — `decoration-2` gives the underline enough weight to still read as interactive without a background, and `hover:decoration-ai` (the underline goes from default to the solid `ai` color on hover) is the new hover affordance in place of the removed background tint.)

- [ ] **Step 2: Build**

Run: `npx tsc -b`
Expected: PASS.

- [ ] **Step 3: Run the full test suite**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/transcript/TranscriptView.tsx
git commit -m "feat(transcript): simplify RAG-term highlight to plain bold+underline"
```

---

### Task 6: Wire `useTranscriptStability` into `Bubble`/`FlowText`

**Files:**
- Modify: `src/components/transcript/TranscriptView.tsx` — imports, `FlowText`'s prop type + rendering, `Bubble`'s `units`/`partialTail` computation and the JSX that renders them.

- [ ] **Step 1: Add imports**

Add alongside `TranscriptView.tsx`'s other `@/components`/`@/lib` imports:

```tsx
import {
  useTranscriptStability,
  type StabilityUnit,
} from "@/components/transcript/useTranscriptStability";
import { ScrambleText } from "@/components/transcript/ScrambleText";
```

- [ ] **Step 2: Change `FlowText`'s prop type and rendering**

Find `FlowText`'s current signature:

```tsx
function FlowText({
  units,
  terms,
  captures,
  onAskText,
  onAskTerm,
  onAskFaner,
  onSendToAsk,
}: {
  units: string[];
  terms: string[];
  /** FANER captures to mark inline (F11) — filtered/matched per-unit by
   *  `FanerAwareText`, not here. */
  captures: Capture[];
  onAskText: (t: string) => void;
  onAskTerm: (action: TermAction, term: string) => void;
  onAskFaner: (capture: Capture, phrase: string) => void;
  onSendToAsk: (text: string) => void;
}) {
  return (
    <span className="leading-snug">
      {units.map((unit, i) => (
        <span
          key={i}
          className="group/u rounded-[3px] px-0.5 transition-colors hover:bg-ai/10"
        >
          <FanerAwareText
            text={unit}
            captures={captures}
            terms={terms}
            onAskTerm={onAskTerm}
            onAskFaner={onAskFaner}
            onSendToAsk={onSendToAsk}
          />
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onAskText(unit);
            }}
            title="Ask Ally about this"
            aria-label="Ask Ally about this sentence"
            className="ml-0.5 inline-flex align-middle text-ai/70 opacity-0 transition-opacity hover:text-ai group-hover/u:opacity-100"
          >
            <Icon name="lightbulb" size={12} />
          </button>
        </span>
      ))}
    </span>
  );
}
```

(This is the file's state *after* Task 4 removed the `"|"` separator block — the rest is unchanged from before this plan.)

Replace with:

```tsx
function FlowText({
  units,
  terms,
  captures,
  onAskText,
  onAskTerm,
  onAskFaner,
  onSendToAsk,
}: {
  /** Stability-aware units (F13) — one per finalized segment in this turn,
   *  from `useTranscriptStability`. `diff` is non-null only for the rare
   *  case where the true final text corrected what was last shown. */
  units: StabilityUnit[];
  terms: string[];
  /** FANER captures to mark inline (F11) — filtered/matched per-unit by
   *  `FanerAwareText`, not here. */
  captures: Capture[];
  onAskText: (t: string) => void;
  onAskTerm: (action: TermAction, term: string) => void;
  onAskFaner: (capture: Capture, phrase: string) => void;
  onSendToAsk: (text: string) => void;
}) {
  return (
    <span className="leading-snug">
      {units.map((unit) => (
        <span
          key={unit.key}
          className="group/u rounded-[3px] px-0.5 transition-colors hover:bg-ai/10"
        >
          {unit.diff ? (
            <ScrambleText words={unit.diff} />
          ) : (
            <FanerAwareText
              text={unit.text}
              captures={captures}
              terms={terms}
              onAskTerm={onAskTerm}
              onAskFaner={onAskFaner}
              onSendToAsk={onSendToAsk}
            />
          )}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onAskText(unit.text);
            }}
            title="Ask Ally about this"
            aria-label="Ask Ally about this sentence"
            className="ml-0.5 inline-flex align-middle text-ai/70 opacity-0 transition-opacity hover:text-ai group-hover/u:opacity-100"
          >
            <Icon name="lightbulb" size={12} />
          </button>
        </span>
      ))}
    </span>
  );
}
```

- [ ] **Step 3: Replace `Bubble`'s `units`/`partialTail` computation**

Find, inside `Bubble`:

```tsx
  const inbound = segments[0]?.side === "inbound";
  const finals = segments.filter((s) => s.is_final);
  const hasFinal = finals.length > 0;
  const firstFinal = finals[0];
  const units = finals.map((s) => s.text.trim()).filter(Boolean);
  const combinedText = units.join(" ");
  const partialTail = segments
    .filter((s) => !s.is_final && s.text.trim())
    .map((s) => s.text.trim())
    .join(" ");
```

Replace with:

```tsx
  const inbound = segments[0]?.side === "inbound";
  const finals = segments.filter((s) => s.is_final);
  const hasFinal = finals.length > 0;
  const firstFinal = finals[0];
  const { finalUnits, liveConfirmed, liveTentative } = useTranscriptStability(segments);
  const combinedText = finalUnits.map((u) => u.text).join(" ");
```

(`units`/`partialTail` are gone — `finalUnits` and `liveConfirmed`/`liveTentative` replace them everywhere below. `combinedText` keeps its existing job — feeding `CollapsedPreview` and the RAG-term `analyzeTerms` call — just sourced from `finalUnits` now.)

- [ ] **Step 4: Update the JSX that renders them**

Find:

```tsx
        {collapsed ? (
          <CollapsedPreview text={combinedText} onExpand={onToggleCollapse} />
        ) : (
          <div className="min-w-0">
            {units.length > 0 && (
              <FlowText
                units={units}
                terms={highlightTerms}
                captures={captures}
                onAskText={onAskText}
                onAskTerm={onAskTerm}
                onAskFaner={onAskFaner}
                onSendToAsk={onSendToAsk}
              />
            )}
            {partialTail && (
              <span className="text-fg-muted">
                {units.length > 0 ? " " : ""}
                {partialTail}…
              </span>
            )}
            {units.length === 0 && !partialTail && (
              <span className="text-fg-muted">…</span>
            )}
```

Replace with:

```tsx
        {collapsed ? (
          <CollapsedPreview text={combinedText} onExpand={onToggleCollapse} />
        ) : (
          <div className="min-w-0">
            {finalUnits.length > 0 && (
              <FlowText
                units={finalUnits}
                terms={highlightTerms}
                captures={captures}
                onAskText={onAskText}
                onAskTerm={onAskTerm}
                onAskFaner={onAskFaner}
                onSendToAsk={onSendToAsk}
              />
            )}
            {/* The confirmed part of an in-flight segment reads as normal
                text — it already survived two independent decode passes
                (LocalAgreement-2) — only the short unconfirmed tail past it
                is muted/tentative (F13). */}
            {liveConfirmed && (
              <span>
                {finalUnits.length > 0 ? " " : ""}
                {liveConfirmed}
              </span>
            )}
            {liveTentative && (
              <span className="text-fg-muted">
                {finalUnits.length > 0 || liveConfirmed ? " " : ""}
                {liveTentative}…
              </span>
            )}
            {finalUnits.length === 0 && !liveConfirmed && !liveTentative && (
              <span className="text-fg-muted">…</span>
            )}
```

- [ ] **Step 5: Build + test**

Run: `npx tsc -b && npx vitest run`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/transcript/TranscriptView.tsx
git commit -m "feat(transcript): wire LocalAgreement-2 stabilization into Bubble/FlowText (F13)

Confirmed prefix of an in-flight segment now renders as normal text —
only the short unconfirmed tail past it is muted/tentative. The rare
case where the true final text corrects that tail animates via
ScrambleText instead of snapping silently."
```

---

### Task 7: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Full typecheck + build**

Run: `npm run build`
Expected: PASS (`tsc -b && vite build` succeeds with no errors).

- [ ] **Step 2: Full test suite**

Run: `npm test`
Expected: PASS — every suite, including the four new ones from this plan
(`transcriptStability.test.ts`, `useTranscriptStability.test.ts`,
`ScrambleText.test.tsx`) plus every pre-existing suite on this branch.

- [ ] **Step 3: Manual QA checklist (this repo can't run the Tauri shell in this sandbox — CI's Windows job and/or the owner's own machine is the real verification; use this checklist there)**

- Start a live call and speak a multi-sentence utterance slowly (with
  natural mid-sentence pauses) → confirm the words already spoken keep
  appearing in normal (non-muted) text, and only the last word or two — the
  part whisper hasn't confirmed twice yet — shows in the dimmer/tentative
  style.
- Watch closely for whether an *already-normal* (non-muted) word ever
  visibly changes while you're still speaking the rest of the sentence — it
  shouldn't; only the muted tail should ever update.
- After the utterance finishes and finalizes, watch for whether anything
  visibly "corrects" — most of the time nothing will (the confirmed prefix
  already matched); occasionally (background noise, an ambiguous word) the
  last word or two may briefly scramble-shuffle before settling — confirm
  that reads as an intentional correction, not a glitch.
- Confirm sentence-units within one bubble no longer show a `"|"` divider
  between them.
- Confirm a RAG-term highlight (an underlined term in the transcript) shows
  plain bold+underline — no background pill, no dotted underline.
- Confirm FANER marks and starred quotes (if the F12 PR has landed by the
  time this is tested) still render and behave normally on non-corrected
  units — this plan doesn't touch that logic, only routes around it for the
  rare corrected-unit case.

- [ ] **Step 4: Push**

```bash
git push -u origin claude/transcript-stabilization
```

(Retry up to 4 times with exponential backoff — 2s, 4s, 8s, 16s — only on a network failure. Then open a draft PR if one doesn't already exist for this branch, and confirm CI is green — in particular the Windows `Tauri shell` job, since this plan didn't touch Rust but the shell still needs to compile the frontend changes into the app.)

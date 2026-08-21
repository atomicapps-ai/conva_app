# Live-call right panel: collapse-by-default + starred-quote board (v1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** During a live call, collapse the right side panel by default; let the user star any Ask-Ally request tied to a transcript quote (marking the quote inline); show all starred cards as a board in a shared, collapsible/expandable right-panel shell that also hosts the existing Summary/Threads/Grounding dock.

**Architecture:** A new `RightPanelShell` owns collapse/expand chrome and a Starred/Dock mode switch; it mounts either a new `StarredBoard` (default during a live call) or the existing, unchanged `AllyMetaPanel`. Starring is computed by matching a starred card's remembered quote back into the transcript text it came from (mirrors the existing FANER inline-marking approach, at higher visual priority). All new state lives in `state/ally.ts`, pure matching logic in `src/lib/star.ts`. No Rust/IPC changes.

**Tech Stack:** React 19, TypeScript, Zustand, Tailwind 4, Vitest + @testing-library/react.

**Spec:** `docs/superpowers/specs/2026-08-21-live-panel-starred-board-design.md` — read it first; this plan implements it section by section and doesn't re-derive the reasoning behind each decision.

---

## Before you start

- Work on branch `claude/conva-rebrand-voc-overhaul-mhoddo` in `conva_app`.
- Run `npm run build` once before starting to confirm you're starting from a clean baseline (`tsc -b && vite build`).
- Every `npx vitest run <path>` command below assumes you're in the `conva_app` repo root.

## File Structure

| File | Responsibility |
|---|---|
| `src/components/ui/Icon.tsx` | Modify: add a `star` glyph + a `filled` render prop. |
| `src/state/ally.ts` | Modify: `starred`/`panelMode`/`panelCollapsed` state + actions; `request()` resolves the new card's id immediately; starred cards exempt from the rolling cards cap. |
| `src/state/ally.test.ts` | Create: tests for the above. |
| `src/lib/star.ts` | Create: `collectStarHits` — pure text-matching logic (mirrors `src/lib/faner.ts`). |
| `src/lib/star.test.ts` | Create: tests for `collectStarHits`. |
| `src/components/transcript/allyRender.tsx` | Create: `inlineMd`/`AnswerBody`/`splitReasoning`/`cardLabel`/`ReasoningBlock`, extracted verbatim out of `TranscriptView.tsx` so `StarredBoard.tsx` can reuse them without a circular import. |
| `src/components/transcript/TranscriptView.tsx` | Modify: import the extracted helpers; re-skin three "ask" buttons to a star icon; add `StarMark`; extend `FanerAwareText`/`FlowText`/`Bubble` to mark+star quotes; mount `RightPanelShell` in place of the direct `AllyMetaPanel` mount. |
| `src/components/transcript/StarredBoard.tsx` | Create: the starred-card board — the live-call default content of the shell. |
| `src/components/transcript/StarredBoard.test.tsx` | Create: tests for the above. |
| `src/components/transcript/RightPanelShell.tsx` | Create: collapse/expand chrome + mode switch + inert detach button. |
| `src/components/transcript/RightPanelShell.test.tsx` | Create: tests for the above. |

---

### Task 1: `star` icon + `filled` render prop

**Files:**
- Modify: `src/components/ui/Icon.tsx:12-57` (the `IconName` union), `:59-391` (`PATHS`), `:393-420` (the `Icon` function)
- Test: `src/components/ui/Icon.test.tsx`

- [ ] **Step 1: Write the failing test**

Add to `src/components/ui/Icon.test.tsx` (append inside the existing `describe("Icon", ...)` block, after the existing `it`):

```tsx
  it("renders the star icon outlined by default and filled when asked (F12)", () => {
    const { container, rerender } = render(<Icon name="star" />);
    const svg = container.querySelector("svg");
    expect(svg).toBeInTheDocument();
    expect(svg).toHaveAttribute("fill", "none");
    rerender(<Icon name="star" filled />);
    expect(container.querySelector("svg")).toHaveAttribute("fill", "currentColor");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/ui/Icon.test.tsx`
Expected: FAIL — `star` isn't a valid `IconName` yet (TypeScript/test error: no such icon).

- [ ] **Step 3: Add the icon name, path, and `filled` prop**

In `src/components/ui/Icon.tsx`, add `"star"` to the `IconName` union (after `"pause"`):

```ts
  | "rehearsal"
  | "pause"
  | "star";
```

Add the path to `PATHS`, right after the `rehearsal` entry (before the closing `};`):

```tsx
  // Star — a starred/marked quote (F12: Live panel redesign). Standard
  // 5-point outline so it reads correctly both outlined (the "star this"
  // button) and filled via the `filled` prop (a persisted "this is
  // starred" marker).
  star: (
    <path d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 21 12 17.77 5.82 21 7 14.14 2 9.27l6.91-1.01L12 2z" />
  ),
```

Add the `filled` prop to the `Icon` function:

```tsx
export function Icon({
  name,
  size = 20,
  className = "",
  strokeWidth = 1.6,
  filled = false,
}: {
  name: IconName;
  size?: number;
  className?: string;
  strokeWidth?: number;
  /** Render with a solid fill instead of the default outline (e.g. a
   *  starred marker vs. an unstarred "star this" button). */
  filled?: boolean;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/ui/Icon.test.tsx`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/Icon.tsx src/components/ui/Icon.test.tsx
git commit -m "feat(icon): add star glyph + filled render prop (F12)"
```

---

### Task 2: `state/ally.ts` — starred cards, panel state, non-blocking id return

**Files:**
- Modify: `src/state/ally.ts` (whole file — shown in full below)
- Test: Create `src/state/ally.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/state/ally.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/backend", () => ({
  getBackend: () => ({
    ally: { run: vi.fn().mockResolvedValue(undefined) },
  }),
}));

import { useAllyStore } from "@/state/ally";

function resetStore() {
  useAllyStore.setState({
    cards: [],
    busy: false,
    radar: null,
    tracker: null,
    capture: null,
    starred: new Set(),
    panelMode: "dock",
    panelCollapsed: false,
  });
}

/** Ask a question and immediately mark it done, like a real chunk stream
 *  eventually would via `applyChunk` — needed so `busy` resets between
 *  back-to-back asks in a single test. */
async function ask(question: string): Promise<string> {
  const id = await useAllyStore.getState().request("question", question);
  useAllyStore.getState().applyChunk({ request_id: id, token: "answer", done: true, error: null });
  return id;
}

describe("useAllyStore", () => {
  beforeEach(resetStore);

  it("request() resolves with the new card's id immediately, before the answer streams in", async () => {
    const id = await useAllyStore.getState().request("question", "hi");
    expect(id).toMatch(/^ally-/);
    expect(useAllyStore.getState().cards[0]?.id).toBe(id);
    // Not yet done — the fake backend's `run()` resolving doesn't itself
    // mark the card done; that only happens via a later `applyChunk`.
    expect(useAllyStore.getState().cards[0]?.done).toBe(false);
  });

  it("star/unstar/toggleStar update the starred set", async () => {
    const id = await ask("hi");
    useAllyStore.getState().star(id);
    expect(useAllyStore.getState().starred.has(id)).toBe(true);
    useAllyStore.getState().unstar(id);
    expect(useAllyStore.getState().starred.has(id)).toBe(false);
    useAllyStore.getState().toggleStar(id);
    expect(useAllyStore.getState().starred.has(id)).toBe(true);
    useAllyStore.getState().toggleStar(id);
    expect(useAllyStore.getState().starred.has(id)).toBe(false);
  });

  it("keeps every starred card even past the 5-unstarred rolling cap", async () => {
    const firstId = await ask("q0");
    useAllyStore.getState().star(firstId);
    for (let i = 1; i <= 6; i++) {
      await ask(`q${i}`);
    }
    const ids = useAllyStore.getState().cards.map((c) => c.id);
    expect(ids).toContain(firstId);
  });

  it("still caps unstarred cards at 6 total (newest + 5)", async () => {
    for (let i = 0; i < 8; i++) {
      await ask(`q${i}`);
    }
    expect(useAllyStore.getState().cards).toHaveLength(6);
  });

  it("setPanelMode/setPanelCollapsed update the panel state", () => {
    useAllyStore.getState().setPanelMode("starred");
    expect(useAllyStore.getState().panelMode).toBe("starred");
    useAllyStore.getState().setPanelCollapsed(true);
    expect(useAllyStore.getState().panelCollapsed).toBe(true);
  });

  it("clear() also clears starred", async () => {
    const id = await ask("hi");
    useAllyStore.getState().star(id);
    useAllyStore.getState().clear();
    expect(useAllyStore.getState().starred.size).toBe(0);
    expect(useAllyStore.getState().cards).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/state/ally.test.ts`
Expected: FAIL — `starred`/`panelMode`/`panelCollapsed`/`star`/`unstar`/`toggleStar`/`setPanelMode`/`setPanelCollapsed` don't exist yet, and `request()` currently resolves `void`, not an id.

- [ ] **Step 3: Rewrite `src/state/ally.ts`**

Replace the whole file with:

```ts
import { create } from "zustand";

import { getBackend } from "@/lib/backend";
import type {
  AllyChunkEvent,
  AllyKind,
  AllySource,
  AllySourcesEvent,
  CaptureEvent,
  RadarEvent,
  TrackerEvent,
} from "@/lib/ipc";
import { useTranscriptStore } from "@/state/transcript";

export interface AllyCard {
  id: string;
  /** Stable per-conversation number → the "A1/A2/A3" identity shared by the
   *  spine node, the card badge, and the bubble's "Linked to A#" chip. */
  seq: number;
  kind: AllyKind;
  question: string | null;
  text: string;
  done: boolean;
  error: string | null;
  sources: AllySource[];
  startedAtMs: number;
  /** Transcript bubble this answer researches (`"<side>-<seq>"`), if any —
   *  drives the connector line from the Ally column back to the bubble. */
  sourceKey: string | null;
  /** Short quote of the researched bubble, shown on the card. */
  sourceQuote: string | null;
}

/** Which content the live-call right panel shows by default (F12 — Live
 *  panel redesign, see docs/superpowers/specs/2026-08-21-live-panel-starred-
 *  board-design.md). `"starred"` is the board of starred cards; `"dock"` is
 *  the existing Summary/Threads/Grounding panel (`AllyMetaPanel`,
 *  unchanged). */
export type PanelMode = "starred" | "dock";

interface AllyState {
  cards: AllyCard[];
  busy: boolean;
  /** Latest Question Radar hit (§6.2); replaced by each new question. */
  radar: RadarEvent | null;
  /** Cumulative session tracker state (§6.3). */
  tracker: TrackerEvent | null;
  /** Cumulative FANER routed captures for the session (F11). */
  capture: CaptureEvent | null;
  /** Card ids the user has starred (F12). Starred cards are exempt from
   *  `cards`' rolling cap — see `request` below — so a board built over a
   *  long call never silently loses an entry once more questions get asked. */
  starred: Set<string>;
  /** Which content `RightPanelShell` shows by default. */
  panelMode: PanelMode;
  /** Right panel collapsed state — defaults to collapsed on entering a live
   *  call (F12 goal 1). */
  panelCollapsed: boolean;

  /** Kick off an Ally request. Resolves with the new card's id as soon as
   *  the card is created — NOT once the answer finishes streaming — so a
   *  caller can star it immediately; the loading state a starred card shows
   *  on the board comes from that early resolution, not from waiting for
   *  the backend call to finish. */
  request: (
    kind: AllyKind,
    question?: string,
    source?: { key: string; quote: string },
  ) => Promise<string>;
  applyChunk: (chunk: AllyChunkEvent) => void;
  applySources: (event: AllySourcesEvent) => void;
  applyRadar: (event: RadarEvent) => void;
  applyTracker: (event: TrackerEvent) => void;
  applyCapture: (event: CaptureEvent) => void;
  dismissRadar: () => void;
  clear: () => void;
  star: (id: string) => void;
  unstar: (id: string) => void;
  toggleStar: (id: string) => void;
  setPanelMode: (mode: PanelMode) => void;
  setPanelCollapsed: (collapsed: boolean) => void;
}

let counter = 0;

export const useAllyStore = create<AllyState>((set, get) => ({
  cards: [],
  busy: false,
  radar: null,
  tracker: null,
  capture: null,
  starred: new Set(),
  panelMode: "dock",
  panelCollapsed: false,

  request: async (kind, question, source) => {
    if (get().busy) return "";
    counter += 1;
    const id = `ally-${Date.now()}-${counter}`;
    const newCard: AllyCard = {
      id,
      seq: counter,
      kind,
      question: question ?? null,
      text: "",
      done: false,
      error: null,
      sources: [],
      startedAtMs: Date.now(),
      sourceKey: source?.key ?? null,
      sourceQuote: source?.quote ?? null,
    };
    set((s) => {
      // Keep every starred card regardless of age, plus the 5 most recent
      // UNstarred ones — otherwise a card the user starred early in a long
      // call would silently fall off this rolling window the moment 6 more
      // questions get asked, and vanish from their board.
      let keptUnstarred = 0;
      const survivors = s.cards.filter((c) => {
        if (s.starred.has(c.id)) return true;
        if (keptUnstarred < 5) {
          keptUnstarred += 1;
          return true;
        }
        return false;
      });
      return { busy: true, cards: [newCard, ...survivors] };
    });
    // Fire the backend call without blocking the id returned below — a
    // caller that wants to star this card right away (F12) needs the id as
    // soon as the card exists, not once the whole answer has streamed in.
    void (async () => {
      try {
        const t = useTranscriptStore.getState();
        await getBackend().ally.run(id, kind, question ?? null, [
          ...t.archived,
          ...t.segments,
        ]);
      } catch (e) {
        set((s) => ({
          busy: false,
          cards: s.cards.map((c) =>
            c.id === id ? { ...c, done: true, error: String(e) } : c,
          ),
        }));
      }
    })();
    return id;
  },

  applyChunk: (chunk) =>
    set((s) => ({
      busy: chunk.done ? false : s.busy,
      cards: s.cards.map((c) =>
        c.id === chunk.request_id
          ? {
              ...c,
              text: c.text + chunk.token,
              done: chunk.done,
              error: chunk.error,
            }
          : c,
      ),
    })),

  applySources: (event) =>
    set((s) => ({
      cards: s.cards.map((c) =>
        c.id === event.request_id ? { ...c, sources: event.sources } : c,
      ),
    })),

  applyRadar: (event) => set({ radar: event }),

  applyTracker: (event) => set({ tracker: event }),
  applyCapture: (event) => set({ capture: event }),

  dismissRadar: () => set({ radar: null }),

  clear: () => {
    // Reset the A# counter so each conversation numbers from A1.
    counter = 0;
    set({ cards: [], radar: null, tracker: null, capture: null, starred: new Set() });
  },

  star: (id) => set((s) => ({ starred: new Set(s.starred).add(id) })),
  unstar: (id) =>
    set((s) => {
      const next = new Set(s.starred);
      next.delete(id);
      return { starred: next };
    }),
  toggleStar: (id) =>
    set((s) => {
      const next = new Set(s.starred);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { starred: next };
    }),
  setPanelMode: (mode) => set({ panelMode: mode }),
  setPanelCollapsed: (collapsed) => set({ panelCollapsed: collapsed }),
}));
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/state/ally.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Typecheck the whole project**

`request`'s return type changed from `Promise<void>` to `Promise<string>` — every existing call site uses `void request(...)` (discarding the value), which stays valid, but confirm nothing else assumed `void`.

Run: `npx tsc -b`
Expected: no new errors. (If this surfaces a call site assigning `request(...)`'s result to something typed `void`, fix it there — but no such call site exists as of this plan being written; `TranscriptView.tsx`, `AllyMetaPanel`, `ThreadViewer`, and `InlineAllyCard` all use `void request(...)`.)

- [ ] **Step 6: Commit**

```bash
git add src/state/ally.ts src/state/ally.test.ts
git commit -m "feat(ally): starred cards + panel mode/collapse state (F12)

request() now resolves with the new card's id immediately (before the
answer streams in) instead of void, so a caller can star a card the
moment it's created. Starred cards are exempt from the existing
6-card rolling cap so a board built over a long call can't silently
lose an entry."
```

---

### Task 3: `src/lib/star.ts` — match a starred quote back into transcript text

**Files:**
- Create: `src/lib/star.ts`
- Test: Create `src/lib/star.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/star.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import type { AllyCard } from "@/state/ally";
import { collectStarHits } from "@/lib/star";

function card(overrides: Partial<AllyCard> = {}): AllyCard {
  return {
    id: "c1",
    seq: 1,
    kind: "question",
    question: null,
    text: "",
    done: true,
    error: null,
    sources: [],
    startedAtMs: 0,
    sourceKey: "them-1",
    sourceQuote: "Terraform state locking",
    ...overrides,
  };
}

describe("collectStarHits", () => {
  it("matches a starred card's quote found in the same turn's text", () => {
    const c = card();
    const hits = collectStarHits(
      "Walk me through Terraform state locking with a team.",
      "them-1",
      [c],
      new Set([c.id]),
    );
    expect(hits).toHaveLength(1);
    expect(hits[0]?.phrase).toBe("Terraform state locking");
    expect(hits[0]?.card.id).toBe("c1");
  });

  it("ignores a card that isn't starred", () => {
    const c = card();
    const hits = collectStarHits("Terraform state locking again", "them-1", [c], new Set());
    expect(hits).toHaveLength(0);
  });

  it("ignores a starred card from a different turn", () => {
    const c = card({ sourceKey: "them-2" });
    const hits = collectStarHits(
      "Terraform state locking again",
      "them-1",
      [c],
      new Set([c.id]),
    );
    expect(hits).toHaveLength(0);
  });

  it("ignores a starred card with no quote (a whole-turn or freeform ask)", () => {
    const c = card({ sourceQuote: null });
    const hits = collectStarHits("anything", "them-1", [c], new Set([c.id]));
    expect(hits).toHaveLength(0);
  });

  it("does not match the quote mid-word", () => {
    const c = card({ sourceQuote: "REST" });
    const hits = collectStarHits(
      "I'm interested in how you scaled the backend.",
      "them-1",
      [c],
      new Set([c.id]),
    );
    expect(hits).toHaveLength(0);
  });

  it("short-circuits when nothing is starred", () => {
    expect(collectStarHits("any text", "them-1", [card()], new Set())).toEqual([]);
  });

  it("sorts longest phrase first when two starred quotes nest", () => {
    const short = card({ id: "c-short", sourceQuote: "state" });
    const long = card({ id: "c-long", sourceQuote: "Terraform state locking" });
    const hits = collectStarHits(
      "Terraform state locking is tricky",
      "them-1",
      [short, long],
      new Set(["c-short", "c-long"]),
    );
    expect(hits[0]?.phrase).toBe("Terraform state locking");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/star.test.ts`
Expected: FAIL — `src/lib/star.ts` doesn't exist yet.

- [ ] **Step 3: Create `src/lib/star.ts`**

```ts
import type { AllyCard } from "@/state/ally";
import { isFanerBoundaryMatch } from "@/lib/faner";

/**
 * Matches a starred card's remembered quote back into the transcript text
 * it was asked from (F12 — Live panel redesign; see
 * docs/superpowers/specs/2026-08-21-live-panel-starred-board-design.md §5–§6).
 * Mirrors `collectFanerHits` in `faner.ts`, but matches an exact remembered
 * quote rather than a fuzzy jargon argument — a starred card already knows
 * the literal text the user asked about, so there's no paraphrase risk to
 * guard against the way FANER's `question`-trigger captures have.
 */
export interface StarHit {
  phrase: string;
  card: AllyCard;
}

/** Case-insensitive search for `phraseLower` in `lower` that skips past any
 *  mid-word false positive and only returns a word-boundary-safe occurrence
 *  (or -1 if none exists). A deliberate near-duplicate of the private
 *  helper of the same name in `faner.ts` rather than an import from it:
 *  FANER's own capture-routing logic is developed independently elsewhere
 *  in this codebase, so this module's only dependency on it is the already
 *  -exported, stable `isFanerBoundaryMatch` — kept small to avoid coupling
 *  to code that changes on its own schedule. */
function findBoundedIndex(lower: string, phraseLower: string): number {
  let from = 0;
  for (;;) {
    const idx = lower.indexOf(phraseLower, from);
    if (idx === -1) return -1;
    if (isFanerBoundaryMatch(lower, idx, phraseLower.length)) return idx;
    from = idx + 1;
  }
}

/**
 * Every starred card tied to `turnKey` whose `sourceQuote` appears in
 * `text` at a real word boundary, longest phrase first (same "longer match
 * wins" rule `collectFanerHits` uses, in case two starred quotes nest).
 */
export function collectStarHits(
  text: string,
  turnKey: string,
  cards: AllyCard[],
  starred: Set<string>,
): StarHit[] {
  if (starred.size === 0) return [];
  const lower = text.toLowerCase();
  const hits: StarHit[] = [];
  for (const c of cards) {
    if (!starred.has(c.id)) continue;
    if (c.sourceKey !== turnKey) continue;
    const quote = (c.sourceQuote ?? "").trim();
    if (quote.length < 3) continue;
    if (findBoundedIndex(lower, quote.toLowerCase()) !== -1) {
      hits.push({ phrase: quote, card: c });
    }
  }
  return hits.sort((a, b) => b.phrase.length - a.phrase.length);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/star.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/star.ts src/lib/star.test.ts
git commit -m "feat(star): collectStarHits — match a starred quote back into transcript text"
```

---

### Task 4: Extract shared Ally-answer rendering into `allyRender.tsx`

Done now, ahead of creating `StarredBoard.tsx`, so that new file can reuse this rendering without a circular import between it and `TranscriptView.tsx` (which will need to import `StarredBoard`).

**Files:**
- Create: `src/components/transcript/allyRender.tsx`
- Modify: `src/components/transcript/TranscriptView.tsx:82-189` (remove the five functions below; import them instead)

- [ ] **Step 1: Create `src/components/transcript/allyRender.tsx`**

Move `inlineMd`, `AnswerBody`, `splitReasoning`, `cardLabel`, and `ReasoningBlock` out of `TranscriptView.tsx` verbatim (only change: add `export` to each), so `StarredBoard.tsx` (Task 9) can render an Ally answer identically to how `ThreadViewer`/`InlineAllyCard` already do, without importing anything from `TranscriptView.tsx` itself:

```tsx
import { useState, type ReactNode } from "react";

import { Icon } from "@/components/ui/Icon";
import type { AllyCard } from "@/state/ally";
import { useUiPrefs } from "@/state/uiPrefs";

/** Inline **bold** → <strong>; everything else passes through. Keeps Ally's
 *  call-ready answers scannable without a full markdown dependency. */
export function inlineMd(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*(.+?)\*\*/g;
  let last = 0;
  let k = 0;
  for (let m = re.exec(text); m !== null; m = re.exec(text)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(
      <strong key={`b${k++}`} className="font-semibold text-fg">
        {m[1]}
      </strong>,
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Minimal markdown for Ally answers: bullet lists, ### headings, **bold**,
 *  paragraphs — enough for fast, scannable, call-ready output. */
export function AnswerBody({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let bullets: string[] = [];
  let key = 0;
  const flushBullets = () => {
    if (bullets.length === 0) return;
    const items = bullets;
    bullets = [];
    blocks.push(
      <ul key={`u${key++}`} className="ml-4 list-disc space-y-1">
        {items.map((b, i) => (
          <li key={i}>{inlineMd(b)}</li>
        ))}
      </ul>,
    );
  };
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    const heading = line.match(/^#{1,4}\s+(.*)$/);
    if (bullet) {
      bullets.push(bullet[1] ?? "");
      continue;
    }
    flushBullets();
    if (heading) {
      blocks.push(
        <p key={`h${key++}`} className="font-bold text-fg">
          {inlineMd(heading[1] ?? "")}
        </p>,
      );
    } else if (line.trim() !== "") {
      blocks.push(<p key={`p${key++}`}>{inlineMd(line)}</p>);
    }
  }
  flushBullets();
  return <div className="flex flex-col gap-1.5">{blocks}</div>;
}

/** Split an Ally answer into the at-a-glance part and the optional context that
 *  follows a `---` line (the prompt asks Ally to separate them this way). */
export function splitReasoning(text: string): { answer: string; context: string } {
  const m = text.match(/\n[ \t]*-{3,}[ \t]*(?:\n|$)/);
  if (!m || m.index === undefined) return { answer: text, context: "" };
  return {
    answer: text.slice(0, m.index).trim(),
    context: text.slice(m.index + m[0].length).trim(),
  };
}

/** Collapsible "reasoning" region — default collapsed; keeps deeper context out
 *  of the way during a call but one tap away. */
export function ReasoningBlock({ text }: { text: string }) {
  const defaultOpen = useUiPrefs((s) => s.reasoningDefaultOpen);
  const [open, setOpen] = useState(defaultOpen);
  if (!text.trim()) return null;
  return (
    <div className="rounded-md border border-border/70 bg-bg/30">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-fg-faint transition-colors hover:text-fg-muted"
      >
        <Icon name="reasoning" size={13} />
        Reasoning
        <Icon
          name="chevron"
          size={12}
          className={`ml-auto transition-transform ${open ? "" : "-rotate-90"}`}
        />
      </button>
      {open && (
        <div className="border-t border-border/70 px-2.5 py-2 text-[12px] text-fg-muted">
          <AnswerBody text={text} />
        </div>
      )}
    </div>
  );
}

export function cardLabel(card: AllyCard): string {
  if (card.kind === "suggest_reply") return "Suggested reply";
  if (card.kind === "summarize") return "Summary";
  return card.sourceQuote ? "Research" : "Answer";
}
```

- [ ] **Step 2: Remove the five functions from `TranscriptView.tsx`, import them instead**

Delete lines 82–189 of `TranscriptView.tsx` (the `inlineMd`, `AnswerBody`, `splitReasoning`, `ReasoningBlock`, `cardLabel` function definitions — everything between the `researchPrompt` function and the `TERM_ACTIONS` constant).

Add this import near the top of `TranscriptView.tsx`, alongside the other `@/components`/`@/lib` imports:

```tsx
import {
  AnswerBody,
  cardLabel,
  ReasoningBlock,
  splitReasoning,
} from "@/components/transcript/allyRender";
```

- [ ] **Step 3: Confirm nothing else in `TranscriptView.tsx` broke**

`ThreadViewer`, `InlineAllyCard`, and `ThreadRow` all call `cardLabel`/`splitReasoning`/`AnswerBody`/`ReasoningBlock` — with the import in place they resolve exactly as before (same functions, same behavior, just relocated).

Run: `npx tsc -b`
Expected: no errors — in particular, no "cannot find name" for any of the four names inside `TranscriptView.tsx`.

- [ ] **Step 4: Run the full test suite to confirm nothing regressed**

Run: `npx vitest run`
Expected: PASS — all existing suites (`faner.test.ts`, `Icon.test.tsx`, `SimConSetup.test.tsx`, contexts tests, plus the new ones from Tasks 1–3) still pass. This is a pure relocation; no test should need updating.

- [ ] **Step 5: Commit**

```bash
git add src/components/transcript/allyRender.tsx src/components/transcript/TranscriptView.tsx
git commit -m "refactor(transcript): extract Ally-answer rendering into allyRender.tsx

Pure move (inlineMd/AnswerBody/splitReasoning/cardLabel/ReasoningBlock),
no behavior change — makes the rendering reusable from StarredBoard.tsx
without a circular import back into TranscriptView.tsx."
```

---

### Task 5: Re-skin the three "ask a quote" buttons to a star icon

These three buttons (`FanerMark`'s popover, `SelectionMenu`, `FlowText`'s per-sentence lightbulb) already do exactly what F12 calls "starring" — asking Ally about a specific quote. Task 8 wires the actual starring; this task just re-skins the icon/copy so the UI already reads correctly once that lands. No prop/signature changes in this task — purely icon name + title/aria-label text.

**Files:**
- Modify: `src/components/transcript/TranscriptView.tsx` — three small edits inside `FanerMark`, `SelectionMenu`, and `FlowText`.

- [ ] **Step 1: `FanerMark`'s popover — lightbulb → star**

Find (inside `FanerMark`, in its popover's icon row):

```tsx
          <button
            type="button"
            title="Ask Ally about this"
            aria-label={`Ask Ally about "${phrase}"`}
            onClick={() => onAsk(capture, phrase)}
            className="rounded p-1 text-ai/80 transition-colors hover:bg-ai/10 hover:text-ai"
          >
            <Icon name="lightbulb" size={14} />
          </button>
```

Replace with:

```tsx
          <button
            type="button"
            title="Ask Ally about this — stars it for your board"
            aria-label={`Ask Ally about "${phrase}" and star it`}
            onClick={() => onAsk(capture, phrase)}
            className="rounded p-1 text-ai/80 transition-colors hover:bg-ai/10 hover:text-ai"
          >
            <Icon name="star" size={14} />
          </button>
```

- [ ] **Step 2: `SelectionMenu` — lightbulb → star**

Find:

```tsx
      <button
        type="button"
        title="Ask Ally about this"
        aria-label="Ask Ally about the selection"
        onClick={() => {
          onAsk(text);
          onClose();
        }}
        className="rounded p-1.5 text-ai/80 transition-colors hover:bg-ai/10 hover:text-ai"
      >
        <Icon name="lightbulb" size={15} />
      </button>
```

Replace with:

```tsx
      <button
        type="button"
        title="Ask Ally about this — stars it for your board"
        aria-label="Ask Ally about the selection and star it"
        onClick={() => {
          onAsk(text);
          onClose();
        }}
        className="rounded p-1.5 text-ai/80 transition-colors hover:bg-ai/10 hover:text-ai"
      >
        <Icon name="star" size={15} />
      </button>
```

- [ ] **Step 3: `FlowText`'s per-sentence lightbulb — lightbulb → star**

Find (inside `FlowText`'s `units.map`):

```tsx
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
```

Replace with:

```tsx
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onAskText(unit);
            }}
            title="Ask Ally about this sentence — stars it for your board"
            aria-label="Ask Ally about this sentence and star it"
            className="ml-0.5 inline-flex align-middle text-ai/70 opacity-0 transition-opacity hover:text-ai group-hover/u:opacity-100"
          >
            <Icon name="star" size={12} />
          </button>
```

- [ ] **Step 4: Build + test**

Run: `npx tsc -b && npx vitest run`
Expected: PASS — this task only changes an icon name and strings, not props or logic.

- [ ] **Step 5: Commit**

```bash
git add src/components/transcript/TranscriptView.tsx
git commit -m "feat(transcript): re-skin the three ask-about-a-quote buttons as a star (F12)"
```

---

### Task 6: `StarMark` component

**Files:**
- Modify: `src/components/transcript/TranscriptView.tsx` — add a new component right after `FanerMark`'s closing brace, before `FanerAwareText`.

- [ ] **Step 1: Add `StarMark`**

Insert immediately after `FanerMark`'s closing `}` (right before the `/** Splits \`text\` between FANER-marked spans... */` doc comment that precedes `FanerAwareText`):

```tsx
/** A starred quote's persistent "this is on your board" marker (F12 — Live
 *  panel redesign). Uses the Ally accent, not one of FANER's per-action
 *  colors — starring is a user-initiated mark and needs to read as
 *  distinct from FANER's automatic routing (design doc §5). Unlike
 *  `FanerMark` there's no hover popover: the phrase already has a card
 *  (open it from the Starred board or a thread list for more); the only
 *  control is the filled star suffix, which unstars on click. */
function StarMark({
  phrase,
  cardId,
  onToggleStar,
}: {
  phrase: string;
  cardId: string;
  onToggleStar: (cardId: string) => void;
}) {
  return (
    <span className="text-ai">
      <span className="underline decoration-2 underline-offset-2 font-semibold">
        {phrase}
      </span>
      <button
        type="button"
        onClick={() => onToggleStar(cardId)}
        title="Starred — click to remove from your board"
        aria-label={`Remove "${phrase}" from your board`}
        className="ml-0.5 inline-flex -translate-y-px align-middle transition-opacity hover:opacity-70"
      >
        <Icon name="star" size={11} filled />
      </button>
    </span>
  );
}
```

- [ ] **Step 2: Build**

Run: `npx tsc -b`
Expected: PASS. (`StarMark` isn't called from anywhere yet — Task 7 wires it in — so this step only confirms it compiles standalone; an unused-function lint may flag it until Task 7, which is fine since it's used in the very next task.)

- [ ] **Step 3: Commit**

```bash
git add src/components/transcript/TranscriptView.tsx
git commit -m "feat(transcript): add StarMark — the persistent starred-quote marker (F12)"
```

---

### Task 7: Extend `FanerAwareText` with star-hit priority

**Files:**
- Modify: `src/components/transcript/TranscriptView.tsx` — the `FanerAwareText` function, plus its imports.

- [ ] **Step 1: Add the import**

Add to the existing `@/lib/faner` import block's neighbors (near the top of the file):

```tsx
import { collectStarHits } from "@/lib/star";
```

- [ ] **Step 2: Rewrite `FanerAwareText`**

Find the whole `FanerAwareText` function:

```tsx
function FanerAwareText({
  text,
  captures,
  terms,
  onAskTerm,
  onAskFaner,
  onSendToAsk,
}: {
  text: string;
  captures: Capture[];
  terms: string[];
  onAskTerm: (action: TermAction, term: string) => void;
  onAskFaner: (capture: Capture, phrase: string) => void;
  onSendToAsk: (text: string) => void;
}) {
  const hits = useMemo(() => collectFanerHits(text, captures), [text, captures]);
  if (hits.length === 0) return <HighlightedText text={text} terms={terms} onAsk={onAskTerm} />;

  const lower = text.toLowerCase();
  const nodes: ReactNode[] = [];
  let plainStart = 0;
  let key = 0;
  const flushPlain = (end: number) => {
    if (end > plainStart) {
      nodes.push(
        <HighlightedText
          key={`p${key++}`}
          text={text.slice(plainStart, end)}
          terms={terms}
          onAsk={onAskTerm}
        />,
      );
    }
  };
  let i = 0;
  outer: while (i < text.length) {
    for (const h of hits) {
      const p = h.phrase.toLowerCase();
      // `collectFanerHits` only proves the phrase appears *somewhere* at a
      // real word boundary; re-check the boundary here too, since this scan
      // finds every raw substring occurrence and a phrase can have both
      // valid (whole-word) and invalid (mid-word) occurrences in the same
      // text — only the valid ones should render as a mark.
      if (p && lower.startsWith(p, i) && isFanerBoundaryMatch(lower, i, p.length)) {
        flushPlain(i);
        nodes.push(
          <FanerMark
            key={`f${key++}`}
            hit={h}
            onAsk={onAskFaner}
            onSendToAsk={onSendToAsk}
          />,
        );
        i += h.phrase.length;
        plainStart = i;
        continue outer;
      }
    }
    i += 1;
  }
  flushPlain(text.length);
  return <>{nodes}</>;
}
```

Replace it with:

```tsx
function FanerAwareText({
  text,
  captures,
  terms,
  onAskTerm,
  onAskFaner,
  onSendToAsk,
  turnKey,
  allCards,
  starred,
  onToggleStar,
}: {
  text: string;
  captures: Capture[];
  terms: string[];
  onAskTerm: (action: TermAction, term: string) => void;
  onAskFaner: (capture: Capture, phrase: string) => void;
  onSendToAsk: (text: string) => void;
  /** This unit's turn key — starred quotes only mark within the turn they
   *  were asked from (F12; see `collectStarHits`). */
  turnKey: string;
  allCards: AllyCard[];
  starred: Set<string>;
  onToggleStar: (cardId: string) => void;
}) {
  const hits = useMemo(() => collectFanerHits(text, captures), [text, captures]);
  const starHits = useMemo(
    () => collectStarHits(text, turnKey, allCards, starred),
    [text, turnKey, allCards, starred],
  );
  if (hits.length === 0 && starHits.length === 0) {
    return <HighlightedText text={text} terms={terms} onAsk={onAskTerm} />;
  }

  const lower = text.toLowerCase();
  const nodes: ReactNode[] = [];
  let plainStart = 0;
  let key = 0;
  const flushPlain = (end: number) => {
    if (end > plainStart) {
      nodes.push(
        <HighlightedText
          key={`p${key++}`}
          text={text.slice(plainStart, end)}
          terms={terms}
          onAsk={onAskTerm}
        />,
      );
    }
  };
  let i = 0;
  outer: while (i < text.length) {
    // Starred quotes take priority over a FANER mark at the same position —
    // starring is the stronger, user-initiated signal (design doc §5).
    for (const h of starHits) {
      const p = h.phrase.toLowerCase();
      if (p && lower.startsWith(p, i) && isFanerBoundaryMatch(lower, i, p.length)) {
        flushPlain(i);
        nodes.push(
          <StarMark
            key={`s${key++}`}
            phrase={h.phrase}
            cardId={h.card.id}
            onToggleStar={onToggleStar}
          />,
        );
        i += h.phrase.length;
        plainStart = i;
        continue outer;
      }
    }
    for (const h of hits) {
      const p = h.phrase.toLowerCase();
      // `collectFanerHits` only proves the phrase appears *somewhere* at a
      // real word boundary; re-check the boundary here too, since this scan
      // finds every raw substring occurrence and a phrase can have both
      // valid (whole-word) and invalid (mid-word) occurrences in the same
      // text — only the valid ones should render as a mark.
      if (p && lower.startsWith(p, i) && isFanerBoundaryMatch(lower, i, p.length)) {
        flushPlain(i);
        nodes.push(
          <FanerMark
            key={`f${key++}`}
            hit={h}
            onAsk={onAskFaner}
            onSendToAsk={onSendToAsk}
          />,
        );
        i += h.phrase.length;
        plainStart = i;
        continue outer;
      }
    }
    i += 1;
  }
  flushPlain(text.length);
  return <>{nodes}</>;
}
```

- [ ] **Step 3: Build**

Run: `npx tsc -b`
Expected: FAIL at this point — `FanerAwareText`'s new required props (`turnKey`, `allCards`, `starred`, `onToggleStar`) aren't passed by its one caller (`FlowText`) yet. That's expected; Task 8 fixes it. Confirm the error is exactly a missing-props error on the `<FanerAwareText .../>` call site inside `FlowText`, not something else.

- [ ] **Step 4: Commit**

```bash
git add src/components/transcript/TranscriptView.tsx
git commit -m "feat(transcript): FanerAwareText marks starred quotes ahead of FANER marks (F12)

Not yet wired end-to-end — FlowText's call site is updated in the next
commit. tsc will show a missing-props error on FanerAwareText's one
caller until then; expected mid-refactor state."
```

---

### Task 8: Thread star props through `FlowText`/`Bubble`; bind + wire starring

**Files:**
- Modify: `src/components/transcript/TranscriptView.tsx` — `FlowText`, `Bubble`, `askText`/`askFaner`, and the `<Bubble .../>` render call site.

- [ ] **Step 1: `FlowText` — accept and forward the new props**

Find:

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
```

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
  turnKey,
  allCards,
  starred,
  onToggleStar,
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
  /** F12 — threaded straight through to `FanerAwareText`'s star-matching. */
  turnKey: string;
  allCards: AllyCard[];
  starred: Set<string>;
  onToggleStar: (cardId: string) => void;
}) {
```

Find the `<FanerAwareText .../>` call inside `FlowText`'s `units.map`:

```tsx
          <FanerAwareText
            text={unit}
            captures={captures}
            terms={terms}
            onAskTerm={onAskTerm}
            onAskFaner={onAskFaner}
            onSendToAsk={onSendToAsk}
          />
```

Replace with:

```tsx
          <FanerAwareText
            text={unit}
            captures={captures}
            terms={terms}
            onAskTerm={onAskTerm}
            onAskFaner={onAskFaner}
            onSendToAsk={onSendToAsk}
            turnKey={turnKey}
            allCards={allCards}
            starred={starred}
            onToggleStar={onToggleStar}
          />
```

- [ ] **Step 2: `Bubble` — accept and forward the same props**

Find `Bubble`'s prop destructuring/type (the `function Bubble({ ... }: { ... })` header) and add four fields. The type block currently ends with:

```tsx
  captures: Capture[];
  onAskFaner: (capture: Capture, phrase: string) => void;
}) {
```

Replace with:

```tsx
  captures: Capture[];
  onAskFaner: (capture: Capture, phrase: string) => void;
  /** F12 — every Ally card (so `FanerAwareText` can find this turn's
   *  starred ones) + the starred-id set + the unstar toggle. */
  allCards: AllyCard[];
  starred: Set<string>;
  onToggleStar: (cardId: string) => void;
}) {
```

And add `allCards`, `starred`, `onToggleStar` to the destructured parameter list at the top of the same function (alongside the existing `captures`, `onAskFaner`):

```tsx
  captures,
  onAskFaner,
```

becomes:

```tsx
  captures,
  onAskFaner,
  allCards,
  starred,
  onToggleStar,
```

Find the `<FlowText .../>` call inside `Bubble`:

```tsx
              <FlowText
                units={units}
                terms={highlightTerms}
                captures={captures}
                onAskText={onAskText}
                onAskTerm={onAskTerm}
                onAskFaner={onAskFaner}
                onSendToAsk={onSendToAsk}
              />
```

Replace with:

```tsx
              <FlowText
                units={units}
                terms={highlightTerms}
                captures={captures}
                onAskText={onAskText}
                onAskTerm={onAskTerm}
                onAskFaner={onAskFaner}
                onSendToAsk={onSendToAsk}
                turnKey={turnKey}
                allCards={allCards}
                starred={starred}
                onToggleStar={onToggleStar}
              />
```

- [ ] **Step 3: Main component — pull the new store fields**

Find, near the top of `TranscriptView()`:

```tsx
  const cards = useAllyStore((s) => s.cards);
  const busy = useAllyStore((s) => s.busy);
  const request = useAllyStore((s) => s.request);
  const clearAlly = useAllyStore((s) => s.clear);
```

Replace with:

```tsx
  const cards = useAllyStore((s) => s.cards);
  const busy = useAllyStore((s) => s.busy);
  const request = useAllyStore((s) => s.request);
  const clearAlly = useAllyStore((s) => s.clear);
  // Starred quotes + the right panel's collapse/mode state (F12) — read
  // here so both the Bubble/FlowText star-marking chain and the
  // RightPanelShell mount (Task 11) share the same store values.
  const starred = useAllyStore((s) => s.starred);
  const star = useAllyStore((s) => s.star);
  const unstar = useAllyStore((s) => s.unstar);
  const toggleStar = useAllyStore((s) => s.toggleStar);
  const panelMode = useAllyStore((s) => s.panelMode);
  const setPanelMode = useAllyStore((s) => s.setPanelMode);
  const panelCollapsed = useAllyStore((s) => s.panelCollapsed);
  const setPanelCollapsed = useAllyStore((s) => s.setPanelCollapsed);
```

(`unstar`/`panelMode`/`setPanelMode`/`panelCollapsed`/`setPanelCollapsed` aren't used until Task 11 — that's fine, they're read from the same store snapshot here so every consumer in this component shares one subscription pattern; an unused-variable lint on them is expected until Task 11, three tasks from now within this same plan.)

- [ ] **Step 4: Make `askText`/`askFaner` accept an optional turn key and star the result**

Find:

```tsx
  // Ask Ally about an arbitrary slice (a sentence unit or a text selection).
  const askText = useCallback(
    (text: string) =>
      void request("question", researchPrompt(text), { key: "", quote: text }),
    [request],
  );
  // Ask Ally about a FANER-marked span (F11) — phrased by the capture's
  // routed action (`fanerPrompt`) rather than the generic `researchPrompt`
  // wrapper, since FANER's prompt is already a complete question.
  const askFaner = useCallback(
    (capture: Capture, phrase: string) =>
      void request("question", fanerPrompt(capture, phrase), { key: "", quote: phrase }),
    [request],
  );
```

Replace with:

```tsx
  // Ask Ally about an arbitrary slice (a sentence unit or a text selection)
  // — and star the resulting card (F12): every quote-tied ask stars by
  // definition (design doc §6.1), so there's no separate "star after
  // asking" step. `key`, when given, is the originating turn's key — it's
  // what lets `collectStarHits` find this quote again on re-render.
  const askText = useCallback(
    (text: string, key?: string) => {
      void request("question", researchPrompt(text), { key: key ?? "", quote: text }).then(
        (id) => id && star(id),
      );
    },
    [request, star],
  );
  // Ask Ally about a FANER-marked span (F11) — phrased by the capture's
  // routed action (`fanerPrompt`) rather than the generic `researchPrompt`
  // wrapper, since FANER's prompt is already a complete question. Stars the
  // resulting card for the same reason `askText` above does (F12).
  const askFaner = useCallback(
    (capture: Capture, phrase: string, key?: string) => {
      void request("question", fanerPrompt(capture, phrase), {
        key: key ?? "",
        quote: phrase,
      }).then((id) => id && star(id));
    },
    [request, star],
  );
```

- [ ] **Step 5: Bind the turn key at the `<Bubble .../>` render call site, pass the new props**

Find (inside the `streamItems.map` render, the `<Bubble ... />` for the turn case):

```tsx
                return (
                  <Bubble
                    key={key}
                    segments={turn.segments}
                    turnKey={key}
                    registerEl={registerBubble}
                    flashToken={flash?.key === key ? flash.token : null}
                    collapsed={collapsed.has(key)}
                    onToggleCollapse={() => toggleCollapse(key)}
                    onResearch={() => research(repSeg)}
                    onAskText={askText}
                    onSendToAsk={sendToAsk}
                    onAskTerm={askTerm}
                    onContextMenu={(e) => bubbleMenu(e, repSeg)}
                    threadCount={linked.length}
                    onOpenThreads={() => newest && openThread(newest)}
                    busy={busy}
                    fontPx={transcriptFontPx}
                    sessionStartMs={sessionStartMs}
                    searchHighlight={searchHighlight}
                    captures={captures}
                    onAskFaner={askFaner}
                  />
                );
```

Replace with:

```tsx
                return (
                  <Bubble
                    key={key}
                    segments={turn.segments}
                    turnKey={key}
                    registerEl={registerBubble}
                    flashToken={flash?.key === key ? flash.token : null}
                    collapsed={collapsed.has(key)}
                    onToggleCollapse={() => toggleCollapse(key)}
                    onResearch={() => research(repSeg)}
                    onAskText={(text) => askText(text, key)}
                    onSendToAsk={sendToAsk}
                    onAskTerm={askTerm}
                    onContextMenu={(e) => bubbleMenu(e, repSeg)}
                    threadCount={linked.length}
                    onOpenThreads={() => newest && openThread(newest)}
                    busy={busy}
                    fontPx={transcriptFontPx}
                    sessionStartMs={sessionStartMs}
                    searchHighlight={searchHighlight}
                    captures={captures}
                    onAskFaner={(capture, phrase) => askFaner(capture, phrase, key)}
                    allCards={cards}
                    starred={starred}
                    onToggleStar={toggleStar}
                  />
                );
```

Note: `onResearch`/`research(repSeg)` (the whole-turn "Ask Ally about this turn" button) and `onAskTerm`/`askTerm` (the RAG-term definition/how-to/elaborate popover) are deliberately **left unchanged** — they weren't among the entry points decision (3) named (right-click selection, FANER hover popover, manual drag-selection), and a whole-turn ask has no single "quote" short enough to mark inline. Design doc §6 scopes marking to `onAskFaner`/`onAskText` only.

- [ ] **Step 6: Build + test**

Run: `npx tsc -b && npx vitest run`
Expected: PASS. `tsc -b` should now be clean (the Task 7 missing-props error is resolved by this task's plumbing).

- [ ] **Step 7: Commit**

```bash
git add src/components/transcript/TranscriptView.tsx
git commit -m "feat(transcript): wire starring end-to-end for FANER + selection asks (F12)

askFaner/askText now star the card they create, and thread the
originating turn's key through Bubble -> FlowText -> FanerAwareText so
collectStarHits can find the quote again on re-render. Whole-turn asks
(onResearch) and RAG-term asks (onAskTerm) are deliberately left out of
scope per the design doc."
```

---

### Task 9: `StarredBoard.tsx`

**Files:**
- Create: `src/components/transcript/StarredBoard.tsx`
- Test: Create `src/components/transcript/StarredBoard.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `src/components/transcript/StarredBoard.test.tsx`:

```tsx
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StarredBoard } from "@/components/transcript/StarredBoard";
import type { AllyCard } from "@/state/ally";

afterEach(cleanup);

function card(overrides: Partial<AllyCard> = {}): AllyCard {
  return {
    id: "c1",
    seq: 1,
    kind: "question",
    question: null,
    text: "",
    done: false,
    error: null,
    sources: [],
    startedAtMs: 0,
    sourceKey: "them-1",
    sourceQuote: "Terraform state locking",
    ...overrides,
  };
}

describe("StarredBoard", () => {
  it("shows an empty-state hint when nothing is starred", () => {
    render(
      <StarredBoard cards={[]} starredIds={new Set()} onUnstar={vi.fn()} onOpenViewer={vi.fn()} barPad="" />,
    );
    expect(screen.getByText(/Star a quote/i)).toBeInTheDocument();
  });

  it("renders only starred cards, with a loading state while a card streams", () => {
    const starred = card({ id: "c1", done: false });
    const notStarred = card({ id: "c2", sourceQuote: "gRPC" });
    render(
      <StarredBoard
        cards={[notStarred, starred]}
        starredIds={new Set(["c1"])}
        onUnstar={vi.fn()}
        onOpenViewer={vi.fn()}
        barPad=""
      />,
    );
    expect(screen.getByText("thinking…")).toBeInTheDocument();
    expect(screen.getByText(/Terraform state locking/)).toBeInTheDocument();
    expect(screen.queryByText(/gRPC/)).toBeNull();
  });

  it("unstars a card via its star button", () => {
    const onUnstar = vi.fn();
    const starred = card({ id: "c1", done: true, text: "Answer text." });
    render(
      <StarredBoard
        cards={[starred]}
        starredIds={new Set(["c1"])}
        onUnstar={onUnstar}
        onOpenViewer={vi.fn()}
        barPad=""
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Unstar A1/i }));
    expect(onUnstar).toHaveBeenCalledWith("c1");
  });

  it("opens the viewer via the expand icon", () => {
    const onOpenViewer = vi.fn();
    const starred = card({ id: "c1", done: true, text: "Answer text." });
    render(
      <StarredBoard
        cards={[starred]}
        starredIds={new Set(["c1"])}
        onUnstar={vi.fn()}
        onOpenViewer={onOpenViewer}
        barPad=""
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Open A1 in the viewer/i }));
    expect(onOpenViewer).toHaveBeenCalledWith(starred);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/components/transcript/StarredBoard.test.tsx`
Expected: FAIL — `src/components/transcript/StarredBoard.tsx` doesn't exist yet.

- [ ] **Step 3: Create `src/components/transcript/StarredBoard.tsx`**

```tsx
import { AnswerBody, cardLabel, ReasoningBlock, splitReasoning } from "@/components/transcript/allyRender";
import { Icon } from "@/components/ui/Icon";
import type { AllyCard } from "@/state/ally";

/**
 * The live-call default view of the right panel (F12 — see
 * docs/superpowers/specs/2026-08-21-live-panel-starred-board-design.md §4.2,
 * §6) — every starred card, oldest-first, each with a loading state while
 * its answer streams in. Reuses `allyRender.tsx`'s markdown rendering so a
 * starred card reads identically here and in the inline transcript /
 * `ThreadViewer` — no second copy of "how an Ally answer renders."
 */
export function StarredBoard({
  cards,
  starredIds,
  onUnstar,
  onOpenViewer,
  barPad,
}: {
  cards: AllyCard[];
  starredIds: Set<string>;
  onUnstar: (id: string) => void;
  onOpenViewer: (card: AllyCard) => void;
  barPad: string;
}) {
  // `cards` is newest-first; the board reads oldest-first (design doc §4.2).
  const starredCards = [...cards].filter((c) => starredIds.has(c.id)).reverse();

  return (
    <aside className={`flex h-full w-[300px] shrink-0 flex-col border-l border-border bg-bg-2${barPad}`}>
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-4">
        <Icon name="star" size={14} filled className="text-ai" />
        <span className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-ai">
          Starred
        </span>
        <span className="ml-auto font-mono text-[10.5px] text-fg-faint">
          {starredCards.length} card{starredCards.length === 1 ? "" : "s"}
        </span>
      </div>

      <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-3">
        {starredCards.length === 0 ? (
          <p className="mt-6 text-center text-[12px] text-fg-faint">
            Star a quote in the transcript — click the star on any Ask Ally
            popover or selection menu — and it lands here.
          </p>
        ) : (
          starredCards.map((card) => {
            const label = cardLabel(card);
            const { answer, context } = splitReasoning(card.text);
            const sayText = answer || card.text;
            const loading = !card.done && !card.error;
            return (
              <div
                key={card.id}
                className="rounded-[var(--radius)] border border-ai/30 bg-panel p-3"
              >
                <div className="mb-1.5 flex items-center gap-2">
                  <span className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-ai">
                    {label}
                  </span>
                  {loading && (
                    <span className="text-[10.5px] text-fg-faint" role="status">
                      thinking…
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => onOpenViewer(card)}
                    title="Open in viewer"
                    aria-label={`Open A${card.seq} in the viewer`}
                    className="ml-auto rounded p-0.5 text-fg-faint transition-colors hover:text-ai"
                  >
                    <Icon name="expand" size={13} />
                  </button>
                  <button
                    type="button"
                    onClick={() => onUnstar(card.id)}
                    title="Remove from your board"
                    aria-label={`Unstar A${card.seq}`}
                    className="rounded p-0.5 text-ai transition-colors hover:text-fg"
                  >
                    <Icon name="star" size={13} filled />
                  </button>
                </div>
                {card.sourceQuote && (
                  <p className="mb-1.5 text-[11.5px] italic leading-relaxed text-fg-muted">
                    “{card.sourceQuote}”
                  </p>
                )}
                {card.error ? (
                  <p className="text-[12px] text-rec">{card.error}</p>
                ) : sayText ? (
                  <div className="text-[12.5px] leading-relaxed text-fg">
                    <AnswerBody text={sayText} />
                  </div>
                ) : (
                  <p className="text-[12px] text-fg-faint">…</p>
                )}
                {context && <ReasoningBlock text={context} />}
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/components/transcript/StarredBoard.test.tsx`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/components/transcript/StarredBoard.tsx src/components/transcript/StarredBoard.test.tsx
git commit -m "feat(transcript): StarredBoard — the starred-card live-call board (F12)"
```

---

### Task 10: `RightPanelShell.tsx`

**Files:**
- Create: `src/components/transcript/RightPanelShell.tsx`
- Test: Create `src/components/transcript/RightPanelShell.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `src/components/transcript/RightPanelShell.test.tsx`:

```tsx
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RightPanelShell } from "@/components/transcript/RightPanelShell";

afterEach(cleanup);

describe("RightPanelShell", () => {
  it("renders children when expanded, hides them when collapsed", () => {
    const { rerender } = render(
      <RightPanelShell
        collapsed={false}
        onToggleCollapsed={vi.fn()}
        mode="starred"
        onSetMode={vi.fn()}
        starredCount={0}
      >
        <div>panel content</div>
      </RightPanelShell>,
    );
    expect(screen.getByText("panel content")).toBeInTheDocument();

    rerender(
      <RightPanelShell
        collapsed
        onToggleCollapsed={vi.fn()}
        mode="starred"
        onSetMode={vi.fn()}
        starredCount={0}
      >
        <div>panel content</div>
      </RightPanelShell>,
    );
    expect(screen.queryByText("panel content")).toBeNull();
  });

  it("always shows the expand/collapse arrow, even collapsed", () => {
    render(
      <RightPanelShell
        collapsed
        onToggleCollapsed={vi.fn()}
        mode="starred"
        onSetMode={vi.fn()}
        starredCount={0}
      >
        <div>panel content</div>
      </RightPanelShell>,
    );
    expect(screen.getByRole("button", { name: "Expand the right panel" })).toBeInTheDocument();
  });

  it("calls onToggleCollapsed when the arrow is clicked", () => {
    const onToggleCollapsed = vi.fn();
    render(
      <RightPanelShell
        collapsed={false}
        onToggleCollapsed={onToggleCollapsed}
        mode="starred"
        onSetMode={vi.fn()}
        starredCount={0}
      >
        <div>panel content</div>
      </RightPanelShell>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Collapse the right panel" }));
    expect(onToggleCollapsed).toHaveBeenCalled();
  });

  it("switches mode via the star/dock buttons", () => {
    const onSetMode = vi.fn();
    render(
      <RightPanelShell
        collapsed={false}
        onToggleCollapsed={vi.fn()}
        mode="starred"
        onSetMode={onSetMode}
        starredCount={2}
      >
        <div>panel content</div>
      </RightPanelShell>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Show summary, threads, and grounding" }));
    expect(onSetMode).toHaveBeenCalledWith("dock");
  });

  it("the detach button is present but disabled", () => {
    render(
      <RightPanelShell
        collapsed={false}
        onToggleCollapsed={vi.fn()}
        mode="starred"
        onSetMode={vi.fn()}
        starredCount={0}
      >
        <div>panel content</div>
      </RightPanelShell>,
    );
    expect(screen.getByRole("button", { name: /coming soon/i })).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/components/transcript/RightPanelShell.test.tsx`
Expected: FAIL — `src/components/transcript/RightPanelShell.tsx` doesn't exist yet.

- [ ] **Step 3: Create `src/components/transcript/RightPanelShell.tsx`**

```tsx
import type { ReactNode } from "react";

import { Icon } from "@/components/ui/Icon";
import type { PanelMode } from "@/state/ally";

/**
 * Owns the right panel's collapse/expand chrome and Starred/Dock mode
 * switch (F12 — see docs/superpowers/specs/2026-08-21-live-panel-starred-
 * board-design.md §4) — a thin arrow-column that stays visible even when
 * collapsed. Mounts whichever content (`StarredBoard` or `AllyMetaPanel`)
 * the caller passes as `children`; neither content component knows this
 * shell exists. Deliberately the component that becomes the fast-follow's
 * detached-window content later (design doc §4, §9) — the detach button
 * below is present but inert in v1.
 */
export function RightPanelShell({
  collapsed,
  onToggleCollapsed,
  mode,
  onSetMode,
  starredCount,
  children,
}: {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  mode: PanelMode;
  onSetMode: (mode: PanelMode) => void;
  /** Badge count for the Starred mode button. */
  starredCount: number;
  children: ReactNode;
}) {
  return (
    <div className="flex h-full shrink-0">
      {!collapsed && <div className="flex h-full min-w-0">{children}</div>}

      {/* Arrow column — always visible, even collapsed, so the panel is
          never more than one click away (design doc goal 4). */}
      <div className="flex w-7 shrink-0 flex-col items-center gap-1 border-l border-border bg-bg-2 py-2">
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-expanded={!collapsed}
          title={collapsed ? "Expand" : "Collapse"}
          aria-label={collapsed ? "Expand the right panel" : "Collapse the right panel"}
          className="grid h-6 w-6 place-items-center rounded text-fg-faint transition-colors hover:bg-ai/10 hover:text-ai"
        >
          <Icon name="chevron" size={14} className={collapsed ? "-rotate-90" : "rotate-90"} />
        </button>

        <span className="my-0.5 h-px w-4 bg-border" aria-hidden />

        <button
          type="button"
          onClick={() => onSetMode("starred")}
          aria-pressed={mode === "starred"}
          title="Starred"
          aria-label={`Show starred cards${starredCount > 0 ? ` (${starredCount})` : ""}`}
          className={`grid h-6 w-6 place-items-center rounded transition-colors ${
            mode === "starred" ? "bg-ai/15 text-ai" : "text-fg-faint hover:text-ai"
          }`}
        >
          <Icon name="star" size={13} filled={mode === "starred"} />
        </button>
        <button
          type="button"
          onClick={() => onSetMode("dock")}
          aria-pressed={mode === "dock"}
          title="Summary / Threads / Grounding"
          aria-label="Show summary, threads, and grounding"
          className={`grid h-6 w-6 place-items-center rounded transition-colors ${
            mode === "dock" ? "bg-ai/15 text-ai" : "text-fg-faint hover:text-ai"
          }`}
        >
          <Icon name="ally" size={13} />
        </button>

        <span className="my-0.5 h-px w-4 bg-border" aria-hidden />

        {/* Detach — inert in v1 (design doc §3, §9): the real
            detach-to-a-separate-window is an explicit fast-follow. Present
            now so its eventual wiring doesn't need new chrome. */}
        <button
          type="button"
          disabled
          title="Detach into its own window — coming soon"
          aria-label="Detach into its own window (coming soon)"
          className="grid h-6 w-6 cursor-not-allowed place-items-center rounded text-fg-faint/40"
        >
          <Icon name="expand" size={12} />
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/components/transcript/RightPanelShell.test.tsx`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/components/transcript/RightPanelShell.tsx src/components/transcript/RightPanelShell.test.tsx
git commit -m "feat(transcript): RightPanelShell — collapse/expand chrome + mode switch (F12)"
```

---

### Task 11: Integrate the shell into `TranscriptView`'s main render

**Files:**
- Modify: `src/components/transcript/TranscriptView.tsx` — imports, the "entering listening" effect, and the meta-panel mount.

- [ ] **Step 1: Add imports**

Add alongside the other `@/components/transcript/*` imports:

```tsx
import { RightPanelShell } from "@/components/transcript/RightPanelShell";
import { StarredBoard } from "@/components/transcript/StarredBoard";
```

- [ ] **Step 2: Add the "entering a live call resets the panel" effect**

Find, near the top of `TranscriptView()`:

```tsx
  const sessionEvent = useTranscriptStore((s) => s.session);
  const sessionStartMs =
    sessionEvent.state === "listening" ? sessionEvent.started_at_unix_ms : null;
```

Leave those two lines as they are, and add the effect right after the `seededYou`/`collapseYou` effect block later in the function — find:

```tsx
  useEffect(() => {
    if (!collapseYou) return;
    const fresh = turns.filter(
      (t) => t.side === "outbound" && !seededYou.current.has(t.key),
    );
    if (fresh.length === 0) return;
    setCollapsed((prev) => {
      const next = new Set(prev);
      fresh.forEach((t) => {
        next.add(t.key);
        seededYou.current.add(t.key);
      });
      return next;
    });
  }, [turns, collapseYou]);
```

Add immediately after this block (before `const toggleCollapseYou = () => {`):

```tsx
  // Entering a live call resets the right panel to its speed-to-info
  // default: fully collapsed, Starred as the default mode (design doc §7).
  // Only the transition INTO "listening" resets it — ending the call, or
  // any other state change, leaves whatever the user chose alone.
  const wasListening = useRef(false);
  useEffect(() => {
    const listening = sessionEvent.state === "listening";
    if (listening && !wasListening.current) {
      setPanelCollapsed(true);
      setPanelMode("starred");
    }
    wasListening.current = listening;
  }, [sessionEvent.state, setPanelCollapsed, setPanelMode]);
```

- [ ] **Step 3: Replace the meta-panel mount**

Find:

```tsx
        <div
          className={
            drawer
              ? `absolute right-0 top-0 z-30 h-full w-[min(320px,88%)] shadow-[var(--shadow-lg)] transition-transform duration-200 ${drawerOpen ? "translate-x-0" : "translate-x-full"}`
              // Not a flex item of `main` in the drawer case (it's absolutely
              // positioned), but inline it IS one — without an explicit
              // height it shrink-wraps to content instead of filling the
              // column, which is why the dock ("tabs") wasn't pinned to the
              // bottom when there wasn't much to show above it.
              : "flex h-full"
          }
        >
          <AllyMetaPanel
            cards={cards}
            pinned={pinned}
            togglePin={togglePin}
            onOpenViewer={openThread}
            busy={busy}
            request={request}
            allyFontPx={allyFontPx}
            bumpAllyFont={bumpAllyFont}
            reasoningDefaultOpen={reasoningDefaultOpen}
            setReasoningDefaultOpen={setReasoningDefaultOpen}
            clearAlly={clearAlly}
            barPad={barPad}
          />
        </div>
```

Replace with:

```tsx
        <div
          className={
            drawer
              ? `absolute right-0 top-0 z-30 h-full w-[min(348px,90%)] shadow-[var(--shadow-lg)] transition-transform duration-200 ${drawerOpen ? "translate-x-0" : "translate-x-full"}`
              // Not a flex item of `main` in the drawer case (it's absolutely
              // positioned), but inline it IS one — without an explicit
              // height it shrink-wraps to content instead of filling the
              // column, which is why the dock ("tabs") wasn't pinned to the
              // bottom when there wasn't much to show above it.
              : "flex h-full"
          }
        >
          <RightPanelShell
            // In the narrow overlay-drawer case, the "✦ Ally N" chip +
            // drawerOpen already IS the collapse mechanism (design doc §8)
            // — force the shell open so there's no double-collapse.
            collapsed={drawer ? false : panelCollapsed}
            onToggleCollapsed={() => setPanelCollapsed(!panelCollapsed)}
            mode={panelMode}
            onSetMode={setPanelMode}
            starredCount={starred.size}
          >
            {panelMode === "starred" ? (
              <StarredBoard
                cards={cards}
                starredIds={starred}
                onUnstar={unstar}
                onOpenViewer={openThread}
                barPad={barPad}
              />
            ) : (
              <AllyMetaPanel
                cards={cards}
                pinned={pinned}
                togglePin={togglePin}
                onOpenViewer={openThread}
                busy={busy}
                request={request}
                allyFontPx={allyFontPx}
                bumpAllyFont={bumpAllyFont}
                reasoningDefaultOpen={reasoningDefaultOpen}
                setReasoningDefaultOpen={setReasoningDefaultOpen}
                clearAlly={clearAlly}
                barPad={barPad}
              />
            )}
          </RightPanelShell>
        </div>
```

(The drawer-case width changes from `min(320px,88%)` to `min(348px,90%)` — the shell adds a 28px arrow column outside `StarredBoard`/`AllyMetaPanel`'s own 300px, so the outer clamp needs to grow to match; 348 = 300 + 28 + a little breathing room.)

- [ ] **Step 4: Build + test**

Run: `npx tsc -b && npx vitest run`
Expected: PASS — this is the full integration; if `tsc` complains about an unused `unstar`/`panelMode`/etc. from Task 8's Step 3, it's resolved now since this step is the first to actually use them.

- [ ] **Step 5: Commit**

```bash
git add src/components/transcript/TranscriptView.tsx
git commit -m "feat(transcript): mount RightPanelShell in place of the direct AllyMetaPanel mount (F12)

Live calls now default to fully collapsed + the Starred board; the
existing Summary/Threads/Grounding dock is still reachable via the
shell's mode switch, unchanged."
```

---

### Task 12: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Full typecheck + build**

Run: `npm run build`
Expected: PASS (`tsc -b && vite build` succeeds with no errors).

- [ ] **Step 2: Full test suite**

Run: `npm test`
Expected: PASS — every suite, including the new `Icon.test.tsx` addition, `ally.test.ts`, `star.test.ts`, `StarredBoard.test.tsx`, `RightPanelShell.test.tsx`, and every pre-existing suite (`faner.test.ts`, contexts tests, `SimConSetup.test.tsx`).

- [ ] **Step 3: Manual QA checklist (this repo can't run the Tauri shell in this sandbox — CI's Windows job and/or the owner's own machine is the real verification; use this checklist there)**

- Start a live call → the right side is collapsed by default (only the thin arrow column shows).
- Right-click a selected phrase in the transcript → the popover/menu shows a star icon (not a lightbulb) → click it → the phrase turns the Ally-accent color with a small filled star after it, and the arrow column's Starred button shows a badge count.
- Hover a FANER-marked term → its popover shows a star icon → click it → same marking behavior as above.
- Click the arrow column's expand chevron → the panel opens showing the Starred board (not Summary/Threads/Grounding) → the new card shows "thinking…" while it streams, then settles into its answer.
- Click the small filled star after a marked phrase → it disappears from the transcript's marking and from the Starred board.
- Click the arrow column's Dock icon → Summary/Threads/Grounding shows instead, unchanged from before this feature.
- Below ~640px width, confirm the "✦ Ally N" chip still opens the drawer, and the drawer isn't itself doubly-collapsed (RightPanelShell renders expanded inside the drawer, per Task 11 Step 3).
- The detach icon at the bottom of the arrow column is visibly present but does nothing when clicked (disabled).

- [ ] **Step 4: Update the roadmap if this closes out a tracked item**

Check `../conva_core/docs/product/roadmap.md` for whether this Live-panel work is tracked there; if so, update its status in the same PR per that repo's CLAUDE.md convention. (If it isn't listed, no change needed — this was a directly-requested feature, not a roadmap item.)

- [ ] **Step 5: Push**

```bash
git push -u origin claude/conva-rebrand-voc-overhaul-mhoddo
```

(Retry up to 4 times with exponential backoff — 2s, 4s, 8s, 16s — only on a network failure, per this repo's git-push convention. Then confirm CI is green on GitHub — in particular the Windows `Tauri shell` job, since this plan didn't touch Rust but the shell still needs to compile the frontend changes into the app.)

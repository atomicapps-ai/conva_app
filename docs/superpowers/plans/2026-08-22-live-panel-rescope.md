# Live Panel Found/View Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the right panel's Details/Terms page model with a split panel — **Found** (everything the AI surfaced: questions, commitments, terms, mentions — grouped, selectable) on top and **View** (only the cards the user selected or asked for, in order, height-capped with more/less and open-in-viewer) below — with the control-bar tabs becoming maximize-one-half controls.

**Architecture:** Presentation-layer only. Two new pure modules (`foundGroups.ts`, `viewHistory.ts`) + two new components (`FoundList.tsx`, `ViewHistory.tsx`); `AllyPanel` in `TranscriptView.tsx` becomes a split shell composing them. `ally.ts`'s single `radar` becomes a capped `radarHistory`. `TrackerRail`/`AllyDock` are deleted. No Rust/IPC changes.

**Tech Stack:** React 19, TypeScript, Vitest + `@testing-library/react`, Zustand, Tailwind 4.

**Spec:** `docs/superpowers/specs/2026-08-22-live-panel-rescope-design.md`.

---

## Before you start

- Branch `claude/conva-app-ui-modernization-igllsd`. **Do not start until the partner-window plan (`2026-08-22-partner-window-tabs.md`) has fully completed** — it commits to this same branch.
- `npm run build` once for a clean baseline. All commands run from the repo root.
- `TranscriptView.tsx` is large; every edit step anchors on exact current text — read the file section before each edit, never edit from memory.
- Commit trailer for every commit:

```
Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Kot4sMxdR3d2DEJ8Z84nu6
```

## File Structure

| File | Responsibility |
|---|---|
| `src/state/ally.ts` (+ `src/state/allyRadar.test.ts`) | Modify: `radar` → `radarHistory` (append, dedupe, cap 20). |
| `src/components/AllyDock.tsx` | Delete (unmounted dead code; last consumer of old radar shape). |
| `src/components/transcript/foundGroups.ts` (+ `.test.ts`) | Create: build the four Found groups, deduped. |
| `src/components/transcript/viewHistory.ts` (+ `.test.ts`) | Create: pure view-history list ops (append-or-focus, remove, toggle, seq). |
| `src/components/transcript/FoundList.tsx` (+ `.test.tsx`) | Create: grouped, selectable Found half. |
| `src/components/transcript/ViewHistory.tsx` (+ `.test.tsx`) | Create: chosen-cards half (known-content cards + interleaved answer cards). |
| `src/state/uiPrefs.ts` | Modify: `panelSplitRatio` pref. |
| `src/components/studio/LiveControlBar.tsx` | Modify: tabs accept the `"split"` state (half-lit both). |
| `src/components/transcript/TranscriptView.tsx` | Modify: `AllyPanel` → split shell; strip parked sections; retire TrackerRail mount; panelView state. |
| `src/components/TrackerRail.tsx` | Delete. |
| `CLAUDE.md` | Modify: rule 10 panel description. |

---

### Task 1: `radarHistory` in the ally store + delete dead `AllyDock`

**Files:**
- Modify: `src/state/ally.ts`
- Delete: `src/components/AllyDock.tsx`
- Test: Create `src/state/allyRadar.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/state/allyRadar.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";

import { useAllyStore } from "@/state/ally";
import type { RadarEvent } from "@/lib/ipc";

function hit(question: string): RadarEvent {
  return { question, sources: [] };
}

describe("radarHistory", () => {
  beforeEach(() => useAllyStore.getState().clear());

  it("appends newest first", () => {
    useAllyStore.getState().applyRadar(hit("What is BM25?"));
    useAllyStore.getState().applyRadar(hit("What is RRF?"));
    expect(useAllyStore.getState().radarHistory.map((r) => r.question)).toEqual([
      "What is RRF?",
      "What is BM25?",
    ]);
  });

  it("dedupes by question case-insensitively, moving the repeat to the front", () => {
    useAllyStore.getState().applyRadar(hit("What is BM25?"));
    useAllyStore.getState().applyRadar(hit("What is RRF?"));
    useAllyStore.getState().applyRadar(hit("what is bm25?"));
    const qs = useAllyStore.getState().radarHistory.map((r) => r.question);
    expect(qs).toEqual(["what is bm25?", "What is RRF?"]);
  });

  it("caps at 20", () => {
    for (let i = 0; i < 25; i++) useAllyStore.getState().applyRadar(hit(`q${i}`));
    expect(useAllyStore.getState().radarHistory).toHaveLength(20);
    expect(useAllyStore.getState().radarHistory[0]?.question).toBe("q24");
  });

  it("clear() empties the history", () => {
    useAllyStore.getState().applyRadar(hit("x"));
    useAllyStore.getState().clear();
    expect(useAllyStore.getState().radarHistory).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/state/allyRadar.test.ts`
Expected: FAIL — `radarHistory` doesn't exist.

- [ ] **Step 3: Implement in `src/state/ally.ts`**

Replace the radar parts of the store (read the current file first):

- In `AllyState`, replace:

```ts
  /** Latest Question Radar hit (§6.2); replaced by each new question. */
  radar: RadarEvent | null;
```

with:

```ts
  /** Question Radar history (§6.2) — newest first, deduped by question
   *  (case-insensitive; a repeat moves to the front), capped at 20. Feeds
   *  the Found list's Questions group (live-panel re-scope, 2026-08-22). */
  radarHistory: RadarEvent[];
```

and delete the `dismissRadar: () => void;` line.

- In the store object, replace `radar: null,` with `radarHistory: [],`, replace:

```ts
  applyRadar: (event) => set({ radar: event }),
```

with:

```ts
  applyRadar: (event) =>
    set((s) => {
      const q = event.question.trim().toLowerCase();
      const rest = s.radarHistory.filter(
        (r) => r.question.trim().toLowerCase() !== q,
      );
      return { radarHistory: [event, ...rest].slice(0, 20) };
    }),
```

delete the `dismissRadar: () => set({ radar: null }),` line, and in `clear()` replace `radar: null` with `radarHistory: []`.

- [ ] **Step 4: Delete the dead dock**

```bash
git rm src/components/AllyDock.tsx
```

(It is imported nowhere — verify with `grep -rn "AllyDock" src --include=*.tsx` → only its own file. It was the sole consumer of `radar`/`dismissRadar`.)

- [ ] **Step 5: Verify**

Run: `npx vitest run src/state/allyRadar.test.ts` → PASS (4 tests).
Run: `npx tsc -b && npx vitest run` → PASS (nothing else read `s.radar`).

- [ ] **Step 6: Commit**

```bash
git add src/state/ally.ts src/state/allyRadar.test.ts
git commit -m "feat(ally): radar history (newest-first, deduped, cap 20); drop dead AllyDock"
```

(The `git rm` is already staged.)

---

### Task 2: `foundGroups.ts` — the grouped supply

**Files:**
- Create: `src/components/transcript/foundGroups.ts`
- Test: Create `src/components/transcript/foundGroups.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/components/transcript/foundGroups.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { buildFoundGroups } from "@/components/transcript/foundGroups";
import type { RadarEvent, TrackerEvent } from "@/lib/ipc";

const tracker: TrackerEvent = {
  entities: [
    { label: "Kinesis", detail: "AWS streaming service" },
    { label: "API Gateway", detail: "front door" },
  ],
  commitments: [{ who: "you", what: "send the deck", due: "Friday" }],
};

const radar: RadarEvent[] = [
  { question: "What is RRF?", sources: [] },
];

describe("buildFoundGroups", () => {
  it("builds all four groups with stable ids", () => {
    const g = buildFoundGroups({
      radarHistory: radar,
      tracker,
      captures: [],
      liveTerms: ["API Gateway"],
      docTerms: ["Lambda"],
    });
    expect(g.questions.map((i) => i.label)).toEqual(["What is RRF?"]);
    expect(g.questions[0]?.id).toBe("q-what is rrf?");
    expect(g.commitments[0]).toMatchObject({
      label: "send the deck",
      detail: "you · due Friday",
    });
    expect(g.terms.map((i) => i.label)).toEqual(["API Gateway", "Lambda"]);
    expect(g.mentions.map((i) => i.label)).toEqual(["Kinesis"]);
  });

  it("drops a mention already present as a term (case-insensitive)", () => {
    const g = buildFoundGroups({
      radarHistory: [],
      tracker,
      captures: [],
      liveTerms: ["api gateway"],
      docTerms: [],
    });
    expect(g.mentions.map((i) => i.label)).toEqual(["Kinesis"]);
  });

  it("handles a null tracker and empty inputs", () => {
    const g = buildFoundGroups({
      radarHistory: [],
      tracker: null,
      captures: [],
      liveTerms: [],
      docTerms: [],
    });
    expect(g.questions).toEqual([]);
    expect(g.commitments).toEqual([]);
    expect(g.terms).toEqual([]);
    expect(g.mentions).toEqual([]);
  });

  it("commitment detail omits the due part when empty", () => {
    const g = buildFoundGroups({
      radarHistory: [],
      tracker: {
        entities: [],
        commitments: [{ who: "them", what: "review the doc", due: "" }],
      },
      captures: [],
      liveTerms: [],
      docTerms: [],
    });
    expect(g.commitments[0]?.detail).toBe("them");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/components/transcript/foundGroups.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Create `src/components/transcript/foundGroups.ts`**

```ts
import {
  buildTermChips,
  type TermChip,
} from "@/components/transcript/terms";
import type {
  Capture,
  RadarEvent,
  TrackedCommitment,
  TrackedEntity,
  TrackerEvent,
} from "@/lib/ipc";

/**
 * The Found half's supply (live-panel re-scope spec §3.2): everything the
 * AI surfaced from the call, grouped in urgency order — Questions (radar),
 * Commitments (tracker), Terms (FANER/RAG chips), Mentions (tracker
 * entities). Pure; the panel selects items from here into the View half.
 */
export interface FoundItem {
  /** Stable select/dedupe key ("q-…", "c-…", "t-…", "m-…"). */
  id: string;
  group: "question" | "commitment" | "term" | "mention";
  label: string;
  /** Secondary line — commitment "who · due …", mention detail. */
  detail: string | null;
  /** Term items only — the underlying chip (carries the FANER capture). */
  chip?: TermChip;
  /** Question items only — the radar hit (question + instant sources). */
  radar?: RadarEvent;
  commitment?: TrackedCommitment;
  entity?: TrackedEntity;
}

export interface FoundGroups {
  questions: FoundItem[];
  commitments: FoundItem[];
  terms: FoundItem[];
  mentions: FoundItem[];
}

export function buildFoundGroups(args: {
  radarHistory: readonly RadarEvent[];
  tracker: TrackerEvent | null;
  captures: readonly Capture[];
  liveTerms: readonly string[];
  docTerms: readonly string[];
}): FoundGroups {
  const questions: FoundItem[] = args.radarHistory.map((r) => ({
    id: `q-${r.question.trim().toLowerCase()}`,
    group: "question",
    label: r.question,
    detail: null,
    radar: r,
  }));

  const commitments: FoundItem[] = (args.tracker?.commitments ?? []).map(
    (c) => ({
      id: `c-${c.who}-${c.what.trim().toLowerCase()}`,
      group: "commitment",
      label: c.what,
      detail: `${c.who === "you" ? "you" : "them"}${c.due ? ` · due ${c.due}` : ""}`,
      commitment: c,
    }),
  );

  const chips = buildTermChips(args.captures, args.liveTerms, args.docTerms);
  const terms: FoundItem[] = [...chips.detected, ...chips.docs].map((chip) => ({
    id: `t-${chip.id}`,
    group: "term",
    label: chip.label,
    detail: null,
    chip,
  }));
  const termLabels = new Set(terms.map((t) => t.label.toLowerCase()));

  const mentions: FoundItem[] = (args.tracker?.entities ?? [])
    .filter((e) => !termLabels.has(e.label.trim().toLowerCase()))
    .map((e) => ({
      id: `m-${e.label.trim().toLowerCase()}`,
      group: "mention",
      label: e.label,
      detail: e.detail || null,
      entity: e,
    }));

  return { questions, commitments, terms, mentions };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/components/transcript/foundGroups.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/transcript/foundGroups.ts src/components/transcript/foundGroups.test.ts
git commit -m "feat(panel): foundGroups — the Found half's grouped supply"
```

---

### Task 3: `viewHistory.ts` — pure list ops for the View half

**Files:**
- Create: `src/components/transcript/viewHistory.ts`
- Test: Create `src/components/transcript/viewHistory.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/components/transcript/viewHistory.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  appendOrFocus,
  removeEntry,
  toggleExpanded,
  type ViewEntry,
} from "@/components/transcript/viewHistory";
import type { FoundItem } from "@/components/transcript/foundGroups";

function item(id: string): FoundItem {
  return { id, group: "term", label: id, detail: null };
}

describe("appendOrFocus", () => {
  it("appends a new entry with an increasing seq and reports appended", () => {
    const r1 = appendOrFocus([], item("a"), 1);
    const r2 = appendOrFocus(r1.entries, item("b"), 2);
    expect(r2.entries.map((e) => e.key)).toEqual(["a", "b"]);
    expect(r2.entries[1]?.seq).toBe(2);
    expect(r2.appended).toBe(true);
    expect(r2.focusKey).toBe("b");
  });

  it("focuses an existing entry instead of duplicating", () => {
    const r1 = appendOrFocus([], item("a"), 1);
    const r2 = appendOrFocus(r1.entries, item("a"), 2);
    expect(r2.entries).toHaveLength(1);
    expect(r2.appended).toBe(false);
    expect(r2.focusKey).toBe("a");
  });
});

describe("removeEntry / toggleExpanded", () => {
  it("removes by key", () => {
    const { entries } = appendOrFocus([], item("a"), 1);
    expect(removeEntry(entries, "a")).toEqual([]);
    expect(removeEntry(entries, "zz")).toHaveLength(1);
  });

  it("toggles expanded on one entry only", () => {
    let entries: ViewEntry[] = appendOrFocus([], item("a"), 1).entries;
    entries = appendOrFocus(entries, item("b"), 2).entries;
    const toggled = toggleExpanded(entries, "a");
    expect(toggled.find((e) => e.key === "a")?.expanded).toBe(true);
    expect(toggled.find((e) => e.key === "b")?.expanded).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/components/transcript/viewHistory.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Create `src/components/transcript/viewHistory.ts`**

```ts
import type { FoundItem } from "@/components/transcript/foundGroups";

/**
 * Pure list ops for the View half (spec §3.3): only the items the user
 * selected, in selection order. `seq` orders entries against the answer
 * cards they interleave with (the panel assigns one monotone counter to
 * both). Cards default collapsed (height-capped); `expanded` is the
 * per-card more/less state.
 */
export interface ViewEntry {
  /** = the FoundItem id — selecting the same item focuses, not duplicates. */
  key: string;
  item: FoundItem;
  seq: number;
  expanded: boolean;
}

export function appendOrFocus(
  entries: ViewEntry[],
  item: FoundItem,
  seq: number,
): { entries: ViewEntry[]; focusKey: string; appended: boolean } {
  if (entries.some((e) => e.key === item.id)) {
    return { entries, focusKey: item.id, appended: false };
  }
  return {
    entries: [...entries, { key: item.id, item, seq, expanded: false }],
    focusKey: item.id,
    appended: true,
  };
}

export function removeEntry(entries: ViewEntry[], key: string): ViewEntry[] {
  return entries.filter((e) => e.key !== key);
}

export function toggleExpanded(
  entries: ViewEntry[],
  key: string,
): ViewEntry[] {
  return entries.map((e) =>
    e.key === key ? { ...e, expanded: !e.expanded } : e,
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/components/transcript/viewHistory.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/transcript/viewHistory.ts src/components/transcript/viewHistory.test.ts
git commit -m "feat(panel): viewHistory — pure list ops for the chosen-cards half"
```

---

### Task 4: `FoundList.tsx` — the top half

**Files:**
- Create: `src/components/transcript/FoundList.tsx`
- Test: Create `src/components/transcript/FoundList.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `src/components/transcript/FoundList.test.tsx`:

```tsx
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FoundList } from "@/components/transcript/FoundList";
import type { FoundGroups } from "@/components/transcript/foundGroups";

afterEach(cleanup);

const groups: FoundGroups = {
  questions: [
    {
      id: "q-what is rrf?",
      group: "question",
      label: "What is RRF?",
      detail: null,
      radar: { question: "What is RRF?", sources: [] },
    },
  ],
  commitments: [
    {
      id: "c-you-send the deck",
      group: "commitment",
      label: "send the deck",
      detail: "you · due Friday",
      commitment: { who: "you", what: "send the deck", due: "Friday" },
    },
  ],
  terms: [
    {
      id: "t-l-Lambda",
      group: "term",
      label: "Lambda",
      detail: null,
      chip: { id: "l-Lambda", label: "Lambda", source: "live" },
    },
  ],
  mentions: [
    {
      id: "m-kinesis",
      group: "mention",
      label: "Kinesis",
      detail: "AWS streaming service",
      entity: { label: "Kinesis", detail: "AWS streaming service" },
    },
  ],
};

describe("FoundList", () => {
  it("renders all four group headers and their items", () => {
    render(<FoundList groups={groups} onSelect={() => {}} />);
    for (const h of ["They asked", "Commitments", "Terms", "Mentioned"]) {
      expect(screen.getByText(h)).toBeInTheDocument();
    }
    expect(screen.getByText("What is RRF?")).toBeInTheDocument();
    expect(screen.getByText("send the deck")).toBeInTheDocument();
    expect(screen.getByText("Lambda")).toBeInTheDocument();
    expect(screen.getByText("Kinesis")).toBeInTheDocument();
  });

  it("hides an empty group's header", () => {
    render(
      <FoundList
        groups={{ ...groups, questions: [], commitments: [] }}
        onSelect={() => {}}
      />,
    );
    expect(screen.queryByText("They asked")).toBeNull();
    expect(screen.queryByText("Commitments")).toBeNull();
  });

  it("selecting any item calls onSelect with it", () => {
    const onSelect = vi.fn();
    render(<FoundList groups={groups} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: /What is RRF\?/ }));
    expect(onSelect).toHaveBeenCalledWith(groups.questions[0]);
    fireEvent.click(screen.getByRole("button", { name: /Kinesis/ }));
    expect(onSelect).toHaveBeenCalledWith(groups.mentions[0]);
  });

  it("shows the all-empty placeholder when nothing has been found yet", () => {
    render(
      <FoundList
        groups={{ questions: [], commitments: [], terms: [], mentions: [] }}
        onSelect={() => {}}
      />,
    );
    expect(
      screen.getByText(/appear here as the conversation runs/),
    ).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/components/transcript/FoundList.test.tsx`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Create `src/components/transcript/FoundList.tsx`**

```tsx
import type {
  FoundGroups,
  FoundItem,
} from "@/components/transcript/foundGroups";

/**
 * The Found half (spec §3.2) — everything the AI surfaced, grouped in
 * urgency order, each item one tap from showing its card in the View half
 * below. Groups hide entirely while empty; the sanctioned mono eyebrow is
 * the group header. Chip dots: azure = detected live, gold = doc term,
 * neutral = mention.
 */
export function FoundList({
  groups,
  onSelect,
}: {
  groups: FoundGroups;
  onSelect: (item: FoundItem) => void;
}) {
  const empty =
    groups.questions.length === 0 &&
    groups.commitments.length === 0 &&
    groups.terms.length === 0 &&
    groups.mentions.length === 0;

  const header = (label: string) => (
    <h4 className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-fg-muted">
      {label}
    </h4>
  );

  const row = (item: FoundItem) => (
    <button
      key={item.id}
      type="button"
      onClick={() => onSelect(item)}
      className="flex w-full items-baseline gap-2 rounded-[var(--radius)] border border-border bg-panel px-2.5 py-1.5 text-left transition hover:border-ai/40"
    >
      <span className="min-w-0 flex-1 truncate text-[0.9em] text-fg">
        {item.label}
      </span>
      {item.detail && (
        <span className="shrink-0 font-mono text-[9.5px] text-fg-faint">
          {item.detail}
        </span>
      )}
    </button>
  );

  const chipButton = (item: FoundItem) => (
    <button
      key={item.id}
      type="button"
      onClick={() => onSelect(item)}
      className="flex max-w-full items-center gap-1.5 rounded-full border border-border bg-panel px-2.5 py-[3px] text-[0.86em] font-semibold text-fg-muted transition hover:text-fg"
    >
      <span
        className={`h-[5px] w-[5px] shrink-0 rounded-full ${
          item.group === "mention"
            ? "bg-fg-muted"
            : item.chip?.source === "doc"
              ? "bg-ai"
              : "bg-primary"
        }`}
        aria-hidden
      />
      <span className="min-w-0 truncate">{item.label}</span>
    </button>
  );

  if (empty) {
    return (
      <p className="px-1 py-3 text-[0.86em] text-fg-faint">
        Questions, commitments, terms, and mentions Ally catches appear here
        as the conversation runs.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {groups.questions.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {header("They asked")}
          {groups.questions.map(row)}
        </div>
      )}
      {groups.commitments.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {header("Commitments")}
          {groups.commitments.map(row)}
        </div>
      )}
      {groups.terms.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {header("Terms")}
          <div className="flex flex-wrap gap-1.5">
            {groups.terms.map(chipButton)}
          </div>
        </div>
      )}
      {groups.mentions.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {header("Mentioned")}
          <div className="flex flex-wrap gap-1.5">
            {groups.mentions.map(chipButton)}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/components/transcript/FoundList.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/transcript/FoundList.tsx src/components/transcript/FoundList.test.tsx
git commit -m "feat(panel): FoundList — grouped, selectable supply half"
```

---

### Task 5: `ViewHistory.tsx` — the bottom half

**Files:**
- Create: `src/components/transcript/ViewHistory.tsx`
- Test: Create `src/components/transcript/ViewHistory.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `src/components/transcript/ViewHistory.test.tsx`:

```tsx
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ViewHistory } from "@/components/transcript/ViewHistory";
import type { ViewEntry } from "@/components/transcript/viewHistory";

afterEach(cleanup);

function entry(overrides: Partial<ViewEntry> & { key: string }): ViewEntry {
  return {
    item: {
      id: overrides.key,
      group: "term",
      label: overrides.key,
      detail: null,
      chip: { id: overrides.key, label: overrides.key, source: "live" },
    },
    seq: 0,
    expanded: false,
    ...overrides,
  } as ViewEntry;
}

const noop = {
  onToggleExpanded: () => {},
  onRemove: () => {},
  onFetchInfo: () => {},
  onDefine: () => {},
  onElaborate: () => {},
  onOpenInViewer: () => {},
  renderAnswerCards: () => null,
};

describe("ViewHistory", () => {
  it("shows the empty state when nothing has been chosen", () => {
    render(<ViewHistory entries={[]} focusKey={null} {...noop} />);
    expect(screen.getByText(/Select anything above/)).toBeInTheDocument();
  });

  it("renders chosen entries in order with their labels", () => {
    render(
      <ViewHistory
        entries={[entry({ key: "Lambda", seq: 1 }), entry({ key: "Kinesis", seq: 2 })]}
        focusKey={null}
        {...noop}
      />,
    );
    const cards = screen.getAllByRole("article");
    expect(cards).toHaveLength(2);
    expect(cards[0]).toHaveTextContent("Lambda");
    expect(cards[1]).toHaveTextContent("Kinesis");
  });

  it("more/less toggle calls onToggleExpanded with the entry key", () => {
    const onToggleExpanded = vi.fn();
    render(
      <ViewHistory
        entries={[entry({ key: "Lambda", seq: 1 })]}
        focusKey={null}
        {...noop}
        onToggleExpanded={onToggleExpanded}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    expect(onToggleExpanded).toHaveBeenCalledWith("Lambda");
  });

  it("remove calls onRemove; question entries render their instant sources", () => {
    const onRemove = vi.fn();
    render(
      <ViewHistory
        entries={[
          {
            key: "q-1",
            seq: 1,
            expanded: false,
            item: {
              id: "q-1",
              group: "question",
              label: "What is RRF?",
              detail: null,
              radar: {
                question: "What is RRF?",
                sources: [
                  {
                    file_name: "rag.md",
                    location: "¶3",
                    text: "Reciprocal rank fusion merges rankings.",
                    score: 1,
                  },
                ],
              },
            },
          },
        ]}
        focusKey={null}
        {...noop}
        onRemove={onRemove}
      />,
    );
    expect(
      screen.getByText(/Reciprocal rank fusion merges rankings\./),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: 'Remove "What is RRF?"' }));
    expect(onRemove).toHaveBeenCalledWith("q-1");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/components/transcript/ViewHistory.test.tsx`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Create `src/components/transcript/ViewHistory.tsx`**

```tsx
import { useEffect, useRef } from "react";

import type { ViewEntry } from "@/components/transcript/viewHistory";
import { Icon } from "@/components/ui/Icon";

/**
 * The View half (spec §3.3): ONLY what the user chose — selected Found
 * items (rendered as known-content cards below) interleaved with the Ally
 * answer cards the parent renders via `renderAnswerCards` (asks are choices
 * too). Every card is height-capped with a More/Less toggle; ✕ removes;
 * re-selecting an item focuses (scroll + ring) instead of duplicating —
 * the parent passes `focusKey` to drive that.
 */
export function ViewHistory({
  entries,
  focusKey,
  onToggleExpanded,
  onRemove,
  onFetchInfo,
  onDefine,
  onElaborate,
  onOpenInViewer,
  renderAnswerCards,
}: {
  entries: ViewEntry[];
  focusKey: string | null;
  onToggleExpanded: (key: string) => void;
  onRemove: (key: string) => void;
  /** Term/mention cards: research this item (streams into Answers). */
  onFetchInfo: (entry: ViewEntry) => void;
  onDefine: (entry: ViewEntry) => void;
  /** Question cards: promote the instant hit to a real Ally answer. */
  onElaborate: (entry: ViewEntry) => void;
  onOpenInViewer: (entry: ViewEntry) => void;
  /** The parent's existing answer-card feed (asks/summaries), rendered
   *  after the chosen entries so the auto-scrolled bottom stays newest. */
  renderAnswerCards: () => React.ReactNode;
}) {
  const els = useRef(new Map<string, HTMLElement>());

  useEffect(() => {
    if (!focusKey) return;
    const el = els.current.get(focusKey);
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [focusKey]);

  return (
    <div className="flex flex-col gap-2.5">
      {entries.length === 0 && (
        <p className="px-1 py-3 text-[0.86em] text-fg-faint">
          Select anything above — or ask Ally below — and it shows here, in
          order.
        </p>
      )}
      {entries.map((e) => (
        <article
          key={e.key}
          ref={(el) => {
            if (el) els.current.set(e.key, el);
            else els.current.delete(e.key);
          }}
          aria-label={e.item.label}
          className={[
            "relative rounded-[var(--radius)] border bg-panel p-2.5",
            focusKey === e.key
              ? "border-primary/60 ring-1 ring-primary/40"
              : "border-border",
          ].join(" ")}
        >
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-[0.9em] font-bold text-fg">
              {e.item.label}
            </span>
            <span className="shrink-0 font-mono text-[9px] uppercase text-fg-faint">
              {e.item.group}
            </span>
            <span className="flex shrink-0 gap-1">
              {e.item.group === "question" ? (
                <button
                  type="button"
                  title="Elaborate — Ally answers this properly"
                  aria-label={`Elaborate on "${e.item.label}"`}
                  onClick={() => onElaborate(e)}
                  className="grid h-[22px] w-[22px] place-items-center rounded-[5px] border border-ai/45 bg-ai/10 text-ai transition hover:brightness-110"
                >
                  <Icon name="search" size={12} />
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    title="Fetch info — Ally researches this"
                    aria-label={`Fetch info on "${e.item.label}"`}
                    onClick={() => onFetchInfo(e)}
                    className="grid h-[22px] w-[22px] place-items-center rounded-[5px] border border-ai/45 bg-ai/10 text-ai transition hover:brightness-110"
                  >
                    <Icon name="search" size={12} />
                  </button>
                  <button
                    type="button"
                    title="Define"
                    aria-label={`Define "${e.item.label}"`}
                    onClick={() => onDefine(e)}
                    className="grid h-[22px] w-[22px] place-items-center rounded-[5px] border border-ai/45 bg-ai/10 text-ai transition hover:brightness-110"
                  >
                    <Icon name="book" size={12} />
                  </button>
                </>
              )}
              <button
                type="button"
                title="Open in viewer"
                aria-label={`Open "${e.item.label}" in the viewer`}
                onClick={() => onOpenInViewer(e)}
                className="grid h-[22px] w-[22px] place-items-center rounded-[5px] border border-primary/50 bg-primary/[0.12] text-primary transition hover:brightness-110"
              >
                <Icon name="expand" size={12} />
              </button>
              <button
                type="button"
                title="Remove from history"
                aria-label={`Remove "${e.item.label}"`}
                onClick={() => onRemove(e.key)}
                className="grid h-[22px] w-[22px] place-items-center rounded-[5px] border border-border text-fg-faint transition hover:text-rec"
              >
                <Icon name="close" size={11} />
              </button>
            </span>
          </div>

          <div
            className={
              e.expanded ? "mt-1.5" : "mt-1.5 max-h-[180px] overflow-hidden"
            }
          >
            {e.item.group === "question" && e.item.radar ? (
              <div className="flex flex-col gap-1">
                {e.item.radar.sources.length === 0 ? (
                  <p className="text-[0.86em] text-fg-faint">
                    No instant match in your documents — Elaborate for a full
                    answer.
                  </p>
                ) : (
                  e.item.radar.sources.slice(0, e.expanded ? 8 : 2).map((s, i) => (
                    <p key={i} className="text-[0.86em] leading-relaxed text-fg-muted">
                      <span className="font-mono text-[9px] text-fg-faint">
                        {s.file_name} · {s.location} —{" "}
                      </span>
                      {s.text}
                    </p>
                  ))
                )}
              </div>
            ) : (
              <p className="text-[0.86em] leading-relaxed text-fg-muted">
                {e.item.chip?.capture?.preview ??
                  e.item.detail ??
                  "Fetch info or Define to research this."}
              </p>
            )}
          </div>

          <button
            type="button"
            onClick={() => onToggleExpanded(e.key)}
            aria-label={e.expanded ? "Less" : "More"}
            className="mt-1 text-[10.5px] font-semibold text-ai transition hover:underline"
          >
            {e.expanded ? "Less" : "More"}
          </button>
        </article>
      ))}
      {renderAnswerCards()}
    </div>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/components/transcript/ViewHistory.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/transcript/ViewHistory.tsx src/components/transcript/ViewHistory.test.tsx
git commit -m "feat(panel): ViewHistory — the chosen-cards half"
```

---

### Task 6: `panelSplitRatio` pref + `LiveControlBar` split-aware tabs

**Files:**
- Modify: `src/state/uiPrefs.ts`
- Modify: `src/components/studio/LiveControlBar.tsx`

- [ ] **Step 1: Add the split-ratio pref**

In `src/state/uiPrefs.ts` (anchors mirror the `partnerFontPx` additions from the partner plan — read the file first): add key

```ts
const PANEL_SPLIT_KEY = "conva.panel.splitRatio";
```

interface members:

```ts
  /** Found/View split ratio (Found's share of the panel height), 0.25–0.75. */
  panelSplitRatio: number;
  setPanelSplitRatio: (r: number) => void;
```

store members:

```ts
  panelSplitRatio: (() => {
    const v = Number(localStorage.getItem(PANEL_SPLIT_KEY));
    return v >= 0.25 && v <= 0.75 ? v : 0.45;
  })(),
```

and:

```ts
  setPanelSplitRatio: (r) => {
    const clamped = Math.max(0.25, Math.min(0.75, r));
    localStorage.setItem(PANEL_SPLIT_KEY, String(clamped));
    set({ panelSplitRatio: clamped });
  },
```

- [ ] **Step 2: Make the control-bar tabs split-aware**

In `src/components/studio/LiveControlBar.tsx` (read current first):

Change the export:

```tsx
export type AllyPanelTab = "details" | "terms";
/** The panel's layout state: split (default) or one half maximized.
 *  "terms" maximizes Found, "details" maximizes View (spec §3.1). */
export type AllyPanelView = AllyPanelTab | "split";
```

Change the `tabs` prop type to `tabs?: { view: AllyPanelView; onSelect: (tab: AllyPanelTab) => void }`, and in the tablist render replace `const active = tabs.tab === key;` with:

```tsx
            const maximized = tabs.view === key;
            const split = tabs.view === "split";
```

and the button classes/spine become (aria-selected true when maximized OR split — in split both halves are on screen):

```tsx
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={maximized || split}
                onClick={() => tabs.onSelect(key)}
                className={[
                  "relative flex flex-1 items-center justify-center gap-2 text-[12.5px] transition",
                  i > 0 ? "border-l border-border" : "",
                  maximized
                    ? "bg-panel-raised font-bold text-primary"
                    : split
                      ? "bg-panel-raised/50 font-semibold text-primary/70"
                      : "font-semibold text-fg-faint hover:text-fg",
                ].join(" ")}
              >
                {(maximized || split) && (
                  <span
                    className={`absolute inset-x-0 top-0 h-[2px] ${maximized ? "bg-primary" : "bg-primary/40"}`}
                    aria-hidden
                  />
                )}
                <Icon name={key === "details" ? "summarize" : "file"} size={14} />
                {label}
              </button>
```

Also update the doc comment's tab bullet: the two tabs are now maximize
controls over the split panel — tapping the maximized tab returns to split
(the parent implements that toggle; the bar only reports clicks).

- [ ] **Step 3: Verify + commit**

Run: `npx tsc -b`
Expected: FAIL in `TranscriptView.tsx` (it still passes `{ tab, onSelect }`) — that's the next task's wiring; to keep this commit green, ALSO apply Task 7 Step 1's `panelView` wiring in the same working session and commit both together **or** simply proceed to Task 7 before committing. Preferred: continue into Task 7 and commit Tasks 6+7 as one commit at Task 7's end.

---

### Task 7: `AllyPanel` → split shell (the core restructure)

**Files:**
- Modify: `src/components/transcript/TranscriptView.tsx`

Read the whole `AllyPanel` (currently ~lines 1596–2041) and the cockpit wiring (~2330–2465, ~2885–2965) first. Apply these edits:

- [ ] **Step 1: Cockpit state — `panelView`**

Replace:

```tsx
  const [panelTab, setPanelTab] = useState<AllyPanelTab>("details");
  const selectPanelTab = useCallback(
    (tab: AllyPanelTab) => {
      setPanelTab(tab);
      if (drawer) setDrawerOpen(true);
    },
    [drawer],
  );
```

with:

```tsx
  // Split by default (spec §3.1): tapping a tab maximizes that half;
  // tapping the maximized tab returns to the split. In drawer mode
  // (<640px) there is no split — a tab tap opens that half as the
  // overlay drawer, exclusive as before.
  const [panelView, setPanelView] = useState<AllyPanelView>("split");
  const selectPanelTab = useCallback(
    (tab: AllyPanelTab) => {
      setPanelView((v) => (!drawer && v === tab ? "split" : tab));
      if (drawer) setDrawerOpen(true);
    },
    [drawer],
  );
  // Answers/asks must land visibly: if Found is maximized, drop back to
  // the split so the View half (where the answer streams) is on screen.
  const ensureViewVisible = useCallback(() => {
    setPanelView((v) => (v === "terms" ? "split" : v));
  }, []);
```

Update the import line to `import { LiveControlBar, type AllyPanelTab, type AllyPanelView } from "@/components/studio/LiveControlBar";`

Replace every other `setPanelTab("details")` call (in `openThread`, `requestVisible`, and the two `onAskCapture`/`onAskTerm` panel props) with `ensureViewVisible()`. Replace the panel mount's `tab={panelTab}` with `view={drawer ? (panelView === "split" ? "details" : panelView) : panelView}` and the control-bar mount with `tabs={{ view: panelView, onSelect: selectPanelTab }}`.

- [ ] **Step 2: View-history state in the cockpit**

Add next to the `panelView` state:

```tsx
  // The View half's chosen entries (spec §3.3). One monotone counter
  // sequences selections against future needs; focusKey drives the
  // scroll+ring focus of an already-present card.
  const [viewEntries, setViewEntries] = useState<ViewEntry[]>([]);
  const [viewFocusKey, setViewFocusKey] = useState<string | null>(null);
  const viewSeq = useRef(0);
  const selectFound = useCallback(
    (item: FoundItem) => {
      viewSeq.current += 1;
      setViewEntries((prev) => {
        const r = appendOrFocus(prev, item, viewSeq.current);
        setViewFocusKey(r.focusKey);
        return r.entries;
      });
      ensureViewVisible();
    },
    [ensureViewVisible],
  );
```

with imports:

```tsx
import { buildFoundGroups, type FoundItem } from "@/components/transcript/foundGroups";
import {
  appendOrFocus,
  removeEntry,
  toggleExpanded,
  type ViewEntry,
} from "@/components/transcript/viewHistory";
import { FoundList } from "@/components/transcript/FoundList";
import { ViewHistory } from "@/components/transcript/ViewHistory";
```

(`setViewFocusKey` inside the updater is deliberate — `appendOrFocus` is pure and the updater runs once per commit in production; Strict Mode's double-invoke sets the same focusKey twice, a harmless idempotent write.)

- [ ] **Step 3: Feed the panel the new data**

The cockpit already selects `captures`; add below it:

```tsx
  const radarHistory = useAllyStore((s) => s.radarHistory);
  const tracker = useAllyStore((s) => s.tracker);
```

- [ ] **Step 4: Restructure `AllyPanel`**

Within `AllyPanel` (keep its name, header row, 3-dot menu shell, and askField):

a) Props: remove `tab: AllyPanelTab`, `captures`, `onAskCapture`, `onAskTerm`, `answersCount`; add:

```tsx
  view: AllyPanelView;
  groups: FoundGroups;
  viewEntries: ViewEntry[];
  viewFocusKey: string | null;
  onSelectFound: (item: FoundItem) => void;
  onToggleEntry: (key: string) => void;
  onRemoveEntry: (key: string) => void;
  onEntryFetchInfo: (entry: ViewEntry) => void;
  onEntryDefine: (entry: ViewEntry) => void;
  onEntryElaborate: (entry: ViewEntry) => void;
  onEntryOpenInViewer: (entry: ViewEntry) => void;
  splitRatio: number;
  onSplitRatio: (r: number) => void;
```

with `import type { FoundGroups, FoundItem } from "@/components/transcript/foundGroups";` and `import type { ViewEntry } from "@/components/transcript/viewHistory";` and `import type { AllyPanelView } from "@/components/studio/LiveControlBar";` added at the top of the file (merge with Step 2's imports).

Delete from `AllyPanel`'s body: the `chips`/`selectedChipId`/`termChipButton`/`termInfoCard` block, the `latestSummary`/`pinnedCards`/`restCards` derivations, and the `caps`/`spokenTerms`/`addedTerms` selectors (`useCapabilities`/`useLiveTermsStore` imports stay — the cockpit still uses them; remove only if unused after the edit — `npx tsc -b` will say). Keep the `groundingDocs`/`docTerms` effect — `docTerms` now flows UP: change `AllyPanel` to receive `groups` prebuilt instead? **No** — keep it simple: the cockpit builds groups, so move the `docTerms` state + effect INTO the cockpit (cut-paste the whole effect block, changing `backend` references accordingly — the cockpit already has `backend`), and pass `groups` down. `groundingDocs` stays in `AllyPanel` (the 3-dot Grounding entry below needs it).

In the cockpit, build the groups:

```tsx
  const foundGroups = useMemo(
    () =>
      buildFoundGroups({
        radarHistory,
        tracker,
        captures,
        liveTerms: [...addedTerms, ...spokenTerms],
        docTerms,
      }),
    [radarHistory, tracker, captures, addedTerms, spokenTerms, docTerms],
  );
```

(the cockpit must also take over the `spokenTerms`/`addedTerms` selectors — move those two lines up from `AllyPanel`.)

b) 3-dot menu: after the "Expand reasoning by default" item add:

```tsx
              <button
                type="button"
                role="menuitem"
                disabled={busy}
                onClick={() => {
                  void request("summarize");
                  setMenuOpen(false);
                }}
                className="flex w-full items-center gap-2 rounded px-1.5 py-1.5 text-left text-[12px] text-fg hover:bg-white/[0.06] disabled:opacity-40"
              >
                <Icon name="summarize" size={14} />
                Summarize the call
              </button>
              <div className="px-1.5 py-1 text-[11px] text-fg-faint">
                {activeTitle ?? "No context grounded"}
                {groundingDocs.length > 0 && ` · ${groundingDocs.join(" · ")}`}
              </div>
```

c) Body: replace everything between the scroller `<div …>` open tag and `{askField}` (the whole `tab === "details"` / `tab === "terms"` content) with the split shell:

```tsx
      <div
        style={{ fontSize: `${allyFontPx}px` }}
        className="flex min-h-0 flex-1 flex-col"
      >
        {view !== "details" && (
          <div
            style={view === "split" ? { flexBasis: `${splitRatio * 100}%` } : undefined}
            className={[
              "min-h-0 overflow-y-auto p-3.5",
              view === "split" ? "shrink-0 grow-0" : "flex-1",
            ].join(" ")}
          >
            <FoundList groups={groups} onSelect={onSelectFound} />
          </div>
        )}
        {view === "split" && (
          <div
            role="separator"
            aria-orientation="horizontal"
            aria-label="Resize panels"
            onPointerDown={(e) => {
              const host = e.currentTarget.parentElement;
              if (!host) return;
              const rect = host.getBoundingClientRect();
              const move = (ev: PointerEvent) =>
                onSplitRatio((ev.clientY - rect.top) / rect.height);
              const up = () => {
                window.removeEventListener("pointermove", move);
                window.removeEventListener("pointerup", up);
              };
              window.addEventListener("pointermove", move);
              window.addEventListener("pointerup", up);
            }}
            className="h-[5px] shrink-0 cursor-row-resize border-y border-border bg-bg-2 hover:bg-panel-raised"
          />
        )}
        {view !== "terms" && (
          <div
            ref={scrollRef}
            onScroll={onBodyScroll}
            className="min-h-0 flex-1 overflow-y-auto p-3.5"
          >
            <ViewHistory
              entries={viewEntries}
              focusKey={viewFocusKey}
              onToggleExpanded={onToggleEntry}
              onRemove={onRemoveEntry}
              onFetchInfo={onEntryFetchInfo}
              onDefine={onEntryDefine}
              onElaborate={onEntryElaborate}
              onOpenInViewer={onEntryOpenInViewer}
              renderAnswerCards={renderAnswers}
            />
          </div>
        )}
      </div>
```

(`renderAnswers` prop stays; `answersCount` prop is gone — remove its header, the feed renders inside ViewHistory. The auto-scroll ref now attaches to the View half's scroller.)

- [ ] **Step 5: Wire the cockpit's panel mount**

Replace the old prop list (`tab`, `captures`, `onAskCapture`, `onAskTerm`, `answersCount`) with:

```tsx
            view={drawer ? (panelView === "split" ? "details" : panelView) : panelView}
            groups={foundGroups}
            viewEntries={viewEntries}
            viewFocusKey={viewFocusKey}
            onSelectFound={selectFound}
            onToggleEntry={(k) => setViewEntries((p) => toggleExpanded(p, k))}
            onRemoveEntry={(k) => setViewEntries((p) => removeEntry(p, k))}
            onEntryFetchInfo={(e) =>
              e.item.chip?.capture
                ? (ensureViewVisible(), askFaner(e.item.chip.capture, e.item.label))
                : (ensureViewVisible(), askTerm("elaborate", e.item.label))
            }
            onEntryDefine={(e) => {
              ensureViewVisible();
              askTerm("definition", e.item.label);
            }}
            onEntryElaborate={(e) => {
              ensureViewVisible();
              void requestVisible("question", e.item.label);
            }}
            onEntryOpenInViewer={(e) => {
              if (caps?.system.partnerWindow) {
                void backend.partner.open(
                  e.item.label,
                  e.item.group,
                  e.item.chip?.capture?.preview ?? e.item.detail ?? null,
                );
              }
            }}
            splitRatio={panelSplitRatio}
            onSplitRatio={setPanelSplitRatio}
```

with `const panelSplitRatio = useUiPrefs((s) => s.panelSplitRatio);` and `const setPanelSplitRatio = useUiPrefs((s) => s.setPanelSplitRatio);` beside the other uiPrefs selectors.

- [ ] **Step 6: Retire the rail**

Delete the `{showTracker && <TrackerRail />}` mount + the `TRACKER_W`/`showTracker` block + the `TrackerRail` import, then:

```bash
git rm src/components/TrackerRail.tsx
```

- [ ] **Step 7: Verify**

Run: `npx tsc -b && npx vitest run`
Expected: PASS. Existing panel tests that asserted the old sections (grep for "Live summary"/"Open threads" in `src/**/*.test.*`) must be updated to the new structure if any exist — report which.

- [ ] **Step 8: Commit (Tasks 6+7 together)**

```bash
git add -u src/components/transcript/TranscriptView.tsx src/components/studio/LiveControlBar.tsx src/state/uiPrefs.ts
git commit -m "feat(panel): Found/View split — tabs maximize halves, parked sections retired

Live summary -> 3-dot Summarize; Open threads -> the View history IS the
record; Grounding -> 3-dot line; TrackerRail column deleted (its data now
lives in Found)."
```

---

### Task 8: Docs — CLAUDE.md rule 10 + roadmap note

**Files:**
- Modify: `CLAUDE.md` (rule 10's panel description)

- [ ] **Step 1: Rewrite rule 10's tab-content sentences**

Replace the sentence beginning "**Details** = answers feed + Live summary + Open threads + Grounding; **Terms** = words-only chips…" (through "…never one-size-fits-all).") with:

```markdown
    The panel is a SPLIT by default (owner, 2026-08-22): **Found** (top) =
    everything Ally surfaced, grouped — They asked (radar history) ·
    Commitments · Terms (azure dot = detected live, gold = doc) · Mentioned
    (neutral dot) — each item one tap from its card; **View** (bottom) =
    ONLY the cards the user selected or asked for, in order, height-capped
    with More/Less, each with fetch info / define / open-in-viewer / remove.
    The two control-bar tabs MAXIMIZE a half (Terms = Found, Details =
    View); tapping the maximized tab returns to the split. Live summary is
    the 3-dot "Summarize the call" (lands in View); Grounding is a 3-dot
    line; Open threads and the TrackerRail/AllyDock surfaces are retired —
    the View history is the engagement record, the tracker/radar data lives
    in Found.
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: rule 10 — Found/View split panel model"
```

---

### Task 9: Full verification, push, PR update

- [ ] **Step 1:** `npm run build && npm test && cargo test -p conva-core && cargo fmt --check`
Expected: all PASS.

- [ ] **Step 2:** `git push -u origin claude/conva-app-ui-modernization-igllsd` (4× backoff retries on network failure only).

- [ ] **Step 3:** The branch's open draft PR (created by the partner-window plan's Task 11) covers this work too — update its title to `feat(live): partner-window tabs + Found/View panel re-scope` and extend the body with a "Panel re-scope" section (spec link, what moved where, the retirements) and this manual QA list. If no open PR exists, create a draft one (Conventional title; body `Closes #<partner issue>` plus a new tracking issue for the re-scope, closing keyword included — the hygiene gate requires both).

- [ ] **Step 4: Manual QA (owner's Windows machine)**

- Live call: a question from the other side appears under "They asked"; selecting it shows the instant snippets below; Elaborate streams a real answer.
- Commitments/mentions populate as spoken; selecting each shows its card.
- Terms chips behave as before but render their card below on select.
- Re-selecting an item rings its existing card instead of duplicating.
- More/Less expands a capped card; ✕ removes it.
- Tabs: Terms maximizes Found; Details maximizes View; tapping again re-splits; divider drag persists across restarts.
- 3-dot: Summarize lands a card in View; the grounding line lists context + docs.
- Below 640px: drawer behavior (exclusive halves) still works.

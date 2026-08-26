# Partner Window Tabs + Font Menu + Document Tabs + Lock-to-App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The partner window keeps multiple open items as tabs (terms, answers, and library documents), gains a top-right Aa font-size menu with its own persisted setting, and locks to the app by default — following the main window flush at its right edge with the user's own size preserved — releasable to a free-floating window via a title-bar toggle.

**Architecture:** Frontend-first. The Rust side keeps its single-delivery model (`PAYLOAD` mutex + `conva://partner-term`); tab state accumulates in the window's own React state via a new pure module. Rust changes are confined to the lock/follow behavior (an `on_window_event` hook + two commands + one mirrored event), because only the shell can observe main-window moves. Document tabs resolve doc ids frontend-side from `backend.rag.list()` — no payload change.

**Tech Stack:** React 19, TypeScript, Vitest + `@testing-library/react`, Zustand, Tauri 2 (Rust shell), serde.

**Spec:** `docs/superpowers/specs/2026-08-22-partner-window-tabs-design.md` — read it first. Task 1 amends its §4.3 (see below) before any code.

---

## Before you start

- Repo `conva_app`, branch `claude/conva-app-ui-modernization-igllsd`, based on main `57905bb` + the spec commit. Run `npm run build` once for a clean baseline.
- **This sandbox cannot build the Tauri shell** (no GTK/Windows). Rust shell changes (Tasks 8–9) are verified here by careful review + `cargo test -p conva-core`/`cargo fmt`/core clippy only; CI's `windows-latest` job compile-checks `conva-app` with `-D warnings`. Write them exactly as given.
- All `npx vitest run` / `cargo` commands run from the repo root.

## File Structure

| File | Responsibility |
|---|---|
| `docs/superpowers/specs/2026-08-22-partner-window-tabs-design.md` | Modify: §4.3 amendment (Task 1). |
| `src/components/partner/partnerTabs.ts` (+ `.test.ts`) | Create: pure tab-list logic (keys, add/focus, close). |
| `src/state/uiPrefs.ts` (+ `src/state/uiPrefs.partner.test.ts`) | Modify: `partnerFontPx` / `bumpPartnerFont`. |
| `src/components/ui/Icon.tsx` (+ existing `Icon.test.tsx`) | Modify: `lock` / `unlock` glyphs. |
| `src/state/ally.ts` | Modify: card cap 6 → 12. |
| `src/components/partner/PartnerWindow.tsx` (+ `PartnerWindow.test.tsx`) | Modify: tabs, font menu, document tabs, lock toggle. |
| `crates/conva-core/src/ipc.rs` ↔ `src/lib/ipc.ts` | Modify: `PARTNER_LOCK` event + `PartnerLockEvent` (mirrored, one commit). |
| `src/lib/backend/events.ts` | Modify: `partnerLock` in `EventMap` + `EVENT_CHANNEL`. |
| `src-tauri/src/partner.rs` | Modify: `LOCKED`, programmatic-move suppression, `follow_main`, `on_partner_moved`, `set_locked`; `redock` stops forcing size. |
| `src-tauri/src/lib.rs` | Modify: `on_window_event` hook, `set_partner_locked`/`get_partner_locked` commands. |
| `src/lib/commands.ts`, `src/lib/backend/ConvaBackend.ts`, `src/lib/backend/tauri.ts`, `src/lib/backend/web.ts` | Modify: `partner.setLocked`/`partner.locked` wrappers. |

---

### Task 1: Amend spec §4.3 (document ids resolve frontend-side)

**Why:** `AllySource` (both `src/lib/ipc.ts:85` and `ipc.rs:89`) carries only `file_name` + `location` — no doc id. The spec's `source_docs` payload field could never be filled with real ids at any constructor site, so the feature as spec'd would be dead code. The window can instead resolve file names → ids itself via `backend.rag.list()` (`RagDocument` has `id` + `file_name`), the same pattern `AllyMetaPanel` uses for grounding docs. Zero IPC changes; every source line whose file is in the library becomes clickable.

**Files:**
- Modify: `docs/superpowers/specs/2026-08-22-partner-window-tabs-design.md` (§4.3)

- [ ] **Step 1: Replace §4.3's first two bullets**

Replace the two bullets beginning "**IPC (mirrored both sides…**" and "In the viewer, each…" with:

```markdown
- **No IPC change** (amended during planning, 2026-08-22): `AllySource`
  carries no document id, so a payload-side `source_docs` field could never
  be filled with real ids. Instead the partner window resolves ids itself:
  on mount it loads `backend.rag.list()` once and builds a
  `file_name → id` map (the same resolution `AllyMetaPanel` already does
  for grounding docs).
- In the viewer, each "FROM YOUR DOCUMENTS" line whose leading file name
  (the text before the " — " separator `groupSourcesByFile` produces)
  matches a library document renders as a button; clicking it opens a
  `kind: "document"` tab carrying that `{ id, file_name }` — no round-trip
  through Rust. Lines with no library match stay plain text.
```

Also delete the §6 bullet "Core-side: serde round-trip test…" (no payload change exists to test) and the §4.3 sentence fragment referencing `source_docs[0]` in the document-tab bullet — that bullet now reads: "A document tab renders no research request; its body loads `backend.rag.documentText(id)` once (the id lives on the tab itself), shows a loading state, then the text in a scrollable `whitespace-pre-wrap` block at `text-[0.9em]`; `null` → 'This document's text isn't available.' The Ask bar still works and tags the active (document) tab."

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-08-22-partner-window-tabs-design.md
git commit -m "docs(spec): document tabs resolve ids via rag.list — AllySource has no doc id"
```

---

### Task 2: `partnerTabs.ts` — pure tab-list logic

**Files:**
- Create: `src/components/partner/partnerTabs.ts`
- Test: Create `src/components/partner/partnerTabs.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/components/partner/partnerTabs.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  addOrFocus,
  closeTab,
  documentTab,
  itemTab,
  tabLabel,
  type PartnerTab,
} from "@/components/partner/partnerTabs";
import type { PartnerPayload } from "@/lib/ipc";

function payload(overrides: Partial<PartnerPayload> = {}): PartnerPayload {
  return {
    term: "API Gateway",
    kind: "concept",
    preview: null,
    answer: null,
    source_lines: [],
    ...overrides,
  };
}

describe("addOrFocus", () => {
  it("appends a new tab and makes it active", () => {
    const t = itemTab(payload());
    const r = addOrFocus([], t);
    expect(r.tabs).toEqual([t]);
    expect(r.activeKey).toBe(t.key);
  });

  it("focuses an existing tab instead of duplicating it", () => {
    const t = itemTab(payload());
    const first = addOrFocus([], t);
    const again = addOrFocus(first.tabs, itemTab(payload()));
    expect(again.tabs).toHaveLength(1);
    expect(again.activeKey).toBe(t.key);
  });

  it("treats the same term with a different answer as a different tab", () => {
    const fresh = itemTab(payload());
    const answered = itemTab(payload({ answer: "It routes requests." }));
    const r = addOrFocus(addOrFocus([], fresh).tabs, answered);
    expect(r.tabs).toHaveLength(2);
    expect(r.activeKey).toBe(answered.key);
  });

  it("dedupes document tabs by doc id", () => {
    const d = documentTab("doc-1", "aws.pdf");
    const r = addOrFocus(addOrFocus([], d).tabs, documentTab("doc-1", "aws.pdf"));
    expect(r.tabs).toHaveLength(1);
    expect(r.activeKey).toBe(d.key);
  });
});

describe("closeTab", () => {
  const three = (): PartnerTab[] => [
    itemTab(payload({ term: "a" })),
    itemTab(payload({ term: "b" })),
    itemTab(payload({ term: "c" })),
  ];

  it("closing an inactive tab keeps the active one", () => {
    const tabs = three();
    const r = closeTab(tabs, tabs[0]!.key, tabs[2]!.key);
    expect(r.tabs.map((t) => tabLabel(t))).toEqual(["b", "c"]);
    expect(r.activeKey).toBe(tabs[2]!.key);
  });

  it("closing the active tab activates its right neighbor", () => {
    const tabs = three();
    const r = closeTab(tabs, tabs[1]!.key, tabs[1]!.key);
    expect(r.activeKey).toBe(tabs[2]!.key);
  });

  it("closing the active last tab falls back to its left neighbor", () => {
    const tabs = three();
    const r = closeTab(tabs, tabs[2]!.key, tabs[2]!.key);
    expect(r.activeKey).toBe(tabs[1]!.key);
  });

  it("closing the only tab clears the active key", () => {
    const tabs = [itemTab(payload())];
    const r = closeTab(tabs, tabs[0]!.key, tabs[0]!.key);
    expect(r.tabs).toEqual([]);
    expect(r.activeKey).toBeNull();
  });

  it("ignores an unknown key", () => {
    const tabs = three();
    const r = closeTab(tabs, "nope", tabs[0]!.key);
    expect(r.tabs).toHaveLength(3);
    expect(r.activeKey).toBe(tabs[0]!.key);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/components/partner/partnerTabs.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Create `src/components/partner/partnerTabs.ts`**

```ts
import type { PartnerPayload } from "@/lib/ipc";

/**
 * Pure tab-list logic for the partner window (spec §4.1) — the window
 * accumulates every delivered payload into tabs instead of replacing its
 * content. Two tab kinds: an "item" (a term or an already-answered card,
 * exactly what the window rendered pre-tabs) and a "document" (a library
 * document opened from a citation line, spec §4.3).
 */
export type PartnerTab =
  | { key: string; kind: "item"; payload: PartnerPayload }
  | { key: string; kind: "document"; docId: string; fileName: string };

/** Dedupe signature for a delivered payload — same term reopened with the
 *  same (or no) answer focuses the existing tab; a different answer is a
 *  genuinely different item. (The old `openedFor` redelivery guard,
 *  generalized.) */
export function tabKey(p: PartnerPayload): string {
  return `item::${p.term}::${p.answer ?? ""}`;
}

export function documentKey(docId: string): string {
  return `doc::${docId}`;
}

export function itemTab(p: PartnerPayload): PartnerTab {
  return { key: tabKey(p), kind: "item", payload: p };
}

export function documentTab(docId: string, fileName: string): PartnerTab {
  return { key: documentKey(docId), kind: "document", docId, fileName };
}

export function tabLabel(tab: PartnerTab): string {
  return tab.kind === "item" ? tab.payload.term : tab.fileName;
}

/** Append `tab` (or keep the existing one with the same key); either way it
 *  becomes active. */
export function addOrFocus(
  tabs: PartnerTab[],
  tab: PartnerTab,
): { tabs: PartnerTab[]; activeKey: string } {
  if (tabs.some((t) => t.key === tab.key)) {
    return { tabs, activeKey: tab.key };
  }
  return { tabs: [...tabs, tab], activeKey: tab.key };
}

/** Remove the tab at `key`. Closing the active tab activates its right
 *  neighbor, else its left, else nothing (empty state). */
export function closeTab(
  tabs: PartnerTab[],
  key: string,
  activeKey: string | null,
): { tabs: PartnerTab[]; activeKey: string | null } {
  const idx = tabs.findIndex((t) => t.key === key);
  if (idx === -1) return { tabs, activeKey };
  const next = tabs.filter((t) => t.key !== key);
  if (key !== activeKey) return { tabs: next, activeKey };
  const neighbor = next[idx] ?? next[idx - 1] ?? null;
  return { tabs: next, activeKey: neighbor?.key ?? null };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/components/partner/partnerTabs.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/partner/partnerTabs.ts src/components/partner/partnerTabs.test.ts
git commit -m "feat(partner): pure tab-list logic for the partner window"
```

---

### Task 3: `partnerFontPx` pref + `lock`/`unlock` icons + ally card cap

Three tiny, independent enablers batched as one task (each is a few lines).

**Files:**
- Modify: `src/state/uiPrefs.ts`
- Test: Create `src/state/uiPrefs.partner.test.ts`
- Modify: `src/components/ui/Icon.tsx` (glyph union + two glyphs)
- Modify: `src/components/ui/Icon.test.tsx`
- Modify: `src/state/ally.ts` (cap)

- [ ] **Step 1: Write the failing pref test**

Create `src/state/uiPrefs.partner.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";

import { useUiPrefs } from "@/state/uiPrefs";

describe("partner font pref", () => {
  beforeEach(() => localStorage.removeItem("conva.partner.fontPx"));

  it("defaults to 14 and clamps bumps to the shared 11-20 range", () => {
    expect(useUiPrefs.getState().partnerFontPx).toBe(14);
    for (let i = 0; i < 20; i++) useUiPrefs.getState().bumpPartnerFont(1);
    expect(useUiPrefs.getState().partnerFontPx).toBe(20);
    for (let i = 0; i < 20; i++) useUiPrefs.getState().bumpPartnerFont(-1);
    expect(useUiPrefs.getState().partnerFontPx).toBe(11);
  });

  it("persists to localStorage", () => {
    useUiPrefs.getState().bumpPartnerFont(1);
    expect(localStorage.getItem("conva.partner.fontPx")).toBe(
      String(useUiPrefs.getState().partnerFontPx),
    );
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/state/uiPrefs.partner.test.ts`
Expected: FAIL — `partnerFontPx` doesn't exist (TS error / undefined).

- [ ] **Step 3: Add the pref to `src/state/uiPrefs.ts`**

Add below `const COLLAPSE_YOU_KEY = …`:

```ts
const PARTNER_FONT_KEY = "conva.partner.fontPx";
```

Add to the `UiPrefs` interface (after `collapseYou: boolean;`):

```ts
  /** Partner-window content text size, in px — its own setting (spec §4.2):
   *  the detached window often sits farther away than the in-app panel. */
  partnerFontPx: number;
```

and after `bumpTranscriptFont: (delta: number) => void;`:

```ts
  bumpPartnerFont: (delta: number) => void;
```

Add to the store object (after the `collapseYou:` line):

```ts
  partnerFontPx: loadFont(PARTNER_FONT_KEY, FONT_DEFAULT),
```

and after the `bumpTranscriptFont` implementation:

```ts
  bumpPartnerFont: (delta) =>
    set((s) => {
      const clamped = Math.max(FONT_MIN, Math.min(FONT_MAX, s.partnerFontPx + delta));
      localStorage.setItem(PARTNER_FONT_KEY, String(clamped));
      return { partnerFontPx: clamped };
    }),
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/state/uiPrefs.partner.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Add the `lock`/`unlock` glyphs**

In `src/components/ui/Icon.tsx`: add `| "lock" | "unlock"` to the `IconName` union (next to `"pin"`), and add to the glyph map (next to the `pin:` entry, matching its stroke style):

```tsx
  // Lock — partner window follows the app (closed shackle).
  lock: (
    <>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </>
  ),
  // Unlock — partner window floats free (open shackle).
  unlock: (
    <>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 7.6-1.7" />
    </>
  ),
```

In `src/components/ui/Icon.test.tsx`, add inside the existing `describe`:

```tsx
  it("renders the partner-window lock icons", () => {
    const { container, rerender } = render(<Icon name="lock" />);
    expect(container.querySelector("svg")).toBeInTheDocument();
    rerender(<Icon name="unlock" />);
    expect(container.querySelector("svg")).toBeInTheDocument();
  });
```

- [ ] **Step 6: Raise the ally card cap 6 → 12**

In `src/state/ally.ts`, in `request:`, change:

```ts
        ...s.cards.slice(0, 5),
```

to:

```ts
        // Keep enough history for several partner-window tabs' answers to
        // coexist (spec §4.1) — the newest 12, not 6.
        ...s.cards.slice(0, 11),
```

(If the old line's preceding comment says "Keep the last few cards; newest first." leave it — the new comment sits on the changed line.)

- [ ] **Step 7: Typecheck + full suite**

Run: `npx tsc -b && npx vitest run`
Expected: PASS — no existing test asserts the 6-card cap (if one does, update its expectation to 12 and note it in the commit body).

- [ ] **Step 8: Commit**

```bash
git add src/state/uiPrefs.ts src/state/uiPrefs.partner.test.ts src/components/ui/Icon.tsx src/components/ui/Icon.test.tsx src/state/ally.ts
git commit -m "feat(partner): partnerFontPx pref, lock/unlock glyphs, 12-card ally history"
```

---

### Task 4: PartnerWindow — tabs

**Files:**
- Modify: `src/components/partner/PartnerWindow.tsx` (read the CURRENT file first — do not edit from memory)
- Test: Create `src/components/partner/PartnerWindow.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `src/components/partner/PartnerWindow.test.tsx`:

```tsx
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PartnerPayload } from "@/lib/ipc";
import { useAllyStore } from "@/state/ally";

const subscribers: Record<string, (p: unknown) => void> = {};
const backend = {
  partner: {
    payload: vi.fn().mockResolvedValue(null),
    redock: vi.fn().mockResolvedValue(undefined),
    locked: vi.fn().mockResolvedValue(true),
    setLocked: vi.fn().mockResolvedValue(undefined),
  },
  rag: {
    list: vi.fn().mockResolvedValue([]),
    documentText: vi.fn().mockResolvedValue("full document body"),
  },
  ally: { run: vi.fn().mockResolvedValue(undefined) },
  subscribe: vi.fn((event: string, cb: (p: unknown) => void) => {
    subscribers[event] = cb;
    return Promise.resolve(() => {});
  }),
};

vi.mock("@/lib/useIpcBridge", () => ({ useIpcBridge: () => {} }));
vi.mock("@/lib/backend", () => ({
  useBackend: () => backend,
  getBackend: () => backend,
}));

import { PartnerWindow } from "@/components/partner/PartnerWindow";

function payload(overrides: Partial<PartnerPayload> = {}): PartnerPayload {
  return {
    term: "API Gateway",
    kind: "concept",
    preview: null,
    answer: "It fronts your APIs.",
    source_lines: [],
    ...overrides,
  };
}

async function deliver(p: PartnerPayload) {
  await act(async () => {
    subscribers["partnerTerm"]?.(p);
  });
}

afterEach(cleanup);

describe("PartnerWindow tabs", () => {
  beforeEach(() => {
    useAllyStore.getState().clear();
    for (const k of Object.keys(subscribers)) delete subscribers[k];
    vi.clearAllMocks();
    backend.partner.payload.mockResolvedValue(null);
    backend.partner.locked.mockResolvedValue(true);
    backend.rag.list.mockResolvedValue([]);
  });

  it("accumulates delivered payloads as tabs instead of replacing", async () => {
    await act(async () => {
      render(<PartnerWindow />);
    });
    await deliver(payload({ term: "API Gateway" }));
    await deliver(payload({ term: "Lambda" }));
    expect(screen.getByRole("tab", { name: /API Gateway/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Lambda/ })).toBeInTheDocument();
    // Newest delivery is the active tab.
    expect(screen.getByRole("tab", { name: /Lambda/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("re-delivering an identical payload focuses the existing tab", async () => {
    await act(async () => {
      render(<PartnerWindow />);
    });
    await deliver(payload({ term: "API Gateway" }));
    await deliver(payload({ term: "Lambda" }));
    await deliver(payload({ term: "API Gateway" }));
    expect(screen.getAllByRole("tab", { name: /API Gateway/ })).toHaveLength(1);
    expect(screen.getByRole("tab", { name: /API Gateway/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("switching tabs switches the rendered content", async () => {
    await act(async () => {
      render(<PartnerWindow />);
    });
    await deliver(payload({ term: "API Gateway", answer: "Fronts APIs." }));
    await deliver(payload({ term: "Lambda", answer: "Runs functions." }));
    expect(screen.getByText("Runs functions.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: /API Gateway/ }));
    expect(screen.getByText("Fronts APIs.")).toBeInTheDocument();
    expect(screen.queryByText("Runs functions.")).toBeNull();
  });

  it("closing the active tab activates its neighbor; closing the last shows the empty state", async () => {
    await act(async () => {
      render(<PartnerWindow />);
    });
    await deliver(payload({ term: "API Gateway" }));
    await deliver(payload({ term: "Lambda" }));
    fireEvent.click(screen.getByRole("button", { name: 'Close "Lambda"' }));
    expect(screen.queryByRole("tab", { name: /Lambda/ })).toBeNull();
    expect(screen.getByRole("tab", { name: /API Gateway/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    fireEvent.click(screen.getByRole("button", { name: 'Close "API Gateway"' }));
    expect(screen.getByText(/Open a term from the Terms tab/)).toBeInTheDocument();
  });

  it("researches a fresh term tagged to its tab, so another tab's answer never bleeds in", async () => {
    await act(async () => {
      render(<PartnerWindow />);
    });
    await deliver(payload({ term: "Fresh term", answer: null }));
    // The window issued a research request tagged partner::<tabKey>.
    const card = useAllyStore.getState().cards[0];
    expect(card?.sourceKey).toMatch(/^partner::item::Fresh term::/);
    // Stream an answer into that card, then open a second tab: the first
    // tab's answer must not render under the second.
    act(() => {
      useAllyStore.getState().applyChunk({
        request_id: card!.id,
        token: "Streamed answer.",
        done: true,
        error: null,
      });
    });
    await deliver(payload({ term: "Other", answer: "Other's answer." }));
    expect(screen.getByText("Other's answer.")).toBeInTheDocument();
    expect(screen.queryByText("Streamed answer.")).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: /Fresh term/ }));
    expect(screen.getByText("Streamed answer.")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/components/partner/PartnerWindow.test.tsx`
Expected: FAIL — no `role="tab"` elements exist yet (current window renders a single payload).

- [ ] **Step 3: Rewrite `PartnerWindow.tsx` for tabs**

Replace the component's state/effect/derivation section. The current file's imports, `close`/`minimize` helpers, title bar, and Ask-bar JSX stay; the `payload`/`openedFor`/`openPayload` block and the body's `!payload` branch change. The resulting file (complete, current-style — verify against the working tree before replacing):

```tsx
import { useCallback, useEffect, useState } from "react";

import { derivePartnerAnswer } from "@/components/partner/deriveAnswer";
import {
  addOrFocus,
  closeTab,
  itemTab,
  tabLabel,
  type PartnerTab,
} from "@/components/partner/partnerTabs";
import { Icon } from "@/components/ui/Icon";
import { useBackend } from "@/lib/backend";
import { useIpcBridge } from "@/lib/useIpcBridge";
import { useAllyStore } from "@/state/ally";

/**
 * The partner window's whole view (`?partner=1` — see `src/main.tsx` and
 * `src-tauri/src/partner.rs`). THE viewer (owner, 2026-08-22): a real OS
 * window, docked to the app's right edge by default, not an internal
 * drawer — every "open in viewer" affordance in the main window routes
 * here. Every delivery becomes a TAB (spec §4.1) — opening a second item
 * keeps the first; re-opening an item focuses its existing tab. Each tab's
 * research/follow-ups are tagged `partner::<tabKey>` via the ally request's
 * `source` param, so per-tab content is a filter over this window's own
 * ally store (each webview has its own store instance; `conva://*` events
 * are emitted app-wide).
 */
export function PartnerWindow() {
  useIpcBridge();
  const backend = useBackend();
  const [tabs, setTabs] = useState<PartnerTab[]>([]);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const cards = useAllyStore((s) => s.cards);
  const busy = useAllyStore((s) => s.busy);
  const [ask, setAsk] = useState("");

  /** Kick off the tab's research if it's a fresh term with no answer yet —
   *  on first open, and again on focus (heals a cap-evicted answer). */
  const ensureResearched = useCallback((tab: PartnerTab) => {
    if (tab.kind !== "item" || tab.payload.answer !== null) return;
    const store = useAllyStore.getState();
    const key = `partner::${tab.key}`;
    if (store.busy || store.cards.some((c) => c.sourceKey === key)) return;
    const context = tab.payload.preview
      ? ` Known so far: ${tab.payload.preview}`
      : "";
    void store.request(
      "question",
      `Research "${tab.payload.term}" in depth for this conversation: a concise definition, the standard approaches or fixes, and how it connects to my material.${context}`,
      { key, quote: tab.payload.term },
    );
  }, []);

  const openTab = useCallback(
    (tab: PartnerTab) => {
      setTabs((prev) => addOrFocus(prev, tab).tabs);
      setActiveKey(tab.key);
      ensureResearched(tab);
    },
    [ensureResearched],
  );

  // Initial payload on boot + re-targeting events while open.
  useEffect(() => {
    let alive = true;
    void backend.partner.payload().then((p) => {
      if (alive && p) openTab(itemTab(p));
    });
    let unsub: (() => void) | undefined;
    void backend
      .subscribe("partnerTerm", (p) => openTab(itemTab(p)))
      .then((un) => {
        if (alive) unsub = un;
        else un();
      });
    return () => {
      alive = false;
      unsub?.();
    };
  }, [backend, openTab]);

  const close = async () => {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().close();
  };
  const minimize = async () => {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().minimize();
  };

  const active = tabs.find((t) => t.key === activeKey) ?? null;
  // Per-tab content: the newest card tagged for this tab wins over the
  // payload's already-answered text (asking something new shows the new
  // thing — same rule as before, now per tab).
  const activeCard = active
    ? (cards.find((c) => c.sourceKey === `partner::${active.key}`) ?? null)
    : null;
  const {
    heading: answerHeading,
    text: answerText,
    error: answerError,
    sources,
  } = derivePartnerAnswer(
    active?.kind === "item" ? active.payload : null,
    activeCard,
  );

  const submitAsk = () => {
    const q = ask.trim();
    if (!q || !active) return;
    setAsk("");
    void useAllyStore
      .getState()
      .request("question", `About "${tabLabel(active)}": ${q}`, {
        key: `partner::${active.key}`,
        quote: tabLabel(active),
      });
  };

  return (
    <div className="flex h-screen flex-col overflow-hidden border border-border-strong bg-bg text-fg">
      {/* Title bar — the drag region. */}
      <header
        data-tauri-drag-region
        className="flex h-[34px] shrink-0 items-center gap-2 border-b border-border bg-bg-2 px-3"
      >
        <span data-tauri-drag-region className="font-bold text-ai">
          ✦
        </span>
        <span
          data-tauri-drag-region
          className="min-w-0 flex-1 truncate text-xs font-bold"
        >
          Ally{active ? ` — ${tabLabel(active)}` : ""}
        </span>
        <button
          type="button"
          onClick={() => void backend.partner.redock()}
          title="Re-dock to the app's right side"
          aria-label="Re-dock to the app's right side"
          className="rounded px-1.5 py-0.5 text-fg-faint hover:text-fg"
        >
          ⇥
        </button>
        <button
          type="button"
          onClick={() => void minimize()}
          title="Minimize"
          aria-label="Minimize"
          className="rounded px-1.5 py-0.5 text-fg-faint hover:text-fg"
        >
          —
        </button>
        <button
          type="button"
          onClick={() => void close()}
          title="Close"
          aria-label="Close"
          className="rounded px-1.5 py-0.5 text-fg-faint hover:text-rec"
        >
          ×
        </button>
      </header>

      {/* Tab strip — one tab per open item (spec §4.1); the sanctioned
          exclusive-tab silhouette (2px top spine + raised fill). */}
      {tabs.length > 0 && (
        <div
          role="tablist"
          aria-label="Open items"
          className="flex shrink-0 items-stretch overflow-x-auto border-b border-border bg-bg-2"
        >
          {tabs.map((t) => {
            const isActive = t.key === activeKey;
            return (
              <div
                key={t.key}
                className={[
                  "relative flex h-[30px] shrink-0 items-stretch border-r border-border",
                  isActive ? "bg-panel-raised" : "",
                ].join(" ")}
              >
                {isActive && (
                  <span
                    className="absolute inset-x-0 top-0 h-[2px] bg-primary"
                    aria-hidden
                  />
                )}
                <button
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => {
                    setActiveKey(t.key);
                    ensureResearched(t);
                  }}
                  className={[
                    "max-w-[16ch] truncate pl-2.5 pr-1 text-[11.5px]",
                    isActive
                      ? "font-bold text-primary"
                      : "font-semibold text-fg-faint hover:text-fg",
                  ].join(" ")}
                >
                  {tabLabel(t)}
                </button>
                <button
                  type="button"
                  title="Close tab"
                  aria-label={`Close "${tabLabel(t)}"`}
                  onClick={() => {
                    const r = closeTab(tabs, t.key, activeKey);
                    setTabs(r.tabs);
                    setActiveKey(r.activeKey);
                  }}
                  className="pr-2 text-fg-faint hover:text-rec"
                >
                  <Icon name="close" size={10} />
                </button>
              </div>
            );
          })}
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
        {!active ? (
          <p className="mt-8 text-center text-xs text-fg-faint">
            Open a term from the Terms tab to research it here.
          </p>
        ) : (
          <>
            <div>
              <h2 className="text-lg font-extrabold">{tabLabel(active)}</h2>
              {active.kind === "item" && active.payload.kind && (
                <p className="mt-0.5 font-mono text-[10px] uppercase text-fg-faint">
                  {active.payload.kind}
                </p>
              )}
            </div>

            {active.kind === "item" && active.payload.preview && (
              <div className="border border-ai/34 bg-ai/[0.06] p-3">
                <h4 className="mb-1.5 font-mono text-[10px] font-bold tracking-[0.14em] text-ai">
                  PREVIEW
                </h4>
                <p className="text-[13px] leading-relaxed">
                  {active.payload.preview}
                </p>
              </div>
            )}

            <div className="rounded-[var(--radius)] border border-border bg-bg-2 p-3">
              <h4 className="mb-1.5 font-mono text-[10px] font-bold tracking-[0.14em] text-fg-muted">
                {answerHeading}
              </h4>
              {answerError ? (
                <p className="text-[12.5px] text-rec">{answerError}</p>
              ) : (
                <p className="whitespace-pre-line text-[12.5px] leading-relaxed text-fg-muted">
                  {answerText || (busy ? "Researching…" : "…")}
                </p>
              )}
            </div>

            {sources.length > 0 && (
              <div className="rounded-[var(--radius)] border border-border bg-bg-2 p-3">
                <h4 className="mb-1.5 font-mono text-[10px] font-bold tracking-[0.14em] text-fg-muted">
                  FROM YOUR DOCUMENTS
                </h4>
                {sources.map((s) => (
                  <p key={s} className="text-[12px] text-fg-muted">
                    {s}
                  </p>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* Follow-up ask — tags the ACTIVE tab. */}
      <div className="shrink-0 border-t border-border px-3 py-2.5">
        <label className="flex h-9 items-center gap-2.5 rounded-[4px] border border-ai/30 bg-white/[0.04] px-3 transition-colors focus-within:border-ai/60">
          <Icon name="lightbulb" size={16} className="shrink-0 text-ai/70" />
          <input
            value={ask}
            onChange={(e) => setAsk(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submitAsk()}
            placeholder="Ask a follow-up…"
            aria-label="Ask a follow-up"
            className="min-w-0 flex-1 bg-transparent text-sm text-fg placeholder:text-fg-faint focus:outline-none"
          />
          <button
            type="button"
            onClick={submitAsk}
            disabled={busy || !ask.trim()}
            title="Ask Ally"
            aria-label="Ask Ally"
            className="shrink-0 rounded-[4px] p-1.5 text-ai transition-colors hover:bg-ai/10 disabled:opacity-30"
          >
            <Icon name="chevron" size={16} className="rotate-90" />
          </button>
        </label>
      </div>
    </div>
  );
}
```

Notes for the implementer:
- `clearAlly` is gone on purpose — clearing on delivery would wipe other tabs' answers.
- The old `request` store selector is gone; `submitAsk`/`ensureResearched` read `useAllyStore.getState()` directly to avoid stale closures.
- `payload`/`openedFor`/`openPayload` are fully replaced by `tabs`/`addOrFocus`.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/components/partner/PartnerWindow.test.tsx src/components/partner/partnerTabs.test.ts`
Expected: PASS (14 tests).

- [ ] **Step 5: Full suite + typecheck**

Run: `npx tsc -b && npx vitest run`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/partner/PartnerWindow.tsx src/components/partner/PartnerWindow.test.tsx
git commit -m "feat(partner): tabs — every opened item accumulates instead of replacing"
```

---

### Task 5: PartnerWindow — Aa font menu

**Files:**
- Modify: `src/components/partner/PartnerWindow.tsx`
- Test: Modify `src/components/partner/PartnerWindow.test.tsx`

- [ ] **Step 1: Write the failing tests** (append to the existing describe file, new describe block)

```tsx
describe("PartnerWindow font menu", () => {
  beforeEach(() => {
    useAllyStore.getState().clear();
    for (const k of Object.keys(subscribers)) delete subscribers[k];
    vi.clearAllMocks();
    backend.partner.payload.mockResolvedValue(null);
    backend.partner.locked.mockResolvedValue(true);
    backend.rag.list.mockResolvedValue([]);
    localStorage.removeItem("conva.partner.fontPx");
  });

  it("A+ bumps the persisted partner font size", async () => {
    await act(async () => {
      render(<PartnerWindow />);
    });
    fireEvent.click(screen.getByRole("button", { name: "Text size" }));
    fireEvent.click(screen.getByRole("button", { name: "Larger text" }));
    expect(localStorage.getItem("conva.partner.fontPx")).toBe("15");
  });

  it("applies the font size to the content body", async () => {
    await act(async () => {
      render(<PartnerWindow />);
    });
    fireEvent.click(screen.getByRole("button", { name: "Text size" }));
    fireEvent.click(screen.getByRole("button", { name: "Larger text" }));
    expect(document.querySelector('[data-testid="partner-body"]')).toHaveStyle({
      fontSize: "15px",
    });
  });
});
```

Also add to the file's imports: nothing new (all already imported).

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/components/partner/PartnerWindow.test.tsx`
Expected: FAIL — no "Text size" button exists.

- [ ] **Step 3: Implement the menu + em conversions**

In `PartnerWindow.tsx`:

a) Add imports:

```tsx
import { ALLY_FONT_MAX, ALLY_FONT_MIN, useUiPrefs } from "@/state/uiPrefs";
```

b) Inside the component, after the `ask` state:

```tsx
  const partnerFontPx = useUiPrefs((s) => s.partnerFontPx);
  const bumpPartnerFont = useUiPrefs((s) => s.bumpPartnerFont);
  const [fontMenuOpen, setFontMenuOpen] = useState(false);
```

c) In the title bar, insert BEFORE the ⇥ button:

```tsx
        <button
          type="button"
          onClick={() => setFontMenuOpen((o) => !o)}
          title="Text size"
          aria-label="Text size"
          aria-expanded={fontMenuOpen}
          className={`rounded px-1.5 py-0.5 text-[11px] font-bold ${fontMenuOpen ? "text-fg" : "text-fg-faint hover:text-fg"}`}
        >
          Aa
        </button>
```

d) Directly after the `</header>` closing tag, add the anchored menu (same backdrop pattern as `AllyMetaPanel`'s options menu):

```tsx
      {fontMenuOpen && (
        <>
          <button
            type="button"
            aria-hidden
            tabIndex={-1}
            onClick={() => setFontMenuOpen(false)}
            className="fixed inset-0 z-40 cursor-default"
          />
          <div
            role="menu"
            aria-label="Text size"
            className="glass-raised absolute right-2 top-[38px] z-50 flex items-center gap-1 rounded-lg border border-border p-2 shadow-[var(--shadow-lg)]"
          >
            <button
              type="button"
              onClick={() => bumpPartnerFont(-1)}
              disabled={partnerFontPx <= ALLY_FONT_MIN}
              aria-label="Smaller text"
              className="grid h-6 w-6 place-items-center rounded border border-border text-fg-muted hover:text-fg disabled:opacity-30"
            >
              A−
            </button>
            <span className="w-10 text-center font-mono text-[11px] text-fg-faint">
              {partnerFontPx}px
            </span>
            <button
              type="button"
              onClick={() => bumpPartnerFont(1)}
              disabled={partnerFontPx >= ALLY_FONT_MAX}
              aria-label="Larger text"
              className="grid h-6 w-6 place-items-center rounded border border-border text-fg-muted hover:text-fg disabled:opacity-30"
            >
              A+
            </button>
          </div>
        </>
      )}
```

Note: the window root needs `relative` for the anchored menu — change the root div's className from `flex h-screen flex-col …` to `relative flex h-screen flex-col …`.

e) Scale the content body (chrome — title bar, tab strip, Ask bar — stays fixed). Change the body wrapper:

```tsx
      <div
        data-testid="partner-body"
        style={{ fontSize: partnerFontPx }}
        className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4"
      >
```

f) Convert the body's fixed px classes to em (exact mappings, spec §4.2):

| Old | New |
|---|---|
| `text-lg font-extrabold` (h2) | `text-[1.3em] font-extrabold` |
| `font-mono text-[10px] uppercase text-fg-faint` (kind eyebrow) | `font-mono text-[0.72em] uppercase text-fg-faint` |
| `text-[10px]` in the three `h4` section headings | `text-[0.72em]` |
| `text-[13px] leading-relaxed` (preview p) | `text-[0.93em] leading-relaxed` |
| `text-[12.5px] text-rec` (error p) | `text-[0.9em] text-rec` |
| `whitespace-pre-line text-[12.5px] …` (answer p) | `whitespace-pre-line text-[0.9em] …` |
| `text-[12px] text-fg-muted` (source lines) | `text-[0.86em] text-fg-muted` |
| `text-xs text-fg-faint` (empty state p) | `text-[0.86em] text-fg-faint` |

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/components/partner/PartnerWindow.test.tsx`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/partner/PartnerWindow.tsx src/components/partner/PartnerWindow.test.tsx
git commit -m "feat(partner): Aa title-bar menu — own persisted font size, em-scaled body"
```

---

### Task 6: PartnerWindow — document tabs

**Files:**
- Modify: `src/components/partner/PartnerWindow.tsx`
- Test: Modify `src/components/partner/PartnerWindow.test.tsx`

- [ ] **Step 1: Write the failing tests** (append, new describe block)

```tsx
describe("PartnerWindow document tabs", () => {
  beforeEach(() => {
    useAllyStore.getState().clear();
    for (const k of Object.keys(subscribers)) delete subscribers[k];
    vi.clearAllMocks();
    backend.partner.payload.mockResolvedValue(null);
    backend.partner.locked.mockResolvedValue(true);
    backend.rag.list.mockResolvedValue([
      { id: "doc-1", file_name: "aws.pdf" },
    ]);
    backend.rag.documentText.mockResolvedValue("full document body");
  });

  it("a source line matching a library document opens it as a tab with its text", async () => {
    await act(async () => {
      render(<PartnerWindow />);
    });
    await deliver(
      payload({
        term: "API Gateway",
        answer: "Fronts APIs.",
        source_lines: ["aws.pdf — ¶1–4", "missing.txt — ¶2"],
      }),
    );
    // The matching line is a button; the unmatched one is plain text.
    const openDoc = await screen.findByRole("button", {
      name: 'Open "aws.pdf"',
    });
    expect(screen.queryByRole("button", { name: 'Open "missing.txt"' })).toBeNull();
    fireEvent.click(openDoc);
    expect(
      screen.getByRole("tab", { name: /aws\.pdf/ }),
    ).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByText("full document body")).toBeInTheDocument();
    expect(backend.rag.documentText).toHaveBeenCalledWith("doc-1");
  });

  it("shows the unavailable message when the document text is null", async () => {
    backend.rag.documentText.mockResolvedValue(null);
    await act(async () => {
      render(<PartnerWindow />);
    });
    await deliver(
      payload({ answer: "x", source_lines: ["aws.pdf — ¶1"] }),
    );
    fireEvent.click(await screen.findByRole("button", { name: 'Open "aws.pdf"' }));
    expect(
      await screen.findByText("This document's text isn't available."),
    ).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/components/partner/PartnerWindow.test.tsx`
Expected: FAIL — no `Open "aws.pdf"` button.

- [ ] **Step 3: Implement**

In `PartnerWindow.tsx`:

a) Extend the partnerTabs import with `documentTab`:

```tsx
import {
  addOrFocus,
  closeTab,
  documentTab,
  itemTab,
  tabLabel,
  type PartnerTab,
} from "@/components/partner/partnerTabs";
```

b) Add state + the library-resolution effect (after the `fontMenuOpen` state):

```tsx
  // file_name -> doc id, resolved once from the library (spec §4.3 as
  // amended: AllySource carries no id, so the window resolves names itself).
  const [docIdsByName, setDocIdsByName] = useState<Map<string, string>>(
    () => new Map(),
  );
  // Loaded document bodies per doc id; undefined = still loading.
  const [docTexts, setDocTexts] = useState<Map<string, string | null>>(
    () => new Map(),
  );

  useEffect(() => {
    let alive = true;
    void backend.rag
      .list()
      .then((docs) => {
        if (!alive) return;
        setDocIdsByName(new Map(docs.map((d) => [d.file_name, d.id])));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [backend]);
```

c) Load the active document's text (after the `active` derivation):

```tsx
  const activeDocId = active?.kind === "document" ? active.docId : null;
  useEffect(() => {
    if (!activeDocId || docTexts.has(activeDocId)) return;
    let alive = true;
    void backend.rag.documentText(activeDocId).then((text) => {
      if (!alive) return;
      setDocTexts((m) => new Map(m).set(activeDocId, text));
    });
    return () => {
      alive = false;
    };
  }, [activeDocId, backend, docTexts]);
```

d) In the sources section, replace the `sources.map` body:

```tsx
                {sources.map((s) => {
                  const fileName = s.split(" — ")[0] ?? s;
                  const docId = docIdsByName.get(fileName);
                  return docId ? (
                    <button
                      key={s}
                      type="button"
                      title={`Open "${fileName}"`}
                      aria-label={`Open "${fileName}"`}
                      onClick={() => openTab(documentTab(docId, fileName))}
                      className="block text-left text-[0.86em] text-ai underline decoration-2 underline-offset-2 hover:brightness-110"
                    >
                      {s}
                    </button>
                  ) : (
                    <p key={s} className="text-[0.86em] text-fg-muted">
                      {s}
                    </p>
                  );
                })}
```

e) In the body, render a document tab's content. The `!active ? … : (<>…</>)` branch becomes three-way — replace the opening of the non-empty branch:

```tsx
        {!active ? (
          <p className="mt-8 text-center text-[0.86em] text-fg-faint">
            Open a term from the Terms tab to research it here.
          </p>
        ) : active.kind === "document" ? (
          <>
            <h2 className="text-[1.3em] font-extrabold">{active.fileName}</h2>
            <div className="rounded-[var(--radius)] border border-border bg-bg-2 p-3">
              {!docTexts.has(active.docId) ? (
                <p className="text-[0.9em] text-fg-faint">Loading…</p>
              ) : docTexts.get(active.docId) === null ? (
                <p className="text-[0.9em] text-fg-faint">
                  This document's text isn't available.
                </p>
              ) : (
                <p className="whitespace-pre-wrap text-[0.9em] leading-relaxed text-fg-muted">
                  {docTexts.get(active.docId)}
                </p>
              )}
            </div>
          </>
        ) : (
          <>
```

(The existing item-tab content follows unchanged as the final branch; a document tab issues no research request — `ensureResearched` already returns early for `kind !== "item"`.)

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/components/partner/PartnerWindow.test.tsx`
Expected: PASS (9 tests).

- [ ] **Step 5: Full suite + typecheck, then commit**

Run: `npx tsc -b && npx vitest run`
Expected: PASS.

```bash
git add src/components/partner/PartnerWindow.tsx src/components/partner/PartnerWindow.test.tsx
git commit -m "feat(partner): document tabs — citation lines open library docs in the viewer"
```

---

### Task 7: Mirrored IPC — `PARTNER_LOCK` event + backend wrappers

One commit: both sides of the contract + the TS plumbing (repo rule 2).

**Files:**
- Modify: `crates/conva-core/src/ipc.rs`
- Modify: `src/lib/ipc.ts`
- Modify: `src/lib/backend/events.ts`
- Modify: `src/lib/commands.ts`
- Modify: `src/lib/backend/ConvaBackend.ts`
- Modify: `src/lib/backend/tauri.ts`
- Modify: `src/lib/backend/web.ts`

- [ ] **Step 1: Rust side (`crates/conva-core/src/ipc.rs`)**

In the `events` mod, after `PARTNER_TERM`:

```rust
    /// The partner window's lock-to-app state changed shell-side (e.g. a
    /// manual drag released it) — the window updates its toggle icon.
    pub const PARTNER_LOCK: &str = "conva://partner-lock";
```

After the `PartnerPayload` struct:

```rust
/// Payload of [`events::PARTNER_LOCK`] — whether the partner window is
/// locked to (follows) the main window.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PartnerLockEvent {
    pub locked: bool,
}
```

- [ ] **Step 2: TS side (`src/lib/ipc.ts`)**

In the `EVENTS` const, after `partnerTerm`:

```ts
  partnerLock: "conva://partner-lock",
```

After the `PartnerPayload` interface:

```ts
/** Mirror of `ipc.rs::PartnerLockEvent` — sent when the shell changes the
 *  partner window's lock-to-app state (e.g. a manual drag released it). */
export interface PartnerLockEvent {
  locked: boolean;
}
```

- [ ] **Step 3: Event plumbing (`src/lib/backend/events.ts`)**

Add `PartnerLockEvent` to the `@/lib/ipc` type import; add to `EventMap`:

```ts
  partnerLock: PartnerLockEvent;
```

and to `EVENT_CHANNEL`:

```ts
  partnerLock: "conva://partner-lock",
```

- [ ] **Step 4: Command wrappers (`src/lib/commands.ts`)**

After `getPartnerPayload`:

```ts
/** Lock (follow the main window, snapping flush to its right edge) or
 *  unlock (float free) the partner window. Locking keeps the window's
 *  current size — only position follows. */
export function setPartnerLocked(locked: boolean): Promise<void> {
  return invoke("set_partner_locked", { locked });
}

/** Whether the partner window is currently locked to the main window. */
export function getPartnerLocked(): Promise<boolean> {
  return invoke<boolean>("get_partner_locked");
}
```

- [ ] **Step 5: Backend interface + adapters**

`src/lib/backend/ConvaBackend.ts` — extend the `partner` block:

```ts
    /** Lock (follow the app) / unlock (float free). Desktop-only. */
    setLocked(locked: boolean): Promise<void>;
    /** Current lock state; `false` where the window doesn't exist (web). */
    locked(): Promise<boolean>;
```

`src/lib/backend/tauri.ts` — extend the `partner` object:

```ts
    setLocked: cmd.setPartnerLocked,
    locked: cmd.getPartnerLocked,
```

`src/lib/backend/web.ts` — extend the `partner` object (benign no-ops, spec §4.4):

```ts
    setLocked: (): Promise<void> => Promise.resolve(),
    locked: (): Promise<boolean> => Promise.resolve(false),
```

- [ ] **Step 6: Verify + commit**

Run: `npx tsc -b && cargo test -p conva-core`
Expected: both PASS (the Rust additions are type/serde only; existing core tests still green).

```bash
git add crates/conva-core/src/ipc.rs src/lib/ipc.ts src/lib/backend/events.ts src/lib/commands.ts src/lib/backend/ConvaBackend.ts src/lib/backend/tauri.ts src/lib/backend/web.ts
git commit -m "feat(ipc): partner lock event + setLocked/locked wrappers (Rust<->TS mirrored)"
```

---

### Task 8: Shell — lock state, follow-on-move, auto-release (`partner.rs`)

⚠️ Not compilable in this sandbox — CI's Windows job verifies. Copy exactly.

**Files:**
- Modify: `src-tauri/src/partner.rs`

- [ ] **Step 1: Add lock state + suppression, rework `redock`, add `follow_main`/`on_partner_moved`/`set_locked`/`locked`**

At the top, extend imports:

```rust
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use conva_core::ipc::{events, PartnerLockEvent, PartnerPayload};
```

(keep the existing `tauri::{…}` import line unchanged).

After the `PAYLOAD` static:

```rust
/// Lock-to-app (spec §4.4): while true, the partner window follows the main
/// window flush at its right edge, keeping its own user-set size. Default on
/// for every app run.
static LOCKED: AtomicBool = AtomicBool::new(true);

/// The last position WE set (physical px). A partner `Moved` event matching
/// it (±2px for DPI rounding) is our own follow/snap echoing back — anything
/// else while locked is a user drag, which releases the lock.
static PROGRAMMATIC_POS: Mutex<Option<(i32, i32)>> = Mutex::new(None);

pub fn locked() -> bool {
    LOCKED.load(Ordering::SeqCst)
}

/// Set the lock state. Turning it ON also snaps the window flush to the
/// main window's right edge (keeping its size) so "locked" is immediately
/// visibly true.
pub fn set_locked(app: &AppHandle, locked: bool) -> Result<(), String> {
    LOCKED.store(locked, Ordering::SeqCst);
    if locked {
        snap(app)?;
    }
    Ok(())
}

/// Move the (open) partner window flush to the main window's right edge,
/// KEEPING its current size — position-only, unlike the old full-height
/// re-dock. Records the target so the resulting `Moved` event is
/// recognized as programmatic.
fn snap(app: &AppHandle) -> Result<(), String> {
    let Some(win) = app.get_webview_window(PARTNER_LABEL) else {
        return Ok(());
    };
    if let Some((x, y, _h)) = dock_rect(app) {
        let scale = win.scale_factor().map_err(|e| e.to_string())?;
        *PROGRAMMATIC_POS.lock().unwrap() =
            Some(((x * scale).round() as i32, (y * scale).round() as i32));
        win.set_position(LogicalPosition::new(x, y))
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Main window moved or resized: drag the locked partner along. Called from
/// `lib.rs`'s `on_window_event` hook. No-op when unlocked or not open.
pub fn follow_main(app: &AppHandle) {
    if locked() {
        let _ = snap(app);
    }
}

/// The partner window reported a move to `pos` (physical px). Our own
/// programmatic snap → ignore. A user drag while locked → release the lock
/// and tell the window so its toggle icon updates.
pub fn on_partner_moved(app: &AppHandle, pos: (i32, i32)) {
    if !locked() {
        return;
    }
    if let Some((px, py)) = *PROGRAMMATIC_POS.lock().unwrap() {
        if (pos.0 - px).abs() <= 2 && (pos.1 - py).abs() <= 2 {
            return;
        }
    }
    LOCKED.store(false, Ordering::SeqCst);
    let _ = app.emit(events::PARTNER_LOCK, PartnerLockEvent { locked: false });
}
```

- [ ] **Step 2: Rework `redock` to keep the user's size**

Replace the body of `pub fn redock`:

```rust
/// Snap the (open) partner window back flush to the main window's right
/// edge, keeping its current size, and focus it. A no-op when not open.
pub fn redock(app: &AppHandle) -> Result<(), String> {
    let Some(win) = app.get_webview_window(PARTNER_LABEL) else {
        return Ok(());
    };
    snap(app)?;
    win.show().map_err(|e| e.to_string())?;
    let _ = win.set_focus();
    Ok(())
}
```

(This removes the old `set_position` + `set_size` pair — `LogicalSize` may become an unused import; if so, drop it from the `tauri::{…}` import list. `dock_rect` itself is unchanged — its height still seeds the INITIAL size in `open`.)

- [ ] **Step 3: Doc-comment the module header**

Extend the module doc comment's first paragraph with one sentence:

```rust
//! Locked to the app by default (spec §4.4): while locked it follows the
//! main window (position only — the user's size sticks); dragging it
//! releases the lock; the title-bar toggle re-locks it.
```

- [ ] **Step 4: Format + commit**

Run: `cargo fmt`
Expected: clean (no compile here — CI verifies).

```bash
git add src-tauri/src/partner.rs
git commit -m "feat(partner): lock-to-app state — follow on main-window move, release on drag"
```

---

### Task 9: Shell — window-event hook + commands (`lib.rs`)

**Files:**
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add the two commands** (near the existing partner commands, after `get_partner_payload`)

```rust
/// Lock (follow the main window) / unlock (float free) the partner window.
/// Locking snaps it flush to the app's right edge, keeping its size.
#[tauri::command]
fn set_partner_locked(app: AppHandle, locked: bool) -> Result<(), String> {
    partner::set_locked(&app, locked)
}

/// Whether the partner window currently follows the main window.
#[tauri::command]
fn get_partner_locked() -> bool {
    partner::locked()
}
```

- [ ] **Step 2: Register them** in the `generate_handler![…]` list, right after `get_partner_payload`:

```rust
            set_partner_locked,
            get_partner_locked,
```

- [ ] **Step 3: Add the window-event hook.** On the `tauri::Builder` chain (adjacent to the `.setup(…)` call — immediately before it), add:

```rust
        // Lock-to-app (spec §4.4): the main window dragging its docked
        // partner along, and a manual partner drag releasing the lock.
        .on_window_event(|window, event| {
            let app = window.app_handle();
            match event {
                tauri::WindowEvent::Moved(pos) => match window.label() {
                    "main" => partner::follow_main(app),
                    l if l == partner::PARTNER_LABEL => {
                        partner::on_partner_moved(app, (pos.x, pos.y));
                    }
                    _ => {}
                },
                tauri::WindowEvent::Resized(_) => {
                    if window.label() == "main" {
                        partner::follow_main(app);
                    }
                }
                _ => {}
            }
        })
```

(`window.app_handle()` returns `&AppHandle` in Tauri 2, which is what `follow_main`/`on_partner_moved` take. `Moved` carries a `PhysicalPosition<i32>`.)

- [ ] **Step 4: Format + commit**

Run: `cargo fmt && cargo test -p conva-core`
Expected: fmt clean; core tests still PASS (lib.rs is the shell crate — compile-checked by CI's Windows job).

```bash
git add src-tauri/src/lib.rs
git commit -m "feat(shell): partner lock commands + main/partner window-move hook"
```

---

### Task 10: PartnerWindow — lock toggle UI (replaces ⇥)

**Files:**
- Modify: `src/components/partner/PartnerWindow.tsx`
- Test: Modify `src/components/partner/PartnerWindow.test.tsx`

- [ ] **Step 1: Write the failing tests** (append, new describe block)

```tsx
describe("PartnerWindow lock toggle", () => {
  beforeEach(() => {
    useAllyStore.getState().clear();
    for (const k of Object.keys(subscribers)) delete subscribers[k];
    vi.clearAllMocks();
    backend.partner.payload.mockResolvedValue(null);
    backend.partner.locked.mockResolvedValue(true);
    backend.rag.list.mockResolvedValue([]);
  });

  it("shows the locked state from the shell and toggles to unlocked", async () => {
    await act(async () => {
      render(<PartnerWindow />);
    });
    const toggle = await screen.findByRole("button", {
      name: /Locked to the app/,
    });
    fireEvent.click(toggle);
    expect(backend.partner.setLocked).toHaveBeenCalledWith(false);
    expect(
      screen.getByRole("button", { name: /Floating/ }),
    ).toBeInTheDocument();
  });

  it("updates the icon when the shell releases the lock (drag)", async () => {
    await act(async () => {
      render(<PartnerWindow />);
    });
    await screen.findByRole("button", { name: /Locked to the app/ });
    await act(async () => {
      subscribers["partnerLock"]?.({ locked: false });
    });
    expect(
      screen.getByRole("button", { name: /Floating/ }),
    ).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/components/partner/PartnerWindow.test.tsx`
Expected: FAIL — no lock toggle exists.

- [ ] **Step 3: Implement**

In `PartnerWindow.tsx`:

a) Add state + boot-read + shell-event subscription (after the `docTexts` state):

```tsx
  // Lock-to-app: Rust owns the truth (spec §4.4); this mirrors it for the
  // toggle icon. Boot-read + shell pushes (a manual drag releases the lock).
  const [locked, setLocked] = useState(true);
  useEffect(() => {
    let alive = true;
    void backend.partner.locked().then((v) => alive && setLocked(v));
    let unsub: (() => void) | undefined;
    void backend
      .subscribe("partnerLock", (e) => setLocked(e.locked))
      .then((un) => {
        if (alive) unsub = un;
        else un();
      });
    return () => {
      alive = false;
      unsub?.();
    };
  }, [backend]);

  const toggleLock = () => {
    const next = !locked;
    setLocked(next);
    void backend.partner.setLocked(next);
  };
```

b) Replace the ⇥ button in the title bar with:

```tsx
        <button
          type="button"
          onClick={toggleLock}
          aria-pressed={locked}
          title={
            locked
              ? "Locked to the app — click to float free"
              : "Floating — click to lock to the app"
          }
          aria-label={
            locked
              ? "Locked to the app — click to float free"
              : "Floating — click to lock to the app"
          }
          className={`rounded px-1.5 py-0.5 ${locked ? "text-primary" : "text-fg-faint hover:text-fg"}`}
        >
          <Icon name={locked ? "lock" : "unlock"} size={13} />
        </button>
```

(`backend.partner.redock` is no longer referenced — locking snaps shell-side.)

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/components/partner/PartnerWindow.test.tsx`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/partner/PartnerWindow.tsx src/components/partner/PartnerWindow.test.tsx
git commit -m "feat(partner): lock toggle replaces re-dock — mirrors the shell's lock state"
```

---

### Task 11: Full verification, push, tracking issue, draft PR

**Files:** none (verification + release chores)

- [ ] **Step 1: Full checks**

Run: `npm run build && npm test && cargo test -p conva-core && cargo fmt --check && cargo clippy -p conva-core --all-targets -- -D warnings`
Expected: all PASS. (Shell clippy runs on CI's Windows job.)

- [ ] **Step 2: Push**

```bash
git push -u origin claude/conva-app-ui-modernization-igllsd
```

(Retry up to 4× with 2s/4s/8s/16s backoff on network failure only.)

- [ ] **Step 3: Tracking issue + draft PR (GitHub MCP tools)**

1. Create an issue titled "Partner window: tabs for open items, font-size menu, document tabs, lock-to-app" summarizing the spec's §1 problems (one item at a time, no font control, inert source lines, dock-once-then-stranded) and linking the spec path.
2. Create a **draft** PR from `claude/conva-app-ui-modernization-igllsd` → `main`: title `feat(partner): tabs, font menu, document tabs, lock-to-app` (Conventional Commit — the hygiene gate enforces it); body opens with `Closes #<issue>` (the SDLC gate requires a closing keyword), then What/Changes/Testing sections; note plainly that the shell-side lock/follow behavior is compile-verified by CI's Windows job and needs the owner's manual pass (move app → partner follows with size kept; resize partner while locked → size sticks; drag partner → lock releases + icon flips; re-lock → snaps flush).
3. Subscribe to the PR's activity.

- [ ] **Step 4: Manual QA checklist (owner's Windows machine)**

- Open two terms from the Terms tab → both appear as tabs; switching preserves each answer; × closes.
- Ask a follow-up on tab A, switch to tab B and back → A's follow-up answer still there.
- Aa → A+ twice → all body text grows; reopen window → size remembered.
- Click a source line under FROM YOUR DOCUMENTS → the document opens as a tab with its text.
- Move the main window → partner follows flush (its size unchanged). Resize partner → sticks. Drag partner → icon flips to unlocked, following stops. Click the icon → snaps back flush and follows again.

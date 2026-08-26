# Spine-Icon Accordion Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The right panel becomes a spine-icon accordion — Questions · Tracking · Terms · Answers, icons overlaying the center divider at each section's top edge, one content section open at a time, Answers pinnable to a resizable bottom dock. The Ask box moves to the conversation column above the control bar, compacted. The FANER inline live-transcript marks are retired (Highlighter kept).

**Architecture:** A pure `panelSections` state model + two persisted prefs drive a new `AllyAccordion` component that re-homes the existing `FoundList`/`ViewHistory` content — data flows are untouched. `LiveControlBar` loses its tab zone; drawer mode gains one open-panel button. Frontend-only; no Rust changes.

**Tech Stack:** TypeScript/React/Zustand/vitest. Branch: `claude/conva-app-ui-modernization-igllsd` (freshly restarted from main — pushes need `--force-with-lease` the first time; a NEW draft PR is created at the end).

Spec: `docs/superpowers/specs/2026-08-26-spine-accordion-panel-design.md`.

**Standard commit trailer for every commit in this plan:**

```
Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Kot4sMxdR3d2DEJ8Z84nu6
```

---

### Task 1: Retire the FANER inline live-transcript marks

**Files:**
- Modify: `src/components/transcript/TranscriptView.tsx`
- Modify: `src/lib/faner.ts`
- Modify: `src/lib/faner.test.ts`

Owner decision (2026-08-26): "keep FANER's Highlighter, retire the inline live-transcript marks." Read every listed region before editing — this is surgical removal, not rewrite.

- [ ] **Step 1: TranscriptView.tsx.**
  - Delete the `FanerMark` component (~line 390-446) and `FanerAwareText` (~line 448-518) entirely, including their doc comments.
  - In `FlowText` (~line 655): remove the `captures` and `onAskFaner` props (type + destructure + doc comments); replace the `<FanerAwareText text={unit.text} captures={captures} terms={terms} onAskTerm={onAskTerm} onAskFaner={onAskFaner} onSendToAsk={onSendToAsk} />` render with `<HighlightedText text={unit.text} terms={terms} onAsk={onAskTerm} />`. If `onSendToAsk` becomes unused in FlowText after this, remove it from FlowText's props too (check — SelectionMenu is in `Bubble`, not FlowText).
  - In `Bubble` (~line 722): remove the `captures` and `onAskFaner` props and stop passing them to `FlowText` (~line 976); keep everything else (SelectionMenu, `onSendToAsk` where still used by SelectionMenu at ~line 1017).
  - At the cockpit level: remove the `captures`/`onAskFaner` arguments where Bubbles are rendered (~line 2679-2689 area — `onSendToAsk={sendToAsk}` stays if SelectionMenu still needs it; `onAskFaner={askFaner}` leaves the Bubble call). **KEEP the `askFaner` callback itself** (~line 2338) — Found's capture chips still use it via `onEntryFetchInfo`. Keep the `captures` state/store subscription — `foundGroups` still consumes captures for Terms chips.
  - Remove the now-unused imports from `@/lib/faner` (`collectFanerHits`, `fanerAccent`, `isFanerBoundaryMatch`, `FanerHit`) — keep `fanerPrompt`.
- [ ] **Step 2: faner.ts.** Delete `collectFanerHits`, `isFanerBoundaryMatch`, `fanerAccent`, the `FanerHit` interface, and `isWordChar` if nothing else uses it. **KEEP `fanerPrompt`** (and anything it needs). Update the module doc comment: the inline-mark helpers were retired 2026-08-26 (owner decision — Highlighter kept, marks removed); `fanerPrompt` remains for capture-chip asks.
- [ ] **Step 3: faner.test.ts.** Remove tests for the deleted functions; keep (or add, if none exists) a `fanerPrompt` test so the file still has coverage. If the file would be empty apart from that, that's fine.
- [ ] **Step 4: Verify.** `npm test` green (expect the total to DROP by however many faner tests were removed — report the number); `npm run build` clean; `grep -n "FanerMark\|FanerAwareText\|collectFanerHits\|fanerAccent\|isFanerBoundaryMatch" src -r` → only `FanerReplayPanel.tsx`'s own local copies (different names — `collectHits`/`captureAccent`) and nothing else.
- [ ] **Step 5: Commit.**

```bash
git add src/components/transcript/TranscriptView.tsx src/lib/faner.ts src/lib/faner.test.ts
git commit -m "feat(transcript): retire FANER inline marks — Highlighter kept"
```

(standard trailer; stage only those files.)

---

### Task 2: `question` + `target` icons

**Files:**
- Modify: `src/components/ui/Icon.tsx`
- Modify: `src/components/ui/Icon.test.tsx`

- [ ] **Step 1: Write the failing test.** Read `Icon.test.tsx` first and match its style; add assertions that `<Icon name="question" />` and `<Icon name="target" />` render an svg (same pattern as the existing name checks).
- [ ] **Step 2: Run to verify failure.** `npx vitest run src/components/ui/Icon.test.tsx` — FAIL (TS: name not in union).
- [ ] **Step 3: Implement.** Add `| "question"` and `| "target"` to `IconName`; add to `PATHS` (24×24 stroke style, matching neighbors):

```tsx
  // Questions section — a speech bubble carrying a question mark.
  question: (
    <>
      <path d="M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-7l-4 3.5V17H6a2 2 0 0 1-2-2z" />
      <path d="M10.2 8.6a2 2 0 0 1 3.8.7c0 1.3-1.9 1.5-1.9 2.7" />
      <path d="M12.1 14.4h.01" />
    </>
  ),
  // Tracking section — a target/crosshair (things being watched live).
  target: (
    <>
      <circle cx="12" cy="12" r="7" />
      <circle cx="12" cy="12" r="2.5" />
      <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3" />
    </>
  ),
```

- [ ] **Step 4: Run to verify pass.** `npx vitest run src/components/ui/Icon.test.tsx` — PASS. `npm run build` clean.
- [ ] **Step 5: Commit.**

```bash
git add src/components/ui/Icon.tsx src/components/ui/Icon.test.tsx
git commit -m "feat(ui): question + target icons for the panel spine"
```

---

### Task 3: `panelSections` pure state model

**Files:**
- Create: `src/components/transcript/panelSections.ts`
- Create: `src/components/transcript/panelSections.test.ts`

- [ ] **Step 1: Write the failing tests** — `panelSections.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  SECTION_ORDER,
  SECTION_META,
  selectSection,
  togglePin,
  revealAnswers,
  type PanelState,
} from "@/components/transcript/panelSections";

const pinned: PanelState = { open: "terms", answersPinned: true };
const unpinned: PanelState = { open: "questions", answersPinned: false };

describe("panelSections", () => {
  it("keeps a fixed section order with meta for each", () => {
    expect(SECTION_ORDER).toEqual(["questions", "tracking", "terms", "answers"]);
    for (const id of SECTION_ORDER) {
      expect(SECTION_META[id].label).toBeTruthy();
      expect(SECTION_META[id].icon).toBeTruthy();
    }
  });

  it("selects exclusively; re-selecting the open section is a no-op", () => {
    expect(selectSection(pinned, "questions")).toEqual({
      open: "questions",
      answersPinned: true,
    });
    expect(selectSection(pinned, "terms")).toBe(pinned);
  });

  it("ignores selecting answers while pinned (the dock is already visible)", () => {
    expect(selectSection(pinned, "answers")).toBe(pinned);
    expect(selectSection(unpinned, "answers").open).toBe("answers");
  });

  it("hands the open section over across pin toggles", () => {
    const nowUnpinned = togglePin(pinned);
    expect(nowUnpinned).toEqual({ open: "answers", answersPinned: false });
    const backPinned = togglePin({ open: "answers", answersPinned: false });
    expect(backPinned).toEqual({ open: "terms", answersPinned: true });
    // pinning while a content section is open keeps it open
    expect(togglePin({ open: "questions", answersPinned: false })).toEqual({
      open: "questions",
      answersPinned: true,
    });
  });

  it("revealAnswers opens the section only when unpinned", () => {
    expect(revealAnswers(pinned)).toBe(pinned);
    expect(revealAnswers(unpinned)).toEqual({
      open: "answers",
      answersPinned: false,
    });
  });
});
```

- [ ] **Step 2: Run to verify failure.** `npx vitest run src/components/transcript/panelSections.test.ts` — FAIL (module not found).
- [ ] **Step 3: Implement** — `panelSections.ts`:

```ts
import type { IconName } from "@/components/ui/Icon";

/**
 * The spine-icon accordion's pure state model (spec 2026-08-26): four
 * sections in a FIXED stacking order, exactly one content section open;
 * Answers can be pinned as an always-visible bottom dock, in which case
 * `open` names one of the three content sections. The spine icons render
 * at each section's top edge and slide with it — order never changes.
 */
export type PanelSectionId = "questions" | "tracking" | "terms" | "answers";

export const SECTION_ORDER: readonly PanelSectionId[] = [
  "questions",
  "tracking",
  "terms",
  "answers",
];

export const SECTION_META: Record<
  PanelSectionId,
  { label: string; icon: IconName; tone: "ai" | "primary" }
> = {
  questions: { label: "Questions", icon: "question", tone: "primary" },
  tracking: { label: "Tracking", icon: "target", tone: "primary" },
  terms: { label: "Terms", icon: "book", tone: "primary" },
  answers: { label: "Answers", icon: "ally", tone: "ai" },
};

export interface PanelState {
  open: PanelSectionId;
  answersPinned: boolean;
}

/** Exclusive accordion select. No-ops: re-selecting the open section, and
 *  selecting Answers while it's pinned (the dock is already on screen). */
export function selectSection(state: PanelState, id: PanelSectionId): PanelState {
  if (id === state.open) return state;
  if (id === "answers" && state.answersPinned) return state;
  return { ...state, open: id };
}

/** Pin toggle with open-section handoff: unpinning makes Answers the open
 *  section (it was visible — keep it visible); pinning while Answers was
 *  the open section falls back to Terms. */
export function togglePin(state: PanelState): PanelState {
  if (state.answersPinned) return { open: "answers", answersPinned: false };
  return {
    open: state.open === "answers" ? "terms" : state.open,
    answersPinned: true,
  };
}

/** "Asking is choosing" — make sure a streaming answer is on screen:
 *  pinned → the dock already is; unpinned → open the Answers section. */
export function revealAnswers(state: PanelState): PanelState {
  if (state.answersPinned || state.open === "answers") return state;
  return { ...state, open: "answers" };
}
```

- [ ] **Step 4: Run to verify pass.** The test file — 5/5 PASS.
- [ ] **Step 5: Commit.**

```bash
git add src/components/transcript/panelSections.ts src/components/transcript/panelSections.test.ts
git commit -m "feat(panel): panelSections — spine-accordion pure state model"
```

---

### Task 4: uiPrefs — `answersPinned` + `panelOpenSection`

**Files:**
- Modify: `src/state/uiPrefs.ts`
- Create: `src/state/uiPrefs.accordion.test.ts`

- [ ] **Step 1: Write the failing tests** — `uiPrefs.accordion.test.ts` (mirror the style of `uiPrefs.panel.test.ts` — read it first; reset via `setState` in `beforeEach` per this repo's Zustand-singleton lesson):

```ts
import { beforeEach, describe, expect, it } from "vitest";

import { useUiPrefs } from "@/state/uiPrefs";

describe("uiPrefs accordion", () => {
  beforeEach(() => {
    localStorage.clear();
    useUiPrefs.setState({ answersPinned: true, panelOpenSection: "terms" });
  });

  it("defaults: answers pinned, terms open", () => {
    expect(useUiPrefs.getState().answersPinned).toBe(true);
    expect(useUiPrefs.getState().panelOpenSection).toBe("terms");
  });

  it("persists pin + open section", () => {
    useUiPrefs.getState().setAnswersPinned(false);
    useUiPrefs.getState().setPanelOpenSection("questions");
    expect(localStorage.getItem("conva.panel.answersPinned")).toBe("false");
    expect(localStorage.getItem("conva.panel.openSection")).toBe("questions");
  });

  it("rejects an unknown stored section id", () => {
    useUiPrefs.getState().setPanelOpenSection("bogus" as never);
    expect(useUiPrefs.getState().panelOpenSection).toBe("terms");
  });
});
```

- [ ] **Step 2: Run to verify failure.** FAIL (fields not defined).
- [ ] **Step 3: Implement in `uiPrefs.ts`** following the file's existing pref pattern EXACTLY (read how `panelSplitRatio`/`partnerFontPx` load, clamp, persist — reuse the same helpers): `answersPinned: boolean` (key `conva.panel.answersPinned`, default `true`, stored as `"true"`/`"false"`); `panelOpenSection: PanelSectionId` (key `conva.panel.openSection`, default `"terms"`, validated with `SECTION_ORDER.includes(...)` on load AND in the setter — invalid → keep current/default; on load, `answersPinned && stored === "answers"` coerces to `"terms"`). Import the type/order from `@/components/transcript/panelSections` — if that import direction creates a cycle (panelSections imports Icon only, so it won't), inline the union instead and say so.
- [ ] **Step 4: Run to verify pass.** New file 3/3; then full `npm test` green; `npm run build` clean.
- [ ] **Step 5: Commit.**

```bash
git add src/state/uiPrefs.ts src/state/uiPrefs.accordion.test.ts
git commit -m "feat(panel): persisted accordion prefs — answersPinned + openSection"
```

---

### Task 5: `FoundList` single-group mode

**Files:**
- Modify: `src/components/transcript/FoundList.tsx`
- Modify: `src/components/transcript/FoundList.test.tsx`

- [ ] **Step 1: Write the failing tests** (append, matching the file's existing render-test style):

```tsx
  it("renders only the requested group with no eyebrow headers in only-mode", () => {
    render(
      <FoundList groups={sampleGroups()} onSelect={() => {}} only="questions" />,
    );
    // question rows present…
    expect(screen.getByText(/what is your experience/i)).toBeInTheDocument();
    // …no group eyebrows, and no other groups' items
    expect(screen.queryByText(/they asked/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/commitments/i)).not.toBeInTheDocument();
  });

  it("only=tracking renders commitments and mentions together", () => {
    render(
      <FoundList groups={sampleGroups()} onSelect={() => {}} only="tracking" />,
    );
    expect(screen.getByText(/send the contract/i)).toBeInTheDocument();
    expect(screen.getByText(/acme corp/i)).toBeInTheDocument();
  });
```

  Adapt the queried strings to the test file's ACTUAL existing fixture (`sampleGroups()` or whatever it's named — read it first and use its real labels; if no fixture builder exists, add one from the existing tests' inline data).

- [ ] **Step 2: Run to verify failure.** FAIL (`only` prop unknown / headers still render).
- [ ] **Step 3: Implement.** `FoundList` gains `only?: "questions" | "tracking" | "terms"`. With `only` set: render ONLY that group's items (`tracking` = commitments rows then mentions rows), with **no eyebrow headers** (the accordion section header replaces them), and an empty-state line per section ("Nothing yet — questions from the other side land here." / "Commitments and mentions appear as the call goes." / "Terms appear as they're detected — and from your grounded documents."). Without `only`: behavior byte-for-byte as today.
- [ ] **Step 4: Run to verify pass.** File suite green; full `npm test` green.
- [ ] **Step 5: Commit.**

```bash
git add src/components/transcript/FoundList.tsx src/components/transcript/FoundList.test.tsx
git commit -m "feat(panel): FoundList single-group mode for accordion sections"
```

---

### Task 6: `AllyAccordion` component

**Files:**
- Create: `src/components/transcript/AllyAccordion.tsx`
- Create: `src/components/transcript/AllyAccordion.test.tsx`

- [ ] **Step 1: Write the failing tests** — render with stub content, assert: all four spine icon buttons render (by `aria-label` = section labels); clicking a collapsed section's icon calls `onState` with `selectSection(...)` result; pinned mode shows the pin toggle pressed (`aria-pressed`) and the Answers content visible alongside an open content section; unpinned mode shows Answers content only when `open === "answers"`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AllyAccordion } from "@/components/transcript/AllyAccordion";

function setup(state: { open: any; answersPinned: boolean }, onState = vi.fn()) {
  render(
    <AllyAccordion
      state={state}
      onState={onState}
      counts={{ questions: 2, tracking: 1, terms: 3, answers: 1 }}
      splitRatio={0.5}
      onSplitRatio={() => {}}
      renderSection={(id) => <div data-testid={`content-${id}`} />}
    />,
  );
  return onState;
}

describe("AllyAccordion", () => {
  it("renders all four spine icons in order and marks the open one", () => {
    setup({ open: "terms", answersPinned: true });
    for (const label of ["Questions", "Tracking", "Terms", "Answers"]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
    expect(screen.getByTestId("content-terms")).toBeInTheDocument();
    expect(screen.queryByTestId("content-questions")).not.toBeInTheDocument();
  });

  it("selecting a collapsed section reports the accordion swap", () => {
    const onState = setup({ open: "terms", answersPinned: true });
    fireEvent.click(screen.getByRole("button", { name: "Questions" }));
    expect(onState).toHaveBeenCalledWith({ open: "questions", answersPinned: true });
  });

  it("pinned: answers dock is always visible with a pressed pin toggle", () => {
    setup({ open: "terms", answersPinned: true });
    expect(screen.getByTestId("content-answers")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /pin answers/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("unpinned: answers content only when open", () => {
    setup({ open: "questions", answersPinned: false });
    expect(screen.queryByTestId("content-answers")).not.toBeInTheDocument();
    const onState = setup({ open: "answers", answersPinned: false });
    expect(screen.getAllByTestId("content-answers").length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run to verify failure.** FAIL (module not found).
- [ ] **Step 3: Implement** — `AllyAccordion.tsx`:

```tsx
import type { ReactNode } from "react";

import {
  SECTION_META,
  SECTION_ORDER,
  selectSection,
  togglePin,
  type PanelSectionId,
  type PanelState,
} from "@/components/transcript/panelSections";
import { Icon } from "@/components/ui/Icon";

/**
 * The spine-icon accordion (spec 2026-08-26). Each section renders its own
 * spine icon chip absolutely positioned ON the panel's left border
 * (`left-0 -translate-x-1/2`) at the section's top edge — icons slide with
 * their sections while the stacking order stays fixed. Exactly one content
 * section is expanded; Answers can be pinned as a bottom dock whose height
 * is the (1 − splitRatio) share, resized by the divider above it (the
 * pref is shared with the retired split view — same key, same clamps).
 */
export function AllyAccordion({
  state,
  onState,
  counts,
  splitRatio,
  onSplitRatio,
  renderSection,
}: {
  state: PanelState;
  onState: (next: PanelState) => void;
  counts: Record<PanelSectionId, number>;
  splitRatio: number;
  onSplitRatio: (r: number) => void;
  renderSection: (id: PanelSectionId) => ReactNode;
}) {
  const select = (id: PanelSectionId) => {
    const next = selectSection(state, id);
    if (next !== state) onState(next);
  };

  const contentIds = SECTION_ORDER.filter(
    (id) => id !== "answers" || !state.answersPinned,
  );

  const sectionShell = (id: PanelSectionId) => {
    const meta = SECTION_META[id];
    const open = state.open === id;
    const lit = open || (id === "answers" && state.answersPinned);
    const count = counts[id];
    return (
      <div
        key={id}
        className={[
          "relative flex min-h-0 flex-col border-t border-border first:border-t-0",
          open ? "min-h-0 flex-1" : "shrink-0",
        ].join(" ")}
      >
        {/* Spine icon — overlays the center divider at this section's top. */}
        <button
          type="button"
          aria-label={meta.label}
          title={meta.label}
          onClick={() => select(id)}
          className={[
            "absolute left-0 top-1.5 z-40 grid h-[26px] w-[26px] -translate-x-1/2 place-items-center rounded-full border shadow-sm transition",
            lit
              ? meta.tone === "ai"
                ? "border-ai/60 bg-bg-2 text-ai"
                : "border-primary/60 bg-bg-2 text-primary"
              : "border-border bg-bg-2 text-fg-faint hover:text-fg",
          ].join(" ")}
        >
          <Icon name={meta.icon} size={14} />
        </button>
        <button
          type="button"
          onClick={() => select(id)}
          aria-expanded={open}
          className={[
            "flex h-9 shrink-0 items-center gap-2 pl-6 pr-3 text-left",
            open ? "text-fg" : "text-fg-muted hover:text-fg",
          ].join(" ")}
        >
          <span className="font-mono text-[10px] font-bold uppercase tracking-[0.18em]">
            {meta.label}
          </span>
          {count > 0 && (
            <span className="rounded-full border border-border px-1.5 text-[10px] text-fg-faint">
              {count}
            </span>
          )}
          {id === "answers" && (
            <span
              role="button"
              tabIndex={0}
              aria-pressed={state.answersPinned}
              aria-label="Pin Answers"
              title={state.answersPinned ? "Unpin Answers" : "Pin Answers"}
              onClick={(e) => {
                e.stopPropagation();
                onState(togglePin(state));
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.stopPropagation();
                  onState(togglePin(state));
                }
              }}
              className={`ml-auto grid h-6 w-6 place-items-center rounded ${
                state.answersPinned ? "text-ai" : "text-fg-faint hover:text-fg"
              }`}
            >
              <Icon name="pin" size={13} />
            </span>
          )}
        </button>
        {open && (
          <div className="min-h-0 flex-1 overflow-y-auto px-3.5 pb-3">
            {renderSection(id)}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        style={
          state.answersPinned ? { flexBasis: `${splitRatio * 100}%` } : undefined
        }
        className={[
          "flex min-h-0 flex-col",
          state.answersPinned ? "shrink-0 grow-0" : "min-h-0 flex-1",
        ].join(" ")}
      >
        {contentIds.map(sectionShell)}
      </div>

      {state.answersPinned && (
        <>
          <div
            role="separator"
            aria-orientation="horizontal"
            aria-label="Resize Answers"
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
          <div className="relative flex min-h-0 flex-1 flex-col">
            {(() => {
              const meta = SECTION_META.answers;
              return (
                <>
                  <span
                    aria-hidden
                    className="absolute left-0 top-1.5 z-40 grid h-[26px] w-[26px] -translate-x-1/2 place-items-center rounded-full border border-ai/60 bg-bg-2 text-ai shadow-sm"
                  >
                    <Icon name={meta.icon} size={14} />
                  </span>
                  <div className="flex h-9 shrink-0 items-center gap-2 pl-6 pr-3">
                    <span className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-fg">
                      {meta.label}
                    </span>
                    {counts.answers > 0 && (
                      <span className="rounded-full border border-border px-1.5 text-[10px] text-fg-faint">
                        {counts.answers}
                      </span>
                    )}
                    <button
                      type="button"
                      aria-pressed
                      aria-label="Pin Answers"
                      title="Unpin Answers"
                      onClick={() => onState(togglePin(state))}
                      className="ml-auto grid h-6 w-6 place-items-center rounded text-ai"
                    >
                      <Icon name="pin" size={13} />
                    </button>
                  </div>
                  <div className="min-h-0 flex-1 overflow-y-auto px-3.5 pb-3">
                    {renderSection("answers")}
                  </div>
                </>
              );
            })()}
          </div>
        </>
      )}
    </div>
  );
}
```

  NOTE for the accordion-with-pin case: when pinned, the dock is rendered OUTSIDE the `contentIds` map (the code above already does this — the header spine button in the dock reuses the pin toggle as a real `<button>` since the dock header isn't itself a select target). One spine button per section total — the pinned dock's chip is decorative (`aria-hidden` span) because selecting it is a no-op by model. Adjust the test's pin-toggle query accordingly (`getByRole("button", { name: /pin answers/i })` matches the dock's real button).

- [ ] **Step 4: Run to verify pass.** File suite green (adapt query specifics to what actually renders — the INTENT of each assertion must hold); full `npm test` green; `npm run build` clean.
- [ ] **Step 5: Commit.**

```bash
git add src/components/transcript/AllyAccordion.tsx src/components/transcript/AllyAccordion.test.tsx
git commit -m "feat(panel): AllyAccordion — spine icons, exclusive sections, pinnable answers"
```

---

### Task 7: Cockpit integration — AllyPanel body, ask box, control bar

**Files:**
- Modify: `src/components/transcript/TranscriptView.tsx`
- Modify: `src/components/studio/LiveControlBar.tsx`

Read all touched regions fully before editing. This is the surgical task; every anchor below refers to post-Task-1 line positions (grep, don't trust absolute numbers).

- [ ] **Step 1: `AllyPanel` body → accordion.** In `AllyPanel` (grep `function AllyPanel`):
  - Replace props `askField`, `view`, `splitRatio`, `onSplitRatio` with: `panelState: PanelState`, `onPanelState: (s: PanelState) => void`, `splitRatio: number`, `onSplitRatio: (r: number) => void` (splitRatio stays, view/askField go).
  - Replace the body block (the `view !== "details"` FoundList div, the `view === "split"` divider, and the `view !== "terms"` ViewHistory div — everything inside the `style={{ fontSize }}` wrapper) with:

```tsx
        <AllyAccordion
          state={panelState}
          onState={onPanelState}
          counts={{
            questions: groups.questions.length,
            tracking: groups.commitments.length + groups.mentions.length,
            terms: groups.terms.length,
            answers: viewEntries.length,
          }}
          splitRatio={splitRatio}
          onSplitRatio={onSplitRatio}
          renderSection={(id) =>
            id === "answers" ? (
              <div ref={scrollRef} onScroll={onBodyScroll} className="h-full overflow-y-auto">
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
            ) : (
              <FoundList groups={groups} onSelect={onSelectFound} only={id} />
            )
          }
        />
```

    (If nesting the scroll ref this way double-scrolls, put `ref={scrollRef}`/`onScroll` on the accordion's own answers content div instead via a dedicated prop — implementer's choice, report it. The auto-scroll behavior for streaming answers must keep working.)
  - Delete `{askField}` at the aside's foot.
- [ ] **Step 2: Cockpit state.** In the cockpit (grep `panelView`):
  - Remove `panelView`/`selectPanelTab` and the `AllyPanelView` import. Add:

```tsx
  const answersPinned = useUiPrefs((s) => s.answersPinned);
  const setAnswersPinned = useUiPrefs((s) => s.setAnswersPinned);
  const panelOpenSection = useUiPrefs((s) => s.panelOpenSection);
  const setPanelOpenSection = useUiPrefs((s) => s.setPanelOpenSection);
  const panelState = useMemo<PanelState>(
    () => ({ open: panelOpenSection, answersPinned }),
    [panelOpenSection, answersPinned],
  );
  const applyPanelState = useCallback(
    (next: PanelState) => {
      setPanelOpenSection(next.open);
      setAnswersPinned(next.answersPinned);
    },
    [setPanelOpenSection, setAnswersPinned],
  );
```

  - `ensureViewVisible` becomes `applyPanelState(revealAnswers(panelState))` (keep the same callback name so its many call sites stand; in drawer mode it ALSO does `setDrawerOpen(true)` — preserve the existing drawer-open side effects where they exist today via `selectPanelTab`).
  - Pass `panelState={panelState}` / `onPanelState={applyPanelState}` to `AllyPanel`; drop `view=`/`askField=`.
- [ ] **Step 3: Ask box.** Restyle `askAllyField` compact: container `px-2.5 py-1.5`, label `h-8`, input `text-[12px]`, lightbulb/send icons `14`. Render it unconditionally at the conversation section's bottom (replace `{drawer && askAllyField}` with `{askAllyField}`).
- [ ] **Step 4: LiveControlBar.** Remove the `tabs` prop, the `AllyPanelTab`/`AllyPanelView` type exports, and the whole tablist block; add `onOpenPanel?: () => void` rendering (when provided) a right-aligned compact button:

```tsx
      {onOpenPanel && (
        <button
          type="button"
          onClick={onOpenPanel}
          title="Open Ally panel"
          aria-label="Open Ally panel"
          className="grid w-12 shrink-0 place-items-center border-l border-border text-ai hover:bg-panel-raised/60"
        >
          <Icon name="ally" size={16} />
        </button>
      )}
```

  Update the component doc comment (tabs retired for the spine accordion, spec 2026-08-26). In the cockpit, replace the `tabs={...}` argument with `onOpenPanel={drawer ? () => setDrawerOpen(true) : undefined}`. Fix any other `LiveControlBar` call sites (grep — the compact path at ~line 2423 renders `<LiveControlBar />` bare; it can stay bare).
- [ ] **Step 5: Verify.** `npm test` full suite green; `npm run build` clean; `grep -n "AllyPanelTab\|AllyPanelView\|panelView" src -r` → no hits.
- [ ] **Step 6: Commit.**

```bash
git add src/components/transcript/TranscriptView.tsx src/components/studio/LiveControlBar.tsx
git commit -m "feat(live): spine-accordion panel wired — compact ask box, tabs retired"
```

---

### Task 8: CLAUDE.md rule 10 rewrite

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1:** Rewrite rule 10's panel paragraphs: the right `AllyPanel` is a **spine-icon accordion** (owner, 2026-08-26) — four sections in fixed order, Questions (`question` icon) · Tracking (`target`) · Terms (`book`) · Answers (`ally`, gold); icons overlay the center divider at each section's top edge and slide with it; exactly one content section open (exclusive; `panelSections.ts` is the model); Answers pinnable (default pinned) as a bottom dock resized by the divider (`conva.panel.splitRatio`), unpinned = fourth accordion section, `revealAnswers` on every ask; the control-bar Details/Terms tabs and the Found/View split are retired; the Ask box lives at the conversation column's foot (compact) at every width; drawer (<640px) = same accordion, opened via the control bar's Ally button. FANER inline transcript marks retired (2026-08-26, owner: "keep FANER's Highlighter, retire the inline live-transcript marks") — `HighlightedText` term underlines remain; capture chips remain in Terms. Keep the partner-window-is-the-viewer text and the conversation-column-is-text-only sentence unchanged. Note the supersession chain explicitly (this supersedes the 2026-08-22 split-tabs model the way that superseded the dock).
- [ ] **Step 2: Commit.**

```bash
git add CLAUDE.md
git commit -m "docs: CLAUDE.md rule 10 — spine-accordion panel model"
```

---

### Task 9: Verify, push, new issue + draft PR, subscribe

- [ ] **Step 1: Full gate.** `npm run build`, `npm test`, `cargo test -p conva-core`, `cargo fmt --check`, `cargo clippy -p conva-core --all-targets -- -D warnings` — ALL green.
- [ ] **Step 2: Push.** `git push --force-with-lease -u origin claude/conva-app-ui-modernization-igllsd` (the branch was restarted from main over the merged history — force-with-lease is expected and safe here; network-error retries ×4, 2/4/8/16s).
- [ ] **Step 3: New issue + draft PR** (inline, by the orchestrator): create an issue "Live panel: spine-icon accordion + compact ask box + FANER inline-mark retirement"; open a NEW draft PR (Conventional-Commit title, e.g. `feat(live): spine-icon accordion panel + compact ask box`, body with `Closes #<issue>`, the spec link, the section table, pin/resize behavior, ask-box move, FANER retirement scope, testing numbers, and a manual-QA checklist). Subscribe to PR activity.
- [ ] **Step 4: Watch CI.**

---

## Self-review notes

- Spec coverage: §1→Task 3; §2→Task 4; §3→Tasks 5-6; §4→Task 7 (ask box); §5→Task 7 (control bar); §6→Task 1; §7→Task 8; testing→Tasks 1-7, 9.
- Type consistency: `PanelSectionId`/`PanelState` defined once in `panelSections.ts`, imported by uiPrefs/AllyAccordion/TranscriptView; `only` prop's union is the three content ids (subset — Answers never routes to FoundList); `counts` is a full `Record<PanelSectionId, number>`.
- Task 1 first on purpose: it shrinks TranscriptView before Task 7 operates on it, and the two tasks' regions don't overlap with Tasks 2-6 (new files).
- Frontend-only round: core suite runs in Task 9 as a regression gate, no Rust edits anywhere.

# Live Cockpit: Active/View Panel Split — Implementation Plan

**Goal:** Split today's single Ally panel (Focus canvas + exclusive 4-section
accordion) into two permanently-visible panels — **Active** (3) stays the
existing spine-icon accordion, unchanged in mechanic, minus the Answers
section, each header carrying a NEW badge for unseen items — and **View**
(4), a new content-first surface where the selected item's answer/definition
dominates, the source item shrinks to one hover-tooltip icon, and Pin +
Elaborate are always one click. Clicking a highlighted term in the transcript
(2) does the same thing selecting it in Active does: rings it in both places
and loads it in View immediately.

**Mockup:** `https://claude.ai/artifact/1ms4rqZnRutFpmrjQ6Pero` (owner-approved
2026-09-28).

**Prior art — read before touching `AllyPanel`:**
- `docs/superpowers/plans/2026-08-22-live-panel-rescope.md` — the original
  Found/View split. `foundGroups.ts`, `FoundList.tsx`, `viewEntries.ts` all
  still exist from it and are reused here unchanged.
- `AllyFocusCanvas.tsx` — already implements almost everything View (4)
  needs: a tab strip over multiple open items, pin-floats-first, Refresh,
  Expand-to-partner-window, raw/formatted toggle. It is Questions-only
  today (`AllyFocusItem.question`/`.answer`); this plan generalizes it
  rather than replacing it.
- CLAUDE.md rule 10 — the current (soon stale) panel description; Task 6
  rewrites it.

**Architecture:** Presentation-layer only, same as the Aug-22 plan. No
Rust/IPC changes — `FoundItem`/`AllyFocusItem` are UI-only shapes.

| File | Change |
|---|---|
| `src/components/transcript/panelSections.ts` | `SECTION_ORDER`/`PanelSectionId` drop `"answers"` (3 sections). Add pure `unseenIds` helpers. |
| `src/components/transcript/unseenItems.ts` (new) | Pure: which `FoundItem` ids are unseen, given what's been seen; marking a section's items seen. |
| `src/components/transcript/allyFocus.ts` | `AllyFocusItem` generalizes from Questions-only to carry any `FoundItem.group`. |
| `src/components/transcript/AllyFocusCanvas.tsx` | Becomes View (4): outer type-tab row (Questions/Terms/Tracking) above the existing per-item tab strip; header block redesigned to the hover-icon + Pin + Elaborate row: the mockup's content-first layout. |
| `src/components/transcript/AllyAccordion.tsx` | Drop the Answers section entirely (dock + pin-toggle code); add the NEW badge per header. |
| `src/components/transcript/TranscriptView.tsx` | `AllyPanel` → two-panel shell (Active + View side by side, no more Focus-canvas-above-accordion). Term click in the transcript routes through the same `selectItem` as an Active row. |
| `CLAUDE.md` | Rule 10 rewritten for the new model. |

`ViewHistory.tsx`/`viewEntries.ts` are **retired** by this plan — View no
longer keeps a growing history of every card ever asked; it keeps one active
item per type, with Pin as the "don't lose this" mechanism instead. (Flagged
as an explicit call: if the owner wants an *archive* of everything asked
this session back, that is a separate, later addition — not blocking this
split.)

---

## Task 1: `unseenItems.ts` — pure NEW-badge model

**Create:** `src/components/transcript/unseenItems.ts` + `.test.ts`

```ts
/** Which FoundItem ids are new since the panel last acknowledged them —
 *  drives the Active accordion's per-header NEW badge (owner, 2026-09-28).
 *  Pure: the cockpit owns the `seen: Set<string>` and calls these on each
 *  foundGroups recompute / section-open. */
export function unseenIn(ids: readonly string[], seen: ReadonlySet<string>): string[] {
  return ids.filter((id) => !seen.has(id));
}

export function markSeen(seen: ReadonlySet<string>, ids: readonly string[]): Set<string> {
  const next = new Set(seen);
  for (const id of ids) next.add(id);
  return next;
}
```

Tests: `unseenIn` returns only not-yet-seen ids, empty when all seen;
`markSeen` returns a new Set (doesn't mutate the input), adding ids
idempotently.

Cockpit wiring (Task 4): `seenIds` state initialized empty; every
`foundGroups` recompute exposes each section's current ids via
`unseenIn(ids, seenIds)` for the header badge; opening a section (or
selecting one of its rows) calls `setSeenIds((s) => markSeen(s, sectionIds))`.

---

## Task 2: `panelSections.ts` — drop Answers, keep the rest

Read the current file first (`SECTION_ORDER`, `SECTION_META`,
`selectSection`, `togglePin`, `revealAnswers` — the last two existed only
for the Answers dock and are deleted with it).

- `PanelSectionId` → `"questions" | "tracking" | "terms"` (drop `"answers"`).
- `SECTION_ORDER` → drop `"answers"`.
- `SECTION_META` → drop the `answers` entry.
- Delete `togglePin`/`revealAnswers`/the `answersPinned` field on
  `PanelState` — the dock they served no longer exists. `PanelState` becomes
  `{ open: PanelSectionId }`.
- `selectSection` simplifies to the plain exclusive-select (no answers
  special case).

Update `panelSections.test.ts` to match (delete the dock/pin tests, keep
plain select tests).

---

## Task 3: Generalize `AllyFocusItem` + `AllyFocusCanvas`

Read `src/components/transcript/allyFocus.ts` and `AllyFocusCanvas.tsx` in
full first.

- `AllyFocusItem` gains `group: FoundItem["group"]` and `sourceLabel`
  becomes the hover-tooltip text (already exists as a field — reuse it,
  don't add a new one). `question`/`answer` field names stay (a Term's
  "question" is its label, its "answer" is the definition — renaming would
  touch every call site for no behavioral gain; a doc comment says so).
- `AllyFocusCanvas` props gain `activeType: PanelSectionId`,
  `onSelectType: (t) => void`, and `pinned`/`onTogglePin` stay as-is but now
  apply to items of any group.
- New outer tab row (above the existing per-item tab strip), one tab per
  `PanelSectionId` present in `items` (icons match `SECTION_META`), the
  active type's items feed the existing inner tab strip unchanged.
- Header block: replace the "Question" eyebrow + full-text heading with the
  mockup's compact row — one icon-only button
  (`title={`${meta.label}: "${active.question}"`}`, so it's screen-reader
  reachable too, not just hover) + Pin (existing button, unchanged) +
  Elaborate. "Elaborate" for a Question re-runs `onRefresh`-equivalent (a
  fuller Ally pass); for a Term/Tracking item it's a new prop
  `onElaborate: (item) => void` wired to `askTerm("elaborate", …)` — see
  Task 4.
- "Answer" eyebrow → generalize label by group ("Answer" for questions,
  "Definition" for terms, "Detail" for tracking) via a small
  `ANSWER_LABEL: Record<FoundItem["group"], string>` map.

Update `AllyFocusCanvas.test.tsx`/`allyFocus.test.ts` for the new shape;
existing pin/tab-strip/expand tests should need minimal changes since that
machinery is untouched.

---

## Task 4: `AllyPanel` → Active + View shell

Read the whole current `AllyPanel` (`TranscriptView.tsx`, currently
~1448–1870 — re-check the line numbers, they've shifted since the last
plan) and the cockpit wiring around `foundGroups`/`selectFound`/`askTerm`
(~2280–2470) first; anchor every edit on the text actually there, not this
plan's line-number guesses.

a) Cockpit state: replace `viewEntries`/`viewFocusKey`/`viewSeq` with
   `activeByType: Partial<Record<PanelSectionId, FoundItem>>` (one slot per
   type) and `seenIds: Set<string>` (Task 1). `selectItem(item: FoundItem)`:
   - Maps `item.group` → its `PanelSectionId` (`question`→`questions`,
     `commitment`/`mention`→`tracking`, `term`→`terms`).
   - Sets `activeByType[section] = item`, marks `item.id` seen, and sets
     the Active accordion's `open` to that section too (so 3 and 4 land in
     sync, per the mockup's "rings in both places").
   - Converts the item into (or updates) an `AllyFocusItem` for
     `AllyFocusCanvas` exactly as `askFaner`/`askTerm` already do for
     questions today — reuse that conversion, don't duplicate it.

b) `AllyPanel` renders `AllyAccordion` (Active, 3 sections, NEW badges from
   `unseenIn`) and `AllyFocusCanvas` (View) side by side (`flex`, each its
   own scroll region) instead of stacked. Delete the old
   Focus-canvas-above-accordion layout and the `renderSection("answers")` /
   `ViewHistory` branch entirely.

c) **Transcript → Active/View wiring (the 2→3→4 relationship).** `askTerm`
   (called from `HighlightedText`'s `TermMenu` — `TranscriptView.tsx`, the
   component just fixed for positioning in the previous PR) currently opens
   the term's card directly. Change it to build the matching `FoundItem`
   (same shape `buildFoundGroups` would have produced for that term — reuse
   `foundGroups.ts`'s term-id convention, `t-${id}`, so it's the *same*
   item if FANER already found it, not a duplicate) and call `selectItem`
   from (a) — so clicking a term in the transcript rings it in Active and
   loads it in View, exactly like clicking its Active row does. Do the
   same for a transcript click that lands on a question/commitment if such
   a path exists; if not (today only terms are clickable in-transcript),
   say so in the task's commit message rather than inventing new
   transcript affordances — that's a separate feature, not this plan's job.

d) Delete: `viewEntries.ts`, `ViewHistory.tsx`, and their tests (superseded
   by (a) — see the note under Architecture). `git rm`, don't just stop
   importing them.

e) Width budget: Active defaults ~300px, View ~380px (matches the mockup);
   both participate in the existing panel resize handle
   (`onPointerDown`/`widthPx` — read the current single-panel version's
   resize code and split it across two handles, one per panel, or one
   shared handle with a fixed Active:View ratio — pick whichever the
   current resize code makes the smaller diff, and say which in the PR).

f) Drawer mode (<640px, existing responsive fallback): both panels collapse
   into the existing single-panel overlay drawer behavior — Active and View
   become two drawer pages instead of a third breakpoint tier. Don't
   design a new mobile pattern; reuse the drawer toggle that's already
   there.

---

## Task 5: Verify + tests

- `npx tsc -b && npx vitest run` — clean, every touched test file updated
  (not skipped) for the new shapes.
- Manual QA list for the owner's Windows build (write into the PR body,
  same as the Aug-22 plan's Task 9 Step 4):
  - A live question appears in Active → Questions, NEW-badged; opening the
    section or selecting the row clears the badge and shows the answer in
    View.
  - Clicking a highlighted term in the transcript rings it in the
    transcript, opens/selects Active → Terms, and shows its definition in
    View — without needing to also click the Active row.
  - Selecting a Term after a Question was showing keeps the Question's tab
    alive in View (switch back, it's still there) — type-tabs don't
    discard each other.
  - Pin on a View item keeps it out of the way of the next same-type
    selection (exact "what happens when pinned and a new item of the same
    type is selected" behavior needs one owner call during QA — this plan
    keeps Pin as "float first / don't auto-replace" per `AllyFocusCanvas`'s
    existing multi-item behavior, generalized across types, rather than
    inventing a new lock semantic).
  - Elaborate is reachable in one click from every item type.
  - Below 640px, the drawer still opens both halves as before.

## Task 6: Docs

- `CLAUDE.md` rule 10: replace the Focus-canvas-plus-accordion paragraph
  with the Active/View two-panel description; keep the FANER-mark-retired
  and partner-window paragraphs (untouched by this plan).

---

## Explicit follow-ups (not in this plan's scope)

- An **archive** of every item ever viewed this session (what `ViewHistory`
  used to provide) — if wanted back, it's additive: a session log
  alongside `activeByType`, not a blocker for the split itself.
- Tracking-item transcript click-through (task 4c) — only wired for terms,
  since that's the only in-transcript clickable item type today.

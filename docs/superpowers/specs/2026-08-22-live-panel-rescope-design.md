# Live panel re-scope: Found / View split (v1)

> Brainstorming-skill design doc. Status: **approved** (owner, 2026-08-22 —
> "write the spec and lets begin") — next step is `writing-plans`.
> Implementation starts only after the in-flight partner-window plan
> (`2026-08-22-partner-window-tabs.md`) completes on this branch.

## 1. Purpose

The app's job on a live call (owner, verbatim): "make instantly available
possible words, phrases, and references to information that the caller might
immediately want access to while on the call." Measured against that, the
current right panel falls short:

- **Terms** carries words/phrases but not the tracker's **mentions**.
- **Details** mixes streaming answers with parked sections (Live summary,
  Open threads, Grounding) — and the two most call-critical reference types
  are missing entirely: **commitments** and **radar hits** ("they asked a
  question your documents answer, instantly, zero LLM cost").
- The tracker's own surface (`TrackerRail`) is a third column gated behind a
  ≥896px window that rarely shows; the radar's surface (`AllyDock`) is no
  longer mounted at all. Both features still run — invisibly.

## 2. The model (owner-directed, 2026-08-22)

Two halves with one contract between them: **the AI supplies; the user
selects; selection is immediately visible.**

- **Found** — everything the AI has surfaced from the call, listed and
  **grouped**, each item selectable in one tap.
- **View** — a running history of ONLY the cards the user selected (or asked
  for), in click order. Nothing else parks here. Each card is height-capped
  with a **more/less** toggle, and can be loaded fully into the partner
  window ("the right view port").
- **Split by default** (owner-confirmed): Found on top, View below, always.
  The control bar's two tabs become **maximize controls**: tap one → that
  half takes the full panel; tap the lit tab again → back to the split.
  Selecting in Found renders the card in View with zero tab switching.

## 3. Design

### 3.1 Split shell + tabs-as-maximize

- The panel body renders `FoundList` (top) and `ViewHistory` (bottom) in a
  vertical flex split; a thin draggable divider adjusts the ratio, persisted
  (`conva.panel.splitRatio` in `uiPrefs`, default 0.45, clamped 0.25–0.75).
- `AllyPanelTab` ("details" | "terms") keeps its wire values but its meaning
  becomes "maximized half": `terms` = Found full-height, `details` = View
  full-height, and a new third state **split** (the default) = both. The
  `LiveControlBar` tablist keeps its two buttons; tapping the active one
  returns to split (neither lit fully — both show a half-lit treatment in
  split mode). Below 640px (drawer mode) the split collapses to the
  classic exclusive-tab behavior — no split in the overlay drawer.
- The A−/A+ pref and 3-dot menu stay panel-wide, unchanged.

### 3.2 Found (top half) — grouped supply

Groups in urgency order, all deduped and live-updating, headers in the
existing `font-mono` eyebrow style:

1. **Questions** — radar hits, latest first. Row = "They asked:" + the
   question (truncated). The store keeps a **running history** (owner
   decision — replaces today's latest-only `radar: RadarEvent | null` with
   an appended, deduped-by-question list, capped at 20).
2. **Commitments** — tracker commitments: `who("you"/"them") · what · due`.
3. **Terms** — today's chips exactly (detected azure dot / doc gold dot).
4. **Mentions** — tracker entities: label + one-line detail, neutral
   (`bg-fg-muted`) dot.

Selecting any row/chip calls one function: `select(item)` → appends (or
focuses) its card in View. The existing chip info-card popover behavior is
replaced by this select-shows-below contract (the per-item actions — fetch
info · define · open in partner — move onto the View card).

### 3.3 View (bottom half) — chosen cards only

- Ordered list (oldest first, auto-scroll to newest) of `ViewCard`s. A card
  is created per selected Found item — and per **Ask-Ally question** typed
  in the ask box (asking is selecting). Nothing renders here that the user
  didn't choose.
- Card content by source: a Question card shows the radar hit's doc
  snippets instantly (zero cost) with an **Elaborate** action that streams
  a real Ally answer into the same card; Term/Mention cards show the known
  preview/detail immediately and stream research when the user hits
  fetch-info/define (the existing term actions, now on the card);
  Commitment cards show who/what/due with an Ask-about-this action;
  Ask cards stream as today's answer cards.
- Every card: height-capped (`max-h-[180px]` collapsed) with **more/less**;
  **Open in viewer** loads it into the partner window (lands as a tab
  there, per the partner-window plan); ✕ removes it from the history.
- Re-selecting an item whose card exists scrolls to + flash-rings that card
  (the existing jump-flash pattern) instead of duplicating.

### 3.4 Leaves the panel

- **Live summary** section → an on-demand card: "Summarize" (3-dot menu)
  drops the summary into View like any other chosen card.
- **Open threads** section → retired; View *is* the ordered engagement
  record.
- **Grounding** section → 3-dot menu entry (context title + doc names).
- **`TrackerRail` column + `AllyDock`** → deleted (data now lives in Found).
  `AllyDock` is already unmounted everywhere, so this is dead-code removal —
  its `Ctrl+Space` suggest-reply handler has been inert since it was
  unmounted and is not being relocated in this pass.
- CLAUDE.md rule 10's panel description is updated in the same PR.

## 4. Architecture

Presentation-layer only — no Rust/IPC changes. New pure module
`src/components/transcript/foundGroups.ts` (build the four groups from
captures/liveTerms/docTerms/tracker/radarHistory; extends `terms.ts`'s
`buildTermChips` pattern — `terms.ts` stays for chip building, foundGroups
composes it). `src/state/ally.ts`: `radar` becomes `radarHistory:
RadarEvent[]` (append, dedupe by question, cap 20) — `applyRadar` adapts;
`dismissRadar` retires. View history is panel-local state in a new
`src/components/transcript/ViewHistory.tsx` + a small
`viewHistory.ts` pure module (append-or-focus keyed by item id, remove,
more/less per card). `AllyMetaPanel` restructures into the split shell.

## 5. Out of scope

- Persisting the View history across sessions (it's call-time working
  memory; conversations are already the durable record).
- Reordering/pinning View cards; drag between halves.
- Any change to FANER/tracker/radar detection quality — supply-side is
  untouched.
- The partner window itself (separate in-flight plan).

## 6. Testing

- `foundGroups.ts` + `viewHistory.ts` pure tests (grouping, dedupe, order,
  radar-history cap, append-or-focus, remove).
- Component tests: select term → card below; re-select → focus not
  duplicate; more/less toggles; ask → card appends; maximize toggles
  (terms/details/split); summarize lands in View; grounding reachable via
  3-dot.
- `ally.ts` store test for radarHistory append/dedupe/cap.
- Manual (owner, Windows): live call — radar question appears in Found and
  its card answers instantly below; tracker commitments/mentions populate;
  divider drag persists.

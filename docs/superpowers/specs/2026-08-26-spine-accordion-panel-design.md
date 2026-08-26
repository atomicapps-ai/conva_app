# Spine-icon accordion panel + compact Ask box (v1)

> Brainstorming-skill design doc. Status: **approved** (owner, 2026-08-26 —
> "yes, write the spec and run it through the pipeline"; section names/icons
> and the pinnable-resizable Answers section confirmed in chat). New round on
> a fresh `claude/conva-app-ui-modernization-igllsd` (restarted from main —
> PR #85 merged); ships as a NEW draft PR. The already-approved FANER
> inline-marks retirement ("keep FANER's Highlighter, retire the inline
> live-transcript marks") folds into this same round.

## Owner intent

- The right panel's three content areas — tracking, questions/answers,
  terms — should be quickly switchable **stacked accordion** sections:
  click one → it expands, the open one collapses.
- **Icons overlay the center spine** (the divider between the conversation
  column and the panel). Each icon rides the TOP edge of its own section,
  so icons slide along the spine as sections expand/collapse — but their
  stacking order never changes.
- Ally's answers get a fourth section that can be **pinned** (always
  visible, dock at the bottom) and **resized** (drag divider).
- The "Ask Ally anything…" box moves to the **left column, above the
  control-bar buttons**, at reduced font/overall size.
- Retire the FANER inline live-transcript marks (`FanerMark` underlines +
  hover popover); keep FANER's Highlighter (`HighlightedText`'s clickable
  terms, term mining, Terms chips) fully intact.

## Sections — names, icons, order (owner-approved)

| # | Id | Name | Spine icon | Content (existing data, re-homed) |
|---|---|---|---|---|
| 1 | `questions` | **Questions** | `question` (chat bubble + ?) — NEW icon | Radar history rows (`FoundGroups.questions`) |
| 2 | `tracking` | **Tracking** | `target` (crosshair) — NEW icon | Commitments + Mentions (`FoundGroups.commitments` + `.mentions`) |
| 3 | `terms` | **Terms** | `book` (existing) | Term chips (`FoundGroups.terms`) |
| 4 | `answers` | **Answers** | `ally` (existing, gold tone) | Today's View feed: selected entries in click order + the Ally answer cards (`ViewHistory` + `renderAnswers`) |

## Design

### 1. Pure state model — `src/components/transcript/panelSections.ts`

- `type PanelSectionId = "questions" | "tracking" | "terms" | "answers"`;
  `SECTION_ORDER` fixed as above; `SECTION_META` maps id → `{ label,
  icon, tone }` (tone: `"ai"` for answers → gold, `"primary"` otherwise).
- `interface PanelState { open: PanelSectionId; answersPinned: boolean }`.
- `selectSection(state, id)`: exclusive accordion — returns state with
  `open: id`. Two invariants: clicking the already-open section is a
  no-op (exactly one section is always open); when `answersPinned`,
  `selectSection(_, "answers")` is a no-op (the dock is already visible)
  and `open` always names one of the three content sections.
- `togglePin(state)`: pinned → unpinned sets `open: "answers"` (it was
  visible; keep it visible as the expanded section). Unpinned → pinned:
  if `open === "answers"`, fall back to `open: "terms"`.
- `revealAnswers(state)`: the "asking is choosing" hook — pinned →
  unchanged (dock is visible); unpinned → `open: "answers"`. Replaces
  today's `ensureViewVisible`.
- All pure + unit-tested.

### 2. Persisted prefs (`uiPrefs`)

- `answersPinned: boolean` — `conva.panel.answersPinned`, **default
  true** (preserves today's "answers always visible" split default).
- `panelOpenSection: PanelSectionId` — `conva.panel.openSection`,
  default `"terms"`, validated against the union on load (bad value →
  default). Setter accepts any id; the pinned-invariant is enforced by
  `selectSection` at the interaction layer, and on load: pinned +
  stored `"answers"` → coerce `"terms"`.
- `panelSplitRatio` (existing pref, unchanged key) is REUSED as the
  pinned dock's divider: fraction of the panel body given to the
  accordion area above the dock (same drag semantics/clamps as today).

### 3. Accordion component — `src/components/transcript/AllyAccordion.tsx`

- Renders inside `AllyPanel`'s body (replacing the Found/View split).
  Each section = a wrapper with (a) its **spine icon chip**, absolutely
  positioned on the aside's left border (`left-0 -translate-x-1/2`,
  z-40 — above the z-30 width-drag handle), vertically at the section's
  top edge; (b) a slim clickable header row (mono eyebrow label + count
  badge; the Answers header also carries the **pin toggle**, `pin`
  icon, filled/lit when pinned); (c) the content area — expanded
  section gets `flex-1 min-h-0 overflow-y-auto`, collapsed sections
  render header-only.
- Active section's icon chip is lit (section tone + ring); inactive
  chips are muted. `title`/`aria-label` carry the section name.
- Pinned Answers: rendered after the three content sections as a
  bottom dock — row-resize divider above it driving `panelSplitRatio`
  (accordion area `flexBasis: ratio`, dock takes the rest), its spine
  icon lit gold at the dock's top edge. Unpinned: Answers is an
  ordinary 4th accordion section.
- Counts: questions/tracking/terms from `FoundGroups` lengths
  (tracking = commitments + mentions); answers = `viewEntries.length`
  (omit badge at 0).
- Content render: `FoundList` gains an optional `only?: "questions" |
  "tracking" | "terms"` prop rendering just that group's rows/chips
  (headers omitted — the section header replaces the group eyebrow);
  no prop → current behavior (call sites elsewhere unaffected).
  Answers content = existing `ViewHistory` + `renderAnswerCards`.

### 4. Ask box — left column, compact

- `askAllyField` moves permanently into the conversation column,
  docked at its bottom edge (above the control bar) at EVERY width —
  the `drawer &&` condition and the panel's `askField` slot are
  removed. Compact styling: container `px-2.5 py-1.5`, field height
  `h-8`, font `text-[12px]`, icons 14px. Submit behavior unchanged;
  answers land in the Answers section (`revealAnswers` on ask).

### 5. Control bar + drawer

- `LiveControlBar` loses the `tabs` prop and the `AllyPanelTab`/
  `AllyPanelView` exports entirely (the bottom-right tab zone is
  retired; the bar's left cluster is unchanged). In drawer mode
  (<640px) it instead shows one compact icon button at the right edge
  (`ally` icon, "Open Ally panel") via a new optional
  `onOpenPanel?: () => void` prop — the cockpit passes it only when
  `drawer` is true.
- The drawer itself renders the same `AllyPanel` (accordion inside,
  spine icons on the drawer's left edge — they're positioned relative
  to the aside, so this works unchanged).

### 6. FANER inline-marks retirement (folded in, already approved)

- Delete `FanerMark` + `FanerAwareText` (TranscriptView.tsx);
  `FlowText`/`Bubble` render `HighlightedText` directly; the
  `captures`/`onAskFaner`/`onSendToAsk`-for-marks prop threading
  through FlowText is dropped (SelectionMenu's `onSendToAsk` stays —
  it's selection-ask, not Faner).
- Delete `collectFanerHits`, `isFanerBoundaryMatch`, `fanerAccent`
  from `src/lib/faner.ts` + their tests. **KEEP `fanerPrompt`** — the
  Found panel's capture-sourced chips still route Fetch info through
  it (`askFaner` in the cockpit stays).
- Backend capture pipeline untouched: captures still stream, still
  appear as chips in the Terms section (`buildTermChips` unchanged).
  The dev-only `FanerReplayPanel` has its own copies — untouched.

### 7. Docs

- CLAUDE.md rule 10 rewritten: the spine-icon accordion (four sections,
  pinnable/resizable Answers, one open content section) supersedes the
  Found/View split + control-bar tabs model; ask box lives at the
  conversation column's foot. Partner-window-is-the-viewer and
  conversation-column-is-text-only rules carry forward unchanged.

## Out of scope

- The attached reference image (never arrived — design proceeds from the
  owner's written description; adjust visuals on feedback).
- Multi-open accordion modes, per-section font prefs, reordering.
- Any change to what populates the sections (radar/tracker/terms/answers
  data flows are re-homed, not modified).

## Testing

- Pure: `panelSections` (exclusive select; already-open no-op; pinned
  answers-select no-op; pin/unpin open-section handoffs; revealAnswers
  both modes). uiPrefs: new prefs persist/validate/coerce. FoundList
  `only` filter renders a single group, no headers, existing behavior
  without the prop. Icon: new `question`/`target` names render.
- Full suites green (`npm test`, `cargo test -p conva-core` untouched
  but run); `npm run build`.
- Owner manual pass: spine icons ride section tops in fixed order; click
  icon/header swaps the open section; Answers pin toggle docks/undocks
  with drag-resizable height that persists; asking auto-reveals Answers;
  Ask box sits above the control bar, smaller; no more inline underline
  marks in the transcript (Highlighter term underlines from the Terms
  vocabulary REMAIN — those are `HighlightedText`, kept by design);
  drawer (<640px) opens via the control bar's Ally button.

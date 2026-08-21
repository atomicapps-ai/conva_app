# Live-call right panel redesign — collapse-by-default + starred quotes + board (v1)

> Brainstorming-skill design doc. Status: **approved** (owner, 2026-08-21) —
> next step is `writing-plans`. This is the seed of a "board" the user will
> eventually arrange information/cards on; v1 intentionally ships a subset.

## 1. Problem

During a **live call**, speed-to-info matters more than anything the right
side panel (`AllyMetaPanel` — Summary / Threads / Grounding) currently shows.
Most of what's in that panel isn't relevant *until after* the call. Today it
sits open by default, competing for width with the transcript exactly when
the transcript matters most.

Separately, there's no way to mark "this specific quote is worth coming back
to" — Ask-Ally requests tied to a quote land in Threads like any other card,
indistinguishable from everything else.

## 2. Goals (v1)

1. During a live call, the right side is **fully collapsed by default** — zero
   width, no persistent rail eating transcript space.
2. Any Ask-Ally request tied to a specific transcript quote — right-click
   selection, FANER hover popover's Ask-Ally icon, or a manual drag-selection
   — **marks that quote** (color change + a clickable star) and produces a
   **starred card**.
3. Clicking the star (or asking from a marked quote) expands the right side
   to show **all starred cards together** — a board, not a single-item
   viewer — with a loading state per card while its answer streams in.
4. The panel is **collapsible / expandable**, with a persistent thin
   expand-arrow column when collapsed, so the user is never more than one
   click from getting it back.
5. Starred becomes the **live-call default view** of the existing right
   panel. Summary / Threads / Grounding remain reachable via the existing
   dock buttons — no fourth dock button is added; the shell just decides
   which content mounts by default based on call phase.

## 3. Out of scope for v1 (explicit fast-follow)

- **Real detach-to-a-separate-OS-window.** The detach icon may be present in
  the UI, but in v1 it does nothing functional (disabled or a "coming soon"
  affordance) — wiring a second `WebviewWindowBuilder` window
  (`hud.rs`/`?hud=1` is the direct precedent) and syncing starred-card state
  across two webviews is real engineering and ships separately.
- Rearranging/repositioning cards on the board (drag-to-reorder, free
  placement) — v1 is a simple stacked list, oldest-first, of starred cards.
  Free arrangement is the actual "board" vision and comes later.
- Un-starring is **in scope** (see §7) but only as a simple toggle — no
  archive/history of removed stars in v1.
- Persistence of starred cards across app restart is **not** required for
  v1 — session-only state, same lifetime as the rest of Ally's cards today.

## 4. Architecture — shared shell, two contents (approach C)

Two new pieces, reusing everything `AllyMetaPanel` already has:

```
RightPanelShell                      (new — owns collapse/expand mechanics)
├─ collapsed / expanded width state
├─ expand-arrow sliver column (visible even when collapsed)
├─ detach icon (present, inert in v1 — the fast-follow's hook point)
└─ content slot, mounts ONE of:
    ├─ StarredBoard                  (new — default during a live call)
    └─ AllyMetaPanel                 (existing, unchanged — Summary/Threads/
                                       Grounding dock, default post-call or
                                       when the user switches to it)
```

**Why this shape, not extending `AllyMetaPanel` directly, not a fully
independent `BoardPanel`:** `RightPanelShell` is exactly the component that
becomes the fast-follow's detached-window content — same component mounted
in the main window today, mounted in a `?board=1` window tomorrow, no
rewrite. A single collapse/width implementation also avoids duplicating the
drawer/breakpoint math `TranscriptView.tsx` already has for the narrow-width
overlay case (§8 covers how the two interact).

`AllyMetaPanel` itself is **unchanged** — it keeps its own props contract
(`cards, pinned, togglePin, onOpenViewer, busy, request, allyFontPx,
bumpAllyFont, reasoningDefaultOpen, setReasoningDefaultOpen, clearAlly,
barPad`). The shell just decides which of the two content components is
mounted, and owns width/collapse state that today lives inline in
`TranscriptView.tsx` (the `drawer`/`width` logic around line ~2010).

### 4.1 State

New minimal slice (co-located with existing `state/ally.ts`, not a separate
store — starred cards are a *view* over the same card data Ally already
produces, not a new kind of card):

- `starred: Set<string>` — card ids the user has starred (a card is anything
  already in `state/ally.ts`'s `cards` array; starring doesn't create a new
  data type, it flags an existing `AllyCard`).
- `panelMode: "starred" | "dock"` — which content `RightPanelShell` shows.
  Defaults to `"starred"` while `session.state === "listening"` (the
  existing "live call" signal in `state/transcript.ts`), `"dock"` otherwise;
  the user can switch manually (switching doesn't reset the default logic —
  see §7 for exact transition rules).
- `panelCollapsed: boolean` — defaults `true` on entering `"listening"`
  (goal 1); persists per-session, not across restarts (§3).

### 4.2 New components

- **`RightPanelShell.tsx`** — collapse/expand chrome, the arrow-column,
  the (inert in v1) detach affordance, width management. Takes a `children`
  slot.
- **`StarredBoard.tsx`** — renders `starred` card ids (resolved against the
  existing `cards` array) as a stacked list, oldest-first. Each entry: a
  loading-spinner state while that card is still streaming (`AllyCard.done
  === false && error === null` — `busy` itself is a single session-wide flag
  on `AllyState`, not per-card, so per-card loading reads off `done`/`error`
  like the rest of the codebase already does), then the card body once
  `done`, with an "expand" icon that opens the existing large detail drawer
  (the same one `AllyMetaPanel`'s cards use today — reused, not reinvented)
  for full reading.

No new IPC, no new Rust — this is a pure frontend feature. `askFaner`/
`onSendToAsk` (already wired this session) become the entry points that
also call `star(cardId)`.

## 5. Starred-quote visual treatment

- **Color:** a *new* accent, not reused from FANER's action-color system
  (`fanerAccent`'s sky/violet/emerald/fuchsia/amber) — those colors mean
  "FANER auto-detected this and routed it to action X." A star is a
  **user-initiated** mark and needs to read as visually distinct from FANER's
  automatic highlighting so the two mechanics don't blur together. Use the
  existing Ally accent (the app's established "this is an Ally thing" color,
  already used elsewhere for Ally-sourced UI) for the starred span's
  underline/text color.
- **Star glyph:** sits immediately after the marked phrase, inline, same
  pattern as `FanerMark`'s existing hover-icon placement — clickable, filled
  when starred/added-to-board, outline when hoverable-but-not-yet-starred.
- Un-starring: clicking a filled star removes the card from `starred` and
  reverts the span's color. The transcript span itself is never deleted —
  only its "starred" decoration is.

## 6. Interaction flow (v1 scope — stages 1–3 of the original narrative)

1. User asks Ally about a quote (right-click menu, FANER hover popover, or a
   manual selection) → the quote is marked (§5) and a card is created/starred
   in one action — no separate "star after the fact" step; asking *is*
   starring, since decision (3) scopes starring to "any Ask-Ally request tied
   to a specific quote."
2. If the right panel is collapsed, this **does not auto-expand it** — the
   star appearing on the transcript is the signal; the user reaches for the
   panel only when they want it (goal 1: speed-to-info means not stealing
   width on every ask). The expand-arrow column is always visible as the
   affordance.
3. Panel expanded → `RightPanelShell` shows `StarredBoard`: the new card
   appears with a loading animation while streaming, then settles into its
   answer. An expand icon opens the full detail drawer for that card.
4. Collapse/expand toggling is instant and reversible via the arrow column;
   collapsing never discards `starred` state.

## 7. Mode-switch / default-view rules

- Entering a live call: `panelCollapsed = true`, `panelMode = "starred"`.
- Call ends: `panelMode` does **not** forcibly flip to `"dock"` — the user
  may still be reading starred cards. Ending a call also does not force
  `panelCollapsed = false`. Only the *default for the next* live call resets;
  mid-session manual choices are left alone. (This mirrors goal 5's "starred
  becomes the live-call default view," not "starred replaces the dock.")
- The existing dock buttons (Summary/Threads/Grounding) remain how the user
  reaches `AllyMetaPanel`'s content — clicking any of them sets
  `panelMode = "dock"`. There is no new fourth button; Starred is reached via
  the star/ask action itself, or an equivalent entry in the shell's own
  small mode switcher (exact affordance — a tab-like control at the top of
  `RightPanelShell`, distinct from `AllyMetaPanel`'s internal dock — is an
  implementation detail for the plan, not re-litigated here).

## 8. Interaction with the existing narrow-width drawer

`TranscriptView.tsx` already folds the meta panel into an overlay drawer
below ~640px (`drawer`/`drawerOpen`). `RightPanelShell` sits *inside* that
existing mechanism unchanged — narrow-width behavior (overlay, opened by the
"✦ Ally N" chip) is orthogonal to collapsed/expanded state at normal widths.
`showTracker`'s `TRACKER_W` gate is untouched.

## 9. Risks / open items for the plan

- Exact placement of the shell's mode-switcher control (Starred vs. dock) —
  small UI decision, not architectural; resolve during planning/build.
- `RightPanelShell`'s width when expanded — reuse `AllyMetaPanel`'s existing
  `w-[300px]`, or size independently for the board's card-stack layout.
  Recommend starting at the same 300px for v1 consistency; revisit once
  real usage shows whether starred cards need more room.
- CLAUDE.md rule 9 ("navigation is two levels") governs *page* navigation
  (the nav rail / breadcrumb model) — this panel is in-page chrome within
  the Live view, not a new navigation level, so it doesn't need an exception
  carved out. Worth a one-line note in that rule's doc only if the future
  detached window is ever mistaken for a third nav level (it isn't one
  either — it's a second window mirroring in-page state, not a destination
  reached via the rail).

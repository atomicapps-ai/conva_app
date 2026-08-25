# Partner window: tabs, font menu, document tabs, lock-to-app (v1)

> Brainstorming-skill design doc. Status: **approved** (owner, 2026-08-22) —
> next step is `writing-plans`.

## 1. Problem

The partner window (`src/components/partner/PartnerWindow.tsx` +
`src-tauri/src/partner.rs`, `?partner=1`) — THE viewer per CLAUDE.md rule 10 —
currently:

1. Shows exactly **one** item at a time. Opening a second term/answer replaces
   the first; there is no way to keep several open and jump between them
   mid-call.
2. Has **no font-size control** — all text sizes are fixed px, unlike the
   in-app Ally panel's A−/A+ menu.
3. Lists source documents as inert text lines ("FROM YOUR DOCUMENTS") — a
   document can't be opened and read in the viewer.
4. Docks flush to the app's right edge **once, at creation** — moving the main
   window leaves it behind; the ⇥ button is a one-shot snap; re-dock forces
   the window to the main window's full height, discarding the user's size.

Owner request (2026-08-22, both messages): a top-right menu for adjusting font
size; multiple documents shown as **tabs** (clarified from "tables" — the
tabs-for-open-items option was chosen); and the window should **lock to the
app by default** — following it, with independent height/width adjustments —
with an icon to lock and an icon to release it as independent.

## 2. Decisions (owner-confirmed)

- **Tabs, not tables**: every opened item becomes a tab; the strip sits under
  the title bar. (Clarifying Q1.)
- **Own font setting**, not shared with the Ally panel's `allyFontPx` — the
  detached window is often farther away / on another monitor. (Clarifying Q2.)
- **Locked to the app is the default** posture; unlock makes it a normal
  floating window. Lock governs *position-following*; the user's chosen width
  AND height are respected in both modes (no more forced full-height).

## 3. Architecture

Frontend-first (Approach A from brainstorming): the Rust side keeps its
single-delivery model — `partner.rs`'s `PAYLOAD` mutex + the
`conva://partner-term` event already hand the window every newly-opened item.
**Tab state lives in the window's own React state**, accumulated from those
deliveries. Rust changes are confined to (a) one additive `PartnerPayload`
field (document ids for clickable sources) and (b) the lock/follow behavior
(window-event listener + one command), because only the shell can observe main-
window moves.

Why not a Rust-side tab registry: it duplicates state across the hand-mirrored
IPC contract for one nicety (tabs surviving window close), which nobody asked
for. Tabs live as long as the window does.

## 4. Design

### 4.1 Tabs (`PartnerWindow.tsx` + new `partnerTabs.ts`)

- New pure module `src/components/partner/partnerTabs.ts`:
  - `interface PartnerTab { key: string; payload: PartnerPayload; kind: "item" | "document" }`
  - `tabKey(p: PartnerPayload): string` — the dedupe signature, today's
    `\`${p.term}::${p.answer ?? ""}\`` logic moved here.
  - `addOrFocus(tabs: PartnerTab[], p: PartnerPayload): { tabs: PartnerTab[]; activeKey: string }`
    — appends a new tab, or returns the existing one's key unchanged.
  - `closeTab(tabs: PartnerTab[], key: string, activeKey: string): { tabs: PartnerTab[]; activeKey: string | null }`
    — removes; if the active tab closed, activates its right neighbor, else
    left, else null (empty state).
- `PartnerWindow` replaces its single `payload` state with
  `{ tabs, activeKey }`. Each payload delivery (boot `payload()` +
  `partnerTerm` subscription) runs `addOrFocus` and focuses the result.
  The existing `openedFor` redelivery guard is subsumed by `addOrFocus`'s
  dedupe (identical signature → focus, no re-research).
- **Tab strip**: a `shrink-0` row under the title bar; horizontal
  `overflow-x-auto`; each tab = truncated label (the term / file name,
  `max-w-[16ch]`) + an × button. Active tab uses the sanctioned exclusive-tab
  silhouette (`bg-panel-raised text-primary` + 2px top spine) — same language
  as `LiveControlBar`'s Details/Terms tabs. Inactive: `text-fg-faint
  hover:text-fg`. Zero tabs → the strip hides and the current empty state
  shows.
- **Research on open**: a fresh term (payload with `answer === null`,
  `kind !== "document"`) triggers the same Ally research request as today —
  but tagged to its tab via the existing `source` param:
  `request("question", …, { key: \`partner::${tabKey}\`, quote: p.term })`.
  Follow-ups typed in the Ask field tag the **active** tab the same way.
- **Per-tab content**: the displayed card for a tab = newest card in this
  window's own ally store whose `sourceKey === \`partner::${tabKey}\``
  (each webview has its own store instance; `conva://*` events are emitted
  app-wide). `derivePartnerAnswer(payload, liveCard)` keeps its job,
  receiving the tab's own card instead of `cards[0]`. `clearAlly()` is no
  longer called on payload delivery (it would wipe other tabs' answers).
- **Card cap**: `src/state/ally.ts`'s keep-newest cap rises from 6
  (`slice(0, 5)`) to 12 (`slice(0, 11)`) so several tabs' answers coexist;
  an answer evicted past the cap falls back to "Researching…"/empty and can
  be re-asked. The main window shares this constant — a strictly larger
  history is harmless there (the Details feed already renders all cards).

### 4.2 Font-size menu (title bar, top-right)

- `src/state/uiPrefs.ts` gains `partnerFontPx` (+ `bumpPartnerFont`),
  persisted at `conva.partner.fontPx`, default 14, clamped to the existing
  FONT_MIN/FONT_MAX (11–20) — mechanically identical to `allyFontPx`.
- Title bar gains an **Aa** button (before the lock toggle) opening a small
  anchored menu: `A− · {px}px · A+` — the same control cluster as the Ally
  panel's 3-dot menu row. Escape/outside click closes (same pattern as
  `AllyMetaPanel`'s menu).
- The content root (`div` wrapping tab strip + body + ask bar is NOT scaled;
  only the scrollable content body) gets `style={{ fontSize: partnerFontPx }}`,
  and the body's fixed px text classes convert to em: heading
  `text-lg` → `text-[1.3em]`, kind eyebrow → `text-[0.72em]`, preview/answer
  `text-[13px]`/`text-[12.5px]` → `text-[0.93em]`/`text-[0.9em]`, sources
  `text-[12px]` → `text-[0.86em]`. Title bar, tab strip, and Ask field keep
  fixed sizes (chrome doesn't scale — same rule as the main app).

### 4.3 Document tabs

- **IPC (mirrored both sides in one commit, rule 2):** `PartnerPayload` gains
  `source_docs: { id: string, file_name: string }[]` (serde default = empty,
  so old payload JSON stays valid). Rust `ipc.rs` struct + TS `ipc.ts`
  interface. Every constructor site fills it (the Terms-tab open path and the
  answer-card "open in viewer" path pass the ids they already have from
  `AllySource`/RAG results; where ids are genuinely unavailable it stays
  empty and the UI simply isn't clickable).
- In the viewer, each "FROM YOUR DOCUMENTS" line whose file name matches a
  `source_docs` entry renders as a button; clicking it synthesizes a
  document payload `{ term: file_name, kind: "document", preview: null,
  answer: null, source_lines: [], source_docs: [{ id, file_name }] }` —
  carrying exactly the clicked document's id — and runs `addOrFocus`, with
  no round-trip through Rust.
- A `kind === "document"` tab renders no research request; its body loads
  `backend.rag.documentText(id)` once (the id travels in the synthesized
  payload's `source_docs[0]`), shows a loading state, then the text in a
  scrollable `whitespace-pre-wrap` block at `text-[0.9em]`; `null` → "This
  document's text isn't available." The Ask bar still works and tags the
  active (document) tab — asking about a document is a normal Ally question.

### 4.4 Lock-to-app (default) vs independent

- **State**: a `static LOCKED: AtomicBool` in `partner.rs`, default `true`.
  Two new commands: `set_partner_locked(locked: bool)` (called by the
  toggle and by the auto-release path's frontend echo) and
  `get_partner_locked() -> bool` (read once on window mount to render the
  icon). Rust's flag is the single source of truth; the frontend only
  mirrors it for display. TS wrappers `partner.setLocked`/`partner.locked`
  on all backends (web backend: no-ops/`false`, the window doesn't exist
  there).
- **Following**: `lib.rs`'s setup registers `on_window_event` for the **main**
  window; on `Moved`/`Resized`, if `LOCKED` and the partner window exists,
  reposition it to `dock_rect`'s x/y **keeping the partner's current size**
  (`dock_rect` loses its height-forcing role; it returns the anchor point).
  Programmatic moves set a `SUPPRESS` flag so they aren't mistaken for user
  drags.
- **Auto-release**: `on_window_event` for the **partner** window; a `Moved`
  event NOT flagged as programmatic while `LOCKED` flips `LOCKED` to false
  and emits a `conva://partner-lock` event `{ locked: false }` so the title-
  bar icon updates. (Grabbing the window = wanting it free.)
- **UI**: the ⇥ button is replaced by a single **lock toggle** — icon `lock`
  (closed) when locked, `unlock` (open) when independent (two new `Icon`
  glyphs); clicking unlocked→locked snaps the window flush to the app's right
  edge (today's `redock`, minus the size-forcing) and starts following;
  locked→unlocked just stops following (no jump). Tooltip text: "Locked to
  the app — click to float free" / "Floating — click to lock to the app".
- **Locked + resizable**: in locked mode the user can still resize any edge;
  the follow logic preserves whatever size they set. Re-anchoring uses the
  window's own current width (flush = main right edge → partner left edge).
- Default on every fresh open: locked, docked at the anchor with width 430
  and the main window's height as the *initial* size only.

## 5. Out of scope

- Tabs persisting across partner-window close/reopen (Rust-side registry —
  rejected as IPC weight for an unrequested nicety).
- Rendering document content beyond plain text (PDF page images, tables
  inside documents, markdown formatting) — the RAG store reconstructs plain
  text today; richer rendering is its own feature.
- Reordering tabs by drag; tab overflow menus. The strip scrolls.
- Multi-monitor DPI edge cases beyond what `dock_rect`'s existing
  scale-factor handling covers — verified on the owner's machine, not
  redesigned here.

## 6. Testing

- `partnerTabs.ts` is pure — unit tests for `tabKey` dedupe, `addOrFocus`
  (new / duplicate / focus), `closeTab` (middle / active / last).
- `PartnerWindow` component tests (`@testing-library/react`, mocked backend,
  same style as `FanerMark.test.tsx`): payload deliveries accumulate tabs;
  duplicate delivery focuses instead of duplicating; × closes and activates
  the neighbor; Aa menu bumps the persisted pref; a document tab loads and
  renders `documentText`; per-tab answer routing (a card tagged for tab A
  never renders under tab B).
- Core-side: serde round-trip test that a `PartnerPayload` JSON **without**
  `source_docs` still deserializes (the additive-field guarantee).
- Lock/follow behavior is shell-side (Windows window events) — covered by
  CI's Windows clippy/compile and the owner's manual pass: move the app with
  the window locked (it follows, size preserved), resize the partner while
  locked (size sticks), drag the partner (lock releases, icon flips), re-lock
  (snaps flush).

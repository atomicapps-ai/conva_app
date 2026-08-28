# Contexts screen redesign

> Brainstorming-skill design doc. Status: **approved** (owner, 2026-08-28).
> Shipping on `claude/conva-app-ui-modernization-igllsd`. Reference mockup
> (owner-approved): [Contexts Redesign artifact](https://claude.ai/code/artifact/6eb22c23-80cc-4872-846c-e601835dccaf)
> — reproduces today's actual screen plus the two row-shape options the
> owner picked between (Option A won).

## Background — what's already there

Investigated before designing anything (per this skill's "explore first"
step) — several of the owner's 8 requirements turned out to already be
built:

- **`ContextsView.tsx`** is already a two-pane `Mode` router
  (`{k:"list"}` / `{k:"setup"}` / `{k:"detail"}`) rendering `ContextsPane`
  (left) + `LibraryPane` (right) in a CSS grid — but a **fixed**
  `grid-template-columns: minmax(0,1fr) minmax(0,1.3fr)` ratio, not
  resizeable. This is the concrete gap behind requirement 7.
- **"Add a New Context"** (a `✚` icon in `ContextsPane`'s header) and
  **"Add a pasted note" / "Add a document…"** (two `✚` icons in
  `LibraryPane`'s header) already exist — requirement 1's add-entry-points
  ask is already met.
- **Drag-and-drop already works**: `LibraryPane.tsx` rows are
  `draggable`, tagging `DOC_DRAG_MIME` (`"application/x-conva-doc-id"`);
  `ContextsPane.tsx` rows are drop targets that call `onAttach` and
  auto-expand. `AttachMenu` (defined inline in `LibraryPane.tsx`, not a
  separate file) is the always-available click fallback, per CLAUDE.md
  architecture rule 8 — this redesign does not touch that trade-off or
  the `dragDropEnabled: false` setting it depends on. Requirement 2 is
  already met.
- **`ContextsPane.tsx`'s row is genuinely variable-height and dense**:
  collapsed it's one line; expanded (draft, or manually toggled) it grows
  through a meta/actions line, a nested `ChildDocRow` list, and — for
  drafts — a readiness checklist. Actions are split between always-visible
  icons (expand chevron, title, Open, Generate/Regenerate) and a `⋮`
  `RowMenu` popover (Edit setup / Regenerate resources / Delete). This is
  the real shape requirements 3-4 replace.
- **`ContextDetail.tsx`'s raw generated-document dumps already default to
  hidden** (`showDossier`/`showQa` both `useState(false)`, a View/Hide
  toggle per stage) — the verbosity requirement 8 complains about isn't
  those `<pre>` blocks. It's everything *around* them: three `Section`s
  (Counterparty / Knowledge base / Rehearse), each always fully expanded
  — static explainer paragraphs under every stage, full persona-card
  write-ups, an inert attached-documents list with no metadata, an
  Ally-research list with always-visible snippets — all on screen at once
  regardless of what the owner actually opened the page to check.
- **`GroundPicker.tsx`** (the session-grounding popover in `TopBar`, not
  part of the Contexts screen) has its own separate, simpler
  context-row-with-expand implementation — checkbox + chevron + title +
  doc-count, no per-row actions. Different purpose (pick-to-ground vs.
  manage), explicitly **not** unified with the redesigned row here (see
  Out of scope).

## Requirements → design, one to one

### 1 & 7 — Two panes, resizeable centerline

No pane restructuring needed (already two panes, already the right
panes). Only change: replace the fixed grid ratio with the same
pointer-drag resize pattern `TranscriptView.tsx`'s `AllyPanel` already
uses for its own width handle (`role="separator"`, `aria-orientation`,
`onPointerDown` → `pointermove`/`pointerup` listeners, no library). New
persisted pref alongside the existing `conva.panel.splitRatio` /
`conva.panel.widthPx` (`state/uiPrefs.ts`) — same clamp-then-clamp-again
approach (a sane min/max ratio, then re-clamped against window width).

### 2 — Drag-and-drop

No change — already works (see Background). Carries forward unchanged
onto the redesigned row (the row `<li>` stays the drop target; only its
internal markup changes).

### 3 & 4 — Redesigned context row

**Option A** (owner-picked over the mockup's Option B): full-width, two
fixed lines, no expand/collapse. This resolves the literal "2/3 the
column space" wording in the original ask — the mockup showed that
reading next to the full-width alternative, and full-width dense won.

- **Line 1**: title (truncated, hover tooltip — requirement 6) · a
  doc-count chip (icon + number) · four direct icon buttons — **Open,
  Edit, Regenerate, Delete** — replacing today's split between
  always-visible icons and the `⋮` `RowMenu` popover. `RowMenu` is
  retired from `ContextsPane.tsx` entirely (the implementation plan
  confirms nothing else imports it before deleting it).
- **Line 2**: category pill + status pill + a compact "Updated `Xh` ago"
  meta string.
- Rows never expand/collapse anymore, so the child-doc list
  (`ChildDocRow`) and the draft readiness checklist — both currently only
  reachable by expanding a row — need a new home:
  - The attached-document list moves entirely into `ContextDetail.tsx`
    (reachable via the row's new Open icon), where requirement 8's
    redesign already gives it real per-row metadata (see below) instead
    of the flat name-only list `ChildDocRow` currently is.
  - **Gap explicitly resolved, not dropped**: the readiness checklist
    ("at least one grounding source," "add a job description") moves to
    a hover tooltip on the status pill, shown only when
    `status === "draft"` — consistent with this whole redesign's
    hover-for-detail direction, and it keeps the guidance reachable
    without needing an expand state that no longer exists.

### 5 — Regenerate hover: last-regenerated time

`ConversationContext.updated_at_unix_ms` is a general "last modified"
timestamp — it also bumps on a plain title/purpose edit via
`context::save`, so reusing it would make the tooltip lie ("last
regenerated" showing a time when only a rename happened). New dedicated
field instead: **`resources_generated_at_unix_ms: Option<u64>`**, set
only inside `context_generate_dossier` (`src-tauri/src/lib.rs`), right
before its final `context::save(&app, session)` call. `None` until the
first regenerate; the row's Regenerate icon tooltip reads "Never
regenerated" in that case, "Last regenerated `<relative time>`"
otherwise.

### 6 — Title hover: full title, dates, total size

Hover tooltip content: full (untruncated) title, created date-time,
updated date-time, and total size of the context's attached documents.

Size needs a real backend field — `RagDocument.chunk_count` doesn't
track bytes, and chunk count varies by content so it can't stand in for
size. New field: **`RagDocument.size_bytes: u64`**, captured once at
ingest time (every ingestion path already reads the file's bytes into
memory to chunk/embed it, so grabbing `.len()` there is free — no new
I/O). `#[serde(default)]` for backward compatibility with documents
ingested before this field existed (mirrors how `DocSource` itself
already handles this exact situation).

Display uses a new **`formatBytes(bytes: number): string`** pure
utility (`src/lib/formatBytes.ts`, unit tested) — standard
auto-scaling B/KB/MB/GB formatting, picking the largest unit that keeps
the number itself short:

| Bytes | Displays as |
|---|---|
| 850 | `850 B` |
| 15,400 | `15 KB` |
| 219,000 | `214 KB` |
| 1,258,000 | `1.2 MB` |
| 45,000,000 | `43 MB` |

Rule: whole numbers ≥10 in the chosen unit show no decimal; numbers <10
get one decimal place — the number itself never exceeds 3 characters,
the unit suffix carries the scale.

A context's total size in the tooltip is the sum of `size_bytes` across
its `source_doc_ids` (attached) plus its generated docs
(`dossier_doc_id`/`research_doc_id`/`qa_doc_id`), formatted the same way.

### 8 — `ContextDetail.tsx` density

Each of the three `Section`s (Counterparty, Knowledge base, Rehearse)
starts **collapsed to a one-line summary** (e.g. "Knowledge base — 3
documents, updated 2h ago ▸"), expanding one at a time on tap — mirroring
the accordion pattern the Live cockpit's `AllyPanel` already established
(CLAUDE.md rule 10), rather than inventing a second collapse pattern.
Static explainer paragraphs (the "what is this stage" prose under each
Knowledge-base stage) move to a hover tooltip on that stage's icon/label
instead of always-visible body text. The attached-documents list gains
per-row hover tooltips built from data already on hand — file type
(from `DocSource`), `chunk_count`, `size_bytes` (formatted per the table
above), and `ingested_at_unix_ms` (formatted date) — **not** an
AI-generated content summary (that would need a new LLM call per
document on hover: real latency and cost for something a metadata
tooltip answers for free). Raw generated-document `<pre>` dumps keep
their existing default-hidden View/Hide toggle, unchanged.

## Data model changes (Rust ↔ TS mirror, same commit per CLAUDE.md rule 2)

- `crates/conva-core/src/rag.rs`: `RagDocument.size_bytes: u64`,
  `#[serde(default)]`.
- `crates/conva-core/src/context.rs`:
  `ConversationContext.resources_generated_at_unix_ms: Option<u64>`,
  `#[serde(default)]`.
- `src/lib/ipc.ts`: mirror both — `RagDocument.size_bytes: number`,
  `ConversationContext.resources_generated_at_unix_ms: number | null`.
- Shell writers: every `RagStore` ingest path
  (`src-tauri/src/rag.rs`) sets `size_bytes` from the bytes it already
  has in hand; `context_generate_dossier`
  (`src-tauri/src/lib.rs`) sets `resources_generated_at_unix_ms`.
- New pure helper: `crates/conva-core/src/rag.rs` (or `context.rs`) gains
  a small `total_size_bytes(docs: &[RagDocument], ids: &[String]) -> u64`
  — or the equivalent is computed frontend-side from the `RagDocument[]`
  the UI already loads via `backend.rag.list()`. Frontend-side is
  simpler (no new IPC round-trip) and matches how `groundingDocs`/doc
  names are already assembled client-side in `TranscriptView.tsx`; the
  implementation plan decides the exact spot but should default to
  frontend-side unless a reason to push it server-side turns up.

## Out of scope

- **`GroundPicker.tsx`'s row is not unified with the redesigned
  `ContextsPane` row.** Different purpose (pick-to-ground vs. manage),
  already simpler, and CLAUDE.md's brainstorming guidance is explicit
  about not proposing unrelated refactoring — this would be exactly
  that.
- **No data migration for existing on-disk `RagDocument`s** missing
  `size_bytes` — `#[serde(default)]` gives them `0`, which displays as
  `0 B` until the doc is next re-ingested/regenerated. Not retroactively
  backfilled; not worth a migration pass for a display-only field.
- **No AI-generated document summaries** anywhere in this redesign (see
  requirement 8) — every new hover surfaces existing metadata only.

## Testing

Per this repo's TDD convention — new pure logic gets a unit test, no
plan step skips straight to UI wiring without one:

- `formatBytes.ts` — table-driven unit test covering the boundary cases
  in the table above (B/KB/MB/GB transitions, the ≥10-vs-<10 decimal
  rule, `0`).
- Any new pure aggregation helper (total size, "time since" relative
  formatting for the regenerate/updated tooltips, if one doesn't already
  exist in the codebase — check first) gets the same treatment.
- `ContextsPane.tsx`/`ContextDetail.tsx` currently have partial/no test
  coverage (`ContextsPane.test.tsx` exists; `ContextDetail.tsx` and
  `ContextsView.tsx`/`LibraryPane.tsx` have none) — the implementation
  plan should add coverage for the new row's four action buttons, the
  status-pill readiness tooltip, and the accordion default-collapsed
  state, not just modify existing tests.
- `cargo test -p conva-core` gets tests for the two new fields'
  `#[serde(default)]` backward-compat behavior (an old on-disk record
  missing the field still deserializes).

## Self-review notes

**Requirement coverage:** all 8 numbered asks map to a section above (1
& 7 combined since both concern the same pane-layout area; 2 needed no
new design, just a "no change" note). No requirement left unaddressed.

**Placeholder scan:** no TBD/TODO — every design decision states the
concrete field name, file, or component involved. The one genuine open
mechanical choice (frontend- vs. backend-side total-size aggregation) is
called out explicitly with a stated default, not left blank.

**Consistency check:** the accordion pattern (requirement 8) and the
hover-tooltip pattern (requirements 5, 6, and the relocated readiness
checklist) are both reused from patterns already established elsewhere
in the app (`AllyPanel`'s accordion; the app's existing `title=`-only
tooltip convention, confirmed via investigation — no dedicated `Tooltip`
component exists anywhere in `src`, so this redesign doesn't introduce
one either) rather than inventing new interaction patterns.

**Scope check:** contained to `src/components/contexts/*`,
`src/components/context/ContextDetail.tsx`, two small Rust field
additions + their IPC mirror, and one new frontend utility. Right-sized
for a single implementation plan.

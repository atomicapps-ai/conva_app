# Conversations page — row redesign + delete (v1)

> Brainstorming-skill design doc. Status: **approved** (owner, 2026-08-30 —
> mockup reviewed and approved at
> https://claude.ai/code/artifact/700cf877-9bf3-4c60-a340-901a89e63e4d, then
> owner asked for the backend delete-session command too, in scope here, not
> a follow-up). Ships as its own PR off `main`.

## Requirements (owner, 2026-08-30)

Owner flagged the Conversations page (screenshot) as disorganized: rows of
inconsistent height, no color, and asked for "each row simple 1 row high,
like a grid with the icons on the far right." Refined over a brainstorm +
mockup-approval round:

1. **Scope**: all three list views the page's filter tabs show — All
   activity (conversations + sessions, interleaved by time; History is the
   same rows filtered to conversations only, so it needs no separate work),
   Rehearsals (Contexts — a different resource, launcher only), and Search
   results.
2. **Color communicates row *type* at a glance** — a left-edge accent: azure
   for a saved conversation, muted gray for an unsaved session, gold for a
   rehearsal-tagged session (`SessionSummary.is_rehearsal`). Not general
   decorative warmth.
3. **The dot becomes a checkbox.** It was a shape+color type indicator,
   redundant with the accent bar. Replacing it enables multi-select → a
   bulk "Delete N selected" bar. Every row *also* keeps an individual trash
   can, far right, for a one-off delete without checking anything.
4. This makes conversations and sessions equally deletable. **Sessions
   currently have no delete anywhere in the app** — no backend command
   exists (checked both `src-tauri/src/` and the `ConvaBackend` TS
   interface). Owner confirmed building that command is part of this work.
5. **Rehearsals tab is visually consistent but functionally untouched** —
   same grid/accent/spacing family, no checkbox, no delete. Those rows are
   Contexts, a different resource managed on the Contexts page; deleting one
   from here would let a "go rehearse" launcher destroy a whole context
   (personas, knowledge base) by accident.

## Design

### 1. Backend: `session_delete` command (new)

`src-tauri/src/session.rs` gains `delete_session`, mirroring
`conversations::delete` (`conversations.rs:155`) exactly — same
one-file-per-record storage (`<app-data>/sessions/<id>.jsonl` vs
`<app-data>/conversations/<id>.json`), same id-validation approach already
used by `load_session`:

```rust
pub fn delete_session(app: &AppHandle, id: &str) -> Result<(), CoreError> {
    // Same check load_session already does — ids are ours, but never
    // trusted as path components.
    if id.contains(['/', '\\', '.']) {
        return Err(CoreError::Audio("invalid session id".into()));
    }
    let path = sessions_dir(app)?.join(format!("{id}.jsonl"));
    fs::remove_file(path).map_err(|e| CoreError::Audio(e.to_string()))
}
```

`src-tauri/src/lib.rs`, next to `session_list`/`session_load`:

```rust
#[tauri::command]
fn session_delete(app: AppHandle, id: String) -> Result<(), String> {
    session::delete_session(&app, &id).map_err(|e| e.to_string())
}
```

Registered in `generate_handler!` alongside the other `session_*` commands.
No `ipc.rs`/`ipc.ts` entry needed — same as `conversation_delete`, a plain
scalar-in/unit-out command, not a shared data shape.

### 2. TS wrappers

- `src/lib/commands.ts`, next to `sessionList`/`sessionLoad`:
  ```ts
  export function sessionDelete(id: string): Promise<void> {
    return invoke("session_delete", { id });
  }
  ```
- `ConvaBackend.ts`'s `sessions` interface gains `delete(id: string): Promise<void>`.
- `tauri.ts`: `sessions = { ..., delete: cmd.sessionDelete }`.
- `web.ts`: `sessions = { ..., delete: (): Promise<void> => todo("DELETE /v1/sessions/:id") }`
  — matches `sessions.list`/`sessions.load`'s existing `todo()` convention
  (a future REST endpoint is expected there), not `unsupported()` (reserved
  for genuinely desktop-only things like file-path export).

### 3. Shared `<ListRow>` component (new)

`src/components/ui/ListRow.tsx` — one component renders every row in the
All-activity/History list (conversations + sessions), replacing the two
near-duplicated `<li>` blocks in `ConversationsPanel.tsx` with one call
site each.

```tsx
export type ListRowAccent = "primary" | "muted" | "ai";

export interface ListRowProps {
  accent: ListRowAccent;
  title: string;
  badge?: { text: string; tone: ListRowAccent };
  date: string;
  selected?: boolean;
  onSelectChange?: (checked: boolean) => void; // omit -> checkbox column is an empty spacer
  onDelete?: () => void; // omit -> trash column is an empty spacer
  onClick: () => void;
}
```

CSS Grid, fixed 34px height, columns:
`3px accent | 14px checkbox-or-spacer | 1fr title (truncates) | auto badge | auto date | 20px trash-or-spacer`.
The title cell is `white-space: nowrap; overflow: hidden; text-overflow:
ellipsis` — it can only truncate, never wrap. That's what actually fixes
the reported "inconsistent height": today's rows are `flex` with no width
constraint on the metadata fields, so at the owner's 700px window width the
date/title/badge wrap onto a second line, reading as a taller "header" row
next to shorter ones. Fixed grid columns make that structurally impossible
regardless of window width.

`accent` maps to tokens already in `globals.css` (adds none): `primary` →
`--color-primary` (azure), `muted` → `--color-fg-faint`, `ai` →
`--color-ai` (gold). The checkbox uses native `accent-color`, matching the
`accent-color: var(--color-primary, ...)` pattern already used elsewhere in
this stylesheet.

The checkbox and trash columns render as empty, fixed-width spacers (not
conditionally omitted) whenever their handler prop is absent, so column
alignment holds identically across every row in a list — this is exactly
what the Rehearsals tab relies on in §4 to get the same grid look with
neither prop wired.

### 4. `ConversationsPanel.tsx` changes

- **All activity / History rows**: the existing conversation-`<li>` and
  session-`<li>` blocks become `<ListRow>` calls.
  `accent="primary"` for a conversation; for a session, `accent="ai"` when
  `row.data.is_rehearsal`, else `accent="muted"`. Both wire
  `onSelectChange` and `onDelete` — a session's `onDelete` calls the new
  `backend.sessions.delete`, a conversation's calls the existing
  `backend.conversations.delete` (today's `remove(id)`, unchanged).
- **Multi-select state**: `const [selected, setSelected] = useState<Set<string>>(new Set())`
  keyed by the same composite `c-${id}`/`s-${id}` strings the row `<li>`s
  already use for their React `key` — conversation and session ids come
  from different prefixes (`conv-…` / `session-…`) so collisions aren't
  realistic, but the composite key keeps "which kind is this" unambiguous
  when the bulk delete below has to dispatch to two different backend
  calls. Cleared whenever `filter` changes (switching tabs with a stale
  selection would be surprising). A bulk bar appears above the list
  only when `selected.size > 0` — `rec`-tinted per the mockup, live count,
  "Delete selected" + "Clear" — so the default (nothing checked) list looks
  exactly like it does today.
- **Rehearsals tab**: keeps its existing `<li>` — Contexts are a different
  data shape, out of `ListRow`'s concern — but restyled to the same grid
  column widths/height/radius so it visually matches, via the CSS classes
  `ListRow` exports rather than the component itself (no checkbox/delete
  props exist for it to receive).
- **Search results**: stays a two-line shape (title/date line, then the
  highlighted-snippet line below it) — collapsing to one line would drop
  the matched excerpt, which is the actual point of a search hit. It picks
  up the same left accent color and corner radius as the other lists for
  family resemblance, without pretending to be single-row-height. This is a
  judgment call (the structural conflict between "one row" and "the
  snippet is the feature" wasn't discussed explicitly), flagged here rather
  than silently narrowed from the "all three lists" scope the owner picked.

### 5. Delete flows

- **Single row, far-right trash**: same immediate, no-confirmation delete
  conversations already have — sessions get identical behavior via the new
  command. Not adding a confirmation dialog here; that would be a UX change
  beyond what was asked, applied unevenly (conversations wouldn't get one
  retroactively).
- **Bulk**: "Delete selected" parses each checked `c-${id}`/`s-${id}` key
  back into its kind + id and calls that kind's `delete` (`Promise.all`,
  tolerant of one failing — surfaced via the existing `setNotice`), clears
  the selection, and calls `refresh()` once after all settle.

## Out of scope (v1)

- A confirmation dialog before delete (single or bulk) — matches existing
  conversation-delete behavior, not introduced here.
- Rehearsals-tab (Context) delete/checkbox — stays on the Contexts page.
- Deleting a search hit's underlying record from the Search results view.
- Any change to what rows exist in "All activity" (the conversation+session
  interleaving, and a saved conversation's underlying session both still
  showing up as separate rows near each other) — purely a visual/layout +
  delete-capability change, not a data-model change.

## Testing

- `ListRow` (`src/components/ui/ListRow.test.tsx`, new): renders the given
  title/badge/date; `onSelectChange` fires from the checkbox;
  `onDelete` fires from the trash can without also triggering `onClick`
  (click propagation from a nested button); checkbox/trash cells render as
  empty spacers, not omitted, when their handler prop is absent, so column
  widths stay identical across rows that do and don't have them.
- `ConversationsPanel.test.tsx` (existing, extended): checking two rows
  shows the bulk bar with count 2; "Delete selected" calls both
  `conversations.delete` and `sessions.delete` as appropriate per row kind
  and refreshes; a session row's individual trash calls
  `backend.sessions.delete`; switching filter tabs clears any selection.
- Rust: no new core logic — `delete_session` is a thin `fs::remove_file`
  wrapper identical in shape to `conversations::delete`, itself untested at
  the unit level per precedent. No new `conva-core` unit test; behavior is
  exercised by the UI test mocking `backend.sessions.delete`.

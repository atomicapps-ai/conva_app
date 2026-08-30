# Conversations Row Redesign + Delete-Session Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Conversations page's All-activity/History rows become one
consistent, single-line-height grid shape with a left color accent by row
type and a checkbox for multi-select bulk delete (plus a per-row trash
can) — and sessions, which currently have no delete capability anywhere in
the app, get one via a new `session_delete` backend command.

**Architecture:** A new shared `<ListRow>` component (`src/components/ui/`)
renders every conversation/session row via CSS Grid with fixed columns, so
the title cell can only truncate, never wrap — the actual fix for the
reported inconsistent row heights. `ConversationsPanel.tsx` wires it in,
adds `Set<string>` multi-select state, and a bulk-delete bar. The backend
half mirrors `conversations::delete`/`conversation_delete` almost verbatim
for sessions, since none of that plumbing exists for them today.

**Tech Stack:** Rust (Tauri command, `src-tauri/`) + TypeScript/React
(`src/`) + vitest for UI tests. No `conva-core` changes — this is pure
shell (fs I/O) + UI.

Spec: `docs/superpowers/specs/2026-08-30-conversations-row-redesign-design.md`.

**Standard commit trailer for every commit in this plan:**

```
Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GiKzMingp6q12HJcuxRSZp
```

**One implementation-level decision this plan makes that the spec left
abstract** (documenting it here rather than silently deciding): the spec's
grid has one `badge` column and one `date` column per row, but the
*current* UI shows more than that per row — a conversation shows segment
count + linked-doc count alongside its date; a session shows both a status
badge ("Unsaved"/"Context") *and* its segment count. Rather than drop
information (the mockup's placeholder rows did, by replacing the status
badge with a segment count), this plan keeps `badge` for status text only
(exactly today's "Unsaved"/"Context" copy, omitted entirely for
conversations, matching today's behavior of showing no pill on them) and
folds the segment/doc counts into the `date` column as one combined
string (`formatDate(ts) · N segments`), so the grid stays at 6 columns
with zero information loss. The full, unabbreviated `formatDate()` output
is kept as-is — the mockup's "4:40 PM"-only shorthand would silently lose
the date for anything not from today, which is a real regression, not a
style choice.

---

### Task 1: Backend — `session_delete` command

**Files:**
- Modify: `src-tauri/src/session.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add `delete_session` to `session.rs`.** Insert immediately
  after `load_session` (currently `session.rs:771-783`, right before the
  `spawn_watchdog` doc comment at line 785):

```rust
pub fn delete_session(app: &AppHandle, id: &str) -> Result<(), CoreError> {
    // Same check load_session already does above — ids are ours, but
    // never trusted as path components.
    if id.contains(['/', '\\', '.']) {
        return Err(CoreError::Audio("invalid session id".into()));
    }
    let path = sessions_dir(app)?.join(format!("{id}.jsonl"));
    fs::remove_file(path).map_err(|e| CoreError::Audio(e.to_string()))
}
```

  This mirrors `conversations::delete` (`conversations.rs:155-159`)
  exactly, adapted to sessions' `.jsonl` extension and their inline
  id-validation style (`load_session` doesn't use a separate `validate_id`
  helper the way `conversations.rs` does — matching the file it's in).

- [ ] **Step 2: Add the `#[tauri::command]` wrapper in `lib.rs`.** Insert
  immediately after `session_load` (currently `lib.rs:224-227`):

```rust
#[tauri::command]
fn session_delete(app: AppHandle, id: String) -> Result<(), String> {
    session::delete_session(&app, &id).map_err(|e| e.to_string())
}
```

- [ ] **Step 3: Register it in `generate_handler!`.** In the
  `generate_handler!` list (`lib.rs`, currently lines 2179-2180 read
  `session_list, session_load,`), add `session_delete` right after
  `session_load`:

```rust
            session_list,
            session_load,
            session_delete,
```

- [ ] **Step 4: Verify — format check + manual read.** This crate can't be
  compiled in this sandbox (no Windows toolchain here; the Tauri shell
  only truly builds on the owner's machine — same constraint as every
  other Rust change made this session). Run:

  `cargo fmt --check -p conva-app`

  Expected: no output (clean). Then re-read the three edits side-by-side
  against `conversations::delete`/`conversation_delete` — the shapes
  should match exactly except for the file extension and the inline vs.
  helper-function id check. This is the real verification available here;
  the owner's own on-device `cargo build`/`npm run tauri:gpu` is what
  proves it compiles and runs.

- [ ] **Step 5: Commit.**

```bash
git add src-tauri/src/session.rs src-tauri/src/lib.rs
git commit -m "feat(sessions): add session_delete command — sessions had no delete anywhere"
```

(standard trailer.)

---

### Task 2: TS mirror — `sessionDelete` wrapper + `ConvaBackend` + both backends

**Files:**
- Modify: `src/lib/commands.ts`
- Modify: `src/lib/backend/ConvaBackend.ts`
- Modify: `src/lib/backend/tauri.ts`
- Modify: `src/lib/backend/web.ts`

No `ipc.rs`/`ipc.ts` entry — same as `conversationDelete`, a plain
scalar-in/unit-out command, not a shared data shape.

- [ ] **Step 1: `commands.ts`.** Insert immediately after `sessionLoad`
  (currently lines 459-461):

```ts
export function sessionDelete(id: string): Promise<void> {
  return invoke("session_delete", { id });
}
```

- [ ] **Step 2: `ConvaBackend.ts`.** In the `sessions` interface (starts
  at line 229), add a `delete` method — matching `conversations`'s own
  `delete(id: string): Promise<void>;` line (line 178):

```ts
  sessions: {
    list(): Promise<SessionSummary[]>;
    load(id: string): Promise<TranscriptSegment[]>;
    delete(id: string): Promise<void>;
    /** Desktop-only: write Markdown to a path. Web → browser download. */
    exportTranscript(path: string, segments: TranscriptSegment[]): Promise<void>;
```

  (i.e. insert the `delete(id: string): Promise<void>;` line right after
  `load(id: string): Promise<TranscriptSegment[]>;`, before the
  `exportTranscript` doc comment.)

- [ ] **Step 3: `tauri.ts`.** The `sessions` object (lines 136-142) gains
  `delete`:

```ts
  sessions = {
    list: cmd.sessionList,
    load: cmd.sessionLoad,
    delete: cmd.sessionDelete,
    exportTranscript: cmd.exportTranscript,
    analyzeConversation: cmd.analyzeConversation,
    writeTextFile: cmd.writeTextFile,
  };
```

- [ ] **Step 4: `web.ts`.** The `sessions` object (lines 210-217) gains
  `delete`, using the `todo()` convention its sibling `list`/`load`
  already use (a future REST endpoint is expected, unlike the
  desktop-only `exportTranscript`/`analyzeConversation`/`writeTextFile`
  below it, which use `unsupported()`):

```ts
  sessions = {
    list: (): Promise<SessionSummary[]> => todo("GET /v1/sessions"),
    load: (): Promise<TranscriptSegment[]> => todo("GET /v1/sessions/:id"),
    delete: (): Promise<void> => todo("DELETE /v1/sessions/:id"),
    exportTranscript: (): Promise<void> => unsupported("sessions.exportTranscript (file path)"),
    analyzeConversation: (): Promise<string> =>
      unsupported("sessions.analyzeConversation (desktop LLM analysis)"),
    writeTextFile: (): Promise<void> => unsupported("sessions.writeTextFile (file path)"),
  };
```

- [ ] **Step 5: Verify — typecheck.** Run: `npx tsc -b`

  Expected: no errors. (This is also the step that would catch a
  `ConvaBackend` interface/implementation mismatch — e.g. forgetting
  `delete` in `web.ts` — since both `TauriBackend` and `WebBackend`
  declare `implements ConvaBackend`.)

- [ ] **Step 6: Commit.**

```bash
git add src/lib/commands.ts src/lib/backend/ConvaBackend.ts src/lib/backend/tauri.ts src/lib/backend/web.ts
git commit -m "feat(sessions): wire sessionDelete through commands.ts, ConvaBackend, both backends"
```

(standard trailer.)

---

### Task 3: `<ListRow>` shared component

**Files:**
- Create: `src/components/ui/ListRow.tsx`
- Create: `src/components/ui/ListRow.test.tsx`

- [ ] **Step 1: Write the failing tests.**

```tsx
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ListRow } from "@/components/ui/ListRow";

afterEach(cleanup);

describe("ListRow", () => {
  it("renders title, badge, and date", () => {
    render(
      <ListRow
        accent="primary"
        title="Amazon interview prep"
        badge={{ text: "Context", tone: "ai" }}
        date="8/21/2026, 4:40:25 PM · 5 segments"
        onClick={vi.fn()}
      />,
    );
    expect(screen.getByText("Amazon interview prep")).toBeInTheDocument();
    expect(screen.getByText("Context")).toBeInTheDocument();
    expect(screen.getByText("8/21/2026, 4:40:25 PM · 5 segments")).toBeInTheDocument();
  });

  it("clicking the row calls onClick", () => {
    const onClick = vi.fn();
    render(<ListRow accent="muted" title="Row" date="—" onClick={onClick} />);
    fireEvent.click(screen.getByRole("button", { name: "Row" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("checking the checkbox fires onSelectChange, not onClick", () => {
    const onClick = vi.fn();
    const onSelectChange = vi.fn();
    render(
      <ListRow
        accent="primary"
        title="Row"
        date="—"
        onClick={onClick}
        onSelectChange={onSelectChange}
      />,
    );
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Row" }));
    expect(onSelectChange).toHaveBeenCalledWith(true);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("clicking the trash can fires onDelete, not onClick", () => {
    const onClick = vi.fn();
    const onDelete = vi.fn();
    render(
      <ListRow accent="primary" title="Row" date="—" onClick={onClick} onDelete={onDelete} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete Row" }));
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("omitting onSelectChange/onDelete renders no checkbox or trash button", () => {
    render(<ListRow accent="muted" title="Row" date="—" onClick={vi.fn()} />);
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByRole("button", { name: /delete/i })).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure.** Run:
  `npx vitest run src/components/ui/ListRow.test.tsx`

  Expected: FAIL — `Cannot find module '@/components/ui/ListRow'` (the
  file doesn't exist yet).

- [ ] **Step 3: Implement `ListRow.tsx`.**

```tsx
import { Icon } from "@/components/ui/Icon";

export type ListRowAccent = "primary" | "muted" | "ai";

const ACCENT_VAR: Record<ListRowAccent, string> = {
  primary: "var(--color-primary)",
  muted: "var(--color-fg-faint)",
  ai: "var(--color-ai)",
};

export interface ListRowProps {
  accent: ListRowAccent;
  title: string;
  badge?: { text: string; tone: ListRowAccent };
  date: string;
  selected?: boolean;
  /** Omit -> the checkbox column renders as an empty spacer, not omitted
   *  (keeps column widths identical across every row in a list — see the
   *  Rehearsals tab in ConversationsPanel.tsx, which reuses this shape
   *  with neither optional prop wired). */
  onSelectChange?: (checked: boolean) => void;
  /** Omit -> the trash-can column renders as an empty spacer. */
  onDelete?: () => void;
  onClick: () => void;
}

/**
 * One consistent row shape for the Conversations page's All-activity/
 * History list (owner, 2026-08-30 — "each row simple 1 row high, like a
 * grid with the icons on the far right"). Fixed CSS Grid columns mean the
 * title cell can only truncate, never wrap — that's what actually fixes
 * the reported inconsistent row heights: the old flex rows had no width
 * constraint on their metadata fields, so at narrow window widths they
 * wrapped onto a second line, reading as a taller "header" row next to
 * shorter ones. `accent` carries the row's type in color: azure/`primary`
 * for a saved conversation, muted gray/`muted` for an unsaved session,
 * gold/`ai` for a rehearsal-tagged session — see the design doc for the
 * full rationale (`docs/superpowers/specs/2026-08-30-conversations-row-
 * redesign-design.md`).
 *
 * The row itself is the clickable "open" target — checkbox and trash-can
 * clicks call `event.stopPropagation()` so they don't also fire `onClick`.
 */
export function ListRow({
  accent,
  title,
  badge,
  date,
  selected = false,
  onSelectChange,
  onDelete,
  onClick,
}: ListRowProps) {
  const accentVar = ACCENT_VAR[accent];
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      aria-label={title}
      className={[
        "grid h-[34px] cursor-pointer grid-cols-[3px_14px_minmax(0,1fr)_auto_auto_20px]",
        "items-center gap-2 rounded-md border pr-2 transition",
        selected
          ? "border-primary/35 bg-primary/10"
          : "border-transparent bg-bg/40 hover:border-border hover:bg-panel-raised",
      ].join(" ")}
    >
      <span className="h-full rounded-sm" style={{ background: accentVar }} aria-hidden="true" />
      {onSelectChange ? (
        <input
          type="checkbox"
          checked={selected}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => onSelectChange(e.target.checked)}
          aria-label={`Select ${title}`}
          className="h-3.5 w-3.5 cursor-pointer"
          style={{ accentColor: accentVar }}
        />
      ) : (
        <span aria-hidden="true" />
      )}
      <span className="min-w-0 truncate text-left text-xs text-fg">{title}</span>
      {badge ? (
        <span
          className="shrink-0 rounded-full px-1.5 py-0.5 font-mono text-[9px] tracking-wide"
          style={{
            background: `color-mix(in srgb, ${ACCENT_VAR[badge.tone]} 16%, transparent)`,
            color: ACCENT_VAR[badge.tone],
          }}
        >
          {badge.text}
        </span>
      ) : (
        <span />
      )}
      <span className="shrink-0 whitespace-nowrap font-mono text-[10px] text-fg-faint">
        {date}
      </span>
      {onDelete ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          aria-label={`Delete ${title}`}
          title="Delete"
          className="grid h-5 w-5 place-items-center rounded-sm text-fg-faint transition hover:bg-rec/10 hover:text-rec"
        >
          <Icon name="trash" size={12} />
        </button>
      ) : (
        <span aria-hidden="true" />
      )}
    </div>
  );
}
```

  Note: the title cell is a plain `<span>`, not a nested `<button>` — the
  outer `div[role="button"]` is what's clickable (matching the test's
  `getByRole("button", { name: "Row" })`, which resolves via the outer
  element's `aria-label`). A `<button>` can't contain another interactive
  `<button>`/`<input>` without breaking HTML semantics, which is why the
  checkbox/trash are siblings of the title inside the row, not nested
  inside a title-button — the original `ConversationsPanel.tsx` code
  already follows this same siblings-not-nesting pattern for its
  row-button + delete-button pair.

- [ ] **Step 4: Run to verify pass.** Run:
  `npx vitest run src/components/ui/ListRow.test.tsx`

  Expected: all 5 tests PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/components/ui/ListRow.tsx src/components/ui/ListRow.test.tsx
git commit -m "feat(ui): add shared ListRow grid component"
```

(standard trailer.)

---

### Task 4: Wire `ListRow` + multi-select + bulk delete into `ConversationsPanel.tsx`

**Files:**
- Modify: `src/components/ConversationsPanel.tsx`
- Modify: `src/components/ConversationsPanel.test.tsx`

- [ ] **Step 1: Write the failing tests.** Append to
  `src/components/ConversationsPanel.test.tsx` (extend the existing
  `fakeBackend` helper — it currently only stubs `list` on each namespace —
  and add these three `it` blocks inside the existing `describe`):

```tsx
function conversationRow(overrides: Partial<ConversationSummary> = {}): ConversationSummary {
  return {
    id: "conv-1",
    title: "Amazon interview prep",
    created_at_unix_ms: 0,
    updated_at_unix_ms: 1_000,
    segment_count: 5,
    linked_docs: [],
    preview: "",
    ...overrides,
  };
}

function sessionRow(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: "session-1",
    started_at_unix_ms: 2_000,
    segment_count: 3,
    preview: "hello",
    is_rehearsal: false,
    simcon_title: null,
    ...overrides,
  };
}
```

  Update the imports at the top: add `ConversationSummary` and
  `SessionSummary` to the existing `@/lib/ipc` type import.

  Replace `fakeBackend` with a version that also stubs `delete` on both
  namespaces and accepts rows:

```tsx
function fakeBackend(
  contexts: ContextSummary[],
  conversations: ConversationSummary[] = [],
  sessions: SessionSummary[] = [],
): ConvaBackend {
  return {
    conversations: {
      list: vi.fn().mockResolvedValue(conversations),
      delete: vi.fn().mockResolvedValue(undefined),
    },
    sessions: {
      list: vi.fn().mockResolvedValue(sessions),
      delete: vi.fn().mockResolvedValue(undefined),
    },
    context: { list: vi.fn().mockResolvedValue(contexts) },
    rag: { list: vi.fn().mockResolvedValue([]) },
  } as unknown as ConvaBackend;
}
```

  (The two existing tests call `fakeBackend([])`/`fakeBackend([context()])`
  — both still work unchanged, since `conversations`/`sessions` default to
  `[]`.)

  New tests:

```tsx
  it("checking two rows shows the bulk bar with a count of 2", async () => {
    const backend = fakeBackend([], [conversationRow()], [sessionRow()]);
    render(
      <BackendProvider backend={backend}>
        <ConversationsPanel onClose={vi.fn()} />
      </BackendProvider>,
    );
    await screen.findByText("Amazon interview prep");

    fireEvent.click(screen.getByRole("checkbox", { name: /select amazon interview prep/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: /select hello/i }));

    expect(await screen.findByText("2 selected")).toBeInTheDocument();
  });

  it("bulk delete dispatches to the right backend call per row kind", async () => {
    const backend = fakeBackend([], [conversationRow()], [sessionRow()]);
    render(
      <BackendProvider backend={backend}>
        <ConversationsPanel onClose={vi.fn()} />
      </BackendProvider>,
    );
    await screen.findByText("Amazon interview prep");

    fireEvent.click(screen.getByRole("checkbox", { name: /select amazon interview prep/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: /select hello/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete selected" }));

    await waitFor(() => {
      expect(backend.conversations.delete).toHaveBeenCalledWith("conv-1");
      expect(backend.sessions.delete).toHaveBeenCalledWith("session-1");
    });
  });

  it("a session row's own trash can calls backend.sessions.delete", async () => {
    const backend = fakeBackend([], [], [sessionRow()]);
    render(
      <BackendProvider backend={backend}>
        <ConversationsPanel onClose={vi.fn()} />
      </BackendProvider>,
    );
    await screen.findByText("hello");

    fireEvent.click(screen.getByRole("button", { name: /delete hello/i }));

    await waitFor(() => expect(backend.sessions.delete).toHaveBeenCalledWith("session-1"));
  });

  it("switching filter tabs clears any selection", async () => {
    const backend = fakeBackend([], [conversationRow()], []);
    render(
      <BackendProvider backend={backend}>
        <ConversationsPanel onClose={vi.fn()} />
      </BackendProvider>,
    );
    await screen.findByText("Amazon interview prep");
    fireEvent.click(screen.getByRole("checkbox", { name: /select amazon interview prep/i }));
    await screen.findByText("1 selected");

    fireEvent.click(screen.getByRole("button", { name: "History" }));
    fireEvent.click(screen.getByRole("button", { name: "All activity" }));

    expect(screen.queryByText(/selected$/)).toBeNull();
  });
```

  Also add `waitFor` to the existing `@testing-library/react` import line.

- [ ] **Step 2: Run to verify failure.** Run:
  `npx vitest run src/components/ConversationsPanel.test.tsx`

  Expected: FAIL — the new tests can't find checkboxes/the bulk bar
  (current rows have no checkbox; sessions have no delete button at all).

- [ ] **Step 3: Implement.** In `ConversationsPanel.tsx`:

  **3a.** Add the import (with the other `@/components/ui/*` imports,
  near the existing `Icon` import at line 5):

```tsx
import { ListRow } from "@/components/ui/ListRow";
```

  **3b.** Add multi-select state, right after the existing `filter` state
  (currently `const [filter, setFilter] = useState<Filter>("all");` at
  line 191):

```tsx
  const [selected, setSelected] = useState<Set<string>>(new Set());
```

  **3c.** Clear it on filter change — extend the existing filter-tab
  button `onClick` (currently `onClick={() => setFilter(f.key)}` at line
  508) to also clear selection:

```tsx
            onClick={() => {
              setFilter(f.key);
              setSelected(new Set());
            }}
```

  **3d.** Add a bulk-delete handler, near the existing `remove` function
  (currently lines 380-388):

```tsx
  const deleteSelected = async () => {
    const ids = Array.from(selected);
    try {
      await Promise.all(
        ids.map((key) =>
          key.startsWith("c-")
            ? backend.conversations.delete(key.slice(2))
            : backend.sessions.delete(key.slice(2)),
        ),
      );
    } catch (e) {
      setNotice(String(e));
    } finally {
      if (selected.has(`c-${openId}`)) newConversation();
      setSelected(new Set());
      await refresh();
    }
  };
```

  **3e.** Replace the conversation/session row-rendering block (currently
  lines 657-720, the `<ul className="flex flex-col gap-1.5">...rows.map...`
  block reached when `filter` isn't `"search"`/`"rehearse"` and `rows.length > 0`)
  with:

```tsx
      ) : (
        <div className="flex flex-col gap-2">
          <div
            className={`flex items-center justify-between gap-2 overflow-hidden rounded-md border px-2.5 transition-all ${
              selected.size > 0
                ? "h-[30px] border-rec/35 bg-rec/[0.12] opacity-100"
                : "h-0 border-transparent opacity-0"
            }`}
          >
            <span className="font-mono text-[11px] text-fg">{selected.size} selected</span>
            <span className="flex gap-2">
              <button
                type="button"
                onClick={() => setSelected(new Set())}
                className="text-[10.5px] font-bold text-fg-faint hover:text-fg"
              >
                Clear
              </button>
              <button
                type="button"
                onClick={() => void deleteSelected()}
                className="rounded bg-rec px-2 py-0.5 text-[10.5px] font-bold text-bg"
              >
                Delete selected
              </button>
            </span>
          </div>

          <ul className="flex flex-col gap-1">
            {rows.map((row) => {
              const key = row.kind === "conversation" ? `c-${row.id}` : `s-${row.id}`;
              const toggle = (checked: boolean) =>
                setSelected((prev) => {
                  const next = new Set(prev);
                  if (checked) next.add(key);
                  else next.delete(key);
                  return next;
                });
              if (row.kind === "conversation") {
                return (
                  <li key={key}>
                    <ListRow
                      accent="primary"
                      title={row.data.title}
                      date={`${formatDate(row.data.updated_at_unix_ms)} · ${row.data.segment_count} segment${row.data.segment_count === 1 ? "" : "s"}${row.data.linked_docs.length > 0 ? ` · ${row.data.linked_docs.length} linked doc(s)` : ""}`}
                      selected={selected.has(key)}
                      onSelectChange={toggle}
                      onDelete={() => void remove(row.id)}
                      onClick={() => void open(row.id)}
                    />
                  </li>
                );
              }
              return (
                <li key={key}>
                  <ListRow
                    accent={row.data.is_rehearsal ? "ai" : "muted"}
                    title={
                      row.data.is_rehearsal && row.data.simcon_title
                        ? row.data.simcon_title
                        : row.data.preview || "(empty)"
                    }
                    badge={
                      row.data.is_rehearsal
                        ? { text: "Context", tone: "ai" }
                        : { text: "Unsaved", tone: "muted" }
                    }
                    date={`${formatDate(row.data.started_at_unix_ms)} · ${row.data.segment_count} segment${row.data.segment_count === 1 ? "" : "s"}`}
                    selected={selected.has(key)}
                    onSelectChange={toggle}
                    onDelete={() => void backend.sessions.delete(row.id).then(refresh)}
                    onClick={() => void openPastSession(row.id)}
                  />
                </li>
              );
            })}
          </ul>
        </div>
      )}
```

  This replaces from the `) : (` that currently opens the row-list branch
  (line 656) through its matching `)}` (line 722) — the `rows.length === 0`
  empty-state branch above it (lines 650-655) is unchanged.

  **3f.** Rehearsals-tab rows (lines 628-648, reached when
  `filter === "rehearse"`) get the same visual family via `ListRow`, with
  neither `onSelectChange` nor `onDelete` wired (so no checkbox/trash
  render — see `ListRow`'s own doc comment):

```tsx
          <ul className="flex flex-col gap-1">
            {contexts.map((c) => (
              <li key={c.id}>
                <ListRow
                  accent="ai"
                  title={c.title}
                  badge={{ text: STATUS_LABEL[c.status], tone: "ai" }}
                  date={`${c.source_doc_count} doc${c.source_doc_count === 1 ? "" : "s"}`}
                  onClick={() => rehearse(c.id)}
                />
              </li>
            ))}
          </ul>
```

  (Replaces the existing `<ul className="flex flex-col gap-1.5">...contexts.map...`
  block, lines 628-648. `STATUS_TONE` becomes unused once this lands —
  remove its declaration, lines 35-41, along with this change, or `tsc`/
  lint will flag the dead export.)

- [ ] **Step 4: Run to verify pass.** Run:
  `npx vitest run src/components/ConversationsPanel.test.tsx`

  Expected: all tests (2 pre-existing + 4 new) PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/components/ConversationsPanel.tsx src/components/ConversationsPanel.test.tsx
git commit -m "feat(conversations): ListRow grid + checkbox bulk delete + per-row trash"
```

(standard trailer.)

---

### Task 5: Search results — matching accent color, still two lines

**Files:**
- Modify: `src/components/ConversationsPanel.tsx`

Per the design doc's explicitly-flagged judgment call: search hits keep
their two-line shape (the highlighted snippet is the point of a search
result — collapsing it away would be a regression), but pick up the same
left accent color as the other lists for family resemblance.

- [ ] **Step 1: Implement.** In the search-results `<ul>` (currently lines
  586-617), change the `<button>`'s className to add a left accent border
  keyed by row kind, replacing:

```tsx
                    <button
                      type="button"
                      onClick={() => void openSearchHit(hit)}
                      className="row w-full flex-col items-start gap-0.5 !py-1.5"
                    >
```

  with:

```tsx
                    <button
                      type="button"
                      onClick={() => void openSearchHit(hit)}
                      className="row w-full flex-col items-start gap-0.5 border-l-[3px] !py-1.5"
                      style={{
                        borderLeftColor:
                          hit.rowKind === "conversation" ? "var(--color-primary)" : "var(--color-fg-faint)",
                      }}
                    >
```

  (No `is_rehearsal` distinction here — `SearchHit` doesn't carry that
  field, and threading it through would widen this task; conversation vs.
  session is the distinction search results already made via `rowKind`
  before this change, e.g. the icon on line 596.)

- [ ] **Step 2: Verify.** Run: `npx tsc -b` — expect no errors (no new
  logic, just a className/style addition; no new test needed for a pure
  visual accent).

- [ ] **Step 3: Commit.**

```bash
git add src/components/ConversationsPanel.tsx
git commit -m "style(conversations): accent-color the search-results left edge to match"
```

(standard trailer.)

---

### Task 6: Full verification + push

**Files:** none (verification only)

- [ ] **Step 1: Full TS/UI check.**

```bash
npx tsc -b
npx vitest run
rm -rf dist && npm run build
```

  Expected: `tsc -b` clean; `vitest run` shows all files passing,
  including the new `ListRow.test.tsx` (5 tests) and the extended
  `ConversationsPanel.test.tsx` (6 tests, up from 2); `npm run build`
  completes with no errors.

- [ ] **Step 2: Rust format check** (the only local Rust verification
  available in this sandbox — see Task 1 Step 4 for why):

```bash
cargo fmt --check -p conva-app
```

  Expected: no output.

- [ ] **Step 3: Push and open a PR.**

```bash
git push -u origin claude/conva-app-conversations-row-redesign
```

  Open a draft PR against `main`. Body should note explicitly: **Rust
  changes are unverified beyond `cargo fmt --check` and a manual read
  against the `conversations::delete` pattern it mirrors** — CI's
  Windows `Tauri shell` job is the first real compile, and the owner's
  own `npm run tauri:gpu` rebuild is what actually proves
  `session_delete` and the new UI work end-to-end. Subscribe to the PR's
  activity per the standing GitHub-integration rules.

## Self-review

**Spec coverage:** every numbered requirement in the design doc's
"Requirements" section maps to a task — (1) scope/three lists → Tasks 4
(all-activity), 4-3f (rehearsals), 5 (search); (2) color-by-type → Task 4
(`accent` prop threading) and Task 3 (`ACCENT_VAR`); (3) checkbox + bulk +
per-row trash → Task 4; (4) `session_delete` command → Tasks 1-2; (5)
Rehearsals stays unwired → Task 4 Step 3f explicitly omits both handler
props. The "Out of scope" section's four items (no confirm dialog, no
Context delete, no search-hit-record delete, no data-model change) are
each honored by omission — no task adds any of them.

**Placeholder scan:** no TBD/TODO; every step has complete, exact code
(not "similar to Task N" — Task 4's `ListRow` usages are written out in
full for both conversation and session branches even though they share
most props, since a worker reading tasks out of order needs the whole
thing).

**Type consistency:** `ListRowAccent`/`ListRowProps` defined once in Task
3, used identically (prop names, `accent` values) in every Task 4/5 call
site — cross-checked `"primary"`/`"muted"`/`"ai"` are the only values used
anywhere. `sessionDelete`/`session_delete`/`delete_session` naming is
consistent across Rust → Tauri command → TS wrapper → `ConvaBackend`
method at every layer (Tasks 1-2).

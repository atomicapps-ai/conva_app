# Rename SimCon → Context (finish the terminology migration)

> Brainstorming-skill design doc. Status: **approved** (owner, 2026-08-27).
> Owner definitions this rename settles on:
> 1. **Context** — the encompassing theme/parameters (docs, JD, glossary,
>    key terms, personas) that, by type, better prepare the user for a
>    conversation. This is what `SimConSession` already *is*.
> 2. **Conversation** — a group of people in a call/discussion with a
>    goal. Already exactly `Conversation`/`conversations.rs` — untouched.
> 3. **Rehearsal** — the live practice run against a generated persona,
>    grounded by a Context. Already exactly `RehearsalBar.tsx`/
>    `useRehearsalStore` — untouched.

## Problem

"SimCon" ("Simulated Conversation") is the legacy internal name for what
the product already calls a **Context** everywhere external-facing: the
page is titled "Conversation Contexts," the components are
`ContextsPane`/`ContextsView`, and the generated documents are already
named "*— Context knowledge*" — never "SimCon knowledge." The rename to
"Context" is already ~80% done in the UI; "SimCon" is what's left over
in type/file/command names and a residue of leaked UI copy (`ViewShell`
titles "Edit Sim Con"/"New Sim Con," error text, `SettingsPanel.tsx`
usage labels, `ConversationsPanel.tsx` tags) — which is exactly what the
owner ran into while editing a "Context" and still seeing "Sim Con."

A tempting alternative — renaming SimCon to "Rehearsal" instead — was
considered and rejected: "Rehearsal" already names a *different*,
existing concept (the live practice session, `RehearsalBar.tsx`), and the
current UI copy already says "Sim Con rehearsal" — SimCon is the noun,
rehearsal the activity performed with it. Renaming SimCon to Rehearsal
would collide two distinct concepts into one word.

## Design

Rename every SimCon symbol/file/command to its Context equivalent,
finishing the migration in place — same behavior, same data shape, only
names change. Two naming rules, chosen to avoid new collisions and match
what's already shipped:

- The primary session type — `SimConSession` — becomes
  **`ConversationContext`** (the full, precise name, matching the
  product's own "Conversation Context" branding exactly, and avoiding any
  ambiguity with the *unrelated* `HighlightContext` struct already in
  `highlight.rs`, or with a bare generic `Context`).
- Every sibling type keeps the short `Context*` prefix (matches the
  existing internal convention, e.g. `SimConPersona` was already short,
  not `SimulatedConversationPersona`): `SimConCategory` →
  `ContextCategory`, `SimConStatus` → `ContextStatus`, `SimConPersona` →
  `ContextPersona`, `SimConSummary` → `ContextSummary`.

Module and file renames follow the type renames directly. Tauri command
names drop the `simcon_` prefix for `context_` (`simcon_save` →
`context_save`, etc. — full list below); the frontend's
`backend.simcon.*` namespace becomes `backend.context.*`. Component files
`SimConSetup.tsx`/`SimConDetail.tsx` → `ContextSetup.tsx`/
`ContextDetail.tsx`, folder `src/components/simcon/` →
`src/components/context/`. Leftover "Sim Con" UI copy is reworded to
"Context" (see the copy list below) — matching the voice the rest of the
Contexts UI already uses, not literally s/Sim Con/Context/ everywhere
grammar would break.

**Metering keys are a special case.** `simcon_knowledge`,
`simcon_research_findings`, `simcon_qa`, `simcon_personas` are historical
usage-tracking keys already recorded in on-disk usage data
(`metering::record_llm` et al.). Renaming the *emitted* keys to
`context_knowledge`/`context_research_findings`/`context_qa`/
`context_personas` going forward is fine (no migration of historical
files — this is a local, single-user, desktop app; a one-time
discontinuity in a usage chart is an acceptable, honest cost, not a data
problem to solve). But `SettingsPanel.tsx`'s `USAGE_LABELS` display map
keeps **both** the old and new keys mapped to the same human label (e.g.
`simcon_knowledge` and `context_knowledge` both → "Context · knowledge")
so historical rows still render with a real label instead of a raw
unmapped key string — no data migration, just a display-side alias kept
permanently.

### Scope inventory

**Rust — `crates/conva-core`:**
- `src/simcon.rs` → `src/context.rs`; `lib.rs`'s `pub mod simcon;` →
  `pub mod context;`.
- Types: `SimConSession` → `ConversationContext`, `SimConCategory` →
  `ContextCategory`, `SimConStatus` → `ContextStatus`, `SimConPersona` →
  `ContextPersona`, `SimConSummary` → `ContextSummary`.
- Every fn/const/test in the module referencing these names (e.g.
  `knowledge_prompt(session: &SimConSession, ...)` →
  `knowledge_prompt(context: &ConversationContext, ...)`, and the many
  `simcon::tests::*` unit tests) — mechanical, no behavior change.
- Every other core file importing these types (`highlight.rs` uses
  `SimConSession`/`SimConCategory` in a couple of signatures — grep
  confirms this at plan time).

**Rust — `src-tauri`:**
- `src/simcon.rs` → `src/context.rs`; `lib.rs`'s `mod simcon;` →
  `mod context;`.
- 13 Tauri commands, `simcon_*` → `context_*`: `save`, `list`, `load`,
  `delete`, `store_docs`, `prepare`, `load_profile`,
  `generate_dossier`, `generate_personas`, `choose_persona`,
  `start_rehearsal`, `rehearsal_your_turn`, `rehearsal_say` — both the
  `#[tauri::command] fn` names and their entries in the
  `generate_handler![...]` list, in the same commit (a command whose
  Rust name and registered name disagree fails at runtime, not compile
  time — this pairing is the actual risk in this whole rename).
- Metering keys as described above (emit `context_*`, no data migration).

**TypeScript — `src/lib`:**
- `ipc.ts`: the 5 mirrored types, renamed identically to the Rust side.
- `commands.ts` / `backend/tauri.ts` / `backend/web.ts` /
  `backend/ConvaBackend.ts`: the `simcon` namespace → `context`, each
  wrapped command's `invoke("simcon_...")` string → `invoke("context_...")`.

**TypeScript — `src/components`:**
- `src/components/simcon/` → `src/components/context/`.
- `SimConSetup.tsx` → `ContextSetup.tsx`, `SimConSetup.test.tsx` →
  `ContextSetup.test.tsx`, `SimConDetail.tsx` → `ContextDetail.tsx`
  (`RehearsalBar.tsx` stays — it's already correctly named and unrelated
  to this rename beyond updating its internal `backend.simcon.*` calls).
- Every importer of these files/exports across `src/` (`ContextsView.tsx`,
  `ContextsPane.tsx`, `ConversationsPanel.tsx`, `ViewRouter.tsx`,
  `CommandPalette.tsx`, `DashboardView.tsx`, `GroundPicker.tsx` and its
  test, `SettingsPanel.tsx`) — grep at plan time for the authoritative
  list; the view-router key `"simcon"` → `"context"` alongside them.
- Leftover "Sim Con" UI copy (≈20 instances found in this session's audit
  across `ConversationsPanel.tsx`, `SettingsPanel.tsx`,
  `SimConSetup.tsx`/`SimConDetail.tsx`, `ContextsPane.test.tsx`,
  `Icon.tsx`'s comment, `ViewShell.tsx`'s comment) reworded to "Context."

## Out of scope

- Any change to `Conversation`/`conversations.rs` or
  `Rehearsal*`/`useRehearsalStore` — both already correctly named per the
  owner's definitions.
- Any change to `HighlightContext` (`highlight.rs`) — an unrelated,
  already-correctly-scoped internal type; not touched, and the reason
  `ConversationContext` (not bare `Context`) was chosen for the renamed
  session type.
- Historical usage-data file migration (see Design — display-side alias
  only).
- Any behavior change — this is a pure rename; every test's assertions
  stay semantically identical, only symbol names in the test code change.

## Testing

- `cargo test -p conva-core`: full suite green post-rename (renamed test
  module `context::tests`, all assertions unchanged in substance).
- `cargo fmt --check` / `cargo clippy -p conva-core --all-targets -- -D
  warnings`: clean.
- `npm run build` / `npm test`: clean, full suite green (renamed test
  files, same assertions).
- Shell (`src-tauri/`) not locally compilable in this sandbox — the
  command-name/`generate_handler!` pairing is the highest-risk spot in
  this rename, so it gets an explicit manual cross-check step (grep both
  the fn name and its `generate_handler!` entry match, for all 13) before
  every shell-touching commit, in addition to the CI Windows job.
- Manual QA (owner): every screen currently reachable via "Sim Con" wording
  (setup wizard, detail page, Settings usage table, Conversations panel
  tags, command palette "Go to Contexts") reads "Context" and functions
  identically — create, edit, generate, rehearse, save a conversation.

## Phasing (for the implementation plan)

Given the size, the plan sequences as: **Phase 1** — core crate (types +
module rename + internal tests), one commit, `cargo test -p conva-core`
gate. **Phase 2** — shell crate (module rename + all 13 commands +
`generate_handler!` + metering keys), one commit, fmt + manual
cross-check gate (no local compile). **Phase 3** — TypeScript mirror
(`ipc.ts` + `commands.ts` + backend adapters), one commit, `npm run
build` gate (this is what actually proves Phase 2's renamed command
strings match, since nothing else compile-checks Tauri command name
agreement). **Phase 4** — component/file renames + their importers,
likely 2–3 commits by area (setup+detail components; view routing +
command palette + dashboard; remaining leftover UI copy), `npm test` +
`npm run build` gate after each. **Phase 5** — full verification + push
+ new issue + PR, per this repo's established pattern.

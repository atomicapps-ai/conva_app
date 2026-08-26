# Context edit → regeneration & staleness (v1)

> Brainstorming-skill design doc. Status: **approved** (owner, 2026-08-26 —
> "yes, run all three through the pipeline"). Ships on
> `claude/conva-app-ui-modernization-igllsd` into PR #85.

## Problem (owner report, 2026-08-26)

"There is no way to re-run parsing… we need to allow editing on a context
and regeneration of the final document that is used in RAG storage."

Investigation found the affordances mostly exist (row ⋯ menu → Edit; row
sparkle = Generate resources; detail page → Ally prep document →
Regenerate; the backend regenerate already deletes the old dossier from RAG
and re-ingests), but three genuine defects make the system feel like
regeneration doesn't exist:

1. **Stale-terms trap.** `activate_context`'s two term backfills are both
   gated on `session.glossary.is_empty()`. A context whose glossary was
   persisted by the old (pre-hygiene) miner keeps its garbage terms
   forever — the new JD-first mining never runs for it, and editing the
   context doesn't invalidate anything.
2. **Edits don't propagate.** `simcon::save` never compares against the
   stored record: changing the job description, key terms, or documents
   leaves the derived glossary and the generated dossier silently stale,
   with no signal anywhere. Worse, the library-pane attach/detach path
   (`rag_attach_context`/`rag_detach_context`) only tags the document in
   the RAG store — it never syncs the context's `source_doc_ids` at all,
   so pane attaches don't even show in the row's doc count.
3. **Discoverability.** Regeneration hides behind an unlabeled sparkle
   icon and a button inside a card on the detail page; nothing ever says
   "your generated resources no longer match your inputs."

## Design (owner-approved: all three parts)

### 1. Grounding-change detection + invalidation (core + shell)

- New pure fn in `crates/conva-core/src/simcon.rs`:
  `pub fn grounding_changed(old: &SimConSession, new: &SimConSession) -> bool`
  — true when any grounding input differs: `job_description` (trimmed,
  `None` ≡ empty), `key_terms` (order-insensitive exact set),
  `source_doc_ids` (order-insensitive set), or `research_enabled`.
  Unit-tested in core.
- New field on `SimConSession` **and** `SimConSummary`:
  `resources_stale: bool` (`#[serde(default)]`; `simcon::list` copies it
  through). TS mirror in `src/lib/ipc.ts` updated **in the same commit**
  (rule 2/3), including test fixture helpers that construct these types.
- Shell `simcon::save` (src-tauri/src/simcon.rs): when the incoming
  session has a non-empty id and the stored record loads, and
  `grounding_changed(&old, &new)`:
  - clear `new.glossary` (it derives from the old inputs — next
    activation re-mines JD-first, a next Generate rebuilds from the new
    digest);
  - set `new.resources_stale = true` **iff** generated resources exist to
    be stale (`old.dossier_doc_id.is_some() || old.knowledge_profile_id.is_some()`).
  Internal save paths (dossier save, persona save, activation backfill
  persist) change no grounding fields, so they pass through untouched.
- `simcon_generate_dossier` sets `session.resources_stale = false` before
  its final save — a fresh digest by definition reflects current inputs.
- Shell `rag_attach_context` / `rag_detach_context` commands additionally
  sync the context record (best-effort — if the simcon load fails the tag
  operation still succeeds): add/remove the doc id in
  `session.source_doc_ids`, and when that changed apply the same
  invalidation (clear glossary; set `resources_stale` iff resources
  exist), then save. This makes pane/library attaches count and stale
  correctly for the first time.

### 2. JD terms always ride along at activation (shell)

In `activate_context`'s final term fill (after key_terms + glossary are
extended), when `session.job_description` is non-empty, merge
`conva_core::highlight::interviewer_terms(jd, 16)` into the active term
set, deduped case-insensitively against what's already there. In-memory
only — not persisted — so the interviewer's vocabulary is never hostage to
a stale or truncated digest.

### 3. Staleness surfaced + regeneration first-class (UI)

- `src/lib/ipc.ts`: `resources_stale: boolean` on both mirrored types
  (same commit as the Rust field, part 1).
- New pure helper `src/components/contexts/rowStatus.ts`:
  `rowStatus(s: SimConSummary): { label: string; tone: string }` — the
  existing `STATUS_LABEL`/`STATUS_TONE` mapping moves here, with one
  override: `s.resources_stale && s.has_generated_resources` →
  `{ label: "Stale", tone: "pill-ally" }` (gold = advisory, not
  alarm-red; only statuses `ready`/`ended` are overridden — an in-flight
  `ingesting`/`running` state keeps its own pill). Unit-tested.
- `ContextsPane` uses `rowStatus`; the stale pill gets
  `title="Inputs changed since resources were generated — regenerate"`.
- `RowMenu` gains a text-labeled **"Regenerate resources"** item (above
  Delete, below Edit) that calls the row's existing `onGenerate` path —
  same action as the sparkle, now discoverable. Hidden for the default
  context (same gate as Edit/Delete).
- `SimConDetail`'s "Ally prep document" card shows a one-line stale note
  when `session.resources_stale`: "Inputs changed since this was
  generated — Regenerate to refresh." (the Regenerate button is already
  on that card).

## Out of scope

- Editing the generated dossier's text by hand (regeneration is the
  refresh path; hand-edits would be overwritten).
- Auto-regeneration on save (LLM cost/latency shouldn't be a silent side
  effect of closing the wizard — the stale pill + labeled action is the
  owner-approved middle ground).
- Backfilling `source_doc_ids` for tags created before this change.

## Testing

- Core: `grounding_changed` — detects JD change (incl. None↔"" as no
  change), key-term set change, doc set change (order-insensitive),
  research toggle; returns false for unrelated edits (title, purpose,
  personas).
- UI: `rowStatus` — stale override applies on ready+generated, not on
  ingesting/running, not without generated resources; base mapping
  preserved.
- Shell changes compile-verified by CI's Windows job; behavior verified
  by the owner: edit the Amazon Interview context's JD → row flips to
  "Stale"; ⋯ → Regenerate resources → pill returns to Ready and the Terms
  list refreshes; attaching a doc from the library bumps the row's doc
  count and marks it Stale.

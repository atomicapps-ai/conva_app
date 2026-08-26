# Cached term definitions — instant retrieval from Ally's documents (v1)

> Brainstorming-skill design doc. Status: **approved** (owner, 2026-08-26 —
> "yes, run the pipeline"). Ships on `claude/conva-app-ui-modernization-igllsd`
> into PR #85.

## Problem (owner report, 2026-08-26)

"when i select one of the values that are from allys documents that should
already have been parsed, saved, compressed, and stored for fast retrieval
- when i click on retrieve it still takes a very long time for something
that should take under a milisecond."

## Root cause (traced 2026-08-26)

Every "Define" and "Fetch info" action — on ANY term, including one mined
straight from Ally's own generated **Context knowledge** document — calls
`useAllyStore.request()` → `backend.ally.run()`: a fresh RAG retrieval +
streaming LLM completion, unconditionally. There is no cache to hit,
because `extract_glossary`/`extract_glossary_entries` only ever captured
the bare **term name**. The one-line definition Ally already wrote right
next to it in the Core vocabulary section (`**API Gateway** — managed API
front door.`) is thrown away at extraction time. So a term whose answer was
already written, saved, and sitting in the Library gets **re-derived from
scratch** on every click — that's the "should be instant" gap.

`ViewHistory.tsx`'s card body already has the right fallback chain
(`chip?.capture?.preview ?? item.detail ?? "Fetch info or Define…"`) — it
was built to show cached content the moment nothing else exists. Nothing
upstream has ever populated `item.detail` for a doc term, so it always
falls through to the placeholder.

## Design (owner-approved)

### 1. Capture the definition alongside the term (core)

- `crates/conva-core/src/simcon.rs`: new `pub fn extract_glossary_entries(
  digest_md: &str) -> Vec<(String, String)>` — the exact same section/
  bold-fallback parsing `extract_glossary` does today, but also captures
  the text following the term (after the closing `**`, or after the first
  `—`/`–`/`:` when the term isn't bolded) as its definition, trimmed of
  leading punctuation/whitespace, capped at 200 chars, empty string when
  there's nothing on the line. `extract_glossary` becomes a one-line
  wrapper (`.into_iter().map(|(t, _)| t).collect()`) — identical output,
  every existing test keeps passing unchanged.
- `crates/conva-core/src/highlight.rs`: new `pub fn
  sanitize_glossary_entries(entries: Vec<(String, String)>, doc_text: &str,
  jd_text: Option<&str>, min_occurrences: usize) -> Vec<(String, String)>`
  — the same survival predicate as `sanitize_mined_terms` (factored into a
  shared private helper so the two can't drift), applied to the term half
  of each pair; a term that doesn't survive drops its definition with it.

### 2. Store it on the context (Rust + TS mirror, one commit)

- `SimConSession` gains `glossary_definitions:
  std::collections::BTreeMap<String, String>` (`#[serde(default)]`, keyed
  by the exact term string as it appears in `glossary` — both derive from
  the same sanitized entries list, so lookup is an exact match, no case
  folding needed). TS mirror: `glossary_definitions?: Record<string,
  string>`.
- Both shell sites that build `session.glossary` today (the Stage-1
  dossier-generation tail; `activate_context`'s digest-glossary backfill)
  switch to `extract_glossary_entries` → `sanitize_glossary_entries`,
  deriving `glossary` (terms, unchanged shape/order/count) AND
  `glossary_definitions` from the one sanitized list. The second-stage
  backfill (per-document heuristic mining, no digest) leaves
  `glossary_definitions` empty — mined vocabulary words never had a
  written definition to capture; Define still goes live for those, same
  as an undocumented live-detected term.

### 3. Thread it to the Found/View cards (frontend, additive)

- `TermChip` (`terms.ts`) gains `definition?: string`.
- `buildTermChips` gains an optional 4th param `docDefinitions?:
  Record<string, string>` — a doc-sourced chip's `definition` is looked up
  by its own label. `buildFoundGroups` (`foundGroups.ts`) threads the same
  optional param through and sets a term `FoundItem`'s `detail:
  chip.definition ?? null` (was always `null`) — this is the ONLY change
  needed in the render path: `ViewHistory`'s existing fallback chain
  already shows `item.detail` the instant the item is selected.
- `TranscriptView.tsx`'s grounding-load effect stores
  `session.glossary_definitions ?? {}` alongside the existing
  `docTerms`/`groundingDocs` state and passes it through to
  `buildFoundGroups`.

### 4. Retrieval is instant; deeper research stays live

- **Selecting** a doc-vocabulary item shows its definition immediately —
  zero clicks, zero LLM round-trip. This is the direct fix for "should
  take under a millisecond."
- **Define**, when a cached definition exists, is a no-op beyond making
  the entry visible (the body already shows it) — it does NOT call
  `askTerm`/the LLM. Gate: `TranscriptView.tsx`'s `onEntryDefine` checks
  `e.item.chip?.definition` first.
- **Fetch info** stays a live Ally call always — its label is explicit
  ("Ally researches this"): it's for going beyond the stored one-liner,
  not for re-serving it. Same for **Elaborate**.
- A term with no cached definition (live-detected, FANER capture, a
  user-typed key term, or second-stage-mined vocabulary) behaves exactly
  as today — Define/Fetch info go live, since nothing was ever written to
  retrieve.

## Out of scope

- Definitions for FANER captures or live-detected terms (those were never
  authored by Ally in a document — there's nothing to cache).
- Re-deriving definitions for glossary terms saved by an OLDER build
  before this change (they simply have no `glossary_definitions` entry
  until the next regenerate — same as any other backfill in this PR).

## Testing

- Core: `extract_glossary_entries` — captures the definition after a
  bolded term and after a non-bolded dash/colon term; empty definition
  when the line has nothing past the term; `extract_glossary`'s existing
  tests all still pass unchanged (proves the wrapper is lossless on the
  term axis). `sanitize_glossary_entries` — drops a pair whose term fails
  the existing hygiene predicate (one-off glue artifact), keeps a pair
  whose term survives, in both cases keeping/dropping the definition
  alongside.
- UI: `buildTermChips`/`buildFoundGroups` — a doc chip's `definition`
  populates from the map when present, is `undefined` when absent (and
  the existing captures/live paths are untouched); a term `FoundItem`'s
  `detail` carries the definition through to the card.
- Owner verification: select a Core-vocabulary term from the Amazon
  Interview context — its definition appears in the View card instantly,
  no spinner; clicking Define does nothing further (already shown);
  clicking Fetch info still researches live, as before.

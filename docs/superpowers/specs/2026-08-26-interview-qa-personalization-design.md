# Interview Q&A personalization (F10 increment)

> Brainstorming-skill design doc. Status: **approved** (owner, 2026-08-26).
> Shipping on `claude/conva-app-ui-modernization-igllsd` (restarted from
> main after PR #91 merged).

## Problem

Roadmap **F10 (FANER prep enrichment)** — [`faner-capture-algorithm.md`](../../../conva_core/docs/technical/faner-capture-algorithm.md)'s
Prep Engine §P3 — wants pre-generated answers "grounded in **playbook ×
the user's history × the role**." PR #91 shipped the web-research half
(Stage 3, `deep_qa_enabled`): a 20–100-pair Interview Q&A bank
(`interview_qa_prompt`), but it's built from web sources only — it never
sees the user's own uploaded documents (résumé, past work). The "history"
term in the spec's formula is unimplemented for this document, even
though Stage 1's `knowledge_prompt` already draws on the user's chunks for
its own "Likely questions & strong answers" section. This is the clearest
remaining gap in F10.

## Design

Single-pass: thread the same document chunks Stage 1 already retrieves
into Stage 3's prompt, so the model can ground an answer in the
candidate's real background when it applies, falling back to a strong
generic answer otherwise. No new retrieval, no new document, no second
LLM pass — this mirrors how `knowledge_prompt` already uses `chunks`
alongside research.

Two other approaches were considered and rejected: a second "personalize"
pass over the already-generated bank (an extra full LLM call, more
failure surface, no clear quality win over handing over the material
up front), and per-question targeted retrieval (N extra RAG queries for
~20–100 questions — precision gain not worth the cost/complexity here).

### `crates/conva-core/src/simcon.rs`

- `interview_qa_prompt` gains a `chunks: &[ScoredChunk]` parameter,
  inserted to match `knowledge_prompt`'s existing argument order
  (`session, research, chunks`): new signature
  `pub fn interview_qa_prompt(session: &SimConSession, sources: &[ResearchSource], chunks: &[ScoredChunk]) -> LlmRequest`.
- New constant `QA_PERSONAL_CHAR_BUDGET: usize = 6_000`. When `chunks` is
  non-empty, build a budgeted "Candidate's own background" block (same
  budget-loop shape as `knowledge_prompt`'s reference block) and insert it
  into the user prompt **before** the existing Sources section. When
  `chunks` is empty, the block is omitted entirely — no filler text (it's
  supplementary material for this document, not the primary content the
  way `knowledge_prompt` treats its reference block).
- System prompt gains one instruction, appended to the existing
  `interview_qa_prompt` system text: when the candidate's own material
  below supports a strong, specific personal answer (their real
  projects, technologies, outcomes), write the answer from their own
  experience, concretely; when their material doesn't cover a question,
  give a strong, correct, role-appropriate answer instead — never
  fabricate personal experience or claim something their material
  doesn't support as theirs.
- No visible marker distinguishing personalized vs. generic answers in
  the output (owner decision) — this is a content-quality change only,
  same document format as today.
- The existing, unbudgeted Sources loop is untouched — out of scope for
  this change.

### `src-tauri/src/lib.rs`

`simcon_generate_dossier`'s Stage 3 call becomes
`conva_core::simcon::interview_qa_prompt(&session, &qa_sources, &chunks)`
— `chunks` is already in scope (retrieved once at the top of the function
for Stage 1's `knowledge_prompt` call); no new RAG call.

## Out of scope

- Extending personalization to Stage 1 or Stage 2 documents (Stage 1
  already receives `chunks`; Stage 2's Research Findings is web-sourced
  by design).
- Any visible personalized/generic marker in the document.
- Budgeting/capping the existing Sources loop in `interview_qa_prompt`.
- Non-Interview categories (deep Q&A stays Interview-only, per PR #91).

## Testing

- Core: new test asserting the user prompt embeds chunk text (and stays
  within `QA_PERSONAL_CHAR_BUDGET`) when chunks are provided; a second
  test asserting no "background" section appears — and the rest of the
  prompt is unchanged — when chunks are empty (regression guard on
  existing behavior). System-prompt assertion that the personalization
  instruction text is present.
- The existing `interview_qa_prompt_demands_themed_broad_coverage` test's
  call site is updated for the new `chunks` argument.
- Shell change compile-verified by CI's Windows job, per this branch's
  established pattern (sandbox can't compile the shell).
- Owner manual verification: regenerate the Amazon Interview context
  (with a résumé attached) with deep Q&A enabled — spot-check that
  several of the ~20+ answers now cite the candidate's actual background
  where it plausibly applies, and that the rest remain solid generic
  answers where it doesn't.

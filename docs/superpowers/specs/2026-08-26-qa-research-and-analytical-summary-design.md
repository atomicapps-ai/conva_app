# Deep interview Q&A research + analytical performance download (v1)

> Brainstorming-skill design doc. Status: **approved** (owner, 2026-08-26).
> Two independent features shipping in one PR on
> `claude/conva-app-ui-modernization-igllsd` (restarted from main after
> PR #89 merged).

## Part A — Deep interview Q&A research (opt-in)

### A.1 Problem

The live cockpit's "Questions" accordion section is fed by **Radar** —
questions detected from the *live* transcript. It's correctly empty until
someone actually asks something on a call; it was never meant to hold
pre-researched interview questions. The owner's real ask is different: Ally
should proactively research the role/topic online and write a real bank of
common interview questions + strong answers into the generated **Context
knowledge** document — at least 20, scaling up to ~100 for well-covered
roles — as an opt-in pass (it costs meaningfully more searches/tokens than
default generation).

### A.2 Design (owner-approved)

- New opt-in field `deep_qa_enabled: bool` on `SimConSession` (Rust +
  TS mirror, `#[serde(default)]`). Checkbox in `SimConSetup.tsx`'s step-2,
  directly below the existing "Let Ally research" checkbox, in a new
  `Section` titled **"Deep interview Q&A research"**: "Ally searches the
  web broadly for common interview questions for this role and writes
  strong answers into your Context knowledge document — uses meaningfully
  more searches and tokens than standard research." Disabled + hinted
  ("needs web research enabled above") when `research` is off; category
  gate: only rendered when `category === "interview"`.
- New pure core fns in `crates/conva-core/src/simcon.rs`, parallel to
  `research_queries`/`research_findings_prompt`:
  - `pub fn qa_research_queries(session: &SimConSession, vocabulary: &[String], cap: usize) -> Vec<String>`
    — broader query set than Stage 2's: `"{role} most common interview
    questions"`, `"top interview questions for {role}"`, `"{role}
    technical interview questions"`, `"{role} behavioral interview
    questions"`, `"{topic} interview questions and answers"`, plus
    JD/vocabulary-seeded variants (reuse the chunk-of-3 pattern from
    `research_queries`). No fixed count target baked into the queries —
    breadth comes from more queries × more sources.
  - `pub fn interview_qa_prompt(session: &SimConSession, sources: &[ResearchSource]) -> LlmRequest`
    — system prompt: synthesize the sources into a **standalone Interview
    Q&A document**, organized by theme (`## Behavioral`, `## Technical`,
    `## Company & role-specific` — categories chosen by the model to fit
    what the sources actually support), each entry `**Q: ...** A: ...`
    (bolded question so it's `extract_glossary`-harvestable too, though
    that's incidental, not the point), grounded strictly in the sources,
    **at least 20 entries, up to 100** — the model is told to produce as
    many *distinct, well-supported* pairs as the material justifies, not
    to hit a fixed number. `max_tokens` generously sized (6000 — this is
    the biggest single document in the pipeline).
- Shell: new constants `QA_MAX_QUERIES: usize = 18`, `QA_MAX_SOURCES: usize
  = 45` (same `search_depth: "basic"`, same per-search billing model as
  Stage 2 — just more of them). `simcon_generate_dossier` gains a Stage 3,
  after Stage 2, gated on `session.deep_qa_enabled && session.research_enabled`:
  run `qa_research_queries` → the shared `research()` fetch loop (reused,
  parameterized by the two new constants) → `interview_qa_prompt` →
  synthesize → replace-on-regenerate via new `qa_doc_id: Option<String>`
  (Rust + TS mirror) → ingest as `"{title} — Interview Q&A"` → push into
  `profile.doc_ids`.
- UI: `SimConDetail.tsx`'s "Ally documents" card gains a third row,
  **Interview Q&A**, shown only when `qa_doc_id` is set (or
  `deep_qa_enabled` is on and generation is pending) — same View-toggle
  pattern as the other two rows. Attached-documents filter excludes
  `qa_doc_id` too.

### A.3 Out of scope

- Fixed per-role question-count targets (deliberately left to the model +
  source material, not user-configurable).
- Extending deep Q&A to non-interview categories (Sales/Meeting/Other) —
  future work; today's checkbox only renders for Interview.

## Part B — Analytical performance summary, downloadable

### B.1 Problem

Today's only conversation download is `export_transcript`: a plain,
speaker-labeled Markdown dump, no analysis. The owner wants an
**analytical** summary available on request — e.g. "how did you perform
on the resume [interview]" — offered as a second free download alongside
the existing transcript export. The existing 3-dot "Summarize the call"
(a quick 2-3 bullet mid-call recap) stays exactly as-is; this is a
distinct, explicitly-requested, post-call artifact.

### B.2 Design (owner-approved)

- **Conversation → context linkage (new, small).** Today `Conversation`
  has no link back to whatever Sim Con context was active while it was
  recorded (`SimConSession.conversation_id` is declared but never
  assigned anywhere — dead field, out of scope to wire retroactively).
  Instead: `Conversation` + `ConversationSummary` gain
  `linked_context_id: Option<String>` (Rust + TS mirror,
  `#[serde(default)]`). `conversations::save`'s signature gains a
  `context_id: Option<String>` param, stored on new saves and preserved
  across re-saves of an already-open conversation (mirrors how
  `created_at_unix_ms` survives). The ONE call site,
  `src/state/conversation.ts`'s `save()` action, passes
  `useGroundingStore.getState().activeId` — the session already tracks
  this for live grounding; capturing it at save time is a one-line
  addition, not new plumbing.
- **New pure core prompt-builder**, `crates/conva-core/src/simcon.rs`:
  `pub fn performance_analysis_prompt(category: Option<SimConCategory>,
  job_description: Option<&str>, glossary: &[String],
  transcript_text: &str) -> LlmRequest`. Category-aware framing:
  - `Some(Interview)`: "Analyze how well the user performed as the
    candidate in this interview — strengths, gaps versus the job
    description and the vocabulary an interviewer would expect, clarity
    and structure of answers, and concrete, specific suggestions for
    improvement. Cite specific moments from the transcript."
  - `Some(SalesCall)`: objection-handling, close attempts, rapport.
  - `Some(CompanyMeeting)` / `Some(Other)` / `None` (no linked context):
    a lighter structural analysis — clarity, decisions reached, follow-
    through — without role-specific claims the transcript alone can't
    support.
  - When `job_description`/`glossary` are present they're embedded as
    grounding material ("Role expectations:" / "Vocabulary the candidate
    was expected to know:"); when absent, the prompt omits those
    sections entirely rather than referencing missing material.
  `max_tokens` 3000 (a full report, bigger than the quick summarize's
  512).
- **New shell command** `analyze_conversation(id: String) -> Result<String, String>`:
  loads the `Conversation` by id; if `linked_context_id` is set, best-
  effort loads that `SimConSession` for category/JD/glossary (missing/
  deleted context → falls back to the ungrounded framing, never errors);
  renders the transcript the same way `export_transcript` does (reuse
  its formatting helper — extract it to a shared fn if it's currently
  inline); builds the prompt, streams the LLM call (metered via the
  existing `metering::record_llm`), returns the Markdown report text.
  IPC: mirrored in `ipc.ts`, wrapped in `commands.ts`
  (`analyzeConversation`), added to `ConvaBackend`/`tauri.ts`/`web.ts`.
- **UI**: `ConversationsPanel.tsx` gains a second export action next to
  "Export shown transcript…" — **"Analyze & download"** (icon: `summarize`
  or `ally`, gold-tinted to signal it's an LLM call, unlike the free
  instant transcript export). Click → busy state → `analyzeConversation`
  → same native save-dialog flow as the transcript export
  (`defaultPath: "conva-analysis.md"`), writes the returned Markdown to
  the chosen path. No new opt-in checkbox — the button click IS the
  explicit ask; cost is one LLM call same as any other Ask.

### B.3 Out of scope

- Any UI to browse/re-open a past analysis (this is a one-shot download,
  like the transcript export).
- Backfilling `linked_context_id` for conversations saved before this
  ships (they analyze ungrounded — same graceful degradation as any
  context-less conversation).

## Testing

- Core: `qa_research_queries` — vocabulary-seeded queries present, cap
  honored, no-vocabulary → base queries only (mirrors `research_queries`'
  existing test shape); `interview_qa_prompt` — themed section headings
  present, "at least 20" / "up to 100" instruction present, sources
  embedded; `performance_analysis_prompt` — each category branch produces
  its distinctive framing text, JD/glossary sections appear only when
  provided, `None` category still produces a valid generic prompt.
- Shell changes compile-verified by CI's Windows job (as with every prior
  shell round this session).
- UI: `SimConSetup` — deep-Q&A checkbox hidden for non-interview
  categories, disabled when research is off; conversation `save()` —
  passes the active grounding id.
- Owner manual verification: enable deep Q&A on the Amazon Interview
  context, regenerate — a third "Interview Q&A" document appears with
  20+ real Q&A pairs. Have a short rehearsal/live call grounded in that
  context, save the conversation, then "Analyze & download" from the
  Conversations panel — the downloaded report references the actual job
  description/vocabulary and cites specific transcript moments. Save an
  unlinked conversation and analyze it — a generic, still-useful
  structural analysis downloads without error.

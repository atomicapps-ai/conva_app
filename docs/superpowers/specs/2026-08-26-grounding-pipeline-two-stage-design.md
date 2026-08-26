# Two-stage grounding pipeline — Context knowledge + Research findings (v1)

> Brainstorming-skill design doc. Status: **approved** (owner, 2026-08-26 —
> "yes, write the spec and run it through the pipeline"; document split and
> research depth chosen via AskUserQuestion). Ships on
> `claude/conva-app-ui-modernization-igllsd` into PR #85.

## Owner expectation (verbatim intent, 2026-08-26)

1. "Ally service starts Processing the documents, descriptions, job
   description, questions and answers… a logic layer that considers the
   role, job description, type of context and relevant data and parses it
   into chunks that make access and finding faster and easier — ready for
   indexing or added to rag database."
2. "Ally processes prompting AI to query the internet to find findings
   relevant to the interview/context type. I want to see a human readable
   document just for testing. The final can be vector graph database ready
   for rag optimization."

## Gaps found (2026-08-26 investigation)

- No logic layer: documents are chunked generically; `prepare` only
  collects doc ids. The dossier prompt truncates the JD to **2,000 chars**
  (the missing "API Gateway" class of terms lives past that) and its
  "tight and scannable" instruction actively suppresses vocabulary
  coverage (no term-count contract → ~6–10 glossary bullets).
- Research is skeletal: 4 Tavily queries built from title/category only,
  8 sources, 500-char snippets, **no document produced** — nothing human
  readable to test, and the thin snippets are all RAG ever sees.
- Heuristic ceilings: `salient_doc_terms` routes through `relevant_terms`
  which hard-caps at `MAX_TERMS = 12` regardless of the requested limit,
  and scans only the first 4,000 chars — so `interviewer_terms(jd, 16)`
  really returns ≤12 terms from the JD's opening. Net effect after the
  hygiene gate: *fewer* terms than the old garbage-but-numerous list.

## Design (owner-approved)

One **Generate/Regenerate resources** action runs two stages, each
producing a Library document (owner choice: **two documents**).

### Stage 1 — "Context knowledge" document (the logic layer)

- New core `knowledge_prompt(session, chunks, max_tokens)` (evolves and
  replaces `dossier_prompt`): an LLM pass that reads the **full JD (slice
  raised 2,000 → 8,000 chars)**, the context type template, and the
  retrieved document content together, and writes structured Markdown
  with **fixed `##` sections** — for an interview: `Role profile` ·
  `Core vocabulary` · `Likely questions & strong answers` ·
  `Facts & figures` · `Watch-outs` (other categories keep their template
  sections, with their `Glossary` section renamed `Core vocabulary`).
- **Core vocabulary contract** (the term fix): 20–30 bullets, each
  `**Term** — one-line why it matters`, drawn from the job description
  FIRST then the documents, exact product/service names verbatim
  ("API Gateway", not "Gateway"); the "tight" instruction explicitly does
  not apply to this section. `max_tokens` 2,500 → 3,000.
- The fixed sections are the chunk boundaries — `chunk_text` is already
  heading-aware (breadcrumbs from `#` lines), so RAG indexes purposeful
  chunks ("Core vocabulary", "Likely questions…") instead of generic
  slices. This IS the "ready for indexing" form; see Out of scope for the
  vector/graph final form.
- Stored exactly like today's dossier (replace-on-regenerate via
  `dossier_doc_id`, profile doc_ids, `ingest_generated`), named
  `"{title} — Context knowledge"`.
- `extract_glossary` accepts the section heading `Glossary` **or**
  `Core vocabulary` (old docs + `DEFAULT_DIGEST_TEXT` keep working);
  `MAX_GLOSSARY_TERMS` 24 → 32.
- Heuristic ceiling fixes in `highlight.rs`: new
  `relevant_terms_capped(message, ctx, cap)` (public; `relevant_terms`
  delegates with `MAX_TERMS` so the live-message path is unchanged);
  `salient_doc_terms` passes its limit through and scans up to 12,000
  chars (a whole JD fits), so `interviewer_terms(jd, 16)` genuinely
  returns up to 16.

### Stage 2 — "Research findings" document

- Query building becomes pure core, **seeded by Stage 1's vocabulary**
  (owner choice: smarter queries + synthesis):
  `research_queries(session, vocabulary: &[String]) -> Vec<String>` —
  keeps today's title/category/purpose/JD seeds, adds up to 2
  vocabulary-driven queries (e.g. `"{title} {top-terms} interview
  questions"`), cap raised 4 → **6** (`RESEARCH_MAX_QUERIES`), sources
  8 → **12** (`RESEARCH_MAX_SOURCES`), snippet capture 500 → **1,200**
  chars (Tavily's `content` excerpt; `search_depth` stays `basic` — no
  per-search cost increase).
- New core `research_findings_prompt(session, sources) -> LlmRequest`:
  synthesizes the sources into a human-readable findings document —
  themed `##` sections, every finding bullet citing `[title](url)`,
  closing `## Sources` list. `max_tokens` 2,000.
- Shell stage 2 (inside the same generate command, after Stage 1): when
  research is enabled and sources come back, stream the synthesis,
  replace any previous findings doc (delete by the new field, re-ingest
  via `ingest_generated`, push into profile doc_ids), store the id in
  **new `research_doc_id: Option<String>`** on `SimConSession`
  (Rust + TS mirror, same commit). No Tavily key / research off / zero
  sources → Stage 2 skips cleanly (previous findings doc left as-is;
  detail page says research is off/unavailable).
- `prepare`'s existing research call reuses the core query builder with
  an empty vocabulary slice (base queries — behavior preserved).

### Pipeline & UI wiring

- `simcon_generate_dossier` (command name kept — no IPC churn) runs
  Stage 1 → glossary harvest (hygiene-gated, as today) → Stage 2;
  `resources_stale = false` on success covers both documents.
- `SimConDetail`'s card becomes **"Ally documents"**: two rows —
  Context knowledge (`dossier_doc_id`) and Research findings
  (`research_doc_id`) — each with its own View toggle showing the
  document inline; one Generate/Regenerate button runs the whole
  pipeline; the stale note stays; a muted line explains an absent
  findings doc ("Web research is off for this context" / "no search key").
- Terms flow unchanged: glossary (now from Core vocabulary, cap 32) +
  key terms + always-merged `interviewer_terms(jd, 16)` at activation.

## Out of scope (stated per owner)

- **Vector/graph-database-ready final form** — the documented target once
  the platform DB lands; the fixed-section Markdown is deliberately the
  RAG-optimizable intermediate (heading-aware chunks + citations).
- Full-page deep research (fetch/read whole pages) — later opt-in.
- A separate progress UI per stage (the existing busy state covers the
  pipeline; stages log to the console).

## Testing

- Core: `knowledge_prompt` — fixed interview sections present in order,
  Core vocabulary contract (20–30, JD-first, verbatim-names instruction)
  in the system prompt, JD included beyond 2,000 chars, reference
  material embedded; `research_queries` — vocabulary-seeded queries
  appear, cap 6 holds, no vocabulary → base queries only;
  `research_findings_prompt` — sources embedded with titles+urls,
  citation + `## Sources` instructions present; `extract_glossary` —
  `Core vocabulary` heading harvests, `Glossary` still harvests, cap 32;
  `salient_doc_terms`/`relevant_terms_capped` — limits above 12 honored,
  live-path `relevant_terms` still capped at 12; `interviewer_terms`
  returns >12 terms from a long, rich JD.
- Shell compiles on CI's Windows job; owner verifies by regenerating the
  Amazon Interview context: the Context knowledge doc shows a 20–30-term
  Core vocabulary including "API Gateway"; a Research findings doc
  appears (with a Tavily key) and reads as a cited, human-readable brief;
  the Terms list is materially richer.

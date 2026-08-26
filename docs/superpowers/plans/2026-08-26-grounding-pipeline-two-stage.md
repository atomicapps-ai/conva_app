# Two-Stage Grounding Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** "Generate resources" becomes a two-stage pipeline — Stage 1 writes a role/JD/context-aware **Context knowledge** document (fixed chunk-ready sections, 20–30-term Core vocabulary); Stage 2 runs vocabulary-seeded web research and synthesizes a cited, human-readable **Research findings** document. Both land in the Library and RAG.

**Architecture:** All prompts and query-building are pure conva-core functions with unit tests; the shell only re-plumbs the generate command and the Tavily call. A new `research_doc_id` (Rust + TS mirror, one commit) tracks the second document. Heuristic term-mining ceilings (`MAX_TERMS` hard cap, 4k scan slice) are fixed alongside.

**Tech Stack:** Rust (conva-core tested locally; conva-app shell NOT locally compilable — `cargo fmt --check` + CI Windows job is the gate), TypeScript/React/vitest.

Spec: `docs/superpowers/specs/2026-08-26-grounding-pipeline-two-stage-design.md`.

**Standard commit trailer for every commit in this plan:**

```
Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Kot4sMxdR3d2DEJ8Z84nu6
```

---

### Task 1: Heuristic ceiling fixes (`relevant_terms_capped`, 12k scan)

**Files:**
- Modify: `crates/conva-core/src/highlight.rs`

- [ ] **Step 1: Write the failing tests.** Append to the existing tests in `highlight.rs` (inside the same `mod` that holds `interviewer_terms_tests`, or a new sibling `mod ceiling_tests` beside it):

```rust
#[cfg(test)]
mod ceiling_tests {
    use super::*;

    /// A JD-like text with far more than 12 distinct entities, each
    /// repeated so every signal path can admit them.
    fn rich_jd() -> String {
        let names = [
            "Amazon EC2", "Amazon EKS", "AWS Lambda", "Amazon VPC",
            "AWS CloudFormation", "Amazon CloudWatch", "AWS CDK",
            "Terraform Cloud", "GitLab CI", "GitHub Actions", "Datadog APM",
            "Prometheus Grafana", "API Gateway", "Control Tower",
            "OpenTelemetry Collector", "AWS Organizations",
        ];
        let mut s = String::from("Senior DevOps Engineer role. ");
        for _ in 0..3 {
            for n in &names {
                s.push_str(&format!("Experience with {n} is required. "));
            }
        }
        s
    }

    #[test]
    fn salient_doc_terms_honors_limits_above_twelve() {
        let jd = rich_jd();
        let terms = salient_doc_terms(&jd, 16);
        assert!(
            terms.len() > 12,
            "limit above MAX_TERMS must be honored, got {} terms: {terms:?}",
            terms.len()
        );
        assert!(terms.len() <= 16, "{terms:?}");
    }

    #[test]
    fn interviewer_terms_reaches_sixteen_on_a_rich_jd() {
        let jd = rich_jd();
        let terms = interviewer_terms(&jd, 16);
        assert!(
            terms.len() > 12,
            "JD mining must not be silently capped at 12, got {}: {terms:?}",
            terms.len()
        );
    }

    #[test]
    fn live_relevant_terms_still_caps_at_twelve() {
        let jd = rich_jd();
        let ctx = HighlightContext::from_doc_text(&jd);
        let terms = relevant_terms(&jd, &ctx);
        assert!(terms.len() <= 12, "live path cap regressed: {terms:?}");
    }
}
```

- [ ] **Step 2: Run to verify failure.** Run: `cargo test -p conva-core ceiling` — expect the first two tests to FAIL (result length ≤ 12).

- [ ] **Step 3: Implement.** In `highlight.rs`:
  - Rename the body of `pub fn relevant_terms(message, ctx)` to a new public fn with a cap parameter, and make `relevant_terms` a thin wrapper:

```rust
/// [`relevant_terms`] with an explicit result cap — the live-message path
/// keeps [`MAX_TERMS`] via the wrapper; document/JD mining passes larger
/// caps (spec 2026-08-26: the silent 12-term ceiling starved JD mining).
pub fn relevant_terms_capped(
    message: &str,
    ctx: &HighlightContext,
    cap: usize,
) -> Vec<String> {
    // ...existing relevant_terms body, with the final admission loop's
    // `if out.len() >= MAX_TERMS` changed to `if out.len() >= cap`...
}

pub fn relevant_terms(message: &str, ctx: &HighlightContext) -> Vec<String> {
    relevant_terms_capped(message, ctx, MAX_TERMS)
}
```

  (Keep the original doc comment on `relevant_terms`; move nothing else.)
  - In `salient_doc_terms`: change the scan slice `4_000` → `12_000` (update its comment: "~12k chars — a whole job description fits; still not a whole book") and the call to `let mut terms = relevant_terms_capped(&doc_text[..end], &ctx, limit);` (the `terms.truncate(limit)` line then becomes redundant — remove it).

- [ ] **Step 4: Run to verify pass.** `cargo test -p conva-core` — ALL green (the 3 new included; the existing `interviewer_terms`/`sanitize` tests must still pass). `cargo fmt --check` clean (run `cargo fmt` if needed).

- [ ] **Step 5: Commit.**

```bash
git add crates/conva-core/src/highlight.rs
git commit -m "fix(highlight): honor mining limits above 12 + scan whole JDs"
```

(standard trailer; stage only that file.)

---

### Task 2: `extract_glossary` — Core vocabulary heading + cap 32

**Files:**
- Modify: `crates/conva-core/src/simcon.rs`

- [ ] **Step 1: Write the failing tests.** Append to `mod tests`:

```rust
    #[test]
    fn extract_glossary_reads_core_vocabulary_heading() {
        let digest = "## Overview\nIntro.\n\n## Core vocabulary\n\
- **API Gateway** — managed API front door.\n\
- **Terraform** — IaC tool.\n\n## Watch-outs\n- none";
        let g = extract_glossary(digest);
        assert!(g.iter().any(|t| t == "API Gateway"), "{g:?}");
        assert!(g.iter().any(|t| t == "Terraform"), "{g:?}");
    }

    #[test]
    fn extract_glossary_caps_at_thirty_two() {
        let mut digest = String::from("## Core vocabulary\n");
        for i in 0..40 {
            digest.push_str(&format!("- **Term number {i}** — meaning.\n"));
        }
        assert_eq!(extract_glossary(&digest).len(), 32);
    }
```

- [ ] **Step 2: Run to verify failure.** `cargo test -p conva-core extract_glossary` — the two new tests FAIL (heading not matched; cap is 24).

- [ ] **Step 3: Implement.** In `simcon.rs`:
  - `const MAX_GLOSSARY_TERMS: usize = 24;` → `32`.
  - In `extract_glossary`, the heading match becomes an alias check:

```rust
        if let Some(title) = line.strip_prefix("## ") {
            let t = title.trim();
            in_section = t.eq_ignore_ascii_case("glossary")
                || t.eq_ignore_ascii_case("core vocabulary");
            continue;
        }
```

  - Update the fn doc comment: "…the entries under its `## Glossary` or `## Core vocabulary` section…".

- [ ] **Step 4: Run to verify pass.** `cargo test -p conva-core` — ALL green (the old `## Glossary` tests and the bold-fallback tests must still pass). `cargo fmt --check` clean.

- [ ] **Step 5: Commit.**

```bash
git add crates/conva-core/src/simcon.rs
git commit -m "feat(simcon): extract_glossary reads Core vocabulary heading, cap 32"
```

---

### Task 3: `knowledge_prompt` — the Stage-1 logic layer

**Files:**
- Modify: `crates/conva-core/src/simcon.rs` (rename + rework `dossier_prompt`, template sections)

NOTE: this task renames `dossier_prompt` → `knowledge_prompt`; the shell call site (`src-tauri/src/lib.rs`) is updated in Task 5 — the shell not compiling in between is expected (the sandbox can't compile it anyway).

- [ ] **Step 1: Write the failing tests.** Append to `mod tests`:

```rust
    #[test]
    fn knowledge_prompt_has_fixed_interview_sections_and_vocab_contract() {
        let mut s = sample_session();
        // A JD longer than the old 2,000-char slice, with the key service
        // name appearing only past that point.
        let mut jd = "Senior DevOps Engineer. ".repeat(100); // ~2,400 chars
        jd.push_str("Experience with API Gateway and Lambda required.");
        s.job_description = Some(jd);
        let req = knowledge_prompt(&s, &[], &[], 3000);
        for section in [
            "Role profile",
            "Core vocabulary",
            "Likely questions & strong answers",
            "Facts & figures",
            "Watch-outs",
        ] {
            assert!(req.system.contains(section), "missing section {section}");
        }
        assert!(req.system.contains("20"), "vocab floor missing");
        assert!(req.system.contains("30"), "vocab ceiling missing");
        assert!(
            req.system.to_lowercase().contains("verbatim"),
            "verbatim-names instruction missing"
        );
        // The full JD reaches the prompt — past the old 2,000-char cut.
        assert!(req.user.contains("API Gateway"), "JD truncated too early");
        assert_eq!(req.max_tokens, 3000);
    }
```

  Also update the existing `dossier_prompt_has_sections_and_synthesizes_material` test: rename its call to `knowledge_prompt(&sample_session(), &[], &chunks, 1200)` (note the extra `&[]` research arg stays in the same position as before — see Step 3 signature) and keep its assertions; `"Likely questions"` remains satisfied by "Likely questions & strong answers".

- [ ] **Step 2: Run to verify failure.** `cargo test -p conva-core knowledge_prompt` — COMPILE FAIL (fn not defined).

- [ ] **Step 3: Implement.** In `simcon.rs`:
  - **Template sections.** In `SimConCategory::template()`, replace every `"Glossary"` entry in `digest_sections` with `"Core vocabulary"`, and change the Interview template's list to exactly:

```rust
                digest_sections: &[
                    "Role profile",
                    "Core vocabulary",
                    "Likely questions & strong answers",
                    "Facts & figures",
                ],
```

  (Overview and Watch-outs are added around the template list by the prompt builder, as today. Other categories keep their existing lists with only the Glossary→Core vocabulary rename.)
  - **Rename** `pub fn dossier_prompt(...)` → `pub fn knowledge_prompt(...)` — same signature `(session, research, chunks, max_tokens)`. Rework its `system` string to:

```rust
    let system = format!(
        "You are Ally, writing a Context Knowledge document — one dense, \
high-signal briefing the user (and later the AI) will rely on before a \
{label}. Write it in Markdown with exactly these `##` sections, in this \
order: {sections}. Give `## Overview` 2–3 sentences; keep the other \
sections tight and scannable — short bullets, **bold** the key term, name, \
or figure in each. EXCEPTION — `## Core vocabulary` must be thorough, not \
tight: list 20–30 terms the other party is likely to actually say — \
services, tools, acronyms, methodologies, named practices — as bullets of \
the form `**Term** — one-line why it matters here`, drawn from the job \
description FIRST, then the documents; use exact product and service names \
verbatim (e.g. \"API Gateway\", never just \"Gateway\"). Ground everything \
strictly in the provided material: be specific, never generic, and never \
invent facts or figures. Output only the Markdown document — no preamble.",
        label = template.label,
        sections = section_list,
    );
```

  - **JD slice:** in the user-prompt construction, `jd.chars().take(2_000)` → `jd.chars().take(8_000)`.
  - Everything else in the fn body (reference budget, research/chunk embedding, LlmRequest) stays as-is.

- [ ] **Step 4: Run to verify pass.** `cargo test -p conva-core` — ALL green, including the renamed legacy test and the `default_digest`/glossary tests. `cargo fmt --check` clean.

- [ ] **Step 5: Commit.**

```bash
git add crates/conva-core/src/simcon.rs
git commit -m "feat(simcon): knowledge_prompt — Stage-1 logic layer with Core vocabulary contract"
```

---

### Task 4: `research_queries` + `research_findings_prompt` + `research_doc_id` (core + TS mirror)

**Files:**
- Modify: `crates/conva-core/src/simcon.rs`
- Modify: `src/lib/ipc.ts`

- [ ] **Step 1: Write the failing tests.** Append to `mod tests`:

```rust
    #[test]
    fn research_queries_seed_from_vocabulary_and_cap() {
        let s = sample_session();
        let vocab: Vec<String> = vec![
            "API Gateway".into(),
            "Terraform".into(),
            "EKS".into(),
        ];
        let q = research_queries(&s, &vocab, 6);
        assert!(q.len() <= 6, "{q:?}");
        assert!(
            q.iter().any(|x| x.contains("API Gateway")),
            "vocabulary must seed a query: {q:?}"
        );
        // Base queries survive alongside.
        assert!(q.iter().any(|x| x.contains("common questions")), "{q:?}");
    }

    #[test]
    fn research_queries_without_vocabulary_are_base_only() {
        let s = sample_session();
        let q = research_queries(&s, &[], 6);
        assert!(!q.is_empty());
        assert!(q.iter().all(|x| !x.is_empty()));
    }

    #[test]
    fn research_findings_prompt_embeds_sources_and_demands_citations() {
        let s = sample_session();
        let sources = vec![ResearchSource {
            title: "Top SRE interview questions".into(),
            url: "https://example.com/sre".into(),
            snippet: "Expect SLO and error-budget questions.".into(),
            fetched_at_unix_ms: 0,
        }];
        let req = research_findings_prompt(&s, &sources);
        assert!(req.user.contains("Top SRE interview questions"));
        assert!(req.user.contains("https://example.com/sre"));
        assert!(req.user.contains("error-budget"));
        assert!(req.system.contains("## Sources"));
        let sys = req.system.to_lowercase();
        assert!(sys.contains("cite"), "citation instruction missing");
        assert!(req.max_tokens == 2000);
    }
```

- [ ] **Step 2: Run to verify failure.** `cargo test -p conva-core research_` — COMPILE FAIL (fns not defined).

- [ ] **Step 3: Implement.** In `simcon.rs`, below `knowledge_prompt`:

```rust
/// The bounded research query set for a context — base queries from its
/// topic/type/goal/JD, plus up to 2 queries seeded from Stage 1's mined
/// vocabulary (spec 2026-08-26 stage 2: "smarter queries"). Pure; the
/// shell passes its budget as `cap` and issues the searches.
pub fn research_queries(
    session: &SimConSession,
    vocabulary: &[String],
    cap: usize,
) -> Vec<String> {
    let topic = if session.title.trim().is_empty() {
        session.category.label().to_string()
    } else {
        session.title.trim().to_string()
    };
    let mut q = vec![
        format!("{topic} common questions"),
        format!("how to prepare for a {}", session.category.label()),
    ];
    if !session.purpose.trim().is_empty() {
        q.push(session.purpose.trim().chars().take(120).collect());
    }
    if let Some(jd) = &session.job_description {
        let jd = jd.trim();
        if !jd.is_empty() {
            q.push(format!(
                "interview questions for role: {}",
                jd.chars().take(120).collect::<String>()
            ));
        }
    }
    // Vocabulary-seeded queries: the terms the other party will actually
    // say make the sharpest search keys (e.g. "Amazon Interview API
    // Gateway Terraform interview questions").
    for chunk in vocabulary.chunks(3).take(2) {
        q.push(format!(
            "{topic} {} {}",
            chunk.join(" "),
            session.category.label()
        ));
    }
    q.truncate(cap);
    q
}

/// Prompt for the Stage-2 **Research findings** document: synthesize the
/// collected web sources into a human-readable, cited brief the user can
/// inspect (and RAG can chunk by its `##` sections).
pub fn research_findings_prompt(
    session: &SimConSession,
    sources: &[ResearchSource],
) -> LlmRequest {
    let template = session.category.template();
    let system = format!(
        "You are Ally, writing a Research Findings document from web \
sources gathered for a {label}. Organize the findings into themed `##` \
sections (you choose the themes — e.g. likely question areas, company \
signals, process/format intel). Every finding bullet MUST cite its source \
inline as a Markdown link: [source title](url). Only state what the \
sources support — never invent. End with a `## Sources` section listing \
every source as `- [title](url)`. Output only the Markdown document — no \
preamble.",
        label = template.label,
    );

    let mut user = format!(
        "Context: {}\nGoal: {}\n\nSources:\n\n",
        session.title, session.purpose
    );
    for src in sources {
        user.push_str(&format!(
            "[{}]({})\n{}\n\n",
            src.title, src.url, src.snippet
        ));
    }

    LlmRequest {
        system,
        user,
        max_tokens: 2000,
    }
}
```

  - **Field:** add to `SimConSession` (after `dossier_doc_id`, before `resources_stale`):

```rust
    /// The `RagDocument` id of the Stage-2 **Research findings** document,
    /// if one has been generated (also in the profile's `doc_ids`).
    /// Replaced on regeneration, like the knowledge document.
    #[serde(default)]
    pub research_doc_id: Option<String>,
```

  - Update every full `SimConSession { ... }` literal in **core** (the tests' `sample_session`/`grounding_base` fixtures) with `research_doc_id: None,`. (The two shell literals are Task 5's.)
  - **TS mirror** — `src/lib/ipc.ts`, `SimConSession` (after `dossier_doc_id`):

```ts
  /** RagDocument id of the Stage-2 Research findings document, once
   * generated (replaced on regeneration, like the knowledge doc). */
  research_doc_id?: string | null;
```

  (Optional, matching the serde-defaulted pattern — no fixture churn.)

- [ ] **Step 4: Run to verify pass.** `cargo test -p conva-core` ALL green; `cargo fmt --check` clean; `npm run build` clean.

- [ ] **Step 5: Commit.**

```bash
git add crates/conva-core/src/simcon.rs src/lib/ipc.ts
git commit -m "feat(simcon): research query seeding + findings prompt + research_doc_id"
```

---

### Task 5: Shell — the two-stage pipeline

**Files:**
- Modify: `src-tauri/src/simcon.rs` (constants, `research` signature, delete local `research_queries`, struct literals)
- Modify: `src-tauri/src/lib.rs` (`simcon_generate_dossier` pipeline)

⚠️ No shell compile locally — gates are `cargo fmt --check`, a full `git diff` re-read, and CI's Windows job.

- [ ] **Step 1: `src-tauri/src/simcon.rs`.**
  - Constants: `RESEARCH_MAX_QUERIES` 4 → `6`; `RESEARCH_MAX_SOURCES` 8 → `12`.
  - Snippet capture in `research()`: `.take(500)` → `.take(1_200)` (comment: Tavily's content excerpt — the findings synthesis needs more than a headline).
  - Delete the local `fn research_queries(...)` entirely; change `research`'s signature to `pub(crate) fn research(session: &SimConSession, vocabulary: &[String]) -> Result<(Vec<ResearchSource>, u64), CoreError>` and its loop to `for query in conva_core::simcon::research_queries(session, vocabulary, RESEARCH_MAX_QUERIES)`.
  - `prepare`'s call becomes `research(&session, &[])` (base queries — behavior preserved).
  - Both full struct literals gain `research_doc_id: None,` (the default-context constructor ~line 84) — `list`'s summary literal needs nothing (no summary field).
- [ ] **Step 2: `src-tauri/src/lib.rs` — `simcon_generate_dossier` becomes the pipeline.** Keep the command name. After the existing Stage-1 flow, with these changes:
  - `conva_core::simcon::dossier_prompt(...)` → `conva_core::simcon::knowledge_prompt(&session, &profile.research, &chunks, 3000)` (was 2500).
  - Document name: `format!("{} — Ally prep", ...)` → `format!("{} — Context knowledge", session.title.trim())`.
  - After the glossary assignment and `session.resources_stale = false;`, INSERT Stage 2 (before the final save):

```rust
    // ── Stage 2: web research → Research findings document (spec
    // 2026-08-26). Queries are seeded by Stage 1's vocabulary; failures or
    // missing key skip the stage cleanly (Stage 1's document stands).
    if session.research_enabled {
        let vocab: Vec<String> = session.glossary.iter().take(6).cloned().collect();
        if let Ok((sources, searches)) = simcon::research(&session, &vocab) {
            metering::record_tavily_search(&app, searches);
            if !sources.is_empty() {
                profile.research = sources.clone();
                let request =
                    conva_core::simcon::research_findings_prompt(&session, &sources);
                let mut fbuf = String::new();
                let fusage = llm::stream_completion(
                    selection.provider,
                    &key,
                    &selection.model,
                    &request,
                    &mut |t| fbuf.push_str(t),
                );
                if let Ok(fusage) = fusage {
                    metering::record_llm(&app, selection.provider, fusage);
                    let ftext = fbuf.trim().to_string();
                    if !ftext.is_empty() {
                        // Replace any previous findings doc — no pile-up.
                        if let Some(old) = session.research_doc_id.take() {
                            let _ = state.rag.delete(&old);
                            profile.doc_ids.retain(|d| d != &old);
                        }
                        let fname =
                            format!("{} — Research findings", session.title.trim());
                        if let Ok(freport) =
                            state.rag.ingest_generated(&fname, &ftext, &session.id)
                        {
                            let fdoc_id = freport.document.id.clone();
                            if !profile.doc_ids.contains(&fdoc_id) {
                                profile.doc_ids.push(fdoc_id.clone());
                            }
                            session.research_doc_id = Some(fdoc_id);
                        }
                    }
                }
                profile.updated_at_unix_ms = session::now_unix_ms();
                simcon::save_profile(&app, &profile).map_err(|e| e.to_string())?;
            }
        }
    }
```

  Adapt to the fn's real body: `profile` must still be mutable and in scope at this point (Stage 1 already saves it once — either move that save after Stage 2 or save again here as shown; prefer the single-save-after-both if the flow allows, and report which you did). `selection`/`key` are already in scope from Stage 1. `simcon::research` is the shell module fn (now `pub(crate)`).
- [ ] **Step 3: Verify.** `cargo fmt --check` clean; re-read the full `git diff` (braces, scope of `profile`/`selection`/`key`, both literals updated, no unrelated code moved). Cross-check the core fns exist: `knowledge_prompt`, `research_queries`, `research_findings_prompt` (grep crates/conva-core/src/simcon.rs).
- [ ] **Step 4: Commit.**

```bash
git add src-tauri/src/simcon.rs src-tauri/src/lib.rs
git commit -m "feat(grounding): two-stage generate — context knowledge + research findings"
```

---

### Task 6: UI — "Ally documents" card with both documents

**Files:**
- Modify: `src/components/simcon/SimConDetail.tsx`

- [ ] **Step 1: Rework the dossier card into a two-document card.** In `SimConDetail.tsx`:
  - Rename the section comment/label "Ally prep document" → "Ally documents".
  - Alongside the existing `dossierId`/`dossierText`/`showDossier` state, add the same trio for the findings doc:

```tsx
  const researchDocId = session?.research_doc_id ?? null;
  const [researchText, setResearchText] = useState<string | null>(null);
  const [showResearch, setShowResearch] = useState(false);

  const toggleResearch = async () => {
    const next = !showResearch;
    setShowResearch(next);
    if (next && researchText === null && researchDocId) {
      setResearchText((await backend.rag.documentText(researchDocId)) ?? "");
    }
  };
```

  - In `generateDossier`'s success path, also refresh the findings text so a regenerate shows the new doc immediately:

```tsx
      if (updated.research_doc_id) {
        setResearchText(
          (await backend.rag.documentText(updated.research_doc_id)) ?? "",
        );
      } else {
        setResearchText(null);
      }
```

  - Replace the card's single title row + `<pre>` with two document rows inside the same card, each row mirroring the existing pattern (icon + label + flex-1 + View/Hide toggle), with the Generate/Regenerate button staying in the FIRST row (it runs the whole pipeline):

```tsx
              {/* Row 1 — Context knowledge (Stage 1) */}
              <div className="flex items-center gap-2">
                <Icon name="simicon" size={15} className="shrink-0 text-ai" />
                <span className="text-[12px] font-semibold text-fg">
                  Context knowledge
                </span>
                <div className="flex-1" />
                {dossierId && (
                  <button
                    type="button"
                    onClick={() => void toggleDossier()}
                    className="rounded-sm px-2 py-0.5 text-[11px] font-semibold text-ai hover:bg-ai/10"
                  >
                    {showDossier ? "Hide" : "View"}
                  </button>
                )}
                <button
                  type="button"
                  disabled={dossierBusy}
                  onClick={() => void generateDossier()}
                  className="rounded-sm border border-ai/40 px-2 py-0.5 text-[11px] font-semibold text-ai hover:bg-ai/10 disabled:opacity-40"
                >
                  {dossierBusy ? "Writing…" : dossierId ? "Regenerate" : "Generate"}
                </button>
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-fg-faint">
                Stage 1 — Ally reads the role, job description, and your
                documents together and writes a structured knowledge document
                (role profile, core vocabulary, likely Q&A). Saved to your
                Library and indexed for grounding.
              </p>
              {/* stale note stays here, unchanged */}
              {dossierId && showDossier && (
                <pre className="mt-2 max-h-[40vh] overflow-y-auto whitespace-pre-wrap rounded border border-border bg-bg/50 p-2.5 text-[12px] leading-relaxed text-fg-muted">
                  {dossierText === null
                    ? "Loading…"
                    : dossierText.trim() === ""
                      ? "(No content returned — try Regenerate.)"
                      : dossierText}
                </pre>
              )}

              {/* Row 2 — Research findings (Stage 2) */}
              <div className="mt-3 flex items-center gap-2 border-t border-border/60 pt-3">
                <Icon name="search" size={15} className="shrink-0 text-ai" />
                <span className="text-[12px] font-semibold text-fg">
                  Research findings
                </span>
                <div className="flex-1" />
                {researchDocId && (
                  <button
                    type="button"
                    onClick={() => void toggleResearch()}
                    className="rounded-sm px-2 py-0.5 text-[11px] font-semibold text-ai hover:bg-ai/10"
                  >
                    {showResearch ? "Hide" : "View"}
                  </button>
                )}
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-fg-faint">
                {session?.research_enabled
                  ? researchDocId
                    ? "Stage 2 — what Ally found on the web for this context, with sources cited. Regenerating resources refreshes it."
                    : "Stage 2 — runs with Generate when web research is enabled (needs a search key in Settings)."
                  : "Web research is off for this context — enable it in Edit setup to generate findings."}
              </p>
              {researchDocId && showResearch && (
                <pre className="mt-2 max-h-[40vh] overflow-y-auto whitespace-pre-wrap rounded border border-border bg-bg/50 p-2.5 text-[12px] leading-relaxed text-fg-muted">
                  {researchText === null
                    ? "Loading…"
                    : researchText.trim() === ""
                      ? "(No content returned — try Regenerate.)"
                      : researchText}
                </pre>
              )}
```

  - Check the `Icon` name `"search"` exists in `Icon.tsx` (grep); if not, use `"book"`.
  - The attached-documents list already excludes `dossierId`; extend the filter to also exclude the findings doc: `profile.doc_ids.filter((d) => d !== dossierId && d !== researchDocId)`.

- [ ] **Step 2: Verify.** `npm test` full suite green (146 — no new tests; this is presentational wiring of tested backend state) and `npm run build` clean.

- [ ] **Step 3: Commit.**

```bash
git add src/components/simcon/SimConDetail.tsx
git commit -m "feat(contexts): Ally documents card — knowledge + research findings"
```

---

### Task 7: Full verification + push + PR #85 update

- [ ] **Step 1: Full gate.** `npm run build`, `npm test`, `cargo test -p conva-core`, `cargo fmt --check`, `cargo clippy -p conva-core --all-targets -- -D warnings` — ALL green.
- [ ] **Step 2: Push** `claude/conva-app-ui-modernization-igllsd` (retries ×4 with 2/4/8/16s backoff on network errors only).
- [ ] **Step 3: PR #85 body** gains "## 5. Two-stage grounding pipeline" (spec link; Stage 1 logic layer + Core vocabulary contract + JD un-truncation; Stage 2 vocabulary-seeded research + cited findings document; ceiling fixes) and manual-QA items:
  - Regenerate the Amazon Interview context → the Library gains "… — Context knowledge" (open it: Core vocabulary lists 20–30 terms including "API Gateway" verbatim) and, with a Tavily key + research on, "… — Research findings" (themed, every bullet cited, `## Sources` at the end).
  - The context detail page shows both documents with View toggles; the Terms list is materially richer and leads with JD vocabulary.
- [ ] **Step 4: Watch CI** (Windows shell job gates Task 5).

---

## Self-review notes

- Spec coverage: Stage 1 → Tasks 2–3 (+1 for ceilings); Stage 2 → Tasks 4–5; pipeline/UI → Tasks 5–6; testing section → Tasks 1–4, 7. Out-of-scope items have no tasks (intended).
- Type consistency: `research_queries(session, vocabulary, cap)` order matches every call site shown; `research_doc_id` optional in TS / serde-defaulted in Rust, same pattern as `resources_stale`; `knowledge_prompt` keeps `dossier_prompt`'s exact signature so Task 5's call is a rename + arg-value change only.
- Task 3 leaves the shell uncompilable until Task 5 — expected and safe (no push happens before Task 7; sandbox never compiles the shell).

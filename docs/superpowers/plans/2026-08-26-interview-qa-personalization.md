# Interview Q&A Personalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The deep interview Q&A bank (`interview_qa_prompt`) draws on the candidate's own uploaded documents (résumé, etc.) when writing an answer, not web sources alone — closing the "user's history" half of F10's "playbook × history × role" spec.

**Architecture:** `interview_qa_prompt` gains a `chunks: &[ScoredChunk]` parameter — the same RAG chunks `knowledge_prompt` already receives — and embeds a small, budgeted "Candidate's own background" block ahead of the existing (unbudgeted) Sources block, with one added system-prompt instruction telling the model to prefer the candidate's own experience when it supports an answer, falling back to a generic role-appropriate answer otherwise. The shell threads its already-retrieved `chunks` variable into the one call site. No new retrieval, no new stage, no UI change.

**Tech Stack:** Rust (conva-core tested locally; conva-app shell NOT locally compilable — `cargo fmt --check` + CI Windows job is the gate).

Spec: `docs/superpowers/specs/2026-08-26-interview-qa-personalization-design.md`.

**Standard commit trailer for every commit in this plan:**

```
Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GiKzMingp6q12HJcuxRSZp
```

---

### Task 1: `interview_qa_prompt` — personalize from the candidate's own documents

**Files:**
- Modify: `crates/conva-core/src/simcon.rs`

- [ ] **Step 1: Write the failing tests.** Append to the existing `mod tests` (near the other `interview_qa_prompt` tests, e.g. right after `interview_qa_prompt_demands_themed_broad_coverage`):

```rust
    #[test]
    fn interview_qa_prompt_grounds_personal_material_when_provided() {
        let s = sample_session();
        let sources = vec![ResearchSource {
            title: "Top 50 accounting interview questions".into(),
            url: "https://example.com/q".into(),
            snippet: "Tell me about a time you found an error in a close.".into(),
            fetched_at_unix_ms: 0,
        }];
        let chunks = vec![ScoredChunk {
            document_id: "d1".into(),
            file_name: "resume.pdf".into(),
            location: "p1".into(),
            text: "Led the monthly close for 3 years at Acme Corp.".into(),
            score: 0.9,
        }];
        let req = interview_qa_prompt(&s, &sources, &chunks);
        assert!(req.user.contains("Led the monthly close for 3 years at Acme Corp."));
        assert!(req.user.contains("Candidate's own background"));
        // Sources still present alongside the new background block.
        assert!(req.user.contains("Top 50 accounting interview questions"));
        let sys = req.system.to_lowercase();
        assert!(
            sys.contains("own experience") || sys.contains("own background"),
            "{}",
            req.system
        );
    }

    #[test]
    fn interview_qa_prompt_omits_background_section_when_no_chunks() {
        let s = sample_session();
        let sources = vec![ResearchSource {
            title: "Top 50 accounting interview questions".into(),
            url: "https://example.com/q".into(),
            snippet: "Tell me about a time you found an error in a close.".into(),
            fetched_at_unix_ms: 0,
        }];
        let req = interview_qa_prompt(&s, &sources, &[]);
        assert!(!req.user.contains("Candidate's own background"));
        assert!(req.user.contains("Top 50 accounting interview questions"));
    }

    #[test]
    fn interview_qa_prompt_caps_personal_background_at_budget() {
        let s = sample_session();
        let chunks = vec![ScoredChunk {
            document_id: "d1".into(),
            file_name: "resume.pdf".into(),
            location: "p1".into(),
            text: "x".repeat(20_000),
            score: 0.9,
        }];
        let req = interview_qa_prompt(&s, &[], &chunks);
        let background_start = req
            .user
            .find("Candidate's own background")
            .expect("background section missing");
        let sources_start = req.user.find("Sources:\n\n").expect("sources section missing");
        let background_len = sources_start - background_start;
        assert!(
            background_len <= QA_PERSONAL_CHAR_BUDGET + 200,
            "background section grew unbounded: {background_len} chars"
        );
    }
```

  Also update the existing `interview_qa_prompt_demands_themed_broad_coverage` test's call: `interview_qa_prompt(&s, &sources, &[])` (adds the new third argument; behavior for all its existing assertions is unchanged since `chunks` is empty there).

- [ ] **Step 2: Run to verify failure.** Run: `cargo test -p conva-core interview_qa_prompt` — expect COMPILE FAIL (`interview_qa_prompt` takes 2 arguments, 3 supplied / `QA_PERSONAL_CHAR_BUDGET` not defined).

- [ ] **Step 3: Implement.** In `crates/conva-core/src/simcon.rs`, immediately above `pub fn interview_qa_prompt`, add the budget constant:

```rust
/// Budget (chars) for the candidate's own material embedded in
/// [`interview_qa_prompt`] — kept modest since the prompt's (unbudgeted)
/// web-sources block already carries the bulk of the reference material.
const QA_PERSONAL_CHAR_BUDGET: usize = 6_000;
```

  Then replace the entire current `pub fn interview_qa_prompt` (doc comment + body) with:

```rust
/// Prompt for the deep interview Q&A pass's document: synthesize the
/// gathered sources into a standalone bank of real, distinct question +
/// strong-answer pairs — spec 2026-08-26 part A. Themed `##` sections
/// (the model chooses themes that fit what the sources support); each
/// entry `**Q: ...** A: ...` so it reads well AND is harvestable by
/// `extract_glossary_entries` incidentally. At least 20 pairs, up to 100
/// — driven by how much the material supports, not a fixed target.
/// `chunks` — the candidate's own document material (résumé, etc.), the
/// same retrieval [`knowledge_prompt`] already receives — lets each
/// answer draw on the candidate's real experience where it applies
/// (spec 2026-08-26, interview Q&A personalization); the background
/// block is omitted entirely when `chunks` is empty.
pub fn interview_qa_prompt(
    session: &SimConSession,
    sources: &[ResearchSource],
    chunks: &[ScoredChunk],
) -> LlmRequest {
    let template = session.category.template();
    let system = format!(
        "You are Ally, building an Interview Q&A bank from web sources \
gathered for a {label}. Organize into themed `##` sections (e.g. \
Behavioral, Technical, Company & role-specific — choose themes that fit \
what the sources actually support). Each entry: a bullet in the form \
`**Q: <question>** A: <strong, specific answer>`, grounded strictly in \
the sources — never invent a question or fact the sources don't support. \
Produce as many DISTINCT, well-supported pairs as the material justifies \
— at least 20, up to 100; do not pad with near-duplicates to hit a \
number, and do not stop early if the sources clearly support more. When \
the candidate's own background below supports a strong, specific answer \
to a question — their real projects, technologies, outcomes — write that \
answer from their own experience, concretely; when their background \
doesn't cover a question, give a strong, correct, role-appropriate \
answer instead. Never claim something the candidate's background doesn't \
support as their own. Output only the Markdown document — no preamble.",
        label = template.label,
    );

    let mut user = format!("Context: {}\nGoal: {}\n\n", session.title, session.purpose);
    if !chunks.is_empty() {
        let mut background = String::new();
        for chunk in chunks {
            let block = format!("[{}]\n{}\n\n", chunk.file_name, chunk.text);
            if background.len() + block.len() > QA_PERSONAL_CHAR_BUDGET {
                break;
            }
            background.push_str(&block);
        }
        if !background.is_empty() {
            user.push_str("Candidate's own background:\n\n");
            user.push_str(&background);
        }
    }
    user.push_str("Sources:\n\n");
    for src in sources {
        user.push_str(&format!(
            "[{}]({})\n{}\n\n",
            src.title, src.url, src.snippet
        ));
    }

    LlmRequest {
        system,
        user,
        max_tokens: 6000,
    }
}
```

  This REPLACES the entire current body — delete the old two-line `user` construction (`format!("Context: {}\nGoal: {}\n\nSources:\n\n", ...)` followed by the sources loop) entirely; it's now the incremental `user` build above, with the sources loop unchanged in content, just appended after the new background block instead of inline in the initial `format!`.

- [ ] **Step 4: Run to verify pass.** `cargo test -p conva-core` — ALL green (the three new tests, the updated existing test, and every other pre-existing test unaffected). `cargo fmt --check` (run `cargo fmt` if needed).

- [ ] **Step 5: Commit.**

```bash
git add crates/conva-core/src/simcon.rs
git commit -m "feat(simcon): interview_qa_prompt grounds answers in the candidate's own background"
```

(standard trailer; stage only that file.)

---

### Task 2: Shell — thread the existing chunks into Stage 3

**Files:**
- Modify: `src-tauri/src/lib.rs`

⚠️ No shell compile locally — gates are `cargo fmt --check`, a full `git diff` re-read, and CI's Windows job.

- [ ] **Step 1: Edit.** In `simcon_generate_dossier`'s Stage 3 block, find:

```rust
                let qa_request = conva_core::simcon::interview_qa_prompt(&session, &qa_sources);
```

  Replace with:

```rust
                let qa_request =
                    conva_core::simcon::interview_qa_prompt(&session, &qa_sources, &chunks);
```

  `chunks` is already in scope — it's the `Vec<ScoredChunk>` retrieved near the top of this function (the same broad RAG pull over `profile.doc_ids` that Stage 1's `knowledge_prompt` call already uses). No new retrieval, no other lines change.

- [ ] **Step 2: Verify.** `cargo fmt --check` clean; re-read the full `git diff` (confirm this is the only line changed, `chunks` still borrowed correctly — it's used by value-by-reference elsewhere in the same function already, so a second `&chunks` borrow here is fine since none of those uses are mutable or move the value).

- [ ] **Step 3: Commit.**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat(simcon): pass the candidate's document chunks into Stage 3's Q&A prompt"
```

(standard trailer.)

---

### Task 3: Full verification + push + new issue + draft PR

- [ ] **Step 1: Full gate.** Run: `npm run build`, `npm test`, `cargo test -p conva-core`, `cargo fmt --check`, `cargo clippy -p conva-core --all-targets -- -D warnings` — ALL green. (`npm run build`/`npm test` are expected to be unaffected — no frontend files touched by this plan — but run them anyway per the repo's standard pre-push gate.)
- [ ] **Step 2: Push** `claude/conva-app-ui-modernization-igllsd` (`git push -u origin ...` — the branch was freshly force-pushed clean from `main` earlier this session, so this is a plain fast-forward push, not force; retries ×4 with 2/4/8/16s backoff on network errors only).
- [ ] **Step 3: New issue** ("Personalize deep interview Q&A with the candidate's own background") **+ new draft PR** (`Closes #<issue>`, spec link, plan link, summary of the change, testing numbers from Step 1, and this manual-QA item: regenerate the Amazon Interview context — with a résumé attached and "Deep interview Q&A research" enabled — and spot-check that several of the ~20+ answers in the Interview Q&A document now cite the candidate's actual background where it plausibly applies, while others remain solid generic answers where it doesn't). Subscribe to PR activity.
- [ ] **Step 4: Watch CI.**

---

## Self-review notes

- Spec coverage: the spec's `crates/conva-core/src/simcon.rs` section → Task 1; the spec's `src-tauri/src/lib.rs` section → Task 2; the spec's Testing section → Task 1 (unit tests) + Task 3 (shell CI gate + manual QA). "Out of scope" items (Stage 1/2 untouched, no visible marker, Sources loop left unbudgeted, non-Interview categories) have no tasks — intended, matches the spec.
- Type consistency: `interview_qa_prompt`'s new signature `(session, sources, chunks)` matches `knowledge_prompt`'s existing `(session, research, chunks, max_tokens)` ordering convention (session first, research/sources second, chunks third); the one shell call site is updated in the same commit style as every prior stage in this file (Task 2 mirrors how Stage 1/2's call sites already pass `&chunks`/`&profile.research`).
- Task 2 leaves the shell uncompilable only in the trivial sense that CI (not this sandbox) verifies it — expected, matches every prior shell task on this branch.

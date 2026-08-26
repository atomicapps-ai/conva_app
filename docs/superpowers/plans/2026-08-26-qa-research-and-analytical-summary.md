# Deep Interview Q&A Research + Analytical Performance Download Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** (A) An opt-in "Deep interview Q&A research" pass writes a third generated document — 20-100 real, web-researched interview Q&A pairs. (B) A new "Analyze & download" action produces a category-aware, context-grounded analytical performance report for any saved conversation, downloadable free alongside the existing plain transcript export.

**Architecture:** Both parts extend `crates/conva-core/src/simcon.rs`'s existing prompt-builder pattern with pure, tested functions; the shell wires them into `simcon_generate_dossier` (Part A) and a new `analyze_conversation` command (Part B). `research()` is refactored to take its query list + source budget as parameters so both Stage 2 (existing) and the new Stage 3 (Q&A) share one fetch loop. `Conversation` gains a `linked_context_id` captured at save time from the already-tracked active grounding id — no new plumbing to reconstruct a link that doesn't exist today.

**Tech Stack:** Rust (conva-core tested locally; conva-app shell NOT locally compilable — `cargo fmt --check` + CI Windows job is the gate), TypeScript/React/vitest.

Spec: `docs/superpowers/specs/2026-08-26-qa-research-and-analytical-summary-design.md`.

**Standard commit trailer for every commit in this plan:**

```
Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Kot4sMxdR3d2DEJ8Z84nu6
```

---

### Task 1: `qa_research_queries` + `interview_qa_prompt` (core)

**Files:**
- Modify: `crates/conva-core/src/simcon.rs`

- [ ] **Step 1: Write the failing tests.** Append to `mod tests`:

```rust
    #[test]
    fn qa_research_queries_are_broader_than_general_research() {
        let s = sample_session();
        let vocab: Vec<String> = vec!["API Gateway".into(), "Terraform".into()];
        let q = qa_research_queries(&s, &vocab, 18);
        assert!(q.len() <= 18);
        assert!(
            q.iter().any(|x| x.to_lowercase().contains("most common interview questions")),
            "{q:?}"
        );
        assert!(
            q.iter().any(|x| x.to_lowercase().contains("technical interview questions")),
            "{q:?}"
        );
        assert!(
            q.iter().any(|x| x.to_lowercase().contains("behavioral interview questions")),
            "{q:?}"
        );
        assert!(q.iter().any(|x| x.contains("API Gateway")), "{q:?}");
    }

    #[test]
    fn qa_research_queries_without_vocabulary_still_yields_base_queries() {
        let s = sample_session();
        let q = qa_research_queries(&s, &[], 18);
        assert!(!q.is_empty());
    }

    #[test]
    fn interview_qa_prompt_demands_themed_broad_coverage() {
        let s = sample_session();
        let sources = vec![ResearchSource {
            title: "Top 50 accounting interview questions".into(),
            url: "https://example.com/q".into(),
            snippet: "Tell me about a time you found an error in a close.".into(),
            fetched_at_unix_ms: 0,
        }];
        let req = interview_qa_prompt(&s, &sources);
        assert!(req.user.contains("Top 50 accounting interview questions"));
        assert!(req.user.contains("https://example.com/q"));
        let sys = req.system.to_lowercase();
        assert!(sys.contains("20"), "floor missing");
        assert!(sys.contains("100"), "cap missing");
        assert!(sys.contains("behavioral") || sys.contains("theme"), "{}", req.system);
        assert_eq!(req.max_tokens, 6000);
    }
```

- [ ] **Step 2: Run to verify failure.** `cargo test -p conva-core qa_research_queries interview_qa_prompt` — COMPILE FAIL (fns not defined).

- [ ] **Step 3: Implement.** Below `research_findings_prompt` in `crates/conva-core/src/simcon.rs`:

```rust
/// Broader query set for the deep interview Q&A pass (spec 2026-08-26,
/// part A) — many more queries than [`research_queries`], deliberately
/// aimed at question BANKS rather than general background. No fixed
/// per-role count is baked in here; breadth comes from more queries and a
/// bigger source budget (the shell's `QA_MAX_QUERIES`/`QA_MAX_SOURCES`),
/// and the synthesis prompt decides how many distinct pairs the material
/// actually supports.
pub fn qa_research_queries(session: &SimConSession, vocabulary: &[String], cap: usize) -> Vec<String> {
    let topic = if session.title.trim().is_empty() {
        session.category.label().to_string()
    } else {
        session.title.trim().to_string()
    };
    let role = session
        .job_description
        .as_deref()
        .map(|jd| jd.trim())
        .filter(|jd| !jd.is_empty())
        .map(|jd| jd.chars().take(80).collect::<String>())
        .unwrap_or_else(|| topic.clone());

    let mut q = vec![
        format!("{topic} most common interview questions"),
        format!("top interview questions for {role}"),
        format!("{role} technical interview questions"),
        format!("{role} behavioral interview questions"),
        format!("{topic} interview questions and answers"),
    ];
    for chunk in vocabulary.chunks(3).take(3) {
        q.push(format!("{} interview questions {}", chunk.join(" "), topic));
    }
    q.truncate(cap);
    q
}

/// Prompt for the deep interview Q&A pass's document: synthesize the
/// gathered sources into a standalone bank of real, distinct question +
/// strong-answer pairs — spec 2026-08-26 part A. Themed `##` sections
/// (the model chooses themes that fit what the sources support); each
/// entry `**Q: ...** A: ...` so it reads well AND is harvestable by
/// `extract_glossary_entries` incidentally. At least 20 pairs, up to 100
/// — driven by how much the material supports, not a fixed target.
pub fn interview_qa_prompt(session: &SimConSession, sources: &[ResearchSource]) -> LlmRequest {
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
number, and do not stop early if the sources clearly support more. \
Output only the Markdown document — no preamble.",
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
        max_tokens: 6000,
    }
}
```

- [ ] **Step 4: Run to verify pass.** `cargo test -p conva-core` — ALL green. `cargo fmt --check` clean.

- [ ] **Step 5: Commit.**

```bash
git add crates/conva-core/src/simcon.rs
git commit -m "feat(simcon): qa_research_queries + interview_qa_prompt"
```

---

### Task 2: `deep_qa_enabled` + `qa_doc_id` fields (Rust + TS mirror)

**Files:**
- Modify: `crates/conva-core/src/simcon.rs`
- Modify: `src/lib/ipc.ts`

- [ ] **Step 1: Add fields.** In `SimConSession`, after `research_doc_id`:

```rust
    /// Opt-in: research the web broadly for common interview questions +
    /// strong answers and write them into their own generated document
    /// (spec 2026-08-26, part A) — costs meaningfully more searches/tokens
    /// than default research, so it's a separate toggle. Interview
    /// category only.
    #[serde(default)]
    pub deep_qa_enabled: bool,
    /// The `RagDocument` id of the generated Interview Q&A document, once
    /// generated (replaced on regeneration, like the other two).
    #[serde(default)]
    pub qa_doc_id: Option<String>,
```

  Update every full `SimConSession { ... }` literal in `crates/conva-core` (grep — the default-context constructor and test fixtures `sample_session`, `grounding_base`) with `deep_qa_enabled: false, qa_doc_id: None,`.

- [ ] **Step 2: TS mirror.** In `src/lib/ipc.ts`'s `SimConSession`, after `research_doc_id?: string | null;`:

```ts
  /** Opt-in deep interview Q&A research (Interview category only) —
   * costs meaningfully more searches/tokens than default research. */
  deep_qa_enabled?: boolean;
  /** RagDocument id of the generated Interview Q&A document, once
   * generated (replaced on regeneration). */
  qa_doc_id?: string | null;
```

- [ ] **Step 3: Verify.** `cargo test -p conva-core` ALL green; `cargo fmt --check` clean; `npm run build` clean.

- [ ] **Step 4: Commit.**

```bash
git add crates/conva-core/src/simcon.rs src/lib/ipc.ts
git commit -m "feat(simcon): deep_qa_enabled + qa_doc_id fields (Rust+TS mirror)"
```

---

### Task 3: Shell — refactor `research()`, wire Stage 3 (deep Q&A)

**Files:**
- Modify: `src-tauri/src/simcon.rs`
- Modify: `src-tauri/src/lib.rs`

⚠️ No shell compile locally — `cargo fmt --check` + full `git diff` re-read + cross-checking core symbols are the gates.

- [ ] **Step 1: `src-tauri/src/simcon.rs` — refactor `research()`.** Read the current fn fully first. Change its signature from `pub(crate) fn research(session: &SimConSession, vocabulary: &[String]) -> Result<(Vec<ResearchSource>, u64), CoreError>` to:

```rust
pub(crate) fn research(
    queries: Vec<String>,
    max_sources: usize,
) -> Result<(Vec<ResearchSource>, u64), CoreError> {
```

  Replace the body's `for query in conva_core::simcon::research_queries(session, vocabulary, RESEARCH_MAX_QUERIES) {` with `for query in queries {`, and every `RESEARCH_MAX_SOURCES` inside the loop with `max_sources`. The doc comment's "Bounded autonomous web research" text stays accurate — update its signature description.

  Add the new constants right after `RESEARCH_MAX_SOURCES`:

```rust
/// The deep Q&A pass's budget (spec 2026-08-26, part A) — deliberately
/// much larger than default research; it's opt-in for exactly this cost.
const QA_MAX_QUERIES: usize = 18;
const QA_MAX_SOURCES: usize = 45;
```

- [ ] **Step 2: Fix `research`'s two call sites** (both currently pass `(&session, &vocab)`):
  - `prepare`'s call (`research(&session, &[])`) becomes:
    `research(conva_core::simcon::research_queries(&session, &[], RESEARCH_MAX_QUERIES), RESEARCH_MAX_SOURCES)`
  - `simcon_generate_dossier`'s Stage 2 call (in `src-tauri/src/lib.rs` — grep `simcon::research(`) becomes:
    `simcon::research(conva_core::simcon::research_queries(&session, &vocab, /* the existing RESEARCH_MAX_QUERIES-equivalent constant already used there, keep its value */), /* existing RESEARCH_MAX_SOURCES-equivalent, keep its value */)` — read the exact current call first and preserve its existing budget values (they should still be `simcon::RESEARCH_MAX_QUERIES`/`RESEARCH_MAX_SOURCES`, which stay `pub(crate)` visible from `simcon.rs`'s constants — if they're private `const` today, either make them `pub(crate)` or re-export the same numbers as local constants in `lib.rs`; report which).

- [ ] **Step 3: Add Stage 3 in `simcon_generate_dossier`** (`src-tauri/src/lib.rs`), after Stage 2's block, before the final `simcon::save`:

```rust
    // ── Stage 3: deep interview Q&A research (spec 2026-08-26, part A) —
    // opt-in, Interview only, much broader than Stage 2. Failures/no key
    // skip cleanly; Stage 1/2's documents stand regardless.
    if session.deep_qa_enabled
        && session.research_enabled
        && session.category == conva_core::simcon::SimConCategory::Interview
    {
        let qa_vocab: Vec<String> = session.glossary.iter().take(6).cloned().collect();
        let qa_queries =
            conva_core::simcon::qa_research_queries(&session, &qa_vocab, simcon::QA_MAX_QUERIES);
        if let Ok((qa_sources, qa_searches)) = simcon::research(qa_queries, simcon::QA_MAX_SOURCES) {
            metering::record_tavily_search(&app, qa_searches);
            if !qa_sources.is_empty() {
                let qa_request =
                    conva_core::simcon::interview_qa_prompt(&session, &qa_sources);
                let mut qa_buf = String::new();
                let qa_usage = llm::stream_completion(
                    selection.provider,
                    &key,
                    &selection.model,
                    &qa_request,
                    &mut |t| qa_buf.push_str(t),
                );
                if let Ok(qa_usage) = qa_usage {
                    metering::record_llm(&app, selection.provider, qa_usage);
                    let qa_text = qa_buf.trim().to_string();
                    if !qa_text.is_empty() {
                        if let Some(old) = session.qa_doc_id.take() {
                            let _ = state.rag.delete(&old);
                            profile.doc_ids.retain(|d| d != &old);
                        }
                        let qa_name = format!("{} — Interview Q&A", session.title.trim());
                        if let Ok(qa_report) =
                            state.rag.ingest_generated(&qa_name, &qa_text, &session.id)
                        {
                            let qa_doc_id = qa_report.document.id.clone();
                            if !profile.doc_ids.contains(&qa_doc_id) {
                                profile.doc_ids.push(qa_doc_id.clone());
                            }
                            session.qa_doc_id = Some(qa_doc_id);
                        }
                    }
                }
            }
        }
    }
```

  Adjust field/variable names (`selection`, `key`, `profile`, `state`, `app`) to match what's actually in scope at that point in the function (they're established earlier in the same function for Stage 1/2 — reuse them, don't redeclare). If Stage 2's block ends by saving the profile (per the prior round's "single save after both stages" decision), move this Stage 3 block BEFORE that single `save_profile` call so it's included in the same save, or add one more `profile.updated_at_unix_ms = ...; simcon::save_profile(...)` after Stage 3 if the single-save structure doesn't naturally extend — read the current code and report which you did.

- [ ] **Step 4: Struct literals.** The default-context `SimConSession { ... }` literal in `src-tauri/src/simcon.rs` gains `deep_qa_enabled: false, qa_doc_id: None,`.

- [ ] **Step 5: Verify.** `cargo fmt --check` clean; full `git diff` re-read; cross-check `conva_core::simcon::qa_research_queries`/`interview_qa_prompt`/`SimConCategory::Interview` all exist with matching signatures (Task 1).

- [ ] **Step 6: Commit.**

```bash
git add src-tauri/src/simcon.rs src-tauri/src/lib.rs
git commit -m "feat(grounding): deep interview Q&A research — Stage 3, opt-in"
```

---

### Task 4: UI — deep-Q&A checkbox + third "Interview Q&A" document row

**Files:**
- Modify: `src/components/simcon/SimConSetup.tsx`
- Modify: `src/components/simcon/SimConDetail.tsx`

- [ ] **Step 1: `SimConSetup.tsx`.** Add state `const [deepQa, setDeepQa] = useState(initial?.deep_qa_enabled ?? false);` beside the existing `research` state. Include `deep_qa_enabled: deepQa` in the save payload (find where `research_enabled: research` is set in the save call, add the sibling field). Add a new `Section` immediately after the existing "Let Ally research" section, rendered only `{category === "interview" && ( ... )}`:

```tsx
{category === "interview" && (
  <Section
    title="Deep interview Q&A research"
    description="Ally searches the web broadly for common interview questions for this role and writes strong answers into your Context knowledge document — uses meaningfully more searches and tokens than standard research."
  >
    <label className="flex items-center gap-2 text-sm text-fg">
      <input
        type="checkbox"
        checked={deepQa}
        disabled={!research}
        onChange={(e) => setDeepQa(e.target.checked)}
      />
      Research common interview questions + answers
    </label>
    {!research && (
      <p className="mt-1 text-[11px] text-fg-faint">
        Needs "Let Ally research" enabled above.
      </p>
    )}
  </Section>
)}
```

  Also add a review-step line in the step-3 `<dl>` (only when `category === "interview"`): `<dt className="text-fg-faint">Deep Q&A</dt><dd className="text-fg">{deepQa ? "On" : "Off"}</dd>`. If `research` is turned off after `deepQa` was checked, reset `deepQa` to false (add to `pickCategory`/the research-toggle handler, or a small effect — implementer's choice, keep it simple).

- [ ] **Step 2: `SimConDetail.tsx`.** Add a third document row, "Interview Q&A", mirroring the Research findings row's pattern exactly (state trio `qaDocId`/`qaText`/`showQa`, `toggleQa`, refresh in `generateDossier`'s success path from `updated.qa_doc_id`), shown only when `session?.category === "interview"`. Explanatory line: shown doc → "Common interview questions Ally found online, with strong answers."; not yet generated but enabled → "Runs with Generate — deep Q&A research is on for this context."; not enabled → "Turn on \"Deep interview Q&A research\" in Edit setup to generate this."
  Extend the attached-documents filter to also exclude `qaDocId`.

- [ ] **Step 3: Verify.** `npm test` full suite green (no new tests — presentational wiring of tested backend state, same as the two-stage pipeline's Task 6 precedent); `npm run build` clean.

- [ ] **Step 4: Commit.**

```bash
git add src/components/simcon/SimConSetup.tsx src/components/simcon/SimConDetail.tsx
git commit -m "feat(contexts): deep Q&A checkbox + Interview Q&A document row"
```

---

### Task 5: `linked_context_id` on `Conversation` (Rust + TS mirror) + save-time capture

**Files:**
- Modify: `src-tauri/src/conversations.rs`
- Modify: `src/lib/ipc.ts`
- Modify: `src/state/conversation.ts`

- [ ] **Step 1: `conversations.rs`.** Add `pub linked_context_id: Option<String>` (`#[serde(default)]`) to both `Conversation` and `ConversationSummary`, right after `linked_docs`. `pub fn save` gains a new parameter `context_id: Option<String>` (place it after `linked_docs` in the signature); in the `Some(id)` branch, `linked_context_id: context_id.or_else(|| existing.as_ref().and_then(|c| c.linked_context_id.clone()))` (a re-save without an explicit new id keeps the old link — mirrors how title/created_at fall back to `existing`); in the `None` (new conversation) branch, `linked_context_id: context_id`. Wherever `ConversationSummary` is built from a loaded `Conversation` (grep `ConversationSummary {`), add `linked_context_id: c.linked_context_id.clone()` (or the correct binding name — read the actual code).
  Update the shell command wrapping `save` (grep `#[tauri::command]` above `fn conversation_save` or similar — find the exact command name) to accept and pass through the new parameter.

- [ ] **Step 2: TS mirror.** `src/lib/ipc.ts`: add `linked_context_id?: string | null;` to both `Conversation` and `ConversationSummary`, after `linked_docs: string[];`. Update the `commands.ts` wrapper for the save command to accept and forward a new `contextId?: string | null` argument (find its current signature — grep `conversations_save\|conversationSave` in `commands.ts`), and the `ConvaBackend`/`tauri.ts`/`web.ts` `conversations.save` method signatures to match.

- [ ] **Step 3: `src/state/conversation.ts`.** In the `save` action, import `useGroundingStore` and pass its `activeId` as the new argument:

```ts
    const saved = await getBackend().conversations.save(
      get().openId,
      title?.trim() || get().title,
      segments,
      get().linkedDocs,
      useGroundingStore.getState().activeId,
    );
```

- [ ] **Step 4: Verify.** `npm test` full suite green; `npm run build` clean (shell not locally compilable — `cargo fmt --check` clean, full `git diff` re-read).

- [ ] **Step 5: Commit.**

```bash
git add src-tauri/src/conversations.rs src/lib/ipc.ts src/state/conversation.ts
git commit -m "feat(conversations): linked_context_id captured at save time"
```

---

### Task 6: `performance_analysis_prompt` (core)

**Files:**
- Modify: `crates/conva-core/src/simcon.rs`

- [ ] **Step 1: Write the failing tests.** Append to `mod tests`:

```rust
    #[test]
    fn performance_analysis_prompt_interview_framing_with_grounding() {
        let req = performance_analysis_prompt(
            Some(SimConCategory::Interview),
            Some("Senior DevOps role requiring Terraform and EKS."),
            &["Terraform".to_string(), "EKS".to_string()],
            "Them: Tell me about your Terraform experience.\nYou: I've used it for three years.",
        );
        let sys = req.system.to_lowercase();
        assert!(sys.contains("candidate"));
        assert!(sys.contains("job description"));
        assert!(req.user.contains("Senior DevOps role"));
        assert!(req.user.contains("Terraform"));
        assert!(req.user.contains("Tell me about your Terraform experience"));
        assert_eq!(req.max_tokens, 3000);
    }

    #[test]
    fn performance_analysis_prompt_ungrounded_still_produces_valid_prompt() {
        let req = performance_analysis_prompt(None, None, &[], "Them: Hi.\nYou: Hello.");
        assert!(!req.system.trim().is_empty());
        assert!(!req.user.contains("Role expectations"));
        assert!(req.user.contains("Them: Hi."));
    }

    #[test]
    fn performance_analysis_prompt_sales_framing_differs_from_interview() {
        let interview = performance_analysis_prompt(Some(SimConCategory::Interview), None, &[], "x");
        let sales = performance_analysis_prompt(Some(SimConCategory::SalesCall), None, &[], "x");
        assert_ne!(interview.system, sales.system);
        assert!(sales.system.to_lowercase().contains("objection"));
    }
```

- [ ] **Step 2: Run to verify failure.** `cargo test -p conva-core performance_analysis_prompt` — COMPILE FAIL.

- [ ] **Step 3: Implement.** Below `interview_qa_prompt`:

```rust
/// Category-aware analytical performance report prompt (spec 2026-08-26,
/// part B) — grounded in the linked context's job description/vocabulary
/// when available, otherwise a generic structural analysis the transcript
/// alone supports. `category: None` covers a conversation with no linked
/// context (or one whose context was since deleted) — never an error,
/// always a valid, useful prompt.
pub fn performance_analysis_prompt(
    category: Option<SimConCategory>,
    job_description: Option<&str>,
    glossary: &[String],
    transcript_text: &str,
) -> LlmRequest {
    let task = match category {
        Some(SimConCategory::Interview) => {
            "Analyze how well the user performed as the CANDIDATE in this \
interview — strengths, gaps versus the job description and the \
vocabulary an interviewer would expect, clarity and structure of \
answers, and concrete, specific suggestions for improvement. Cite \
specific moments from the transcript."
        }
        Some(SimConCategory::SalesCall) => {
            "Analyze how well the user handled this sales call — objection \
handling, rapport, and any close attempts. Cite specific moments from \
the transcript and give concrete suggestions for improvement."
        }
        Some(SimConCategory::CompanyMeeting) => {
            "Analyze this meeting's structure — decisions reached, action \
items and who owns them, and how clearly the user communicated. Cite \
specific moments from the transcript."
        }
        Some(SimConCategory::Other) | None => {
            "Analyze this conversation's clarity and structure — what \
went well, what was unclear, and concrete suggestions for improvement. \
Cite specific moments from the transcript."
        }
    };
    let system = format!(
        "You are Ally, writing an analytical performance report. {task} \
Ground every claim in what's actually in the transcript — never invent. \
Output only the Markdown report — no preamble."
    );

    let mut user = String::new();
    if let Some(jd) = job_description {
        let jd = jd.trim();
        if !jd.is_empty() {
            user.push_str(&format!(
                "Role expectations (job description):\n{}\n\n",
                jd.chars().take(4_000).collect::<String>()
            ));
        }
    }
    if !glossary.is_empty() {
        user.push_str(&format!(
            "Vocabulary the candidate was expected to know: {}\n\n",
            glossary.join(", ")
        ));
    }
    user.push_str("Transcript:\n\n");
    user.push_str(transcript_text);

    LlmRequest {
        system,
        user,
        max_tokens: 3000,
    }
}
```

- [ ] **Step 4: Run to verify pass.** `cargo test -p conva-core` ALL green. `cargo fmt --check` clean.

- [ ] **Step 5: Commit.**

```bash
git add crates/conva-core/src/simcon.rs
git commit -m "feat(simcon): performance_analysis_prompt — category-aware, gracefully ungrounded"
```

---

### Task 7: Shell — `analyze_conversation` command

**Files:**
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Extract shared transcript-rendering.** Read `export_transcript` fully (grep it). Extract its markdown-building loop into a standalone fn:

```rust
/// Render finalized transcript segments as speaker-labeled Markdown lines
/// (shared by `export_transcript` and `analyze_conversation`).
fn render_transcript_markdown(segments: &[TranscriptSegment]) -> String {
    use conva_core::audio::StreamSide;
    let mut out = String::new();
    for s in segments.iter().filter(|s| s.is_final) {
        let speaker = match s.side {
            StreamSide::Inbound => "Them",
            StreamSide::Outbound => "You",
        };
        let total_seconds = s.start_ms / 1000;
        out.push_str(&format!(
            "**{speaker}** ({:02}:{:02}:{:02}): {}\n\n",
            total_seconds / 3600,
            (total_seconds % 3600) / 60,
            total_seconds % 60,
            s.text.trim()
        ));
    }
    out
}
```

  `export_transcript` becomes:

```rust
#[tauri::command]
fn export_transcript(path: String, segments: Vec<TranscriptSegment>) -> Result<(), String> {
    let out = format!("# conva transcript\n\n{}", render_transcript_markdown(&segments));
    fs::write(&path, out).map_err(|e| e.to_string())
}
```

- [ ] **Step 2: New command**, placed near `export_transcript`:

```rust
/// Analyze a saved conversation's performance (spec 2026-08-26, part B) —
/// category-aware, grounded in its linked context's job description and
/// vocabulary when one exists (best-effort: a missing/deleted context
/// degrades to the ungrounded framing, never errors). Returns the
/// Markdown report text for the caller to save via the native dialog.
#[tauri::command]
fn analyze_conversation(app: AppHandle, state: State<AppState>, id: String) -> Result<String, String> {
    let conversation = conversations::load(&app, &id).map_err(|e| e.to_string())?;
    let (category, job_description, glossary) = conversation
        .linked_context_id
        .as_deref()
        .and_then(|cid| simcon::load(&app, cid).ok())
        .map(|s| (Some(s.category), s.job_description, s.glossary))
        .unwrap_or((None, None, Vec::new()));

    let transcript_text = render_transcript_markdown(&conversation.segments);
    let request = conva_core::simcon::performance_analysis_prompt(
        category,
        job_description.as_deref(),
        &glossary,
        &transcript_text,
    );

    let selection = state.config.lock().expect("config lock").llm_quality.clone();
    let key = resolve_key(selection.provider)?;
    let mut buf = String::new();
    let usage = llm::stream_completion(
        selection.provider,
        &key,
        &selection.model,
        &request,
        &mut |t| buf.push_str(t),
    )
    .map_err(|e| e.to_string())?;
    metering::record_llm(&app, selection.provider, usage);
    let text = buf.trim().to_string();
    if text.is_empty() {
        return Err("Ally returned an empty analysis.".into());
    }
    Ok(text)
}
```

  Adjust `conversations::load`/`simcon::load` call shapes to match their real signatures (read them first — this plan assumes `(&app, id) -> Result<T, CoreError>` per the established pattern used everywhere else in this file; adapt if different and report).

- [ ] **Step 3: Register the command** in the `generate_handler![...]` list (add `analyze_conversation,` near `export_transcript,`).

- [ ] **Step 4: Verify.** `cargo fmt --check` clean; full `git diff` re-read; cross-check `conva_core::simcon::performance_analysis_prompt`'s signature matches (Task 6).

- [ ] **Step 5: Commit.**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat(conversations): analyze_conversation command"
```

---

### Task 8: IPC wrappers + `ConversationsPanel` "Analyze & download" button

**Files:**
- Modify: `src/lib/ipc.ts`
- Modify: `src/lib/commands.ts`
- Modify: `src/lib/backend/ConvaBackend.ts`
- Modify: `src/lib/backend/tauri.ts`
- Modify: `src/lib/backend/web.ts`
- Modify: `src/components/ConversationsPanel.tsx`

- [ ] **Step 1: `commands.ts`.** Add, near `exportTranscript`:

```ts
/** Analyze a saved conversation's performance (category-aware, grounded
 * in its linked context when one exists) — returns the report Markdown
 * for the caller to save. */
export function analyzeConversation(id: string): Promise<string> {
  return invoke<string>("analyze_conversation", { id });
}
```

  Update `conversationSave`-equivalent's wrapper (from Task 5) if not already done there.

- [ ] **Step 2: Backend interfaces.** Add `analyzeConversation: (id: string) => Promise<string>;` to `ConvaBackend.ts`'s `sessions` (or wherever `exportTranscript` lives — match its exact home) interface; implement in `tauri.ts` (`cmd.analyzeConversation`) and `web.ts` (throw/unsupported, matching that file's existing pattern for desktop-only commands).

- [ ] **Step 3: `ConversationsPanel.tsx`.** Add state `const [analyzing, setAnalyzing] = useState(false);` and an action beside `exportShown`:

```tsx
  const analyzeAndDownload = async () => {
    if (!openId) return;
    setAnalyzing(true);
    try {
      const report = await backend.sessions.analyzeConversation(openId);
      const { save } = await import("@tauri-apps/plugin-dialog");
      const path = await save({
        defaultPath: "conva-analysis.md",
        filters: [{ name: "Markdown", extensions: ["md"] }],
      });
      if (!path) return;
      const { writeTextFile } = await import("@tauri-apps/plugin-fs");
      await writeTextFile(path, report);
      setNotice(`Analysis saved to ${path}`);
    } catch (e) {
      setNotice(String(e));
    } finally {
      setAnalyzing(false);
    }
  };
```

  (If the file already has a different pattern for writing a string to a chosen path — e.g. an existing `writeTextFile` import or a backend-side write command — use that instead of adding a new plugin import; check first and report which.) Adapt `openId`/its equivalent to the file's real state name for "the currently open/selected conversation" — read the file first.

  Add the button beside the existing export button:

```tsx
          <button
            type="button"
            onClick={() => void analyzeAndDownload()}
            disabled={analyzing || !openId}
            title="Analyze performance & download…"
            aria-label="Analyze performance and download"
            className="rounded-sm p-1.5 text-ai transition hover:bg-ai/10 disabled:opacity-40"
          >
            <Icon name={analyzing ? "sparkle" : "ally"} size={16} />
          </button>
```

- [ ] **Step 4: Verify.** `npm test` full suite green; `npm run build` clean.

- [ ] **Step 5: Commit.**

```bash
git add src/lib/ipc.ts src/lib/commands.ts src/lib/backend/ConvaBackend.ts src/lib/backend/tauri.ts src/lib/backend/web.ts src/components/ConversationsPanel.tsx
git commit -m "feat(conversations): Analyze & download UI"
```

---

### Task 9: Full verification + push + new issue + draft PR

- [ ] **Step 1: Full gate.** `npm run build`, `npm test`, `cargo test -p conva-core`, `cargo fmt --check`, `cargo clippy -p conva-core --all-targets -- -D warnings` — ALL green.
- [ ] **Step 2: Push** `claude/conva-app-ui-modernization-igllsd` (`git push -u origin ...` — the branch was freshly reset to main after PR #89 merged, so this is a plain push, not force; retries ×4 with 2/4/8/16s backoff on network errors only).
- [ ] **Step 3: New issue** ("Deep interview Q&A research + analytical performance download") **+ new draft PR** (`Closes #<issue>`, spec link, both parts summarized, testing numbers, manual-QA checklist: enable deep Q&A on an interview context, regenerate, confirm the third document has 20+ real Q&A pairs; save a conversation while grounded in a context, Analyze & download, confirm the report references the actual JD/vocabulary; save an unlinked conversation and analyze it, confirm a generic report downloads without error). Subscribe to PR activity.
- [ ] **Step 4: Watch CI.**

---

## Self-review notes

- Spec coverage: Part A → Tasks 1–4; Part B → Tasks 5–8; testing → Tasks 1, 6, 9.
- Type consistency: `research()`'s new `(queries, max_sources)` signature is used identically by both call sites (Stage 2's existing call, Stage 3's new call, and `prepare`'s call) — Task 3 updates all three in one commit so nothing is left calling the old signature.
- `performance_analysis_prompt`'s `category: Option<SimConCategory>` — `None` and `Some(Other)` deliberately share the same generic branch (both mean "no specific lens applies").
- Tasks 3 and 7 leave the shell uncompilable locally only in the trivial sense CI verifies it — consistent with every prior shell task this session.

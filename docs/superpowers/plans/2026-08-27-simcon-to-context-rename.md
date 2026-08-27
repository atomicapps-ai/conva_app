# SimCon to Context Rename Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the SimCon → Context terminology migration: every `SimCon*` type/file/command/UI-copy occurrence becomes its `Context`/`ConversationContext` equivalent, with identical behavior and identical data shape — only names change.

**Architecture:** This is a **pure, no-behavior-change rename** — there is no new logic to TDD. The testing discipline is therefore: **run the full existing suite before the first change (establish the green baseline)**, and **run it again after every phase (prove that phase's rename didn't break anything)** — never write new tests for this plan; every existing test's assertions stay semantically identical, only the symbol names inside them change. The two hard compile-time risks are (1) the Rust↔TS IPC mirror (a renamed Rust type/command whose TS mirror lags is a runtime failure the compiler can't catch on the TS side, and vice versa) and (2) the Tauri `#[tauri::command] fn` name vs. its `generate_handler![...]` list entry — these must agree character-for-character or the command silently 404s at runtime, not at compile time. Because the shell crate (`src-tauri`) doesn't compile in this sandbox, every shell-touching task carries an explicit manual cross-check step (re-read the diff, grep the paired name) in addition to `cargo fmt --check` and CI's Windows job.

Three scope decisions, made during planning to keep this a genuinely zero-behavior-change rename (documented here so they aren't re-derived mid-execution):
1. **On-disk data is untouched.** The context storage directory `<app-data>/simcon/` and the `sim-<timestamp>` id prefix minted for new records both stay literally `simcon`/`sim-` — renaming either would orphan every existing user's saved contexts (a real behavior change, not a rename) or fork new-vs-old id formats for no reason. Only the Rust **symbol** naming them (`simcon_dir` → `context_dir`) changes; the string literal `"simcon"` inside it does not.
2. **`session.rs`'s `is_rehearsal`/`simcon_title` fields (`SessionSummary`) are out of scope.** These are per-listen-session JSONL metadata, not one of the 5 `SimCon*` core types, and are not in the design spec's scope inventory — renaming them would touch persisted JSONL data outside what the spec approved. Only the **display text** built from them ("Sim Con rehearsal" / "Sim Con" pill in `ConversationsPanel.tsx`) changes to "Context".
3. **Parameter/local-variable renaming (`session` → `context`)** is applied only where the design spec explicitly illustrates it — the `crates/conva-core` prompt-building functions that take a `&SimConSession` (matching its own worked example, `knowledge_prompt(session: &SimConSession, ...) → knowledge_prompt(context: &ConversationContext, ...)`). Shell-side local variables named `session` (e.g. in `simcon_save`, `rehearsal.rs`) keep that name — the shell already has a *different*, real "session" concept (`SessionManager`/`session.rs`, the audio/listen session), and blanket-renaming every shell-side `session` local would be a much larger, non-mechanical diff the spec never asked for.

Investigation for this plan found two sites the spec's scope inventory didn't list, both required for the shell crate to compile: `src-tauri/src/rehearsal.rs` (imports `SimConSession`/`SimConPersona`/`persona_live_prompt` from `conva_core::simcon`, and uses them as `RehearsalContext` field types) and `src-tauri/src/web.rs` (imports `ResearchSource` from `conva_core::simcon` and has one doc-comment prose reference). Both are covered in Phase 2. Conversely, `crates/conva-core/src/highlight.rs` — flagged as a possible site to check — was confirmed to have **zero** `SimCon` references (it only defines the unrelated `HighlightContext` struct) and needs no change.

**Tech Stack:** Rust (`crates/conva-core` compiles + tests locally; `src-tauri` does NOT compile in this sandbox — `cargo fmt --check` + manual cross-checks + CI's Windows job are the gate) and TypeScript/React/vitest (`src/` — `npm run build` + `npm test` compile-check both the IPC mirror and every component).

Spec: `docs/superpowers/specs/2026-08-27-simcon-to-context-rename-design.md`.

**Standard commit trailer for every commit in this plan:**

```
Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GiKzMingp6q12HJcuxRSZp
```

---

## Phase 1: Core crate rename (`crates/conva-core`)

### Task 1.1: Baseline — confirm the pre-change suite is green

**Files:** none (verification only).

- [ ] **Step 1: Run the full core suite.** Run: `cargo test -p conva-core` — record the pass count (expected: all tests pass, including the 40+ tests in `simcon.rs`'s `mod tests`).
- [ ] **Step 2: Run the lint gates.** Run: `cargo fmt --check` and `cargo clippy -p conva-core --all-targets -- -D warnings` — both clean.
- [ ] **Step 3: Note the baseline numbers** (test count, "0 failed") — Task 1.3 must reproduce the same count after the rename (renamed tests, not fewer/more tests).

### Task 1.2: Rename `crates/conva-core/src/simcon.rs` → `context.rs` — types, fns, prose, tests

**Files:**
- Rename: `crates/conva-core/src/simcon.rs` → `crates/conva-core/src/context.rs`
- Modify: `crates/conva-core/src/lib.rs`
- Modify: `crates/conva-core/src/metering.rs`

- [ ] **Step 1: `git mv` the file.**

```bash
git mv crates/conva-core/src/simcon.rs crates/conva-core/src/context.rs
```

- [ ] **Step 2: Bulk-rename the 5 core types + the `sample_session` test helper** via `sed`, whole-word-safe (every one of these tokens is a complete Rust identifier everywhere it appears in this file — confirmed by reading the full file; no partial/overlapping matches):

```bash
sed -i \
  -e 's/\bSimConSession\b/ConversationContext/g' \
  -e 's/\bSimConCategory\b/ContextCategory/g' \
  -e 's/\bSimConStatus\b/ContextStatus/g' \
  -e 's/\bSimConPersona\b/ContextPersona/g' \
  -e 's/\bSimConSummary\b/ContextSummary/g' \
  -e 's/\bsample_session\b/sample_context/g' \
  crates/conva-core/src/context.rs
```

  This handles every occurrence of the 5 type names (struct/enum definitions, every function signature, every `impl` block, and all ~40 test-module usages) plus the `sample_session()` test helper's 1 definition + 14 call sites. It does **not** touch the bare English word "SimCon"/"Sim Con" in doc-comment prose (there is no standalone `SimCon` Rust identifier in this file) — those are reworded by hand in Step 3.

- [ ] **Step 3: Reword the 10 prose (non-identifier) "SimCon"/"Sim Con"/"simcon.rs" mentions.** These are English words or a file-path reference, not Rust identifiers, so `sed` in Step 2 did not touch them. Find-and-replace each exactly (all remain inside doc comments, so no compile impact):

  | Line (pre-rename) | Before | After |
  |---|---|---|
  | 1 | `//! SimCon — Simulated Conversation: the data model.` | `//! Context — a Conversation Context: the data model.` |
  | 3 | `//! A **SimCon** is a rehearsal of a high-stakes call (interview, company` | `//! A **Context** is a rehearsal of a high-stakes call (interview, company` |
  | 11 | `//! (per-listen JSONL) — a finished SimCon **saves as** a \`Conversation\`, and a` | `//! (per-listen JSONL) — a finished Context **saves as** a \`Conversation\`, and a` |
  | 12 | `//! [\`KnowledgeProfile\`] can be reattached to a future SimCon *or* a live call.` | `//! [\`KnowledgeProfile\`] can be reattached to a future Context *or* a live call.` |
  | 16 | `//! (\`src-tauri/src/simcon.rs\`, Phase A.2).` | `//! (\`src-tauri/src/context.rs\`, Phase A.2).` |
  | 75 | `/// Lifecycle of a SimCon, start to finish.` | `/// Lifecycle of a Context, start to finish.` |
  | 120 | `/// The reusable, indexed knowledge base for a SimCon — attached library` | `/// The reusable, indexed knowledge base for a Context — attached library` |
  | 122 | `/// attach the same profile to a later SimCon or to a live call by id.` | `/// attach the same profile to a later Context or to a live call by id.` |
  | 140 | `/// One simulated-conversation record: Step 1 setup through Step 4 run.` | `/// One Conversation Context record: Step 1 setup through Step 4 run.` |
  | 227 | `/// Catalog entry for the SimCon list view (cheap to list without loading the` | `/// Catalog entry for the Context list view (cheap to list without loading the` |

  Use Edit with each `old_string`/`new_string` pair above (each is unique in the file, confirmed by the Step 2 grep already run against the pre-`sed` file).

- [ ] **Step 4: Rename the `session` parameter → `context` in the 7 core prompt-building functions that take `&SimConSession`** (now `&ConversationContext` after Step 2), matching the design spec's own worked example. This also renames every use of `session.` inside each function body to `context.`. `grounding_changed`'s params are named `old`/`new` (not `session`) and `performance_analysis_prompt` doesn't take a context at all — neither needs a name change, only the type tokens Step 2 already handled.

  **4a. `persona_prompt`** — before:

```rust
pub fn persona_prompt(session: &ConversationContext) -> (String, String) {
    let system = "You generate realistic counterparty personas for rehearsing a \
high-stakes conversation. Return ONLY a JSON array of exactly 3 objects, each with \
keys: \"title\" (a short label), \"summary\" (2–3 sentences on how this person \
behaves in the room), \"style_tags\" (3–5 short lowercase strings), and \
\"recommended\" (boolean — set exactly one persona true, the best fit for this \
context). No prose, no markdown, no code fences."
        .to_string();

    let mut user = format!(
        "Rehearsal type: {}\nName: {}\nGoal: {}\n",
        session.category.label(),
        session.title,
        session.purpose,
    );
    if let Some(jd) = &session.job_description {
        if !jd.trim().is_empty() {
            user.push_str(&format!("Job description:\n{}\n", jd.trim()));
        }
    }
    user.push_str(
        "\nGenerate the 3 distinct counterparty personas the user should be ready \
to face, spanning different styles/difficulties.",
    );
    (system, user)
}
```

  after:

```rust
pub fn persona_prompt(context: &ConversationContext) -> (String, String) {
    let system = "You generate realistic counterparty personas for rehearsing a \
high-stakes conversation. Return ONLY a JSON array of exactly 3 objects, each with \
keys: \"title\" (a short label), \"summary\" (2–3 sentences on how this person \
behaves in the room), \"style_tags\" (3–5 short lowercase strings), and \
\"recommended\" (boolean — set exactly one persona true, the best fit for this \
context). No prose, no markdown, no code fences."
        .to_string();

    let mut user = format!(
        "Rehearsal type: {}\nName: {}\nGoal: {}\n",
        context.category.label(),
        context.title,
        context.purpose,
    );
    if let Some(jd) = &context.job_description {
        if !jd.trim().is_empty() {
            user.push_str(&format!("Job description:\n{}\n", jd.trim()));
        }
    }
    user.push_str(
        "\nGenerate the 3 distinct counterparty personas the user should be ready \
to face, spanning different styles/difficulties.",
    );
    (system, user)
}
```

  **4b. `persona_live_prompt`** — before:

```rust
pub fn persona_live_prompt(
    session: &ConversationContext,
    persona: &ContextPersona,
    research: &[ResearchSource],
    segments: &[TranscriptSegment],
    chunks: &[ScoredChunk],
    max_tokens: u32,
) -> LlmRequest {
    let style = if persona.style_tags.is_empty() {
        String::new()
    } else {
        format!(" Your style: {}.", persona.style_tags.join(", "))
    };

    let mut system = format!(
        "You are roleplaying the user's counterparty in a {category} so they can \
rehearse. Stay fully in character as:\n{title} — {summary}{style}\n\n\
The user is the other person in the room. Speak ONLY as your character, in the \
first person, one turn at a time. This is spoken conversation: keep each reply \
short and natural (1–4 sentences), no markdown, no lists, no stage directions, \
no narration — just what your character says out loud. Stay realistic and \
specific using the background material. Never break character and never say you \
are an AI or that this is a simulation.",
        category = session.category.label(),
        title = persona.title,
        summary = persona.summary,
        style = style,
    );
    if let Some(jd) = session.job_description.as_deref() {
        let jd = jd.trim();
        if !jd.is_empty() {
            system.push_str(&format!(
                "\n\nThe role under discussion (for context you'd realistically \
know):\n{}",
                jd.chars().take(1_500).collect::<String>()
            ));
        }
    }
```

  after (only the signature + the two `session.` reads inside the same block change — the rest of the function body, from the `// Grounding:` comment onward, has no `session.` references and is untouched):

```rust
pub fn persona_live_prompt(
    context: &ConversationContext,
    persona: &ContextPersona,
    research: &[ResearchSource],
    segments: &[TranscriptSegment],
    chunks: &[ScoredChunk],
    max_tokens: u32,
) -> LlmRequest {
    let style = if persona.style_tags.is_empty() {
        String::new()
    } else {
        format!(" Your style: {}.", persona.style_tags.join(", "))
    };

    let mut system = format!(
        "You are roleplaying the user's counterparty in a {category} so they can \
rehearse. Stay fully in character as:\n{title} — {summary}{style}\n\n\
The user is the other person in the room. Speak ONLY as your character, in the \
first person, one turn at a time. This is spoken conversation: keep each reply \
short and natural (1–4 sentences), no markdown, no lists, no stage directions, \
no narration — just what your character says out loud. Stay realistic and \
specific using the background material. Never break character and never say you \
are an AI or that this is a simulation.",
        category = context.category.label(),
        title = persona.title,
        summary = persona.summary,
        style = style,
    );
    if let Some(jd) = context.job_description.as_deref() {
        let jd = jd.trim();
        if !jd.is_empty() {
            system.push_str(&format!(
                "\n\nThe role under discussion (for context you'd realistically \
know):\n{}",
                jd.chars().take(1_500).collect::<String>()
            ));
        }
    }
```

  **4c. `knowledge_prompt`** — before:

```rust
pub fn knowledge_prompt(
    session: &ConversationContext,
    research: &[ResearchSource],
    chunks: &[ScoredChunk],
    max_tokens: u32,
) -> LlmRequest {
    let template = session.category.template();
```

  after (the rest of the function body's `session.` reads are on the two lines shown below, further down):

```rust
pub fn knowledge_prompt(
    context: &ConversationContext,
    research: &[ResearchSource],
    chunks: &[ScoredChunk],
    max_tokens: u32,
) -> LlmRequest {
    let template = context.category.template();
```

  and further down in the same function, before:

```rust
    let mut user = format!("Context: {}\nGoal: {}\n", session.title, session.purpose);
    if let Some(jd) = session.job_description.as_deref() {
```

  after:

```rust
    let mut user = format!("Context: {}\nGoal: {}\n", context.title, context.purpose);
    if let Some(jd) = context.job_description.as_deref() {
```

  **4d. `research_queries`** — before:

```rust
pub fn research_queries(session: &ConversationContext, vocabulary: &[String], cap: usize) -> Vec<String> {
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
```

  after:

```rust
pub fn research_queries(context: &ConversationContext, vocabulary: &[String], cap: usize) -> Vec<String> {
    let topic = if context.title.trim().is_empty() {
        context.category.label().to_string()
    } else {
        context.title.trim().to_string()
    };
    let mut q = vec![
        format!("{topic} common questions"),
        format!("how to prepare for a {}", context.category.label()),
    ];
    if !context.purpose.trim().is_empty() {
        q.push(context.purpose.trim().chars().take(120).collect());
    }
    if let Some(jd) = &context.job_description {
```

  the rest of `research_queries`'s body (from `let jd = jd.trim();` onward, including `session.category.label()` inside the vocabulary-seeded-query loop) also reads `session.category.label()` once more — before:

```rust
    for chunk in vocabulary.chunks(3).take(2) {
        q.push(format!(
            "{topic} {} {}",
            chunk.join(" "),
            session.category.label()
        ));
    }
```

  after:

```rust
    for chunk in vocabulary.chunks(3).take(2) {
        q.push(format!(
            "{topic} {} {}",
            chunk.join(" "),
            context.category.label()
        ));
    }
```

  **4e. `research_findings_prompt`** — before:

```rust
pub fn research_findings_prompt(session: &ConversationContext, sources: &[ResearchSource]) -> LlmRequest {
    let template = session.category.template();
```

  after:

```rust
pub fn research_findings_prompt(context: &ConversationContext, sources: &[ResearchSource]) -> LlmRequest {
    let template = context.category.template();
```

  and further down:

```rust
    let mut user = format!(
        "Context: {}\nGoal: {}\n\nSources:\n\n",
        session.title, session.purpose
    );
```

  after:

```rust
    let mut user = format!(
        "Context: {}\nGoal: {}\n\nSources:\n\n",
        context.title, context.purpose
    );
```

  **4f. `qa_research_queries`** — before:

```rust
pub fn qa_research_queries(
    session: &ConversationContext,
    vocabulary: &[String],
    cap: usize,
) -> Vec<String> {
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
```

  after:

```rust
pub fn qa_research_queries(
    context: &ConversationContext,
    vocabulary: &[String],
    cap: usize,
) -> Vec<String> {
    let topic = if context.title.trim().is_empty() {
        context.category.label().to_string()
    } else {
        context.title.trim().to_string()
    };
    let role = context
        .job_description
        .as_deref()
        .map(|jd| jd.trim())
        .filter(|jd| !jd.is_empty())
        .map(|jd| jd.chars().take(80).collect::<String>())
        .unwrap_or_else(|| topic.clone());
```

  (the remainder of this function only reads the local `topic`/`role` bindings, no further `session.` occurrences.)

  **4g. `interview_qa_prompt`** — before:

```rust
pub fn interview_qa_prompt(
    session: &ConversationContext,
    sources: &[ResearchSource],
    chunks: &[ScoredChunk],
) -> LlmRequest {
    let template = session.category.template();
```

  after:

```rust
pub fn interview_qa_prompt(
    context: &ConversationContext,
    sources: &[ResearchSource],
    chunks: &[ScoredChunk],
) -> LlmRequest {
    let template = context.category.template();
```

  and further down:

```rust
    let mut user = format!("Context: {}\nGoal: {}\n\n", session.title, session.purpose);
```

  after:

```rust
    let mut user = format!("Context: {}\nGoal: {}\n\n", context.title, context.purpose);
```

> **Reordered post-write** (found during execution): the original Step 5
> tried to compile-check before Step 7 updated `lib.rs`'s module
> declaration — but Step 1 already `git mv`'d `simcon.rs` → `context.rs`,
> so at that point `lib.rs` still declared `pub mod simcon;` pointing at a
> file that no longer exists, guaranteeing an unrelated `E0583` regardless
> of whether the actual rename was correct. Steps renumbered below so the
> module declaration updates first and the compile check that depends on
> it runs after.

- [ ] **Step 5: Update `crates/conva-core/src/lib.rs`'s module declaration.** Find:

```rust
pub mod simcon;
```

  Replace with:

```rust
pub mod context;
```

  (keep its alphabetical position among the other `pub mod` lines — it was between `rag` and `tracker`; `context` now sorts between `config` and `dsp`, so move the line there too, matching the file's existing alphabetical convention.)

- [ ] **Step 6: Fix the 4 test call sites whose call passed `&sample_session()` positionally into these renamed-parameter functions** — no signature mismatch is possible (positional args, not named), so this step is a no-op confirmation, not an edit: run `cargo test -p conva-core --no-run 2>&1 | head -50` and confirm it compiles clean (parameter *names* never affect call-site syntax in Rust — only Step 2's type-token rename and Step 4's exact-text edits matter for compilation; Step 5 just landed, so this is now a real check of the actual rename, not a check that fails on an unrelated missing-module error).

- [ ] **Step 7: Grep-confirm no `SimCon`/`simcon` text remains in the file** (case-insensitive), except none should remain at all in this file (unlike the shell's `simcon_dir`, this core file has no on-disk-compat string to preserve):

```bash
grep -inE 'sim ?con' crates/conva-core/src/context.rs
```

  Expected: no output.

- [ ] **Step 8: Update `crates/conva-core/src/metering.rs`'s doc-comment example** (cosmetic — the string is just an illustrative example in a doc comment, not code). Find:

```rust
/// snake_case label owned by the call site (e.g. `ally_question`, `tracker`,
/// `simcon_knowledge`); the full set lives with the shell's recorder.
```

  Replace with:

```rust
/// snake_case label owned by the call site (e.g. `ally_question`, `tracker`,
/// `context_knowledge`); the full set lives with the shell's recorder.
```

- [ ] **Step 9: Run the suite.** `cargo test -p conva-core` — same pass count as Task 1.1's baseline (renamed tests, all still passing). `cargo fmt --check` and `cargo fmt` if it reformats anything (the `sed` pass can leave minor spacing `rustfmt` will fix). `cargo clippy -p conva-core --all-targets -- -D warnings` clean.

- [ ] **Step 10: Commit.**

```bash
git add crates/conva-core/src/context.rs crates/conva-core/src/lib.rs crates/conva-core/src/metering.rs
git commit -m "refactor(core): rename SimCon types/module to Context (crates/conva-core)"
```

(standard trailer; note `simcon.rs`'s deletion + `context.rs`'s creation are captured by `git add` on the renamed path since it was `git mv`'d.)

---

## Phase 2: Shell crate rename (`src-tauri`) — commands + `generate_handler!` + metering keys

> ⚠️ No shell compile locally. Gates: `cargo fmt --check`, a full manual re-read of every diff, and — for Task 2.2 specifically — an explicit line-by-line cross-check that every renamed `#[tauri::command] fn` name has a matching `generate_handler!` entry, both spelled identically. CI's Windows job is the real compile gate.

### Task 2.1: Rename `src-tauri/src/simcon.rs` → `context.rs`

**Files:**
- Rename: `src-tauri/src/simcon.rs` → `src-tauri/src/context.rs`

- [ ] **Step 1: `git mv` the file.**

```bash
git mv src-tauri/src/simcon.rs src-tauri/src/context.rs
```

- [ ] **Step 2: Update the module doc comment.** Before:

```rust
//! SimCon shell storage — the platform half of the Simulated Conversation
//! feature. The pure data model lives in `conva_core::simcon`; this module is
//! the fs/`AppHandle` side, mirroring `conversations.rs`.
//!
//! Storage: one pretty-printed JSON file per SimCon under
//! `<app-data>/simcon/`. (KnowledgeProfile + persona persistence arrive with
//! the ingestion/persona pipeline — Phase C/D.)
```

  After:

```rust
//! Context shell storage — the platform half of the Conversation Context
//! feature (formerly "SimCon"). The pure data model lives in
//! `conva_core::context`; this module is the fs/`AppHandle` side, mirroring
//! `conversations.rs`.
//!
//! Storage: one pretty-printed JSON file per context under
//! `<app-data>/simcon/` — the on-disk directory name is kept as `simcon` for
//! backward compatibility with existing installs (renaming it would silently
//! orphan every already-saved context); only the Rust-side names changed.
//! (KnowledgeProfile + persona persistence arrive with the ingestion/persona
//! pipeline — Phase C/D.)
```

- [ ] **Step 3: Update the import + rename the 5 core types.** Before:

```rust
use conva_core::simcon::{
    extract_glossary, KnowledgeProfile, ResearchSource, SimConCategory, SimConSession,
    SimConStatus, SimConSummary, DEFAULT_CONTEXT_ID,
};
```

  After:

```rust
use conva_core::context::{
    extract_glossary, ConversationContext, ContextCategory, ContextStatus, ContextSummary,
    KnowledgeProfile, ResearchSource, DEFAULT_CONTEXT_ID,
};
```

  Then bulk-rename the 4 remaining bare type occurrences in the rest of the file (the struct-literal in `ensure_default_context`, and 3 function signatures) via `sed`, whole-word-safe — safe here too since every occurrence is a complete identifier (confirmed by the earlier investigation grep):

```bash
sed -i \
  -e 's/\bSimConSession\b/ConversationContext/g' \
  -e 's/\bSimConCategory\b/ContextCategory/g' \
  -e 's/\bSimConStatus\b/ContextStatus/g' \
  -e 's/\bSimConSummary\b/ContextSummary/g' \
  src-tauri/src/context.rs
```

  (`SimConPersona` does not appear in this file — confirmed by the investigation grep — so it's not in this pattern list; `sed` on a pattern with zero matches is a safe no-op regardless.)

> **Added post-write** (found during execution, before any Task 2.1 edits landed): Step 3 above only rewrites the `use` import block and the 4 bare type tokens — it misses 3 further live, fully-qualified `conva_core::simcon::` references elsewhere in the file (2 real function calls, 1 doc-comment reference), which would otherwise leave unresolved-path compile errors once Phase 1 renamed the core module. New Step 4 below closes this; every step after it is renumbered up by one from the plan as first written (old Step 4 → new Step 5, ... old Step 8 → new Step 9).

- [ ] **Step 4: Rename the 3 remaining fully-qualified `conva_core::simcon::` references Step 3 doesn't reach** — two live calls and one doc-comment reference, all with a trailing `::` (unlike line 2's bare `` `conva_core::simcon` `` prose mention, already rewritten whole by Step 2):

```bash
sed -i 's/conva_core::simcon::/conva_core::context::/g' src-tauri/src/context.rs
```

  This rewrites: `if conva_core::simcon::grounding_changed(&old, &session) {` (the grounding-changed check inside `save`) → `conva_core::context::grounding_changed(...)`; `conva_core::simcon::research_queries(&session, &[], RESEARCH_MAX_QUERIES),` (inside `prepare`) → `conva_core::context::research_queries(...)`; and the doc-comment reference `` /// via [`conva_core::simcon::research_queries`] `` → `` /// via [`conva_core::context::research_queries`] ``. Running this after Step 3 is safe even though Step 3's literal `use`-block edit already covers line 14 — the pattern simply won't match there anymore (idempotent no-op on that line), and will only touch the 3 sites Step 3 left behind.

- [ ] **Step 5: Rename the private `simcon_dir` helper to `context_dir`** — the Rust **symbol** only; the directory string it builds stays literally `"simcon"` (scope decision 1, Architecture section). Before:

```rust
fn simcon_dir(app: &AppHandle) -> Result<PathBuf, CoreError> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| CoreError::Audio(format!("no app data dir: {e}")))?
        .join("simcon");
    fs::create_dir_all(&dir).map_err(|e| CoreError::Audio(e.to_string()))?;
    Ok(dir)
}
```

  After (only the fn name changes; the `.join("simcon")` string is untouched):

```rust
fn context_dir(app: &AppHandle) -> Result<PathBuf, CoreError> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| CoreError::Audio(format!("no app data dir: {e}")))?
        .join("simcon");
    fs::create_dir_all(&dir).map_err(|e| CoreError::Audio(e.to_string()))?;
    Ok(dir)
}
```

  Then update its 6 call sites via `sed` (safe whole-word rename of the fn name only):

```bash
sed -i 's/\bsimcon_dir(/context_dir(/g' src-tauri/src/context.rs
```

  (this rewrites the 1 definition + 6 call sites — inside `save`, `load`, `delete`, `list`, `doc_folder`, and `profiles_dir` — to the same new name in one pass.)

- [ ] **Step 6: Reword the `validate_id` error string** (cosmetic — internal validation message, not persisted anywhere). Before:

```rust
fn validate_id(id: &str) -> Result<(), CoreError> {
    // ids are generated by us, but never trust them as path components.
    if id.is_empty() || id.contains(['/', '\\', '.']) {
        return Err(CoreError::Audio("invalid simcon id".into()));
    }
    Ok(())
}
```

  After:

```rust
fn validate_id(id: &str) -> Result<(), CoreError> {
    // ids are generated by us, but never trust them as path components.
    if id.is_empty() || id.contains(['/', '\\', '.']) {
        return Err(CoreError::Audio("invalid context id".into()));
    }
    Ok(())
}
```

- [ ] **Step 7: Reword the remaining 7 prose "Sim Con"/"SimCon" doc-comment mentions.** Each is unique in the file — find-and-replace exactly:

  | Before | After |
  |---|---|
  | `/// Create or update a SimCon. An **empty \`id\`** mints a new record (assigns an` | `/// Create or update a Context. An **empty \`id\`** mints a new record (assigns an` |
  | `/// A filesystem-safe slug of a Sim Con title, for its document folder name.` | `/// A filesystem-safe slug of a Context's title, for its document folder name.` |
  | `/// The Sim Con's own document folder: \`<app-data>/simcon/<slug(title)>/\`, so a` | `/// The Context's own document folder: \`<app-data>/simcon/<slug(title)>/\`, so a` |
  | `/// rehearsal's source documents live together, named after it.` | *(unchanged — same line, no "SimCon" text on it)* |
  | `/// Copy documents added at setup into this Sim Con's folder and return their new` | `/// Copy documents added at setup into this Context's folder and return their new` |
  | `/// Build (or rebuild) the reusable \`KnowledgeProfile\` for a Sim Con from its` | `/// Build (or rebuild) the reusable \`KnowledgeProfile\` for a Context from its` |
  | `/// attached documents (already ingested in the RAG library) plus web research,` | *(unchanged — no "SimCon" text)* |
  | `/// then mark the session ready. Reuses the session's existing profile id if it` | *(unchanged — "session" here is generic English, not the type; leave as-is)* |
  | `/// has one, so re-preparing after an edit updates in place.` | *(unchanged)* |

  (Only 5 of the lines listed actually need a text change — `doc_folder`'s and `prepare`'s surrounding lines are shown for context so the edit locations are unambiguous; apply Edit only to the 5 "After" cells that differ from "Before".)

- [ ] **Step 8: Grep-confirm only the expected on-disk-compat string remains.**

```bash
grep -inE 'sim ?con' src-tauri/src/context.rs
```

  Expected: exactly 2 hits — the `.join("simcon")` literal inside `context_dir` and the doc-comment line documenting that decision from Step 2 (`` `<app-data>/simcon/` `` appears twice: once in the module doc, once in `doc_folder`'s doc comment — both intentional). Every other line must be `SimCon`-free (this includes confirming Step 4's fix landed — no `conva_core::simcon::` should remain).

- [ ] **Step 9: `cargo fmt --check`** on this file (or `cargo fmt` if the `sed` passes left minor spacing) — clean. No commit yet; Task 2.2 commits Phase 2 as one commit per the design spec's phasing.

### Task 2.2: `src-tauri/src/lib.rs` — module decl, imports, 13 commands + `generate_handler!`, metering keys, call sites

**Files:**
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Module declaration + import.** Before:

```rust
mod simcon;
```

  After (keep alphabetical position — `context` now sorts between `conversations` and `embed`):

```rust
mod context;
```

  Before:

```rust
use conva_core::simcon::{KnowledgeProfile, SimConSession, SimConSummary};
```

  After:

```rust
use conva_core::context::{ContextSummary, ConversationContext, KnowledgeProfile};
```

- [ ] **Step 2: Rename every `simcon::` module-path reference to `context::`, and every `conva_core::simcon::` to `conva_core::context::`, via `sed`** (safe — these are unambiguous path prefixes, and `lib.rs` has no unrelated string containing literal `simcon::`):

```bash
sed -i \
  -e 's/\bsimcon::/context::/g' \
  -e 's/conva_core::simcon::/conva_core::context::/g' \
  src-tauri/src/lib.rs
```

  This rewrites every one of: line 287 (`simcon::load`), 292 (`conva_core::simcon::performance_analysis_prompt`), 613/628 (`simcon::load`/`simcon::save` in `sync_context_doc`), 884/889/894/902 (the 4 simplest command bodies), 899 (`conva_core::simcon::DEFAULT_CONTEXT_ID`), 931/957/1003/1014 (`activate_context`'s body), 1056/1063/1070/1088/1093/1116/1159/1175–1176/1180/1184/1218/1222–1223/1228/1232/1265–1267 (`simcon_store_docs`/`simcon_prepare`/`simcon_load_profile`/`simcon_generate_dossier`'s body, including the `conva_core::simcon::knowledge_prompt`/`research_queries`/`research_findings_prompt`/`SimConCategory`/`qa_research_queries`/`interview_qa_prompt` calls — **note**: `SimConCategory` itself is a bare type token, not a `simcon::`-prefixed path segment on this one line; see Step 4 below), 1286/1294/1310/1312 (`simcon_generate_personas`), 1322/1324 (`simcon_choose_persona`), 1337/1349/1375 (`simcon_start_rehearsal`), 1439/1444 (`set_tavily_key`/`tavily_key_status`), 1634/1742 (`simcon::load_tavily_key`), 1923 (`simcon::ensure_default_context`).

- [ ] **Step 3: Rename the 13 `#[tauri::command] fn simcon_*` definitions to `context_*`, AND their `generate_handler!` entries, in the same step** — this is the pairing the design spec calls "the actual risk in this whole rename." All 13 pairs, verified exhaustively against both the function-definition list and the `generate_handler!` list read in full during planning:

  | # | Old fn name | New fn name | Old `generate_handler!` entry (line ~2044–2059) | New entry |
  |---|---|---|---|---|
  | 1 | `simcon_save` | `context_save` | `simcon_save,` | `context_save,` |
  | 2 | `simcon_list` | `context_list` | `simcon_list,` | `context_list,` |
  | 3 | `simcon_load` | `context_load` | `simcon_load,` | `context_load,` |
  | 4 | `simcon_delete` | `context_delete` | `simcon_delete,` | `context_delete,` |
  | 5 | `simcon_store_docs` | `context_store_docs` | `simcon_store_docs,` | `context_store_docs,` |
  | 6 | `simcon_prepare` | `context_prepare` | `simcon_prepare,` | `context_prepare,` |
  | 7 | `simcon_load_profile` | `context_load_profile` | `simcon_load_profile,` | `context_load_profile,` |
  | 8 | `simcon_generate_dossier` | `context_generate_dossier` | `simcon_generate_dossier,` | `context_generate_dossier,` |
  | 9 | `simcon_generate_personas` | `context_generate_personas` | `simcon_generate_personas,` | `context_generate_personas,` |
  | 10 | `simcon_choose_persona` | `context_choose_persona` | `simcon_choose_persona,` | `context_choose_persona,` |
  | 11 | `simcon_start_rehearsal` | `context_start_rehearsal` | `simcon_start_rehearsal,` | `context_start_rehearsal,` |
  | 12 | `simcon_rehearsal_your_turn` | `context_rehearsal_your_turn` | `simcon_rehearsal_your_turn,` | `context_rehearsal_your_turn,` |
  | 13 | `simcon_rehearsal_say` | `context_rehearsal_say` | `simcon_rehearsal_say,` | `context_rehearsal_say,` |

  Do the whole-word `sed` rename for all 13 in one pass — it rewrites both the `fn` definitions and the `generate_handler!` entries identically, guaranteeing the pairing stays exact:

```bash
sed -i \
  -e 's/\bsimcon_save\b/context_save/g' \
  -e 's/\bsimcon_list\b/context_list/g' \
  -e 's/\bsimcon_load\b/context_load/g' \
  -e 's/\bsimcon_delete\b/context_delete/g' \
  -e 's/\bsimcon_store_docs\b/context_store_docs/g' \
  -e 's/\bsimcon_prepare\b/context_prepare/g' \
  -e 's/\bsimcon_load_profile\b/context_load_profile/g' \
  -e 's/\bsimcon_generate_dossier\b/context_generate_dossier/g' \
  -e 's/\bsimcon_generate_personas\b/context_generate_personas/g' \
  -e 's/\bsimcon_choose_persona\b/context_choose_persona/g' \
  -e 's/\bsimcon_start_rehearsal\b/context_start_rehearsal/g' \
  -e 's/\bsimcon_rehearsal_your_turn\b/context_rehearsal_your_turn/g' \
  -e 's/\bsimcon_rehearsal_say\b/context_rehearsal_say/g' \
  src-tauri/src/lib.rs
```

  Note: `simcon_title` (the unrelated `SessionSummary` field read at `analyze_conversation`'s call site — none found in `lib.rs` actually, that field lives only in `session.rs`/`ConversationsPanel.tsx`) is **not** in this pattern list and is confirmed not present in `lib.rs`, so no collision risk.

- [ ] **Step 4: Rename the remaining bare `SimCon*` type tokens** not already covered by Steps 2–3's path-prefixed `sed` (the type appears bare, without a `simcon::`/`conva_core::simcon::` prefix, at 7 return-type/param-type positions plus 1 bare enum-variant reference):

```bash
sed -i \
  -e 's/\bSimConSession\b/ConversationContext/g' \
  -e 's/\bSimConSummary\b/ContextSummary/g' \
  -e 's/\bSimConCategory\b/ContextCategory/g' \
  src-tauri/src/lib.rs
```

  This rewrites: `use` line's `SimConSession`/`SimConSummary` (already done in Step 1's explicit edit — running this after Step 1 is idempotent, a no-op on that line since Step 1 already changed it), the 8 `Result<SimConSession, String>`/`Result<Vec<SimConSummary>, String>` return types across `context_save`/`context_list`/`context_load`/`activate_context`/`context_prepare`/`context_generate_dossier`/`context_generate_personas`/`context_choose_persona`, the `session: SimConSession` parameter in `context_save`, and the bare `conva_core::context::SimConCategory::Interview` comparison in Stage 3's gate (already rewritten by Step 2's `conva_core::simcon::` → `conva_core::context::` pass down to `conva_core::context::SimConCategory::Interview` — this pass finishes it to `conva_core::context::ContextCategory::Interview`).

- [ ] **Step 5: Rename the two metering-key string literals whose old spelling collides with nothing else** (`"simcon_knowledge"`, `"simcon_research_findings"`) plus the third (`"simcon_qa"`) inside `context_generate_dossier` (formerly `simcon_generate_dossier`). Three exact literal replacements — before/after each, with enough surrounding context to locate them uniquely (all three are inside the function Step 3 already renamed):

  5a. Before:

```rust
    metering::metered_stream(
        &app,
        "simcon_knowledge",
        &selection,
        &key,
        &request,
        &mut |t| buf.push_str(t),
    )
    .map_err(|e| e.to_string())?;
```

  After:

```rust
    metering::metered_stream(
        &app,
        "context_knowledge",
        &selection,
        &key,
        &request,
        &mut |t| buf.push_str(t),
    )
    .map_err(|e| e.to_string())?;
```

  5b. Before:

```rust
                let fresult = metering::metered_stream(
                    &app,
                    "simcon_research_findings",
                    &selection,
                    &key,
                    &request,
                    &mut |t| fbuf.push_str(t),
                );
```

  After:

```rust
                let fresult = metering::metered_stream(
                    &app,
                    "context_research_findings",
                    &selection,
                    &key,
                    &request,
                    &mut |t| fbuf.push_str(t),
                );
```

  5c. Before:

```rust
                let qa_result = metering::metered_stream(
                    &app,
                    "simcon_qa",
                    &selection,
                    &key,
                    &qa_request,
                    &mut |t| qa_buf.push_str(t),
                );
```

  After:

```rust
                let qa_result = metering::metered_stream(
                    &app,
                    "context_qa",
                    &selection,
                    &key,
                    &qa_request,
                    &mut |t| qa_buf.push_str(t),
                );
```

- [ ] **Step 6: Rename the fourth metering key** — `"simcon_personas"` inside `context_generate_personas` (formerly `simcon_generate_personas`). Before:

```rust
    metering::metered_stream(
        &app,
        "simcon_personas",
        &selection,
        &key,
        &request,
        &mut |t| buf.push_str(t),
    )
    .map_err(|e| e.to_string())?;
```

  After:

```rust
    metering::metered_stream(
        &app,
        "context_personas",
        &selection,
        &key,
        &request,
        &mut |t| buf.push_str(t),
    )
    .map_err(|e| e.to_string())?;
```

- [ ] **Step 7: Reword the remaining "Sim Con"/"SimCon" doc-comment/string-literal/comment prose mentions** left in the file (not already covered by Steps 1–6's mechanical passes; count in the original heading here was imprecise — treat the table below as the authoritative, complete list, not the number):

  | Before | After |
  |---|---|
  | `/// Create or update a SimCon (Simulated Conversation). An empty \`id\` mints a` | `/// Create or update a Context. An empty \`id\` mints a` |
  | `        return Err("The default context can't be deleted.".into());` | *(unchanged — already says "context", not "SimCon")* |
  | `/// Copy documents into a Sim Con's folder (named after its title); returns the` | `/// Copy documents into a Context's folder (named after its title); returns the` |
  | `/// Build the reusable KnowledgeProfile (attached docs + web research) and mark` | *(unchanged — no "SimCon" on this line)* |
  | `/// the Sim Con ready.` | `/// the Context ready.` |
  | `/// Load a Sim Con's KnowledgeProfile so the UI can show what grounds the` | `/// Load a Context's KnowledgeProfile so the UI can show what grounds the` |
  | `/// Generate Ally's grounding documents — the staged pipeline (spec` | *(unchanged)* |
  | `/// 2026-08-26). Stage 1 synthesizes the Sim Con's documents + role/JD into a` | `/// 2026-08-26). Stage 1 synthesizes the Context's documents + role/JD into a` |
  | `    // Broad grounding across this Sim Con's own knowledge base.` | `    // Broad grounding across this Context's own knowledge base.` |
  | `        .ok_or_else(\|\| "Prepare this Sim Con before generating a prep document.".to_string())?;` | `        .ok_or_else(\|\| "Prepare this Context before generating a prep document.".to_string())?;` |
  | `/// Generate 3 counterparty personas (Step 3) with the configured LLM, grounded` | *(unchanged)* |
  | `/// in the Sim Con's goal / type / job description. Overwrites any existing` | `/// in the Context's goal / type / job description. Overwrites any existing` |
  | `        .ok_or_else(\|\| "Prepare this Sim Con before starting the rehearsal.".to_string())?;` | `        .ok_or_else(\|\| "Prepare this Context before starting the rehearsal.".to_string())?;` |

  (The `// Broad grounding...` row is a plain `//` line comment, not a `///` doc comment like the rest — added post-write, found during execution; it sits between the two lines just above/below it in the table. The plan's own Step 9 grep-confirm below only checks the one-word `simcon`/`SimCon` spelling, not "Sim Con" with a space, so it can't catch a miss in this table on its own — the table itself must be exhaustive, which is why it's now marked authoritative above.)

  Apply each Edit individually — every "Before" cell is unique in the file.

- [ ] **Step 8: Rename the `simcon_title` **local variable** in `context_start_rehearsal`** (formerly `simcon_start_rehearsal`) — this is a local binding name, not the unrelated `SessionSummary.simcon_title` field (scope decision 2; that field stays untouched in `session.rs`). Before:

```rust
    let rag = state.rag.clone();
    let simcon_title = session.title.clone();
    let (reh_tx, reh_rx) = std::sync::mpsc::channel();
    let (session_id, stop_flag, force_end) = state
        .session
        .start_rehearsal(&app, &config, rag.clone(), reh_tx, simcon_title)
        .map_err(|e| e.to_string())?;
```

  After:

```rust
    let rag = state.rag.clone();
    let rehearsal_title = session.title.clone();
    let (reh_tx, reh_rx) = std::sync::mpsc::channel();
    let (session_id, stop_flag, force_end) = state
        .session
        .start_rehearsal(&app, &config, rag.clone(), reh_tx, rehearsal_title)
        .map_err(|e| e.to_string())?;
```

  (renamed to `rehearsal_title` rather than `context_title` — it's passed positionally into `SessionManager::start_rehearsal`'s existing `String` parameter, which itself is untouched per scope decision 2; `rehearsal_title` avoids implying it's the renamed `ConversationContext` type while still dropping the stale "simcon" name. `session` here refers to the loaded `ConversationContext` local from a few lines up in this same function — untouched per scope decision 3.)

- [ ] **Step 9: Grep-confirm the file is clean.**

```bash
grep -inE 'sim ?con' src-tauri/src/lib.rs
```

  Expected: no output.

- [ ] **Step 10: `cargo fmt --check`** on `lib.rs` (or `cargo fmt` if needed) — clean. No commit yet — Task 2.6 verifies + commits all of Phase 2 together.

### Task 2.3: `src-tauri/src/rehearsal.rs` — import path + `RehearsalContext` field types

**Files:**
- Modify: `src-tauri/src/rehearsal.rs`

> Found during investigation — not in the design spec's scope inventory, but required for the shell to compile (it imports `SimConSession`/`SimConPersona`/`persona_live_prompt` from `conva_core::simcon`).

- [ ] **Step 1: Reword the module doc comment's "Sim Con" prose.** Before:

```rust
//! Live Sim Con rehearsal (Phase E) — the turn-taking engine.
//!
//! The session layer runs mic-only capture + STT and feeds each finalized user
//! utterance here. This worker detects end-of-turn (a pause after the user
//! stops, or a manual "your turn"), asks the LLM to reply **in character** as
//! the chosen persona (grounded in the Sim Con's knowledge base), streams that
//! reply to the UI as inbound ("THEM") transcript segments, and speaks it with
//! Deepgram Aura. Then it listens again.
```

  After:

```rust
//! Live Context rehearsal (Phase E) — the turn-taking engine.
//!
//! The session layer runs mic-only capture + STT and feeds each finalized user
//! utterance here. This worker detects end-of-turn (a pause after the user
//! stops, or a manual "your turn"), asks the LLM to reply **in character** as
//! the chosen persona (grounded in the Context's knowledge base), streams that
//! reply to the UI as inbound ("THEM") transcript segments, and speaks it with
//! Deepgram Aura. Then it listens again.
```

- [ ] **Step 2: Update the import.** Before:

```rust
use conva_core::simcon::{persona_live_prompt, KnowledgeProfile, SimConPersona, SimConSession};
```

  After:

```rust
use conva_core::context::{persona_live_prompt, ContextPersona, ConversationContext, KnowledgeProfile};
```

- [ ] **Step 3: Rename the 2 field types in `RehearsalContext`.** Before:

```rust
/// Everything the worker needs that the session layer doesn't own.
pub struct RehearsalContext {
    pub selection: ModelSelection,
    pub llm_key: String,
    /// Deepgram key for Aura TTS; `None` → text-only rehearsal (no voice).
    pub tts_key: Option<String>,
    pub session: SimConSession,
    pub profile: KnowledgeProfile,
    pub persona: SimConPersona,
    /// Epoch-ms the session started — base for the transcript timeline so
    /// persona turns interleave correctly with the user's spoken turns.
    pub session_start_ms: u64,
}
```

  After (field **names** `session`/`persona` stay — scope decision 3; only their types change):

```rust
/// Everything the worker needs that the session layer doesn't own.
pub struct RehearsalContext {
    pub selection: ModelSelection,
    pub llm_key: String,
    /// Deepgram key for Aura TTS; `None` → text-only rehearsal (no voice).
    pub tts_key: Option<String>,
    pub session: ConversationContext,
    pub profile: KnowledgeProfile,
    pub persona: ContextPersona,
    /// Epoch-ms the session started — base for the transcript timeline so
    /// persona turns interleave correctly with the user's spoken turns.
    pub session_start_ms: u64,
}
```

> **Added post-write** (found during execution): Steps 1–3 above (module
> doc, import, struct fields) don't cover two plain `//` inline comments
> elsewhere in the file — same class of miss as Task 2.2's, since the
> original investigation scoped this file around what's needed for
> compilation, not an exhaustive prose sweep. New Step 4 below closes
> this; the old Step 4 (grep-confirm) is renumbered to Step 5.

- [ ] **Step 4: Reword the 2 remaining inline comments** in `ground_persona_response` (or whichever fn currently holds this — confirm by reading the file, it's the one building the query/chunks ahead of the `persona_live_prompt` call Step 3 already touches):

  Before:

```rust
    // Ground on the user's latest turn (fall back to the Sim Con's purpose so
    // the opening line still has context).
```

  After:

```rust
    // Ground on the user's latest turn (fall back to the Context's purpose so
    // the opening line still has context).
```

  Before:

```rust
        // Ground the persona on this Sim Con's own knowledge base.
```

  After:

```rust
        // Ground the persona on this Context's own knowledge base.
```

- [ ] **Step 5: Grep-confirm clean.**

```bash
grep -inE 'sim ?con' src-tauri/src/rehearsal.rs
```

  Expected: no output. (`persona_live_prompt`'s own internal `session`/`context` parameter naming was already handled in Phase 1, Task 1.2 Step 4b — this file only calls it positionally via `ctx.session`, so no further change is needed here beyond the import, struct field types, and the two comments above.)

- [ ] **Step 6: `cargo fmt --check`** — clean. No commit yet.

### Task 2.4: `src-tauri/src/web.rs` — import path + doc-comment prose

**Files:**
- Modify: `src-tauri/src/web.rs`

> Also found during investigation, also required for compilation (imports `ResearchSource` from `conva_core::simcon`).

- [ ] **Step 1: Reword the doc comment.** Before:

```rust
//! Shared web-search helper (Tavily). Used by Ally's `web_search` tool (the
//! model calls it only when it decides fresh/external info is needed). The
//! caller owns the key lookup and usage metering; this is just the HTTP call.
//!
//! NOTE: `simcon::research` still has its own bounded Tavily loop for Sim Con
//! knowledge-profile building; unifying the two onto this helper is a safe
//! follow-up once the Sim Con research path is confirmed on-device.
```

  After:

```rust
//! Shared web-search helper (Tavily). Used by Ally's `web_search` tool (the
//! model calls it only when it decides fresh/external info is needed). The
//! caller owns the key lookup and usage metering; this is just the HTTP call.
//!
//! NOTE: `context::research` still has its own bounded Tavily loop for
//! Context knowledge-profile building; unifying the two onto this helper is a
//! safe follow-up once the Context research path is confirmed on-device.
```

- [ ] **Step 2: Update the import.** Before:

```rust
use conva_core::simcon::ResearchSource;
```

  After:

```rust
use conva_core::context::ResearchSource;
```

- [ ] **Step 3: Grep-confirm clean.**

```bash
grep -inE 'sim ?con' src-tauri/src/web.rs
```

  Expected: no output.

- [ ] **Step 4: `cargo fmt --check`** — clean. No commit yet.

### Task 2.5: `src-tauri/src/session.rs` — one cosmetic comment fix (field itself out of scope)

**Files:**
- Modify: `src-tauri/src/session.rs`

> Scope decision 2 (Architecture section): `is_rehearsal`/`simcon_title` (the `SessionSummary` fields, and the `meta["simcon_title"]` JSON key they read/write) are **not renamed** — they're persisted JSONL session metadata outside the design spec's scope inventory, and renaming them would be a real behavior change (old session files use the `simcon_title` JSON key; a renamed reader would silently stop finding it). Only the one comment that names a Tauri command this plan *did* rename gets fixed, so it doesn't describe a function that no longer exists.

- [ ] **Step 1: Fix the stale command-name reference.** Before:

```rust
        // Clone before the move below — `rehearsal.rs`/`simcon_rehearsal_say`
        // use this to forward bypass segments (see `forward_to_capture`).
        *self.capture_forward.lock().expect("capture lock") = capture_tx.clone();
```

  After:

```rust
        // Clone before the move below — `rehearsal.rs`/`context_rehearsal_say`
        // use this to forward bypass segments (see `forward_to_capture`).
        *self.capture_forward.lock().expect("capture lock") = capture_tx.clone();
```

- [ ] **Step 2: Confirm nothing else in this file changes.**

```bash
git diff src-tauri/src/session.rs
```

  Expected: exactly the 1-line comment change above. `simcon_title`/`is_rehearsal` (the field definitions, their 2 struct-literal sites, and the `meta["simcon_title"]` reads/writes) must show **no** diff.

### Task 2.6: `src-tauri/src/metering.rs` — doc-comment feature-label list (cosmetic) + verify + commit Phase 2

**Files:**
- Modify: `src-tauri/src/metering.rs`

- [ ] **Step 1: Update the feature-label doc comment** to list the renamed keys (cosmetic — a doc comment, not code). Before:

```rust
//! Feature labels in use (stable snake_case, owned by the call sites):
//! `ally_suggest_reply` · `ally_summarize` · `ally_question` ·
//! `ally_card_summary` · `simcon_knowledge` · `simcon_research_findings` ·
//! `simcon_personas` · `rehearsal_persona` · `tracker` · `capture` ·
//! `faner_replay`. The Settings key "Test" ping is deliberately unmetered.
```

  After (also adding `context_qa` — the fourth key `context_generate_dossier`'s Stage 3 actually emits, per Task 2.2 Step 5c; it was missing from this doc-comment list even under its old `simcon_qa` name, a pre-existing gap this rename is a natural place to fix since the list is being touched anyway):

```rust
//! Feature labels in use (stable snake_case, owned by the call sites):
//! `ally_suggest_reply` · `ally_summarize` · `ally_question` ·
//! `ally_card_summary` · `context_knowledge` · `context_research_findings` ·
//! `context_qa` · `context_personas` · `rehearsal_persona` · `tracker` ·
//! `capture` · `faner_replay`. The Settings key "Test" ping is deliberately
//! unmetered.
```

- [ ] **Step 2: Manual cross-check — the highest-risk step in this phase.** For each of the 13 rows in Task 2.2 Step 3's table, run:

```bash
grep -n "fn context_save\b\|\"context_save,\"\|context_save,$" src-tauri/src/lib.rs
```

  (repeat for all 13 names, or more efficiently, run one combined check):

```bash
for cmd in save list load delete store_docs prepare load_profile generate_dossier \
           generate_personas choose_persona start_rehearsal rehearsal_your_turn rehearsal_say; do
  echo "=== context_$cmd ==="
  grep -n "fn context_$cmd\b" src-tauri/src/lib.rs
  grep -n "^\s*context_$cmd,\s*$" src-tauri/src/lib.rs
done
```

  Every one of the 13 must print exactly 2 lines (one `fn` definition, one `generate_handler!` entry). Any command printing 0 or 1 lines is a bug — stop and fix before proceeding.

- [ ] **Step 3: Full-tree grep for stragglers.**

```bash
grep -rinE 'sim ?con' src-tauri/src/*.rs
```

  Expected: the on-disk-compat lines confirmed in Task 2.1 Step 8 (`context.rs`'s `.join("simcon")` + its 2 doc-comment mentions), `session.rs`'s deliberately-untouched `simcon_title`/`is_rehearsal` lines (scope decision 2 — leave these), and — **found during execution, not in the plan as first written** — 4 more pure-prose doc-comment lines in 3 files nowhere else in this plan's scope: `conversations.rs`, `rag.rs`, `tts.rs`. None of the three import anything from `conva_core::context`/`conva_core::simcon` (zero compile risk), but they're real "Sim Con" mentions the plan's own Goal covers. Fixed in the next step rather than deferred, since Phase 2 is already touching `src-tauri` and this is the cheapest point to catch it.

- [ ] **Step 3b: Reword the 3 straggler files.**

  `src-tauri/src/conversations.rs` — before:

```rust
    /// The Sim Con context (if any) active while this conversation was
    /// recorded — captured at save time from live grounding state (spec
    /// 2026-08-26 part B). Never backfilled for older conversations.
```

  after:

```rust
    /// The Context (if any) active while this conversation was recorded —
    /// captured at save time from live grounding state (spec 2026-08-26
    /// part B). Never backfilled for older conversations.
```

  `src-tauri/src/rag.rs` — before:

```rust
    /// Like [`retrieve`], but restricted to a set of document ids (a Sim Con's
    /// KnowledgeProfile). An empty scope means "whole library" — so a Sim Con
    /// with no attached docs still grounds on everything available.
```

  after:

```rust
    /// Like [`retrieve`], but restricted to a set of document ids (a
    /// Context's KnowledgeProfile). An empty scope means "whole library" —
    /// so a Context with no attached docs still grounds on everything available.
```

  `src-tauri/src/tts.rs` — before:

```rust
//! Text-to-speech — Deepgram Aura (`/v1/speak`) synthesized to PCM and played
//! on the default output device via cpal. Used by the live Sim Con rehearsal
//! so the AI counterparty speaks its turns. Reuses the saved Deepgram key
```

  after:

```rust
//! Text-to-speech — Deepgram Aura (`/v1/speak`) synthesized to PCM and played
//! on the default output device via cpal. Used by the live Context rehearsal
//! so the AI counterparty speaks its turns. Reuses the saved Deepgram key
```

- [ ] **Step 3c: Re-run Step 3's grep — confirm now only the expected on-disk-compat + `session.rs` lines remain.**

```bash
grep -rinE 'sim ?con' src-tauri/src/*.rs
```

- [ ] **Step 4: `cargo fmt --check`** across the whole shell crate — clean (`cargo fmt` if any file needs reformatting from the `sed` passes).

- [ ] **Step 5: Commit all of Phase 2 together** (per the design spec's phasing — module rename + all 13 commands + `generate_handler!` + metering keys + the five unlisted-but-required sites, one commit):

```bash
git add src-tauri/src/context.rs src-tauri/src/lib.rs src-tauri/src/rehearsal.rs \
        src-tauri/src/web.rs src-tauri/src/session.rs src-tauri/src/metering.rs \
        src-tauri/src/conversations.rs src-tauri/src/rag.rs src-tauri/src/tts.rs
git commit -m "refactor(shell): rename SimCon commands/module to Context (src-tauri)"
```

(standard trailer.)

---

## Phase 3: TypeScript mirror (`ipc.ts`, `commands.ts`, backend adapters)

> This phase's `npm run build` gate is what actually proves Phase 2's renamed Tauri command strings agree with what the frontend invokes — nothing else compile-checks that agreement.

### Task 3.1: `src/lib/ipc.ts` — the 5 mirrored types

**Files:**
- Modify: `src/lib/ipc.ts`

- [ ] **Step 1: Rename the section header + the 5 types.** Before:

```ts
/* ── SimCon — Simulated Conversation (mirror of conva_core::simcon) ──────────
   A rehearsal of a high-stakes call: setup → knowledge profile (docs + bounded
   web research) → generated personas → real-time run. Persistence + pipeline
   land in the shell (Phase A.2). Keep these in lockstep with
   `crates/conva-core/src/simcon.rs`. */

/** Mirror of conva_core::simcon::DEFAULT_CONTEXT_ID — the reserved id of the
 * always-present "General conversation" default context (session-grounding's
 * "required selection" invariant). Not user-deletable. */
export const DEFAULT_CONTEXT_ID = "default";

/** The kind of conversation this context is for. Launch set (fixed but
 * extensible later); drives the setup template + web-research default. */
export type SimConCategory =
  | "interview"
  | "company_meeting"
  | "sales_call"
  | "other";

/** Lifecycle of a SimCon, start to finish. */
export type SimConStatus =
  | "draft"
  | "ingesting"
  | "ready"
  | "running"
  | "ended";

/** One generated counterparty persona/strategy option (3 per session). */
export interface SimConPersona {
  id: string;
  title: string;
  summary: string;
  style_tags: string[];
  recommended: boolean;
}
```

  After:

```ts
/* ── Context — Conversation Context (mirror of conva_core::context) ──────────
   A rehearsal of a high-stakes call: setup → knowledge profile (docs + bounded
   web research) → generated personas → real-time run. Persistence + pipeline
   land in the shell (Phase A.2). Keep these in lockstep with
   `crates/conva-core/src/context.rs`. */

/** Mirror of conva_core::context::DEFAULT_CONTEXT_ID — the reserved id of the
 * always-present "General conversation" default context (session-grounding's
 * "required selection" invariant). Not user-deletable. */
export const DEFAULT_CONTEXT_ID = "default";

/** The kind of conversation this context is for. Launch set (fixed but
 * extensible later); drives the setup template + web-research default. */
export type ContextCategory =
  | "interview"
  | "company_meeting"
  | "sales_call"
  | "other";

/** Lifecycle of a Context, start to finish. */
export type ContextStatus =
  | "draft"
  | "ingesting"
  | "ready"
  | "running"
  | "ended";

/** One generated counterparty persona/strategy option (3 per context). */
export interface ContextPersona {
  id: string;
  title: string;
  summary: string;
  style_tags: string[];
  recommended: boolean;
}
```

- [ ] **Step 2: Rename `SimConSession` → `ConversationContext` (its own type + every internal reference to the other 2 renamed types) and `SimConSummary` → `ContextSummary`.** Before:

```ts
/** The reusable, indexed knowledge base for a SimCon (library docs + web
 *  research). Reusable across future SimCons and live calls, by id. */
export interface KnowledgeProfile {
  id: string;
  title: string;
  created_at_unix_ms: number;
  updated_at_unix_ms: number;
  doc_ids: string[];
  research: ResearchSource[];
  ready: boolean;
}

/** One simulated-conversation record: Step 1 setup through Step 4 run. */
export interface SimConSession {
  id: string;
  title: string;
  purpose: string;
  /** For interviews: the target role's job description (Step 1). */
  job_description: string | null;
  category: SimConCategory;
  status: SimConStatus;
  created_at_unix_ms: number;
  updated_at_unix_ms: number;
  /** Library docs attached at setup (Path A) — RagDocument ids. */
  source_doc_ids: string[];
  /** Whether Ally should auto-generate context (Path B) during ingest. */
  auto_generate_context: boolean;
  /** Whether web research runs during prep — defaults from the type template,
   * user-overridable (decision 2 — research gated by type). */
  research_enabled?: boolean;
  /** User-declared key terms/points — first-class highlight terms (Phase 3c). */
  key_terms?: string[];
  /** Glossary terms extracted from the generated digest (backend-derived). */
  glossary?: string[];
  /** Definition text captured alongside each surviving glossary term
   * (keyed by the exact term string in `glossary`) — empty/absent for
   * terms mined without a written definition. */
  glossary_definitions?: Record<string, string>;
  knowledge_profile_id: string | null;
  personas: SimConPersona[];
  chosen_persona_id: string | null;
  conversation_id: string | null;
  /** RagDocument id of the Ally-generated prep briefing, once generated. */
  dossier_doc_id: string | null;
  /** RagDocument id of the Stage-2 Research findings document, once
   * generated (replaced on regeneration, like the knowledge doc). */
  research_doc_id?: string | null;
  /** Opt-in deep interview Q&A research (Interview category only) —
   * costs meaningfully more searches/tokens than default research. */
  deep_qa_enabled?: boolean;
  /** RagDocument id of the generated Interview Q&A document, once
   * generated (replaced on regeneration). */
  qa_doc_id?: string | null;
  /** True when grounding inputs changed after resources were generated —
   * the digest/glossary no longer reflect the inputs (cleared by a
   * successful regeneration). Optional: older records omit it. */
  resources_stale?: boolean;
}

/** Catalog entry for the SimCon list view. */
/** Catalog entry for the Contexts list — carries enough to render the
 * readiness checklist without loading the full session per row. */
export interface SimConSummary {
  id: string;
  title: string;
  category: SimConCategory;
  status: SimConStatus;
  created_at_unix_ms: number;
  updated_at_unix_ms: number;
  source_doc_count: number;
  has_key_terms: boolean;
  research_enabled: boolean;
  has_job_description: boolean;
  has_generated_resources: boolean;
  /** Mirrors SimConSession.resources_stale for the list row's pill. */
  resources_stale?: boolean;
}
```

  After:

```ts
/** The reusable, indexed knowledge base for a Context (library docs + web
 *  research). Reusable across future Contexts and live calls, by id. */
export interface KnowledgeProfile {
  id: string;
  title: string;
  created_at_unix_ms: number;
  updated_at_unix_ms: number;
  doc_ids: string[];
  research: ResearchSource[];
  ready: boolean;
}

/** One Conversation Context record: Step 1 setup through Step 4 run. */
export interface ConversationContext {
  id: string;
  title: string;
  purpose: string;
  /** For interviews: the target role's job description (Step 1). */
  job_description: string | null;
  category: ContextCategory;
  status: ContextStatus;
  created_at_unix_ms: number;
  updated_at_unix_ms: number;
  /** Library docs attached at setup (Path A) — RagDocument ids. */
  source_doc_ids: string[];
  /** Whether Ally should auto-generate context (Path B) during ingest. */
  auto_generate_context: boolean;
  /** Whether web research runs during prep — defaults from the type template,
   * user-overridable (decision 2 — research gated by type). */
  research_enabled?: boolean;
  /** User-declared key terms/points — first-class highlight terms (Phase 3c). */
  key_terms?: string[];
  /** Glossary terms extracted from the generated digest (backend-derived). */
  glossary?: string[];
  /** Definition text captured alongside each surviving glossary term
   * (keyed by the exact term string in `glossary`) — empty/absent for
   * terms mined without a written definition. */
  glossary_definitions?: Record<string, string>;
  knowledge_profile_id: string | null;
  personas: ContextPersona[];
  chosen_persona_id: string | null;
  conversation_id: string | null;
  /** RagDocument id of the Ally-generated prep briefing, once generated. */
  dossier_doc_id: string | null;
  /** RagDocument id of the Stage-2 Research findings document, once
   * generated (replaced on regeneration, like the knowledge doc). */
  research_doc_id?: string | null;
  /** Opt-in deep interview Q&A research (Interview category only) —
   * costs meaningfully more searches/tokens than default research. */
  deep_qa_enabled?: boolean;
  /** RagDocument id of the generated Interview Q&A document, once
   * generated (replaced on regeneration). */
  qa_doc_id?: string | null;
  /** True when grounding inputs changed after resources were generated —
   * the digest/glossary no longer reflect the inputs (cleared by a
   * successful regeneration). Optional: older records omit it. */
  resources_stale?: boolean;
}

/** Catalog entry for the Contexts list — carries enough to render the
 * readiness checklist without loading the full session per row. */
export interface ContextSummary {
  id: string;
  title: string;
  category: ContextCategory;
  status: ContextStatus;
  created_at_unix_ms: number;
  updated_at_unix_ms: number;
  source_doc_count: number;
  has_key_terms: boolean;
  research_enabled: boolean;
  has_job_description: boolean;
  has_generated_resources: boolean;
  /** Mirrors ConversationContext.resources_stale for the list row's pill. */
  resources_stale?: boolean;
}
```

  (the duplicate `/** Catalog entry for the SimCon list view. */` line directly above the real doc comment was dead leftover in the original file — dropped as part of this edit, not carried forward.)

> **Added post-write** (found during execution): two more sites in this file need prose fixes, neither covered by Steps 1–2 above or by any other task in this plan. New Step 3 below closes both; the old Step 3 (grep-confirm) is renumbered to Step 4, and its "expected: no output" is corrected — it was factually wrong even before this fix, since `SessionSummary.simcon_title`'s **field name** is deliberately kept (scope decision 2, mirroring the Rust struct's on-disk-compat field) and was always going to make that grep non-empty.

- [ ] **Step 3: Reword the `RehearsalStateEvent` doc comment and the `SessionSummary` mirror's two prose lines — keep `simcon_title`'s field name.** Before:

```ts
/** Live Sim Con rehearsal phase — drives the speaking/active-speaker UI. */
export type RehearsalStateEvent =
```

  After:

```ts
/** Live Context rehearsal phase — drives the speaking/active-speaker UI. */
export type RehearsalStateEvent =
```

  Before:

```ts
  /** True when this session was a Sim Con rehearsal. */
  is_rehearsal: boolean;
  /** The Sim Con title, when this was a rehearsal. */
  simcon_title: string | null;
```

  After (only the two doc comments change — `simcon_title`'s name is untouched, mirroring `session.rs`'s `SessionSummary.simcon_title` field kept for on-disk JSONL compat, scope decision 2):

```ts
  /** True when this session was a Context rehearsal. */
  is_rehearsal: boolean;
  /** The context's title, when this was a rehearsal. */
  simcon_title: string | null;
```

- [ ] **Step 4: Grep-confirm.**

```bash
grep -inE 'sim ?con' src/lib/ipc.ts
```

  Expected: exactly 1 hit — `simcon_title: string | null;` (the deliberately-preserved field name, scope decision 2). Nothing else.

- [ ] **Step 5: `npx tsc --noEmit`** (or `npm run build`, but that also builds the rest of the app which isn't done until Task 3.3 — a plain typecheck is faster here and will show every downstream file this task's rename breaks, which Tasks 3.2–3.3 then fix): expect many errors (every file importing `SimConSession`/`SimConCategory`/etc. now fails) — this is expected mid-phase; Task 3.4 is the real green gate.

### Task 3.2: `src/lib/commands.ts` — wrapped command functions + `invoke` strings

**Files:**
- Modify: `src/lib/commands.ts`

- [ ] **Step 1: Update the type import.** Before:

```ts
import type {
  AppConfig,
  AllyKind,
  AudioDevice,
  AuthStatus,
  Capture,
  Conversation,
  ConversationSummary,
  KnowledgeProfile,
  SimConSession,
  SimConSummary,
  IngestReport,
```

  After:

```ts
import type {
  AppConfig,
  AllyKind,
  AudioDevice,
  AuthStatus,
  Capture,
  Conversation,
  ConversationSummary,
  ContextSummary,
  ConversationContext,
  KnowledgeProfile,
  IngestReport,
```

- [ ] **Step 2: Update the `ragAttachContext` doc-comment reference.** Before:

```ts
/** Tag a library document as grounding a Conversation Context (drag-attach).
 *  Also fold `contextId` into the context's own `source_doc_ids` via
 *  `simconSave` — this only updates the library-side tag/badge. */
```

  After:

```ts
/** Tag a library document as grounding a Conversation Context (drag-attach).
 *  Also fold `contextId` into the context's own `source_doc_ids` via
 *  `contextSave` — this only updates the library-side tag/badge. */
```

- [ ] **Step 3: Rename the section header + the 4 simplest wrapper functions.** Before:

```ts
/* ── SimCon (Simulated Conversation) ── */

/** Create or update a SimCon. An empty `id` mints a new record. */
export function simconSave(session: SimConSession): Promise<SimConSession> {
  return invoke<SimConSession>("simcon_save", { session });
}

export function simconList(): Promise<SimConSummary[]> {
  return invoke<SimConSummary[]>("simcon_list");
}

export function simconLoad(id: string): Promise<SimConSession> {
  return invoke<SimConSession>("simcon_load", { id });
}

export function simconDelete(id: string): Promise<void> {
  return invoke("simcon_delete", { id });
}

/** Ground the next live session in this context (session grounding): fills
 *  the same highlight-term + retrieval scopes rehearsal already sets. Takes
 *  effect immediately; cleared by `deactivateContext` or stopping a session. */
export function activateContext(id: string): Promise<SimConSession> {
  return invoke<SimConSession>("activate_context", { id });
}

/** Clear the active conversation context without stopping a session. */
export function deactivateContext(): Promise<void> {
  return invoke("deactivate_context");
}

/** Copy documents into a Sim Con's folder (named after its title); returns the
 *  new in-folder paths to ingest into the RAG library. */
export function simconStoreDocs(
  title: string,
  paths: string[],
): Promise<string[]> {
  return invoke<string[]>("simcon_store_docs", { title, paths });
}

/** Build the reusable KnowledgeProfile (docs + research) and mark the Sim Con
 *  ready; returns the updated session. */
export function simconPrepare(id: string): Promise<SimConSession> {
  return invoke<SimConSession>("simcon_prepare", { id });
}

/** Load a Sim Con's knowledge base (attached docs + researched sources). */
export function simconLoadProfile(profileId: string): Promise<KnowledgeProfile> {
  return invoke<KnowledgeProfile>("simcon_load_profile", { profileId });
}

/** Generate the Ally prep dossier (saved to the library); returns the session. */
export function simconGenerateDossier(id: string): Promise<SimConSession> {
  return invoke<SimConSession>("simcon_generate_dossier", { id });
}

/** Reconstruct a library document's text (e.g. to show the prep dossier). */
export function ragDocumentText(id: string): Promise<string | null> {
  return invoke<string | null>("rag_document_text", { id });
}

/** Generate 3 counterparty personas with the configured LLM. */
export function simconGeneratePersonas(id: string): Promise<SimConSession> {
  return invoke<SimConSession>("simcon_generate_personas", { id });
}

/** Record the chosen persona. */
export function simconChoosePersona(
  id: string,
  personaId: string,
): Promise<SimConSession> {
  return invoke<SimConSession>("simcon_choose_persona", { id, personaId });
}

/** Start a live rehearsal (mic → persona LLM → Aura TTS). Returns session id. */
export function simconStartRehearsal(id: string): Promise<string> {
  return invoke<string>("simcon_start_rehearsal", { id });
}

/** End the user's current rehearsal turn now (manual "your turn"). */
export function simconRehearsalYourTurn(): Promise<void> {
  return invoke("simcon_rehearsal_your_turn");
}

/** Inject a typed turn (e.g. an Ally-suggested answer) as the user's turn. */
export function simconRehearsalSay(text: string): Promise<void> {
  return invoke("simcon_rehearsal_say", { text });
}
```

  After:

```ts
/* ── Context (Conversation Context) ── */

/** Create or update a Context. An empty `id` mints a new record. */
export function contextSave(context: ConversationContext): Promise<ConversationContext> {
  return invoke<ConversationContext>("context_save", { session: context });
}

export function contextList(): Promise<ContextSummary[]> {
  return invoke<ContextSummary[]>("context_list");
}

export function contextLoad(id: string): Promise<ConversationContext> {
  return invoke<ConversationContext>("context_load", { id });
}

export function contextDelete(id: string): Promise<void> {
  return invoke("context_delete", { id });
}

/** Ground the next live session in this context (session grounding): fills
 *  the same highlight-term + retrieval scopes rehearsal already sets. Takes
 *  effect immediately; cleared by `deactivateContext` or stopping a session. */
export function activateContext(id: string): Promise<ConversationContext> {
  return invoke<ConversationContext>("activate_context", { id });
}

/** Clear the active conversation context without stopping a session. */
export function deactivateContext(): Promise<void> {
  return invoke("deactivate_context");
}

/** Copy documents into a Context's folder (named after its title); returns the
 *  new in-folder paths to ingest into the RAG library. */
export function contextStoreDocs(
  title: string,
  paths: string[],
): Promise<string[]> {
  return invoke<string[]>("context_store_docs", { title, paths });
}

/** Build the reusable KnowledgeProfile (docs + research) and mark the Context
 *  ready; returns the updated record. */
export function contextPrepare(id: string): Promise<ConversationContext> {
  return invoke<ConversationContext>("context_prepare", { id });
}

/** Load a Context's knowledge base (attached docs + researched sources). */
export function contextLoadProfile(profileId: string): Promise<KnowledgeProfile> {
  return invoke<KnowledgeProfile>("context_load_profile", { profileId });
}

/** Generate the Ally prep dossier (saved to the library); returns the record. */
export function contextGenerateDossier(id: string): Promise<ConversationContext> {
  return invoke<ConversationContext>("context_generate_dossier", { id });
}

/** Reconstruct a library document's text (e.g. to show the prep dossier). */
export function ragDocumentText(id: string): Promise<string | null> {
  return invoke<string | null>("rag_document_text", { id });
}

/** Generate 3 counterparty personas with the configured LLM. */
export function contextGeneratePersonas(id: string): Promise<ConversationContext> {
  return invoke<ConversationContext>("context_generate_personas", { id });
}

/** Record the chosen persona. */
export function contextChoosePersona(
  id: string,
  personaId: string,
): Promise<ConversationContext> {
  return invoke<ConversationContext>("context_choose_persona", { id, personaId });
}

/** Start a live rehearsal (mic → persona LLM → Aura TTS). Returns session id. */
export function contextStartRehearsal(id: string): Promise<string> {
  return invoke<string>("context_start_rehearsal", { id });
}

/** End the user's current rehearsal turn now (manual "your turn"). */
export function contextRehearsalYourTurn(): Promise<void> {
  return invoke("context_rehearsal_your_turn");
}

/** Inject a typed turn (e.g. an Ally-suggested answer) as the user's turn. */
export function contextRehearsalSay(text: string): Promise<void> {
  return invoke("context_rehearsal_say", { text });
}
```

  Note on `contextSave`: the Rust command's parameter is still named `session` (`fn context_save(app: AppHandle, session: ConversationContext, ...)` — Tauri's `invoke` payload keys must match the Rust command's parameter names exactly, and Phase 2 deliberately did **not** rename that Rust parameter, scope decision 3), so the JS wrapper must still send the key `session`, even though its own local parameter/variable is renamed to `context` for readability. This is the one spot where the JS-side rename and the Rust-side parameter name diverge on purpose — get the `invoke` payload key wrong and this command fails at runtime, not compile time.

- [ ] **Step 4: Grep-confirm.**

```bash
grep -inE 'sim ?con' src/lib/commands.ts
```

  Expected: no output.

### Task 3.3: `src/lib/backend/ConvaBackend.ts`, `tauri.ts`, `web.ts` — the `simcon` namespace → `context`

**Files:**
- Modify: `src/lib/backend/ConvaBackend.ts`
- Modify: `src/lib/backend/tauri.ts`
- Modify: `src/lib/backend/web.ts`

- [ ] **Step 1: `ConvaBackend.ts` — type import.** Before:

```ts
import type {
  AllyKind,
  AppConfig,
  AudioDevice,
  AuthStatus,
  Conversation,
  ConversationSummary,
  KnowledgeProfile,
  SimConSession,
  SimConSummary,
  IngestReport,
```

  After:

```ts
import type {
  AllyKind,
  AppConfig,
  AudioDevice,
  AuthStatus,
  Conversation,
  ConversationSummary,
  ContextSummary,
  ConversationContext,
  KnowledgeProfile,
  IngestReport,
```

- [ ] **Step 2: `ConvaBackend.ts` — the `simcon` interface member.** Before:

```ts
  /** SimCon — Simulated Conversation records. Local on desktop; cloud on web. */
  simcon: {
    /** Create or update; an empty `id` mints a new record. */
    save(session: SimConSession): Promise<SimConSession>;
    list(): Promise<SimConSummary[]>;
    load(id: string): Promise<SimConSession>;
    delete(id: string): Promise<void>;
    /** Ground the next live session in this context (highlight terms +
     *  retrieval scope). Takes effect immediately. */
    activateContext(id: string): Promise<SimConSession>;
    /** Clear the active context without stopping a session. */
    deactivateContext(): Promise<void>;
    /** Copy documents into this Sim Con's folder; returns paths to ingest. */
    storeDocs(title: string, paths: string[]): Promise<string[]>;
    /** Build the reusable knowledge profile (docs + research) and mark ready. */
    prepare(id: string): Promise<SimConSession>;
    /** Load a knowledge profile (attached docs + researched sources) by id. */
    loadProfile(profileId: string): Promise<KnowledgeProfile>;
    /** Generate the Ally prep dossier (saved to the library). */
    generateDossier(id: string): Promise<SimConSession>;
    /** Generate 3 counterparty personas with the LLM. */
    generatePersonas(id: string): Promise<SimConSession>;
    /** Record the persona the user will rehearse against. */
    choosePersona(id: string, personaId: string): Promise<SimConSession>;
    /** Start a live rehearsal (mic → persona LLM → Aura TTS). Returns session id. */
    startRehearsal(id: string): Promise<string>;
    /** End the user's current rehearsal turn now (manual "your turn"). */
    rehearsalYourTurn(): Promise<void>;
    /** Inject a typed turn (e.g. an Ally-suggested answer) as the user's turn. */
    rehearsalSay(text: string): Promise<void>;
    /** Store (empty clears) the Tavily web-research key. */
    setResearchKey(key: string): Promise<void>;
    /** Whether a web-research key is configured. */
    researchKeyStatus(): Promise<boolean>;
  };
```

  After:

```ts
  /** Context — Conversation Context records. Local on desktop; cloud on web. */
  context: {
    /** Create or update; an empty `id` mints a new record. */
    save(context: ConversationContext): Promise<ConversationContext>;
    list(): Promise<ContextSummary[]>;
    load(id: string): Promise<ConversationContext>;
    delete(id: string): Promise<void>;
    /** Ground the next live session in this context (highlight terms +
     *  retrieval scope). Takes effect immediately. */
    activateContext(id: string): Promise<ConversationContext>;
    /** Clear the active context without stopping a session. */
    deactivateContext(): Promise<void>;
    /** Copy documents into this Context's folder; returns paths to ingest. */
    storeDocs(title: string, paths: string[]): Promise<string[]>;
    /** Build the reusable knowledge profile (docs + research) and mark ready. */
    prepare(id: string): Promise<ConversationContext>;
    /** Load a knowledge profile (attached docs + researched sources) by id. */
    loadProfile(profileId: string): Promise<KnowledgeProfile>;
    /** Generate the Ally prep dossier (saved to the library). */
    generateDossier(id: string): Promise<ConversationContext>;
    /** Generate 3 counterparty personas with the LLM. */
    generatePersonas(id: string): Promise<ConversationContext>;
    /** Record the persona the user will rehearse against. */
    choosePersona(id: string, personaId: string): Promise<ConversationContext>;
    /** Start a live rehearsal (mic → persona LLM → Aura TTS). Returns session id. */
    startRehearsal(id: string): Promise<string>;
    /** End the user's current rehearsal turn now (manual "your turn"). */
    rehearsalYourTurn(): Promise<void>;
    /** Inject a typed turn (e.g. an Ally-suggested answer) as the user's turn. */
    rehearsalSay(text: string): Promise<void>;
    /** Store (empty clears) the Tavily web-research key. */
    setResearchKey(key: string): Promise<void>;
    /** Whether a web-research key is configured. */
    researchKeyStatus(): Promise<boolean>;
  };
```

- [ ] **Step 3: `tauri.ts` — the adapter object.** Before:

```ts
  simcon = {
    save: cmd.simconSave,
    list: cmd.simconList,
    load: cmd.simconLoad,
    delete: cmd.simconDelete,
    activateContext: cmd.activateContext,
    deactivateContext: cmd.deactivateContext,
    storeDocs: cmd.simconStoreDocs,
    prepare: cmd.simconPrepare,
    loadProfile: cmd.simconLoadProfile,
    generateDossier: cmd.simconGenerateDossier,
    generatePersonas: cmd.simconGeneratePersonas,
    choosePersona: cmd.simconChoosePersona,
    startRehearsal: cmd.simconStartRehearsal,
    rehearsalYourTurn: cmd.simconRehearsalYourTurn,
    rehearsalSay: cmd.simconRehearsalSay,
    setResearchKey: cmd.setTavilyKey,
    researchKeyStatus: cmd.tavilyKeyStatus,
  };
```

  After:

```ts
  context = {
    save: cmd.contextSave,
    list: cmd.contextList,
    load: cmd.contextLoad,
    delete: cmd.contextDelete,
    activateContext: cmd.activateContext,
    deactivateContext: cmd.deactivateContext,
    storeDocs: cmd.contextStoreDocs,
    prepare: cmd.contextPrepare,
    loadProfile: cmd.contextLoadProfile,
    generateDossier: cmd.contextGenerateDossier,
    generatePersonas: cmd.contextGeneratePersonas,
    choosePersona: cmd.contextChoosePersona,
    startRehearsal: cmd.contextStartRehearsal,
    rehearsalYourTurn: cmd.contextRehearsalYourTurn,
    rehearsalSay: cmd.contextRehearsalSay,
    setResearchKey: cmd.setTavilyKey,
    researchKeyStatus: cmd.tavilyKeyStatus,
  };
```

- [ ] **Step 4: `web.ts` — type import.** Before:

```ts
import type {
```

  (find the block containing `SimConSession, SimConSummary,` — same shape as Steps 1a of this task) and change:

```ts
  SimConSession,
  SimConSummary,
```

  to:

```ts
  ConversationContext,
  ContextSummary,
```

  keeping the rest of that `import type { ... }` block's other names untouched.

- [ ] **Step 5: `web.ts` — the stub adapter object.** Before:

```ts
  simcon = {
    save: (): Promise<SimConSession> => todo("POST /v1/simcon"),
    list: (): Promise<SimConSummary[]> => todo("GET /v1/simcon"),
    load: (): Promise<SimConSession> => todo("GET /v1/simcon/:id"),
    delete: (): Promise<void> => todo("DELETE /v1/simcon/:id"),
    activateContext: (): Promise<SimConSession> =>
      unsupported("simcon.activateContext (desktop session)"),
    deactivateContext: (): Promise<void> =>
      unsupported("simcon.deactivateContext (desktop session)"),
    storeDocs: (): Promise<string[]> =>
      unsupported("simcon.storeDocs (local file paths)"),
    prepare: (): Promise<SimConSession> => todo("POST /v1/simcon/:id/prepare"),
    loadProfile: (): Promise<KnowledgeProfile> =>
      todo("GET /v1/simcon/profiles/:id"),
    generateDossier: (): Promise<SimConSession> =>
      todo("POST /v1/simcon/:id/dossier"),
    generatePersonas: (): Promise<SimConSession> =>
      todo("POST /v1/simcon/:id/personas"),
    choosePersona: (): Promise<SimConSession> =>
      todo("PATCH /v1/simcon/:id/persona"),
    startRehearsal: (): Promise<string> =>
      unsupported("simcon.startRehearsal (desktop audio)"),
    rehearsalYourTurn: (): Promise<void> =>
      unsupported("simcon.rehearsalYourTurn (desktop audio)"),
    rehearsalSay: (): Promise<void> =>
      unsupported("simcon.rehearsalSay (desktop audio)"),
    setResearchKey: (): Promise<void> =>
      unsupported("simcon.setResearchKey (server-side on web)"),
    researchKeyStatus: () => Promise.resolve(false),
  };
```

  After:

```ts
  context = {
    save: (): Promise<ConversationContext> => todo("POST /v1/contexts"),
    list: (): Promise<ContextSummary[]> => todo("GET /v1/contexts"),
    load: (): Promise<ConversationContext> => todo("GET /v1/contexts/:id"),
    delete: (): Promise<void> => todo("DELETE /v1/contexts/:id"),
    activateContext: (): Promise<ConversationContext> =>
      unsupported("context.activateContext (desktop session)"),
    deactivateContext: (): Promise<void> =>
      unsupported("context.deactivateContext (desktop session)"),
    storeDocs: (): Promise<string[]> =>
      unsupported("context.storeDocs (local file paths)"),
    prepare: (): Promise<ConversationContext> => todo("POST /v1/contexts/:id/prepare"),
    loadProfile: (): Promise<KnowledgeProfile> =>
      todo("GET /v1/contexts/profiles/:id"),
    generateDossier: (): Promise<ConversationContext> =>
      todo("POST /v1/contexts/:id/dossier"),
    generatePersonas: (): Promise<ConversationContext> =>
      todo("POST /v1/contexts/:id/personas"),
    choosePersona: (): Promise<ConversationContext> =>
      todo("PATCH /v1/contexts/:id/persona"),
    startRehearsal: (): Promise<string> =>
      unsupported("context.startRehearsal (desktop audio)"),
    rehearsalYourTurn: (): Promise<void> =>
      unsupported("context.rehearsalYourTurn (desktop audio)"),
    rehearsalSay: (): Promise<void> =>
      unsupported("context.rehearsalSay (desktop audio)"),
    setResearchKey: (): Promise<void> =>
      unsupported("context.setResearchKey (server-side on web)"),
    researchKeyStatus: () => Promise.resolve(false),
  };
```

  Note: the REST paths change from `/v1/simcon...` to `/v1/contexts...` here — these are unimplemented `todo()`/`unsupported()` stubs (the web backend has no real HTTP calls yet), so this is a safe, harmless rename with zero runtime effect today, and keeps the stub's shape consistent with what a real endpoint will eventually be named rather than leaving a stale `simcon` path baked into placeholder text.

- [ ] **Step 6: Grep-confirm all three files.**

```bash
grep -inE 'sim ?con' src/lib/backend/ConvaBackend.ts src/lib/backend/tauri.ts src/lib/backend/web.ts
```

  Expected: no output.

### Task 3.4: Verify (`npm run build`) + commit Phase 3

**Files:** none new (verification + commit of Tasks 3.1–3.3's changes).

- [ ] **Step 1: Typecheck + build.** Run: `npm run build` — expect many errors still (every component under `src/components/simcon/` and everywhere else importing `SimCon*` types/`backend.simcon` hasn't been updated yet — Phase 4 does that). Confirm the errors are now **only** in `src/components/**` and the `src/state/**` files Phase 4 will touch, not in `src/lib/**` (which this phase just finished) — if `src/lib/**` itself still errors, fix it before proceeding.
- [ ] **Step 2: Commit.**

```bash
git add src/lib/ipc.ts src/lib/commands.ts src/lib/backend/ConvaBackend.ts \
        src/lib/backend/tauri.ts src/lib/backend/web.ts
git commit -m "refactor(ts): rename SimCon types/namespace to Context (lib/ipc, commands, backend)"
```

(standard trailer.)

---

## Phase 4: Component/file renames + importers + leftover UI copy

### Task 4.1: `src/components/simcon/` → `src/components/context/` — file renames + internal content

**Files:**
- Rename: `src/components/simcon/` → `src/components/context/` (directory)
- Rename: `src/components/context/SimConSetup.tsx` → `ContextSetup.tsx`
- Rename: `src/components/context/SimConDetail.tsx` → `ContextDetail.tsx`
- Rename: `src/components/context/SimConSetup.test.tsx` → `ContextSetup.test.tsx`
- Modify (moved, not renamed): `src/components/context/RehearsalBar.tsx`, `src/components/context/documentSplit.ts`, `src/components/context/documentSplit.test.ts`

- [ ] **Step 1: Move the whole directory, then rename the 3 `SimCon*`-named files inside it.**

```bash
git mv src/components/simcon src/components/context
git mv src/components/context/SimConSetup.tsx src/components/context/ContextSetup.tsx
git mv src/components/context/SimConDetail.tsx src/components/context/ContextDetail.tsx
git mv src/components/context/SimConSetup.test.tsx src/components/context/ContextSetup.test.tsx
```

- [ ] **Step 2: `documentSplit.ts` / `documentSplit.test.ts` — fix the self-import path** (only the directory moved under it; the files themselves aren't renamed, but `documentSplit.test.ts` imports itself by absolute path). Before (in `documentSplit.test.ts`):

```ts
import { splitDocuments } from "@/components/simcon/documentSplit";
```

  After:

```ts
import { splitDocuments } from "@/components/context/documentSplit";
```

  (`documentSplit.ts` itself has no self-referential import to fix — confirmed by its content, which only imports `RagDocument` from `@/lib/ipc`.)

- [ ] **Step 3: `ContextSetup.tsx` (formerly `SimConSetup.tsx`) — imports, types, copy.** Before:

```tsx
import { Section, ViewShell } from "@/components/studio/ViewShell";
import { Icon } from "@/components/ui/Icon";
import { useBackend } from "@/lib/backend";
import { useCapabilities } from "@/lib/backend/context";
import { splitDocuments } from "@/components/simcon/documentSplit";
import type { RagDocument, SimConCategory, SimConSession } from "@/lib/ipc";
import { isDesktop } from "@/lib/platform";

// Mirrors conva_core::simcon templates. `research` = the web-research default
// for the type (decision 2 — on for interview/sales, off for internal meetings).
const CATEGORIES: {
  value: SimConCategory;
  label: string;
  hint: string;
  research: boolean;
}[] = [
```

  After:

```tsx
import { Section, ViewShell } from "@/components/studio/ViewShell";
import { Icon } from "@/components/ui/Icon";
import { useBackend } from "@/lib/backend";
import { useCapabilities } from "@/lib/backend/context";
import { splitDocuments } from "@/components/context/documentSplit";
import type { RagDocument, ContextCategory, ConversationContext } from "@/lib/ipc";
import { isDesktop } from "@/lib/platform";

// Mirrors conva_core::context templates. `research` = the web-research default
// for the type (decision 2 — on for interview/sales, off for internal meetings).
const CATEGORIES: {
  value: ContextCategory;
  label: string;
  hint: string;
  research: boolean;
}[] = [
```

  Note: `useCapabilities` is imported from `@/lib/backend/context` — that module path is unrelated to this rename (it's the existing capabilities-provider file, not a `SimCon`/`Context`-record file) and is untouched; do not confuse it with the directory rename in Step 1.

- [ ] **Step 4: `ContextSetup.tsx` — rename `researchDefault`'s param type + the component's own prop/state types + doc comment.** Before:

```tsx
const researchDefault = (c: SimConCategory): boolean =>
  CATEGORIES.find((x) => x.value === c)?.research ?? false;

const DOC_EXTENSIONS = ["pdf", "docx", "md", "txt", "html"];
const STEP_LABEL = ["the basics", "context & documents", "review"];

/**
 * Sim Con setup wizard (Step 1). Collects name, goal, type (and, for interviews,
 * the job description), plus context: Path A attaches library documents — you can
 * add new files directly, which land in a folder named after the Sim Con — and
 * Path B asks Ally to auto-generate context. Finishing saves a draft
 * SimConSession; the ingestion + research phase (C) consumes it.
 */
export function SimConSetup({
  initial,
  onDone,
  onCancel,
}: {
  initial?: SimConSession;
  onDone: () => void;
  onCancel: () => void;
}) {
  const backend = useBackend();
  const caps = useCapabilities();
  const [regenerating, setRegenerating] = useState(false);
  const [step, setStep] = useState(1);
  const [title, setTitle] = useState(initial?.title ?? "");
  const [purpose, setPurpose] = useState(initial?.purpose ?? "");
  const [category, setCategory] = useState<SimConCategory>(
    initial?.category ?? "interview",
  );
```

  After:

```tsx
const researchDefault = (c: ContextCategory): boolean =>
  CATEGORIES.find((x) => x.value === c)?.research ?? false;

const DOC_EXTENSIONS = ["pdf", "docx", "md", "txt", "html"];
const STEP_LABEL = ["the basics", "context & documents", "review"];

/**
 * Context setup wizard (Step 1). Collects name, goal, type (and, for interviews,
 * the job description), plus context: Path A attaches library documents — you can
 * add new files directly, which land in a folder named after the Context — and
 * Path B asks Ally to auto-generate context. Finishing saves a draft
 * ConversationContext; the ingestion + research phase (C) consumes it.
 */
export function ContextSetup({
  initial,
  onDone,
  onCancel,
}: {
  initial?: ConversationContext;
  onDone: () => void;
  onCancel: () => void;
}) {
  const backend = useBackend();
  const caps = useCapabilities();
  const [regenerating, setRegenerating] = useState(false);
  const [step, setStep] = useState(1);
  const [title, setTitle] = useState(initial?.title ?? "");
  const [purpose, setPurpose] = useState(initial?.purpose ?? "");
  const [category, setCategory] = useState<ContextCategory>(
    initial?.category ?? "interview",
  );
```

- [ ] **Step 5: `ContextSetup.tsx` — the `pickCategory` param type + every `backend.simcon.*` call.** Before:

```tsx
  const pickCategory = (c: SimConCategory) => {
```

  After:

```tsx
  const pickCategory = (c: ContextCategory) => {
```

  Then rename every `backend.simcon.` call to `backend.context.` — there are 4 in this file (`generateDossier`, `storeDocs`, `save`, `prepare`), via `sed`:

```bash
sed -i 's/backend\.simcon\./backend.context./g' src/components/context/ContextSetup.tsx
```

> **Added post-write** (found during execution): the table below was short
> one row (the header said "5 remaining" but only listed 4) — a
> `// Path A — add files directly...` comment Steps 3–5 don't reach. Also,
> Step 7's grep expectation was factually wrong throughout this whole
> task (Steps 7/11/13/16): it claimed `icon="simicon"` would show up as
> an "expected hit" in the `grep -inE 'sim ?con'` check, but that regex
> structurally cannot match `simicon` (no space, and there's an `i`
> between "sim" and "con" that the pattern doesn't allow) — so
> `icon="simicon"` was never going to appear in any of these grep results
> at all, correctly unchanged or not. All 4 grep-confirm steps in this
> task are corrected below to expect genuinely **no output**.

- [ ] **Step 6: `ContextSetup.tsx` — the 5 remaining leftover-copy strings.**

  | Before | After |
  |---|---|
  | `      setError("Couldn't save — Sim Con runs on the desktop app.");` | `      setError("Couldn't save — Context runs on the desktop app.");` |
  | `      title={initial ? "Edit Sim Con" : "New Sim Con"}` | `      title={initial ? "Edit Context" : "New Context"}` |
  | `description="conva grounds the counterparty and its questions in these. Add files directly (they're kept in a folder named after this Sim Con) or pick from your library."` | `description="conva grounds the counterparty and its questions in these. Add files directly (they're kept in a folder named after this Context) or pick from your library."` |
  | `            Finishing saves this Sim Con. Building the knowledge base, generating` | `            Finishing saves this Context. Building the knowledge base, generating` |
  | `  // Path A — add files directly: copy them into this Sim Con's folder, then` | `  // Path A — add files directly: copy them into this Context's folder, then` |

  (`icon="simicon"` on the `<ViewShell>` element is **unchanged** — that's the `Icon.tsx` registry key, not renamed per this plan; see Task 4.4 for its comment-only fix. It does not appear in Step 7's grep either way — see the note above.)

- [ ] **Step 7: `ContextSetup.tsx` — grep-confirm.**

```bash
grep -inE 'sim ?con' src/components/context/ContextSetup.tsx
```

  Expected: no output.

- [ ] **Step 8: `ContextDetail.tsx` (formerly `SimConDetail.tsx`) — imports, types, copy.** Before:

```tsx
import { Section, ViewShell } from "@/components/studio/ViewShell";
import { Icon } from "@/components/ui/Icon";
import { useBackend } from "@/lib/backend";
import { useCapabilities } from "@/lib/backend/context";
import { DEFAULT_CONTEXT_ID, type KnowledgeProfile, type RagDocument, type SimConSession } from "@/lib/ipc";
import { useNavStore } from "@/state/nav";
import { useRehearsalStore } from "@/state/rehearsal";

/**
 * Sim Con detail — the persona step (Step 3) and the launch point for the live
 * session (Step 4, next phase). Generate 3 counterparty personas from the
 * knowledge base, pick one, then Start. Edit reopens the setup wizard.
 */
export function SimConDetail({
  id,
  onEdit,
  onBack,
}: {
  id: string;
  onEdit: () => void;
  onBack: () => void;
}) {
  const backend = useBackend();
  const caps = useCapabilities();
  const [session, setSession] = useState<SimConSession | null>(null);
```

  After:

```tsx
import { Section, ViewShell } from "@/components/studio/ViewShell";
import { Icon } from "@/components/ui/Icon";
import { useBackend } from "@/lib/backend";
import { useCapabilities } from "@/lib/backend/context";
import { DEFAULT_CONTEXT_ID, type KnowledgeProfile, type RagDocument, type ConversationContext } from "@/lib/ipc";
import { useNavStore } from "@/state/nav";
import { useRehearsalStore } from "@/state/rehearsal";

/**
 * Context detail — the persona step (Step 3) and the launch point for the live
 * session (Step 4, next phase). Generate 3 counterparty personas from the
 * knowledge base, pick one, then Start. Edit reopens the setup wizard.
 */
export function ContextDetail({
  id,
  onEdit,
  onBack,
}: {
  id: string;
  onEdit: () => void;
  onBack: () => void;
}) {
  const backend = useBackend();
  const caps = useCapabilities();
  const [session, setSession] = useState<ConversationContext | null>(null);
```

  (the local state variable is still named `session` — that's a component-local binding, not a renamed symbol from `ipc.ts`; consistent with scope decision 3, leave it.)

- [ ] **Step 9: `ContextDetail.tsx` — every `backend.simcon.*` call (7 occurrences) + the load-error copy.**

```bash
sed -i 's/backend\.simcon\./backend.context./g' src/components/context/ContextDetail.tsx
```

  This `sed` requires the literal `backend.simcon.` (dot included) on one line, so it only reaches 6 of the 7 occurrences — **added post-write, found during execution:** the 7th is a multi-line method chain where `backend.simcon` and its `.load(id)` call sit on separate lines, which `sed` can't match. Fix it explicitly. Before:

```tsx
  const load = useCallback(() => {
    backend.simcon
      .load(id)
      .then(setSession)
      .catch(() => setError("Couldn't load this Sim Con."));
  }, [backend, id]);
```

  After (also folds in the load-error copy fix below, same block):

```tsx
  const load = useCallback(() => {
    backend.context
      .load(id)
      .then(setSession)
      .catch(() => setError("Couldn't load this Context."));
  }, [backend, id]);
```

  (The load-error copy string is shown inline above rather than as a separate before/after — it's the same 4-line block as the `backend.simcon` fix, no need to edit it twice.)

- [ ] **Step 10: `ContextDetail.tsx` — the remaining 2 leftover-copy strings (title fallback + section header).**

  | Before | After |
  |---|---|
  | `      title={session?.title \|\| "Sim Con"}` | `      title={session?.title \|\| "Context"}` |
  | `        <Section title="Sim Con">` | `        <Section title="Context">` |

- [ ] **Step 11: `ContextDetail.tsx` — grep-confirm.**

```bash
grep -inE 'sim ?con' src/components/context/ContextDetail.tsx
```

  Expected: no output (see the note above Step 6 — the two `icon="simicon"`/`Icon name="simicon"` occurrences in this file are intentionally unchanged, but the grep pattern can't match `simicon` in the first place, so they were never going to show up here regardless).

- [ ] **Step 12: `RehearsalBar.tsx` — the 2 `backend.simcon.*` calls + copy.** Before:

```tsx
export function RehearsalBar() {
```

  (component name itself is unchanged — it's already correctly named per the design spec.) Rename the 2 backend calls:

```bash
sed -i 's/backend\.simcon\./backend.context./g' src/components/context/RehearsalBar.tsx
```

  Then fix the 2 remaining leftover-copy strings by hand (not `backend.simcon` calls, so `sed` above doesn't touch them):

  | Before | After |
  |---|---|
  | ` * Floating controls for a live Sim Con rehearsal, shown over the cockpit while` | ` * Floating controls for a live Context rehearsal, shown over the cockpit while` |
  | `        useConversationStore.getState().setTitle(\`Sim Con — ${persona}\`);` | `        useConversationStore.getState().setTitle(\`Context — ${persona}\`);` |

  And the doc-comment line above that:

```tsx
      // Mark the saved conversation as a Sim Con so it's identifiable in the
      // Conversations list, then route through the app store's stop so ending
```

  becomes:

```tsx
      // Mark the saved conversation as a Context rehearsal so it's identifiable
      // in the Conversations list, then route through the app store's stop so ending
```

  (`Icon name="simicon"` in this file is unchanged, same as `ContextSetup.tsx`/`ContextDetail.tsx`.)

- [ ] **Step 13: `RehearsalBar.tsx` — grep-confirm.**

```bash
grep -inE 'sim ?con' src/components/context/RehearsalBar.tsx
```

  Expected: no output (same note as Step 6/11 — `Icon name="simicon"` is unchanged but can't match this grep pattern anyway).

- [ ] **Step 14: `ContextSetup.test.tsx` (formerly `SimConSetup.test.tsx`) — imports + component references.** Before:

```tsx
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SimConSetup } from "@/components/simcon/SimConSetup";
import { BackendProvider } from "@/lib/backend";
import type { ConvaBackend } from "@/lib/backend/ConvaBackend";
import type { SimConSession } from "@/lib/ipc";

afterEach(cleanup);

// Minimal fake — the wizard only calls rag.list() on mount; the rest is local
// React state until Finish (which these tests don't reach). capabilities()
// is stubbed because SimConSetup now calls useCapabilities() unconditionally
// (Generated by Ally's View button gating) — resolving null is fine for
// tests that don't care about partnerWindow.
function fakeBackend(): ConvaBackend {
  return {
    rag: { list: vi.fn().mockResolvedValue([]) },
    capabilities: vi.fn().mockResolvedValue(null),
  } as unknown as ConvaBackend;
}

function renderSetup() {
  render(
    <BackendProvider backend={fakeBackend()}>
      <SimConSetup onDone={() => undefined} onCancel={() => undefined} />
    </BackendProvider>,
  );
}

describe("SimConSetup wizard", () => {
```

  After:

```tsx
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ContextSetup } from "@/components/context/ContextSetup";
import { BackendProvider } from "@/lib/backend";
import type { ConvaBackend } from "@/lib/backend/ConvaBackend";
import type { ConversationContext } from "@/lib/ipc";

afterEach(cleanup);

// Minimal fake — the wizard only calls rag.list() on mount; the rest is local
// React state until Finish (which these tests don't reach). capabilities()
// is stubbed because ContextSetup now calls useCapabilities() unconditionally
// (Generated by Ally's View button gating) — resolving null is fine for
// tests that don't care about partnerWindow.
function fakeBackend(): ConvaBackend {
  return {
    rag: { list: vi.fn().mockResolvedValue([]) },
    capabilities: vi.fn().mockResolvedValue(null),
  } as unknown as ConvaBackend;
}

function renderSetup() {
  render(
    <BackendProvider backend={fakeBackend()}>
      <ContextSetup onDone={() => undefined} onCancel={() => undefined} />
    </BackendProvider>,
  );
}

describe("ContextSetup wizard", () => {
```

- [ ] **Step 15: `ContextSetup.test.tsx` — the remaining `SimConSession`/`SimConSetup`/`backend.simcon` occurrences in the 4 later tests.** These appear identically-shaped 4 times (`ConvaBackend` cast object literal + `<SimConSetup initial={...}>` + `SimConSession` type annotation); apply via `sed` (safe — every occurrence in this test file is one of these 3 exact tokens, confirmed by the earlier investigation grep of the file):

```bash
sed -i \
  -e 's/\bSimConSession\b/ConversationContext/g' \
  -e 's/\bSimConSetup\b/ContextSetup/g' \
  -e 's/simcon: { save, prepare }/context: { save, prepare }/' \
  -e 's/simcon: { save: vi\.fn(), prepare: vi\.fn() }/context: { save: vi.fn(), prepare: vi.fn() }/g' \
  src/components/context/ContextSetup.test.tsx
```

> **Added post-write** (found during execution): the `sed` above doesn't
> reach a stale filename reference inside a comment — the file's own
> tests were written referring to the *old* name of a file this same
> plan renames in Task 4.1 Step 1.

- [ ] **Step 15b: Fix the stale `SimConDetail.tsx` filename reference.** Before:

```tsx
    // capabilities() resolves asynchronously (useCapabilities effect) — findBy
    // waits for the View button to appear once it does. The button's
    // accessible name is `View ${file_name}` (aria-label, matching the
    // icon-only View button's pattern in LibraryPane.tsx/SimConDetail.tsx),
    // not bare "View" — match on the prefix.
```

  After:

```tsx
    // capabilities() resolves asynchronously (useCapabilities effect) — findBy
    // waits for the View button to appear once it does. The button's
    // accessible name is `View ${file_name}` (aria-label, matching the
    // icon-only View button's pattern in LibraryPane.tsx/ContextDetail.tsx),
    // not bare "View" — match on the prefix.
```

- [ ] **Step 16: `ContextSetup.test.tsx` — grep-confirm.**

```bash
grep -inE 'sim ?con' src/components/context/ContextSetup.test.tsx
```

  Expected: no output.

- [ ] **Step 17: Run the touched tests.** `npx vitest run src/components/context/ContextSetup.test.tsx src/components/context/documentSplit.test.ts` — all pass (same count as before the rename — these are the same assertions, renamed symbols only).

- [ ] **Step 18: Commit.**

```bash
git add src/components/context
git commit -m "refactor(ui): rename SimCon components/folder to Context (src/components/context)"
```

(standard trailer; `git add` on the moved directory captures both the `git mv` renames and the content edits.)

### Task 4.2: `src/components/contexts/` importers — `ContextsPane.tsx`, `ContextsView.tsx`, `GroundPicker.tsx`, `readiness.ts`, `rowStatus.ts` + their tests

**Files:**
- Modify: `src/components/contexts/ContextsView.tsx`
- Modify: `src/components/contexts/ContextsPane.tsx`
- Modify: `src/components/contexts/ContextsPane.test.tsx`
- Modify: `src/components/contexts/GroundPicker.tsx`
- Modify: `src/components/contexts/GroundPicker.test.tsx`
- Modify: `src/components/contexts/readiness.ts`
- Modify: `src/components/contexts/readiness.test.ts`
- Modify: `src/components/contexts/rowStatus.ts`
- Modify: `src/components/contexts/rowStatus.test.ts`

> Note the folder name distinction: `src/components/contexts/` (plural, this task) is the pre-existing Contexts *page* shell (list/setup-detail router, ground picker) — untouched by the file-rename in Task 4.1. `src/components/context/` (singular, Task 4.1) is the renamed former `simcon/` folder. Both are legitimate, unrelated directories; don't conflate them.

- [ ] **Step 1: `ContextsView.tsx` — imports + types.** Before:

```tsx
import { LibraryPane } from "@/components/contexts/LibraryPane";
import { SimConDetail } from "@/components/simcon/SimConDetail";
import { SimConSetup } from "@/components/simcon/SimConSetup";
import { ViewShell } from "@/components/studio/ViewShell";
import { useBackend } from "@/lib/backend";
import { DEFAULT_CONTEXT_ID, type SimConSession, type SimConSummary } from "@/lib/ipc";
import { useContextsQuickOpen } from "@/state/contextsQuickOpen";
```

  After:

```tsx
import { LibraryPane } from "@/components/contexts/LibraryPane";
import { ContextDetail } from "@/components/context/ContextDetail";
import { ContextSetup } from "@/components/context/ContextSetup";
import { ViewShell } from "@/components/studio/ViewShell";
import { useBackend } from "@/lib/backend";
import { DEFAULT_CONTEXT_ID, type ConversationContext, type ContextSummary } from "@/lib/ipc";
import { useContextsQuickOpen } from "@/state/contextsQuickOpen";
```

- [ ] **Step 2: `ContextsView.tsx` — the rest of the file.** `sed`-safe (every remaining occurrence is one of the 4 already-imported renamed names, or a `backend.simcon.` call, confirmed unique by the earlier investigation grep):

```bash
sed -i \
  -e 's/\bSimConSession\b/ConversationContext/g' \
  -e 's/\bSimConSummary\b/ContextSummary/g' \
  -e 's/\bSimConDetail\b/ContextDetail/g' \
  -e 's/\bSimConSetup\b/ContextSetup/g' \
  -e 's/backend\.simcon\./backend.context./g' \
  src/components/contexts/ContextsView.tsx
```

  This covers: the `Mode` union's `{ k: "setup"; initial: SimConSession | null }`, `[items, setItems] = useState<SimConSummary[]>([])`, the 4 `backend.simcon.*` calls (`list`, `load`, `delete`, `prepare`+`generateDossier`), and the two JSX usages `<SimConSetup .../>`/`<SimConDetail .../>`.

> **Added post-write** (found during execution): the `sed` above requires
> `backend.simcon.` (dot included) on one line, but one of the 4
> `backend.simcon.*` calls is a multi-line method chain — `.list()` sits
> on the next line — so it's left as a bare, now-broken `backend.simcon`.
> Fix it explicitly.

- [ ] **Step 2b: Fix the multi-line `refresh` chain.** Before:

```tsx
  const refresh = useCallback(() => {
    backend.simcon
      .list()
```

  After:

```tsx
  const refresh = useCallback(() => {
    backend.context
      .list()
```

- [ ] **Step 3: `ContextsView.tsx` — grep-confirm.**

```bash
grep -inE 'sim ?con' src/components/contexts/ContextsView.tsx
```

  Expected: no output.

- [ ] **Step 4: `ContextsPane.tsx` — types.**

```bash
sed -i \
  -e 's/\bSimConCategory\b/ContextCategory/g' \
  -e 's/\bSimConSummary\b/ContextSummary/g' \
  src/components/contexts/ContextsPane.tsx
```

  (confirmed by the investigation grep: this file only references `SimConCategory` (the `CATEGORY_LABEL` map key type) and `SimConSummary` (the `items` prop type) — no `SimCon`-prefixed component imports, no `backend.simcon` calls.)

- [ ] **Step 5: `ContextsPane.tsx` — grep-confirm.**

```bash
grep -inE 'sim ?con' src/components/contexts/ContextsPane.tsx
```

  Expected: no output.

- [ ] **Step 6: `ContextsPane.test.tsx`.**

```bash
sed -i 's/\bSimConSummary\b/ContextSummary/g' src/components/contexts/ContextsPane.test.tsx
```

> **Added post-write** (found during execution): this `sed` doesn't reach
> a "Sim Con" mention in a test description string, and — unlike every
> other file in this task — Step 6 never had its own grep-confirm. Both
> added below.

- [ ] **Step 6b: Reword the test description.** Before:

```tsx
  it("hides the New Context button off-desktop (web has no Sim Con folder to write to)", () => {
```

  After:

```tsx
  it("hides the New Context button off-desktop (web has no Context folder to write to)", () => {
```

- [ ] **Step 6c: `ContextsPane.test.tsx` — grep-confirm.**

```bash
grep -inE 'sim ?con' src/components/contexts/ContextsPane.test.tsx
```

  Expected: no output.

- [ ] **Step 7: `GroundPicker.tsx` — types + every `backend.simcon.*` call (11 occurrences).**

```bash
sed -i \
  -e 's/\bSimConSession\b/ConversationContext/g' \
  -e 's/\bSimConSummary\b/ContextSummary/g' \
  -e 's/backend\.simcon\./backend.context./g' \
  src/components/contexts/GroundPicker.tsx
```

> **Added post-write** (found during execution): 2 of the 11
> `backend.simcon.*` calls are multi-line chains (`.activateContext(...)`
> on the next line) the `sed` above can't reach — both are the same
> call site shape, in two different places in the file. Fix both
> explicitly.

- [ ] **Step 7b: Fix the mount auto-activate effect's chain.** Before:

```tsx
    void backend.simcon
      .activateContext(DEFAULT_CONTEXT_ID)
      .then((session) => setActive(session.id, session.title))
      .catch(() => {
```

  After:

```tsx
    void backend.context
      .activateContext(DEFAULT_CONTEXT_ID)
      .then((session) => setActive(session.id, session.title))
      .catch(() => {
```

- [ ] **Step 7c: Fix the Reset button handler's chain.** Before:

```tsx
              onClick={() => {
                void backend.simcon
                  .activateContext(DEFAULT_CONTEXT_ID)
                  .then((session) => setActive(session.id, session.title));
              }}
```

  After:

```tsx
              onClick={() => {
                void backend.context
                  .activateContext(DEFAULT_CONTEXT_ID)
                  .then((session) => setActive(session.id, session.title));
              }}
```

- [ ] **Step 8: `GroundPicker.tsx` — grep-confirm.**

```bash
grep -inE 'sim ?con' src/components/contexts/GroundPicker.tsx
```

  Expected: no output.

- [ ] **Step 9: `GroundPicker.test.tsx` — types + the fake-backend helper's key.** Before:

```tsx
import { DEFAULT_CONTEXT_ID, type RagDocument, type SimConSession, type SimConSummary } from "@/lib/ipc";
```

  ... and:

```tsx
function summary(overrides: Partial<SimConSummary> = {}): SimConSummary {
```

  ... and:

```tsx
function session(overrides: Partial<SimConSession> = {}): SimConSession {
```

  ... and:

```tsx
function defaultSession(): SimConSession {
```

  ... and:

```tsx
function fakeBackend(overrides: Partial<ConvaBackend["simcon"]> = {}): ConvaBackend {
  return {
    simcon: {
```

  Apply via `sed` (each token is unambiguous in this file):

```bash
sed -i \
  -e 's/\bSimConSession\b/ConversationContext/g' \
  -e 's/\bSimConSummary\b/ContextSummary/g' \
  -e 's/ConvaBackend\["simcon"\]/ConvaBackend["context"]/' \
  -e 's/^\(\s*\)simcon: {/\1context: {/' \
  src/components/contexts/GroundPicker.test.tsx
```

  Then grep-confirm any remaining `backend.simcon`/`.simcon.` calls inside the test bodies got the general `backend\.simcon\.` treatment too — re-run:

```bash
sed -i 's/backend\.simcon\./backend.context./g' src/components/contexts/GroundPicker.test.tsx
grep -inE 'sim ?con' src/components/contexts/GroundPicker.test.tsx
```

  Expected: no output.

- [ ] **Step 10: `readiness.ts` + `readiness.test.ts`.**

```bash
sed -i 's/\bSimConSummary\b/ContextSummary/g' src/components/contexts/readiness.ts
sed -i 's/\bSimConSummary\b/ContextSummary/g' src/components/contexts/readiness.test.ts
grep -inE 'sim ?con' src/components/contexts/readiness.ts src/components/contexts/readiness.test.ts
```

  Expected: no output.

- [ ] **Step 11: `rowStatus.ts` + `rowStatus.test.ts`.**

```bash
sed -i \
  -e 's/\bSimConStatus\b/ContextStatus/g' \
  -e 's/\bSimConSummary\b/ContextSummary/g' \
  src/components/contexts/rowStatus.ts
sed -i 's/\bSimConSummary\b/ContextSummary/g' src/components/contexts/rowStatus.test.ts
grep -inE 'sim ?con' src/components/contexts/rowStatus.ts src/components/contexts/rowStatus.test.ts
```

  Expected: no output.

- [ ] **Step 12: Run the touched tests.**

```bash
npx vitest run src/components/contexts/ContextsPane.test.tsx \
  src/components/contexts/GroundPicker.test.tsx \
  src/components/contexts/readiness.test.ts \
  src/components/contexts/rowStatus.test.ts
```

  All pass, same counts as pre-rename.

- [ ] **Step 13: Commit.**

```bash
git add src/components/contexts/ContextsView.tsx src/components/contexts/ContextsPane.tsx \
        src/components/contexts/ContextsPane.test.tsx src/components/contexts/GroundPicker.tsx \
        src/components/contexts/GroundPicker.test.tsx src/components/contexts/readiness.ts \
        src/components/contexts/readiness.test.ts src/components/contexts/rowStatus.ts \
        src/components/contexts/rowStatus.test.ts
git commit -m "refactor(ui): rename SimCon type refs to Context in contexts/ importers"
```

(standard trailer.)

### Task 4.3: View routing — `StudioShell.tsx`, `ViewRouter.tsx`, `CommandPalette.tsx`, `DashboardView.tsx`, `navItems.ts`, `nav.ts`, `contextsQuickOpen.ts`, `libraryQuickAdd.ts`

**Files:**
- Modify: `src/components/studio/StudioShell.tsx`
- Modify: `src/components/studio/ViewRouter.tsx`
- Modify: `src/components/studio/CommandPalette.tsx`
- Modify: `src/components/dashboard/DashboardView.tsx`
- Modify: `src/components/studio/navItems.ts`
- Modify: `src/state/nav.ts`
- Modify: `src/state/contextsQuickOpen.ts`
- Modify: `src/state/libraryQuickAdd.ts`

- [ ] **Step 1: `StudioShell.tsx` — the moved import path.** Before:

```tsx
import { RehearsalBar } from "@/components/simcon/RehearsalBar";
```

  After:

```tsx
import { RehearsalBar } from "@/components/context/RehearsalBar";
```

- [ ] **Step 2: `nav.ts` — the `View` union's `"simcon"` member.** Before:

```ts
export type View =
  | "dashboard"
  | "live"
  | "conversations"
  | "simcon"
  | "features"
  | "whatsnew"
  | "releases"
  | "about"
  | "settings"
  | "profile";
```

  After:

```ts
export type View =
  | "dashboard"
  | "live"
  | "conversations"
  | "context"
  | "features"
  | "whatsnew"
  | "releases"
  | "about"
  | "settings"
  | "profile";
```

- [ ] **Step 3: `navItems.ts` — the nav item's `view` key.** Before:

```ts
  { view: "simcon", icon: "simicon", label: "Contexts" },
```

  After (`icon: "simicon"` unchanged — the icon registry key, not renamed per this plan):

```ts
  { view: "context", icon: "simicon", label: "Contexts" },
```

> **Added post-write** (found during execution): an earlier doc-comment
> block in this same file (above `NAV_ITEMS`) mentions "Sim Con" 3 times,
> not touched by Step 3's single-line edit. On inspection these are NOT
> uniform — one is reword-able prose, one is a literal quote of
> `roadmap.md` (a different repo, `conva_core`, out of this plan's
> scope — its own text isn't being renamed, so quoting it verbatim stays
> accurate), and one describes the deliberately-preserved
> `simcon_title`/`is_rehearsal` persisted-tag mechanism (scope decision
> 2) — describing that real, unrenamed mechanism as "Sim Con" is
> *correct*, not stale. Only the first gets reworded.

- [ ] **Step 3b: Reword the one prose mention that isn't a quote or a reference to preserved on-disk data.** Before:

```ts
 * Rehearsal has never been separate code from Contexts: it's Sim Con
 * Phase D, built into it from the start (`roadmap.md` lists "Sim Con
 * rehearsal" under the already-built Conversation Context feature;
```

  After (only "it's Sim Con" → "it's Context" changes; the quoted
  `"Sim Con rehearsal"` — `roadmap.md`'s own literal wording — is left
  exactly as-is):

```ts
 * Rehearsal has never been separate code from Contexts: it's Context
 * Phase D, built into it from the start (`roadmap.md` lists "Sim Con
 * rehearsal" under the already-built Conversation Context feature;
```

  Further down in the same comment block, leave `"...tagged Sim Con) —
  Contexts is the prep material..."` **untouched** — it correctly
  describes the real `simcon_title` tag that scope decision 2 keeps
  unrenamed on disk, not stale documentation.

- [ ] **Step 4: `ViewRouter.tsx` — the routed view check.** Before:

```tsx
      {view === "simcon" && <ContextsView />}
```

  After:

```tsx
      {view === "context" && <ContextsView />}
```

- [ ] **Step 5: `CommandPalette.tsx` — the nav command + 3 `setView` calls.** Before:

```tsx
      go("simcon", "Go to Contexts", "simicon"),
```

  After (again, the icon name `"simicon"` — 3rd positional arg — is unchanged):

```tsx
      go("context", "Go to Contexts", "simicon"),
```

  Then the 3 `setView("simcon")` calls, via `sed` (safe — this exact string appears nowhere else with a different meaning in this file):

```bash
sed -i 's/setView("simcon")/setView("context")/g' src/components/studio/CommandPalette.tsx
```

- [ ] **Step 6: `DashboardView.tsx` — the quick-link's `go()` call.** Before:

```tsx
            onClick={go("simcon")}
```

  After:

```tsx
            onClick={go("context")}
```

- [ ] **Step 7: `contextsQuickOpen.ts` — 2 comment mentions.** Before:

```ts
/**
 * One-shot cross-navigation intent, same pattern as `libraryQuickAdd.ts`:
 * Conversations' "Rehearse" tab lists contexts and needs to jump straight
 * into one's detail page (Step 3/4 — personas, start rehearsal) on click,
 * without duplicating `SimConDetail` or exposing ContextsView's internal
 * `mode` state globally. `request(id)` + `setView("simcon")`, consumed once
 * in `ContextsView`'s mode initializer.
 */
```

  After:

```ts
/**
 * One-shot cross-navigation intent, same pattern as `libraryQuickAdd.ts`:
 * Conversations' "Rehearse" tab lists contexts and needs to jump straight
 * into one's detail page (Step 3/4 — personas, start rehearsal) on click,
 * without duplicating `ContextDetail` or exposing ContextsView's internal
 * `mode` state globally. `request(id)` + `setView("context")`, consumed once
 * in `ContextsView`'s mode initializer.
 */
```

- [ ] **Step 8: `libraryQuickAdd.ts` — 1 comment mention.** Before:

```ts
 * and the caller navigates to `"simcon"`; the screen `consume()`s it once
```

  After:

```ts
 * and the caller navigates to `"context"`; the screen `consume()`s it once
```

- [ ] **Step 9: Grep-confirm the whole set.**

```bash
grep -inE 'sim ?con' src/components/studio/StudioShell.tsx src/components/studio/ViewRouter.tsx \
  src/components/studio/CommandPalette.tsx src/components/dashboard/DashboardView.tsx \
  src/components/studio/navItems.ts src/state/nav.ts src/state/contextsQuickOpen.ts \
  src/state/libraryQuickAdd.ts
```

  Expected: exactly 2 hits, both in `navItems.ts` — the literal
  `roadmap.md` quote (`"Sim Con rehearsal"`, split across two lines) and
  the `simcon_title` tag reference (`tagged Sim Con`), both intentionally
  preserved per Step 3b above. Nothing else, in no other file.

- [ ] **Step 10: Run the touched tests + typecheck.** `npm run build` — the `View` union rename means every remaining `setView("simcon")`/`view === "simcon"` anywhere else in the tree would now be a **type error**, which is a useful cross-check: if the build errors on a `"simcon"` string literal assigned to `View` anywhere outside the files this task touched, that's a missed site — go find and fix it before continuing (expected: zero such errors, since Task 4.2 didn't touch any `View`-typed code and Task 4.4 hasn't run yet, but Task 4.4's `rehearse` function in `ConversationsPanel.tsx` also calls `setView("simcon")` — confirm the build error surfaces there specifically, which Task 4.4 Step 1 then fixes).

- [ ] **Step 11: Commit.**

```bash
git add src/components/studio/StudioShell.tsx src/components/studio/ViewRouter.tsx \
        src/components/studio/CommandPalette.tsx src/components/dashboard/DashboardView.tsx \
        src/components/studio/navItems.ts src/state/nav.ts src/state/contextsQuickOpen.ts \
        src/state/libraryQuickAdd.ts
git commit -m "refactor(ui): rename the \"simcon\" view-router key to \"context\""
```

(standard trailer.)

### Task 4.4: Remaining leftover UI copy — `ConversationsPanel.tsx`, `SettingsPanel.tsx`, `Icon.tsx`, `ViewShell.tsx`, `TranscriptView.tsx`, `state/app.ts`

**Files:**
- Modify: `src/components/ConversationsPanel.tsx`
- Modify: `src/components/SettingsPanel.tsx`
- Modify: `src/components/ui/Icon.tsx`
- Modify: `src/components/studio/ViewShell.tsx`
- Modify: `src/components/transcript/TranscriptView.tsx`
- Modify: `src/state/app.ts`
- Modify: `src/state/rehearsal.ts` (**added post-write** — see Step 11b)
- Modify: `src/state/conversation.ts` (**added post-write** — see Step 11c)

- [ ] **Step 1: `ConversationsPanel.tsx` — imports + types + the `setView("simcon")` call left over from Task 4.3.** Before:

```tsx
import {
  DEFAULT_CONTEXT_ID,
  type Conversation,
  type ConversationSummary,
  type RagDocument,
  type SessionSummary,
  type SimConSummary,
  type TranscriptSegment,
} from "@/lib/ipc";
```

  After:

```tsx
import {
  DEFAULT_CONTEXT_ID,
  type Conversation,
  type ConversationSummary,
  type RagDocument,
  type SessionSummary,
  type ContextSummary,
  type TranscriptSegment,
} from "@/lib/ipc";
```

  Then the rest, via `sed` (5 remaining occurrences: `STATUS_LABEL`/`STATUS_TONE`'s `Record<SimConSummary["status"], ...>`, `useState<SimConSummary[]>`, `backend.simcon.list()`, and the `setView("simcon")` in `rehearse`):

```bash
sed -i \
  -e 's/\bSimConSummary\b/ContextSummary/g' \
  -e 's/backend\.simcon\./backend.context./g' \
  -e 's/setView("simcon")/setView("context")/g' \
  src/components/ConversationsPanel.tsx
```

- [ ] **Step 2: `ConversationsPanel.tsx` — the class-doc-comment prose (2 mentions) + the "Sim Con rehearsal" pill/tooltip (3 mentions).** Before:

```tsx
 * given its own rail item because rehearsing IS a kind of conversation (it
 * saves as one, tagged Sim Con, and shows up right there in "All
 * activity") — Contexts is the prep material, this tab is the act of
```

  After:

```tsx
 * given its own rail item because rehearsing IS a kind of conversation (it
 * saves as one, tagged Context rehearsal, and shows up right there in "All
 * activity") — Contexts is the prep material, this tab is the act of
```

  Before (the `docsInContextScope`/`inScope` doc comment referencing the actual, unchanged `simcon_title` field name — leave the field-name reference as-is since the field itself is untouched per scope decision 2, this line needs **no** edit):

```tsx
 * its linked docs being attached to that Context; a rehearsal session
 * qualifies by its `simcon_title` matching the Context's title. Both are
```

  *(no change — documents the real, unrenamed field name accurately)*

  Before (the pill + tooltip JSX):

```tsx
                  {row.data.is_rehearsal && (
                    <span
                      title={
                        row.data.simcon_title
                          ? `Sim Con rehearsal: ${row.data.simcon_title}`
                          : "Sim Con rehearsal"
                      }
                      className="pill pill-sm pill-ally shrink-0"
                    >
                      Sim Con
                    </span>
                  )}
```

  After (`row.data.simcon_title` — the field reads — stay unchanged; only the **displayed strings** change):

```tsx
                  {row.data.is_rehearsal && (
                    <span
                      title={
                        row.data.simcon_title
                          ? `Context rehearsal: ${row.data.simcon_title}`
                          : "Context rehearsal"
                      }
                      className="pill pill-sm pill-ally shrink-0"
                    >
                      Context
                    </span>
                  )}
```

- [ ] **Step 3: `ConversationsPanel.tsx` — grep-confirm.**

```bash
grep -inE 'sim ?con' src/components/ConversationsPanel.tsx
```

  Expected: exactly 6 hits — all legitimate, untouched `simcon_title` references (scope decision 2): the doc-comment mention Step 2 already flags as "no change" (`~line 181`, "qualifies by its `simcon_title` matching..."), a functional filter-condition read (`~line 273`, `row.data.simcon_title !== contextScopeTitle`) not otherwise mentioned in this task, and the pill/tooltip's two field reads (`~lines 701-702, 711-712`). (**Corrected post-write** — the plan as first written said "exactly 2 hits" and only listed the pill/tooltip pair; the other two are equally legitimate and were simply undercounted, not a content gap.) Nothing else may appear.

- [ ] **Step 4: `SettingsPanel.tsx` — the 3 `backend.simcon.*` calls.**

```bash
sed -i 's/backend\.simcon\./backend.context./g' src/components/SettingsPanel.tsx
```

> **Added post-write** (found during execution): same recurring class as
> Task 4.2's fix (`1198bc8`) — one of the 3 sites is a multi-line chain
> the sed above can't reach.

- [ ] **Step 4b: Fix the multi-line `useEffect` chain.** Before:

```tsx
  useEffect(() => {
    void backend.simcon
      .researchKeyStatus()
      .then(setHasKey)
      .catch(() => {});
  }, [backend]);
```

  After:

```tsx
  useEffect(() => {
    void backend.context
      .researchKeyStatus()
      .then(setHasKey)
      .catch(() => {});
  }, [backend]);
```

- [ ] **Step 5: `SettingsPanel.tsx` — the `USAGE_LABELS` map.** Before:

```tsx
const FEATURE_LABELS: Record<string, string> = {
  ally_suggest_reply: "Ally · suggest reply",
  ally_summarize: "Ally · summarize",
  ally_question: "Ally · question",
  ally_card_summary: "Ally · card summary",
  simcon_knowledge: "Sim Con · knowledge",
  simcon_research_findings: "Sim Con · research findings",
  simcon_personas: "Sim Con · personas",
  rehearsal_persona: "Rehearsal · persona",
  tracker: "Tracker",
  capture: "FANER capture",
  faner_replay: "FANER replay (dev)",
};
```

  After — per the design spec, BOTH the old (already-recorded, still-emitted-historically) key and the new (`context_*`, emitted going forward per Phase 2) key map to the **same** label, so historical usage rows keep a real label instead of falling back to a raw unmapped key string. Also adds `context_qa`/`simcon_qa` — the fourth key `context_generate_dossier`'s Stage 3 always emitted (metering.rs's own doc comment listed only 3 of the 4 real keys, a pre-existing gap; Phase 2 Task 2.6 fixed the doc comment, this step fixes the corresponding UI label map so `context_qa`/`simcon_qa` usage rows don't render as a raw key):

```tsx
const FEATURE_LABELS: Record<string, string> = {
  ally_suggest_reply: "Ally · suggest reply",
  ally_summarize: "Ally · summarize",
  ally_question: "Ally · question",
  ally_card_summary: "Ally · card summary",
  simcon_knowledge: "Context · knowledge",
  context_knowledge: "Context · knowledge",
  simcon_research_findings: "Context · research findings",
  context_research_findings: "Context · research findings",
  simcon_qa: "Context · Q&A",
  context_qa: "Context · Q&A",
  simcon_personas: "Context · personas",
  context_personas: "Context · personas",
  rehearsal_persona: "Rehearsal · persona",
  tracker: "Tracker",
  capture: "FANER capture",
  faner_replay: "FANER replay (dev)",
};
```

> **Added post-write** (found during execution): this file has 5 more
> "Sim Con" mentions that are real, user-facing UI copy — squarely this
> task's own subject ("remaining leftover UI copy") — that Steps 4–5
> don't reach and Step 6 (as first written) didn't account for. Reworded
> below, before the grep-confirm.

- [ ] **Step 5b: Reword the 5 leftover UI-copy mentions.** Before:

```tsx
/**
 * Web-research key (Sim Con). A Tavily key lets a Sim Con research the web for
 * context during setup; stored in the OS vault, desktop-only. Without it, Sim
 * Cons ground on the user's documents alone.
 */
```

  After:

```tsx
/**
 * Web-research key (Context). A Tavily key lets a Context research the web
 * for context during setup; stored in the OS vault, desktop-only. Without
 * it, Contexts ground on the user's documents alone.
 */
```

  Before:

```tsx
        A <b>Tavily</b> key lets a Sim Con research the web for context (standard
        questions, company background, market rates) when you build one — get a
        free key at <span className="font-mono">tavily.com</span>. Without it, Sim
        Cons ground on your documents only.
```

  After:

```tsx
        A <b>Tavily</b> key lets a Context research the web for context (standard
        questions, company background, market rates) when you build one — get a
        free key at <span className="font-mono">tavily.com</span>. Without it,
        Contexts ground on your documents only.
```

  Before:

```tsx
          No usage recorded yet. Ask Ally something or build a Sim Con to start
          the meter.
```

  After:

```tsx
          No usage recorded yet. Ask Ally something or build a Context to start
          the meter.
```

  Before:

```tsx
        title="Web research (Sim Con)"
        description="Optional — a Tavily key so a Sim Con can research context from the web."
```

  After:

```tsx
        title="Web research (Context)"
        description="Optional — a Tavily key so a Context can research context from the web."
```

- [ ] **Step 6: `SettingsPanel.tsx` — grep-confirm.**

```bash
grep -inE 'sim ?con' src/components/SettingsPanel.tsx
```

  Expected: exactly 4 hits — the 4 `simcon_*` keys deliberately kept in `FEATURE_LABELS` for historical-data display (scope: metering-key backward compatibility, per the design spec). Nothing else.

- [ ] **Step 7: `Icon.tsx` — the doc-comment above the (unchanged) `simicon` registry key.** Before:

```tsx
  // Simicon — the icon for Conversation Contexts / Sim Con: a knowledge hub
  // (a network of connected nodes) briefed for a person, per the mockup's
  // `i-contexts` glyph verbatim (`conva_core/brand/UI/AppUI_V4.0`) — was a
  // two-speech-bubbles glyph that didn't match the reference (owner
  // feedback 2026-08-17).
  simicon: (
```

  After (only the comment's wording changes; the key `simicon:` and its SVG geometry are untouched):

```tsx
  // Simicon — the icon for Conversation Contexts (formerly "Sim Con"): a
  // knowledge hub (a network of connected nodes) briefed for a person, per
  // the mockup's `i-contexts` glyph verbatim
  // (`conva_core/brand/UI/AppUI_V4.0`) — was a two-speech-bubbles glyph that
  // didn't match the reference (owner feedback 2026-08-17).
  simicon: (
```

- [ ] **Step 8: `ViewShell.tsx` — the 2 doc-comment mentions.** Before:

```tsx
 * headline. Pass `breadcrumb` for genuine sub-views (Sim Con setup/detail,
 * reached from Contexts) to get a real two-level trail instead.
```

  After:

```tsx
 * headline. Pass `breadcrumb` for genuine sub-views (Context setup/detail,
 * reached from Contexts) to get a real two-level trail instead.
```

  Before:

```tsx
  /** A sub-view reached from somewhere (Sim Con setup/detail, Settings,
   *  Sessions, Conversations) gets a back control HERE — top-left, next to
```

  After:

```tsx
  /** A sub-view reached from somewhere (Context setup/detail, Settings,
   *  Sessions, Conversations) gets a back control HERE — top-left, next to
```

- [ ] **Step 9: `TranscriptView.tsx` — the 1 `backend.simcon.*` call.** Before:

```tsx
    void Promise.all([backend.simcon.load(activeId), backend.rag.list()])
```

  After:

```tsx
    void Promise.all([backend.context.load(activeId), backend.rag.list()])
```

- [ ] **Step 10: `state/app.ts` — the 1 `getBackend().simcon.*` call.** Before:

```ts
        const session = await getBackend().simcon.activateContext(DEFAULT_CONTEXT_ID);
```

  After:

```ts
        const session = await getBackend().context.activateContext(DEFAULT_CONTEXT_ID);
```

- [ ] **Step 11: Grep-confirm the remaining 4 files.**

```bash
grep -inE 'sim ?con' src/components/ui/Icon.tsx src/components/studio/ViewShell.tsx \
  src/components/transcript/TranscriptView.tsx src/state/app.ts
```

  Expected: **exactly 1 hit** — `Icon.tsx:80`, the `(formerly "Sim Con")` parenthetical Step 7's own "after" block just introduced. (**Corrected post-write** — the plan as first written said "no output," reasoning only about `simicon:` the registry key, which is correct: the `sim ?con` pattern truly can't match `simicon`. But it missed that Step 7's replacement comment text itself deliberately spells out "Sim Con" in full, as a historical aside — same class of thing as Task 4.3's navItems.ts fix: a literal quoted mention that's supposed to stay, not a miss. `ViewShell.tsx`/`TranscriptView.tsx`/`state/app.ts` still produce no output.)

> **Added post-write** (found during execution): the plan's file list for this
> task never covered `src/state/rehearsal.ts` or `src/state/conversation.ts`
> — two more files with a single leftover "Sim Con" doc-comment mention each,
> surfaced by Step 12's full-tree sweep below. Same class of gap as Phase 2's
> Task 2.6 (files the task's own file list never named); folded in here as
> new steps rather than deferred, per that precedent.

- [ ] **Step 11b: `state/rehearsal.ts` — the module-doc-comment mention.** Before:

```ts
/** UI-side state for a live Sim Con rehearsal: whether one is running, who the
 *  counterparty is, and the current phase (drives the speaking indicator). The
 *  phase is fed by `conva://rehearsal-state` events via the IPC bridge. */
```

  After:

```ts
/** UI-side state for a live Context rehearsal: whether one is running, who the
 *  counterparty is, and the current phase (drives the speaking indicator). The
 *  phase is fed by `conva://rehearsal-state` events via the IPC bridge. */
```

- [ ] **Step 11c: `state/conversation.ts` — the `setTitle` doc-comment mention.** Before:

```ts
  /** Pre-fill the save-dialog title (e.g. mark a rehearsal as a Sim Con). */
  setTitle: (title: string | null) => void;
```

  After:

```ts
  /** Pre-fill the save-dialog title (e.g. mark a rehearsal as a Context). */
  setTitle: (title: string | null) => void;
```

- [ ] **Step 12: Full-tree final sweep.**

```bash
grep -rinE 'sim ?con' src/ --include='*.ts' --include='*.tsx' \
  | grep -v 'FEATURE_LABELS\|simcon_knowledge\|simcon_research_findings\|simcon_qa\|simcon_personas\|icon="simicon"\|simicon:\|row.data.simcon_title\|\`simcon_title\`\|formerly "Sim Con"\|navItems\.ts:.*lists "Sim Con\|navItems\.ts:.*tagged Sim Con\|ipc\.ts:.*simcon_title'
```

  Expected: no output. (**Corrected post-write** — the filter as first written only covered this task's own files; it never accounted for `navItems.ts` (Task 4.3's accepted "Sim Con" mentions, `crates`/`ipc.ts:.*simcon_title` (Task 3.1's accepted field name), or `Icon.tsx`'s own `formerly "Sim Con"` text added by Step 7 above — all three are legitimate, already-reasoned-about preserved mentions, not misses. `state/rehearsal.ts` and `state/conversation.ts` need no filter entry since Steps 11b/11c above reword them to zero hits.) If anything else prints, find and fix it before proceeding to Task 4.5.

- [ ] **Step 13: Run the full frontend test suite + build.** `npm test` — same total pass count as this plan's very first `npm test` baseline (Task 5.1 records the authoritative before/after numbers, but a quick gut-check here catches a Phase-4 regression early). `npm run build` — clean, zero errors.

- [ ] **Step 14: Commit.**

```bash
git add src/components/ConversationsPanel.tsx src/components/SettingsPanel.tsx \
        src/components/ui/Icon.tsx src/components/studio/ViewShell.tsx \
        src/components/transcript/TranscriptView.tsx src/state/app.ts \
        src/state/rehearsal.ts src/state/conversation.ts
git commit -m "refactor(ui): remaining SimCon leftover copy + backend calls -> Context"
```

(standard trailer.)

---

## Phase 5: Full verification + push + new issue + draft PR

> **Updated post-write:** PR #95 merged (squash, as `ce421e8` on `main`) while
> this plan was being written, and the branch `claude/conva-app-ui-modernization-igllsd`
> was restarted from the new `main` (this plan's own commit cherry-picked
> forward) before execution began — per this repo's branch-restart
> convention, a merged PR can't track further work. Task 5.3 below
> originally targeted updating PR #95's body; it now opens a **new** issue +
> draft PR instead, same pattern as every other plan in this session used
> the first time on a given branch state.

### Task 5.1: Full gate

**Files:** none (verification only).

- [ ] **Step 1: Run every check.**

```bash
npm run build
npm test
cargo test -p conva-core
cargo fmt --check
cargo clippy -p conva-core --all-targets -- -D warnings
```

  All green. Record the `npm test` and `cargo test -p conva-core` pass counts and compare them to Task 1.1's and Phase 3/4's baselines — they must match exactly (same number of tests, all passing; this rename adds and removes zero tests).

- [ ] **Step 2: Final repo-wide grep sweep** (the authoritative one — run from the repo root, across both `crates/`, `src-tauri/`, and `src/`):

```bash
grep -rinE 'sim ?con' crates/ src-tauri/src/*.rs src/ \
  --include='*.rs' --include='*.ts' --include='*.tsx' \
  | grep -v \
    -e 'context\.rs:.*\.join("simcon")' \
    -e 'context\.rs:.*<app-data>/simcon/' \
    -e 'session\.rs:.*simcon_title' \
    -e 'ipc\.ts:.*simcon_title' \
    -e 'navItems\.ts:.*lists "Sim Con' \
    -e 'navItems\.ts:.*tagged Sim Con' \
    -e 'Icon\.tsx:.*formerly "Sim Con"' \
    -e 'FEATURE_LABELS\|simcon_knowledge\|simcon_research_findings\|simcon_qa\|simcon_personas' \
    -e 'icon="simicon"\|simicon:' \
    -e 'row.data.simcon_title\|`simcon_title`'
```

  Expected: no output. Every hit this filter doesn't explain is a real miss — go fix it (re-open the relevant Phase's task) before continuing. (**Corrected post-write** — two fixes folded in while resolving Task 4.4's own Step 12 gap: the `navItems\.ts:.*Sim Con rehearsal` alternative never matched anything, since "Sim Con" and "rehearsal" fall on two different source lines there — `grep -n` only ever prints one line at a time — so it's rewritten to match what the actual line 39 contains (`lists "Sim Con`); and a new alternative covers `Icon.tsx`'s `(formerly "Sim Con")` parenthetical from Task 4.4 Step 7, which this filter never accounted for at all.)

- [ ] **Step 3: Manual QA reminder for the owner** (per the design spec's Testing section — not automatable in this sandbox): every screen previously reachable via "Sim Con" wording (setup wizard, detail page, Settings usage table, Conversations panel tags, command palette "Go to Contexts") now reads "Context" and functions identically — create, edit, generate, rehearse, save a conversation. Note this in the PR body (Task 5.3).

### Task 5.2: Push

**Files:** none.

- [ ] **Step 1: Push the branch** (already tracking `origin/claude/conva-app-ui-modernization-igllsd`, so this is a plain fast-forward push, not a force-push):

```bash
git push -u origin claude/conva-app-ui-modernization-igllsd
```

  Retry ×4 with 2/4/8/16s backoff on network errors only — do not retry on a rejected/non-fast-forward push (that means the branch diverged; stop and reconcile instead of forcing).

### Task 5.3: New issue + draft PR (PR #95 already merged — this is fresh follow-up work)

**Files:** none (GitHub issue + PR creation only).

- [ ] **Step 1: Create a new issue** — "Finish the SimCon → Context terminology rename" — body: spec link, plan link, one-paragraph summary (the same "Finishes the terminology migration..." paragraph below, trimmed to the issue).

- [ ] **Step 2: Open a new draft PR** from `claude/conva-app-ui-modernization-igllsd` against `main`, `Closes #<issue from Step 1>`:

```markdown
Closes #<issue>

Spec: `docs/superpowers/specs/2026-08-27-simcon-to-context-rename-design.md`
Plan: `docs/superpowers/plans/2026-08-27-simcon-to-context-rename.md`

## SimCon → Context rename

Finishes the terminology migration that was already ~80% done in the UI
("Conversation Contexts" page, `ContextsPane`/`ContextsView` components,
"— Context knowledge" generated documents) — every remaining `SimCon*`
type/file/command/UI-copy occurrence now reads `Context`/`ConversationContext`.
Pure rename, no behavior change:

- **`crates/conva-core`**: `SimConSession` → `ConversationContext`,
  `SimConCategory`/`SimConStatus`/`SimConPersona`/`SimConSummary` →
  `ContextCategory`/`ContextStatus`/`ContextPersona`/`ContextSummary`;
  `simcon.rs` → `context.rs`.
- **`src-tauri`**: same module rename; all 13 `simcon_*` Tauri commands →
  `context_*` (both the `fn` name and the `generate_handler!` entry, verified
  paired); the 4 metering keys now emit `context_knowledge` /
  `context_research_findings` / `context_qa` / `context_personas` going
  forward (historical `simcon_*` rows keep their data — no migration —
  `SettingsPanel.tsx`'s label map keeps both old and new keys mapped to the
  same display label, permanently). Two sites outside the spec's original
  inventory were required for the shell to compile and are included:
  `rehearsal.rs` and `web.rs` (both import types/fns from the renamed core
  module). On-disk data is untouched — the context storage directory stays
  literally `<app-data>/simcon/` and new-record ids keep the `sim-<ts>`
  prefix, so no existing user's saved contexts are affected.
- **TypeScript**: `ipc.ts`'s 5 mirrored types, `commands.ts`'s wrapped
  functions + `invoke` strings, and the `backend.simcon` → `backend.context`
  namespace across `ConvaBackend.ts`/`tauri.ts`/`web.ts`.
- **Components**: `src/components/simcon/` → `src/components/context/`,
  `SimConSetup.tsx`/`SimConDetail.tsx` → `ContextSetup.tsx`/`ContextDetail.tsx`
  (`RehearsalBar.tsx` keeps its name, already correct), every importer across
  `ContextsPane.tsx`/`ContextsView.tsx`/`GroundPicker.tsx`/routing/command
  palette/dashboard, and the `"simcon"` view-router key → `"context"`.
  Leftover "Sim Con" UI copy (setup/detail titles, error text, Settings usage
  labels, the Conversations panel's rehearsal-session pill/tooltip) reworded
  to "Context" — the underlying `SessionSummary.simcon_title`/`is_rehearsal`
  JSONL fields are untouched (out of scope: persisted session metadata, not
  one of the 5 renamed core types).

### Testing

- `cargo test -p conva-core`: **<fill in from Task 5.1's actual count>**.
- `npm test`: **<fill in from Task 5.1's actual count>**.
- `npm run build`: clean.
- `cargo fmt --check` / `cargo clippy -p conva-core --all-targets -- -D warnings`: clean.
- Shell (`src-tauri/`) isn't locally compilable in this sandbox — every
  shell-touching task in the plan carries a manual cross-check (all 13
  `#[tauri::command] fn` ↔ `generate_handler!` pairs verified by name, a
  repo-wide `simcon` grep sweep with an explicit allowlist for the 3
  intentionally-preserved compat sites); CI's Windows job is the real
  compile gate — watch it.

### Manual QA checklist

- [ ] Every screen previously reachable via "Sim Con" wording (setup wizard,
      detail page, Settings usage table, Conversations panel tags, command
      palette "Go to Contexts") now reads "Context".
- [ ] Create, edit, generate resources, choose a persona, and start a
      rehearsal on a context — all work identically to before the rename.
- [ ] Settings → Usage shows historical `Sim Con · …` rows (recorded under
      the old `simcon_*` keys before this change) still rendering with a
      real label, not a raw key string.
```

  Use `mcp__github__issue_write` (method `create`) for Step 1, then `mcp__github__create_pull_request` (`draft: true`, `head: "claude/conva-app-ui-modernization-igllsd"`, `base: "main"`) for Step 2, filling in the real issue number and Task 5.1's real test counts into the template above before submitting either call — no `<fill in>`/`<issue>` placeholders in what actually gets posted.

- [ ] **Step 3: Confirm.** Fetch the new PR (`pull_request_read`, method `get`) and confirm the body matches what was submitted.

### Task 5.4: Watch CI

**Files:** none.

- [ ] **Step 1: Subscribe to PR activity** on the new PR from Task 5.3 (`mcp__github__subscribe_pr_activity`) so CI results and any review comments arrive as events.
- [ ] **Step 2: Wait for the Windows shell-clippy job specifically** — it's the only real compile gate for Phase 2's changes in this plan. On failure, the most likely causes, in order of likelihood given this plan's risk profile: (a) a missed `generate_handler!`/`fn` name pairing (re-run Task 2.6 Step 2's cross-check loop), (b) a missed `conva_core::simcon::` import path in a file outside the 5 shell files this plan touched (re-run a repo-wide `grep -rn 'conva_core::simcon' src-tauri/`), (c) a stray bare `SimConSession`/`SimConPersona`/etc. token Step 2's `sed` patterns didn't reach because it wasn't whole-word-bounded correctly (re-run the file's grep-confirm step from whichever task owns it).

---

## Self-review notes

**Spec coverage:**
- Spec §"Rust — `crates/conva-core`" (module rename, 5 type renames, fn signatures, `highlight.rs` check) → Phase 1, Task 1.2 (all steps) + the Architecture section's note that `highlight.rs` needed zero changes (confirmed empty, not assumed).
- Spec §"Rust — `src-tauri`" (module rename, 13 commands + `generate_handler!`, metering keys) → Phase 2, Tasks 2.1–2.2 + 2.6. The two sites the spec's inventory didn't list but investigation found necessary (`rehearsal.rs`, `web.rs`) → Tasks 2.3–2.4, called out explicitly in the Architecture section so the gap is visible, not silently patched over.
- Spec §"TypeScript — `src/lib`" (`ipc.ts`'s 5 types, `commands.ts`/`backend/*.ts`'s `simcon` namespace) → Phase 3, Tasks 3.1–3.3.
- Spec §"TypeScript — `src/components`" (folder + file renames, all listed importers, the view-router key, leftover copy) → Phase 4, Tasks 4.1–4.4. Every file the spec explicitly named (`ContextsView.tsx`, `ContextsPane.tsx`, `ConversationsPanel.tsx`, `ViewRouter.tsx`, `CommandPalette.tsx`, `DashboardView.tsx`, `GroundPicker.tsx` + test, `SettingsPanel.tsx`, `Icon.tsx`'s comment, `ViewShell.tsx`'s comment, `ContextsPane.test.tsx`) has a task; investigation additionally found `readiness.ts`/`.test.ts`, `rowStatus.ts`/`.test.ts`, `StudioShell.tsx`, `nav.ts`, `navItems.ts`, `contextsQuickOpen.ts`, `libraryQuickAdd.ts`, `TranscriptView.tsx`, and `state/app.ts` — all covered (Tasks 4.2–4.4).
- Spec §"Out of scope" (Conversation/`conversations.rs`, `HighlightContext`, historical usage-data file migration, no behavior change) → respected throughout: `conversations.rs` is never modified by this plan (only `ConversationsPanel.tsx`'s **display text**, built from data `Conversation`/`SessionSummary` already expose, is touched); `highlight.rs` confirmed untouched; metering keys keep historical data readable via the permanent dual-key label map (Task 4.4 Step 5) rather than migrating anything; the 3 explicit scope decisions in the Architecture section (on-disk directory/id-prefix untouched, `SessionSummary` fields untouched, shell-side `session` locals untouched) each document a place this plan deliberately did *less* than a maximal token-for-token rename would, specifically to keep it a true zero-behavior-change rename.
- Spec §"Testing" → Task 1.1 (baseline), and a post-phase gate after every phase (Tasks 1.2 Step 9, 2.6 Step 4, 3.4 Step 1, 4.4 Step 13, 5.1 Step 1) plus Phase 5's manual-QA checklist verbatim from the spec's Testing section, carried into the PR body.
- Spec §"Phasing" (5 phases, specific gates per phase) → matched exactly: Phase 1 one commit + `cargo test -p conva-core` gate; Phase 2 one commit + fmt/manual-cross-check gate (no local compile); Phase 3 one commit + `npm run build` gate; Phase 4 three commits by area (component files; contexts/ importers + routing — split into two tasks, 4.2 and 4.3, since routing turned out substantial enough to warrant its own commit and gate — plus leftover copy) + `npm test`/`npm run build` gate after each; Phase 5 full verification + push + a new issue + draft PR (updated post-write, per the Phase 5 header note — PR #95 merged while this plan was being written, so the branch was restarted and this is now fresh follow-up work, not an update to a still-open PR).

**Placeholder scan:** Searched this plan for "TBD"/"TODO"/"handle appropriately"/"similar to above"/"write tests for the above" — none found. Every step that changes code shows the actual current text (verified against the real files read during investigation) and the actual new text. The `sed`-based steps are the one deliberate departure from literal before/after blocks for every single line — used only for genuinely mechanical, exhaustively-enumerated whole-word token substitutions (never for anything requiring judgment), each with an explicit list of exactly which occurrences it covers and a grep-confirm step immediately after to prove nothing was missed and nothing extra was hit. This is not a placeholder — every substitution is a complete, unambiguous, closed specification, not a vague instruction.

**Type consistency:** Traced every renamed symbol across every task that references it later:
- `ConversationContext` (from `SimConSession`) — defined Phase 1 Task 1.2; re-imported identically in Phase 2 Tasks 2.1–2.3 (shell), Phase 3 Tasks 3.1–3.3 (TS mirror + backend), Phase 4 Tasks 4.1–4.2 (components) — field names on it (`title`, `purpose`, `category`, `job_description`, `source_doc_ids`, etc.) are never renamed anywhere, only the type's own name, so every later reference compiles against the same shape.
- `ContextCategory`/`ContextStatus`/`ContextPersona`/`ContextSummary` — same pattern, traced through every later task's imports and usages.
- The 13 Tauri command names (`context_save` … `context_rehearsal_say`) — defined + paired with `generate_handler!` in Phase 2 Task 2.2; every TS `invoke("context_...")` string in Phase 3 Task 3.2 matches character-for-character (checked against the table in Task 2.2 Step 3 while writing Task 3.2).
- `backend.context.*` namespace — the interface (Task 3.3 Step 2), the desktop adapter (Step 3), and the web stub (Step 5) all declare the identical method set (`save`, `list`, `load`, `delete`, `activateContext`, `deactivateContext`, `storeDocs`, `prepare`, `loadProfile`, `generateDossier`, `generatePersonas`, `choosePersona`, `startRehearsal`, `rehearsalYourTurn`, `rehearsalSay`, `setResearchKey`, `researchKeyStatus`) — every later `backend.context.*` call site in Phase 4 (Tasks 4.1, 4.2, 4.4) calls a method from exactly this set, none invented.
- The one deliberate **asymmetry**, flagged explicitly at Task 3.2 Step 3: `contextSave`'s `invoke` payload key stays `session` (matching the Rust command's own unrenamed parameter name, scope decision 3) even though the JS-side function/parameter is named `context` — this is the single spot in the whole plan where a symbol's TS-visible name and its wire-level key diverge, and it's called out inline specifically because it's the kind of one-character-off mismatch that compiles fine on both sides and only fails at runtime.
- The `"context"` view-router string — defined in `nav.ts`'s `View` union (Task 4.3 Step 2), then used identically in `navItems.ts`, `ViewRouter.tsx`, `CommandPalette.tsx` (×4), `DashboardView.tsx`, and — found one task later, in Task 4.4 Step 1 — `ConversationsPanel.tsx`'s `rehearse()` function. Task 4.3 Step 10 deliberately uses the TS compiler itself (a stray `"simcon"` literal becomes a type error once the `View` union no longer contains it) to catch exactly this kind of straggler, rather than relying solely on grep.
- `sample_context` (from `sample_session`) — Phase 1 Task 1.2 Step 2's `sed` renames the 1 definition + all 14 call sites in the same pass, so there's no later task that could reference the old name.

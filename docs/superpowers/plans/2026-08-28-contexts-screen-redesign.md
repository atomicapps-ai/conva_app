# Contexts Screen Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the Contexts screen (owner-approved spec:
`docs/superpowers/specs/2026-08-28-contexts-screen-redesign-design.md`) —
a resizable centerline between the Contexts/Library panes, a redesigned
full-width two-line context row with four direct action icons and
hover-tooltip detail (replacing today's expand/collapse + `⋮` menu), and
a collapsed-by-default accordion for `ContextDetail.tsx`'s three sections
with hover tooltips replacing always-visible explainer prose.

**Architecture:** Two small Rust data-model additions
(`RagDocument.size_bytes`, `ConversationContext`/`ContextSummary`
`resources_generated_at_unix_ms`), mirrored Rust→TS in the same commit per
CLAUDE.md rule 2, back these new hover tooltips. Three new pure,
unit-tested frontend utilities (`formatBytes`, `formatRelativeTime`,
`toggleDetailSection`) carry the display logic. Everything else is a
targeted rewrite of `ContextsPane.tsx`'s row markup and `ContextDetail.tsx`'s
section structure, reusing patterns already established elsewhere in the
app (`TranscriptView.tsx`'s pointer-drag resize handle,
`panelSections.ts`'s exclusive-accordion shape) rather than inventing new
ones.

**Tech Stack:** Rust (Tauri 2 shell + `conva-core`), React 19 + TypeScript,
Zustand, Vitest + Testing Library, `cargo test`/`clippy`/`fmt`.

**Testing note (TDD shape for this plan):** every new *pure* function
(Rust or TS) gets a written-first unit test per this repo's convention.
UI-wiring steps (JSX changes) are not separately unit-tested line-by-line
where an existing component test file already covers the behavior class —
those get updated/extended test coverage in the same task as the code
change, run immediately after, rather than a separate red/green pair (this
mirrors how this repo's prior plans, e.g. `2026-08-27-context-documents-generated-display.md`,
treated UI-wiring tasks). `src-tauri/` (the shell crate) **cannot be
compiled locally in this sandbox** (no GDK dev libs) — `cargo fmt --check`
+ `cargo clippy -p conva-core` (core only, the shell crate isn't
buildable) + careful manual review are the local gates for every
shell-touching task; CI's Windows job is the real compile gate, exactly as
already established and successfully used for PR #110's shell changes
this session.

---

## Phase 1: Rust core data model (`crates/conva-core`)

### Task 1.1: `RagDocument.size_bytes`

**Files:**
- Modify: `crates/conva-core/src/rag.rs:30-45` (the `RagDocument` struct)
- Modify: `crates/conva-core/src/context.rs` (2 test-helper struct literals that construct `RagDocument`)

- [ ] **Step 1: Add the field.** Before (`crates/conva-core/src/rag.rs:28-45`):

```rust
/// A document registered in the RAG library (U5).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RagDocument {
    pub id: String,
    pub file_name: String,
    /// Whether this document participates in retrieval (per-doc toggle, U5).
    pub enabled: bool,
    pub chunk_count: u32,
    pub ingested_at_unix_ms: u64,
    /// Provenance — see [`DocSource`].
    #[serde(default)]
    pub source: DocSource,
    /// Conversation Context ids this document is attached to (a doc can
    /// ground more than one context). Empty for library documents not
    /// attached to any context. Drives the library's "In this context" filter.
    #[serde(default)]
    pub context_ids: Vec<String>,
}
```

  After:

```rust
/// A document registered in the RAG library (U5).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RagDocument {
    pub id: String,
    pub file_name: String,
    /// Whether this document participates in retrieval (per-doc toggle, U5).
    pub enabled: bool,
    pub chunk_count: u32,
    pub ingested_at_unix_ms: u64,
    /// Provenance — see [`DocSource`].
    #[serde(default)]
    pub source: DocSource,
    /// Conversation Context ids this document is attached to (a doc can
    /// ground more than one context). Empty for library documents not
    /// attached to any context. Drives the library's "In this context" filter.
    #[serde(default)]
    pub context_ids: Vec<String>,
    /// Content size in bytes (Contexts-screen-redesign spec, requirement 6)
    /// — the real on-disk file size for a file-sourced document, or the
    /// ingested text's byte length for pasted/generated content (see
    /// `store_text_document` in `src-tauri/src/rag.rs` for exactly which,
    /// per source). `#[serde(default)]` gives `0` for documents ingested
    /// before this field existed — same backward-compat pattern `source`
    /// above already uses. UI formats this with `formatBytes()`
    /// (`src/lib/formatBytes.ts`), never displays the raw number.
    #[serde(default)]
    pub size_bytes: u64,
}
```

- [ ] **Step 2: Fix the two test-helper struct literals this breaks.** `cargo test -p conva-core` won't compile until these are updated — Rust struct literals must list every field regardless of `#[serde(default)]` (that attribute only affects deserialization, not literal construction). Before (`crates/conva-core/src/context.rs`, inside `mod tests`, the `generated_doc` helper added earlier this session for the orphaned-doc cleanup):

```rust
    fn generated_doc(id: &str, context_ids: Vec<String>) -> RagDocument {
        RagDocument {
            id: id.into(),
            file_name: format!("{id}.md"),
            enabled: true,
            chunk_count: 3,
            ingested_at_unix_ms: 0,
            source: DocSource::Generated,
            context_ids,
        }
    }
```

  After:

```rust
    fn generated_doc(id: &str, context_ids: Vec<String>) -> RagDocument {
        RagDocument {
            id: id.into(),
            file_name: format!("{id}.md"),
            enabled: true,
            chunk_count: 3,
            ingested_at_unix_ms: 0,
            source: DocSource::Generated,
            context_ids,
            size_bytes: 1024,
        }
    }
```

  Before (same test module, the inline `File`-sourced literal in
  `orphaned_generated_doc_ids_keeps_only_currently_claimed_docs`):

```rust
            RagDocument {
                id: "doc-user-file".into(),
                file_name: "resume.pdf".into(),
                enabled: true,
                chunk_count: 5,
                ingested_at_unix_ms: 0,
                source: DocSource::File,
                context_ids: vec!["s1".into()],
            },
```

  After:

```rust
            RagDocument {
                id: "doc-user-file".into(),
                file_name: "resume.pdf".into(),
                enabled: true,
                chunk_count: 5,
                ingested_at_unix_ms: 0,
                source: DocSource::File,
                context_ids: vec!["s1".into()],
                size_bytes: 51200,
            },
```

- [ ] **Step 3: Compile-check core.**

Run: `cargo test -p conva-core 2>&1 | tail -20`
Expected: builds clean, `128 passed` (unchanged count — no tests added or removed by this step, just a struct literal fix).

- [ ] **Step 4: Commit.**

```bash
git add crates/conva-core/src/rag.rs crates/conva-core/src/context.rs
git commit -m "feat(rag): add RagDocument.size_bytes"
```

(standard trailer.)

### Task 1.2: `resources_generated_at_unix_ms` on `ConversationContext` + `ContextSummary`

**Files:**
- Modify: `crates/conva-core/src/context.rs` (both struct defs + 2 test-helper `ConversationContext` literals)

- [ ] **Step 1: Add the field to `ConversationContext`.** Before (the end of the struct, per this session's own earlier reading):

```rust
    /// True when grounding inputs changed after resources were generated —
    /// the digest/glossary no longer reflect the inputs (cleared by a
    /// successful regeneration). Optional: older records omit it.
    pub resources_stale: bool,
}
```

  After:

```rust
    /// True when grounding inputs changed after resources were generated —
    /// the digest/glossary no longer reflect the inputs (cleared by a
    /// successful regeneration). Optional: older records omit it.
    pub resources_stale: bool,
    /// When Stage 1-3 (`generateDossier`) last actually ran, if ever
    /// (Contexts-screen-redesign spec, requirement 5). Deliberately
    /// separate from `updated_at_unix_ms`, which also bumps on a plain
    /// title/purpose edit — reusing it would make a "last regenerated"
    /// tooltip lie. `None` until the first regenerate.
    #[serde(default)]
    pub resources_generated_at_unix_ms: Option<u64>,
}
```

  Find the exact field this precedes by running `grep -n "pub resources_stale: bool," crates/conva-core/src/context.rs` first — this struct has changed shape several times this session (SimCon→Context rename, deep-QA fields); confirm the field ordering matches the current file before applying, and add the new field as the struct's last field regardless of exact surrounding order if it doesn't match verbatim.

- [ ] **Step 2: Add the mirrored field to `ContextSummary`** (the list-view projection `ContextsPane.tsx` actually renders from — the row's regenerate-tooltip needs it here, not just on the full record). Before:

```rust
    /// Mirrors [`ConversationContext::resources_stale`] for the list row's pill.
    #[serde(default)]
    pub resources_stale: bool,
}
```

  After:

```rust
    /// Mirrors [`ConversationContext::resources_stale`] for the list row's pill.
    #[serde(default)]
    pub resources_stale: bool,
    /// Mirrors [`ConversationContext::resources_generated_at_unix_ms`] for
    /// the list row's Regenerate-icon tooltip.
    #[serde(default)]
    pub resources_generated_at_unix_ms: Option<u64>,
}
```

- [ ] **Step 3: Fix the two `ConversationContext` test-helper literals this breaks.** Before (`sample_context()`, in `mod tests`):

```rust
            deep_qa_enabled: false,
            qa_doc_id: None,
            resources_stale: false,
        }
    }
```

  After:

```rust
            deep_qa_enabled: false,
            qa_doc_id: None,
            resources_stale: false,
            resources_generated_at_unix_ms: None,
        }
    }
```

  Before (`grounding_base()`, in `mod tests`):

```rust
            dossier_doc_id: Some("dossier-1".into()),
            research_doc_id: None,
            deep_qa_enabled: false,
            qa_doc_id: None,
            resources_stale: false,
        }
```

  After:

```rust
            dossier_doc_id: Some("dossier-1".into()),
            research_doc_id: None,
            deep_qa_enabled: false,
            qa_doc_id: None,
            resources_stale: false,
            resources_generated_at_unix_ms: None,
        }
```

- [ ] **Step 4: Compile-check core.**

Run: `cargo test -p conva-core 2>&1 | tail -20`
Expected: builds clean, `128 passed`.

- [ ] **Step 5: `cargo fmt` + clippy.**

```bash
cargo fmt && cargo fmt --check
cargo clippy -p conva-core --all-targets -- -D warnings
```

Expected: both clean (no diff, no warnings).

- [ ] **Step 6: Commit.**

```bash
git add crates/conva-core/src/context.rs
git commit -m "feat(context): add resources_generated_at_unix_ms to ConversationContext + ContextSummary"
```

(standard trailer.)

---

## Phase 2: Rust shell wiring (`src-tauri`)

### Task 2.1: `size_bytes` at every ingest path

**Files:**
- Modify: `src-tauri/src/rag.rs:303-435` (`ingest`, `ingest_text`, `ingest_generated`, `store_text_document`)

- [ ] **Step 1: Thread a `size_bytes: u64` parameter through `store_text_document`** — it's the single shared tail all three public ingest functions funnel through, so the field only needs setting in one place, but each caller computes a *different* correct value (a file's real on-disk size differs from its extracted text length for PDF/DOCX — using `text.len()` everywhere would under-report anything with formatting/images stripped out). Before:

```rust
    /// Shared tail for file, pasted-text, and generated ingestion: chunk,
    /// embed (best-effort), retain the original, persist, and rebuild the
    /// index.
    fn store_text_document(
        &self,
        file_name: String,
        text: String,
        original: Original,
        source: DocSource,
        mut warnings: Vec<String>,
    ) -> Result<IngestReport, CoreError> {
```

  After:

```rust
    /// Shared tail for file, pasted-text, and generated ingestion: chunk,
    /// embed (best-effort), retain the original, persist, and rebuild the
    /// index. `size_bytes` is the caller's job to compute correctly — a
    /// file's real on-disk size differs from its extracted text length
    /// (PDF/DOCX strip formatting/images), so this shared tail can't derive
    /// it uniformly from `text` alone.
    fn store_text_document(
        &self,
        file_name: String,
        text: String,
        original: Original,
        source: DocSource,
        size_bytes: u64,
        mut warnings: Vec<String>,
    ) -> Result<IngestReport, CoreError> {
```

- [ ] **Step 2: Set the field in the `RagDocument` literal.** Before:

```rust
        let stored = StoredDocument {
            document: RagDocument {
                id: id.clone(),
                file_name,
                enabled: true,
                chunk_count: chunks.len() as u32,
                ingested_at_unix_ms: crate::session::now_unix_ms(),
                source,
                context_ids: Vec::new(),
            },
```

  After:

```rust
        let stored = StoredDocument {
            document: RagDocument {
                id: id.clone(),
                file_name,
                enabled: true,
                chunk_count: chunks.len() as u32,
                ingested_at_unix_ms: crate::session::now_unix_ms(),
                source,
                context_ids: Vec::new(),
                size_bytes,
            },
```

- [ ] **Step 3: Update the three callers.** Before (`ingest`, the file path):

```rust
    pub fn ingest(&self, path: &str) -> Result<IngestReport, CoreError> {
        let source = Path::new(path);
        let file_name = source
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("document")
            .to_string();

        let (text, warnings) = extract_text(source)?;
        self.store_text_document(
            file_name,
            text,
            Original::File(source),
            DocSource::File,
            warnings,
        )
    }
```

  After:

```rust
    pub fn ingest(&self, path: &str) -> Result<IngestReport, CoreError> {
        let source = Path::new(path);
        let file_name = source
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("document")
            .to_string();

        let (text, warnings) = extract_text(source)?;
        // The real on-disk file size, not the extracted text's byte length
        // — a PDF/DOCX's formatting/images make those meaningfully
        // different. Falls back to the extracted text's length only if the
        // metadata read itself fails (rare — the file was just read).
        let size_bytes = fs::metadata(source)
            .map(|m| m.len())
            .unwrap_or(text.len() as u64);
        self.store_text_document(
            file_name,
            text,
            Original::File(source),
            DocSource::File,
            size_bytes,
            warnings,
        )
    }
```

  Before (`ingest_text`, the pasted path):

```rust
    pub fn ingest_text(&self, name: &str, text: &str) -> Result<IngestReport, CoreError> {
        if text.trim().is_empty() {
            return Err(CoreError::Rag("no text to add".into()));
        }
        self.store_text_document(
            normalize_txt_name(name),
            text.to_string(),
            Original::PastedText,
            DocSource::Pasted,
            Vec::new(),
        )
    }
```

  After:

```rust
    pub fn ingest_text(&self, name: &str, text: &str) -> Result<IngestReport, CoreError> {
        if text.trim().is_empty() {
            return Err(CoreError::Rag("no text to add".into()));
        }
        // No original file for pasted text — the text itself IS the content,
        // so its byte length is the real size.
        let size_bytes = text.len() as u64;
        self.store_text_document(
            normalize_txt_name(name),
            text.to_string(),
            Original::PastedText,
            DocSource::Pasted,
            size_bytes,
            Vec::new(),
        )
    }
```

  Before (`ingest_generated`, the Ally-written path):

```rust
    pub fn ingest_generated(
        &self,
        name: &str,
        text: &str,
        context_id: &str,
    ) -> Result<IngestReport, CoreError> {
        if text.trim().is_empty() {
            return Err(CoreError::Rag("no text to add".into()));
        }
        let mut report = self.store_text_document(
            normalize_txt_name(name),
            text.to_string(),
            Original::PastedText,
            DocSource::Generated,
            Vec::new(),
        )?;
        self.attach_context(&report.document.id, context_id)?;
        report.document.context_ids = vec![context_id.to_string()];
        Ok(report)
    }
```

  After:

```rust
    pub fn ingest_generated(
        &self,
        name: &str,
        text: &str,
        context_id: &str,
    ) -> Result<IngestReport, CoreError> {
        if text.trim().is_empty() {
            return Err(CoreError::Rag("no text to add".into()));
        }
        // Same reasoning as ingest_text — generated content has no
        // separate "original file", the text is the content.
        let size_bytes = text.len() as u64;
        let mut report = self.store_text_document(
            normalize_txt_name(name),
            text.to_string(),
            Original::PastedText,
            DocSource::Generated,
            size_bytes,
            Vec::new(),
        )?;
        self.attach_context(&report.document.id, context_id)?;
        report.document.context_ids = vec![context_id.to_string()];
        Ok(report)
    }
```

- [ ] **Step 4: Write a test proving the file path uses the real file size, not the extracted-text length.** `src-tauri/src/rag.rs`'s test module already has `ingest_text_stores_pasted_note_as_txt` as a close pattern to mirror — add this new test right after it:

```rust
    #[test]
    fn ingest_captures_size_bytes_per_source() {
        let dir = std::env::temp_dir().join(format!("conva-size-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        let store = RagStore::open(&dir).unwrap();

        // Pasted text — size_bytes is the text's own byte length.
        let text = "All parts carry a 5 year warranty.";
        let pasted = store.ingest_text("Warranty terms", text).unwrap();
        assert_eq!(pasted.document.size_bytes, text.len() as u64);

        // A real file — size_bytes is the file's on-disk size, which for a
        // plain .txt equals its content length (proving the metadata path
        // works, not just falling through to the text-length fallback).
        let file_path = dir.join("notes.txt");
        let content = "Some notes about the meeting agenda and attendees.";
        fs::write(&file_path, content).unwrap();
        let filed = store.ingest(file_path.to_str().unwrap()).unwrap();
        assert_eq!(filed.document.size_bytes, content.len() as u64);

        let _ = fs::remove_dir_all(&dir);
    }
```

- [ ] **Step 5: `cargo fmt` + manual review** (this crate doesn't compile locally — see the plan header's testing note).

```bash
cargo fmt
cargo fmt --check
```

Expected: clean. Re-read the full diff of `src-tauri/src/rag.rs` once more end to end before moving on — confirm every `store_text_document(` call site (all 3, plus none elsewhere:
`grep -n "store_text_document(" src-tauri/src/rag.rs` should show exactly 4 lines — the `fn` definition + 3 call sites) passes its new `size_bytes` argument in the right position (5th positional arg, right after `source`, before `warnings`).

- [ ] **Step 6: Commit.**

```bash
git add src-tauri/src/rag.rs
git commit -m "feat(rag): compute size_bytes at every ingest path"
```

(standard trailer.)

### Task 2.2: `resources_generated_at_unix_ms` wiring

**Files:**
- Modify: `src-tauri/src/context.rs` (`ensure_default_context`'s literal, `list()`'s projection)
- Modify: `src-tauri/src/lib.rs` (`context_generate_dossier`)

- [ ] **Step 1: Set the field on `ensure_default_context`'s literal.** Before:

```rust
            dossier_doc_id: Some(doc_id),
            research_doc_id: None,
            resources_stale: false,
        },
    )?;
    Ok(())
}
```

  After:

```rust
            dossier_doc_id: Some(doc_id),
            research_doc_id: None,
            resources_stale: false,
            resources_generated_at_unix_ms: None,
        },
    )?;
    Ok(())
}
```

- [ ] **Step 2: Project the field in `list()`'s `ContextSummary` mapping.** Before:

```rust
        out.push(ContextSummary {
            id: s.id,
            title: s.title,
            category: s.category,
            status: s.status,
            created_at_unix_ms: s.created_at_unix_ms,
            updated_at_unix_ms: s.updated_at_unix_ms,
            source_doc_count: s.source_doc_ids.len() as u32,
            has_key_terms: !s.key_terms.is_empty(),
            research_enabled: s.research_enabled,
            has_job_description: s
                .job_description
                .as_deref()
                .is_some_and(|jd| !jd.trim().is_empty()),
            has_generated_resources: s.dossier_doc_id.is_some(),
            resources_stale: s.resources_stale,
        });
```

  After:

```rust
        out.push(ContextSummary {
            id: s.id,
            title: s.title,
            category: s.category,
            status: s.status,
            created_at_unix_ms: s.created_at_unix_ms,
            updated_at_unix_ms: s.updated_at_unix_ms,
            source_doc_count: s.source_doc_ids.len() as u32,
            has_key_terms: !s.key_terms.is_empty(),
            research_enabled: s.research_enabled,
            has_job_description: s
                .job_description
                .as_deref()
                .is_some_and(|jd| !jd.trim().is_empty()),
            has_generated_resources: s.dossier_doc_id.is_some(),
            resources_stale: s.resources_stale,
            resources_generated_at_unix_ms: s.resources_generated_at_unix_ms,
        });
```

- [ ] **Step 3: Set the field in `context_generate_dossier`, right before its final save.** Before (`src-tauri/src/lib.rs`, the end of the function — the plan for Phase 2's earlier PR #110 work already read this exact tail this session):

```rust
    // One profile save covers all three stages (Stage 1's document + Stage
    // 2's research/findings doc + Stage 3's Q&A doc, whichever ran).
    profile.updated_at_unix_ms = session::now_unix_ms();
    context::save_profile(&app, &profile).map_err(|e| e.to_string())?;

    context::save(&app, session).map_err(|e| e.to_string())
}
```

  After:

```rust
    // One profile save covers all three stages (Stage 1's document + Stage
    // 2's research/findings doc + Stage 3's Q&A doc, whichever ran).
    profile.updated_at_unix_ms = session::now_unix_ms();
    context::save_profile(&app, &profile).map_err(|e| e.to_string())?;

    // Contexts-screen-redesign spec, requirement 5 — records when the
    // dossier pipeline actually ran, distinct from `updated_at_unix_ms`
    // (which also bumps on a plain title/purpose edit).
    session.resources_generated_at_unix_ms = Some(session::now_unix_ms());
    context::save(&app, session).map_err(|e| e.to_string())
}
```

- [ ] **Step 4: `cargo fmt` + manual review** (shell crate doesn't compile locally).

```bash
cargo fmt
cargo fmt --check
```

Expected: clean. Manually re-check `src-tauri/src/context.rs`'s `ConversationContext {` and `ContextSummary {` literals one more time —
`grep -n "ConversationContext {\|ContextSummary {" src-tauri/src/context.rs` — both should now include `resources_generated_at_unix_ms`.

- [ ] **Step 5: Commit.**

```bash
git add src-tauri/src/context.rs src-tauri/src/lib.rs
git commit -m "feat(context): set resources_generated_at_unix_ms on regenerate"
```

(standard trailer.)

---

## Phase 3: TypeScript IPC mirror

### Task 3.1: Mirror both fields, fix the 3 test literals they break

**Files:**
- Modify: `src/lib/ipc.ts` (`RagDocument`, `ConversationContext`, `ContextSummary`)
- Modify: `src/components/context/documentSplit.test.ts` (1 `RagDocument` literal)
- Modify: `src/components/context/ContextSetup.test.tsx` (2 `RagDocument` literals)

- [ ] **Step 1: `RagDocument`.** Before:

```ts
export interface RagDocument {
  id: string;
  file_name: string;
  enabled: boolean;
  chunk_count: number;
  ingested_at_unix_ms: number;
  source: DocSource;
  /** Conversation Context ids this document is attached to. */
  context_ids: string[];
}
```

  After:

```ts
export interface RagDocument {
  id: string;
  file_name: string;
  enabled: boolean;
  chunk_count: number;
  ingested_at_unix_ms: number;
  source: DocSource;
  /** Conversation Context ids this document is attached to. */
  context_ids: string[];
  /** Content size in bytes — real file size for a file-sourced document,
   *  ingested text length for pasted/generated. Format with
   *  `formatBytes()` (`@/lib/formatBytes`), never display the raw number. */
  size_bytes: number;
}
```

- [ ] **Step 2: `ConversationContext`.** Before:

```ts
  /** True when grounding inputs changed after resources were generated —
   * the digest/glossary no longer reflect the inputs (cleared by a
   * successful regeneration). Optional: older records omit it. */
  resources_stale?: boolean;
}
```

  After:

```ts
  /** True when grounding inputs changed after resources were generated —
   * the digest/glossary no longer reflect the inputs (cleared by a
   * successful regeneration). Optional: older records omit it. */
  resources_stale?: boolean;
  /** When Stage 1-3 (generateDossier) last actually ran, if ever. Distinct
   *  from updated_at_unix_ms (which also bumps on a plain edit) — this is
   *  what the row's Regenerate-icon tooltip reads. null until the first
   *  regenerate. */
  resources_generated_at_unix_ms?: number | null;
}
```

- [ ] **Step 3: `ContextSummary`.** Before:

```ts
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

  After:

```ts
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
  /** Mirrors ConversationContext.resources_generated_at_unix_ms for the
   *  list row's Regenerate-icon tooltip. */
  resources_generated_at_unix_ms?: number | null;
}
```

- [ ] **Step 4: Confirm the type-checker now flags the 3 broken test literals.**

Run: `npm run build 2>&1 | grep -A2 "size_bytes\|TS2741\|TS2739"`
Expected: errors in `documentSplit.test.ts` and `ContextSetup.test.tsx` about a missing `size_bytes` property (this confirms the type change is live and these are the only breakages — if a 4th site shows up, fix it too, following the same pattern below).

- [ ] **Step 5: Fix `documentSplit.test.ts`.** Before:

```ts
function doc(overrides: Partial<RagDocument> = {}): RagDocument {
  return {
    id: "d1",
    file_name: "doc.txt",
    enabled: true,
    chunk_count: 1,
    ingested_at_unix_ms: 0,
    source: "file",
    context_ids: [],
    ...overrides,
  };
}
```

  After:

```ts
function doc(overrides: Partial<RagDocument> = {}): RagDocument {
  return {
    id: "d1",
    file_name: "doc.txt",
    enabled: true,
    chunk_count: 1,
    ingested_at_unix_ms: 0,
    source: "file",
    context_ids: [],
    size_bytes: 0,
    ...overrides,
  };
}
```

- [ ] **Step 6: Fix `ContextSetup.test.tsx`'s two `genDoc` literals** (both share this exact shape — confirm with
  `grep -n "chunk_count: 3," src/components/context/ContextSetup.test.tsx`, should show 2 hits). Before (each occurrence):

```ts
    const genDoc = {
      id: "g1",
      file_name: "Amazon Interview — Context knowledge",
      enabled: true,
      chunk_count: 3,
      ingested_at_unix_ms: 0,
      source: "generated" as const,
      context_ids: ["s1"],
    };
```

  After (each occurrence):

```ts
    const genDoc = {
      id: "g1",
      file_name: "Amazon Interview — Context knowledge",
      enabled: true,
      chunk_count: 3,
      ingested_at_unix_ms: 0,
      source: "generated" as const,
      context_ids: ["s1"],
      size_bytes: 2048,
    };
```

- [ ] **Step 7: Full build check.**

Run: `npm run build`
Expected: clean, zero errors.

- [ ] **Step 8: Run the full test suite as a gut-check.**

Run: `npm test -- --run`
Expected: `185 passed` (unchanged — no tests added/removed this task).

- [ ] **Step 9: Commit.**

```bash
git add src/lib/ipc.ts src/components/context/documentSplit.test.ts src/components/context/ContextSetup.test.tsx
git commit -m "feat(ipc): mirror size_bytes + resources_generated_at_unix_ms"
```

(standard trailer.)

---

## Phase 4: New pure frontend utilities

### Task 4.1: `formatBytes`

**Files:**
- Create: `src/lib/formatBytes.ts`
- Test: `src/lib/formatBytes.test.ts`

- [ ] **Step 1: Write the failing test.**

```ts
import { describe, expect, it } from "vitest";

import { formatBytes } from "@/lib/formatBytes";

describe("formatBytes", () => {
  it("shows plain bytes with no decimal", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(5)).toBe("5 B");
    expect(formatBytes(850)).toBe("850 B");
  });

  it("scales to KB, dropping the decimal once the number is >= 10", () => {
    expect(formatBytes(15_400)).toBe("15 KB");
    expect(formatBytes(219_000)).toBe("214 KB");
  });

  it("scales to MB, keeping one decimal under 10 and dropping it at 10+", () => {
    expect(formatBytes(1_258_000)).toBe("1.2 MB");
    expect(formatBytes(45_000_000)).toBe("43 MB");
  });

  it("scales to GB for very large totals", () => {
    expect(formatBytes(5_000_000_000)).toBe("4.7 GB");
  });

  it("caps at GB rather than continuing to TB", () => {
    expect(formatBytes(5_000_000_000_000)).toBe("4657 GB");
  });
});
```

- [ ] **Step 2: Run it to confirm it fails.**

Run: `npm test -- --run src/lib/formatBytes.test.ts`
Expected: FAIL — `Cannot find module '@/lib/formatBytes'`.

- [ ] **Step 3: Implement.**

```ts
/**
 * Human-readable byte size, auto-scaled so the number itself never runs
 * long (Contexts-screen-redesign spec, requirement 6): whole numbers >= 10
 * in the chosen unit show no decimal; numbers < 10 get one decimal place.
 * Bytes never show a decimal (they're always whole). Caps at GB — a
 * personal document library has no realistic reason to reach TB.
 */
const UNITS = ["B", "KB", "MB", "GB"] as const;

export function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < UNITS.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const rounded =
    unitIndex === 0 || value >= 10
      ? Math.round(value)
      : Math.round(value * 10) / 10;
  return `${rounded} ${UNITS[unitIndex]}`;
}
```

- [ ] **Step 4: Run it to confirm it passes.**

Run: `npm test -- --run src/lib/formatBytes.test.ts`
Expected: PASS, all 5 cases.

- [ ] **Step 5: Commit.**

```bash
git add src/lib/formatBytes.ts src/lib/formatBytes.test.ts
git commit -m "feat(lib): add formatBytes"
```

(standard trailer.)

### Task 4.2: `formatRelativeTime`

**Files:**
- Create: `src/lib/relativeTime.ts`
- Test: `src/lib/relativeTime.test.ts`

- [ ] **Step 1: Write the failing test.**

```ts
import { describe, expect, it } from "vitest";

import { formatRelativeTime } from "@/lib/relativeTime";

const NOW = new Date("2026-08-28T12:00:00Z").getTime();

describe("formatRelativeTime", () => {
  it("shows 'just now' under a minute", () => {
    expect(formatRelativeTime(NOW - 30_000, NOW)).toBe("just now");
  });

  it("shows minutes under an hour", () => {
    expect(formatRelativeTime(NOW - 5 * 60_000, NOW)).toBe("5m ago");
  });

  it("shows hours under a day", () => {
    expect(formatRelativeTime(NOW - 3 * 3_600_000, NOW)).toBe("3h ago");
  });

  it("shows days under a month", () => {
    expect(formatRelativeTime(NOW - 6 * 86_400_000, NOW)).toBe("6d ago");
  });

  it("falls back to a short date beyond a month", () => {
    const overAMonthAgo = NOW - 40 * 86_400_000;
    const result = formatRelativeTime(overAMonthAgo, NOW);
    expect(result).not.toMatch(/ago$/);
    expect(result.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails.**

Run: `npm test -- --run src/lib/relativeTime.test.ts`
Expected: FAIL — `Cannot find module '@/lib/relativeTime'`.

- [ ] **Step 3: Implement.**

```ts
/**
 * "Xh ago"-style relative time (Contexts-screen-redesign spec, requirements
 * 5 & 3-4's "Updated Xh ago" row meta). `now` is injectable for tests;
 * defaults to the real clock. Falls back to a short absolute date once the
 * gap is more than a month — "42d ago" stops being a useful number.
 */
export function formatRelativeTime(
  unixMs: number,
  now: number = Date.now(),
): string {
  const diffSec = Math.floor((now - unixMs) / 1000);
  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}h ago`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 30) return `${diffDay}d ago`;
  return new Date(unixMs).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}
```

- [ ] **Step 4: Run it to confirm it passes.**

Run: `npm test -- --run src/lib/relativeTime.test.ts`
Expected: PASS, all 5 cases.

- [ ] **Step 5: Commit.**

```bash
git add src/lib/relativeTime.ts src/lib/relativeTime.test.ts
git commit -m "feat(lib): add formatRelativeTime"
```

(standard trailer.)

### Task 4.3: `toggleDetailSection` (ContextDetail's accordion model)

**Files:**
- Create: `src/components/context/detailSections.ts`
- Test: `src/components/context/detailSections.test.ts`

- [ ] **Step 1: Write the failing test.**

```ts
import { describe, expect, it } from "vitest";

import { toggleDetailSection } from "@/components/context/detailSections";

describe("toggleDetailSection", () => {
  it("opens a section from fully-collapsed", () => {
    expect(toggleDetailSection(null, "knowledge")).toBe("knowledge");
  });

  it("switches between sections (exclusive — only one open at a time)", () => {
    expect(toggleDetailSection("counterparty", "knowledge")).toBe("knowledge");
  });

  it("collapses the open section back to none when clicked again", () => {
    expect(toggleDetailSection("knowledge", "knowledge")).toBe(null);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails.**

Run: `npm test -- --run src/components/context/detailSections.test.ts`
Expected: FAIL — `Cannot find module '@/components/context/detailSections'`.

- [ ] **Step 3: Implement.**

```ts
/**
 * ContextDetail's accordion (Contexts-screen-redesign spec, requirement 8):
 * three sections, at most one expanded at a time. Mirrors the Live
 * cockpit's exclusive-accordion shape (panelSections.ts's `selectSection`)
 * but simpler — ContextDetail has no pinned/always-open section, so
 * clicking the currently-open one collapses back to all-closed instead of
 * being a no-op.
 */
export type DetailSectionId = "counterparty" | "knowledge" | "rehearse";

export function toggleDetailSection(
  current: DetailSectionId | null,
  id: DetailSectionId,
): DetailSectionId | null {
  return current === id ? null : id;
}
```

- [ ] **Step 4: Run it to confirm it passes.**

Run: `npm test -- --run src/components/context/detailSections.test.ts`
Expected: PASS, all 3 cases.

- [ ] **Step 5: Commit.**

```bash
git add src/components/context/detailSections.ts src/components/context/detailSections.test.ts
git commit -m "feat(context): add toggleDetailSection"
```

(standard trailer.)

### Task 4.4: Full-suite gate for Phase 4

- [ ] **Step 1: Run everything.**

```bash
npm test -- --run
npm run build
```

Expected: `198 passed` (185 baseline + 5 + 5 + 3 new tests), build clean.

---

## Phase 5: Resizable centerline

### Task 5.1: New persisted pref

**Files:**
- Modify: `src/state/uiPrefs.ts`

- [ ] **Step 1: Add the key + bounds constants.** Before:

```ts
const PANEL_SPLIT_KEY = "conva.panel.splitRatio";
const PANEL_WIDTH_KEY = "conva.panel.widthPx";
const ANSWERS_PINNED_KEY = "conva.panel.answersPinned";
const PANEL_OPEN_SECTION_KEY = "conva.panel.openSection";
const QUESTIONS_MODE_KEY = "conva.panel.questionsMode";
const PANEL_WIDTH_MIN = 280;
const PANEL_WIDTH_MAX = 560;
const PANEL_WIDTH_DEFAULT = 340;
```

  After:

```ts
const PANEL_SPLIT_KEY = "conva.panel.splitRatio";
const PANEL_WIDTH_KEY = "conva.panel.widthPx";
const ANSWERS_PINNED_KEY = "conva.panel.answersPinned";
const PANEL_OPEN_SECTION_KEY = "conva.panel.openSection";
const QUESTIONS_MODE_KEY = "conva.panel.questionsMode";
const PANEL_WIDTH_MIN = 280;
const PANEL_WIDTH_MAX = 560;
const PANEL_WIDTH_DEFAULT = 340;
// Contexts screen's Contexts-pane width — the resizable centerline
// (Contexts-screen-redesign spec, requirement 7). Same width-px pattern as
// panelWidthPx above (Library flexes to fill the rest), not a 0-1 ratio —
// mirrors TranscriptView's AllyPanel resize handle exactly. Default ~430px
// approximates today's fixed 1fr:1.3fr grid split at a typical window width.
const CONTEXTS_LEFT_WIDTH_KEY = "conva.contexts.leftWidthPx";
const CONTEXTS_LEFT_WIDTH_MIN = 320;
const CONTEXTS_LEFT_WIDTH_MAX = 640;
const CONTEXTS_LEFT_WIDTH_DEFAULT = 430;
```

- [ ] **Step 2: Add the interface fields.** Before:

```ts
  /** Right Ally panel width, px — drives BOTH the panel and the control
   *  bar's tab zone so they stay aligned (spec A.2). */
  panelWidthPx: number;
  setPanelWidthPx: (px: number) => void;
```

  After:

```ts
  /** Right Ally panel width, px — drives BOTH the panel and the control
   *  bar's tab zone so they stay aligned (spec A.2). */
  panelWidthPx: number;
  setPanelWidthPx: (px: number) => void;
  /** Contexts screen's Contexts-pane width, px — Library fills the rest. */
  contextsLeftWidthPx: number;
  setContextsLeftWidthPx: (px: number) => void;
```

- [ ] **Step 3: Initialize + add the setter.** Before:

```ts
  panelWidthPx: (() => {
    const v = Number(localStorage.getItem(PANEL_WIDTH_KEY));
    return v >= PANEL_WIDTH_MIN && v <= PANEL_WIDTH_MAX
      ? v
      : PANEL_WIDTH_DEFAULT;
  })(),
```

  After:

```ts
  panelWidthPx: (() => {
    const v = Number(localStorage.getItem(PANEL_WIDTH_KEY));
    return v >= PANEL_WIDTH_MIN && v <= PANEL_WIDTH_MAX
      ? v
      : PANEL_WIDTH_DEFAULT;
  })(),
  contextsLeftWidthPx: (() => {
    const v = Number(localStorage.getItem(CONTEXTS_LEFT_WIDTH_KEY));
    return v >= CONTEXTS_LEFT_WIDTH_MIN && v <= CONTEXTS_LEFT_WIDTH_MAX
      ? v
      : CONTEXTS_LEFT_WIDTH_DEFAULT;
  })(),
```

  Before:

```ts
  setPanelWidthPx: (px) => {
    const clamped = Math.max(
      PANEL_WIDTH_MIN,
      Math.min(PANEL_WIDTH_MAX, Math.round(px)),
    );
    localStorage.setItem(PANEL_WIDTH_KEY, String(clamped));
    set({ panelWidthPx: clamped });
  },
```

  After:

```ts
  setPanelWidthPx: (px) => {
    const clamped = Math.max(
      PANEL_WIDTH_MIN,
      Math.min(PANEL_WIDTH_MAX, Math.round(px)),
    );
    localStorage.setItem(PANEL_WIDTH_KEY, String(clamped));
    set({ panelWidthPx: clamped });
  },
  setContextsLeftWidthPx: (px) => {
    const clamped = Math.max(
      CONTEXTS_LEFT_WIDTH_MIN,
      Math.min(CONTEXTS_LEFT_WIDTH_MAX, Math.round(px)),
    );
    localStorage.setItem(CONTEXTS_LEFT_WIDTH_KEY, String(clamped));
    set({ contextsLeftWidthPx: clamped });
  },
```

- [ ] **Step 4: Build-check** (no existing test file for `uiPrefs.ts` exercises `panelWidthPx`'s exact shape directly per this session's earlier investigation — `uiPrefs.panel.test.ts`/`uiPrefs.accordion.test.ts`/`uiPrefs.partner.test.ts` exist but target the other prefs; skip adding a redundant one here and instead cover the clamping behavior through Task 5.2's `ContextsPane` integration test, matching how `panelWidthPx`'s own clamping has no dedicated unit test either).

Run: `npm run build`
Expected: clean.

- [ ] **Step 5: Commit.**

```bash
git add src/state/uiPrefs.ts
git commit -m "feat(state): add contextsLeftWidthPx pref"
```

(standard trailer.)

### Task 5.2: Wire the resize handle into `ContextsView.tsx` + `ContextsPane.tsx`

**Files:**
- Modify: `src/components/contexts/ContextsView.tsx`
- Modify: `src/components/contexts/ContextsPane.tsx`

- [ ] **Step 1: `ContextsView.tsx` — read the pref, pass it down, switch the grid to a CSS-var-gated column width.** Before:

```tsx
import { useCallback, useEffect, useMemo, useState } from "react";

import { ContextsPane } from "@/components/contexts/ContextsPane";
import { LibraryPane } from "@/components/contexts/LibraryPane";
import { ContextDetail } from "@/components/context/ContextDetail";
import { ContextSetup } from "@/components/context/ContextSetup";
import { ViewShell } from "@/components/studio/ViewShell";
import { useBackend } from "@/lib/backend";
import { DEFAULT_CONTEXT_ID, type ConversationContext, type ContextSummary } from "@/lib/ipc";
import { useContextsQuickOpen } from "@/state/contextsQuickOpen";
import { useLibraryQuickAdd } from "@/state/libraryQuickAdd";
```

  After:

```tsx
import { useCallback, useEffect, useMemo, useState } from "react";

import { ContextsPane } from "@/components/contexts/ContextsPane";
import { LibraryPane } from "@/components/contexts/LibraryPane";
import { ContextDetail } from "@/components/context/ContextDetail";
import { ContextSetup } from "@/components/context/ContextSetup";
import { ViewShell } from "@/components/studio/ViewShell";
import { useBackend } from "@/lib/backend";
import { DEFAULT_CONTEXT_ID, type ConversationContext, type ContextSummary } from "@/lib/ipc";
import { useContextsQuickOpen } from "@/state/contextsQuickOpen";
import { useLibraryQuickAdd } from "@/state/libraryQuickAdd";
import { useUiPrefs } from "@/state/uiPrefs";
```

  Before (inside the component body, alongside the other `useState`s):

```tsx
  const [selectedId, setSelectedId] = useState<string | null>(null);
```

  After:

```tsx
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const leftWidthPx = useUiPrefs((s) => s.contextsLeftWidthPx);
  const setLeftWidthPx = useUiPrefs((s) => s.setContextsLeftWidthPx);
```

  Before (the grid + panes):

```tsx
      {!error && (
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
          <ContextsPane
            items={items}
            selectedId={selectedId}
            onSelect={(id) => setSelectedId((cur) => (cur === id ? null : id))}
            onOpen={(id) => setMode({ k: "detail", id })}
            onNew={() => setMode({ k: "setup", initial: null })}
            onEdit={(id) => void edit(id)}
            onDelete={(id) => void remove(id)}
            onGenerate={(id) => void generate(id)}
            onAttach={(contextId, docId) => void attach(docId, contextId)}
            onDocsChanged={bumpDocs}
            generatingId={generatingId}
            refreshToken={libraryRefreshToken}
          />
          <LibraryPane
            contextTitles={contextTitles}
            onAttach={(docId, contextId) => void attach(docId, contextId)}
            refreshToken={libraryRefreshToken}
            quickAction={quickAction === "upload" || quickAction === "paste" ? quickAction : null}
          />
        </div>
      )}
```

  After:

```tsx
      {!error && (
        <div
          className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[var(--contexts-left-w)_minmax(0,1fr)]"
          style={{ "--contexts-left-w": `${leftWidthPx}px` } as React.CSSProperties}
        >
          <ContextsPane
            items={items}
            selectedId={selectedId}
            onSelect={(id) => setSelectedId((cur) => (cur === id ? null : id))}
            onOpen={(id) => setMode({ k: "detail", id })}
            onNew={() => setMode({ k: "setup", initial: null })}
            onEdit={(id) => void edit(id)}
            onDelete={(id) => void remove(id)}
            onGenerate={(id) => void generate(id)}
            onAttach={(contextId, docId) => void attach(docId, contextId)}
            onDocsChanged={bumpDocs}
            generatingId={generatingId}
            refreshToken={libraryRefreshToken}
            widthPx={leftWidthPx}
            onResize={setLeftWidthPx}
          />
          <LibraryPane
            contextTitles={contextTitles}
            onAttach={(docId, contextId) => void attach(docId, contextId)}
            refreshToken={libraryRefreshToken}
            quickAction={quickAction === "upload" || quickAction === "paste" ? quickAction : null}
          />
        </div>
      )}
```

  Why a CSS custom property gated inside the `lg:` utility class, not an
  inline `gridTemplateColumns` style directly: an inline `style` always
  wins regardless of breakpoint, which would break the `grid-cols-1` mobile
  stack. Referencing the variable only inside `lg:grid-cols-[var(...)]`
  means the variable has zero effect until that breakpoint's utility class
  is actually active — exactly the same reasoning `TranscriptView.tsx`
  never had to solve (its `AllyPanel` isn't responsive, so a direct inline
  `style={{ width: widthPx }}` was always safe there).

- [ ] **Step 2: `ContextsPane.tsx` — accept the new props, add the resize handle at the pane's right edge** (mirrors `TranscriptView.tsx`'s `AllyPanel` left-edge handle exactly, mirrored to the opposite edge since this pane sits on the *left* of its split). Before (the props list):

```tsx
export function ContextsPane({
  items,
  selectedId,
  onSelect,
  onNew,
  onOpen,
  onEdit,
  onDelete,
  onGenerate,
  onAttach,
  onDocsChanged,
  generatingId,
  refreshToken,
}: {
  items: ContextSummary[];
  selectedId: string | null;
  /** Focus this context in the library pane (filter) — does not navigate. */
  onSelect: (id: string) => void;
  /** Drill into the context's detail (personas / rehearse). */
  onOpen: (id: string) => void;
  onNew: () => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onGenerate: (contextId: string) => void;
  /** Attach `docId` to `contextId` — dropped from the Library pane. */
  onAttach: (contextId: string, docId: string) => void;
  /** A detach here changed the doc's context tags — let the caller refresh
   *  the Library pane too (it holds its own, separate copy of the list). */
  onDocsChanged?: () => void;
  generatingId: string | null;
  /** Bump this to re-fetch the child-doc list (e.g. after an attach). */
  refreshToken?: number;
}) {
```

  After:

```tsx
export function ContextsPane({
  items,
  selectedId,
  onSelect,
  onNew,
  onOpen,
  onEdit,
  onDelete,
  onGenerate,
  onAttach,
  onDocsChanged,
  generatingId,
  refreshToken,
  widthPx,
  onResize,
}: {
  items: ContextSummary[];
  selectedId: string | null;
  /** Focus this context in the library pane (filter) — does not navigate. */
  onSelect: (id: string) => void;
  /** Drill into the context's detail (personas / rehearse). */
  onOpen: (id: string) => void;
  onNew: () => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onGenerate: (contextId: string) => void;
  /** Attach `docId` to `contextId` — dropped from the Library pane. */
  onAttach: (contextId: string, docId: string) => void;
  /** A detach here changed the doc's context tags — let the caller refresh
   *  the Library pane too (it holds its own, separate copy of the list). */
  onDocsChanged?: () => void;
  generatingId: string | null;
  /** Bump this to re-fetch the child-doc list (e.g. after an attach). */
  refreshToken?: number;
  /** This pane's current width, px — Library fills the rest. Only takes
   *  visual effect at the `lg` breakpoint; see ContextsView.tsx. */
  widthPx: number;
  onResize: (px: number) => void;
}) {
```

  Before (the root wrapper):

```tsx
  return (
    <div className="card flex min-h-0 flex-col p-3">
```

  After:

```tsx
  return (
    <div className="card relative flex min-h-0 flex-col p-3">
      {/* Right-edge width handle (mirrors TranscriptView.tsx's AllyPanel
          left-edge handle) — dragging right widens this pane. */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize panes"
        onPointerDown={(e) => {
          const startX = e.clientX;
          const startW = widthPx;
          const move = (ev: PointerEvent) =>
            onResize(startW + (ev.clientX - startX));
          const up = () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
          };
          window.addEventListener("pointermove", move);
          window.addEventListener("pointerup", up);
        }}
        className="absolute inset-y-0 right-0 z-30 hidden w-[5px] cursor-col-resize hover:bg-panel-raised lg:block"
      />
```

  Note the `hidden ... lg:block` on the handle itself — below the `lg`
  breakpoint the grid is a single stacked column (no centerline to drag),
  so the handle shouldn't render there either.

- [ ] **Step 3: Full-suite gate.**

```bash
npm test -- --run
npm run build
```

Expected: `198 passed` still (no new tests this task — the resize
interaction is exercised by Task 6.2's row-redesign test file, since that
task rewrites `ContextsPane.test.tsx` wholesale anyway and both `widthPx`/
`onResize` are now required props every existing test render call needs).
Fix any test render call in `ContextsPane.test.tsx` this step breaks by
adding `widthPx={400}` and `onResize={noop}` to it now — don't defer that
to Task 6.2, since a required-prop TypeScript error would otherwise block
`npm run build` between now and then.

- [ ] **Step 4: Commit.**

```bash
git add src/components/contexts/ContextsView.tsx src/components/contexts/ContextsPane.tsx src/components/contexts/ContextsPane.test.tsx
git commit -m "feat(contexts): resizable centerline between Contexts and Library"
```

(standard trailer.)

---

## Phase 6: Redesigned context row

### Task 6.1: Rewrite the row — full-width two-line, four direct action icons, retire `RowMenu`/`ChildDocRow`/expand

**Files:**
- Modify: `src/components/contexts/ContextsPane.tsx`

This is the biggest single change in the plan. Read the file's *current*
state (after Phase 5's edits) before applying — Task 5.2 already touched
the root wrapper and props; this task replaces everything from the top of
the file down through the row markup.

- [ ] **Step 1: Replace the imports + delete `ChecklistLine`/`RowMenu`/`ChildDocRow`** (none of the three are used anywhere else —
  `grep -rn "ChecklistLine\|RowMenu\|ChildDocRow" src/` before deleting
  should show only this file). Before (the top of the file through the
  `ChildDocRow` component, i.e. everything before the file's main doc
  comment / `export function ContextsPane`):

```tsx
import { useCallback, useEffect, useState } from "react";

import { DOC_DRAG_MIME } from "@/components/contexts/LibraryPane";
import { readinessOf } from "@/components/contexts/readiness";
import { rowStatus } from "@/components/contexts/rowStatus";
import { Icon } from "@/components/ui/Icon";
import { useBackend } from "@/lib/backend";
import {
  DEFAULT_CONTEXT_ID,
  type RagDocument,
  type ContextCategory,
  type ContextSummary,
} from "@/lib/ipc";
import { isDesktop } from "@/lib/platform";

const CATEGORY_LABEL: Record<ContextCategory, string> = {
  interview: "Interview",
  company_meeting: "Company meeting",
  sales_call: "Sales call",
  other: "Other",
};

/** One checklist line — a check, or an advisory warning (never blocks). */
function ChecklistLine({ ok, label, advisory }: { ok: boolean; label: string; advisory?: boolean }) {
  return (
    <p className="flex items-center gap-1.5 text-[11px] text-fg-muted">
      <Icon
        name={ok ? "check" : advisory ? "lightbulb" : "close"}
        size={12}
        className={ok ? "text-ok" : advisory ? "text-fg-faint" : "text-rec"}
      />
      {label}
    </p>
  );
}

/** A row's overflow actions (Edit, Delete, …) behind one ⋮ button — the same
 *  fixed-position, close-on-outside-action popover pattern as the transcript's
 *  term menu, so row actions read consistently across the app. Keeps only
 *  Open + Generate inline on the row itself; this is where future per-context
 *  actions land as the feature grows. */
function RowMenu({
  title,
  onEdit,
  onRegenerate,
  onDelete,
}: {
  title: string;
  onEdit: () => void;
  /** null = hide the item (e.g. while readiness blocks generation). */
  onRegenerate: (() => void) | null;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(null);
    window.addEventListener("click", close);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          const r = e.currentTarget.getBoundingClientRect();
          setOpen((o) => (o ? null : { x: r.right, y: r.bottom }));
        }}
        aria-label={`More actions for ${title}`}
        aria-expanded={open !== null}
        title="More actions"
        className="shrink-0 rounded-sm p-1 text-fg-faint transition hover:bg-panel-raised/60 hover:text-fg"
      >
        <Icon name="more" size={13} />
      </button>
      {open && (
        <div
          role="menu"
          aria-label={`Actions for ${title}`}
          onClick={(e) => e.stopPropagation()}
          style={{ left: Math.min(open.x, window.innerWidth - 148) - 132, top: open.y + 4 }}
          className="glass-raised fixed z-50 w-[132px] rounded-lg p-1"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(null);
              onEdit();
            }}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] text-fg transition hover:bg-panel-raised/70"
          >
            <Icon name="edit" size={13} className="text-fg-muted" />
            Edit setup
          </button>
          {onRegenerate && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(null);
                onRegenerate();
              }}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] text-fg transition hover:bg-panel-raised/70"
            >
              <Icon name="sparkle" size={13} className="text-fg-muted" />
              Regenerate resources
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(null);
              onDelete();
            }}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] text-rec transition hover:bg-rec/10"
          >
            <Icon name="trash" size={13} />
            Delete
          </button>
        </div>
      )}
    </>
  );
}

/** One document nested under an expanded context — read-only aside from the
 *  detach action. Ally-generated docs (the prep dossier, etc.) get a small
 *  "conva" tag, same treatment as their Library row. */
function ChildDocRow({
  doc,
  onDetach,
}: {
  doc: RagDocument;
  onDetach: () => void;
}) {
  return (
    <li className="group flex items-center gap-1.5 py-1 pl-1 text-[11.5px]">
      <Icon
        name={doc.source === "generated" ? "sparkle" : "file"}
        size={12}
        className={doc.source === "generated" ? "shrink-0 text-ai" : "shrink-0 text-fg-faint"}
      />
      <span className="min-w-0 flex-1 truncate text-fg-muted" title={doc.file_name}>
        {doc.file_name}
      </span>
      {doc.source === "generated" && (
        <span className="shrink-0 rounded-full bg-ai/10 px-1.5 py-0.5 text-[9px] font-semibold text-ai">
          conva
        </span>
      )}
      <button
        type="button"
        onClick={onDetach}
        title={`Remove ${doc.file_name} from this context`}
        aria-label={`Remove ${doc.file_name} from this context`}
        className="shrink-0 rounded p-0.5 text-fg-faint opacity-0 transition hover:bg-rec/10 hover:text-rec group-hover:opacity-100"
      >
        <Icon name="close" size={11} />
      </button>
    </li>
  );
}
```

  After:

```tsx
import { useCallback, useEffect, useState } from "react";

import { DOC_DRAG_MIME } from "@/components/contexts/LibraryPane";
import { readinessOf } from "@/components/contexts/readiness";
import { rowStatus } from "@/components/contexts/rowStatus";
import { Icon } from "@/components/ui/Icon";
import { useBackend } from "@/lib/backend";
import { formatBytes } from "@/lib/formatBytes";
import { formatRelativeTime } from "@/lib/relativeTime";
import {
  DEFAULT_CONTEXT_ID,
  type RagDocument,
  type ContextCategory,
  type ContextSummary,
} from "@/lib/ipc";
import { isDesktop } from "@/lib/platform";

const CATEGORY_LABEL: Record<ContextCategory, string> = {
  interview: "Interview",
  company_meeting: "Company meeting",
  sales_call: "Sales call",
  other: "Other",
};

function formatDate(unixMs: number): string {
  return new Date(unixMs).toLocaleString();
}

/** Tooltip text for the title hover (requirement 6): full title, created +
 *  updated date-times, total size of everything tagged to this context
 *  (attached documents AND anything Ally generated for it — both are
 *  already tagged via RagDocument.context_ids, so no separate summing of
 *  source_doc_ids vs. dossier/research/qa_doc_id is needed). */
function titleTooltip(s: ContextSummary, totalBytes: number): string {
  return [
    s.title,
    `Created ${formatDate(s.created_at_unix_ms)}`,
    `Updated ${formatDate(s.updated_at_unix_ms)}`,
    `${formatBytes(totalBytes)} total`,
  ].join("\n");
}

/** Tooltip text for the Regenerate icon hover (requirement 5). */
function regenerateTooltip(s: ContextSummary): string {
  return s.resources_generated_at_unix_ms
    ? `Last regenerated ${formatRelativeTime(s.resources_generated_at_unix_ms)}`
    : "Never regenerated";
}

/** Tooltip text for the status pill, draft only (requirement 3-4's
 *  readiness-checklist relocation — rows no longer expand to show it
 *  inline, so it moves here). `undefined` when there's nothing to show
 *  (non-draft contexts never carried this checklist either). */
function readinessTooltip(s: ContextSummary): string | undefined {
  if (s.status !== "draft") return undefined;
  const { checks } = readinessOf(s);
  return checks
    .map((c) => `${c.ok ? "✓" : c.advisory ? "💡" : "✗"} ${c.label}`)
    .join("\n");
}
```

- [ ] **Step 2: Replace the row's JSX.** Before (the `<ul>...</ul>` block —
  everything from `<ul className="min-h-0 flex-1 overflow-y-auto">` through
  its matching `</ul>`, i.e. the whole `items.map(...)` body):

```tsx
        <ul className="min-h-0 flex-1 overflow-y-auto">
          {items.map((s) => {
            const readiness = readinessOf(s);
            const status = rowStatus(s);
            const isGenerating = generatingId === s.id;
            // The always-present default: not editable or deletable —
            // system-managed until the community/LLM evolution owns it.
            const isDefault = s.id === DEFAULT_CONTEXT_ID;
            const isOpen = expanded.has(s.id);
            const dragOver = dragOverId === s.id;
            const children = docs.filter((d) => d.context_ids.includes(s.id));
            return (
              <li
                key={s.id}
                onDragEnter={(e) => {
                  e.preventDefault();
                  setDragOverId(s.id);
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "link";
                  setDragOverId(s.id);
                }}
                onDragLeave={() => setDragOverId((id) => (id === s.id ? null : id))}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOverId(null);
                  const docId = e.dataTransfer.getData(DOC_DRAG_MIME);
                  if (docId) {
                    onAttach(s.id, docId);
                    setExpanded((prev) => new Set(prev).add(s.id));
                  }
                }}
                className={[
                  "mb-1.5 rounded-md border p-2 transition last:mb-0",
                  dragOver
                    ? "border-ai/60 bg-ai/[0.06]"
                    : selectedId === s.id
                      ? "border-primary/40 bg-primary/[0.06]"
                      : "border-border",
                ].join(" ")}
              >
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => toggleExpand(s.id)}
                    aria-expanded={isOpen}
                    aria-label={isOpen ? `Collapse ${s.title}` : `Expand ${s.title}`}
                    title={isOpen ? "Hide documents" : "Show documents"}
                    className="shrink-0 rounded-sm p-0.5 text-fg-faint transition hover:bg-panel-raised/60 hover:text-fg"
                  >
                    <Icon
                      name="chevron"
                      size={13}
                      className={isOpen ? "" : "-rotate-90"}
                    />
                  </button>
                  <button
                    type="button"
                    onClick={() => onSelect(s.id)}
                    title="Focus this context in the library"
                    className="min-w-0 flex-1 text-left"
                  >
                    <p className="truncate text-[13px] font-semibold text-fg">{s.title}</p>
                  </button>
                  <button
                    type="button"
                    onClick={() => onOpen(s.id)}
                    aria-label={`Open ${s.title}`}
                    title="Open"
                    className="shrink-0 rounded-sm p-0.5 text-fg-faint transition hover:bg-panel-raised/60 hover:text-fg"
                  >
                    <Icon name="chevron" size={13} className="-rotate-90" />
                  </button>
                  {isDefault ? (
                    <span className="pill pill-sm pill-accent shrink-0">Default</span>
                  ) : (
                    <span className="pill pill-sm pill-idle shrink-0">
                      {CATEGORY_LABEL[s.category]}
                    </span>
                  )}
                  <span
                    className={`pill pill-sm shrink-0 ${status.tone}`}
                    title={
                      status.label === "Stale"
                        ? "Inputs changed since resources were generated — regenerate"
                        : undefined
                    }
                  >
                    {isGenerating ? "Generating…" : status.label}
                  </span>
                </div>

                <div className="mt-1.5 flex items-center gap-2 pl-5">
                  <span className="text-[11px] text-fg-faint">
                    {s.source_doc_count} doc{s.source_doc_count === 1 ? "" : "s"}
                    {s.has_generated_resources ? " · generated" : ""}
                  </span>
                  <span className="flex-1" />
                  {!isDefault && (
                    <>
                      <button
                        type="button"
                        disabled={!readiness.canGenerate || isGenerating}
                        onClick={() => onGenerate(s.id)}
                        title={
                          readiness.canGenerate
                            ? "Generate resources"
                            : "Add a document, key terms, or enable research first"
                        }
                        aria-label={`Generate resources for ${s.title}`}
                        className="rounded-sm p-1 text-fg-faint transition hover:bg-panel-raised/60 hover:text-ai disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-fg-faint"
                      >
                        <span className={isGenerating ? "inline-block animate-spin" : "inline-block"}>
                          <Icon name="sparkle" size={14} />
                        </span>
                      </button>
                      <RowMenu
                        title={s.title}
                        onEdit={() => onEdit(s.id)}
                        onRegenerate={
                          readiness.canGenerate && !isGenerating
                            ? () => onGenerate(s.id)
                            : null
                        }
                        onDelete={() => onDelete(s.id)}
                      />
                    </>
                  )}
                </div>

                {isOpen && (
                  <ul className="ml-5 mt-1 flex flex-col divide-y divide-border border-l border-border pl-2">
                    {children.length === 0 ? (
                      <li className="py-1 pl-1 text-[11px] text-fg-faint">
                        {dragOver
                          ? "Drop to attach"
                          : "No documents yet — drag one from the library, or use its Attach button."}
                      </li>
                    ) : (
                      children.map((d) => (
                        <ChildDocRow key={d.id} doc={d} onDetach={() => detach(d.id, s.id)} />
                      ))
                    )}
                  </ul>
                )}

                {s.status === "draft" && (
                  <div className="mt-1.5 flex flex-col gap-0.5 border-t border-border pt-1.5">
                    {readiness.checks.map((c) => (
                      <ChecklistLine key={c.label} {...c} />
                    ))}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
```

  After:

```tsx
        <ul className="min-h-0 flex-1 overflow-y-auto">
          {items.map((s) => {
            const readiness = readinessOf(s);
            const status = rowStatus(s);
            const isGenerating = generatingId === s.id;
            // The always-present default: not editable or deletable —
            // system-managed until the community/LLM evolution owns it.
            const isDefault = s.id === DEFAULT_CONTEXT_ID;
            const dragOver = dragOverId === s.id;
            // Every document tagged to this context — attached AND
            // anything Ally generated for it (both already carry this
            // context's id in context_ids at ingest time), so summing
            // size_bytes here covers requirement 6's "total size" without
            // needing to separately track source_doc_ids vs. the
            // dossier/research/qa doc ids.
            const contextDocs = docs.filter((d) => d.context_ids.includes(s.id));
            const totalBytes = contextDocs.reduce((sum, d) => sum + d.size_bytes, 0);
            return (
              <li
                key={s.id}
                onDragEnter={(e) => {
                  e.preventDefault();
                  setDragOverId(s.id);
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "link";
                  setDragOverId(s.id);
                }}
                onDragLeave={() => setDragOverId((id) => (id === s.id ? null : id))}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOverId(null);
                  const docId = e.dataTransfer.getData(DOC_DRAG_MIME);
                  if (docId) onAttach(s.id, docId);
                }}
                className={[
                  "mb-1.5 rounded-md border p-2 transition last:mb-0",
                  dragOver
                    ? "border-ai/60 bg-ai/[0.06]"
                    : selectedId === s.id
                      ? "border-primary/40 bg-primary/[0.06]"
                      : "border-border",
                ].join(" ")}
              >
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => onSelect(s.id)}
                    title={titleTooltip(s, totalBytes)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <p className="truncate text-[13px] font-semibold text-fg">{s.title}</p>
                  </button>
                  <span className="flex shrink-0 items-center gap-0.5 text-[11px] text-fg-faint">
                    <Icon name="file" size={11} />
                    {s.source_doc_count}
                  </span>
                  <button
                    type="button"
                    onClick={() => onOpen(s.id)}
                    aria-label={`Open ${s.title}`}
                    title="Open"
                    className="shrink-0 rounded-sm p-0.5 text-fg-faint transition hover:bg-panel-raised/60 hover:text-fg"
                  >
                    <Icon name="chevron" size={13} className="-rotate-90" />
                  </button>
                  {!isDefault && (
                    <>
                      <button
                        type="button"
                        onClick={() => onEdit(s.id)}
                        aria-label={`Edit setup for ${s.title}`}
                        title="Edit setup"
                        className="shrink-0 rounded-sm p-0.5 text-fg-faint transition hover:bg-panel-raised/60 hover:text-fg"
                      >
                        <Icon name="edit" size={13} />
                      </button>
                      <button
                        type="button"
                        disabled={!readiness.canGenerate || isGenerating}
                        onClick={() => onGenerate(s.id)}
                        aria-label={`Generate resources for ${s.title}`}
                        title={
                          readiness.canGenerate
                            ? regenerateTooltip(s)
                            : "Add a document, key terms, or enable research first"
                        }
                        className="shrink-0 rounded-sm p-0.5 text-fg-faint transition hover:bg-panel-raised/60 hover:text-ai disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-fg-faint"
                      >
                        <span className={isGenerating ? "inline-block animate-spin" : "inline-block"}>
                          <Icon name="sparkle" size={13} />
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => onDelete(s.id)}
                        aria-label={`Delete ${s.title}`}
                        title="Delete"
                        className="shrink-0 rounded-sm p-0.5 text-fg-faint transition hover:bg-rec/10 hover:text-rec"
                      >
                        <Icon name="trash" size={13} />
                      </button>
                    </>
                  )}
                </div>

                <div className="mt-1 flex items-center gap-2 pl-0">
                  {isDefault ? (
                    <span className="pill pill-sm pill-accent shrink-0">Default</span>
                  ) : (
                    <span className="pill pill-sm pill-idle shrink-0">
                      {CATEGORY_LABEL[s.category]}
                    </span>
                  )}
                  <span
                    className={`pill pill-sm shrink-0 ${status.tone}`}
                    title={
                      status.label === "Stale"
                        ? "Inputs changed since resources were generated — regenerate"
                        : readinessTooltip(s)
                    }
                  >
                    {isGenerating ? "Generating…" : status.label}
                  </span>
                  <span className="text-[11px] text-fg-faint">
                    Updated {formatRelativeTime(s.updated_at_unix_ms)}
                  </span>
                </div>

                {dragOver && contextDocs.length === 0 && (
                  <p className="mt-1 pl-0 text-[11px] text-fg-faint">Drop to attach</p>
                )}
              </li>
            );
          })}
        </ul>
```

- [ ] **Step 3: Delete the now-unused `expanded`/`toggleExpand` state + `detach` (folded away, no longer called from the row).**
  Before:

```tsx
  const backend = useBackend();
  const [docs, setDocs] = useState<RagDocument[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  const refreshDocs = useCallback(() => {
    backend.rag.list().then(setDocs).catch(() => {});
  }, [backend]);

  useEffect(() => {
    refreshDocs();
  }, [refreshDocs, refreshToken]);

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const detach = (docId: string, contextId: string) => {
    void backend.rag.detachContext(docId, contextId).then(() => {
      refreshDocs();
      onDocsChanged?.();
    });
  };
```

  After:

```tsx
  const backend = useBackend();
  const [docs, setDocs] = useState<RagDocument[]>([]);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  const refreshDocs = useCallback(() => {
    backend.rag.list().then(setDocs).catch(() => {});
  }, [backend]);

  useEffect(() => {
    refreshDocs();
  }, [refreshDocs, refreshToken]);
```

  Note: `onDocsChanged` is now an unused prop inside this component (it was
  only ever called from the deleted `detach` function) — **keep the prop
  in the interface** (don't remove it; `ContextsView.tsx` still passes it
  and it's a reasonable extension point), just note in a one-line comment
  above the prop that nothing currently calls it now that row-level detach
  is gone. Re-check with
  `grep -n "onDocsChanged" src/components/contexts/ContextsPane.tsx` — if
  it's now provably dead (unused inside the function body), remove the
  callback prop entirely instead of leaving dead wiring; update
  `ContextsView.tsx`'s `<ContextsPane onDocsChanged={bumpDocs} ... />`
  call to drop the prop too if so, and confirm `bumpDocs` in
  `ContextsView.tsx` is still used elsewhere (it is — `attach()` calls it)
  before assuming nothing else needs it.

- [ ] **Step 4: Build-check.**

Run: `npm run build`
Expected: clean — this is where any stray unused-import/unused-var
TypeScript error would surface (`RagDocument` is still used for the
`docs` state type, so its import stays; `readiness.checks` is now only
read inside `readinessTooltip`, not the component body directly — confirm
no duplicate/orphaned destructuring remains).

- [ ] **Step 5: Commit.**

```bash
git add src/components/contexts/ContextsPane.tsx
git commit -m "feat(contexts): redesigned context row — direct action icons, hover-tooltip detail"
```

(standard trailer.)

### Task 6.2: Rewrite `ContextsPane.test.tsx` for the new row

**Files:**
- Modify: `src/components/contexts/ContextsPane.test.tsx`

The existing 4 tests assert behavior this task's Task 6.1 removed (the
always-visible checklist text, the `⋮` menu). Rewrite them to match the
new row; add new coverage for the four direct icons and the tooltip
content.

- [ ] **Step 1: Replace the whole file.**

```tsx
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ContextsPane } from "@/components/contexts/ContextsPane";
import { BackendProvider } from "@/lib/backend";
import type { ConvaBackend } from "@/lib/backend/ConvaBackend";
import type { ContextSummary, RagDocument } from "@/lib/ipc";

afterEach(cleanup);

function summary(overrides: Partial<ContextSummary> = {}): ContextSummary {
  return {
    id: "s1",
    title: "Acme interview",
    category: "interview",
    status: "draft",
    created_at_unix_ms: 0,
    updated_at_unix_ms: 0,
    source_doc_count: 0,
    has_key_terms: false,
    research_enabled: false,
    has_job_description: false,
    has_generated_resources: false,
    ...overrides,
  };
}

const noop = () => undefined;

// ContextsPane fetches the document list itself (to sum each context's
// total size, and for the drag-and-drop drop target) — a bare-bones fake
// is enough for these tests.
function fakeBackend(docs: RagDocument[] = []): ConvaBackend {
  return {
    rag: {
      list: vi.fn().mockResolvedValue(docs),
      detachContext: vi.fn().mockResolvedValue(undefined),
    },
  } as unknown as ConvaBackend;
}

function renderPane(ui: ReactElement, docs: RagDocument[] = []) {
  return render(<BackendProvider backend={fakeBackend(docs)}>{ui}</BackendProvider>);
}

const defaultProps = {
  selectedId: null,
  onSelect: noop,
  onOpen: noop,
  onNew: noop,
  onEdit: noop,
  onDelete: noop,
  onGenerate: noop,
  onAttach: noop,
  generatingId: null,
  widthPx: 400,
  onResize: noop,
};

describe("ContextsPane", () => {
  it("disables Generate until the context has a grounding source, and the status pill explains why", () => {
    renderPane(<ContextsPane {...defaultProps} items={[summary()]} />);
    expect(
      screen.getByRole("button", { name: /generate resources for acme interview/i }),
    ).toBeDisabled();
    // The readiness checklist now lives in the status pill's hover tooltip,
    // not always-visible text.
    expect(screen.getByText("Draft")).toHaveAttribute(
      "title",
      expect.stringContaining("At least one grounding source"),
    );
  });

  it("enables Generate once key terms are declared, and calls onGenerate", () => {
    const onGenerate = vi.fn();
    renderPane(
      <ContextsPane
        {...defaultProps}
        items={[summary({ has_key_terms: true })]}
        onGenerate={onGenerate}
      />,
    );
    const btn = screen.getByRole("button", {
      name: /generate resources for acme interview/i,
    });
    expect(btn).not.toBeDisabled();
    fireEvent.click(btn);
    expect(onGenerate).toHaveBeenCalledWith("s1");
  });

  it("hides the New Context button off-desktop (web has no Context folder to write to)", () => {
    renderPane(<ContextsPane {...defaultProps} items={[]} />);
    // jsdom has no __TAURI__ global -> isDesktop is false -> button absent.
    expect(screen.queryByRole("button", { name: "Add a New Context" })).toBeNull();
  });

  it("shows Open, Edit, Regenerate, and Delete as direct icon buttons — no overflow menu", () => {
    const onEdit = vi.fn();
    const onDelete = vi.fn();
    const onOpen = vi.fn();
    renderPane(
      <ContextsPane
        {...defaultProps}
        items={[summary({ has_key_terms: true })]}
        onEdit={onEdit}
        onDelete={onDelete}
        onOpen={onOpen}
      />,
    );
    // No overflow menu of any kind.
    expect(screen.queryByRole("button", { name: /more actions/i })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /open acme interview/i }));
    expect(onOpen).toHaveBeenCalledWith("s1");

    fireEvent.click(screen.getByRole("button", { name: /edit setup for acme interview/i }));
    expect(onEdit).toHaveBeenCalledWith("s1");

    fireEvent.click(screen.getByRole("button", { name: /delete acme interview/i }));
    expect(onDelete).toHaveBeenCalledWith("s1");
  });

  it("Ready contexts' status pill carries no readiness tooltip", () => {
    renderPane(
      <ContextsPane
        {...defaultProps}
        items={[summary({ status: "ready", has_key_terms: true })]}
      />,
    );
    expect(screen.getByText("Ready")).not.toHaveAttribute("title");
  });

  it("Regenerate's tooltip reads 'Never regenerated' until the context has one, then the relative time", () => {
    renderPane(
      <ContextsPane
        {...defaultProps}
        items={[
          summary({
            has_key_terms: true,
            resources_generated_at_unix_ms: Date.now() - 2 * 3_600_000,
          }),
        ]}
      />,
    );
    expect(
      screen.getByRole("button", { name: /generate resources for acme interview/i }),
    ).toHaveAttribute("title", expect.stringContaining("Last regenerated"));
  });

  it("the title's hover tooltip totals size across every document tagged to this context", async () => {
    const docs: RagDocument[] = [
      {
        id: "d1",
        file_name: "resume.pdf",
        enabled: true,
        chunk_count: 2,
        ingested_at_unix_ms: 0,
        source: "file",
        context_ids: ["s1"],
        size_bytes: 1000,
      },
      {
        id: "d2",
        file_name: "Acme — Context knowledge",
        enabled: true,
        chunk_count: 3,
        ingested_at_unix_ms: 0,
        source: "generated",
        context_ids: ["s1"],
        size_bytes: 500,
      },
    ];
    renderPane(<ContextsPane {...defaultProps} items={[summary({ source_doc_count: 1 })]} />, docs);
    // The doc list loads asynchronously (backend.rag.list()) — findBy
    // flushes it.
    const titleBtn = await screen.findByTitle(/1500 B total|1\.5 KB total/i);
    expect(titleBtn).toHaveTextContent("Acme interview");
  });
});
```

  (The last test's `1500 B total|1.5 KB total` alternation: 1000 + 500 =
  1500 bytes, which `formatBytes` renders as `1.5 KB` per the ≥10-shows-
  no-decimal / <10-shows-one-decimal rule from Task 4.1 — 1500/1024 ≈
  1.46, rounds to `1.5 KB`. Written as an either/or regex only to guard
  against a future rounding-rule tweak silently going unnoticed by an
  overly-brittle exact match; if `formatBytes`'s own unit tests
  (Task 4.1) are green, `1.5 KB` is what this will actually assert.)

- [ ] **Step 2: Run it.**

Run: `npm test -- --run src/components/contexts/ContextsPane.test.tsx`
Expected: PASS, all 7 tests.

- [ ] **Step 3: Full-suite gate.**

```bash
npm test -- --run
npm run build
```

Expected: build clean; test count reflects this file going from 5 tests
to 7 (net `+2` on top of Phase 4's running total of 198 — landing at 200,
not 201; caught during Task 6.2 execution — the old file actually had 5
`it(...)` blocks, not 4).

- [ ] **Step 4: Commit.**

```bash
git add src/components/contexts/ContextsPane.test.tsx
git commit -m "test(contexts): cover the redesigned row's direct actions + tooltips"
```

(standard trailer.)

---

## Phase 7: `ContextDetail.tsx` — collapsed-by-default accordion + hover tooltips

### Task 7.1: The `CollapsibleSection` wrapper + accordion wiring

**Files:**
- Modify: `src/components/context/ContextDetail.tsx`

Reuses `toggleDetailSection` from Task 4.3. Builds a **local**
`CollapsibleSection` component in this file rather than modifying the
shared `Section` in `ViewShell.tsx` — `Section` is used by many unrelated
views (Settings, etc.); adding collapse behavior there would widen this
change's blast radius well past what the spec calls for.

- [ ] **Step 1: Add the import + local component.** Before (the top of the file):

```tsx
import { useCallback, useEffect, useState } from "react";

import { Section, ViewShell } from "@/components/studio/ViewShell";
import { Icon } from "@/components/ui/Icon";
import { useBackend } from "@/lib/backend";
import { useCapabilities } from "@/lib/backend/context";
import { DEFAULT_CONTEXT_ID, type KnowledgeProfile, type RagDocument, type ConversationContext } from "@/lib/ipc";
import { useNavStore } from "@/state/nav";
import { useRehearsalStore } from "@/state/rehearsal";
```

  After:

```tsx
import { useCallback, useEffect, useState } from "react";

import { type DetailSectionId, toggleDetailSection } from "@/components/context/detailSections";
import { ViewShell } from "@/components/studio/ViewShell";
import { Icon } from "@/components/ui/Icon";
import { useBackend } from "@/lib/backend";
import { useCapabilities } from "@/lib/backend/context";
import { formatBytes } from "@/lib/formatBytes";
import { formatRelativeTime } from "@/lib/relativeTime";
import { DEFAULT_CONTEXT_ID, type KnowledgeProfile, type RagDocument, type ConversationContext } from "@/lib/ipc";
import { useNavStore } from "@/state/nav";
import { useRehearsalStore } from "@/state/rehearsal";

function formatDate(unixMs: number): string {
  return new Date(unixMs).toLocaleString();
}

/** One accordion section (Contexts-screen-redesign spec, requirement 8) —
 *  collapsed to a one-line summary by default, tap to expand. Local to
 *  this file rather than a change to the shared `Section` in
 *  `ViewShell.tsx`, which many unrelated views also use. Mirrors
 *  `Section`'s own card/title styling so it reads as the same visual
 *  family, just with a toggle. */
function CollapsibleSection({
  id,
  open,
  onToggle,
  title,
  summary,
  children,
}: {
  id: DetailSectionId;
  open: boolean;
  onToggle: (id: DetailSectionId) => void;
  title: string;
  summary: string;
  children: React.ReactNode;
}) {
  return (
    <div className="card p-4">
      <button
        type="button"
        onClick={() => onToggle(id)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 text-left"
      >
        <span className="min-w-0 flex-1">
          <span className="text-xs font-semibold uppercase tracking-wider text-fg-muted">
            {title}
          </span>
          {!open && (
            <span className="ml-2 truncate text-[11px] text-fg-faint">{summary}</span>
          )}
        </span>
        <Icon
          name="chevron"
          size={13}
          className={`shrink-0 text-fg-faint transition ${open ? "" : "-rotate-90"}`}
        />
      </button>
      {open && <div className="mt-3">{children}</div>}
    </div>
  );
}
```

- [ ] **Step 2: Add the open-section state.** Before (near the top of the
  component body, alongside the other `useState`s):

```tsx
  const backend = useBackend();
  const caps = useCapabilities();
  const [session, setSession] = useState<ConversationContext | null>(null);
```

  After:

```tsx
  const backend = useBackend();
  const caps = useCapabilities();
  const [openSection, setOpenSection] = useState<DetailSectionId | null>(null);
  const [session, setSession] = useState<ConversationContext | null>(null);
```

- [ ] **Step 3: Wrap the three top-level `Section`s in `CollapsibleSection`, computing each one's summary line.** Before (the Counterparty section's
  opening tag):

```tsx
      <Section
        title="Counterparty"
        description="Choose who you'll rehearse against — the AI plays this persona, grounded in your knowledge base."
      >
```

  After:

```tsx
      <CollapsibleSection
        id="counterparty"
        open={openSection === "counterparty"}
        onToggle={(id) => setOpenSection((cur) => toggleDetailSection(cur, id))}
        title="Counterparty"
        summary={
          personas.length === 0
            ? "No personas generated yet"
            : chosenPersona
              ? `${personas.length} persona${personas.length === 1 ? "" : "s"} — ${chosenPersona.title} chosen`
              : `${personas.length} persona${personas.length === 1 ? "" : "s"} — none chosen`
        }
      >
```

  Before (its closing tag):

```tsx
      </Section>

      <Section
        title="Knowledge base"
        description="What grounds this rehearsal — your attached documents plus anything Ally researched. The AI persona draws on all of it."
      >
```

  After:

```tsx
      </CollapsibleSection>

      <CollapsibleSection
        id="knowledge"
        open={openSection === "knowledge"}
        onToggle={(id) => setOpenSection((cur) => toggleDetailSection(cur, id))}
        title="Knowledge base"
        summary={
          profile
            ? `${profile.doc_ids.length} document${profile.doc_ids.length === 1 ? "" : "s"}, updated ${formatRelativeTime(profile.updated_at_unix_ms)}`
            : "Not prepared yet"
        }
      >
```

  Before (this section's closing tag, immediately followed by Rehearse's
  opening tag):

```tsx
      </Section>

      <Section
        title="Rehearse"
        description="Opens the live cockpit — transcript, spine, and Ally. Speak your side out loud; pause and the persona replies in character and speaks back. Use a headset so it doesn't hear its own voice."
      >
```

  After:

```tsx
      </CollapsibleSection>

      <CollapsibleSection
        id="rehearse"
        open={openSection === "rehearse"}
        onToggle={(id) => setOpenSection((cur) => toggleDetailSection(cur, id))}
        title="Rehearse"
        summary={chosen ? "Ready to start" : "Choose a persona first"}
      >
```

  Before (the file's final closing tag, right before `</ViewShell>`):

```tsx
        </div>
      </Section>
    </ViewShell>
  );
}
```

  After:

```tsx
        </div>
      </CollapsibleSection>
    </ViewShell>
  );
}
```

  There are three `</Section>` closing tags in the original file (one per
  top-level section) — the middle one (Knowledge base's) is handled above
  alongside opening the next section; this final one is Rehearse's own
  close. Double-check with
  `grep -n "</Section>\|<Section" src/components/context/ContextDetail.tsx`
  before this step (should show 0 matches after) and after (should show 0
  matches — every `Section` is now `CollapsibleSection`) to confirm none
  were missed. The `error &&` block right below `ViewShell`'s opening tag
  also uses a bare `<Section title="Context">` for the error message —
  **leave that one as a plain `Section`, not `CollapsibleSection`**: an
  error is exactly the one thing that should never start collapsed.

- [ ] **Step 4: Build-check.**

Run: `npm run build`
Expected: clean.

- [ ] **Step 5: Commit.**

```bash
git add src/components/context/ContextDetail.tsx
git commit -m "feat(context): ContextDetail's three sections collapse to a one-line summary by default"
```

(standard trailer.)

### Task 7.2: Explainer prose → hover tooltips, attached-doc list gets metadata tooltips

**Files:**
- Modify: `src/components/context/ContextDetail.tsx`

- [ ] **Step 1: Move the three Knowledge-base stage explainer paragraphs into tooltips on each stage's icon.** Before (Stage 1 — Context knowledge):

```tsx
              <div className="flex items-center gap-2">
                <Icon name="simicon" size={15} className="shrink-0 text-ai" />
                <span className="text-[12px] font-semibold text-fg">
                  Context knowledge
                </span>
                <div className="flex-1" />
```

  After:

```tsx
              <div className="flex items-center gap-2">
                <span
                  title="Stage 1 — Ally reads the role, job description, and your documents together and writes a structured knowledge document (role profile, core vocabulary, likely Q&A). Saved to your Library and indexed for grounding."
                  className="shrink-0"
                >
                  <Icon name="simicon" size={15} className="text-ai" />
                </span>
                <span className="text-[12px] font-semibold text-fg">
                  Context knowledge
                </span>
                <div className="flex-1" />
```

  Before (the paragraph right below it):

```tsx
              <p className="mt-1 text-[11px] leading-relaxed text-fg-faint">
                Stage 1 — Ally reads the role, job description, and your
                documents together and writes a structured knowledge document
                (role profile, core vocabulary, likely Q&A). Saved to your
                Library and indexed for grounding.
              </p>
              {session?.resources_stale && (
```

  After:

```tsx
              {session?.resources_stale && (
```

  Before (Stage 2 — Research findings):

```tsx
                <Icon name="search" size={15} className="shrink-0 text-ai" />
                <span className="text-[12px] font-semibold text-fg">
                  Research findings
                </span>
                <div className="flex-1" />
```

  After:

```tsx
                <span
                  title={
                    session?.research_enabled
                      ? researchDocId
                        ? "Stage 2 — what Ally found on the web for this context, with sources cited. Regenerating resources refreshes it."
                        : "Stage 2 — runs with Generate when web research is enabled (needs a search key in Settings)."
                      : "Web research is off for this context — enable it in Edit setup to generate findings."
                  }
                  className="shrink-0"
                >
                  <Icon name="search" size={15} className="text-ai" />
                </span>
                <span className="text-[12px] font-semibold text-fg">
                  Research findings
                </span>
                <div className="flex-1" />
```

  Before (the paragraph right below it):

```tsx
              <p className="mt-1 text-[11px] leading-relaxed text-fg-faint">
                {session?.research_enabled
                  ? researchDocId
                    ? "Stage 2 — what Ally found on the web for this context, with sources cited. Regenerating resources refreshes it."
                    : "Stage 2 — runs with Generate when web research is enabled (needs a search key in Settings)."
                  : "Web research is off for this context — enable it in Edit setup to generate findings."}
              </p>
              {researchDocId && showResearch && (
```

  After:

```tsx
              {researchDocId && showResearch && (
```

  Before (Stage 3 — Interview Q&A):

```tsx
                    <Icon name="question" size={15} className="shrink-0 text-ai" />
                    <span className="text-[12px] font-semibold text-fg">
                      Interview Q&A
                    </span>
                    <div className="flex-1" />
```

  After:

```tsx
                    <span
                      title={
                        qaDocId
                          ? "Common interview questions Ally found online, with strong answers."
                          : session?.deep_qa_enabled
                            ? "Runs with Generate — deep Q&A research is on for this context."
                            : 'Turn on "Deep interview Q&A research" in Edit setup to generate this.'
                      }
                      className="shrink-0"
                    >
                      <Icon name="question" size={15} className="text-ai" />
                    </span>
                    <span className="text-[12px] font-semibold text-fg">
                      Interview Q&A
                    </span>
                    <div className="flex-1" />
```

  Before (the paragraph right below it):

```tsx
                  <p className="mt-1 text-[11px] leading-relaxed text-fg-faint">
                    {qaDocId
                      ? "Common interview questions Ally found online, with strong answers."
                      : session?.deep_qa_enabled
                        ? "Runs with Generate — deep Q&A research is on for this context."
                        : 'Turn on "Deep interview Q&A research" in Edit setup to generate this.'}
                  </p>
                  {qaDocId && showQa && (
```

  After:

```tsx
                  {qaDocId && showQa && (
```

  Each icon is wrapped in a `<span title="...">` rather than passing
  `title` to `Icon` directly — confirmed by reading `Icon.tsx`'s props
  (`name`/`size`/`className`/`strokeWidth` only, and it always renders
  `aria-hidden="true"` on the underlying `<svg>`) that `Icon` doesn't
  forward a `title` prop at all; adding one would need editing the shared
  component, which many unrelated views also use — same contained-blast-
  radius reasoning as Task 7.1's `CollapsibleSection` choice.

- [ ] **Step 2: Give the attached-documents list rows metadata tooltips.** Before:

```tsx
            {(() => {
              const attached = profile.doc_ids.filter(
                (d) => d !== dossierId && d !== researchDocId && d !== qaDocId,
              );
              return (
                <div>
                  <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-fg-faint">
                    Documents ({attached.length})
                  </h3>
                  {attached.length === 0 ? (
                    <p className="text-[12px] text-fg-faint">
                      No documents attached.
                    </p>
                  ) : (
                    <ul className="flex flex-col gap-0.5">
                      {attached.map((docId) =>
                        caps?.system.partnerWindow ? (
                          <li key={docId}>
                            <button
                              type="button"
                              onClick={() =>
                                void backend.partner.open(
                                  docName(docId),
                                  null,
                                  null,
                                  null,
                                  [],
                                  docId,
                                )
                              }
                              title={`View "${docName(docId)}"`}
                              aria-label={`View "${docName(docId)}"`}
                              className="flex w-full items-center gap-1.5 rounded-sm text-left text-[12px] text-fg-muted transition hover:text-ai"
                            >
                              <Icon
                                name="book"
                                size={13}
                                className="shrink-0 text-fg-faint"
                              />
                              <span className="truncate">{docName(docId)}</span>
                            </button>
                          </li>
                        ) : (
                          <li
                            key={docId}
                            className="flex items-center gap-1.5 text-[12px] text-fg-muted"
                          >
                            <Icon
                              name="book"
                              size={13}
                              className="shrink-0 text-fg-faint"
                            />
                            <span className="truncate">{docName(docId)}</span>
                          </li>
                        ),
                      )}
                    </ul>
                  )}
                </div>
              );
            })()}
```

  After:

```tsx
            {(() => {
              const attached = profile.doc_ids.filter(
                (d) => d !== dossierId && d !== researchDocId && d !== qaDocId,
              );
              const docMeta = (docId: string): string => {
                const d = docs.find((x) => x.id === docId);
                if (!d) return docName(docId);
                const kind =
                  d.source === "generated"
                    ? "By conva"
                    : d.source === "pasted"
                      ? "Pasted note"
                      : "File";
                return [
                  docName(docId),
                  `${kind} · ${d.chunk_count} chunk${d.chunk_count === 1 ? "" : "s"} · ${formatBytes(d.size_bytes)}`,
                  `Added ${formatDate(d.ingested_at_unix_ms)}`,
                ].join("\n");
              };
              return (
                <div>
                  <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-fg-faint">
                    Documents ({attached.length})
                  </h3>
                  {attached.length === 0 ? (
                    <p className="text-[12px] text-fg-faint">
                      No documents attached.
                    </p>
                  ) : (
                    <ul className="flex flex-col gap-0.5">
                      {attached.map((docId) =>
                        caps?.system.partnerWindow ? (
                          <li key={docId}>
                            <button
                              type="button"
                              onClick={() =>
                                void backend.partner.open(
                                  docName(docId),
                                  null,
                                  null,
                                  null,
                                  [],
                                  docId,
                                )
                              }
                              title={docMeta(docId)}
                              aria-label={`View "${docName(docId)}"`}
                              className="flex w-full items-center gap-1.5 rounded-sm text-left text-[12px] text-fg-muted transition hover:text-ai"
                            >
                              <Icon
                                name="book"
                                size={13}
                                className="shrink-0 text-fg-faint"
                              />
                              <span className="truncate">{docName(docId)}</span>
                            </button>
                          </li>
                        ) : (
                          <li
                            key={docId}
                            title={docMeta(docId)}
                            className="flex items-center gap-1.5 text-[12px] text-fg-muted"
                          >
                            <Icon
                              name="book"
                              size={13}
                              className="shrink-0 text-fg-faint"
                            />
                            <span className="truncate">{docName(docId)}</span>
                          </li>
                        ),
                      )}
                    </ul>
                  )}
                </div>
              );
            })()}
```

- [ ] **Step 3: Build-check.**

Run: `npm run build`
Expected: clean.

- [ ] **Step 4: Commit.**

```bash
git add src/components/context/ContextDetail.tsx
git commit -m "feat(context): move explainer prose + doc metadata into hover tooltips"
```

(standard trailer.)

### Task 7.3: `ContextDetail.test.tsx` (none exists today)

**Files:**
- Create: `src/components/context/ContextDetail.test.tsx`

- [ ] **Step 1: Write it.**

```tsx
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ContextDetail } from "@/components/context/ContextDetail";
import { BackendProvider } from "@/lib/backend";
import type { ConvaBackend } from "@/lib/backend/ConvaBackend";
import type { ConversationContext, KnowledgeProfile } from "@/lib/ipc";

afterEach(cleanup);

function session(overrides: Partial<ConversationContext> = {}): ConversationContext {
  return {
    id: "s1",
    title: "Amazon Interview",
    purpose: "Prep for the CFO panel",
    job_description: null,
    category: "interview",
    status: "ready",
    created_at_unix_ms: 0,
    updated_at_unix_ms: 0,
    source_doc_ids: [],
    auto_generate_context: true,
    knowledge_profile_id: "kp-1",
    personas: [],
    chosen_persona_id: null,
    conversation_id: null,
    dossier_doc_id: null,
    ...overrides,
  };
}

function profile(overrides: Partial<KnowledgeProfile> = {}): KnowledgeProfile {
  return {
    id: "kp-1",
    title: "Amazon Interview",
    created_at_unix_ms: 0,
    updated_at_unix_ms: 0,
    doc_ids: [],
    research: [],
    ready: true,
    ...overrides,
  };
}

function renderDetail(backend: Partial<ConvaBackend>) {
  render(
    <BackendProvider backend={backend as ConvaBackend}>
      <ContextDetail id="s1" onEdit={() => undefined} onBack={() => undefined} />
    </BackendProvider>,
  );
}

describe("ContextDetail", () => {
  it("starts with all three sections collapsed to a one-line summary", async () => {
    renderDetail({
      context: { load: vi.fn().mockResolvedValue(session()), loadProfile: vi.fn().mockResolvedValue(profile()) },
      rag: { list: vi.fn().mockResolvedValue([]) },
      capabilities: vi.fn().mockResolvedValue(null),
    });
    await screen.findByText("Counterparty");
    // Collapsed — the always-visible description prose from the old
    // Section component is gone; nothing but the summary line shows.
    expect(screen.queryByText(/choose who you'll rehearse against/i)).toBeNull();
    expect(screen.getByText(/no personas generated yet/i)).toBeInTheDocument();
  });

  it("expands exactly one section at a time", async () => {
    renderDetail({
      context: { load: vi.fn().mockResolvedValue(session()), loadProfile: vi.fn().mockResolvedValue(profile()) },
      rag: { list: vi.fn().mockResolvedValue([]) },
      capabilities: vi.fn().mockResolvedValue(null),
    });
    await screen.findByText("Counterparty");

    fireEvent.click(screen.getByRole("button", { name: /counterparty/i }));
    expect(screen.getByText(/generate the personas/i)).toBeInTheDocument();

    // Opening Rehearse closes Counterparty (exclusive accordion).
    fireEvent.click(screen.getByRole("button", { name: /rehearse/i }));
    expect(screen.queryByText(/generate the personas/i)).toBeNull();
    expect(screen.getByRole("button", { name: /start rehearsal/i })).toBeInTheDocument();
  });

  it("clicking the open section again collapses it back to a summary", async () => {
    renderDetail({
      context: { load: vi.fn().mockResolvedValue(session()), loadProfile: vi.fn().mockResolvedValue(profile()) },
      rag: { list: vi.fn().mockResolvedValue([]) },
      capabilities: vi.fn().mockResolvedValue(null),
    });
    await screen.findByText("Counterparty");
    const toggle = screen.getByRole("button", { name: /counterparty/i });
    fireEvent.click(toggle);
    expect(screen.getByText(/generate the personas/i)).toBeInTheDocument();
    fireEvent.click(toggle);
    expect(screen.queryByText(/generate the personas/i)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it.**

Run: `npm test -- --run src/components/context/ContextDetail.test.tsx`
Expected: PASS, all 3 tests. If the accessible name for each
`CollapsibleSection`'s toggle button doesn't resolve the way these tests
assume (Testing Library's `name` computation reads the button's full text
content, which includes the summary span when collapsed — e.g.
"Counterparty No personas generated yet") loosen the `name` regex
matchers to `/counterparty/i` (already written that way above) rather
than an exact string match, since the summary text is dynamic.

- [ ] **Step 3: Full-suite gate.**

```bash
npm test -- --run
npm run build
```

Expected: build clean; running total is now baseline 185 + Phase 4's 13 +
Task 6.2's net +2 (corrected — see Task 6.2's note) + this task's 3 =
**203 passed**.

- [ ] **Step 4: Commit.**

```bash
git add src/components/context/ContextDetail.test.tsx
git commit -m "test(context): cover ContextDetail's collapsed-by-default accordion"
```

(standard trailer.)

---

## Phase 8: Full verification + push + issue + draft PR

### Task 8.1: Full gate

- [ ] **Step 1: Run every check.**

```bash
npm run build
npm test -- --run
cargo test -p conva-core
cargo fmt --check
cargo clippy -p conva-core --all-targets -- -D warnings
```

Expected: all green. `npm test` reports **203 passed**; `cargo test -p conva-core` reports **128 passed** (Phase 1's two tasks changed struct
literals and one test file gained a size-bytes-per-source test in Phase 2
— re-derive the exact expected count from Phase 1/2's own step outputs
rather than trusting this number blindly, since Task 2.1 Step 4 added one
new Rust test not reflected in Phase 1's "128" baseline: expect **129**).

- [ ] **Step 2: Repo-wide sanity grep** — confirm no leftover references to
  the retired `RowMenu`/`ChildDocRow`/`ChecklistLine`, and that every new
  field name is spelled identically everywhere it appears:

```bash
grep -rn "RowMenu\|ChildDocRow\|ChecklistLine" src/ || echo "clean — none found"
grep -rn "resources_generated_at_unix_ms" crates/ src-tauri/src/*.rs src/ --include='*.rs' --include='*.ts' --include='*.tsx'
grep -rn "size_bytes" crates/ src-tauri/src/*.rs src/ --include='*.rs' --include='*.ts' --include='*.tsx'
```

  Expected: the first prints "clean — none found". The other two each
  print every site this plan touched (Phase 1's struct defs + test
  helpers, Phase 2's shell wiring, Phase 3's TS mirror + fixed test
  literals, Phase 6/7's tooltip-building code) — read through the list and
  confirm nothing is spelled differently anywhere (e.g. no stray
  `sizeBytes`/`resourcesGeneratedAt`).

- [ ] **Step 3: Manual QA reminder for the owner** (not automatable in this
  sandbox — no live Tauri window here): drag a Library document onto a
  Context row and confirm it still attaches; drag the new centerline and
  confirm the Library pane resizes in response and the setting survives a
  reload; hover a context's title, its Regenerate icon, and its status
  pill (draft only) and confirm each tooltip's content; open a context's
  detail page and confirm all three sections start collapsed, expand one
  at a time, and their hover tooltips (stage icons, attached-doc rows)
  show real content. Note this in the PR body (Task 8.3).

### Task 8.2: Push

- [ ] **Step 1: Check whether PR #110 (this same branch) has merged in the
  meantime** — if it has, this repo's branch-restart convention applies
  (`CLAUDE.md` Workflow section): restart `claude/conva-app-ui-modernization-igllsd`
  from fresh `origin/main` and cherry-pick this plan's commits forward
  before pushing, rather than pushing on top of now-merged history.

```bash
git fetch origin main
git log --oneline origin/main -3
# If PR #110's commits (search for their subject lines) already appear in
# origin/main's log, it merged — restart the branch:
#   git branch -f _wip-contexts-redesign HEAD   # save this plan's own work
#   git checkout -B claude/conva-app-ui-modernization-igllsd origin/main
#   git cherry-pick <this plan's commit range, oldest first>
# If PR #110's commits do NOT appear in origin/main, it's still open —
# just push normally, no restart needed.
```

- [ ] **Step 2: Push.**

```bash
git push -u origin claude/conva-app-ui-modernization-igllsd
```

  Retry ×4 with 2/4/8/16s backoff on network errors only — do not retry on
  a rejected/non-fast-forward push (that means the branch diverged; stop
  and reconcile instead of forcing).

### Task 8.3: New issue + draft PR

- [ ] **Step 1: Create the issue.** Title: "Contexts screen redesign:
  resizable panes, direct-action row, collapsed-by-default detail". Body:
  spec + plan links, a short summary paragraph (adapt from the spec's own
  opening), the manual-QA checklist from Task 8.1 Step 3.

- [ ] **Step 2: Open the draft PR** from `claude/conva-app-ui-modernization-igllsd`
  against `main`, `Closes #<issue>`, using `mcp__github__create_pull_request`
  (`draft: true`). Body sections: What (the redesign, one paragraph per
  requirement group — pane layout/resize, row redesign, ContextDetail
  accordion), the two new backend fields + why each needed a *new* field
  rather than reusing an existing one, Testing (the exact green counts
  from Task 8.1), and the manual-QA checklist. Fill in real numbers — no
  `<fill in>` placeholders in what actually gets posted. Mirror this
  session's PR title convention: a Conventional Commit-shaped title (this
  repo's CI hygiene check enforces it — e.g. `feat(contexts): resizable
  panes, direct-action row, collapsed detail`) and a body whose "Closes"
  line uses the short `#123` form, not a full issue URL (both hygiene-
  check requirements this session already hit and fixed once on PR #106).

- [ ] **Step 3: Subscribe to its activity** (`mcp__github__subscribe_pr_activity`) and watch CI, following this session's established drive-to-green
  loop — fix any hygiene/build/clippy failure per the same pattern used
  for PR #106 and #110 earlier this session.

---

## Self-review notes

**Spec coverage:** every requirement in
`docs/superpowers/specs/2026-08-28-contexts-screen-redesign-design.md`
maps to a phase: requirements 1 & 7 (panes + resize) → Phase 5;
requirement 2 (drag-and-drop) → untouched, carried forward verbatim in
Phase 6's row rewrite (confirmed by re-reading the exact `onDragEnter`/
`onDragOver`/`onDragLeave`/`onDrop` handlers before writing that task —
they're unchanged in the after-block, only the `setExpanded` call inside
`onDrop` is removed since expand/collapse no longer exists); requirements
3 & 4 (row redesign) → Phase 6; requirement 5 (regenerate hover) → Phase
1 Task 1.2 + Phase 2 Task 2.2 + Phase 6; requirement 6 (title hover +
size) → Phase 1 Task 1.1 + Phase 2 Task 2.1 + Phase 4 Task 4.1 + Phase 6;
requirement 8 (`ContextDetail` density) → Phase 4 Task 4.3 + Phase 7. The
spec's "gap explicitly resolved" (readiness checklist → status-pill
tooltip) is Phase 6 Task 6.1's `readinessTooltip` function, tested in
Task 6.2's first test.

**Placeholder scan:** no TBD/TODO. Every code step shows complete
before/after text, not a "similar to above" reference — including
`grounding_base()` (Task 1.2 Step 3), initially drafted as a
grep-it-yourself hedge since this plan's first pass through the file
hadn't captured that helper's exact trailing fields; caught during
self-review, the file was re-read and the hedge replaced with the real
verbatim before/after.

**Type consistency, traced end to end:**
- `size_bytes: u64` (Rust, Phase 1) → `size_bytes: number` (TS, Phase 3)
  → read in Phase 6's `titleTooltip`/`contextDocs.reduce` and Phase 7's
  `docMeta` — same field name, same non-optional shape, everywhere.
- `resources_generated_at_unix_ms: Option<u64>` (Rust, Phase 1, on BOTH
  `ConversationContext` and `ContextSummary` — traced specifically because
  `ContextsPane.tsx` renders from `ContextSummary`, not the full record,
  so the field had to be added to both or the row's tooltip would have had
  nothing to read) → `resources_generated_at_unix_ms?: number | null`
  (TS, Phase 3) → read in Phase 6's `regenerateTooltip`. Set in exactly
  one place (Phase 2 Task 2.2's `context_generate_dossier`), read in
  exactly one place (Phase 6) — no other writer or reader invented.
- `formatBytes`/`formatRelativeTime` (Phase 4) — same import path
  (`@/lib/formatBytes`, `@/lib/relativeTime`) used identically in Phase 6
  (`ContextsPane.tsx`) and Phase 7 (`ContextDetail.tsx`); no duplicate
  reimplementation in either consumer.
- `toggleDetailSection`/`DetailSectionId` (Phase 4 Task 4.3) — defined
  with exactly the 3 ids `ContextDetail.tsx`'s three sections use in
  Phase 7 Task 7.1; traced that all three `CollapsibleSection` call sites
  pass one of `"counterparty" | "knowledge" | "rehearse"`, matching the
  type, none inventing a 4th.
- `widthPx`/`onResize` props (Phase 5) — same names on both the
  `ContextsPane` call site (`ContextsView.tsx`) and its prop interface
  definition (`ContextsPane.tsx`); Phase 6 Task 6.1 doesn't touch these
  props at all, confirmed by re-reading Phase 5's diff against Phase 6's
  before-blocks (the root wrapper + resize handle from Phase 5 aren't
  repeated or altered in Phase 6's before/after, which starts from the
  imports and ends at the row `<ul>`).

**Scope check:** 8 phases, ~18 tasks — comparable in shape to this
session's SimCon→Context rename plan (5 phases) and generated-docs-display
plan (4 tasks), appropriately larger given this plan touches 2 Rust
structs + their shell wiring + 3 new pure TS utilities + 2 substantial
component rewrites, matching the spec's own stated scope.

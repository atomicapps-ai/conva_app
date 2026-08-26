# Cached Term Definitions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Selecting a term Ally already defined in its generated documents shows that definition instantly — no LLM round-trip. "Define" becomes a no-op when a definition is already cached; "Fetch info"/"Elaborate" stay live (they're explicitly deeper research).

**Architecture:** Core captures `(term, definition)` pairs at extraction time instead of bare term strings, and sanitizes them with the same hygiene predicate `sanitize_mined_terms` already uses (shared, not duplicated). The shell derives both `session.glossary` (unchanged shape) and a new `session.glossary_definitions` map from one sanitized list. The frontend threads the map through the existing `TermChip`/`FoundItem.detail` pipeline — `ViewHistory`'s render already falls back to `item.detail`, so no new UI surface is needed, only new data flowing into an existing slot.

**Tech Stack:** Rust (conva-core tested locally; conva-app shell NOT locally compilable — `cargo fmt --check` + CI Windows job is the gate), TypeScript/React/vitest.

Spec: `docs/superpowers/specs/2026-08-26-cached-term-definitions-design.md`.

**Standard commit trailer for every commit in this plan:**

```
Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Kot4sMxdR3d2DEJ8Z84nu6
```

---

### Task 1: `extract_glossary_entries` — capture the definition alongside the term

**Files:**
- Modify: `crates/conva-core/src/simcon.rs`

- [ ] **Step 1: Write the failing tests.** Append to the existing `mod tests`:

```rust
    #[test]
    fn extract_glossary_entries_captures_bolded_term_definitions() {
        let digest = "## Overview\nIntro.\n\n## Core vocabulary\n\
- **API Gateway** — managed API front door for backend services.\n\
- **Terraform**: infrastructure-as-code tool.\n\n## Watch-outs\n- none";
        let entries = extract_glossary_entries(digest);
        let gateway = entries
            .iter()
            .find(|(t, _)| t == "API Gateway")
            .expect("API Gateway missing");
        assert_eq!(gateway.1, "managed API front door for backend services.");
        let terraform = entries
            .iter()
            .find(|(t, _)| t == "Terraform")
            .expect("Terraform missing");
        assert_eq!(terraform.1, "infrastructure-as-code tool.");
    }

    #[test]
    fn extract_glossary_entries_empty_definition_when_nothing_follows() {
        let digest = "## Glossary\n- **GAAP**\n";
        let entries = extract_glossary_entries(digest);
        let gaap = entries.iter().find(|(t, _)| t == "GAAP").expect("GAAP missing");
        assert_eq!(gaap.1, "");
    }

    #[test]
    fn extract_glossary_still_returns_only_terms() {
        // extract_glossary is now a thin wrapper — every pre-existing test
        // of it already covers this, but pin the relationship explicitly.
        let digest = "## Glossary\n- **GAAP**: accounting standards.\n";
        assert_eq!(extract_glossary(digest), vec!["GAAP".to_string()]);
        assert_eq!(
            extract_glossary(digest),
            extract_glossary_entries(digest)
                .into_iter()
                .map(|(t, _)| t)
                .collect::<Vec<_>>()
        );
    }
```

- [ ] **Step 2: Run to verify failure.** Run: `cargo test -p conva-core extract_glossary_entries` — expect COMPILE FAIL (fn not defined).

- [ ] **Step 3: Implement.** Replace the current `pub fn extract_glossary` body in `crates/conva-core/src/simcon.rs` (it currently duplicates the section-scan and bold-fallback loops inline) with:

```rust
/// Extract `(term, definition)` pairs from a generated Context Digest — the
/// entries under its `## Glossary` or `## Core vocabulary` section (or, when
/// that section is missing entirely, every **bolded** phrase in the digest —
/// spec B.3's truncation fallback). The definition is whatever text follows
/// the term on its line (after the closing `**`, or after the first
/// em/en-dash or colon when the term isn't bolded), trimmed of leading
/// punctuation/whitespace and capped at 200 chars; empty when nothing
/// follows. Case-insensitively deduped by term, capped at
/// [`MAX_GLOSSARY_TERMS`]. Pure; [`extract_glossary`] is a thin wrapper over
/// this that keeps only the term (existing callers, existing behavior); the
/// shell also reads the definition half to cache instant term lookups
/// (spec 2026-08-26, cached term definitions).
pub fn extract_glossary_entries(digest_md: &str) -> Vec<(String, String)> {
    fn clean_definition(raw: &str) -> String {
        raw.trim()
            .trim_start_matches(['—', '–', ':', '-'])
            .trim()
            .chars()
            .take(200)
            .collect()
    }

    let mut out: Vec<(String, String)> = Vec::new();
    let mut in_section = false;

    for raw in digest_md.lines() {
        let line = raw.trim();
        if let Some(title) = line.strip_prefix("## ") {
            let t = title.trim();
            in_section =
                t.eq_ignore_ascii_case("glossary") || t.eq_ignore_ascii_case("core vocabulary");
            continue;
        }
        if !in_section || line.is_empty() {
            continue;
        }
        let content = line.trim_start_matches(['-', '*', '+', '•']).trim_start();
        let (term, definition) = if let Some(rest) = content.strip_prefix("**") {
            let mut parts = rest.splitn(2, "**");
            let term = parts.next().unwrap_or("").trim().to_string();
            let definition = clean_definition(parts.next().unwrap_or(""));
            (term, definition)
        } else {
            let mut parts = content.splitn(2, ['—', '–', ':']);
            let term = parts
                .next()
                .unwrap_or("")
                .trim_matches(['*', ' '])
                .to_string();
            let definition = clean_definition(parts.next().unwrap_or(""));
            (term, definition)
        };
        if term.is_empty() || term.chars().count() > 60 {
            continue;
        }
        if !out.iter().any(|(t, _)| t.eq_ignore_ascii_case(&term)) {
            out.push((term, definition));
        }
        if out.len() >= MAX_GLOSSARY_TERMS {
            break;
        }
    }
    // Fallback (spec B.3): a digest cut off before its ## Glossary section
    // still bolds the key term in each bullet per the prompt — harvest
    // every **bolded** phrase (plus whatever follows it on the line, up to
    // the next bold marker) instead of yielding nothing.
    if out.is_empty() {
        for raw in digest_md.lines() {
            let mut rest = raw;
            while let Some(start) = rest.find("**") {
                let after = &rest[start + 2..];
                let Some(end) = after.find("**") else { break };
                let term = after[..end].trim().to_string();
                let mut tail = &after[end + 2..];
                if let Some(next_bold) = tail.find("**") {
                    tail = &tail[..next_bold];
                }
                let definition = clean_definition(tail);
                rest = &after[end + 2..];
                if term.is_empty() || term.chars().count() > 60 {
                    continue;
                }
                if !out.iter().any(|(t, _)| t.eq_ignore_ascii_case(&term)) {
                    out.push((term, definition));
                }
                if out.len() >= MAX_GLOSSARY_TERMS {
                    return out;
                }
            }
        }
    }
    out
}

/// Extract just the glossary TERMS (see [`extract_glossary_entries`] for the
/// full term+definition pairs). Pure; the shell stores the result on the
/// context (`SimConSession::glossary`) to drive context-aware highlighting
/// (see `docs/technical/highlighting-relevance.md`).
pub fn extract_glossary(digest_md: &str) -> Vec<String> {
    extract_glossary_entries(digest_md)
        .into_iter()
        .map(|(term, _)| term)
        .collect()
}
```

  This REPLACES the entire current body of `extract_glossary` (both the section loop and the bold-fallback loop) — delete the old inline implementation entirely, it's now `extract_glossary_entries` plus the thin wrapper above.

- [ ] **Step 4: Run to verify pass.** `cargo test -p conva-core` — ALL green (every pre-existing `extract_glossary`/glossary test must still pass unchanged — this proves the refactor is lossless on the term axis). `cargo fmt --check` (run `cargo fmt` if needed).

- [ ] **Step 5: Commit.**

```bash
git add crates/conva-core/src/simcon.rs
git commit -m "feat(simcon): extract_glossary_entries — capture definitions alongside terms"
```

(standard trailer; stage only that file.)

---

### Task 2: `sanitize_glossary_entries` — hygiene-gate pairs, sharing the predicate

**Files:**
- Modify: `crates/conva-core/src/highlight.rs`

- [ ] **Step 1: Write the failing tests.** Append near the existing `sanitize_mined_terms` tests:

```rust
    #[test]
    fn sanitize_glossary_entries_drops_failing_terms_keeps_their_definitions_paired() {
        let doc = "The team runs on Kubernetes daily. CloudOpenShift appears once here.";
        let entries = vec![
            ("Kubernetes".to_string(), "container orchestration.".to_string()),
            ("CloudOpenShift".to_string(), "glue artifact.".to_string()),
        ];
        let out = sanitize_glossary_entries(entries, doc, None, 2);
        assert!(
            out.iter().any(|(t, d)| t == "Kubernetes" && d == "container orchestration."),
            "{out:?}"
        );
        assert!(
            !out.iter().any(|(t, _)| t == "CloudOpenShift"),
            "one-occurrence glue term must be dropped: {out:?}"
        );
    }

    #[test]
    fn sanitize_glossary_entries_keeps_jd_present_single_occurrence() {
        let doc = "API Gateway is mentioned once in the resume.";
        let jd = "Experience with API Gateway is required.";
        let entries = vec![("API Gateway".to_string(), "managed API front door.".to_string())];
        let out = sanitize_glossary_entries(entries, doc, Some(jd), 2);
        assert_eq!(out, vec![("API Gateway".to_string(), "managed API front door.".to_string())]);
    }
```

- [ ] **Step 2: Run to verify failure.** `cargo test -p conva-core sanitize_glossary_entries` — expect COMPILE FAIL (fn not defined).

- [ ] **Step 3: Implement.** In `highlight.rs`, factor `sanitize_mined_terms`'s predicate into a shared private helper, then add the entries variant. Replace the current `sanitize_mined_terms` function with:

```rust
/// Shared survival predicate for [`sanitize_mined_terms`] and
/// [`sanitize_glossary_entries`] — kept in one place so the two filters
/// can't drift (spec 2026-08-26).
fn term_survives(
    term: &str,
    doc_toks: &[String],
    jd_toks: Option<&[String]>,
    min_occurrences: usize,
) -> bool {
    let t = term.trim();
    if t.is_empty() {
        return false;
    }
    let nt = tokens(t);
    if nt.is_empty() || nt.len() > 4 {
        return false;
    }
    if nt.len() == 1 && STOPWORDS.contains(&nt[0].as_str()) {
        return false;
    }
    let in_jd = jd_toks.is_some_and(|j| contains_phrase(j, &nt));
    in_jd || phrase_count(doc_toks, &nt) >= min_occurrences
}

/// Hygiene gate for MINED terms (never user-typed key terms) — spec B.2.
/// A term survives when it is ≤4 words, isn't a bare stopword, and either
/// occurs at least `min_occurrences` times in `doc_text` or appears in the
/// job description. One-off extraction-glue artifacts ("CloudOpenShift"
/// jammed at a PDF line break) occur once and die here; real camel-case
/// product names repeat or show up in the JD and survive.
pub fn sanitize_mined_terms(
    terms: Vec<String>,
    doc_text: &str,
    jd_text: Option<&str>,
    min_occurrences: usize,
) -> Vec<String> {
    let doc_toks = tokens(doc_text);
    let jd_toks = jd_text.map(tokens);
    terms
        .into_iter()
        .filter(|term| term_survives(term, &doc_toks, jd_toks.as_deref(), min_occurrences))
        .collect()
}

/// [`sanitize_mined_terms`], applied to `(term, definition)` pairs — a term
/// that doesn't survive drops its definition with it (spec 2026-08-26,
/// cached term definitions: only hygiene-gated terms get their answer
/// cached for instant retrieval).
pub fn sanitize_glossary_entries(
    entries: Vec<(String, String)>,
    doc_text: &str,
    jd_text: Option<&str>,
    min_occurrences: usize,
) -> Vec<(String, String)> {
    let doc_toks = tokens(doc_text);
    let jd_toks = jd_text.map(tokens);
    entries
        .into_iter()
        .filter(|(term, _)| term_survives(term, &doc_toks, jd_toks.as_deref(), min_occurrences))
        .collect()
}
```

- [ ] **Step 4: Run to verify pass.** `cargo test -p conva-core` — ALL green (every pre-existing `sanitize_mined_terms` test must still pass — the refactor must be behavior-identical). `cargo fmt --check` clean.

- [ ] **Step 5: Commit.**

```bash
git add crates/conva-core/src/highlight.rs
git commit -m "feat(highlight): sanitize_glossary_entries — hygiene gate for term+definition pairs"
```

---

### Task 3: `glossary_definitions` field (Rust + TS mirror)

**Files:**
- Modify: `crates/conva-core/src/simcon.rs`
- Modify: `src/lib/ipc.ts`

- [ ] **Step 1: Add the field.** In `crates/conva-core/src/simcon.rs`, add to `SimConSession` immediately after `glossary`:

```rust
    /// The definition text captured alongside each surviving glossary term
    /// (spec 2026-08-26, cached term definitions) — keyed by the exact term
    /// string as it appears in [`glossary`](Self::glossary) (both derive
    /// from the same sanitized extraction, so lookup is an exact match).
    /// Empty for terms mined without a written definition (heuristic
    /// per-document mining, JD mining) — those still fall back to a live
    /// Ally lookup on Define.
    #[serde(default)]
    pub glossary_definitions: std::collections::BTreeMap<String, String>,
```

  Update every full `SimConSession { ... }` literal in `crates/conva-core` (test fixtures `sample_session`, `grounding_base`, `grounding_base()`'s neighbors — grep to find all) with `glossary_definitions: std::collections::BTreeMap::new(),`.

- [ ] **Step 2: TS mirror.** In `src/lib/ipc.ts`, add to `SimConSession` immediately after `glossary?: string[];`:

```ts
  /** Definition text captured alongside each surviving glossary term
   * (keyed by the exact term string in `glossary`) — empty/absent for
   * terms mined without a written definition. */
  glossary_definitions?: Record<string, string>;
```

- [ ] **Step 3: Verify.** `cargo test -p conva-core` ALL green; `cargo fmt --check` clean; `npm run build` clean.

- [ ] **Step 4: Commit.**

```bash
git add crates/conva-core/src/simcon.rs src/lib/ipc.ts
git commit -m "feat(simcon): glossary_definitions field (Rust+TS mirror)"
```

---

### Task 4: Shell — derive `glossary` + `glossary_definitions` from sanitized entries

**Files:**
- Modify: `src-tauri/src/lib.rs`

⚠️ No shell compile locally — gates are `cargo fmt --check`, a full `git diff` re-read, and cross-checking the core symbols (`extract_glossary_entries`, `sanitize_glossary_entries` — both landed in Tasks 1–2).

- [ ] **Step 1: `activate_context`'s first backfill.** Find the block:

```rust
            let glossary = conva_core::highlight::sanitize_mined_terms(
                conva_core::simcon::extract_glossary(&text),
                &text,
                session.job_description.as_deref(),
                1,
            );
            if !glossary.is_empty() {
                session.glossary = glossary;
```

  Replace with:

```rust
            let entries = conva_core::highlight::sanitize_glossary_entries(
                conva_core::simcon::extract_glossary_entries(&text),
                &text,
                session.job_description.as_deref(),
                1,
            );
            if !entries.is_empty() {
                session.glossary = entries.iter().map(|(t, _)| t.clone()).collect();
                session.glossary_definitions = entries.into_iter().collect();
```

  The rest of that `if` block (the persist call) is unchanged — only the condition variable name (`glossary` → `entries`) and body inside it change; adapt the surrounding braces to match exactly (read the current full block first).

- [ ] **Step 2: `simcon_generate_dossier`'s Stage-1 tail.** Find:

```rust
    session.glossary = conva_core::highlight::sanitize_mined_terms(
        conva_core::simcon::extract_glossary(&text),
        &text,
        session.job_description.as_deref(),
        1,
    );
```

  Replace with:

```rust
    let glossary_entries = conva_core::highlight::sanitize_glossary_entries(
        conva_core::simcon::extract_glossary_entries(&text),
        &text,
        session.job_description.as_deref(),
        1,
    );
    session.glossary = glossary_entries.iter().map(|(t, _)| t.clone()).collect();
    session.glossary_definitions = glossary_entries.into_iter().collect();
```

  (Update the comment above it if it still says "Harvest the digest's glossary into structured context terms" — keep it, it's still accurate; no change needed to the comment text itself.)

- [ ] **Step 3: The default-context struct literal and any other full `SimConSession { ... }` literal in src-tauri** gain `glossary_definitions: std::collections::BTreeMap::new(),` (grep to confirm the one site from prior tasks).

- [ ] **Step 4: Verify.** `cargo fmt --check` clean; full `git diff` re-read (braces, that both sites compile the same shape, `entries`/`glossary_entries` don't collide with any other local binding in scope, no unrelated code moved).

- [ ] **Step 5: Commit.**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat(grounding): derive glossary_definitions alongside glossary at both harvest sites"
```

---

### Task 5: Frontend — thread definitions through Found/View, gate Define

**Files:**
- Modify: `src/components/transcript/terms.ts`
- Modify: `src/components/transcript/terms.test.ts`
- Modify: `src/components/transcript/foundGroups.ts`
- Modify: `src/components/transcript/foundGroups.test.ts`
- Modify: `src/components/transcript/TranscriptView.tsx`

- [ ] **Step 1: Write the failing tests.** In `src/components/transcript/terms.test.ts`, add (read the file first to match its existing import/style):

```ts
  it("attaches a cached definition to a doc chip when one exists", () => {
    const { docs } = buildTermChips([], [], ["API Gateway", "Undefined Term"], {
      "API Gateway": "managed API front door.",
    });
    const gateway = docs.find((c) => c.label === "API Gateway");
    expect(gateway?.definition).toBe("managed API front door.");
    const undefined_ = docs.find((c) => c.label === "Undefined Term");
    expect(undefined_?.definition).toBeUndefined();
  });
```

  In `src/components/transcript/foundGroups.test.ts`, add:

```ts
  it("carries a doc term's cached definition into its detail line", () => {
    const groups = buildFoundGroups({
      radarHistory: [],
      tracker: null,
      captures: [],
      liveTerms: [],
      docTerms: ["API Gateway"],
      docDefinitions: { "API Gateway": "managed API front door." },
    });
    const gateway = groups.terms.find((t) => t.label === "API Gateway");
    expect(gateway?.detail).toBe("managed API front door.");
  });
```

- [ ] **Step 2: Run to verify failure.** `npx vitest run src/components/transcript/terms.test.ts src/components/transcript/foundGroups.test.ts` — the two new tests FAIL (4th param doesn't exist yet / `detail` is `null`).

- [ ] **Step 3: Implement.**

  In `terms.ts`:
  - `TermChip` interface gains, after `capture?: Capture;`:

```ts
  /** The cached definition Ally already wrote for this term in its
   *  generated documents, when one exists — lets Define resolve instantly
   *  instead of a live Ally call (spec 2026-08-26). Doc-sourced chips
   *  only; captures/live terms never have one. */
  definition?: string;
```

  - `buildTermChips` signature gains an optional 4th param and the `docs` mapping attaches it:

```ts
export function buildTermChips(
  captures: readonly Capture[],
  liveTerms: readonly string[],
  docTerms: readonly string[],
  docDefinitions?: Record<string, string>,
): { detected: TermChip[]; docs: TermChip[] } {
```

  (keep the existing body identical up to the `docs` construction, then:)

```ts
  const docs = docTerms
    .filter((t) => !seen.has(t.toLowerCase()))
    .map((t): TermChip => ({
      id: `d-${t}`,
      label: t,
      source: "doc",
      definition: docDefinitions?.[t],
    }));
```

  In `foundGroups.ts`:
  - `buildFoundGroups`'s `args` type gains, after `docTerms: readonly string[];`:

```ts
  /** term → cached definition (spec 2026-08-26); threaded to buildTermChips
   *  so a doc term's FoundItem carries it as `detail`. */
  docDefinitions?: Record<string, string>;
```

  - The `buildTermChips` call becomes `buildTermChips(args.captures, args.liveTerms, args.docTerms, args.docDefinitions);`
  - The terms mapping's `detail: null,` becomes `detail: chip.definition ?? null,`.

- [ ] **Step 4: Run to verify pass.** `npx vitest run src/components/transcript/terms.test.ts src/components/transcript/foundGroups.test.ts` — all pass (new + pre-existing).

- [ ] **Step 5: Wire into `TranscriptView.tsx`.**
  - In the grounding-load effect (the one that calls `setDocTerms(buildDocTerms(...))`), add a sibling state and set it:

```tsx
  const [docDefinitions, setDocDefinitions] = useState<Record<string, string>>({});
```

  (declared beside the existing `const [docTerms, setDocTerms] = useState<string[]>([]);`), and inside the effect's success branch, alongside `setDocTerms(buildDocTerms(session.key_terms, session.glossary));`, add:

```tsx
        setDocDefinitions(session.glossary_definitions ?? {});
```

  and in the effect's failure/reset branches (where `setDocTerms([])` is called), add `setDocDefinitions({});` alongside it.

  - The `buildFoundGroups({...})` call gains `docDefinitions,` in its args object (and `docDefinitions` in that `useMemo`'s dependency array).
  - `onEntryDefine` gains the cached-definition short-circuit:

```tsx
            onEntryDefine={(e) => {
              ensureViewVisible();
              if (e.item.chip?.definition) return;
              askTerm("definition", e.item.label);
            }}
```

- [ ] **Step 6: Verify.** `npm test` full suite green (149 expected: 146 + 3 new) and `npm run build` clean.

- [ ] **Step 7: Commit.**

```bash
git add src/components/transcript/terms.ts src/components/transcript/terms.test.ts src/components/transcript/foundGroups.ts src/components/transcript/foundGroups.test.ts src/components/transcript/TranscriptView.tsx
git commit -m "feat(transcript): instant term retrieval from cached definitions"
```

---

### Task 6: Full verification + push + PR #85 update

- [ ] **Step 1: Full gate.** `npm run build`, `npm test`, `cargo test -p conva-core`, `cargo fmt --check`, `cargo clippy -p conva-core --all-targets -- -D warnings` — ALL green.
- [ ] **Step 2: Push** `claude/conva-app-ui-modernization-igllsd` (retries ×4 with 2/4/8/16s backoff on network errors only).
- [ ] **Step 3: PR #85 body** gains "## 6. Instant retrieval of cached term definitions" (spec link; root cause — every Define/Fetch info was a live LLM call even for terms Ally already defined in its own document; fix — capture+cache the definition, Define resolves instantly, Fetch info/Elaborate stay live by design) and a manual-QA item:
  - In the Amazon Interview context, select a Core-vocabulary term (e.g. "API Gateway") in Found — its definition appears in the View card immediately, no spinner. Clicking Define does nothing further (already shown). Clicking Fetch info still researches live, as before. A live-detected term (not from a document) still goes live on Define, unchanged.
- [ ] **Step 4: Watch CI** (Windows shell job gates Task 4).

---

## Self-review notes

- Spec coverage: §1 → Tasks 1–2; §2 → Tasks 3–4; §3 → Task 5; §4 (instant retrieval / Define no-op / Fetch info stays live) → Task 5 Step 5; testing section → Tasks 1, 2, 5, 6.
- Type consistency: `extract_glossary_entries`/`sanitize_glossary_entries` both operate on `Vec<(String, String)>` throughout; `glossary_definitions` is a `BTreeMap<String, String>` in Rust and `Record<string, string>` in TS, both optional/defaulted so no existing caller breaks; `buildTermChips`'s new 4th param and `buildFoundGroups`'s new `docDefinitions` field are both optional — every existing call site keeps compiling untouched.
- Task 4 leaves the shell uncompilable only in the trivial sense that CI (not this sandbox) verifies it — expected, matches every prior shell task in this PR.

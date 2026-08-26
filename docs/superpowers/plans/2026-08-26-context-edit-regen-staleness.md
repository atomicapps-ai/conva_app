# Context Edit → Regeneration & Staleness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Editing a context invalidates its derived terms and marks its generated resources stale; JD vocabulary always rides along at activation; the Contexts UI surfaces staleness and makes regeneration a first-class labeled action.

**Architecture:** A pure `grounding_changed` comparator in conva-core drives invalidation at every shell save path (wizard save, pane attach/detach); a `resources_stale` flag on `SimConSession`/`SimConSummary` (Rust + TS mirror, one commit) carries the signal to the UI, where a pure `rowStatus` helper renders it as a gold "Stale" pill and the row menu gains a labeled "Regenerate resources" action.

**Tech Stack:** Rust (conva-core with unit tests; conva-app shell — NOT locally compilable in this sandbox, `cargo fmt --check` + CI Windows job is the gate), TypeScript/React/vitest.

Spec: `docs/superpowers/specs/2026-08-26-context-edit-regen-staleness-design.md`.

**Standard commit trailer for every commit in this plan:**

```
Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Kot4sMxdR3d2DEJ8Z84nu6
```

---

### Task 1: `grounding_changed` + `resources_stale` (core + TS mirror, one commit)

**Files:**
- Modify: `crates/conva-core/src/simcon.rs` (struct fields + new pure fn + tests)
- Modify: `src/lib/ipc.ts` (mirror both types)

- [ ] **Step 1: Write the failing tests.** In `crates/conva-core/src/simcon.rs`, append to the existing `mod tests`:

```rust
    fn grounding_base() -> SimConSession {
        SimConSession {
            id: "sim-1".into(),
            title: "Acme interview".into(),
            purpose: "Prep".into(),
            job_description: Some("Build on AWS.".into()),
            category: SimConCategory::Interview,
            status: SimConStatus::Ready,
            created_at_unix_ms: 0,
            updated_at_unix_ms: 0,
            source_doc_ids: vec!["doc-a".into(), "doc-b".into()],
            auto_generate_context: false,
            research_enabled: true,
            key_terms: vec!["GAAP".into()],
            glossary: vec!["EKS".into()],
            knowledge_profile_id: Some("kp-1".into()),
            personas: Vec::new(),
            chosen_persona_id: None,
            conversation_id: None,
            dossier_doc_id: Some("dossier-1".into()),
            resources_stale: false,
        }
    }

    #[test]
    fn grounding_changed_detects_each_grounding_input() {
        let old = grounding_base();

        let mut jd = grounding_base();
        jd.job_description = Some("Build on Azure.".into());
        assert!(grounding_changed(&old, &jd));

        let mut terms = grounding_base();
        terms.key_terms.push("SOX".into());
        assert!(grounding_changed(&old, &terms));

        let mut docs = grounding_base();
        docs.source_doc_ids = vec!["doc-a".into()];
        assert!(grounding_changed(&old, &docs));

        let mut research = grounding_base();
        research.research_enabled = false;
        assert!(grounding_changed(&old, &research));
    }

    #[test]
    fn grounding_changed_ignores_non_grounding_edits_and_ordering() {
        let old = grounding_base();

        // Same sets, different order + a renamed title/purpose: no change.
        let mut same = grounding_base();
        same.title = "Renamed".into();
        same.purpose = "New purpose".into();
        same.source_doc_ids = vec!["doc-b".into(), "doc-a".into()];
        same.glossary = vec!["different".into()];
        same.status = SimConStatus::Ended;
        assert!(!grounding_changed(&old, &same));

        // None vs empty/whitespace JD is not a change.
        let mut old_no_jd = grounding_base();
        old_no_jd.job_description = None;
        let mut new_blank_jd = grounding_base();
        new_blank_jd.job_description = Some("   ".into());
        assert!(!grounding_changed(&old_no_jd, &new_blank_jd));
    }
```

- [ ] **Step 2: Run to verify failure.** Run: `cargo test -p conva-core grounding_changed` — expect COMPILE FAIL (`resources_stale` field and `grounding_changed` not defined).

- [ ] **Step 3: Implement.** In `crates/conva-core/src/simcon.rs`:

  (a) Add the field at the END of `SimConSession` (after `dossier_doc_id`):

```rust
    /// True when a grounding input (documents, job description, key terms,
    /// research toggle) changed after resources were generated — the digest/
    /// glossary no longer reflect the inputs. Set by the shell's save paths,
    /// cleared by a successful dossier regeneration.
    #[serde(default)]
    pub resources_stale: bool,
```

  (b) Add the same field at the END of `SimConSummary` (after `has_generated_resources`):

```rust
    /// Mirrors [`SimConSession::resources_stale`] for the list row's pill.
    #[serde(default)]
    pub resources_stale: bool,
```

  (c) Add the pure fn near the other free functions (e.g. below `extract_glossary`):

```rust
/// True when any grounding input differs between two versions of a context —
/// the signal that derived resources (glossary, dossier) no longer reflect
/// the inputs. Job description compares trimmed (`None` ≡ empty); key terms
/// and source docs compare as order-insensitive sets; research toggle
/// compares directly. Non-grounding edits (title, purpose, personas, status)
/// never count.
pub fn grounding_changed(old: &SimConSession, new: &SimConSession) -> bool {
    fn norm_jd(jd: Option<&str>) -> &str {
        jd.map(str::trim).unwrap_or("")
    }
    fn as_set(items: &[String]) -> std::collections::BTreeSet<&str> {
        items.iter().map(String::as_str).collect()
    }
    norm_jd(old.job_description.as_deref()) != norm_jd(new.job_description.as_deref())
        || as_set(&old.key_terms) != as_set(&new.key_terms)
        || as_set(&old.source_doc_ids) != as_set(&new.source_doc_ids)
        || old.research_enabled != new.research_enabled
}
```

  (d) In the shell there is a summary constructor in `src-tauri/src/simcon.rs` (`pub fn list`, the `SimConSummary { .. }` literal around line 164) — DO NOT touch it in this task (it's Task 2's file); the `#[serde(default)]`s keep core compiling on its own, but note the core struct literal in the shell means the shell won't compile until Task 2 adds the field there. That is expected — the sandbox can't compile the shell anyway, and Task 2 lands before any push.

  Wait — check first: `grep -n "SimConSummary {" src-tauri/src/simcon.rs` and `grep -rn "SimConSession {" src-tauri/src crates/conva-core/src --include='*.rs' | grep -v test`. Struct literals (non-`..Default`) in **core** must be updated in THIS task so `cargo test -p conva-core` compiles (e.g. the default-context constructor near `glossary: extract_glossary(DEFAULT_DIGEST_TEXT)` at ~line 99 — add `resources_stale: false,` there). Struct literals in `src-tauri` are updated in Task 2.

  (e) Mirror in `src/lib/ipc.ts` — add to `SimConSession` (after `dossier_doc_id`):

```ts
  /** True when grounding inputs changed after resources were generated —
   * the digest/glossary no longer reflect the inputs (cleared by a
   * successful regeneration). Optional: older records omit it. */
  resources_stale?: boolean;
```

  and to `SimConSummary` (after `has_generated_resources`):

```ts
  /** Mirrors SimConSession.resources_stale for the list row's pill. */
  resources_stale?: boolean;
```

  Optional (`?`) matches the file's existing pattern for serde-defaulted fields (`research_enabled?`, `key_terms?`, `glossary?`) — no test-fixture churn.

- [ ] **Step 4: Run to verify pass.** Run: `cargo test -p conva-core` — ALL tests green (the two new ones included). Run `cargo fmt --check` (run `cargo fmt` if needed) and `npm run build` (ipc.ts must typecheck).

- [ ] **Step 5: Commit.**

```bash
git add crates/conva-core/src/simcon.rs src/lib/ipc.ts
git commit -m "feat(simcon): grounding_changed + resources_stale (Rust+TS mirror)"
```

(with the standard trailer; stage ONLY those two files — never `git add -A`.)

---

### Task 2: Shell invalidation — wizard save, dossier clears stale, attach/detach sync

**Files:**
- Modify: `src-tauri/src/simcon.rs` (`save`, `list` summary literal)
- Modify: `src-tauri/src/lib.rs` (`simcon_generate_dossier`, `rag_attach_context`, `rag_detach_context`)

⚠️ The sandbox CANNOT compile the shell — do not run `cargo build/check/test -p conva-app`. Gates: `cargo fmt --check`, a full `git diff` re-read, and CI's Windows job after the final push.

- [ ] **Step 1: `src-tauri/src/simcon.rs` — summary literal.** In `pub fn list`, add to the `SimConSummary { ... }` literal (after `has_generated_resources: ...`):

```rust
            resources_stale: s.resources_stale,
```

  Also check for any other `SimConSession { ... }` / `SimConSummary { ... }` full literals in `src-tauri/` (`grep -n "SimConSession {\|SimConSummary {" src-tauri/src/*.rs`) and add the field there too.

- [ ] **Step 2: `src-tauri/src/simcon.rs` — invalidate on save.** In `pub fn save(app: &AppHandle, mut session: SimConSession)`, immediately after the existing id-validation branch (the `if session.id.is_empty() { ... } else { validate_id(...)? }` block) and before the record is written, insert:

```rust
    // Grounding edits invalidate derived state (spec 2026-08-26, part 1):
    // the glossary derives from the OLD inputs, so clear it (the next
    // activation re-mines JD-first; the next Generate rebuilds it from the
    // fresh digest), and mark generated resources stale so the UI can say
    // "regenerate". Internal saves (dossier, personas, activation backfill)
    // change no grounding fields and pass through untouched.
    if !session.id.is_empty() {
        if let Ok(old) = load(app, &session.id) {
            if conva_core::simcon::grounding_changed(&old, &session) {
                session.glossary.clear();
                if old.dossier_doc_id.is_some() || old.knowledge_profile_id.is_some() {
                    session.resources_stale = true;
                }
            }
        }
    }
```

  Adapt the exact insertion point to the function's real body (read it first); the load-before-write must use the same `load` this module already exposes. If `save` takes `mut session` by value (it does), mutate in place as shown.

- [ ] **Step 3: `src-tauri/src/lib.rs` — regeneration clears stale.** In `simcon_generate_dossier`, immediately before the final `simcon::save(&app, session).map_err(...)` line, insert:

```rust
    // A fresh digest by definition reflects the current inputs.
    session.resources_stale = false;
```

- [ ] **Step 4: `src-tauri/src/lib.rs` — attach/detach keep the context record in sync.** Replace the bodies of `rag_attach_context` and `rag_detach_context` (currently only tagging the RAG store) with:

```rust
/// Tag a document as attached to a Conversation Context AND sync the
/// context's own `source_doc_ids` (spec 2026-08-26, part 1 — pane/library
/// attaches previously never reached the context record, so doc counts and
/// staleness missed them). The context sync is best-effort: the tag
/// operation succeeds even if the context record can't be loaded.
#[tauri::command]
fn rag_attach_context(
    app: AppHandle,
    state: State<AppState>,
    id: String,
    context_id: String,
) -> Result<(), String> {
    state
        .rag
        .attach_context(&id, &context_id)
        .map_err(|e| e.to_string())?;
    sync_context_doc(&app, &context_id, &id, true);
    Ok(())
}

/// Remove a document's tag for a Conversation Context; see
/// [`rag_attach_context`] — also drops the id from the context's
/// `source_doc_ids` (best-effort).
#[tauri::command]
fn rag_detach_context(
    app: AppHandle,
    state: State<AppState>,
    id: String,
    context_id: String,
) -> Result<(), String> {
    state
        .rag
        .detach_context(&id, &context_id)
        .map_err(|e| e.to_string())?;
    sync_context_doc(&app, &context_id, &id, false);
    Ok(())
}

/// Add/remove `doc_id` in a context's `source_doc_ids` and apply the same
/// grounding invalidation the wizard save applies (clear derived glossary;
/// mark generated resources stale). Best-effort by design.
fn sync_context_doc(app: &AppHandle, context_id: &str, doc_id: &str, attach: bool) {
    let Ok(mut session) = simcon::load(app, context_id) else {
        return;
    };
    let had = session.source_doc_ids.iter().any(|d| d == doc_id);
    if attach && !had {
        session.source_doc_ids.push(doc_id.to_string());
    } else if !attach && had {
        session.source_doc_ids.retain(|d| d != doc_id);
    } else {
        return; // no change — don't touch staleness
    }
    session.glossary.clear();
    if session.dossier_doc_id.is_some() || session.knowledge_profile_id.is_some() {
        session.resources_stale = true;
    }
    let _ = simcon::save(app, session);
}
```

  NOTE: the two commands gain an `AppHandle` parameter — Tauri injects it, the frontend call sites need no change. Verify both commands are already registered in the `generate_handler![...]` list (they are; no list change needed). `sync_context_doc` sets staleness itself, so the double-application via `simcon::save`'s new check is harmless (same outcome, idempotent).

- [ ] **Step 5: Verify.** `cargo fmt --check` clean (run `cargo fmt` if needed). Re-read the full `git diff` — braces, the `save` insertion point, no unrelated code moved.

- [ ] **Step 6: Commit.**

```bash
git add src-tauri/src/simcon.rs src-tauri/src/lib.rs
git commit -m "feat(simcon): grounding edits invalidate terms + mark resources stale"
```

(standard trailer; only those two files.)

---

### Task 3: JD terms always merge at activation

**Files:**
- Modify: `src-tauri/src/lib.rs` (`activate_context`, final term fill)

- [ ] **Step 1: Edit.** In `activate_context`, the final fill currently reads:

```rust
    {
        let mut terms = state.active_context_terms.lock().expect("ctx lock");
        terms.clear();
        terms.extend(session.key_terms.iter().cloned());
        terms.extend(session.glossary.iter().cloned());
    }
```

Replace with:

```rust
    {
        let mut terms = state.active_context_terms.lock().expect("ctx lock");
        terms.clear();
        terms.extend(session.key_terms.iter().cloned());
        terms.extend(session.glossary.iter().cloned());
        // The interviewer's own vocabulary always rides along (spec
        // 2026-08-26, part 2) — in-memory only, so live highlighting is
        // never hostage to a stale or truncated digest.
        if let Some(jd) = session.job_description.as_deref() {
            let have: std::collections::HashSet<String> =
                terms.iter().map(|t| t.to_lowercase()).collect();
            terms.extend(
                conva_core::highlight::interviewer_terms(jd, 16)
                    .into_iter()
                    .filter(|t| !have.contains(&t.to_lowercase())),
            );
        }
    }
```

- [ ] **Step 2: Verify.** `cargo fmt --check` clean; re-read the diff.

- [ ] **Step 3: Commit.**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat(grounding): JD vocabulary always merges into activation terms"
```

(standard trailer.)

---

### Task 4: UI — rowStatus helper, Stale pill, "Regenerate resources" menu item, detail note

**Files:**
- Create: `src/components/contexts/rowStatus.ts`
- Create: `src/components/contexts/rowStatus.test.ts`
- Modify: `src/components/contexts/ContextsPane.tsx` (use rowStatus; RowMenu item)
- Modify: `src/components/simcon/SimConDetail.tsx` (stale note on the dossier card)

- [ ] **Step 1: Write the failing test** — `src/components/contexts/rowStatus.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { rowStatus } from "@/components/contexts/rowStatus";
import type { SimConSummary } from "@/lib/ipc";

function summary(overrides: Partial<SimConSummary> = {}): SimConSummary {
  return {
    id: "s1",
    title: "Acme interview",
    category: "interview",
    status: "ready",
    created_at_unix_ms: 0,
    updated_at_unix_ms: 0,
    source_doc_count: 1,
    has_key_terms: false,
    research_enabled: false,
    has_job_description: true,
    has_generated_resources: true,
    ...overrides,
  };
}

describe("rowStatus", () => {
  it("maps each base status", () => {
    expect(rowStatus(summary({ status: "draft", has_generated_resources: false }))).toEqual({
      label: "Draft",
      tone: "pill-idle",
    });
    expect(rowStatus(summary())).toEqual({ label: "Ready", tone: "pill-ready" });
    expect(rowStatus(summary({ status: "running" }))).toEqual({
      label: "Running",
      tone: "pill-accent",
    });
  });

  it("overrides ready/ended with Stale when generated resources are stale", () => {
    expect(rowStatus(summary({ resources_stale: true }))).toEqual({
      label: "Stale",
      tone: "pill-ally",
    });
    expect(rowStatus(summary({ status: "ended", resources_stale: true }))).toEqual({
      label: "Stale",
      tone: "pill-ally",
    });
  });

  it("never marks Stale mid-flight or without generated resources", () => {
    expect(rowStatus(summary({ status: "ingesting", resources_stale: true })).label).toBe(
      "Preparing…",
    );
    expect(rowStatus(summary({ status: "running", resources_stale: true })).label).toBe(
      "Running",
    );
    expect(
      rowStatus(summary({ resources_stale: true, has_generated_resources: false })).label,
    ).toBe("Ready");
  });
});
```

- [ ] **Step 2: Run to verify failure.** Run: `npx vitest run src/components/contexts/rowStatus.test.ts` — expect FAIL (module not found).

- [ ] **Step 3: Implement** — `src/components/contexts/rowStatus.ts`:

```ts
import type { SimConStatus, SimConSummary } from "@/lib/ipc";

/** The row's status pill: label + shared `.pill-*` tone (globals.css). */
export interface RowStatus {
  label: string;
  tone: string;
}

const STATUS_LABEL: Record<SimConStatus, string> = {
  draft: "Draft",
  ingesting: "Preparing…",
  ready: "Ready",
  running: "Running",
  ended: "Ended",
};

const STATUS_TONE: Record<SimConStatus, string> = {
  draft: "pill-idle",
  ingesting: "pill-accent",
  ready: "pill-ready",
  running: "pill-accent",
  ended: "pill-idle",
};

/**
 * Status pill for a context row. One override on top of the base status
 * mapping (spec 2026-08-26, part 3): a settled context (ready/ended) whose
 * generated resources no longer match its inputs shows **Stale** in the
 * advisory gold tone — never mid-flight states, never contexts that have
 * nothing generated yet.
 */
export function rowStatus(s: SimConSummary): RowStatus {
  const settled = s.status === "ready" || s.status === "ended";
  if (settled && s.has_generated_resources && s.resources_stale) {
    return { label: "Stale", tone: "pill-ally" };
  }
  return { label: STATUS_LABEL[s.status], tone: STATUS_TONE[s.status] };
}
```

- [ ] **Step 4: Run to verify pass.** `npx vitest run src/components/contexts/rowStatus.test.ts` — 3/3 PASS.

- [ ] **Step 5: Wire into `ContextsPane.tsx`.**
  - Delete the local `STATUS_LABEL` and `STATUS_TONE` constants (lines ~23–40) and their now-unused `SimConStatus` import if nothing else uses it.
  - Add `import { rowStatus } from "@/components/contexts/rowStatus";`.
  - In the row (inside the map, where `const readiness = readinessOf(s);` sits), add `const status = rowStatus(s);` and replace the pill:

```tsx
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
```

  - `RowMenu`: add an `onRegenerate: (() => void) | null` prop (null = hide the item, e.g. while readiness blocks it). Between the Edit and Delete buttons insert:

```tsx
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
```

  - At the `<RowMenu … />` call site pass:

```tsx
                        onRegenerate={
                          readiness.canGenerate && !isGenerating
                            ? () => onGenerate(s.id)
                            : null
                        }
```

- [ ] **Step 6: Stale note on the detail card.** In `src/components/simcon/SimConDetail.tsx`, inside the "Ally prep document" card, directly under the explanatory `<p className="mt-1 text-[11px] …">…</p>`, add:

```tsx
              {session?.resources_stale && (
                <p className="mt-1 text-[11px] font-semibold text-ai">
                  Inputs changed since this was generated — Regenerate to
                  refresh.
                </p>
              )}
```

- [ ] **Step 7: Verify.** `npm test` — full suite green (146 expected: 143 + 3 new). `npm run build` — clean.

- [ ] **Step 8: Commit.**

```bash
git add src/components/contexts/rowStatus.ts src/components/contexts/rowStatus.test.ts src/components/contexts/ContextsPane.tsx src/components/simcon/SimConDetail.tsx
git commit -m "feat(contexts): Stale pill + first-class Regenerate resources action"
```

(standard trailer.)

---

### Task 5: Full verification + push + PR #85 update

- [ ] **Step 1: Full gate.** Run: `npm run build`, `npm test`, `cargo test -p conva-core`, `cargo fmt --check`, `cargo clippy -p conva-core --all-targets -- -D warnings` — ALL green.
- [ ] **Step 2: Push** `claude/conva-app-ui-modernization-igllsd` (`git push -u origin …`, network-error retries ×4 with 2/4/8/16s backoff).
- [ ] **Step 3: PR #85 body** gains a "## 4. Context edit → regeneration & staleness" section (spec link; the three parts; note the attach/detach sync fix) and these manual-QA items:
  - Edit the Amazon Interview context (tweak the JD) → its row flips to a gold **Stale** pill; ⋯ menu shows **Regenerate resources**; running it returns the pill to Ready and the Terms list leads with JD vocabulary.
  - Attach a doc from the Library pane → the row's doc count bumps and the row goes Stale.
  - Activate the context WITHOUT regenerating → the live Terms list still contains JD vocabulary (the always-merge path).
- [ ] **Step 4: Watch CI** (Windows shell job is the compile gate for Tasks 2–3).

---

## Self-review notes

- Spec coverage: part 1 → Tasks 1–2; part 2 → Task 3; part 3 → Task 4; testing section → Tasks 1, 4, 5. Out-of-scope items have no tasks (intended).
- Type consistency: `resources_stale` optional in TS (`?: boolean`), always-serialized in Rust (`#[serde(default)]` + plain `bool`); `rowStatus` treats `undefined` as false via the `&&` check. `grounding_changed(old, new)` argument order = (stored, incoming) everywhere.
- Shell tasks compile only on CI — every shell step ends with fmt + diff re-read, and Task 5 pushes before QA.

# Panel Width Resize + Interviewer-Term Quality Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** (A) The right Ally panel becomes horizontally resizable via a left-edge drag handle — one persisted width (280–560px, default 340) driving both the panel and the control bar's tab zone. (B) Grounded-context terms become interviewer-relevant: JD vocabulary fills first, mined terms pass a hygiene gate (glue artifacts and fragments die), and the dossier's token budget/glossary fallback stop the truncation failure.

**Architecture:** Part A is presentation-only (uiPrefs + two width consumers + a drag handle). Part B's logic lands as pure, unit-tested functions in `conva-core` (`sanitize_mined_terms`, `interviewer_terms`, `extract_glossary` bold-fallback); `lib.rs` only re-plumbs the `activate_context` backfill and the dossier budget.

**Tech Stack:** React 19, TypeScript, Vitest; Rust (conva-core testable here; conva-app shell compile-verified by CI's Windows job).

**Spec:** `docs/superpowers/specs/2026-08-26-panel-resize-and-term-quality-design.md`.

---

## Before you start

- Branch `claude/conva-app-ui-modernization-igllsd` (PR #85). Commit trailer for every commit:

```
Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Kot4sMxdR3d2DEJ8Z84nu6
```

- Read every file section before editing — anchors below were verified against the current tree but other work shares this branch.

## File Structure

| File | Responsibility |
|---|---|
| `src/state/uiPrefs.ts` (+ `src/state/uiPrefs.panel.test.ts`) | A: `panelWidthPx` pref. |
| `src/components/studio/LiveControlBar.tsx` | A: tab zone takes `tabs.widthPx`. |
| `src/components/transcript/TranscriptView.tsx` | A: panel width + drag handle + render clamp. |
| `crates/conva-core/src/highlight.rs` | B: `sanitize_mined_terms`, `interviewer_terms` (+ tests). |
| `crates/conva-core/src/simcon.rs` | B: `extract_glossary` bold-fallback (+ tests). |
| `src-tauri/src/lib.rs` | B: JD-first backfill + hygiene; dossier max_tokens 2500. |

---

### Task 1: `panelWidthPx` pref

**Files:**
- Modify: `src/state/uiPrefs.ts`
- Test: Create `src/state/uiPrefs.panel.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/state/uiPrefs.panel.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";

import { useUiPrefs } from "@/state/uiPrefs";

describe("panel width pref", () => {
  beforeEach(() => {
    localStorage.removeItem("conva.panel.widthPx");
    useUiPrefs.setState({ panelWidthPx: 340 });
  });

  it("defaults to 340 and clamps to 280-560", () => {
    expect(useUiPrefs.getState().panelWidthPx).toBe(340);
    useUiPrefs.getState().setPanelWidthPx(9999);
    expect(useUiPrefs.getState().panelWidthPx).toBe(560);
    useUiPrefs.getState().setPanelWidthPx(0);
    expect(useUiPrefs.getState().panelWidthPx).toBe(280);
  });

  it("persists to localStorage rounded", () => {
    useUiPrefs.getState().setPanelWidthPx(412.6);
    expect(localStorage.getItem("conva.panel.widthPx")).toBe("413");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/state/uiPrefs.panel.test.ts`
Expected: FAIL — `panelWidthPx` doesn't exist.

- [ ] **Step 3: Implement in `src/state/uiPrefs.ts`**

Next to `PANEL_SPLIT_KEY` add:

```ts
const PANEL_WIDTH_KEY = "conva.panel.widthPx";
const PANEL_WIDTH_MIN = 280;
const PANEL_WIDTH_MAX = 560;
const PANEL_WIDTH_DEFAULT = 340;
```

Interface members (next to `panelSplitRatio`):

```ts
  /** Right Ally panel width, px — drives BOTH the panel and the control
   *  bar's tab zone so they stay aligned (spec A.2). */
  panelWidthPx: number;
  setPanelWidthPx: (px: number) => void;
```

Store members:

```ts
  panelWidthPx: (() => {
    const v = Number(localStorage.getItem(PANEL_WIDTH_KEY));
    return v >= PANEL_WIDTH_MIN && v <= PANEL_WIDTH_MAX
      ? v
      : PANEL_WIDTH_DEFAULT;
  })(),
```

and:

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

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/state/uiPrefs.panel.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/state/uiPrefs.ts src/state/uiPrefs.panel.test.ts
git commit -m "feat(panel): panelWidthPx pref — persisted 280-560, default 340"
```

---

### Task 2: Wire the width + drag handle

**Files:**
- Modify: `src/components/studio/LiveControlBar.tsx`
- Modify: `src/components/transcript/TranscriptView.tsx`

- [ ] **Step 1: Control bar takes the width**

In `LiveControlBar.tsx`, extend the `tabs` prop type:

```tsx
  tabs?: {
    view: AllyPanelView;
    onSelect: (tab: AllyPanelTab) => void;
    /** Matches the Ally panel's current width so the tab zone stays
     *  aligned under it (spec A.2). */
    widthPx: number;
  };
```

and on the tablist container replace `className="flex w-[340px] shrink-0 items-stretch border-l border-border"` with:

```tsx
          style={{ width: tabs.widthPx }}
          className="flex shrink-0 items-stretch border-l border-border"
```

- [ ] **Step 2: Panel width + render clamp in the cockpit**

In `TranscriptView.tsx`'s cockpit (`TranscriptView` function), beside the other uiPrefs selectors add:

```tsx
  const panelWidthPx = useUiPrefs((s) => s.panelWidthPx);
  const setPanelWidthPx = useUiPrefs((s) => s.setPanelWidthPx);
  // Never let the panel squeeze the conversation below ~320px on a narrow
  // window; the 640px drawer breakpoint takes over before this can push
  // under the 280 floor (spec A.2).
  const effectivePanelWidth =
    width > 0 ? Math.min(panelWidthPx, Math.max(280, width - 320)) : panelWidthPx;
```

Pass both down: the `AllyPanel` mount gains `widthPx={effectivePanelWidth}` and `onResize={setPanelWidthPx}`; the `LiveControlBar` mount's `tabs` gains `widthPx: drawer ? 0 : effectivePanelWidth` — **check the drawer render path**: if the control bar renders tabs in drawer mode today, keep them at a fixed sensible width instead (`widthPx: drawer ? 200 : effectivePanelWidth`); read the current mount and match its behavior, reporting which case applied.

- [ ] **Step 3: Panel takes the width + left-edge drag handle**

In `AllyPanel`, add to props:

```tsx
  widthPx: number;
  onResize: (px: number) => void;
```

Change the aside from `w-[340px] max-w-full` to a styled width:

```tsx
    <aside
      style={{ width: widthPx }}
      className={`relative flex h-full max-w-full shrink-0 flex-col border-l border-border bg-bg-2${barPad}`}
    >
```

and as its FIRST child insert the handle (same pointer pattern as the split divider):

```tsx
      {/* Left-edge width handle (spec A.2): dragging left widens. The
          pref clamps 280-560; the cockpit clamps again vs window width. */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize panel"
        onPointerDown={(e) => {
          const startX = e.clientX;
          const startW = widthPx;
          const move = (ev: PointerEvent) =>
            onResize(startW + (startX - ev.clientX));
          const up = () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
          };
          window.addEventListener("pointermove", move);
          window.addEventListener("pointerup", up);
        }}
        className="absolute inset-y-0 left-0 z-30 w-[5px] cursor-col-resize hover:bg-panel-raised"
      />
```

- [ ] **Step 4: Verify + commit**

Run: `npx tsc -b && npx vitest run`
Expected: PASS (all suites; no existing test asserts the 340px width — if one does, update and report).

```bash
git add src/components/studio/LiveControlBar.tsx src/components/transcript/TranscriptView.tsx
git commit -m "feat(panel): resizable width — left-edge drag, tab zone stays aligned"
```

---

### Task 3: `sanitize_mined_terms` (core)

**Files:**
- Modify: `crates/conva-core/src/highlight.rs`

- [ ] **Step 1: Write the failing tests** (append to the existing `doc_terms_tests` module or a new sibling `mod sanitize_tests`)

```rust
#[cfg(test)]
mod sanitize_mined_tests {
    use super::sanitize_mined_terms;

    const DOC: &str = "Built DynamoDB tables and tuned DynamoDB capacity. \
        Migrated workloads to the CloudOpenShift platform once. \
        Used CloudWatch dashboards and CloudWatch alarms daily.";

    #[test]
    fn drops_a_one_occurrence_glue_token_and_keeps_repeaters() {
        let out = sanitize_mined_terms(
            vec![
                "DynamoDB".into(),
                "CloudOpenShift".into(),
                "CloudWatch".into(),
            ],
            DOC,
            None,
            2,
        );
        assert_eq!(out, vec!["DynamoDB".to_string(), "CloudWatch".to_string()]);
    }

    #[test]
    fn jd_presence_rescues_a_single_occurrence() {
        let out = sanitize_mined_terms(
            vec!["CloudOpenShift".into()],
            DOC,
            Some("Experience with CloudOpenShift required."),
            2,
        );
        assert_eq!(out, vec!["CloudOpenShift".to_string()]);
    }

    #[test]
    fn enforces_the_four_word_cap_and_drops_stopword_singles() {
        let doc = "the well architected framework twelve factor app method \
                   the well architected framework twelve factor app method";
        let out = sanitize_mined_terms(
            vec![
                "well architected framework twelve factor".into(), // 5 words
                "the".into(),                                      // stopword
                "well architected framework".into(),               // 3 words, occurs 2x
            ],
            doc,
            None,
            2,
        );
        assert_eq!(out, vec!["well architected framework".to_string()]);
    }

    #[test]
    fn floor_one_keeps_single_occurrences() {
        let out = sanitize_mined_terms(vec!["CloudOpenShift".into()], DOC, None, 1);
        assert_eq!(out, vec!["CloudOpenShift".to_string()]);
    }
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cargo test -p conva-core sanitize_mined`
Expected: compile FAIL — function doesn't exist.

- [ ] **Step 3: Implement** (below `salient_doc_terms`; reuses the file's existing `tokens`, `contains_phrase`, and `STOPWORDS`)

```rust
/// Count non-overlapping word-bounded occurrences of `needle` in `hay`
/// (both already tokenized lowercase).
fn phrase_count(hay: &[String], needle: &[String]) -> usize {
    if needle.is_empty() || needle.len() > hay.len() {
        return 0;
    }
    hay.windows(needle.len()).filter(|w| *w == needle).count()
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
        .filter(|term| {
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
            let in_jd = jd_toks
                .as_ref()
                .is_some_and(|j| contains_phrase(j, &nt));
            in_jd || phrase_count(&doc_toks, &nt) >= min_occurrences
        })
        .collect()
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cargo test -p conva-core sanitize_mined`
Expected: PASS (4 tests). Then `cargo test -p conva-core` — full core suite still green.

- [ ] **Step 5: Commit**

```bash
git add crates/conva-core/src/highlight.rs
git commit -m "feat(highlight): sanitize_mined_terms — hygiene gate for mined vocabulary"
```

---

### Task 4: `interviewer_terms` (core)

**Files:**
- Modify: `crates/conva-core/src/highlight.rs`

- [ ] **Step 1: Write the failing test** (new module below the sanitize tests)

```rust
#[cfg(test)]
mod interviewer_terms_tests {
    use super::interviewer_terms;

    #[test]
    fn mines_jd_vocabulary() {
        let jd = "Deep technical expertise with AWS core services, including \
            EC2, EKS, Lambda, IAM, VPC, S3, and CloudWatch. Define and monitor \
            SLOs, SLAs, and SLIs. Resolve Sev-1 issues and perform RCAs. \
            Design infrastructure using CloudFormation, CDK, or Terraform.";
        let terms = interviewer_terms(jd, 12);
        assert!(!terms.is_empty());
        assert!(terms.len() <= 12);
        let lower: Vec<String> = terms.iter().map(|t| t.to_lowercase()).collect();
        assert!(
            lower.iter().any(|t| t.contains("cloudwatch") || t.contains("terraform") || t.contains("iam")),
            "expected JD vocabulary in {terms:?}"
        );
    }

    #[test]
    fn empty_jd_yields_nothing() {
        assert!(interviewer_terms("", 12).is_empty());
        assert!(interviewer_terms("   ", 12).is_empty());
    }
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cargo test -p conva-core interviewer_terms`
Expected: compile FAIL.

- [ ] **Step 3: Implement** (below `sanitize_mined_terms`)

```rust
/// The interviewer's own vocabulary, mined from the job description — the
/// PRIMARY term signal for interview contexts (spec B.2): the JD literally
/// is what the interviewer will say. Occurrence floor 1 — a JD is short,
/// clean, employer-curated text where a single mention matters.
pub fn interviewer_terms(jd_text: &str, limit: usize) -> Vec<String> {
    if jd_text.trim().is_empty() {
        return Vec::new();
    }
    let mined = salient_doc_terms(jd_text, limit * 2);
    let mut clean = sanitize_mined_terms(mined, jd_text, None, 1);
    clean.truncate(limit);
    clean
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cargo test -p conva-core interviewer_terms`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add crates/conva-core/src/highlight.rs
git commit -m "feat(highlight): interviewer_terms — JD-mined primary vocabulary"
```

---

### Task 5: `extract_glossary` bold-fallback (core)

**Files:**
- Modify: `crates/conva-core/src/simcon.rs`

- [ ] **Step 1: Write the failing test** (append inside the existing `mod tests` in simcon.rs)

```rust
    #[test]
    fn extract_glossary_falls_back_to_bolded_phrases_without_a_section() {
        // A digest truncated before its ## Glossary section (the 2026-08-26
        // Amazon-interview failure) still bolds key terms inline per the
        // prompt — harvest those instead of yielding nothing.
        let md = "## Overview\nStrong match.\n\n## Strong talking points\n\
                  - Used **Terraform** and **EKS** on the account.\n\
                  - Governance via **HashiCorp Sentinel**.\n\
                  - Standards adopted across **12 engineering teams**.";
        let terms = extract_glossary(md);
        assert!(terms.iter().any(|t| t == "Terraform"), "{terms:?}");
        assert!(terms.iter().any(|t| t == "EKS"), "{terms:?}");
        assert!(terms.iter().any(|t| t == "HashiCorp Sentinel"), "{terms:?}");
    }

    #[test]
    fn extract_glossary_prefers_the_real_section_when_present() {
        let md = "## Glossary\n- **RRF** — rank fusion.\n\n## Notes\n\
                  Also mentions **Terraform** in prose.";
        let terms = extract_glossary(md);
        assert_eq!(terms, vec!["RRF".to_string()]);
    }
```

- [ ] **Step 2: Run to verify it fails**

Run: `cargo test -p conva-core extract_glossary`
Expected: the new fallback test FAILS (empty result); the section test may pass already.

- [ ] **Step 3: Implement** — in `extract_glossary`, after the existing loop and before `out`:

```rust
    // Fallback (spec B.3): a digest cut off before its ## Glossary section
    // (token-budget truncation) still bolds the key term in each bullet per
    // the prompt — harvest every **bolded** phrase instead of yielding
    // nothing. Same length/dedupe/cap discipline as the section path.
    if out.is_empty() {
        for raw in digest_md.lines() {
            let mut rest = raw;
            while let Some(start) = rest.find("**") {
                let after = &rest[start + 2..];
                let Some(end) = after.find("**") else { break };
                let term = after[..end].trim().to_string();
                rest = &after[end + 2..];
                if term.is_empty() || term.chars().count() > 60 {
                    continue;
                }
                if !out.iter().any(|t| t.eq_ignore_ascii_case(&term)) {
                    out.push(term);
                }
                if out.len() >= MAX_GLOSSARY_TERMS {
                    return out;
                }
            }
        }
    }
```

- [ ] **Step 4: Run to verify it passes**

Run: `cargo test -p conva-core extract_glossary && cargo test -p conva-core`
Expected: PASS (both new tests; full suite green — the existing
`extract_glossary_pulls_bold_terms_from_the_section` test must still pass;
if its fixture had no section it may now return terms instead of empty —
read it and reconcile, reporting what you found).

- [ ] **Step 5: Commit**

```bash
git add crates/conva-core/src/simcon.rs
git commit -m "feat(simcon): extract_glossary bold-fallback for truncated digests"
```

---

### Task 6: Shell plumbing — JD-first backfill, hygiene, dossier budget

⚠️ Shell crate — no local compile; CI's Windows job verifies. `cargo fmt --check` must pass.

**Files:**
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Dossier budget + glossary hygiene.** In `simcon_generate_dossier` change `dossier_prompt(&session, &profile.research, &chunks, 1200)` → `…, 2500)` (line ~971), and change the glossary assignment near the end from:

```rust
    session.glossary = conva_core::simcon::extract_glossary(&text);
```

to:

```rust
    // Harvested terms pass the mined-term hygiene gate (spec B.2/B.3):
    // bolding is already an LLM-curated signal, so the occurrence floor is
    // 1, but the word-cap and stopword rules still apply, and JD presence
    // still counts in the term's favor.
    session.glossary = conva_core::highlight::sanitize_mined_terms(
        conva_core::simcon::extract_glossary(&text),
        &text,
        session.job_description.as_deref(),
        1,
    );
```

- [ ] **Step 2: First-stage backfill hygiene.** In `activate_context`'s dossier-re-extract backfill (search "re-extract its glossary now"), wrap the same way:

```rust
            let glossary = conva_core::highlight::sanitize_mined_terms(
                conva_core::simcon::extract_glossary(&text),
                &text,
                session.job_description.as_deref(),
                1,
            );
```

- [ ] **Step 3: Second-stage backfill — JD first.** Replace the #77 mining block's body (search `salient_doc_terms` in `activate_context`, currently `for doc_id in &session.source_doc_ids { … salient_doc_terms(&text, 8) … }` with dedupe + truncate(24)) with:

```rust
    if session.glossary.is_empty() && session.key_terms.is_empty() {
        let mut mined: Vec<String> = Vec::new();
        let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
        // The interviewer's vocabulary first (spec B.2): the job
        // description is the best predictor of what the other side will
        // say — up to 16 of the 24 slots.
        if let Some(jd) = session.job_description.as_deref() {
            for term in conva_core::highlight::interviewer_terms(jd, 16) {
                if seen.insert(term.to_lowercase()) {
                    mined.push(term);
                }
            }
        }
        // Then per-document mining fills what's left — gated (floor 2, or
        // JD presence) so one-off extraction-glue artifacts die here.
        for doc_id in &session.source_doc_ids {
            let Some(text) = state.rag.document_text(doc_id) else {
                continue;
            };
            let doc_terms = conva_core::highlight::sanitize_mined_terms(
                conva_core::highlight::salient_doc_terms(&text, 8),
                &text,
                session.job_description.as_deref(),
                2,
            );
            for term in doc_terms {
                if seen.insert(term.to_lowercase()) {
                    mined.push(term);
                }
            }
        }
        if !mined.is_empty() {
            mined.truncate(24);
            session.glossary = mined;
            let _ = simcon::save(&app, session.clone());
        }
    }
```

(Keep the block's existing lead comment, extending it with one line noting JD-primacy per spec B.2.)

- [ ] **Step 4: Verify + commit**

Run: `cargo fmt && cargo fmt --check && cargo test -p conva-core`
Expected: fmt clean; core suite green (shell compiles on CI).

```bash
git add src-tauri/src/lib.rs
git commit -m "feat(grounding): JD-first term mining + hygiene gate + 2500-token dossier"
```

---

### Task 7: Full verification, push, PR update

- [ ] **Step 1:** `npm run build && npm test && cargo test -p conva-core && cargo fmt --check && cargo clippy -p conva-core --all-targets -- -D warnings`
Expected: all PASS.

- [ ] **Step 2:** Push (4× backoff on network failure only). Watch the next CI run — the Windows shell job compiles Task 6's lib.rs changes.

- [ ] **Step 3:** Update PR #85's body: append a "Part 3" section (panel resize + term quality, spec link, the four diagnosed causes and their fixes) and extend the manual-QA list:

- Drag the panel's left edge — tabs stay aligned under it; width survives restart; stops at 280/560; narrow window clamps before squeezing the transcript.
- Delete the truncated "Amazon Interview — Ally prep" doc, regenerate the digest (now 2500 tokens, ends cleanly, has a Glossary), and re-activate the context: Terms should lead with JD vocabulary (EC2, EKS, Lambda, IAM, VPC, SLOs, Sev-1…) and contain no glue artifacts (`CloudOpenShift`), fragments (`Gateway` alone), or merged run-ons.

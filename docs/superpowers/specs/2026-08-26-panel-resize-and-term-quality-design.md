# Panel width resize + interviewer-term quality (v1)

> Brainstorming-skill design doc. Status: **approved** (owner, 2026-08-26 —
> "yes, run both through the pipeline and into one PR"). Two independent
> parts shipping in one PR on `claude/conva-app-ui-modernization-igllsd`.

## Part A — Resizable right panel

### A.1 Problem

The Ally panel and the control bar's tab zone are both hardcoded
`w-[340px]` (`TranscriptView.tsx:1617`, `LiveControlBar.tsx:224`). The
owner wants to resize the panel; the two widths must move together or the
tabs drift out from under the panel.

### A.2 Design (owner-approved)

- One persisted pref `panelWidthPx` (`conva.panel.widthPx`, default 340,
  clamp **min 280 / max 560**) in `uiPrefs`, mechanically identical to the
  existing font prefs.
- A thin vertical drag handle on the panel's **left edge**
  (`cursor-col-resize`, the same pointer-drag pattern as the Found/View
  divider). Dragging left widens, right narrows; the pref updates live.
- The **same value** drives both the panel `<aside>` and the control bar's
  tab zone via `style={{ width }}` — `LiveControlBar`'s `tabs` prop gains
  `widthPx: number`.
- Render-time safety clamp in the cockpit: effective width =
  `min(panelWidthPx, containerWidth − 320)` so the conversation column
  keeps ≥~320px on a narrow window (never below the 280 floor; if the
  container can't fit 280 + 320, the drawer breakpoint at 640px has
  already taken over anyway).
- Drawer mode (<640px) unchanged — the overlay drawer isn't resizable.

### A.3 Testing

- uiPrefs clamp/persist test (same shape as `uiPrefs.partner.test.ts`).
- Owner manual pass: drag the panel edge; tabs stay aligned; width
  survives restart; min/max stops hold; narrow window clamps.

## Part B — Terms that matter to the interviewer

### B.1 Problem (diagnosed 2026-08-26, owner's Amazon-interview context)

Observed "From your documents" terms included `CloudOpenShift` (a PDF
line-break glue artifact from the resume), `Gateway` (fragment of "API/
Transit Gateway"), `Well-Architected Framework 12-Factor` (two concepts
merged), and `Azure`/`CSRF`/`OpenShift Container Platform` (real resume
vocabulary, irrelevant to an AWS interview). Four compounding causes:

1. `simcon_generate_dossier` caps the digest at **1200 max_tokens** — the
   owner's digest truncated mid-sentence before its `## Glossary` section
   existed, so glossary extraction yielded nothing.
2. With no glossary/key terms, `activate_context`'s fallback miner
   (`salient_doc_terms`, PR #77) mines each attached document **in
   isolation** — surfacing resume vocabulary, with no scoring against the
   job description (the best predictor of interviewer vocabulary).
3. No hygiene gate: glued tokens, fragments, and run-on merges pass
   straight into the term list.
4. Upstream PDF extraction glues words; nothing downstream compensates.

### B.2 Design (owner-approved recommendation)

All pure logic lands in `conva-core` with unit tests; the shell only
re-plumbs call sites.

1. **JD primacy.** New pure `conva_core::highlight::interviewer_terms(
   jd_text: &str, limit: usize) -> Vec<String>` — mines the job
   description itself via the existing `salient_doc_terms` machinery (the
   JD is clean typed text: EC2, EKS, IAM, SLOs, Sev-1/Sev-2, Terraform…).
   In `activate_context`'s backfill: when `session.job_description` is
   non-empty, JD terms fill first (up to 16), then per-doc mined terms
   fill remaining slots to the 24 cap. JD terms lead the list; resume-only
   vocabulary only rides along if slots remain AND it passes hygiene.
2. **Hygiene gate.** New pure `conva_core::highlight::sanitize_mined_terms(
   terms: Vec<String>, doc_text: &str, jd_text: Option<&str>) ->
   Vec<String>` applied to every MINED term (user-typed key terms are
   never filtered):
   - ≤ 4 words per term;
   - a mined term must occur **≥ 2 times** in its source document OR occur
     in the JD text (word-boundary, case-insensitive) — kills one-off glue
     artifacts like `CloudOpenShift` while keeping real camel-case product
     names (`DynamoDB`, `CloudWatch`) that repeat or appear in the JD;
   - single all-lowercase generic words are dropped (existing stopword
     list; acronyms/capitalized entities pass).
3. **Truncation fix.** `simcon_generate_dossier` max_tokens 1200 → 2500,
   and `extract_glossary` gains a fallback: when the digest has no
   `## Glossary` section, harvest the **bolded** phrases from the whole
   digest (the prompt already demands "bold the key term in each") —
   passed through the same hygiene gate (digest text as the source,
   occurrence floor 1 since bolding is already an LLM-curated signal, but
   the ≤4-words and generic-word rules still apply).
4. **Out of scope (fast-follow):** a strict-JSON LLM extraction pass
   ("the 15–25 terms this interviewer is most likely to say") replacing
   heuristics when an LLM key exists; re-ingestion fixes for glued PDF
   extraction.

### B.3 Testing

- Core unit tests: `interviewer_terms` mines JD vocabulary from a realistic
  JD sample; `sanitize_mined_terms` kills a one-occurrence glue token,
  keeps a repeating camel-case product, keeps a JD-present single
  occurrence, enforces the word cap; `extract_glossary` bold-fallback
  works on a digest without a Glossary section and still prefers the
  real section when present.
- Shell changes (`activate_context` ordering, max_tokens) are
  compile-verified by CI's Windows job; behavior verified by the owner
  re-activating the Amazon Interview context and checking the Terms list
  now leads with JD vocabulary and contains no glue artifacts.

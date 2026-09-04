# Context Category Templates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface the per-category `ConversationTemplate` (`file_slots`, `digest_sections`) — which already exists in Rust and already drives real generation behavior — in the UI: the Setup wizard's Step 2 groups attachable documents into the category's named slots instead of one flat list, `ContextDetail`'s document list does the same post-save, and Step 1 previews what Ally will generate for the chosen category. Slots stay advisory (never block Finish); no new bespoke per-category fields.

**Architecture:** One new backend field (`ConversationContext.slot_doc_ids: BTreeMap<String, Vec<String>>`, mirrored to TS) records which attached doc ids are filed under which slot key — purely organizational, the grounding pipeline still reads the existing flat `source_doc_ids`. A new shared `categoryTemplates.ts` completes `ContextSetup.tsx`'s existing hand-mirror of the Rust template (it already partially mirrors `label`/`research`; this adds `fileSlots`/`digestSections`) so both the Setup wizard and `ContextDetail` group from one source. A new pure `groupBySlot` helper (alongside the existing `splitDocuments` in `documentSplit.ts`) partitions a doc list into per-slot buckets plus an "Other documents" catch-all, used identically by both surfaces.

**Tech Stack:** Rust (`crates/conva-core`) for the data model, TypeScript/React/vitest for everything else. No new Tauri command — this is static per-category data with one source of truth in Rust and a hand-kept TS mirror, same pattern `CATEGORY_ICON`/`CATEGORY_LABEL` in `ContextsPane.tsx` already use.

Spec: `docs/superpowers/specs/2026-09-03-context-category-templates-design.md`.

**Two deliberate deviations from the spec's literal code snippets** (both justified below, both harmless to the spec's actual requirements):

1. **`ConversationContext.slot_doc_ids` is `slot_doc_ids?: Record<string, string[]>` in TypeScript (optional), not the spec's non-optional `slot_doc_ids: Record<string, string[]>`.** Every field on `ConversationContext` added after the type's original design (`research_enabled?`, `key_terms?`, `glossary?`, `resources_stale?`, `resources_generated_at_unix_ms?`, …) is optional in `src/lib/ipc.ts` — a deliberate house convention so a new field doesn't force every existing test fixture and object literal across the app to be updated in the same commit. Only the day-one fields (`id`, `title`, `source_doc_ids`, …) are required. Following that convention here (rather than the spec's snippet) avoids a pile of unrelated fixture edits with zero behavior difference — the Rust side still defaults it via `#[serde(default)]` regardless.
2. **`ContextFileSlot` is defined once, in `src/components/context/categoryTemplates.ts`, not duplicated into `src/lib/ipc.ts`.** The spec's data-model section (§1) shows the same `ContextFileSlot` interface added to both `ipc.ts` and `categoryTemplates.ts` — but nothing in the spec ever imports or uses the `ipc.ts` copy; every actual use (`groupBySlot`'s `SlotGroup.slot`, the Setup wizard, `ContextDetail`) is the `categoryTemplates.ts` one. `ipc.ts` only needs the `slot_doc_ids: Record<string, string[]>` field — the doc ids map, not the slot shape. Keeping one canonical `ContextFileSlot` avoids two type definitions silently drifting apart.

**Standard commit trailer for every commit in this plan:**

```
Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GiKzMingp6q12HJcuxRSZp
```

---

### Task 1 (Phase 1): Rust core — `slot_doc_ids` field on `ConversationContext`

**Files:**
- Modify: `crates/conva-core/src/context.rs`
- Modify: `src-tauri/src/context.rs` (companion literal — not locally compilable in this sandbox; see Step 5)

- [ ] **Step 1: Write the failing test.** Add to `crates/conva-core/src/context.rs`'s `#[cfg(test)] mod tests` block (near `sample_context()`, around line 1242), mirroring the exact back-compat pattern already used in `crates/conva-core/src/rag.rs`'s `old_documents_without_the_new_fields_deserialize_as_file_sourced`:

```rust
#[test]
fn old_contexts_without_slot_doc_ids_deserialize_with_an_empty_map() {
    // A context persisted before slot_doc_ids existed — must still load
    // (serde default), reading every attached doc as unslotted (it falls
    // into the UI's "Other documents" catch-all rather than losing data
    // or failing to deserialize).
    let old_json = r#"{
        "id": "s1",
        "title": "Senior Accountant Interview",
        "purpose": "Prep for GAAP questions",
        "job_description": null,
        "category": "interview",
        "status": "ready",
        "created_at_unix_ms": 0,
        "updated_at_unix_ms": 0,
        "source_doc_ids": [],
        "auto_generate_context": false,
        "research_enabled": true,
        "key_terms": [],
        "glossary": [],
        "glossary_definitions": {},
        "knowledge_profile_id": null,
        "personas": [],
        "chosen_persona_id": null,
        "conversation_id": null,
        "dossier_doc_id": null,
        "research_doc_id": null,
        "deep_qa_enabled": false,
        "qa_doc_id": null,
        "resources_stale": false,
        "resources_generated_at_unix_ms": null
    }"#;
    let ctx: ConversationContext = serde_json::from_str(old_json).unwrap();
    assert!(ctx.slot_doc_ids.is_empty());
}
```

- [ ] **Step 2: Run to verify failure.** Run: `cargo test -p conva-core old_contexts_without_slot_doc_ids` — expect a COMPILE FAILURE: `error[E0609]: no field \`slot_doc_ids\` on type \`ConversationContext\`` (the field doesn't exist yet).

- [ ] **Step 3: Implement — add the field.** In `crates/conva-core/src/context.rs`, find `ConversationContext`'s last field (currently `resources_generated_at_unix_ms`, ends the struct around line 250). Insert a new field right after `source_doc_ids` (per the spec's placement — logically grouped with the other doc-id fields), i.e. right before `auto_generate_context`:

```rust
    /// Library documents attached at setup (Step 1, Path A) — `RagDocument` ids
    /// the ingestion phase folds into the `KnowledgeProfile`.
    #[serde(default)]
    pub source_doc_ids: Vec<String>,
    /// Which attached document ids are filed under which of the category's
    /// `ConversationTemplate::file_slots`, keyed by `FileSlot::key`. Purely
    /// organizational for the setup/detail UI — the grounding pipeline still
    /// reads `source_doc_ids` (the flat union) for what actually indexes, this
    /// map only drives per-slot display. A doc id present in `source_doc_ids`
    /// but absent from every slot's list here is unslotted — rendered under
    /// the UI's "Other documents" catch-all rather than under a synthetic
    /// slot key. `#[serde(default)]` so a context saved before this field
    /// existed deserializes with an empty map (all its docs read as
    /// unslotted) — no migration, no data loss.
    #[serde(default)]
    pub slot_doc_ids: std::collections::BTreeMap<String, Vec<String>>,
    /// Whether Ally should auto-generate context (Step 1, Path B) during ingest.
    #[serde(default)]
    pub auto_generate_context: bool,
```

- [ ] **Step 4: Fix the now-broken struct literal.** In the same file's test module, `sample_context()` (around line 1242) constructs a `ConversationContext` literal with every field explicit — it now fails to compile too. Add the new field right after `source_doc_ids: vec![],`:

```rust
            source_doc_ids: vec![],
            slot_doc_ids: std::collections::BTreeMap::new(),
            auto_generate_context: false,
```

- [ ] **Step 5: Fix the shell's companion literal (manual — not locally compilable).** `src-tauri/src/context.rs`'s `ensure_default_context` (around line 87) also constructs a full `ConversationContext` literal — it breaks the same way, but `src-tauri` isn't locally compilable in this sandbox (`gdk-sys`/GTK build deps aren't available; confirmed via `cargo check -p conva-app`, matches the note already on PR #110's shell changes). Edit it anyway — CI's Windows job is the real compile gate for this file. Add the field right after `source_doc_ids: vec![doc_id.clone()],`:

```rust
            source_doc_ids: vec![doc_id.clone()],
            slot_doc_ids: std::collections::BTreeMap::new(),
            auto_generate_context: false,
```

  Then grep to confirm no other Rust file constructs a bare `ConversationContext { ... }` literal that would also need the field:

  Run: `grep -rn "ConversationContext {" crates/ src-tauri/`
  Expected: exactly two hits — `crates/conva-core/src/context.rs` (the `sample_context()` fixture, now fixed) and `src-tauri/src/context.rs` (now fixed). If a third hit appears, add the same field there too before continuing.

- [ ] **Step 6: Run to verify pass.** Run: `cargo test -p conva-core` — ALL tests pass, including the new `old_contexts_without_slot_doc_ids_deserialize_with_an_empty_map`. Also run `cargo fmt --check` and `cargo clippy -p conva-core --all-targets -- -D warnings` — both clean.

- [ ] **Step 7: Commit.**

```bash
git add crates/conva-core/src/context.rs src-tauri/src/context.rs
git commit -m "feat(context): add slot_doc_ids field for per-category document filing"
```

(standard trailer.)

---

### Task 2 (Phase 2): TypeScript IPC mirror

**Files:**
- Modify: `src/lib/ipc.ts`

- [ ] **Step 1: Add the field.** In `src/lib/ipc.ts`'s `ConversationContext` interface (starts line 357), add `slot_doc_ids` right after `source_doc_ids` (mirroring the Rust field's placement from Task 1), matching this file's existing convention that every field added after the type's original design is optional (see the plan header's deviation note):

```ts
  /** Library docs attached at setup (Path A) — RagDocument ids. */
  source_doc_ids: string[];
  /** Which attached doc ids are filed under which of the category's file
   * slots, keyed by slot key (see `categoryTemplates.ts`'s `ContextFileSlot`).
   * Purely organizational for the setup/detail UI. Optional: older records
   * (and any object literal that predates this field) read as empty —
   * every doc renders as unslotted ("Other documents") until re-filed. */
  slot_doc_ids?: Record<string, string[]>;
  /** Whether Ally should auto-generate context (Path B) during ingest. */
  auto_generate_context: boolean;
```

- [ ] **Step 2: Verify no breakage.** Run: `npx tsc -b` — clean (the field is optional, so no existing `ConversationContext` object literal or test fixture needs updating). This is a pure type addition with no test-worthy logic of its own — the back-compat guarantee is already covered by Task 1's Rust test (deserializing old JSON) and will be exercised end-to-end by Task 4's `groupBySlot` tests (an empty `slotDocIds` map).

- [ ] **Step 3: Commit.**

```bash
git add src/lib/ipc.ts
git commit -m "feat(ipc): mirror ConversationContext.slot_doc_ids"
```

(standard trailer.)

---

### Task 3 (Phase 3): `categoryTemplates.ts` — complete the template mirror

**Files:**
- Create: `src/components/context/categoryTemplates.ts`
- Create: `src/components/context/categoryTemplates.test.ts`
- Modify: `src/components/context/ContextSetup.tsx`

- [ ] **Step 1: Write the failing test.**

```ts
import { describe, expect, it } from "vitest";

import { CATEGORIES, categoryTemplate, researchDefault } from "@/components/context/categoryTemplates";

describe("categoryTemplates", () => {
  it("every category has non-empty file slots and digest sections", () => {
    for (const c of CATEGORIES) {
      expect(c.fileSlots.length).toBeGreaterThan(0);
      expect(c.digestSections.length).toBeGreaterThan(0);
    }
  });

  it("categoryTemplate falls back to the first entry for an unrecognized value", () => {
    // @ts-expect-error deliberately probing the defensive fallback with a
    // value outside the ContextCategory union.
    expect(categoryTemplate("nonsense")).toBe(CATEGORIES[0]);
  });

  it("researchDefault matches decision 2 (interview/sales/live_stream on, company_meeting/other off)", () => {
    expect(researchDefault("interview")).toBe(true);
    expect(researchDefault("sales_call")).toBe(true);
    expect(researchDefault("live_stream")).toBe(true);
    expect(researchDefault("company_meeting")).toBe(false);
    expect(researchDefault("other")).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure.** Run: `npx vitest run src/components/context/categoryTemplates.test.ts` — expect FAIL (`Cannot find module '@/components/context/categoryTemplates'`).

- [ ] **Step 3: Implement — create the file.** `src/components/context/categoryTemplates.ts`, content matches `crates/conva-core/src/context.rs`'s `ContextCategory::template()` field-for-field (verified against the actual Rust match arms — labels, slot keys, slot labels, `multiple` flags, and digest section headings all cross-checked):

```ts
import type { ContextCategory } from "@/lib/ipc";

export interface ContextFileSlot {
  key: string;
  label: string;
  multiple: boolean;
}

export interface CategoryTemplate {
  value: ContextCategory;
  label: string;
  hint: string;
  research: boolean;
  fileSlots: ContextFileSlot[];
  digestSections: string[];
}

// Mirrors crates/conva-core/src/context.rs's ContextCategory::template()
// field-for-field. Change one, change the other in the same commit (same
// hand-mirror discipline as the Rust<->TS IPC contract generally).
export const CATEGORIES: CategoryTemplate[] = [
  {
    value: "interview",
    label: "Interview",
    hint: "Job or panel interview",
    research: true,
    fileSlots: [
      { key: "resume", label: "Résumé / CV", multiple: false },
      { key: "job_description", label: "Job description", multiple: false },
      { key: "interview_test", label: "Take-home / test", multiple: true },
    ],
    digestSections: [
      "Role profile",
      "Core vocabulary",
      "Likely questions & strong answers",
      "Facts & figures",
    ],
  },
  {
    value: "company_meeting",
    label: "Company meeting",
    hint: "Internal — financials, reviews, planning",
    research: false,
    fileSlots: [
      { key: "financials", label: "Financials / reports", multiple: true },
      { key: "decks", label: "Decks", multiple: true },
      { key: "minutes", label: "Prior minutes", multiple: true },
    ],
    digestSections: ["Key figures", "Core vocabulary", "Likely discussion points"],
  },
  {
    value: "sales_call",
    label: "Sales call",
    hint: "Demo, objection handling",
    research: true,
    fileSlots: [{ key: "account", label: "Prospect / account docs", multiple: true }],
    digestSections: ["Company background", "Core vocabulary", "Objections", "Talking points"],
  },
  {
    value: "live_stream",
    label: "Live stream",
    hint: "Podcast, stream, live-commerce broadcast",
    research: true,
    fileSlots: [
      { key: "rundown", label: "Show rundown / outline", multiple: false },
      { key: "guest_bio", label: "Guest bio", multiple: true },
      { key: "talking_points", label: "Talking points / script", multiple: true },
    ],
    digestSections: [
      "Episode outline",
      "Core vocabulary",
      "Guest background",
      "Likely audience questions",
    ],
  },
  {
    value: "other",
    label: "Other",
    hint: "Anything high-stakes",
    research: false,
    fileSlots: [{ key: "files", label: "Files", multiple: true }],
    digestSections: ["Core vocabulary", "Summary", "Likely questions"],
  },
];

export const categoryTemplate = (c: ContextCategory): CategoryTemplate =>
  CATEGORIES.find((x) => x.value === c) ?? CATEGORIES[0]!;

export const researchDefault = (c: ContextCategory): boolean => categoryTemplate(c).research;
```

- [ ] **Step 4: Move `ContextSetup.tsx` onto the new module.** In `src/components/context/ContextSetup.tsx`:

  Delete lines 13–39 (the local `CATEGORIES` array) and lines 38–39 (the local `researchDefault` function) — i.e. delete this whole block:

```ts
// Mirrors conva_core::context templates. `research` = the web-research default
// for the type (decision 2 — on for interview/sales, off for internal meetings).
const CATEGORIES: {
  value: ContextCategory;
  label: string;
  hint: string;
  research: boolean;
}[] = [
  { value: "interview", label: "Interview", hint: "Job or panel interview", research: true },
  {
    value: "company_meeting",
    label: "Company meeting",
    hint: "Internal — financials, reviews, planning",
    research: false,
  },
  { value: "sales_call", label: "Sales call", hint: "Demo, objection handling", research: true },
  {
    value: "live_stream",
    label: "Live stream",
    hint: "Podcast, stream, live-commerce broadcast",
    research: true,
  },
  { value: "other", label: "Other", hint: "Anything high-stakes", research: false },
];

const researchDefault = (c: ContextCategory): boolean =>
  CATEGORIES.find((x) => x.value === c)?.research ?? false;
```

  Replace the file's import block (lines 1–11) with one that adds `CATEGORIES`/`categoryTemplate`/`researchDefault` from the new module:

```tsx
import { useEffect, useState } from "react";

import { CATEGORY_ICON } from "@/components/contexts/ContextsPane";
import { CATEGORIES, categoryTemplate, researchDefault } from "@/components/context/categoryTemplates";
import { Section, ViewShell } from "@/components/studio/ViewShell";
import { Icon } from "@/components/ui/Icon";
import { useBackend } from "@/lib/backend";
import { useCapabilities } from "@/lib/backend/context";
import { splitDocuments } from "@/components/context/documentSplit";
import { buildQaMarkdown, parseQaImport } from "@/components/transcript/qaPairs";
import type { RagDocument, ContextCategory, ConversationContext } from "@/lib/ipc";
import { isDesktop } from "@/lib/platform";
```

  Every existing call site — `CATEGORIES.map(...)` (Step 1's type picker, Step 3's review), `CATEGORIES.find(...)` (the "Let Ally research" default-label line, Step 3's type label), `researchDefault(...)` (initial `research` state, `pickCategory`) — keeps working unchanged: the imported `CATEGORIES`/`researchDefault` have a superset of the same shape (`value`/`label`/`hint`/`research` plus the new `fileSlots`/`digestSections`).

- [ ] **Step 5: Run to verify pass.** Run: `npx vitest run src/components/context/categoryTemplates.test.ts src/components/context/ContextSetup.test.tsx` — all PASS (the 3 new tests, plus all of `ContextSetup.test.tsx`'s existing tests still green — nothing in Step 2's render tree changed yet, only where `CATEGORIES`/`researchDefault` come from). Also run `npx tsc -b` — clean.

- [ ] **Step 6: Commit.**

```bash
git add src/components/context/categoryTemplates.ts src/components/context/categoryTemplates.test.ts src/components/context/ContextSetup.tsx
git commit -m "refactor(context): extract categoryTemplates.ts, complete the Rust template mirror"
```

(standard trailer.)

---

### Task 4 (Phase 4): `documentSplit.ts` — `groupBySlot`

**Files:**
- Modify: `src/components/context/documentSplit.ts`
- Modify: `src/components/context/documentSplit.test.ts`

- [ ] **Step 1: Write the failing tests.** Append to `src/components/context/documentSplit.test.ts` (the file already has a `doc()` fixture helper and imports `RagDocument`/`describe`/`expect`/`it` — reuse them, just add the new import and describe block):

  Add to the top import block: `import { groupBySlot, splitDocuments } from "@/components/context/documentSplit";` and `import type { ContextFileSlot } from "@/components/context/categoryTemplates";` (extend, don't duplicate, the existing `import { splitDocuments } from ...` line).

```ts
describe("groupBySlot", () => {
  const slots: ContextFileSlot[] = [
    { key: "resume", label: "Résumé / CV", multiple: false },
    { key: "job_description", label: "Job description", multiple: false },
  ];

  it("puts a doc into the slot whose slotDocIds list contains its id", () => {
    const resume = doc({ id: "d1", file_name: "resume.pdf" });
    const { slots: groups } = groupBySlot([resume], slots, { resume: ["d1"] });
    expect(groups[0]!.docs).toEqual([resume]);
    expect(groups[1]!.docs).toEqual([]);
  });

  it("puts a doc absent from every slot's list into `other`", () => {
    const misc = doc({ id: "d2", file_name: "misc.txt" });
    const { other } = groupBySlot([misc], slots, {});
    expect(other).toEqual([misc]);
  });

  it("puts every doc into `other` when slotDocIds is empty (back-compat, pre-migration contexts)", () => {
    const a = doc({ id: "d1" });
    const b = doc({ id: "d2" });
    const { slots: groups, other } = groupBySlot([a, b], slots, {});
    expect(other).toEqual([a, b]);
    expect(groups.every((g) => g.docs.length === 0)).toBe(true);
  });

  it("keeps a slot in the result with an empty docs array when nothing matches", () => {
    const { slots: groups } = groupBySlot([], slots, {});
    expect(groups).toHaveLength(2);
    expect(groups[0]).toEqual({ slot: slots[0], docs: [] });
  });
});
```

- [ ] **Step 2: Run to verify failure.** Run: `npx vitest run src/components/context/documentSplit.test.ts` — expect FAIL (`groupBySlot` is not exported from `documentSplit.ts`).

- [ ] **Step 3: Implement.** Append to `src/components/context/documentSplit.ts` (add `import type { ContextFileSlot } from "@/components/context/categoryTemplates";` to the top import block first):

```ts
export interface SlotGroup {
  slot: ContextFileSlot;
  docs: RagDocument[];
}

/**
 * Partition a context's attachable documents (already filtered to exclude
 * Ally-generated docs, per `splitDocuments`) into the category's file
 * slots plus an "Other documents" catch-all. A doc id goes into a slot
 * when `slotDocIds[slot.key]` contains it — a doc id can legitimately
 * appear under more than one slot (e.g. the same doc filed as both
 * "Financials" and "Decks") if the user attaches it from both slots'
 * pickers; that's allowed, not deduped. A doc in `attachable` but not
 * listed under ANY slot — including every doc on a context saved before
 * `slot_doc_ids` existed — lands in `other`. Used by both the Setup
 * wizard (Step 2) and ContextDetail so the two surfaces group identically.
 */
export function groupBySlot(
  attachable: readonly RagDocument[],
  fileSlots: readonly ContextFileSlot[],
  slotDocIds: Readonly<Record<string, string[]>>,
): { slots: SlotGroup[]; other: RagDocument[] } {
  const byId = new Map(attachable.map((d) => [d.id, d]));
  const claimed = new Set<string>();
  const slots = fileSlots.map((slot) => {
    const docs = (slotDocIds[slot.key] ?? [])
      .map((id) => byId.get(id))
      .filter((d): d is RagDocument => !!d);
    docs.forEach((d) => claimed.add(d.id));
    return { slot, docs };
  });
  const other = attachable.filter((d) => !claimed.has(d.id));
  return { slots, other };
}
```

- [ ] **Step 4: Run to verify pass.** Run: `npx vitest run src/components/context/documentSplit.test.ts` — all PASS (existing `splitDocuments` tests plus the 4 new `groupBySlot` tests). Also run `npx tsc -b` — clean.

- [ ] **Step 5: Commit.**

```bash
git add src/components/context/documentSplit.ts src/components/context/documentSplit.test.ts
git commit -m "feat(context): add groupBySlot for per-slot document grouping"
```

(standard trailer.)

---

### Task 5 (Phase 5): `ContextSetup.tsx` Step 2 — per-slot document sections

**Files:**
- Modify: `src/components/context/ContextSetup.tsx`
- Modify: `src/components/context/ContextSetup.test.tsx`

- [ ] **Step 1: Write the failing tests.** Append to `src/components/context/ContextSetup.test.tsx` inside the `describe("ContextSetup wizard", ...)` block:

```tsx
  it("shows the selected category's slot section labels, and switches them on category change", async () => {
    renderSetup();
    const name = await screen.findByPlaceholderText(/Senior Accountant interview/i);
    fireEvent.change(name, { target: { value: "New one" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    // Interview is the default type.
    expect(screen.getByRole("heading", { name: /résumé \/ cv/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /job description/i })).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /take-home \/ test \(multiple\)/i }),
    ).toBeInTheDocument();

    // Two "Back" buttons share this accessible name — ViewShell's own header
    // chevron (rendered whenever `onBack` is passed, unrelated to the
    // wizard) and the wizard's own step-nav button. The wizard's is the one
    // rendered second (DOM order: header chrome, then the step footer).
    fireEvent.click(screen.getAllByRole("button", { name: "Back" })[1]!);
    fireEvent.click(screen.getByRole("button", { name: "Company meeting" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(
      screen.getByRole("heading", { name: /financials \/ reports \(multiple\)/i }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /résumé \/ cv/i })).toBeNull();
  });

  it("shows the category's digest-section preview under the Type picker (Step 1)", async () => {
    renderSetup();
    await screen.findByRole("button", { name: "Interview" });
    expect(
      screen.getByText(
        "Ally will generate: Role profile, Core vocabulary, Likely questions & strong answers, Facts & figures",
      ),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Other" }));
    expect(
      screen.getByText("Ally will generate: Core vocabulary, Summary, Likely questions"),
    ).toBeInTheDocument();
  });

  it("attaching a doc via a slot's own checkbox adds it to both selected and slotDocIds in the save payload", async () => {
    const save = vi.fn().mockResolvedValue({ id: "s1" });
    const prepare = vi.fn().mockResolvedValue({ id: "s1" });
    const resumeDoc = {
      id: "d1",
      file_name: "resume.pdf",
      enabled: true,
      chunk_count: 1,
      ingested_at_unix_ms: 0,
      source: "file" as const,
      context_ids: [],
      size_bytes: 100,
    };
    const backend = {
      rag: { list: vi.fn().mockResolvedValue([resumeDoc]) },
      context: { save, prepare },
      capabilities: vi.fn().mockResolvedValue(null),
    } as unknown as ConvaBackend;

    render(
      <BackendProvider backend={backend}>
        <ContextSetup onDone={() => undefined} onCancel={() => undefined} />
      </BackendProvider>,
    );

    const name = await screen.findByPlaceholderText(/Senior Accountant interview/i);
    fireEvent.change(name, { target: { value: "New one" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    await screen.findAllByText("resume.pdf");
    fireEvent.click(screen.getByRole("checkbox", { name: "Attach resume.pdf to Résumé / CV" }));

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Finish" }));

    await waitFor(() => expect(save).toHaveBeenCalled());
    const payload = save.mock.calls[0][0];
    expect(payload.source_doc_ids).toEqual(["d1"]);
    expect(payload.slot_doc_ids).toEqual({ resume: ["d1"] });
  });

  it("'Other documents' still attaches a doc via its flat checkbox without filing it under any slot", async () => {
    const save = vi.fn().mockResolvedValue({ id: "s1" });
    const prepare = vi.fn().mockResolvedValue({ id: "s1" });
    const miscDoc = {
      id: "d1",
      file_name: "misc.txt",
      enabled: true,
      chunk_count: 1,
      ingested_at_unix_ms: 0,
      source: "file" as const,
      context_ids: [],
      size_bytes: 50,
    };
    const backend = {
      rag: { list: vi.fn().mockResolvedValue([miscDoc]) },
      context: { save, prepare },
      capabilities: vi.fn().mockResolvedValue(null),
    } as unknown as ConvaBackend;

    render(
      <BackendProvider backend={backend}>
        <ContextSetup onDone={() => undefined} onCancel={() => undefined} />
      </BackendProvider>,
    );

    const name = await screen.findByPlaceholderText(/Senior Accountant interview/i);
    fireEvent.change(name, { target: { value: "New one" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    await screen.findAllByText("misc.txt");
    fireEvent.click(screen.getByRole("checkbox", { name: "Attach misc.txt" }));

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Finish" }));

    await waitFor(() => expect(save).toHaveBeenCalled());
    const payload = save.mock.calls[0][0];
    expect(payload.source_doc_ids).toEqual(["d1"]);
    expect(payload.slot_doc_ids).toEqual({});
  });
```

- [ ] **Step 2: Run to verify failure.** Run: `npx vitest run src/components/context/ContextSetup.test.tsx` — the 4 new tests FAIL (no per-slot headings exist yet; "Attach resume.pdf to Résumé / CV" and the digest-preview text don't exist yet; `payload.slot_doc_ids` is `undefined`). The pre-existing tests still PASS (nothing implemented yet).

- [ ] **Step 3: Implement.** In `src/components/context/ContextSetup.tsx`:

  Add `import { groupBySlot } from "@/components/context/documentSplit";` to the import block (extend the existing `import { splitDocuments } from "@/components/context/documentSplit";` line into `import { groupBySlot, splitDocuments } from "@/components/context/documentSplit";`).

  Add new state right after the existing `selected` state (around line 74–76):

```tsx
  const [selected, setSelected] = useState<string[]>(
    initial?.source_doc_ids ?? [],
  );
  const [slotDocIds, setSlotDocIds] = useState<Record<string, string[]>>(
    initial?.slot_doc_ids ?? {},
  );
```

  Replace the `addDocuments` function (currently takes no arguments) with a version taking an optional slot key:

```tsx
  // Path A — add files directly: copy them into this Context's folder, then
  // ingest into the RAG library so the counterparty is grounded in them.
  // `slotKey` files the newly-added doc(s) under that slot too (when added
  // from a slot's own "Add documents…" button); omitted (the "Other
  // documents" section's button) leaves them unslotted.
  const addDocuments = async (slotKey?: string) => {
    setAdding(true);
    setError(null);
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const picked = await open({
        multiple: true,
        filters: [{ name: "Documents", extensions: DOC_EXTENSIONS }],
      });
      const paths = Array.isArray(picked) ? picked : picked ? [picked] : [];
      if (paths.length === 0) return;
      const stored = await backend.context.storeDocs(title.trim() || "untitled", paths);
      const reports = await backend.rag.ingest(stored);
      const newIds = reports.map((r) => r.document.id);
      setDocs(await backend.rag.list());
      setSelected((s) => Array.from(new Set([...s, ...newIds])));
      if (slotKey) {
        setSlotDocIds((prev) => ({
          ...prev,
          [slotKey]: Array.from(new Set([...(prev[slotKey] ?? []), ...newIds])),
        }));
      }
    } catch {
      setError("Couldn't add documents.");
    } finally {
      setAdding(false);
    }
  };
```

  Add a new `toggleSlotDoc` function right after `toggleDoc` (around line 166–167):

```tsx
  const toggleDoc = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  // Checking a slot's checkbox files the doc under that slot AND keeps it
  // in `selected` (the flat source_doc_ids grounding list, unchanged).
  // Unchecking removes it from that slot only — it stays in `selected` if
  // another slot (or "Other documents") still claims it, and only leaves
  // `selected` once nothing does. A doc can be checked under more than one
  // slot at once (see groupBySlot's doc comment) — allowed, not prevented.
  const toggleSlotDoc = (slotKey: string, docId: string) => {
    setSlotDocIds((prev) => {
      const current = prev[slotKey] ?? [];
      const checked = current.includes(docId);
      const next = {
        ...prev,
        [slotKey]: checked ? current.filter((id) => id !== docId) : [...current, docId],
      };
      if (checked) {
        const stillClaimed = Object.values(next).some((ids) => ids.includes(docId));
        if (!stillClaimed) setSelected((s) => s.filter((id) => id !== docId));
      } else {
        setSelected((s) => (s.includes(docId) ? s : [...s, docId]));
      }
      return next;
    });
  };
```

  Replace the `const { attachable, generated } = splitDocuments(docs, initial?.id);` line (around line 169) with:

```tsx
  const { attachable, generated } = splitDocuments(docs, initial?.id);
  const { slots: slotGroups, other: otherDocs } = groupBySlot(
    attachable,
    categoryTemplate(category).fileSlots,
    slotDocIds,
  );
```

  In `buildSavePayload()` (around line 230–260), add `slot_doc_ids: slotDocIds,` right after `source_doc_ids: selected,`:

```tsx
    source_doc_ids: selected,
    slot_doc_ids: slotDocIds,
    auto_generate_context: research,
```

  In Step 1's JSX (around line 307–336), insert the digest-preview line right after the Type field's closing `</div>`, before the interview-only job-description block:

```tsx
            <div className="field">
              Type
              <div className="flex flex-wrap gap-2">
                {CATEGORIES.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    title={c.hint}
                    onClick={() => pickCategory(c.value)}
                    className={`btn ${category === c.value ? "btn-primary" : ""}`}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            </div>
            <p className="text-[11px] text-fg-faint">
              Ally will generate: {categoryTemplate(category).digestSections.join(", ")}
            </p>
            {category === "interview" && (
```

  Replace the single "Attached documents" `Section` in Step 2 (the block starting `<Section title="Attached documents" ...>` around line 341 and ending at its closing `</Section>` around line 379) with per-slot sections plus an "Other documents" section:

```tsx
          {slotGroups.map(({ slot }) => (
            <Section
              key={slot.key}
              title={slot.label + (slot.multiple ? " (multiple)" : "")}
              description="conva grounds the counterparty and its questions in these. Add files directly (they're kept in a folder named after this Context) or pick from your library."
            >
              {isDesktop && (
                <div className="mb-3">
                  <button
                    type="button"
                    className="btn"
                    disabled={adding}
                    onClick={() => void addDocuments(slot.key)}
                  >
                    {adding ? "Adding…" : "Add documents…"}
                  </button>
                </div>
              )}
              {attachable.length === 0 ? (
                <p className="text-sm text-fg-muted">
                  No documents yet — add some above, or let Ally research context
                  below.
                </p>
              ) : (
                <ul className="flex flex-col divide-y divide-border">
                  {attachable.map((d) => (
                    <li key={d.id} className="flex items-center gap-3 py-2">
                      <input
                        type="checkbox"
                        checked={(slotDocIds[slot.key] ?? []).includes(d.id)}
                        onChange={() => toggleSlotDoc(slot.key, d.id)}
                        aria-label={`Attach ${d.file_name} to ${slot.label}`}
                      />
                      <span className="min-w-0 flex-1 truncate text-sm text-fg">
                        {d.file_name}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          ))}
          <Section
            title="Other documents"
            description="Anything that doesn't fit a slot above — still grounds the counterparty and its questions."
          >
            {isDesktop && (
              <div className="mb-3">
                <button
                  type="button"
                  className="btn"
                  disabled={adding}
                  onClick={() => void addDocuments()}
                >
                  {adding ? "Adding…" : "Add documents…"}
                </button>
              </div>
            )}
            {otherDocs.length === 0 ? (
              <p className="text-sm text-fg-muted">
                No other documents — everything attached is filed under a slot
                above.
              </p>
            ) : (
              <ul className="flex flex-col divide-y divide-border">
                {otherDocs.map((d) => (
                  <li key={d.id} className="flex items-center gap-3 py-2">
                    <input
                      type="checkbox"
                      checked={selected.includes(d.id)}
                      onChange={() => toggleDoc(d.id)}
                      aria-label={`Attach ${d.file_name}`}
                    />
                    <span className="min-w-0 flex-1 truncate text-sm text-fg">
                      {d.file_name}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
```

  Everything else in Step 2 (`Generated by Ally`, `Key terms`, `Import Q&A`, `Let Ally research`, `Deep interview Q&A research`) is unchanged — it now simply renders after the slot + Other-documents sections instead of after the old single flat section.

  `pickCategory` needs no change — a doc slotted under a category's slot key that no longer exists after switching category simply stops rendering under any slot (its id stays in `selected`/`source_doc_ids` for grounding; it falls into "Other documents" until re-filed).

- [ ] **Step 4: Run to verify pass.** Run: `npx vitest run src/components/context/ContextSetup.test.tsx` — ALL tests PASS (4 new + all pre-existing, including `preserves generated-document ids...` and `saves pending edits...` which touch step 2 but not slot sections, and `shows a context's own generated document...` which asserts the "Generated by Ally" section still renders after the slot restructure). Also run `npx tsc -b` — clean.

- [ ] **Step 5: Commit.**

```bash
git add src/components/context/ContextSetup.tsx src/components/context/ContextSetup.test.tsx
git commit -m "feat(context): per-category document slots in the Setup wizard"
```

(standard trailer.)

---

### Task 6 (Phase 6): `ContextDetail.tsx` — slot-grouped document list

**Files:**
- Modify: `src/components/context/ContextDetail.tsx`
- Modify: `src/components/context/ContextDetail.test.tsx`

- [ ] **Step 1: Write the failing tests.** Append to `src/components/context/ContextDetail.test.tsx` inside `describe("ContextDetail", ...)`:

```tsx
  it("groups the Documents list by category slot when slot_doc_ids is populated", async () => {
    const resumeDoc = {
      id: "d1",
      file_name: "resume.pdf",
      enabled: true,
      chunk_count: 2,
      ingested_at_unix_ms: 0,
      source: "file" as const,
      context_ids: ["s1"],
      size_bytes: 1024,
    };
    const otherDoc = {
      id: "d2",
      file_name: "notes.txt",
      enabled: true,
      chunk_count: 1,
      ingested_at_unix_ms: 0,
      source: "file" as const,
      context_ids: ["s1"],
      size_bytes: 512,
    };
    renderDetail({
      context: {
        load: vi.fn().mockResolvedValue(session({ slot_doc_ids: { resume: ["d1"] } })),
        loadProfile: vi.fn().mockResolvedValue(profile({ doc_ids: ["d1", "d2"] })),
      },
      rag: { list: vi.fn().mockResolvedValue([resumeDoc, otherDoc]) },
      capabilities: vi.fn().mockResolvedValue(null),
    });
    await screen.findByText("Counterparty");
    fireEvent.click(screen.getByRole("button", { name: /knowledge base/i }));

    expect(await screen.findByText("Résumé / CV (1)")).toBeInTheDocument();
    expect(screen.getByText("resume.pdf")).toBeInTheDocument();
    expect(screen.getByText("Other documents (1)")).toBeInTheDocument();
    expect(screen.getByText("notes.txt")).toBeInTheDocument();
    // Every slot renders even with zero docs — the "what's still missing"
    // signal the spec is for.
    expect(screen.getByText("Job description (0)")).toBeInTheDocument();
    expect(screen.getByText("Take-home / test (0)")).toBeInTheDocument();
  });

  it("falls back to Other documents for every attached doc when slot_doc_ids is empty (pre-migration contexts)", async () => {
    const resumeDoc = {
      id: "d1",
      file_name: "resume.pdf",
      enabled: true,
      chunk_count: 2,
      ingested_at_unix_ms: 0,
      source: "file" as const,
      context_ids: ["s1"],
      size_bytes: 1024,
    };
    renderDetail({
      context: {
        load: vi.fn().mockResolvedValue(session()), // slot_doc_ids omitted entirely
        loadProfile: vi.fn().mockResolvedValue(profile({ doc_ids: ["d1"] })),
      },
      rag: { list: vi.fn().mockResolvedValue([resumeDoc]) },
      capabilities: vi.fn().mockResolvedValue(null),
    });
    await screen.findByText("Counterparty");
    fireEvent.click(screen.getByRole("button", { name: /knowledge base/i }));

    expect(await screen.findByText("Other documents (1)")).toBeInTheDocument();
    expect(screen.getByText("resume.pdf")).toBeInTheDocument();
    expect(screen.getByText("Résumé / CV (0)")).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run to verify failure.** Run: `npx vitest run src/components/context/ContextDetail.test.tsx` — the 2 new tests FAIL (the current "Documents (N)" heading and flat list don't match the per-slot headings the tests look for).

- [ ] **Step 3: Implement.** In `src/components/context/ContextDetail.tsx`:

  Add imports: `import { groupBySlot } from "@/components/context/documentSplit";` and `import { categoryTemplate } from "@/components/context/categoryTemplates";` to the top import block.

  Replace the "Attached documents" IIFE block (the `{(() => { const attached = ... })()}` block, currently lines 590–666) with:

```tsx
            {(() => {
              const attached = profile.doc_ids.filter(
                (d) => d !== dossierId && d !== researchDocId && d !== qaDocId,
              );
              const attachedDocs = attached
                .map((docId) => docs.find((d) => d.id === docId))
                .filter((d): d is RagDocument => !!d);
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
              const renderDocRow = (d: RagDocument) =>
                caps?.system.partnerWindow ? (
                  <li key={d.id}>
                    <button
                      type="button"
                      onClick={() =>
                        void backend.partner.open(d.file_name, null, null, null, [], d.id)
                      }
                      title={docMeta(d.id)}
                      aria-label={`View "${d.file_name}"`}
                      className="flex w-full items-center gap-1.5 rounded-sm text-left text-[12px] text-fg-muted transition hover:text-ai"
                    >
                      <Icon name="book" size={13} className="shrink-0 text-fg-faint" />
                      <span className="truncate">{d.file_name}</span>
                    </button>
                  </li>
                ) : (
                  <li
                    key={d.id}
                    title={docMeta(d.id)}
                    className="flex items-center gap-1.5 text-[12px] text-fg-muted"
                  >
                    <Icon name="book" size={13} className="shrink-0 text-fg-faint" />
                    <span className="truncate">{d.file_name}</span>
                  </li>
                );
              const { slots, other } = groupBySlot(
                attachedDocs,
                session ? categoryTemplate(session.category).fileSlots : [],
                session?.slot_doc_ids ?? {},
              );
              return (
                <div className="flex flex-col gap-3">
                  {slots.map(({ slot, docs: slotDocs }) => (
                    <div key={slot.key}>
                      <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-fg-faint">
                        {slot.label} ({slotDocs.length})
                      </h3>
                      {slotDocs.length === 0 ? (
                        <p className="text-[12px] text-fg-faint">—</p>
                      ) : (
                        <ul className="flex flex-col gap-0.5">
                          {slotDocs.map((d) => renderDocRow(d))}
                        </ul>
                      )}
                    </div>
                  ))}
                  <div>
                    <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-fg-faint">
                      Other documents ({other.length})
                    </h3>
                    {other.length === 0 ? (
                      <p className="text-[12px] text-fg-faint">No documents attached.</p>
                    ) : (
                      <ul className="flex flex-col gap-0.5">{other.map((d) => renderDocRow(d))}</ul>
                    )}
                  </div>
                </div>
              );
            })()}
```

- [ ] **Step 4: Run to verify pass.** Run: `npx vitest run src/components/context/ContextDetail.test.tsx` — ALL tests PASS (2 new + all 5 pre-existing, including the "Ally research renders one line per source..." test which exercises the same Knowledge base section but not this document list). Also run `npx tsc -b` — clean.

- [ ] **Step 5: Commit.**

```bash
git add src/components/context/ContextDetail.tsx src/components/context/ContextDetail.test.tsx
git commit -m "feat(context): slot-grouped document list in ContextDetail"
```

(standard trailer.)

---

### Task 7 (Phase 7): Full verification + push + PR

**Files:** none (verification + git operations only)

- [ ] **Step 1: Full gate.** Run, in order, and confirm each is clean:

```bash
npx tsc -b
npx vitest run
npm run build
cargo fmt --check
cargo clippy -p conva-core --all-targets -- -D warnings
cargo test -p conva-core
```

  Expected: `npx vitest run` shows every test file passing (the 6 files touched by this plan plus the full existing suite — no regressions); `npm run build` completes with no errors; the three `cargo` commands are clean (shell-side `src-tauri` changes from Task 1 aren't locally compilable in this sandbox — CI's Windows job is the real gate for those, per Task 1 Step 5's note).

- [ ] **Step 2: Decide the PR target — ask the owner first.** The spec's own header flags this as unresolved: *"Shipping on `claude/conva-app-home-density-icons` (current branch — confirm with the owner before implementation whether this rides the same branch/PR or splits to its own; unrelated to that branch's original density/icon scope)."* That branch currently carries an **open draft PR (#188)**, scoped to Home density + icon work — unrelated to this feature. Before pushing, ask the owner:

  **Recommended: open a separate branch/PR for this feature** (e.g. `claude/conva-app-context-templates`, branched from `main` at the same point, cherry-picking this plan's commits) rather than adding unrelated scope to #188 — keeps each PR's diff reviewable against its own description, and #188 can merge independently without waiting on this larger feature. The cost is one extra branch-management step; the benefit is a clean, single-purpose PR history.

  If the owner instead says to ride #188, skip the branch-split step and push straight to `claude/conva-app-home-density-icons`, then update PR #188's body with a "Follow-up commits" section (same pattern already used in that PR's history) describing this feature.

- [ ] **Step 3: Push.** Once the target is confirmed (either the current branch or a new one created from `main`):

```bash
git push -u origin <confirmed-branch-name>
```

  Retry up to 4 times with exponential backoff (2s/4s/8s/16s) only on a network failure, per this session's standing git-push convention.

- [ ] **Step 4: Open or update the PR.** If a new branch was created: open a **draft** PR against `main`, following any PR template the repo defines (`.github/pull_request_template.md` etc.), body describing the feature (per-category document slots surfaced in Setup + ContextDetail, no new bespoke fields, slots stay advisory) and linking the spec (`docs/superpowers/specs/2026-09-03-context-category-templates-design.md`) and this plan. If riding #188: update its body with a "Follow-up commits" section, same pattern as this session's prior PR updates.

- [ ] **Step 5: Watch CI.** Call `subscribe_pr_activity` for whichever PR carries this work, then let CI run — react to any red check per this session's standing drive-to-green posture (root-cause, fix, re-push; never skip/disable a test to get green).

---

## Self-review notes (spec coverage check)

- **Data model** (spec §1): Task 1 (Rust field + back-compat test + `sample_context()`/shell fixture) + Task 2 (TS mirror, deliberately optional — see header deviation note). ✅
- **TypeScript template mirror** (spec §2): Task 3 (`categoryTemplates.ts`, `ContextSetup.tsx` moved onto it). ✅
- **Slot grouping helper** (spec §3): Task 4 (`groupBySlot` + tests). ✅
- **Setup wizard Step 2** (spec §4): Task 5 (per-slot sections, checkbox wiring, `slotDocIds` state, "Other documents" catch-all, `buildSavePayload` change, Step 1 digest-preview line). ✅
- **`ContextDetail.tsx`** (spec §5): Task 6 (slot-grouped rendering via `groupBySlot`, empty slots still render). ✅
- **Testing section** (spec, full list): every enumerated test — the Rust back-compat test, `categoryTemplates.test.ts`'s three tests, `documentSplit.test.ts`'s `groupBySlot` tests, `ContextSetup.test.tsx`'s four extensions, `ContextDetail.test.tsx`'s two extensions, plus `npx tsc -b`/`npx vitest run`/`npm run build`/`cargo test -p conva-core` — all present across Tasks 1–7. ✅
- **Out of scope** (spec): no bespoke per-category fields, no required/blocking slots, no reassignment UI, no import/export, no `ConversationTemplate`/`FileSlot` Rust changes, no Step 3 slot breakdown — none of Tasks 1–7 touch any of these. ✅
- **Placeholder scan:** no "TBD"/"handle edge cases"/"similar to Task N" — every step shows exact code, exact file paths, exact commands. ✅
- **Type consistency:** `slotDocIds`/`slot_doc_ids` naming is consistent throughout (camelCase in TS local state and the `ContextFileSlot`/`SlotGroup`/`groupBySlot` API, snake_case only at the IPC boundary — `ConversationContext.slot_doc_ids` and the save payload's `slot_doc_ids: slotDocIds`); `categoryTemplate`/`researchDefault`/`CATEGORIES` signatures match between Task 3's definition and every later task's usage. ✅

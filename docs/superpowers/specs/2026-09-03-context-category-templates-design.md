# Per-category Context templates — surface the setup template in the UI

> Brainstorming-skill design doc. Status: **approved** (owner, 2026-09-03).
> Shipping on `claude/conva-app-home-density-icons` (current branch — confirm
> with the owner before implementation whether this rides the same branch/PR
> or splits to its own; unrelated to that branch's original density/icon
> scope). First of two specs — a second, short spec for context
> import/export follows once this one ships (export naturally serializes the
> shape this spec finalizes).

## Problem

Owner (2026-09-03, same message that flagged the edit-page header-icon bug):
*"The context type should be updated... We need to define for each context
type, what the UI experience should be like. What should be included,
whats necessary and what isn't. Then we need a template for each type."*

A per-category template already exists — `ConversationTemplate` in
`crates/conva-core/src/context.rs` (`ContextCategory::template()`) — and
already drives real behavior: `knowledge_prompt`'s digest sections, the
web-research default, the label used across every LLM prompt. What it does
**not** drive is anything the user actually sees. `ContextSetup.tsx` Step 2
("Attached documents") is one identical flat upload list for every
category — Interview's `file_slots` (Résumé/CV, Job description, Take-home
test) exist only in Rust, invisible in the wizard. Only Interview gets any
bespoke setup UI at all (the Job description field, Deep Q&A toggle);
Company meeting, Sales call, Live Stream, and Other are visually identical
despite having different templates underneath. `ContextDetail.tsx`'s
document list has the same problem post-save: one flat "Documents (N)"
list, no sense of what's filled vs. still missing for the category.

So "what should be included per type" already has a backend answer — the
gap is entirely that the UI never asks the question.

## Design

Surface the existing template, don't invent a new one. Three decisions
made with the owner up front, carried through the whole design:

1. **Slots stay advisory, never required.** A Context works today with zero
   attached documents (Ally researches/writes from general knowledge) —
   that's a real product property, not an oversight. Nothing here blocks
   Finish; slots communicate what's typical for the category, they don't
   gate it.
2. **Scoped to what `ConversationTemplate` already models** — `file_slots`
   and `digest_sections`. No new bespoke per-category text fields (e.g. a
   sales prospect-name field, a livestream episode-topic field) — that's
   real design work of its own kind, left for a later pass once real usage
   shows what's actually missing.
3. **Slot data lives on `ConversationContext`, not on the document.**
   `RagDocument` (in `crates/conva-core/src/rag.rs`) is shared by the
   Library page and every RAG consumer in the app; a fact that's really
   about *this context's* relationship to a doc doesn't belong bolted onto
   that already-heavily-used struct. It's a small, contained addition to the
   context record that already owns `source_doc_ids`.

### 1. Data model

**`crates/conva-core/src/context.rs`** — `ConversationContext` gains one
field, inserted after `source_doc_ids`:

```rust
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
```

Add the same field (with the same default-empty-map value) to
`sample_context()` in `context.rs`'s test module so the existing tests
keep compiling.

No changes to `FileSlot`, `ConversationTemplate`, or `ContextCategory::template()`
— those are already exactly what this spec needs.

**`src/lib/ipc.ts`** — `ConversationContext` gains:

```ts
slot_doc_ids: Record<string, string[]>;
```

New type, mirroring `FileSlot`:

```ts
export interface ContextFileSlot {
  key: string;
  label: string;
  multiple: boolean;
}
```

### 2. TypeScript template mirror

`ContextSetup.tsx` already hand-mirrors part of `ConversationTemplate`
(`label` → `CATEGORIES[].label`, `default_research_enabled` →
`CATEGORIES[].research`) in its `CATEGORIES` array — this spec completes
that mirror rather than inventing a second mechanism. No new Tauri command:
this is static data with one source of truth in Rust and one hand-kept
mirror in TS, same pattern as `CATEGORY_ICON`/`CATEGORY_LABEL` in
`ContextsPane.tsx` already use.

Move `CATEGORIES` out of `ContextSetup.tsx` into a new shared file,
**`src/components/context/categoryTemplates.ts`**, since Step 2's
slot-rendering (below) and `ContextDetail.tsx`'s slot grouping both need
it and neither should import from the other's page component:

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
  CATEGORIES.find((x) => x.value === c) ?? CATEGORIES[0];

export const researchDefault = (c: ContextCategory): boolean => categoryTemplate(c).research;
```

`ContextSetup.tsx` deletes its local `CATEGORIES` array and
`researchDefault` function, importing both from the new file instead — a
pure move, every existing call site (`CATEGORIES.map(...)`,
`CATEGORIES.find(...)`, `researchDefault(...)`) keeps working unchanged
since the exported shapes are the same plus the two new fields.

### 3. Slot grouping helper

**`src/components/context/documentSplit.ts`** gains a second export
alongside the existing `splitDocuments`:

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

### 4. Setup wizard (`ContextSetup.tsx`) — Step 2

Replace the single "Attached documents" `Section` with:

- One `Section` per `categoryTemplate(category).fileSlots` entry, title =
  slot label (+ " (multiple)" suffix in the description when
  `slot.multiple`), each containing:
  - The existing "Add documents…" button (desktop-only, `isDesktop`
    gated, unchanged), except `addDocuments()` takes the slot key and,
    after storing/ingesting, adds the new doc ids to
    `slotDocIds[slot.key]` (new local state mirroring `generatedFields`'
    pattern: `const [slotDocIds, setSlotDocIds] = useState<Record<string, string[]>>(initial?.slot_doc_ids ?? {})`)
    as well as to `selected` (unchanged — `selected` stays the flat
    `source_doc_ids` list the save payload already sends).
  - A checkbox list of **every** doc in `attachable` (the whole library's
    attachable set — same list Step 2 shows today, not pre-filtered to
    "unclaimed" docs) using the current per-doc checkbox row. Checking a
    box both adds the id to `selected` (existing behavior, unchanged —
    still drives `source_doc_ids`/grounding) and to `slotDocIds[slot.key]`
    (new). Unchecking under this slot removes the id from
    `slotDocIds[slot.key]` only — it stays in `selected` if it's also
    checked under another slot, and only leaves `selected` when no slot
    (and the "Other documents" section, below) has it checked anymore. A
    doc can be checked under more than one slot at once (see
    `groupBySlot`'s doc comment) — deliberately allowed, not prevented;
    the common case is one doc per slot, but nothing enforces it.
- One final "Other documents" `Section`, identical to today's flat
  "Attached documents" section (all of `attachable` minus whatever's now
  claimed by a slot per `groupBySlot`), for anything that doesn't fit a
  defined slot.

`buildSavePayload()` gains `slot_doc_ids: slotDocIds`.

Step 1 gains one line under the Type picker, using
`categoryTemplate(category).digestSections`:

```tsx
<p className="text-[11px] text-fg-faint">
  Ally will generate: {categoryTemplate(category).digestSections.join(", ")}
</p>
```

`pickCategory` (which already resets `research`/`deepQa` on category
change) does **not** need to reset `slotDocIds` — a doc slotted under one
category's slot key that no longer exists after switching category simply
stops rendering under any slot (its id stays in `selected`/`source_doc_ids`
for grounding, it just falls into "Other documents" until re-filed, same
as any other unslotted doc). No data loss, no special-case reset logic.

Step 3 (Review) is unchanged — "N attached" stays a single count; a
slot-by-slot breakdown there would duplicate Step 2 for no benefit at the
point the user is about to save.

### 5. `ContextDetail.tsx`

The existing "Documents (N)" block (built from `profile.doc_ids`, filtered
to exclude the three generated docs — `dossierId`/`researchDocId`/`qaDocId`)
becomes: call `groupBySlot(attached, categoryTemplate(session.category).fileSlots, session.slot_doc_ids)`,
then render one heading per slot (`"{slot.label} ({docs.length})"`) with
its docs listed exactly as today's rows (same view/open/remove
affordances), followed by an "Other documents ({other.length})" heading
for the rest. An empty slot still renders — `"Job description (0)"` with a
muted "—" row — rather than being hidden, since a category's unfilled slot
is exactly the "what's still missing" signal this spec is for.

### Out of scope

- Any new bespoke per-category fields beyond `file_slots`/`digest_sections`
  (sales prospect/account name, livestream episode topic, meeting
  attendees, etc.) — flagged in the Problem section as real future work,
  deliberately not this spec.
- Required/blocking slots — every slot stays advisory; Finish is never
  gated on slot contents.
- Any reassignment UI for moving a doc from "Other documents" into a
  specific slot after the fact, or from one slot to another — v1 only
  writes `slotDocIds` at the point of attaching via a slot's own
  controls; a doc that arrives unslotted (e.g. dragged onto a Contexts row
  from the Library pane, per CLAUDE.md rule 8) stays in "Other documents"
  until removed and re-attached through a slot.
- Context import/export — second, separate spec, follows this one.
- Any change to `ConversationTemplate`, `FileSlot`, or
  `ContextCategory::template()` in Rust — the template itself is correct
  and complete; only its visibility changes.
- Step 3 (Review) slot breakdown — stays a single count.
- Web-platform differences beyond what already exists (`isDesktop` gating
  on "Add documents…" is unchanged; the library-doc checkbox picker
  already works on both).

## Testing

- **`crates/conva-core`**: extend `sample_context()` in `context.rs`'s
  test module with `slot_doc_ids: std::collections::BTreeMap::new()` (compile
  fix for the new required field). New test asserting a `ConversationContext`
  JSON literal missing `slot_doc_ids` entirely still deserializes (via
  `serde_json::from_str`) with an empty map — the back-compat guarantee for
  contexts saved before this field existed. No other core logic changes,
  so no new pure-function tests beyond that.
- **`src/components/context/categoryTemplates.test.ts`** (new): every
  category's `fileSlots` and `digestSections` are non-empty (mirrors the
  existing Rust `every_type_has_a_nonempty_template` test, TS side);
  `categoryTemplate` falls back to the first entry for an unrecognized
  value (defensive, matches existing `CATEGORIES.find(...) ?? ...`
  patterns elsewhere in the codebase); `researchDefault` matches the five
  known values from the Rust `research_defaults_match_decision_two` test
  (interview/sales/live_stream → true, company_meeting/other → false).
- **`src/components/context/documentSplit.test.ts`**: new tests for
  `groupBySlot` — docs distribute to the right slot by id membership in
  `slotDocIds`; a doc in `attachable` but absent from every slot's list
  lands in `other`; an empty `slotDocIds` (the back-compat case) puts
  every doc in `other`; a slot with no matching docs still appears in the
  result with an empty `docs` array (not dropped).
- **`ContextSetup.test.tsx`**: extend for per-slot rendering — switching
  category shows that category's slot labels; attaching a doc via a
  slot's own picker checkbox both adds it to `selected` and to
  `slotDocIds[key]` in the save payload; the digest-preview line under
  Step 1's Type picker shows the right section list per category;
  "Other documents" still renders the flat list for docs outside every
  slot.
- **`ContextDetail.test.tsx`**: extend for slot-grouped rendering — a
  context with `slot_doc_ids` populated shows per-slot headings with the
  right doc counts; a context with an empty `slot_doc_ids` (the
  pre-migration case) shows everything under "Other documents", not
  broken or missing.
- `npx tsc -b`, `npx vitest run`, `npm run build` — the three gates this
  session already runs before every push; `cargo test -p conva-core` for
  the Rust side (sandbox-compilable, no shell touched).

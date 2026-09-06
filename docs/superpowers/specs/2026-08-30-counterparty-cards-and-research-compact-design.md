# Counterparty avatar cards + compact Ally research (v1)

> Brainstorming-skill design doc. Status: **approved** (owner, 2026-08-30 —
> requirements below, plus one clarifying answer: generic SVG silhouette
> avatars over an initials/color scheme). Ships as its own PR off `main`.

## Requirements (owner, 2026-08-30)

Two related-but-distinct asks on the Context Detail screen
(`ContextDetail.tsx`):

1. **Counterparty personas** — currently a plain vertical list (title,
   paragraph summary, style tags, a "Choose"/"Chosen ✓" button, all always
   visible per card):
   - Avatars, male or female, with basic info below.
   - Cards scroll left-to-right (horizontal, not vertical).
   - Selecting a card puts its bio and details in a panel below the row.
   - A **star** click is the "choose this persona for rehearsal" control.
2. **Ally research** (the web-research-sources list in the Knowledge base
   section) — currently a title + a 2-line clamped snippet per source:
   - Compact to **one line per document**.
   - Add an icon to load that source into the viewer, when available.

## Design

### 1. Persona gender (core — this is what makes "male or female
   avatars" real, not arbitrary)

The generated personas (`ContextPersona`) had no gender field — just
`title`/`summary`/`style_tags`/`recommended`. Rather than have the UI
coin-flip an avatar per card (arbitrary, and could contradict how Ally
actually wrote the persona), `persona_prompt`'s LLM instructions now also
ask for a `"gender"` key (`"male"` or `"female"` — Ally's own call on how
it envisioned the counterparty), and `ContextPersona` gains:

```rust
pub enum PersonaGender { Male, Female }
// ...
pub gender: Option<PersonaGender>,
```

`parse_personas` maps the model's free-text answer tolerantly — case-
insensitive exact match on "male"/"female"; anything else (missing, a
third option, stray words) is `None`, **not a parse failure**. This
matters: `gender` is cosmetic (avatar choice only), so one stray value
must never wipe out all 3 personas the way a hard enum-deserialize
failure would (`serde_json::from_str` on the whole array fails the whole
batch on one bad field). `None` renders a neutral fallback avatar in the
UI. `#[serde(default)]` makes this backward-compatible with personas
saved before the field existed.

TS mirror: `src/lib/ipc.ts`'s `ContextPersona` gains `gender?: "male" |
"female" | null`.

### 2. Avatars: generic SVG silhouettes, not photos or generated images

Two new glyphs in `Icon.tsx` (`personaMale`, `personaFemale`) — same
dependency-free inline-SVG line-icon style as every other icon in this
set (`Icon.tsx`'s own doc comment: "no icon package... nothing has to
reach the network"). `personaMale` reuses the existing generic `account`
shape (circle head + rounded shoulders); `personaFemale` gets a distinct
flared "dress" silhouette — the same simple pictogram duo public
signage uses, chosen for instant recognizability at the ~30px card size.
A persona with `gender: null` (legacy, or the rare unparsed answer) falls
back to the existing neutral `account` icon.

### 3. Card row + bio panel (`ContextDetail.tsx`)

- The vertical `<ul>` becomes a horizontally-scrolling row
  (`overflow-x-auto`) of fixed-width (`w-28`) cards: avatar icon, title
  (2-line clamp), a small "Recommended" label when Ally flagged it.
- **Two independent states**, not one:
  - `chosen` (existing — `session.chosen_persona_id`, mutated via
    `backend.context.choosePersona`) — which persona rehearsal actually
    runs against.
  - `viewedPersonaId` (new, local) — which card's bio/details show in the
    panel below the row. Defaults to `chosen ?? personas[0].id` once
    personas load, so the panel isn't empty on first open; browsing other
    cards to read their bio never touches `chosen`.
- Each card is a `role="button"` div (not a real `<button>` — it contains
  a real nested `<button>` for the star, and two real `<button>`s can't
  nest in valid HTML) that sets `viewedPersonaId` on click. The star is a
  separate absolutely-positioned `<button>` in the card's corner,
  `stopPropagation`-ed so clicking it doesn't also change the viewed
  card — outline (`star`) vs filled (`starFilled`) mirrors the existing
  two-glyph-per-state idiom this icon set already uses for
  lock/unlock and eye/eyeOff.
- The bio panel (title, "Chosen ✓" pill when applicable, summary, style
  tags) is exactly the per-card content the old design always rendered
  inline — now shown once, for whichever card is selected, instead of
  three times at once. Nothing is lost, just consolidated.

### 4. Ally research: one line + a viewer-load icon

Each source row drops the 2-line snippet (`line-clamp-2`) that used to
render under every title — that's the actual height cost the owner
flagged. The title (clickable, opens the source URL — unchanged) is now
the row's only text, `truncate`d to one line, in the exact row idiom this
app already uses everywhere else for a document list (`border-b
border-border py-1`, same as `LibraryPane.tsx`'s rows).

The snippet isn't discarded — it moves into the **viewer**: a new "Load
into the viewer" icon button (gated on `caps?.system.partnerWindow ===
true`, same `canView` pattern `LibraryPane.tsx` already uses — "if ready"
means the partner-window capability is available on this platform) calls
`backend.partner.open(title, "research", snippet, snippet, [url], null)`,
opening the source in the same partner-window viewer every other "open in
viewer" affordance in this app already routes to (CLAUDE.md rule 10 — "it
IS the viewer").

## Out of scope (v1)

- Editing a persona's gender/avatar by hand — it's Ally's call, matching
  every other generated-content field on a persona.
- A third avatar option for personas the model doesn't gender at all
  (`None` just falls back to the existing neutral icon — no explicit
  "neutral" glyph needed).
- Touching `persona_live_prompt` (the roleplay system prompt) — gender is
  cosmetic (avatar only); it doesn't change how the persona speaks.

## Testing

- Core: `parse_maps_gender_case_insensitively_and_defaults_missing_to_none`
  and `parse_treats_an_unrecognized_gender_value_as_none_not_a_parse_failure`
  — proves the tolerant mapping, and specifically that one bad `gender`
  value doesn't zero out all 3 personas.
- UI: `ContextDetail.test.tsx` — viewing a second card's bio leaves
  `chosen` untouched and never calls `choosePersona`; clicking a card's
  star does call it, with the right ids. Research: a source renders on
  one line (its snippet text is asserted absent from the DOM), and the
  viewer-load icon calls `backend.partner.open` with the expected
  payload.
- `npm run build` — clean (confirms the new `role="button"` card + nested
  real `<button>` star doesn't produce invalid/duplicate interactive
  nesting the way two real `<button>`s would have).

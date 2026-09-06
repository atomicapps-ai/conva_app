# conva AppUI — spec delta since AppUI_V5.0 (2026-09-02)

> **Purpose:** hand-off summary for updating `conva_core/brand/UI/AppUI_V5.0/`
> (the `.dc.html` canvases, `HANDOFF.md`, `MANIFEST.md`) and
> `conva_core/docs/technical/home-contexts-workspace-redesign.md`'s §10–11
> FIXED/OPT tables — those still show the *original* V5.0 numbers. Everything
> below is **shipped and live** in `conva_app`, across two rounds of owner
> feedback: a smaller-screens-first dimension retune ([PR #185](https://github.com/atomicapps-ai/conva_app/pull/185), merged)
> and a Home-density + colorized-icon pass ([PR #188](https://github.com/atomicapps-ai/conva_app/pull/188), open).
>
> Every value here is a real, committed, tested number/hex/path — not a
> proposal. Where the original V5.0 spec had a FIXED value that changed,
> it's called out explicitly so the design system doesn't silently drift
> from what's in the app.

---

## 1. Window & shell

| Spec | V5.0 original (now stale) | **Current** |
|---|---:|---:|
| Default window | 1280 × 800 | **960 × 640** |
| Minimum window | 700 × 600 | **560 × 440** |
| Compact-mode strip (always-on-top narrow window) | 380px wide | **340px wide** |

## 2. Responsive tiers (nav rail + Contexts panes)

The original 4-tier system (Wide/Standard/Compact/Very-compact at
1380/1040/700) is now **3 tiers**, collapsed to match the smaller default
window:

| Tier | Width | Rail | Contexts panes |
|---|---:|---|---|
| **Wide** | ≥ 1024px | expanded (text + icon) | list + workspace + Library dock, all visible |
| **Compact** | 560–1023px | icon-only | master/detail (one pane at a time) |
| **Very compact** | < 560px | ☰ hamburger menu | master/detail |

Note the **default 960×640 window lands in the Compact tier**, not Wide —
deliberate: a fresh install starts on the icon-only rail, and the fuller
expanded/docked experience is something a wider window earns, not the
starting state.

## 3. Navigation rail

| Spec | V5.0 original | **Current** |
|---|---:|---:|
| Expanded rail width | 240px | **184px** |
| Icon-only rail width | ~64px | **52px** |
| Nav row text size | — | **13px** |
| Nav row vertical padding | — | **8px** |
| Core-orbit artwork | edge-to-edge, **uncropped** height (~161px rendered) | **height-capped at 64px**, `object-fit: cover`, **centered** crop (not top-anchored — the mark sits centered in the source art with rings both above and below it) |
| Gap above the orbit artwork | 12px margin both sides | **0px above** (flush under the last nav button), 8px below |
| Account block top padding | 14px | **10px** |

## 4. Page chrome (every rail destination — shared component)

| Spec | V5.0 original | **Current** |
|---|---:|---:|
| Page title | 24–28px/700 | **22px/700** |
| Home greeting | 32–36px/700 | **28px/700** |
| Body text | 14px | **13px** |
| Page horizontal padding | 24–32px | **20px** |
| Header vertical padding | pt-28/pb-20px | **pt-16/pb-12px** |
| Section gaps | 20–24px | **16px** |

## 5. Buttons

**Start Listening** (locked action component) — ~30% shorter:

| Spec | Original | **Current** |
|---|---:|---:|
| Horizontal padding | 20px | **14px** |
| Vertical padding | 13px | **7px** |
| Label text | 14px | **13px** |
| Leading icon | 18px | **15px** |
| Compact (icon-only) square | 44×44px | **36×36px** |

## 6. Home dashboard

**Hero ("active context" banner)** — shrunk in two rounds:

| Spec | V5.0 original | **Current** |
|---|---:|---:|
| Minimum height | — | **150px** |
| Panel padding | 28px | **20px** |
| Content gap | 28px | **20px** |
| Mark icon size | 104px | **80px**, now inside a **bordered badge**: `rounded-full`, `1.5px` border in `--color-primary` at 60% opacity, `radial-gradient(120% 120% at 50% 25%, #1a2742, #0c1424)` fill, `box-shadow: 0 0 28px rgba(79,184,255,.35)` glow — the mark previously had no visible border/glow at all, just a very faint 14px shadow |
| Hero artwork (intelligence-field wave) | ≤ 597×245 | **≤ 359×147** (scaled proportionally) |
| Artwork hides below window width | ~1180px | **~940px** |
| Stat rows ("N source files", "N prepared Q&A") | plain text | **each gets a leading icon** — file glyph / question-bubble glyph, 14px, muted color |

**Recent-conversations / Contexts mini-lists** — now the *same shared row
component* as the Conversations page (`ListRow`), not a bespoke card:

- One line per row: 18px colored icon chip → title (truncates) → date,
  right-aligned, mono.
- Row height 34px, tighter padding/gap than the old two-line card.
- **"View all" link** moved from below the row list up into the panel
  header, top-right next to the section title (was a full-width
  row-shaped button below the last row).

## 7. Contexts — three-pane workspace

| Spec | V5.0 original (FIXED) | **Current** |
|---|---:|---:|
| Pane A (context list) width | 300px | **220px** |
| Pane A resize range | 260–380px | **190–280px** |
| Pane B (workspace) minimum | 520px | **360px** |
| Pane C (Library dock) width | 360px | **260px** |
| Pane C resize range | 320–440px | **230–320px, and it's now actually resizable** (V5.0 spec said resizable; the shipped build never had a drag handle on it until now — mirrors Pane A's left-edge-drag pattern) |
| Workspace inner padding | 24px | **18px** |

## 8. Colorized per-category icons — new system

Every Context row (Contexts page **and** Home's mini-list) now shows a
type-specific pictogram in a tinted circular badge (18px chip: icon-colored
background at 16% opacity, icon at 11px). **Solid-filled glyphs**, a
deliberate exception to the app's otherwise all-outline icon language,
scoped to these category badges only.

| Category | Icon (concept) | Color |
|---|---|---:|
| Interview | Two overlapping speech bubbles | `#4FB8FF` (existing azure primary, reused) |
| Company meeting | Three-person cluster | `#E0B84C` *(new)* |
| Sales call | Phone handset + sound waves | `#9D7DC4` *(new)* |
| **Live stream** *(new category, see §9)* | Video camera | `#E8608F` *(new)* |
| Other | Three horizontal dots | `#67C6C5` *(new)* |

None of the four new hex values reuse the app's locked/exclusive colors —
not Them/You voice colors (`--color-inbound` `#35E0A6` / `--color-outbound`
`#B79CFF`), not Ally gold (`--color-ai` `#FFC24B`, exclusively
Ally-authored content), not recording-red (`--color-rec` `#FF4D5E`).

## 9. New context category: **Live Stream**

A fifth `ContextCategory` (was: Interview / Company Meeting / Sales Call /
Other), for podcast/streamer/live-commerce hosts prepping a broadcast:

- **Setup document slots:** Show rundown / outline, Guest bio, Talking
  points / script.
- **Generated digest sections:** Episode outline, Core vocabulary, Guest
  background, Likely audience questions.
- **Web research:** on by default (same reasoning as Interview/Sales —
  public topic research helps prep, nothing here is internal/confidential).
- **Performance-analysis framing:** host pacing/energy, outline adherence,
  guest/audience handling — its own tailored prompt, not the generic
  fallback.
- Appears in the setup wizard's category picker, the Contexts-page filter,
  and as a new Coaching-page practice starter ("Livestream / Podcast
  Hosting").

## 10. Reusable component change

`ListRow` (the shared row used by Conversations, and now Home's mini-lists)
gained an **optional icon column** — an 18px tinted badge between the
left accent bar and the checkbox column. Omitted → renders as an empty
spacer (same convention as its existing optional checkbox/trash columns),
so every other consumer of this component is visually unaffected unless it
opts in.

---

### Source of truth

`atomicapps-ai/conva_app`, branch `claude/conva-app-home-density-icons`
(PR #188) on top of `main` (PR #185, merged). Every number above is read
directly from the committed source — `tauri.conf.json`, `lib/responsive.ts`,
`lib/compact.ts`, `state/uiPrefs.ts`, `components/studio/PageView.tsx`,
`components/studio/NavRail.tsx`, `components/dashboard/DashboardView.tsx`,
`components/contexts/ContextsPane.tsx`, `components/ui/ListRow.tsx`,
`components/ui/Icon.tsx`, `crates/conva-core/src/context.rs` — not
eyeballed off a screenshot.

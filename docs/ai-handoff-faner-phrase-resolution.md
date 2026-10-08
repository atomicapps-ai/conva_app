# AI handoff — FANER phrase resolution + debug panel

> Operational handoff only. Canonical design:
> `conva_core/docs/technical/faner-phrase-resolution.md`.

## State

- Issue: <https://github.com/atomicapps-ai/conva_app/issues/360>
- App branch `claude/zen-hypatia-roo97o` (cut from `origin/dev` `971d376`) → PR into `dev`.
- Core docs branch `claude/zen-hypatia-roo97o` (from `origin/main` `6772b90`) → PR into `main`.
- PR URLs: see the PR list on those branches (filled in the final report).

## What landed

- `crates/conva-core/src/phrase.rs` — tokenizer, gap policy, occurrence finder, containment, document-phrase signal, trace types.
- `highlight.rs` — `evaluate_terms` (terms + trace); `relevant_terms*` unchanged API.
- `capture.rs` — prompt TERM SHAPE rule; `resolve_capture_arguments` (mandatory post-processing, live worker + `faner_replay`).
- `phrase_eval.rs` — seeded generator + property checks. `context::active_highlight_terms` — pure live-term builder.
- Shell: `faner_debug.rs` (dev-only commands), `evaluate_live_terms` shared with `analyze_terms`, `active_context_id` + `apply_active_context` (fixes stale terms after saving the active Context). `faner_replay` now returns `ReplayOutcome {raw, resolved, trace}`.
- UI: `src/components/dev/*` (Highlighter / Capture router / Batch), `transcript/highlightSegments.ts` shared with `HighlightedText`.

## Overlap to watch

`claude/archive-dialogs-doc-roles-faner-pos` (no PR at time of work) edits `highlight.rs` (`HighlightContext::pos_tags`, noun-phrase rarity). Merge conflict expected in `HighlightContext` / `relevant_terms_capped`; route its candidates through `add_candidate(.., Source::…)`.

## Verified

`cargo fmt --check`; `cargo clippy -p conva-core -p conva-app --all-targets -- -D warnings`; `cargo test -p conva-core` (307 + 16 + 22 + 1); `cargo test -p conva-app`; `npx tsc -b`; `npx vitest run` (942); `npm run build` (no `faner_debug_*` in `dist/`). Linux only — Windows CI is authoritative. Repo has no ESLint config/script, so no lint step ran. The panel was NOT exercised in a live Tauri window (tests mock the backend); do the manual recipe in the core doc.

## Resume

```
cd <conva_app> ; git fetch origin ; git checkout claude/zen-hypatia-roo97o ; git merge origin/dev
cargo test -p conva-core ; npx tsc -b ; npx vitest run
```

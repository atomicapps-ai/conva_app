# AI workflow rules

Rules for any AI assistant/agent (Claude Code or otherwise) making changes in
this repo. See also [`../CLAUDE.md`](../CLAUDE.md) for architecture/product
context — this page is specifically about *how* an AI-driven change gets from
idea to merged, safely. `AGENTS.md` at the repo root is the short version
coding agents read first; this is the fuller rationale.

## No secrets, ever

- Never write a real API key, token, password, or the contents of
  `TAURI_SIGNING_PRIVATE_KEY` / `RELEASES_REPO_TOKEN` / any other secret into
  a file, commit, PR body, or chat reply — not even "temporarily," not even
  in a `.example` file's sample value.
- Docs reference secrets **by name only** (see `docs/releasing.md`'s table).
  If a task seems to require a real credential to proceed (testing a live
  release publish, decrypting `env/*.enc`, etc.), stop and ask the owner
  instead of generating, guessing, or requesting one be pasted into the
  conversation.
- API keys for the app itself live in the OS keyring at runtime
  (`src-tauri/src/secrets.rs`), never in plaintext config — see CLAUDE.md
  rule 6. Don't add a new plaintext-key code path to "make testing easier."
- Never trigger an action that would create, publish, or modify a real
  GitHub Release, push a release tag, or touch repo secrets on the AI's own
  initiative — those are owner-only actions (see below).

## No direct releases

- An AI assistant does not tag a release, push a `v*` tag, publish a draft
  Release in `conva_releases`, or push to `main`. Releasing is an explicit,
  reviewed owner action (`docs/releasing.md`) — an AI can prepare everything
  up to that point (version bump PR, changelog entry, release-note draft)
  but the tag push and the "Publish" click are the owner's.
- Workflow-file changes that affect the release pipeline
  (`.github/workflows/release.yml`, `build-installers.yml`) are reviewed
  like any other code change — small, explained diffs, never "while I'm in
  here" bundled with an unrelated feature.

## Small branches

- Work on the assigned feature branch (never commit straight to `main` or
  `dev` locally); keep each branch to one coherent change.
- Prefer several small, reviewable PRs over one large one — especially for
  anything touching the IPC contract (`crates/conva-core/src/ipc.rs` ↔
  `src/lib/ipc.ts`, changed together in the same commit per CLAUDE.md rule 2)
  or the release/update pipeline.
- PR titles are Conventional Commits (`feat:`, `fix:`, …) — CI enforces this
  (`ci.yml`) because it drives the changelog and the SemVer bump decision in
  `docs/releasing.md`.

## Tests required

- New logic gets a test in the same PR: pure logic goes in `conva-core` with
  a Rust unit test (CLAUDE.md rule 1); UI behavior gets a Vitest test.
- Anything touching the updater (`src/components/UpdateToast.tsx` and
  friends) **mocks** `@tauri-apps/plugin-updater` /
  `@tauri-apps/plugin-process` — see `UpdateToast.test.tsx` for the pattern.
  Never let a test make a real network request to a release feed.
- Run before opening a PR: `npm run build` (typecheck + build), `npm test`,
  and the Rust checks in [`development.md`](development.md#lint--typecheck).
  CI re-runs all of it, but catching a failure locally first is the point of
  having the commands documented.

## Everything else

Architecture rules (core stays platform-agnostic, audio-thread contract,
navigation model, etc.) are CLAUDE.md's job, not this file's — read it before
making a change that touches the shell, the audio path, or the Live cockpit
UI. This file is scoped to process safety around secrets, releases, branch
hygiene, and tests.

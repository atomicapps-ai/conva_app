## Summary

<!-- What does this PR change, and why? Link the issue it closes. -->

Closes #

## Tests

<!-- What did you run to verify this? Paste the relevant command output/status.
     New logic needs a new test in the same PR (conva-core unit test for pure
     logic, Vitest for UI) — see docs/development.md and docs/ai-workflow.md. -->

- [ ] `npm run build && npm test`
- [ ] `cargo fmt --check && cargo clippy -p conva-core --all-targets -- -D warnings && cargo test -p conva-core`
- [ ] (Windows shell changes only) `cargo clippy -p conva-app --all-targets -- -D warnings && cargo test -p conva-app`

## User-visible changes

<!-- Anything an end user would notice: new UI, changed behavior, a fix.
     If yes, this needs a release-note line (git-cliff picks it up from a
     Conventional Commit PR title) — see docs/releasing.md. If this PR is
     purely internal (refactor, chore, ci, test, docs), say "None." -->

## Secret-safety confirmation

- [ ] This PR does not add, modify, or reference any real secret value (API
      key, token, password, signing key). Secrets are referenced by name
      only, per `docs/ai-workflow.md`.

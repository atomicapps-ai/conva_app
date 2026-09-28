# AI handoff — FANER relevance and voice validation

> Operational handoff only. Canonical product and architecture specifications
> remain in `conva_core/docs`.

## Checkout

- Repository: `C:\Projects\atomicapps\conva\worktrees\faner-context-voice`
- Branch: `codex/faner-context-voice`
- Base: `origin/dev` at `399ac3b3b7263aaf0ebc94d1cd8315802570ee64`
- Target: merge into `dev` through a reviewable pull request.
- Canonical-doc companion worktree:
  `C:\Projects\atomicapps\conva\worktrees\faner-context-voice-core`
- Canonical-doc branch: `codex/faner-context-voice-docs`, based on
  `origin/main` at `eed86fc`; `conva_core` is main-only, so its PR targets
  `main`.

Do not move this work into `C:\Projects\atomicapps\conva\conva_app`. That
checkout was already dirty with unrelated parallel changes, including an older
highlighter experiment. Do not stash, reset, or overwrite those changes.

## Owner-approved outcome

1. Every highlight source must pass one final content-bearing-word gate. Bare
   stopwords and conversational filler such as `the`, `this`, and `are` must
   never be surfaced, including when they came from context terms or feedback.
2. FANER capture must receive the active conversation type, participation lens,
   purpose/goal, role, and prepared terms instead of an empty live-session role.
3. Highlight analysis must still use context terms, entities, rarity, and
   feedback when RAG returns no document chunks.
4. Add labeled, deterministic relevance evaluation with required and forbidden
   terms.
5. Voice accuracy claims must be separated into ASR transcription, speaker
   diarization, and prosody/intonation. Add measurable evaluation foundations;
   do not claim the latter two are implemented or accurate when they are not.

## Parallel-work check

- Open PR #353 changes transcript/Ally-panel presentation. Avoid those UI files.
- Open PR #249 is web certification/backend work and does not overlap.
- The implementation here is confined to FANER core/session logic, tests, and
  this operational handoff unless a newly opened PR changes that assessment.

## Current truth about voice

- Local Whisper separates microphone and loopback channels; it does not identify
  multiple people on one channel.
- Speaker state still assigns inbound speech to a placeholder because diarization
  has not run.
- Question Radar uses transcript punctuation/text heuristics; it does not measure
  pitch or rising intonation.
- The current VU meter is RMS amplitude, not frequency or prosody analysis.
- Existing ASR tests validate plumbing and parsing, not corpus-level WER.

Therefore no defensible diarization, pitch, or intonation accuracy claim exists
yet. This branch should add metrics and fixtures that make later engine work
testable, while keeping the product behavior honest.

## Progress

- [x] Created isolated branch/worktree from current `origin/dev`.
- [x] Checked existing open PRs for overlap.
- [x] Audited FANER term extraction, capture context, ASR, speaker handling,
      Question Radar, and existing tests.
- [x] Add the universal final highlight hygiene gate and regression tests.
- [x] Keep highlight analysis active when RAG retrieval is empty.
- [x] Pass the full active context into live FANER capture and test the prompt.
- [x] Add labeled relevance evaluation cases and thresholds.
- [x] Add separate voice evaluation metrics/tests for ASR, diarization, and
      prosody without representing metrics as recognition engines.
- [x] Update canonical FANER relevance/capture and speaker-validation docs in
      the isolated `conva_core` companion branch.
- [x] Run focused tests, formatting, Clippy, and the complete portable core
      suite.
- [ ] Re-check open PR overlap, commit, push, and open a PR to `dev`.

## Validation log

- `cargo test -p conva-core highlight`: 29 passed.
- `cargo test -p conva-core --test faner_relevance_eval`: 1 passed; the ten
  labeled cases meet the 0.95 precision/recall gates and have zero forbidden
  stopword hits.
- `cargo test -p conva-core voice_eval`: 4 passed.
- `cargo test -p conva-core`: 293 unit tests + 16 archive fixtures + 1 labeled
  FANER relevance evaluation passed; this includes the additional active
  snapshot capture test and all four voice metric tests.
- `cargo fmt --all -- --check`: passed.
- `cargo clippy -p conva-core --all-targets -- -D warnings`: passed.
- `git diff --check`: passed in both worktrees (core docs emit only the
  repository's expected LF-to-CRLF checkout warnings).
- `cargo check -p conva-app`: blocked before compiling the application because
  `whisper-rs-sys` CMake configuration could not find `CMAKE_C_COMPILER` or
  `CMAKE_CXX_COMPILER`. This checkout did not produce an application-source
  compiler diagnostic. A Visual Studio developer environment or corrected
  CMake compiler discovery is required to rerun it.

## Resume prompt

Open this file first, then read the repository `AGENTS.md` and `CLAUDE.md`.
Continue on `codex/faner-context-voice` in the worktree above. Inspect `git
status` before editing. Preserve unrelated work, keep all FANER domain logic in
`crates/conva-core`, use PowerShell commands, edit with patches, and update this
handoff after every meaningful milestone. Do not assert voice accuracy without
labeled-corpus measurements.

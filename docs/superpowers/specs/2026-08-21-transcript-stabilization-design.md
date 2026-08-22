# Live transcript stabilization + formatting cleanup (v1)

> Brainstorming-skill design doc. Status: **approved** (owner, 2026-08-21) —
> next step is `writing-plans`.

## 1. Problem

Live transcript text currently reads as "choppy and chaotic" rather than the
smooth, forward-only feel of the transcription apps the owner is used to.
Two separate but related complaints prompted this:

1. **Words already shown sometimes silently rewrite themselves** while an
   utterance is still being spoken, and again when it finalizes — with no
   visible indication anything is being corrected. It just looks broken.
2. **Visual noise beyond the words themselves**: a `"|"` divider between
   every sentence-unit inside a bubble, and RAG-term highlights rendered as
   a background pill + dotted underline — more decoration than the content
   needs.

## 2. Root cause (verified in code, not assumed)

`crates/conva-core/src/vad.rs`'s `UtteranceSegmenter` emits a `Window`
(partial) event as `self.utterance.clone()` — the **entire** accumulated
audio for the utterance so far, not just what's new since the last partial.
`src-tauri/src/asr.rs`'s `decode()` calls whisper with
`params.set_no_context(true)` — explicitly no memory between decode calls —
and re-decodes that whole growing buffer from scratch on every ~1.2s tick.

There is no incremental/forward-only decoding anywhere in this pipeline.
What looks like a growing live transcript is whisper re-transcribing
everything so far, repeatedly, from zero context each time. It happens to
often agree with its own previous guess for the earlier part of the
utterance — nothing in the code guarantees that agreement, and when it
doesn't hold, an earlier word visibly changes. This is not a bug specific to
this codebase — it's the standard (if naive) way whisper.cpp is made to look
"live" (whisper.cpp's own official `stream` example does the same
re-decode-the-growing-buffer trick), because whisper's architecture is a
batch encoder-decoder over a chunk, not a model with real incremental
streaming/decode state.

**Note for the record:** this codebase already has a genuinely incremental
alternative ASR engine — Deepgram cloud streaming
(`asr_engine=deepgram_cloud`, `src-tauri/src/asr_deepgram.rs`) — which
wouldn't have this class of problem at all, since real streaming ASR APIs
emit stable, forward-only partials by design. Switching the default engine
is a separate, bigger decision (on-device/private vs. cloud) and explicitly
out of scope here; this spec fixes the on-device whisper path's *display*
behavior instead.

## 3. The technique: LocalAgreement-2

This isn't a new invention — it's a published, named policy for exactly this
problem: **LocalAgreement-n**, from "Turning Whisper into Real-Time
Transcription System" ([arXiv:2307.14743](https://arxiv.org/abs/2307.14743)),
implemented in [ufal/whisper_streaming](https://github.com/ufal/whisper_streaming).
A word is only treated as confirmed once **two consecutive independent
whisper decode passes agree on it** (n=2, the standard default). Nothing is
shown as "solid" text until it's survived being re-decoded twice in a row
with the same result — only the still-unconfirmed tail (usually the last
word or two) is shown as tentative.

This app already has the right visual language for that distinction:
`Bubble`'s `partialTail` is already rendered muted (`text-fg-muted`) while a
segment hasn't finalized. This spec reuses that convention rather than
inventing new styling — it just narrows what "tentative" covers, from "the
entire in-flight utterance" down to "only the short tail past the
2×-confirmed prefix."

## 4. Architecture — frontend-only, no Rust changes

Whisper keeps re-decoding exactly as it does today; everything here is a
**pure display-layer concern**. The frontend already receives every
partial/final `TranscriptSegment` unchanged via the existing `applySegment`
path (`state/transcript.ts`) — LocalAgreement-2 and the correction-diff
animation both operate purely on that data, client-side.

**Why not push this into Rust instead:** the frontend already has everything
it needs (every partial `TranscriptSegment`, in order, per `(side, seq)`).
Splitting "stability" logic across two languages for no real benefit adds
risk without adding capability — and it's the one piece of this feature that
genuinely can't be verified locally in this environment (no Rust toolchain
with the GTK deps this sandbox is missing), whereas a frontend-only design
is fully unit-testable here.

### 4.1 `src/lib/transcriptStability.ts` (new, pure, unit-tested)

- `advanceConfirmed(confirmedPrefix: string, lastRaw: string | null, currentRaw: string): string`
  — the LocalAgreement-2 step. Finds the longest common word-prefix between
  `lastRaw` and `currentRaw`; if that agreed prefix extends past
  `confirmedPrefix`, returns the longer one. Word-boundary-safe (never
  splits mid-word) and never returns something shorter than
  `confirmedPrefix` — confirmation is monotonic, it never un-confirms. On a
  new utterance's first-ever partial, `lastRaw` is `null` (no prior
  hypothesis exists yet to agree with) — returns `confirmedPrefix` unchanged
  (empty), so the entire first partial renders as tentative; it takes a
  second partial actually agreeing with the first before anything confirms.
- `tentativeTail(confirmedPrefix: string, currentRaw: string): string` — the
  part of `currentRaw` past `confirmedPrefix`, for the muted display.
- `diffWords(before: string, after: string): { text: string; changed: boolean }[]`
  — word-level diff for the one-time final-correction animation. Reused
  as-is from the already-approved design.

### 4.2 `usePartialFreeze` (new hook, co-located with `TranscriptView.tsx`)

Per in-flight segment (keyed by `side-seq`, reset when a new utterance
starts), holds `{ confirmedPrefix, lastRaw }` in a `useRef`. On every raw
partial update, calls `advanceConfirmed`, then returns
`{ confirmed: string; tentative: string }` for the caller to render —
`confirmed` as normal text, `tentative` in the existing muted `partialTail`
style.

### 4.3 `ScrambleText` (new small component)

Unchanged from the previously-approved design: given the word-level diff
between what was last shown for a segment and its true final text, renders
unchanged words plainly and animates only the `changed` words (brief
randomized-character shuffle, ~300–400ms, settling into the correct word).
Respects `prefers-reduced-motion` (instant swap, no animation). In practice
this almost always touches only the short tentative tail — the confirmed
prefix already survived 2×-agreement and rarely differs from the true final.

### 4.4 Formatting cleanup (same rendering code, bundled in this pass)

- `FlowText`'s `"|"` separator between sentence-units is removed entirely.
- `HighlightedText`'s RAG-term span drops its background pill
  (`bg-ai/15`) and dotted underline decoration, down to plain
  bold + underline — matching the treatment `FanerMark`/`StarMark` already
  use. Each mark's own color-coding is kept (FANER's per-action colors,
  Ally's star/RAG-term color) — only the background/decoration style is
  simplified, not the color semantics.

## 5. Out of scope for this spec

- Any correction logic beyond what whisper's own re-decode already produces
  (cross-talk turn-merging, hallucination re-filtering). A real fast-follow
  once this display mechanism exists, not bundled in here.
- Switching the default ASR engine to Deepgram cloud streaming.
- Applying LocalAgreement-style stabilization to anything other than the
  live partial→final transcript path (e.g. FANER previews, Ally answers are
  unaffected — they have their own, already-accepted streaming/markdown
  rendering).

## 6. Testing

- `transcriptStability.ts`'s three functions are pure — unit-tested the same
  way `faner.ts`/`star.ts` are (word-boundary edge cases, monotonic-confirm
  invariant, diff correctness on real transcript examples).
- `usePartialFreeze` and `ScrambleText` get interaction/behavior tests via
  `@testing-library/react` (matching the `FanerMark.test.tsx` precedent from
  this same session) — using fake timers to drive the scramble animation
  deterministically rather than relying on real elapsed time.
- No native-app verification is possible in this environment (no GTK, no
  audio hardware) — this is flagged plainly in the eventual PR, same as the
  rest of this session's work.

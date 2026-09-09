# FANER Claim Intelligence — AI Handoff

This is the operational handoff for the current Conva/FANER work. It is
written so Codex, Claude, or another coding session can continue without this
chat transcript.

## Required checkout

- Repository: `C:\Projects\atomicapps\conva\conva_app`
- Working branch: `codex/faner-claim-intelligence-ui`
- PR target: `dev` (`main` is release-only)
- Architecture source of truth: sibling `C:\Projects\atomicapps\conva\conva_core`

Before changing anything, fetch, switch to the branch, verify it, and inspect
the working tree. Do not discard unrelated work. In particular,
`src/assets/brand/conva-mark-cutout-white.svg` may contain owner work and is not
part of this feature.

```powershell
$expectedBranch = "codex/faner-claim-intelligence-ui"
Set-Location "C:\Projects\atomicapps\conva\conva_app"
$currentBranch = git branch --show-current
if ($currentBranch -ne $expectedBranch -and (git status --porcelain)) {
    throw "Uncommitted work exists on $currentBranch. Review it before switching."
}
git fetch origin
git switch $expectedBranch
if ((git branch --show-current) -ne $expectedBranch) {
    throw "Required branch is not active."
}
git pull --ff-only origin $expectedBranch
git status --short
```

Read `AGENTS.md`, `CLAUDE.md`, and the linked architecture documents before UI
or IPC changes.

## Product decisions already approved

1. All supported Context types are first-class: Interview, Company Meeting,
   Sales Call, Live Stream, and Other.
2. User-provided documents, Ally web research, and prepared Q&A remain
   separately inspectable.
3. Every Context type receives tailored prepared Q&A. Interview's deep-Q&A
   switch expands research breadth; it no longer decides whether Q&A exists.
4. Live RAG uses one generated source: the compiled **Context Intelligence
   Pack**. A single file is not inherently faster than multiple files—the
   speed benefit comes from the smaller immutable retrieval scope and reduced
   prompt noise while the pack remains internally chunked.
5. Research and Q&A review artifacts do not create vector/index entries. Their
   high-signal content and provenance are compiled into the pack.
6. Markdown remains the lightweight canonical storage format. The UI renders
   it as a formatted document by default and offers an exact Raw view.

## Implemented on this branch

- Safe formatted Markdown viewer for generated Briefing/Research resources.
- Category-aware Q&A prompts and research queries for all five Context types.
- Deterministic intelligence-pack compiler with user/web provenance.
- One-search normal setup flow: Prepare no longer duplicates the web research
  performed by Generate resources.
- Review-only RAG document capability (`RagDocument.searchable`) mirrored in
  Rust and TypeScript; old documents default to searchable.
- Context generation reads attached source documents even when their global
  Library checkbox is off.
- Context profiles switch to exactly one runtime pack after successful
  generation; active scopes are refreshed during regeneration.
- Existing source documents remain visible after the profile switches to its
  one-pack runtime scope.
- Permanent manual test steps in `docs/desktop-live-claim-testing.md`.

## Validation state

Passing:

```powershell
npm run build
npm run typecheck
cargo check -p conva-app
cargo check -p conva-app --tests
cargo test -p conva-core
cargo clippy -p conva-core --all-targets -- -D warnings
cargo fmt --check
npx vitest run src/components/contexts/LibraryPane.test.tsx src/components/context/ContextDetail.test.tsx src/components/context/generationStatus.test.ts src/components/ui/MarkdownDocument.test.tsx
```

The full `npm test` run currently reaches 769/770 passing tests. Known failures
outside this feature are three existing `.mjs` import syntax failures and the
jsdom `blob.arrayBuffer` failure in `src/lib/live/libraryClient.test.ts`.
`cargo test -p conva-app` encountered a Windows incremental-linker `LNK2019`
cache failure; `cargo check -p conva-app --tests` passes.

## Owner acceptance test

Follow `docs/desktop-live-claim-testing.md`. For a Nolan Wells Live Stream
Context, regenerate resources and verify:

- Context Intelligence Pack is Ready;
- Prepared Q&A is Ready even without Tavily;
- Research is either cited and Ready or explicitly Blocked without a key;
- Q&A contains audience/fact-check material, not interview questions;
- generated documents are formatted by default and Raw remains available;
- the pack's provenance distinguishes user material from Ally research;
- the Context's source documents remain visible;
- live statements preserve attribution and unresolved references.

## Next work after owner approval

1. Fix issues found in the owner acceptance run.
2. Add Context/template/conversation import-export and conversation grouping.
3. Implement the separate claim-verification provider workflow with source
   admission, authority ranking, independence, freshness, and audit evidence.

Do not treat detected claims as verified, and do not let one report supporting
an attribution verify the underlying proposition.

## Prompt for the next AI session

> Continue the Conva/FANER claim-intelligence work in
> `C:\Projects\atomicapps\conva\conva_app`. Read `AGENTS.md`, `CLAUDE.md`, and
> `docs/ai-handoff-faner-claim-intelligence.md` completely. Fetch and switch to
> `codex/faner-claim-intelligence-ui`, verify the branch, and inspect the dirty
> tree before editing; preserve the owner's unrelated SVG change. Review the
> latest commits and validation notes. First address any owner test findings
> from `docs/desktop-live-claim-testing.md`. Do not merge to `main` or `dev`,
> tag a release, or publish anything. Keep Rust/TypeScript IPC mirrors in the
> same commit and run the documented focused tests plus build/typecheck.

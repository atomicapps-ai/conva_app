# AGENTS.md — conva_app

Concise instructions for coding agents. Full context: [`CLAUDE.md`](CLAUDE.md)
(architecture/product rules), [`docs/ai-workflow.md`](docs/ai-workflow.md)
(the fuller version of this file), [`docs/development.md`](docs/development.md)
(commands), [`docs/releasing.md`](docs/releasing.md) (release process).

## What this is

Tauri 2 desktop app (Rust + React 19/TypeScript/Tailwind 4/Zustand). Windows
+ macOS today; `crates/conva-core` is a shared, GUI/OS-free domain crate so
the same core will eventually serve a mobile companion.

## Architecture — do not break

- **`crates/conva-core` has zero GUI/OS deps.** Anything touching
  cpal/whisper/keyring/tauri/fs lives in `src-tauri`. Pure logic → core, with
  a Rust unit test.
- **The IPC contract is mirrored by hand:** `crates/conva-core/src/ipc.rs`
  (Rust) ↔ `src/lib/ipc.ts` (TypeScript). Change one, change the other in the
  **same commit**. Every Tauri command needs a typed wrapper in
  `src/lib/commands.ts` too.
- **Audio callback does zero work:** cpal's device callback only copies into
  a lock-free ring buffer — no allocation, locks, or logging in it.
- **Blocking I/O never touches the UI/audio thread** — dedicated threads /
  `spawn_blocking` for LLM streaming and model downloads.
- **Platform capability, not `isTauri`:** components branch on
  `useCapabilities()` (`src/lib/backend/capabilities.ts`), so web/mobile
  degrade honestly instead of crashing on a missing desktop-only command.
- Full rule set (drag-drop, navigation model, the Live-cockpit panel
  pattern, etc.) is in `CLAUDE.md` — read it before touching UI structure.

## Testing

- Pure logic → `conva-core` + `cargo test -p conva-core` (any OS).
- Shell code → `cargo test -p conva-app` (Windows).
- UI → Vitest (`npm test`). Anything using `@tauri-apps/plugin-updater` or
  other Tauri plugins **mocks them** (`vi.mock(...)`) — never a live
  request. See `src/components/UpdateToast.test.tsx` for the pattern.
- Before opening a PR: `npm run build && npm test`, plus
  `cargo fmt --check && cargo clippy -p conva-core --all-targets -- -D warnings
  && cargo test -p conva-core`. Full command reference:
  `docs/development.md`.

## Releasing

- **Agents never tag a release, publish a GitHub Release, or push
  secrets/tokens.** Releasing (`docs/releasing.md`) is an explicit owner
  action: version bump → tag → CI builds → owner reviews and publishes the
  draft in the **public** `atomicapps-ai/conva_releases` repo (installers,
  update manifests, release notes all live there — `conva_app` stays
  private and never gets a public Release of its own).
- `scripts/version.mjs` is the only thing that writes a version — never
  hand-edit `package.json`/`Cargo.toml`/`tauri.conf.json` version fields.
- PR titles must be Conventional Commits (`feat:`, `fix:`, …) — CI enforces
  it; it drives the changelog and the SemVer bump.

## Secret safety

- Never write a real secret value (API key, `TAURI_SIGNING_PRIVATE_KEY`,
  `RELEASES_REPO_TOKEN`, etc.) into any file, commit, or reply — reference
  secrets **by name only**. Never add a plaintext-credential code path.
- App API keys live in the OS keyring at runtime
  (`src-tauri/src/secrets.rs`) — never in a plaintext config file.
- If a task seems to need a real credential to proceed, stop and ask the
  owner rather than generating, guessing, or requesting one be pasted in.

## Workflow

- Small, focused branches, cut from `dev` and PR'd into `dev` — the target here
  and in `conva_web`; `main` is release-only. (`conva_core` has no `dev` branch —
  it is documents-only, so PRs there go straight to `main`.) Don't commit to
  `main`/`dev` locally. Commit/push only when asked. Keep the IPC Rust↔TS mirror in lockstep
  within one commit. Branching/promotion spec:
  `conva_core/docs/technical/CONVA_SDLC_RELEASE_STRATEGY.md` §2.1.
- When asking the owner a question, lead with a recommended option and the
  reasoning — never bare choices.

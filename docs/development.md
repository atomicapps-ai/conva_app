# Development

Condensed setup/run/test/lint/build reference for `conva_app`. Full Windows
prerequisites and build troubleshooting (libclang, LLVM pin, Vulkan SDK) are
in [`../README.md`](../README.md) — read that first if this is a fresh
machine. This page is the command reference once the toolchain is installed.

## Setup

```
npm install
```

`postinstall` runs `patch-package` automatically. First run of the app also
downloads the whisper + embedding models into `models/` (gitignored).

## Run

| Command | What |
|---|---|
| `npm run tauri:gpu` | **Default on Windows** — full Tauri shell, whisper on Vulkan GPU |
| `npm run tauri:gpu:metal` | macOS — whisper on Metal (Xcode required) |
| `npm run tauri:gpu:cuda` | Opt-in NVIDIA/CUDA build |
| `npm run tauri dev` | CPU whisper — last resort only, not a fix for anything |
| `npm run dev` | UI only, no Rust shell (browser tab, empty capabilities) |

Match the script to the OS — see the README's "Run commands" table for why
(Vulkan builds only on Windows/Linux, Metal only on macOS). Never pass
`--features` through `npm run tauri dev --`; npm mangles the flag.

## Test

| Command | What |
|---|---|
| `npm test` | UI unit tests (Vitest + Testing Library), run once |
| `npm run test:watch` | Same, watch mode |
| `cargo test -p conva-core` | Shell-agnostic domain logic (any OS) |
| `cargo test -p conva-app` | Tauri shell tests (Windows — Phase 1 target) |

Update-related tests (`src/components/UpdateToast.test.tsx`) mock
`@tauri-apps/plugin-updater` and `@tauri-apps/plugin-process` — never make a
live network request. Follow that pattern for any new updater-adjacent test.

## Lint / typecheck

| Command | What |
|---|---|
| `npm run typecheck` | `tsc -b`, no emit |
| `cargo fmt --check` | Rust formatting (any OS) |
| `cargo clippy -p conva-core --all-targets -- -D warnings` | Core lint (any OS) |
| `cargo clippy -p conva-app --all-targets -- -D warnings` | Shell lint (Windows) |

There is no ESLint/Prettier in this repo — TypeScript hygiene is enforced by
`tsc -b` (typecheck) plus `npm run build` (which also runs it) in CI.

## Build

| Command | What |
|---|---|
| `npm run build` | `tsc -b && vite build` — UI production build, also the typecheck gate |
| `npm run tauri:build:gpu` | Full local installer build (needs the Windows dev toolchain + Vulkan SDK); bundles land in `target/release/bundle/` |

CI's installer builds run through `.github/workflows/build-installers.yml`,
called by both `release.yml` (tagged releases) and `dev-build.yml` (beta
builds on push to `dev`) — see [`releasing.md`](releasing.md).

## Version

The git tag `vX.Y.Z` is the release source of truth; `package.json` mirrors
it and everything else derives from that mirror. Never hand-edit a version
field — use:

```
npm run version:set 0.2.0      # local: bump and sync every carrier
npm run version:check          # CI/local: assert the carriers agree
npm run version:get            # print the current version
```

See `scripts/version.mjs`'s header comment for the full carrier list and
[`releasing.md`](releasing.md) for SemVer rules.

`npm run changelog:preview` / `npm run changelog:generate` wrap
[git-cliff](https://git-cliff.org) (`cliff.toml`) — install the `git-cliff`
binary separately (it's a release tool, not an npm dependency) to use them
locally.

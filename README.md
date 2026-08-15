# conva

A real-time AI conversation assistant: intercepts both sides of the host computer's audio (microphone + system output), transcribes them live into a dual-column chat UI, and lets a RAG-grounded AI agent process the conversation inline at any moment.

**Design blueprint:** [`docs/phase-1-design-and-spec.md`](docs/phase-1-design-and-spec.md) is a pointer stub — the real doc (tech stack, module boundaries, latency budgets, milestones, and the resolved decision checklist) lives in `conva_core/docs/technical/phase-1-design-and-spec.md` (core is the single source of truth for design docs). Read it before touching code.

## Stack

Tauri 2 shell · Rust core (WASAPI capture → whisper.cpp ASR → LanceDB RAG → provider-agnostic LLM streaming, Claude default) · React 19 + TypeScript + Tailwind 4 UI. Windows is the Phase 1 target.

## Layout

```
conva/
├── docs/                    # Blueprints, specs, phase docs
├── crates/conva-core/   # Shell-agnostic domain layer: types, traits, IPC contract.
│                            # No GUI/OS deps — builds and tests on any platform.
├── src-tauri/               # Tauri 2 shell: wires UI ↔ core, platform implementations
├── src/                     # React UI (Operator theme, dual-column transcript)
└── models/                  # gitignored; ASR/embedding models fetched on first run
```

## Development (Windows)

Prereqs:

1. **VS 2022 Build Tools** with the *Desktop development with C++* workload (MSVC + CMake — whisper.cpp needs both): `winget install --id Microsoft.VisualStudio.2022.BuildTools -e --override "--passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"`
2. **Rust**: `winget install --id Rustlang.Rustup -e` (defaults: stable, MSVC host)
3. **CMake on PATH** — the VS-bundled CMake is not on PATH; install standalone: `winget install --id Kitware.CMake -e`
4. **LLVM 18.x** — whisper-rs's bindgen needs `libclang.dll`, and LLVM 20+ generates broken bindings (compile-time layout assert). Install 18.1.8: https://github.com/llvm/llvm-project/releases/download/llvmorg-18.1.8/LLVM-18.1.8-win64.exe — then set `LIBCLANG_PATH` once: `[Environment]::SetEnvironmentVariable("LIBCLANG_PATH", "C:\Program Files\LLVM\bin", "User")` (new terminals inherit it)
5. **Node 22.12+**

WebView2 is preinstalled on Windows 11. Open a fresh terminal after installs so PATH changes apply. See also the [Tauri 2 Windows prerequisites](https://tauri.app/start/prerequisites/).

### Build troubleshooting (whisper-rs bindgen), from real machine setups

| Symptom | Cause | Fix |
|---|---|---|
| `Unable to find libclang … (invalid: [])` | LLVM missing, or `LIBCLANG_PATH` not set in the window running the build | Install LLVM 18.x (prereq 4); run `$env:LIBCLANG_PATH = "C:\Program Files\LLVM\bin"` in the build window |
| `error[E0080] … Size of whisper_full_params` layout assert | LLVM 20+ generated broken bindings | Replace with LLVM 18.1.8; `cargo clean -p whisper-rs-sys`; rebuild |
| `error[E0080] … Size of _IO_FILE / _G_fpos_t` | bindgen failed entirely, fell back to whisper-rs's **Linux-generated** bundled bindings (never valid on Windows) — see the `Unable to generate bindings` warning above it for the real error | Fix the underlying clang error below, then rebuild |
| `fatal error: 'stdbool.h' file not found` | clang's builtin headers not resolving (e.g. a second LLVM was layered into `C:\Program Files\LLVM` — check `lib\clang` for multiple version folders) | `$env:BINDGEN_EXTRA_CLANG_ARGS = '-I"C:\Program Files\LLVM\lib\clang\18\include"'` (persist with `[Environment]::SetEnvironmentVariable(...)`) |
| `fatal error: 'stdio.h' file not found` | clang can't locate the MSVC/Windows SDK includes from a plain shell (common with Build-Tools-only installs) | Build from **Developer PowerShell for VS 2022** (Start menu), or run `& "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\Common7\Tools\Launch-VsDevShell.ps1" -Arch amd64` first |
| `is 'cmake' not installed?` | CMake not on PATH | Prereq 3, then a fresh terminal |

The `output filename collision … conva_app.pdb` warnings are harmless cargo noise (same-named bin and lib targets).

```powershell
npm install
npm run tauri dev
```

UI-only iteration (no Rust shell, browser tab with empty states): `npm run dev`.

### GPU-accelerated whisper (recommended for conversation speed)

The default build runs whisper on the **CPU** (the log prints
`[asr] whisper backend: cpu` at model load). For real-time conversation,
compile in the Vulkan backend — it works on NVIDIA, AMD, and Intel GPUs and
typically cuts each decode from hundreds of ms to tens of ms:

1. Install the Vulkan SDK (adds the headers + `glslc` the build needs):
   `winget install --id KhronosGroup.VulkanSDK -e`
2. Open a **fresh** Developer PowerShell (the SDK sets `VULKAN_SDK` for new
   terminals), then build with the dedicated script:

```powershell
npm run tauri:gpu
```

(Don't try to pass `--features` through `npm run tauri dev --` — npm mangles
the flag and cargo silently builds the CPU backend; the dev-command line in
the log will show a stray bare `gpu-vulkan` argument when that happens. The
`tauri:gpu` script exists so the flag can't get lost. NVIDIA/CUDA variant:
`npm run tauri:gpu:cuda`.)

The first build recompiles whisper.cpp (a few minutes — a quick 1-2s build
means the feature did NOT apply). On success the log prints
`[asr] whisper backend: vulkan (GPU)` and, from whisper.cpp itself, the GPU
device it picked. If no usable GPU exists at runtime it silently falls back
to CPU — the flag is safe to use everywhere.

## Release installers (any PC / Mac)

Installers are built by CI — no toolchain needed on the target machine:

1. Tag a version and push it:

```powershell
git tag v0.1.0
git push origin v0.1.0
```

2. The **Release** workflow (`.github/workflows/release.yml`) builds on
   GitHub's Windows and macOS runners and attaches everything to a **draft
   GitHub Release**: Windows `.msi` + `.exe` installers (GPU/Vulkan whisper —
   falls back to CPU at runtime on machines without a usable GPU) and a macOS
   `.dmg` (GPU/Metal whisper, Apple Silicon). Review the draft under the
   repo's Releases page and publish it.
3. Install on any Windows 10/11 PC by running the installer (WebView2
   auto-installs on Win10). Models download on first launch.

Not yet wired: code signing. Windows shows a SmartScreen "unrecognized app"
prompt (More info → Run anyway); macOS needs right-click → Open the first
time (deliberately deferred until market-ready).

**Auto-updates:** installed copies check the latest GitHub Release's
`latest.json` a few seconds after startup and show an "Update & restart"
banner when a newer version exists (`src/components/UpdateBanner.tsx`,
`tauri-plugin-updater`). Update packages are signed with the Tauri updater
keypair: the public key lives in `tauri.conf.json`; the private key must be
in the repo's Actions secret `TAURI_SIGNING_PRIVATE_KEY` (no password) for
the release build to produce update artifacts + `latest.json`. Releases must
be **published** (not draft) for the update feed URL to resolve.

Local release build (needs the full dev toolchain + Vulkan SDK):
`npm run tauri:build:gpu` — bundles land in `target/release/bundle/`.

macOS notes: whisper uses the Metal backend (`--features gpu-metal`); API
keys live in the macOS Keychain; the mic permission prompt comes from
`src-tauri/Info.plist`. **System-audio ("them") capture is Windows-only**
(WASAPI loopback — cpal has no macOS equivalent). On macOS the session
degrades to mic-only: your side transcribes, theirs doesn't. There is no
supported workaround — do not point users at a virtual-audio-device hack
(e.g. BlackHole) to fake this; it needs a hand-built macOS Multi-Output
Device or the user stops hearing their own call, it's an unvetted
third-party driver sitting in the exact signal path we tell people nothing
leaves unaudited, and it's not something we can support when an OS update
breaks it. A native path (Core Audio process taps) is future work — see
`conva_core/docs/product/rebrand-spec-2026-08.md` §5.

## Checks

| What | Command |
|---|---|
| Core lint + tests (any OS) | `cargo fmt --check` · `cargo clippy -p conva-core --all-targets` · `cargo test -p conva-core` |
| UI typecheck + build | `npm run build` |
| Tauri shell | `cargo clippy -p conva-app --all-targets` (needs the UI built first) |

CI runs all three on every PR (`.github/workflows/ci.yml`); the shell job runs on `windows-latest`.

## Status

Phase 1 **hybrid retrieval** built: BGE-small embeddings via fastembed/ONNX (`src-tauri/src/embed.rs`, model auto-downloads on a startup warm thread) stored inline per chunk; retrieval fuses BM25 and cosine rankings with reciprocal-rank fusion (`conva-core/src/fuse.rs`, unit-tested) and degrades to BM25-only until the model is ready. Pre-existing documents are backfilled automatically at startup.

Earlier: **M5b (commitment & entity tracker)** — a per-session worker (`src-tauri/src/tracker.rs`) batches finalized speech and runs fast-slot LLM extraction passes (≥5 new finals, or ≥2 after 45 s idle) — entities and commitments dedupe into a session-scoped state rendered in a collapsible right rail (who / what / due). Prompt + defensive JSON parsing live in `conva-core/src/tracker.rs` (unit-tested); everything is best-effort and skips silently without a key. Toggle in Settings (`tracker_enabled`, default on). Remaining for Phase 1 polish: hybrid-retrieval embeddings, sidecar mode, AEC.

Earlier: **M5a (sessions + Question Radar + export)** — every live session persists its finalized segments to `<app-data>/sessions/<id>.jsonl`; the Sessions panel lists and reopens past transcripts and exports the shown transcript as Markdown via the native save dialog. The **Question Radar** (design §6.2) watches inbound finals — when the other party asks something the reference library can answer, the matching chunks appear instantly (zero LLM cost, `conva-core/src/radar.rs` heuristic) with a one-click ✦ Elaborate. Remaining for M5b: commitment/entity tracker (§6.3), latency HUD, hybrid-retrieval embeddings.

Earlier: **M4 (RAG engine)** — drag-drop / file-picker document ingestion (PDF, DOCX, MD, TXT, HTML) → structure-aware chunking with heading breadcrumbs (`conva-core/src/chunk.rs`) → persistent per-document store under app-data with BM25 retrieval (`conva-core/src/bm25.rs`, `src-tauri/src/rag.rs`) wired into every assist: top-8 chunks ground the prompt and each answer card shows its sources (R5 "peek"). The Library panel manages documents (enable/disable toggle, delete). The vector/embedding half of hybrid retrieval (fastembed + ANN + reciprocal-rank fusion) is the next layer behind the same `RagStore` seam.

Earlier: **M3 (manual AI assist)** — the assist dock's Suggest reply (`Ctrl+Space`) / Summarize / free-form question actions build a budgeted context from the finalized transcript (`conva-core/src/prompt.rs`, unit-tested) and stream the answer as cards via `ASSIST_CHUNK` events. Provider clients (`src-tauri/src/llm.rs`): Anthropic native (default), an OpenAI-compatible adapter (OpenAI / xAI / DeepSeek / local Ollama), and Gemini — all SSE-normalized; keys live in the OS credential vault (`keyring`), with per-provider Save/Test (measured first-token latency) and live model lists merged into the §4.6 dropdowns.

Earlier: **M2 (streaming transcription)** — each side's 16 kHz frames flow through an energy-VAD utterance segmenter (`conva-core/src/vad.rs`, unit-tested) into a per-side whisper.cpp engine (`src-tauri/src/asr.rs`) sharing one loaded model. Partials re-decode the open utterance every ~1.2 s (greedy) and stream to the UI as replaceable segments; silence-close finalizes with a small beam. The ggml model auto-downloads on first start with progress events (`src-tauri/src/models.rs`). M1 delivered the dual capture (cpal/WASAPI loopback, VU meters, watchdog, hot-swap, consent gate); M0 the workspace + typed IPC contract (`crates/conva-core/src/ipc.rs` mirrored by `src/lib/ipc.ts` — change both in the same commit) + provider registry with Claude default.

Real capture + transcription require Windows (loopback is WASAPI-only) — pending hands-on validation there. Next: **M5 — Phase 1 enhancements + polish** (Question Radar, commitment tracker, latency HUD, export — design §6/§8), plus the embedding upgrade to hybrid retrieval.

# CLAUDE.md — conva

> Brief for AI assistants (and humans) working in this repo.
>
> **Start every session with the cross-repo onboarding guide:**
> **`conva_core/docs/guides/ai-session-guide.md`** (sibling checkout at
> `../conva_core/`). It carries the strategies, major changes, verified fixes,
> lessons, colour scheme, rules, things to avoid, owner hints, and the current
> open issues — this file covers only what is specific to this repo.
>
> **Current priorities (canonical queue):** `conva_core/docs/product/roadmap.md`.
> Owner-approved; read it before picking up work and update it (same PR) when
> task status or priorities change. **Now:** Phase 1 = get web + desktop in sync
> on a base functionality baseline and launch a **free invite-only beta** + its
> marketing (keystone: the `ConvaBackend` transport layer) → then SDLC → then the
> larger feature set (Mock, Turbo, Incog, billing).
>
> Then read [`README.md`](README.md) for the run guide. **All design/architecture
> docs live in `conva_core` — core is the single source of truth.** The full design
> (architecture, latency budgets, milestones, §9 decisions) is
> `conva_core/docs/technical/phase-1-design-and-spec.md`; the desktop↔web model is
> `conva_core/docs/technical/CONVA_ARCHITECTURE.md`. This repo holds code + this
> operational file only — do not add design docs here (move them to core + leave a
> pointer stub, per the moved `docs/*.md` examples).

## What conva is

A real-time AI conversation assistant. It intercepts **both** sides of the host
computer's audio — your microphone (outbound) and the system output / other
party (inbound, via WASAPI loopback) — transcribes them live into a dual-column
chat UI, and lets a RAG-grounded LLM process the conversation inline at any
moment. It can also record the live call to a stereo WAV (you = left, them =
right) via `src-tauri/src/recorder.rs` — a background writer thread fed by the
existing capture frames, so recording adds no work to the audio or UI path.
Windows is the Phase 1 target (loopback is WASAPI-only).

Conversations are first-class: Stop offers to save the transcript as a named
**conversation** (`src-tauri/src/conversations.rs`, one JSON per record in
app-data); while one is open, new listening runs append on screen and
re-saving stores the fuller transcript. Library documents can be linked to a
conversation, and the whole reference library can travel between machines via
the repo-committed `library/` folder ("Sync to repo…" in the Library panel
exports originals; startup auto-ingests anything new found there).

## Stack

Tauri 2 shell (Rust core + system WebView) · React 19 + TypeScript + Tailwind 4 +
Zustand UI · cpal/WASAPI capture → whisper.cpp ASR (whisper-rs; opt-in Deepgram
cloud streaming via `asr_engine=deepgram_cloud` + key, `src-tauri/src/asr_deepgram.rs`)
→ hybrid RAG (BM25 + fastembed/ONNX embeddings, RRF fusion) → provider-agnostic
LLM streaming (Anthropic default; OpenAI/Google/xAI/DeepSeek/Ollama). **Do not
swap a layer without asking the owner.**

## Repo layout

| Path | What |
|---|---|
| `docs/` | Blueprints/specs — design doc lives here; new design docs go here. |
| `crates/conva-core/` | Shell-agnostic domain layer: types, traits, IPC contract, pure logic (DSP, VAD, chunking, BM25, RRF, prompt/tracker/radar). **Builds + tests on any OS** — this is where unit tests live. |
| `src-tauri/` | Tauri 2 shell: platform implementations (audio, ASR, models, LLM clients, RAG store, sessions, tracker) + the `#[tauri::command]` surface. |
| `src/` | React UI. `lib/ipc.ts` mirrors the Rust IPC contract; `lib/commands.ts` wraps the Tauri commands; `state/*` is Zustand. |
| `models/` | gitignored; ASR + embedding models auto-download on first run. |

## Architecture rules — do not break

1. **Core stays platform-agnostic.** `crates/conva-core` has no GUI/OS deps.
   Anything touching cpal/whisper/keyring/tauri/fs lives in `src-tauri`. Pure,
   testable logic belongs in core (and gets a unit test there).
2. **The IPC contract is mirrored by hand.** `crates/conva-core/src/ipc.rs`
   (Rust) ↔ `src/lib/ipc.ts` (TypeScript). Change one, change the other **in the
   same commit**. Events are namespaced `conva://*`.
3. **Every Tauri command has a typed wrapper** in `src/lib/commands.ts` and its
   types in `src/lib/ipc.ts`. Adding a command = update both sides.
4. **Audio threading contract (§2.4).** The cpal device callback ONLY copies
   samples into the lock-free rtrb ring — no allocation, locks, or logging. A
   dedicated worker drains, downmixes, resamples to 16 kHz mono, and hands off
   `AudioFrame`s. Never do work in the callback.
5. **Blocking I/O off the UI/audio path.** LLM streaming and model downloads use
   blocking `ureq` on dedicated threads / `spawn_blocking`, never the UI thread.
6. **API keys live in the OS credential vault** (`keyring`) at runtime, never in
   plaintext files/config. Empty submission clears the key. They may optionally
   be exported to a **passphrase-encrypted** file (`*.secrets.enc`, cocoon) that
   is safe to commit to git and travels to another machine; the passphrase comes
   from the `CONVA_SECRETS_PASSPHRASE` env var (never committed), and on
   startup missing keys are seeded from that file. See `src-tauri/src/secrets.rs`.
7. **RAG is best-effort hybrid.** Retrieval fuses BM25 + cosine (RRF) and
   **degrades to BM25-only** when the embedder isn't ready — hybrid is an
   upgrade, never a hard dependency. Ingestion supports pdf/docx/md/txt/html
   plus pasted text (stored as `.txt`).
8. **`dragDropEnabled: false` is required for intra-app HTML5 drag-and-drop.**
   Tauri's window-level native drag-drop (on by default) intercepts drag
   events at the OS/webview boundary, which silently breaks in-page
   `draggable`/`dataTransfer` DnD (e.g. Library → Contexts attach) even
   though the elements and handlers are all correct — nothing errors, drops
   just never fire. OS file-drop-onto-window (Library's own file ingest)
   doesn't need the native handler either — it already goes through
   `getCurrentWebview().onDragDropEvent`, so disabling this in
   `tauri.conf.json`'s window config doesn't cost anything.

## Build & run

> **Dev-environment defaults (read this — it saves hours).** The primary dev
> machine is **Windows with the Vulkan SDK already installed**. The default run
> command is **`npm run tauri:gpu`**. Do **not** recommend or fall back to CPU
> whisper (`npm run tauri dev`) — it is too slow to be usable and is *not* a fix
> for anything. Never use `tauri:gpu:metal` here (Metal is macOS-only; it fails
> to build on Windows in `ggml-metal/CMakeLists.txt`).
>
> **Shell: the owner runs commands in Windows PowerShell.** `&&` is a parse
> error there — chain commands with `;` (semicolon), not `&&`, in anything you
> hand the owner to run.

Prereqs + a Windows build-troubleshooting table (libclang, the LLVM-20 layout
assert → **pin LLVM 18.1.8**, stdbool.h/stdio.h, cmake) are in
[`README.md`](README.md). From a fresh terminal after prereqs:

```
npm install
npm run tauri:gpu      # Windows + Vulkan (the default here); first launch
                       # downloads the whisper + embedding models
```

### Run commands — match the script to the OS ⚠️

whisper runs on the **GPU** for conversation speed. The GPU backend is
**platform-specific** — the wrong script wastes real time (the build fails, or
falls back to unusably slow CPU, and you end up staring at a stale app). CPU is a
last resort, never a recommendation.

| Platform | GPU dev command | Backend | Needs |
|---|---|---|---|
| **Windows (default here)** | `npm run tauri:gpu` | Vulkan | Vulkan SDK (installed) |
| **macOS** | `npm run tauri:gpu:metal` | Metal | Xcode |
| **NVIDIA (opt-in)** | `npm run tauri:gpu:cuda` | CUDA | CUDA Toolkit |
| last resort only | `npm run tauri dev` | CPU (slow) | nothing extra |

- **Vulkan builds only on Windows/Linux; Metal only on macOS.** `tauri:gpu:metal`
  on Windows dies in `ggml-metal/CMakeLists.txt`; `tauri:gpu` (Vulkan) does not
  build on macOS. Match the script to the OS — this is the #1 time-waster.
- Do **not** pass `--features` through `npm run tauri dev -- …` — npm mangles the
  args. Use the dedicated scripts above.
- `[asr] whisper backend: …` at model load prints which backend is actually live.
- Faster STT without leaving the device is the **GPU** build (above). Cloud speed
  is opt-in **Deepgram** (`asr_engine=deepgram_cloud` + key). CPU is not a path.

### Which build am I running? (stop debugging stale binaries)

Every build carries a **git-sha stamp** (`vite.config.ts` injects `__GIT_SHA__` /
`__BUILD_TIME__`), shown in the **status bar** bottom-right (`build <sha>`) and
logged at boot (`[conva] build <sha> · <time>`). If a change "didn't work",
**check the sha first** — a mismatch means a stale build, not a broken fix. The
status-bar **`debug ⧉`** button copies a diagnostics report (build, platform,
window + live column widths, session state, last error) and writes
`<app-config>/conva-debug.log`.

### Platform capability gaps

- **System-audio (other-party) capture is Windows-only.** The inbound side is
  WASAPI loopback — an input stream on an *output* device — which cpal only does
  on Windows. On macOS/Linux the session **degrades to mic-only** (your side
  transcribes; theirs doesn't) rather than failing. A native macOS path
  (ScreenCaptureKit) is future work; Windows is the full-capture Phase-1 target.

### Accounts & backend (in progress)

Account sign-in (OAuth via Supabase, PKCE + `conva://` deep-link return — no
loopback server, mobile-ready) is in `src-tauri/src/auth.rs`; tokens live in
the OS keyring, UI entry is Settings → Account. ⚠️ Never launch OAuth URLs via
`cmd /C start` — cmd splits the URL at `&` and silently drops every query
param after the first (that was the "Google bounces to conva-app.com" bug);
`open_browser` uses `rundll32 url.dll,FileProtocolHandler`. The platform design (auth, settings sync, dynamic config, billing/
credits, OpenAPI) and the Supabase migrations live in the **conva_core** repo
under `docs/platform/` and `platform/`.

Default settings live in the repo-committed `conva.config.json` — a fresh
machine seeds its config from it (Settings → "Export settings…" writes the
current values back for committing). LLM API keys are NEVER in that file —
they are entered in-app (Settings). To carry keys to
another machine, set `CONVA_SECRETS_PASSPHRASE` (any strong passphrase),
Settings → **Export encrypted…**, commit the resulting `conva.secrets.enc`,
then on the other machine set the same env var and the keys load on startup.

## Checks (run before pushing)

| What | Command |
|---|---|
| Core lint + tests (any OS) | `cargo fmt --check` · `cargo clippy -p conva-core --all-targets` · `cargo test -p conva-core` |
| Shell tests + lint (Windows) | `cargo test -p conva-app` · `cargo clippy -p conva-app --all-targets` |
| UI typecheck + build | `npm run build` |

CI (`.github/workflows/ci.yml`) runs core lint+test on ubuntu, UI typecheck+build
on ubuntu, and the shell clippy `-D warnings` on windows-latest. Clippy runs with
`-D warnings` — keep it clean.

Releases: pushing a `v*` tag runs `.github/workflows/release.yml`, which
builds Windows MSI/NSIS installers (GPU/Vulkan) and a macOS dmg (GPU/Metal)
on GitHub runners and drafts a GitHub Release — see README "Release
installers". Signing/notarization and the auto-updater are not wired yet.

## One codebase, desktop + mobile

conva is a **single project for desktop and mobile**, not separate apps —
treat every change as multi-platform. `crates/conva-core` is shared, pure,
and must stay GUI/OS-free so it compiles for phones; platform-specific
capability lives in `src-tauri` behind `#[cfg(desktop)]` / `#[cfg(mobile)]`
gates (deps gated by OS in `Cargo.toml`). One `run()` in `src-tauri/src/lib.rs`
(`#[cfg_attr(mobile, tauri::mobile_entry_point)]`) drives all platforms.
Desktop is the product today; a light **mobile companion** is the first
mobile target. Full conventions + how to add iOS/Android targets:
[`docs/multiplatform.md`](docs/multiplatform.md).

## Workflow

- Develop on the assigned feature branch; don't commit to `main` locally.
- Commit/push only when the owner asks. Keep the IPC Rust↔TS mirror and the
  command wrappers in lockstep within a commit.
- Prefer adding pure logic to core with a unit test over untested shell code.
- New platform-specific feature? Gate it (`#[cfg(desktop)]`/`mobile`) and make
  the UI degrade when a desktop-only command is absent — see multiplatform doc.
- **When asking the owner a question, always lead with a recommended option and
  the reasoning behind it** — never present bare choices. State the trade-offs
  and which one you'd pick and why, so a decision can be made in one glance.
- **Scripts you hand the owner follow a branch + directory + freshness contract**
  (canonical: `../conva_core/docs/guides/ai-session-guide.md` §4). Before a local
  script changes anything: **(1)** set the **directory** explicitly (Windows real
  paths, e.g. `C:\Projects\atomicapps\conva\conva_app`, or an argument) — never
  rely on the current dir, each repo is its own path; **(2)** set the **branch**
  explicitly, per repo, and switch to it deliberately — never assume the owner is
  on it (this repo often sits on a feature branch like `claude/stealth-mode`);
  **(3) `git fetch` first and be merge-ready** — fast-forward when clean, merge
  when diverged, cherry-pick when only one commit is wanted; **(4)** never
  overwrite uncommitted work — detect a dirty tree, stop and list the blocking
  files, then apply and print a per-repo summary. Every command block names its
  branch + path.

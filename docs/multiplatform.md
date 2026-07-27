# conva is one codebase for desktop **and** mobile

conva is built so desktop (Windows/macOS/Linux) and mobile (iOS/Android)
are the **same project**, not separate apps. Developers should treat every
change as multi-platform from the start. This doc is the convention guide.

> **Status:** desktop is the product today. A **light mobile companion** is
> the first mobile target (view/search conversations + library, receive AI
> cue cards, pair with the desktop app). The full live copilot stays
> desktop-first — see "Why mobile is a companion" below.

## The shape (why this works)

```
conva/
├── crates/conva-core/   ← shared, platform-agnostic. Pure Rust: types,
│                          IPC contract, DSP, VAD, chunking, BM25/RRF,
│                          prompt/tracker/radar. Builds + tests on ANY OS,
│                          incl. iOS/Android. No GUI/OS deps. Ever.
├── src-tauri/           ← the Tauri shell. ONE `run()` entry point
│                          (src/lib.rs) drives desktop and mobile. Platform
│                          code lives here behind cfg gates.
├── src/                 ← the React UI. Shared across all platforms;
│                          responsive layouts adapt phone ↔ desktop.
└── src-tauri/gen/       ← generated iOS/Android projects (gitignored;
                           created by `tauri ios/android init`).
```

Two rules keep it healthy:

1. **Pure, portable logic goes in `conva-core`** with a unit test. It must
   never gain a GUI/OS dependency — that's what lets it compile for a phone.
2. **Platform-specific capability goes in `src-tauri` behind a cfg gate**,
   never sprinkled inline. See the pattern below.

## The multi-platform entry point

`src-tauri/src/lib.rs` exposes a single `run()`:

```rust
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() { … }
```

- **Desktop:** `src-tauri/src/main.rs` calls `conva_app::run()`.
- **Mobile:** Tauri generates the native iOS/Android shell; the
  `mobile_entry_point` attribute wires `run()` in as its entry.

Same function, every platform. Don't fork it.

## Gating platform-specific features

**In Rust code**, use Tauri's `desktop` / `mobile` cfgs (declared by
`tauri-build`, so they pass `clippy -D warnings`):

```rust
let builder = tauri::Builder::default().plugin(tauri_plugin_dialog::init());

#[cfg(desktop)]
let builder = builder
    .plugin(tauri_plugin_updater::Builder::new().build())  // no mobile equiv
    .plugin(tauri_plugin_process::init());
```

**In `Cargo.toml`**, Cargo can't see Tauri's `desktop` cfg, so gate deps by
OS (everything that isn't a phone):

```toml
[target.'cfg(not(any(target_os = "android", target_os = "ios")))'.dependencies]
tauri-plugin-updater = "2"
tauri-plugin-process = "2"
```

Current desktop-only pieces: the auto-updater + process-restart (app stores
own updates on mobile). Coming ones that will follow the exact same shape:
WASAPI/system-audio **loopback capture**, the always-on-top **overlay**, and
**screen-capture exclusion** — all desktop-only; mobile gets its own capture
and display shims.

**In the UI (`src/`)**, feature-detect rather than hardcode. The updater
banner already degrades to a silent no-op when the plugin is absent — mirror
that: guard platform calls in a `try/catch` or behind an `isTauri()`-style
check so the mobile build doesn't reference a desktop-only command.

## Adding the mobile targets (when a dev has the toolchains)

conva does **not** commit the generated mobile projects; each dev/CI runner
generates them on demand.

Android (needs Android Studio + SDK + NDK, `ANDROID_HOME`/`NDK_HOME`):

```bash
npm run tauri android init      # once — writes src-tauri/gen/android
npm run tauri android dev       # run on emulator/device
```

iOS (needs a Mac + Xcode):

```bash
npm run tauri ios init          # once — writes src-tauri/gen/apple
npm run tauri ios dev
```

These aren't wired into CI yet (the desktop release pipeline is
`.github/workflows/release.yml`). A mobile CI lane is added when the
companion work starts.

## Why mobile is a companion, not the full copilot

The desktop killer feature — capturing **both** sides of a call (your mic +
the other party via system-audio loopback) — is blocked by phone OSes:

- **iOS:** no third-party system-audio loopback. Call/app audio is reachable
  only via a ReplayKit **broadcast** the user explicitly starts, or via a
  **meeting bot** that joins the call from the cloud.
- **Android:** `MediaProjection` + `AudioPlaybackCapture` can grab playback,
  but conferencing apps may opt out; a meeting bot is the reliable path.

Display is asymmetric too: **Android** allows floating cards over other apps
(`SYSTEM_ALERT_WINDOW`); **iOS** does not — cues surface as notifications,
**Live Activities**, or the **Dynamic Island**.

So the durable mobile design is: **the bot (or the meeting platform's own
captions) does the hearing; the phone displays the cues.** The first
companion release is lighter still — pair to desktop, browse conversations +
library, receive cards — and grows toward bot-delivered live cues.

## Checklist for any change

- Logic reusable across platforms? → `conva-core` + a unit test.
- Touches audio/OS/updater/overlay? → `src-tauri` behind a `#[cfg(desktop)]`
  (or `#[cfg(mobile)]`) gate, deps gated by OS in `Cargo.toml`.
- New Tauri command? → keep the IPC Rust↔TS mirror + the `commands.ts`
  wrapper in lockstep (per `CLAUDE.md`), and make sure the UI degrades when
  the command is desktop-only.

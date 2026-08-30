# Screenshot button (v1)

> Brainstorming-skill design doc. Status: **approved** (owner, 2026-08-29 —
> requirements gathered; owner, 2026-08-30 — "yes, pick it back up and
> finish it"). Ships as its own small PR off `main`.
>
> **v1.1 addendum (2026-08-30, after first real-device test):** the owner
> reported the save folder didn't exist at all — a real bug, not a UI
> nit. Root-caused to the app's CSP (`default-src 'self'`, no `img-src`
> override): html2canvas internally rasterizes elements via
> `data:image/svg+xml,...` `<img>` sources, which a strict `'self'`-only
> CSP blocks outright (`data:`/`blob:` are never implicitly covered by
> `'self'`) — the whole capture likely threw before ever reaching the save
> step, and the button's `catch` swallowed the error with no logging, so
> there was no way to see why. Fixed by adding `img-src 'self' data:
> blob:` to the CSP, and separately fixed the silent-swallow: errors now
> `console.error` and land in `useAppStore.lastError` (visible via the
> existing "debug ⧉" report) as well as a result popover. **Default save
> location moved** from `<app-data>/screenshots/` to
> `<Pictures>/conva-screenshots/` (owner: "the proper location should be
> the usual users pictures folder") — `AppConfig.screenshot_save_dir`
> (`Option<String>`) overrides it, set via a new right-click menu on the
> button ("Set save location…" / "Open screenshots folder"). The
> confirmation is now a white camera-flash overlay (fired the
> instant capture completes, never before/during — the design section
> below explains why) plus a small popover naming the saved path, replacing
> the old icon-color (green/red) flash the owner found looked like an error
> state ("no red flash, a white flash").
>
> **v1.2 addendum (2026-08-30, still broken after v1.1 — a second, bigger
> root cause):** the owner's next report showed the folder existing but
> empty, `lastError` now reading `Attempting to parse an unsupported color
> function "oklab"`. `globals.css`'s own 17 hand-written `color-mix(in
> oklab, ...)` calls (cards, rows, buttons, focus rings) were switched to
> `in srgb` — shipped as its own fix — but a THIRD report followed
> immediately after, same class of error, different function name
> (`"color"`). Turned out the 17 hand-written occurrences were never the
> real bulk of the problem: Tailwind v4's own alpha-modifier utilities
> (`bg-primary/50`, `border-rec/30`, every `/N` opacity class used anywhere
> in the app — ~90 of them in the compiled bundle) compile to `color-mix(in
> oklab, ...)` via a template **hardcoded in Tailwind's engine, with no
> config override** (confirmed against the installed `tailwindcss`
> source). A Vite build-pipeline CSS transform was tried first and
> abandoned after instrumented logging proved it — despite looking like it
> should work — never actually saw Tailwind's generated content (the
> module's `code` arrived as an empty string on the one `transform` call
> observed, through whatever internal channel Tailwind's Vite plugin
> actually uses to emit final CSS). Chasing the build pipeline further
> wasn't reliable, so the fix moved to the one point guaranteed to see the
> real, final styling: **capture time itself.** `screenshot.ts` now passes
> an `onclone` hook to `html2canvas` — called after the cloned document's
> stylesheets are attached, so `getComputedStyle` on it is real — that
> walks every element and, for any color-bearing computed value containing
> a suspect function (`color-mix`, `oklab`, `oklch`, `lab`, `lch`,
> `color`), round-trips it through a throwaway `<canvas>` 2D context:
> `fillStyle`'s setter accepts any valid CSS `<color>` but its getter
> always serializes back out as `rgb()`/`rgba()`/hex — the standard
> browser trick for "any CSS color in, a parseable one out" — and writes
> the result back as an inline style on the clone, which wins the cascade.
> Catches every source uniformly (Tailwind's utilities, the app's own
> tokens, anything added later) with no per-declaration chasing. Unit
> tests cover the pure parsing/replacement logic (`replaceSuspectColorFunctions`
> in `screenshot.test.ts`); the canvas round-trip itself is browser-only,
> same as the rest of this capture path.
>
> **v1.3 addendum (2026-08-30, a FOURTH report — this time total silence):**
> after v1.2, the owner reported no flash, no result popover, no terminal
> output, nothing — "the screenshot didn't work" with zero symptoms to
> diagnose from, plus a fair question: is this actually writing trace info
> anywhere? It wasn't, in any form the owner could see: this pipeline is
> almost entirely client-side JS, and `console.*` only ever reaches the
> webview's own devtools (Cargo's `devtools` feature is on — right-click →
> Inspect), never the terminal `npm run tauri:gpu` runs in, which is where
> the owner was actually looking. Total silence with no error also matches
> a genuine hang, not another parse failure: reading html2canvas's own
> source turned up that its clone step **awaits the cloned document's
> `fonts.ready`** (the Font Loading API) before ever calling `onclone` — a
> promise this file has no control over and no way to skip; if it never
> settles in a given webview, the whole capture waits forever with no
> observable symptom at all, independent of anything in this codebase.
> Three changes, all in service of never letting this be silent again:
> - **A 20s timeout** (`withTimeout` in `screenshot.ts`) races the whole
>   `html2canvas(...)` call — a hang anywhere in its pipeline (fonts.ready
>   or otherwise) now becomes a real, caught, reported error instead of an
>   unbounded wait.
> - **`onclone`'s color-fixup runs inside its own try/catch** — a bug in
>   `normalizeClonedColors` can no longer throw synchronously into
>   html2canvas's clone/render pipeline; worst case a capture reverts to
>   the pre-v1.2 "unsupported color function" failure, never a new, harder
>   failure mode.
> - **Real terminal-visible tracing.** A new `screenshot_trace(msg)` Tauri
>   command (`lib.rs`) just `eprintln!`s to this process's own stderr —
>   the terminal the owner is actually watching. `captureScreenshot`
>   accepts an optional `trace` callback and calls it at every stage
>   (html2canvas import, render start/done, `onclone` start/done, blob
>   ready); `StatusBar.tsx` wires it to `backend.diagnostics.trace` and
>   adds its own stages (clipboard, base64, save). `screenshot.ts` stays
>   backend-agnostic (no `ConvaBackend` import) — the trace fn is injected,
>   not imported.
> - Also: the button now gives visible feedback the instant it's clicked
>   (`animate-pulse` on the camera icon while `busy`) — previously there
>   was no UI difference between "just clicked, capture is 2s from
>   finishing" and "nothing happened," which read as broken on its own.
>
> **v1.4 addendum (2026-08-30, the tracing from v1.3 paid off immediately):**
> the owner rebuilt and the terminal trace showed exactly what v1.3 was
> for: `onclone:start` → `onclone:done` (the element-walk color-fixup ran
> clean) → `failed: Attempting to parse an unsupported color function
> "color"` — the SAME failure, but now provably happening AFTER the fixup,
> inside html2canvas's own subsequent render pass. That pointed straight at
> a `::placeholder`/`::before`/`::after`-shaped gap: pseudo-elements have no
> real DOM node, so `normalizeClonedColors`'s `querySelectorAll("*")` walk —
> no matter how many properties it checks — can never see or fix one.
> Grepping the compiled CSS bundle for every pseudo-element rule using a
> suspect function turned up exactly one live culprit: Tailwind's own
> PREFLIGHT sets `::placeholder { color: color-mix(in oklab, currentcolor
> 50%, transparent); }` **unconditionally on every `<input>`/`<textarea>`**,
> regardless of any class used — invisible to the fix, and virtually
> guaranteed to be present on any real app screen with a text field
> (`::selection` was the only other pseudo-element hit, already safe —
> `in srgb`, from `globals.css`'s own earlier fix; no `::before`/`::after`
> rule in this codebase uses a suspect function, confirmed both in source
> and compiled output). Since no JS API sets a pseudo-element's style
> directly, `fixPlaceholderPseudoElement` (`screenshot.ts`) injects a
> `<style>` rule into the cloned document instead — `::placeholder { color:
> inherit; opacity: .5; }` reproduces the exact same "half-transparent
> current text color" look using only a keyword and an opacity value,
> nothing color-mix/oklab/any function html2canvas can choke on. Called
> from `onclone` alongside the existing element walk, same try/catch.

## Requirements (from the 2026-08-29 brainstorm)

- Captures the **whole app window** — not a region picker, not the whole
  screen/desktop.
- **Both** clipboard and file: every capture copies to the system clipboard
  *and* saves a PNG.
- File save target: **app-data `screenshots/` folder**, timestamped
  filename — no save dialog, no path picker.
- Platforms: **Windows + macOS**.
- Confirmation: an **inline flash** on the button itself, not a modal/alert.
- **Hidden in the web preview** — desktop-only, same as every other
  filesystem-touching affordance in this app (`isTauri()` gate).

## Architecture decision: DOM capture, not OS-level window capture

The obvious-looking approach — grab the native window's pixels via the OS
(Windows `PrintWindow`/`BitBlt`, macOS `CGWindowListCreateImage`) — was
rejected. It would mean new unsafe, per-platform Rust code (two platforms,
each with its own window-handle/DPI-scaling quirks) that **this session
cannot compile or exercise at all**: there's no Windows or macOS toolchain
in this sandbox (`cargo check -p conva-app` doesn't even link here — see
CI's `Tauri shell (Windows)` job for why local Rust shell verification
isn't possible), so landing untested unsafe native capture code is a real
risk of shipping something that silently doesn't work, discovered only
after the owner rebuilds.

Instead: **`html2canvas`** renders the app's own DOM (`#root`, the whole
mounted React tree — i.e. everything the window shows) to a `<canvas>`,
entirely in the webview via ordinary DOM/canvas APIs that exist identically
on Windows and macOS (WebView2 and WKWebView both implement them). This is
the standard "screenshot this web UI" technique and is what "capture the
whole app window" means in practice for an app whose entire surface is
already DOM. No new native dependencies, no unsafe code, and the one new
piece of Rust (writing bytes to a file) is trivially testable.

## Design

### 1. Filename (core, pure + unit-tested)

`crates/conva-core/src/screenshot.rs` — new module:

```rust
pub fn screenshot_filename(unix_ms: u64) -> String
```

Formats a Unix-ms timestamp as `conva-screenshot-YYYY-MM-DD_HH-MM-SS.png`
(UTC, sortable, filesystem-safe — colons aren't valid in Windows
filenames, hence `HH-MM-SS` not `HH:MM:SS`). No date crate: this codebase
has never needed one, and UTC calendar conversion from a day count is a
small, well-known, dependency-free algorithm (Howard Hinnant's
`civil_from_days`), unit-tested here directly against known dates.

### 2. Save command (shell)

`src-tauri/src/lib.rs`:

```rust
#[tauri::command]
fn save_screenshot(app: AppHandle, png_base64: String) -> Result<String, String>
```

Decodes the base64 PNG (the `base64` crate is already a dependency, used
by `auth.rs`), writes it to `<app_data_dir>/screenshots/<filename>`
(creating the directory if needed — same `fs::create_dir_all` idiom
`save_debug_log` already uses), and returns the absolute path. Registered
in `generate_handler!`.

### 3. Wrappers (TS mirror)

- `src/lib/commands.ts`: `saveScreenshot(pngBase64: string): Promise<string>`
  → `invoke("save_screenshot", { pngBase64 })` (mirrors `saveDebugLog`
  exactly).
- `src/lib/backend/ConvaBackend.ts` / `tauri.ts` / `web.ts`: new
  `screenshot: { save(pngBase64: string): Promise<string> }` namespace,
  same shape as the existing `diagnostics` namespace; the web backend's
  `save` throws `unsupported(...)` (same pattern as
  `diagnostics.saveDebugLog`) — unreachable in practice since the button
  itself is `isTauri()`-gated, but keeps every backend method total.

No `ipc.rs`/`ipc.ts` entry needed — same as `saveDebugLog`/`writeTextFile`,
this is a plain scalar-in/scalar-out command, not a shared data shape.

### 4. Capture + button (frontend)

New `src/lib/screenshot.ts`:

```ts
export async function captureScreenshot(): Promise<Blob>
```

`html2canvas(document.getElementById("root")!)` → `canvas.toBlob(...,
"image/png")`, rejecting if `toBlob` yields `null`. Kept out of the
component so it's easy to reason about independent of React state.

`StatusBar.tsx` gets a new button next to the existing `debug ⧉` one
(same visual treatment — `font-mono text-[10px]`, icon, hover state),
`isTauri()`-gated:

1. `captureScreenshot()` → `Blob`.
2. Clipboard: `navigator.clipboard.write([new ClipboardItem({"image/png":
   blob})])`, wrapped in try/catch — best-effort, exactly like the debug
   button's `writeText` (a webview clipboard-image-write limitation on one
   platform shouldn't block the file save).
3. File: `Blob` → base64 via `FileReader.readAsDataURL` (strip the
   `data:image/png;base64,` prefix) → `backend.screenshot.save(base64)`.
4. Confirmation: local `flashed` state, `true` for ~1.2s, swapping the
   button's icon to a checkmark and its label to "Saved" — no
   `window.alert` (the brainstorm explicitly asked for an inline flash,
   not a modal, unlike the older debug button).
5. Failure (either step, or `html2canvas` throwing on a capture it can't
   handle): the icon flashes an error state briefly instead, message in
   `title`.

## Out of scope (v1)

- A region/window picker — always the whole app.
- Annotating/editing the screenshot before it's saved.
- Any web-preview behavior — the button doesn't render there at all.
- Multi-monitor / partner-window capture — this captures the main window's
  own DOM only, whichever window the button lives in.

## Testing

- Core: `screenshot_filename` — exact output for `0` (`1970-01-01_00-00-00`)
  and a handful of known unix-ms timestamps spanning a month/year
  boundary, confirming `civil_from_days` is correct at the edges (last day
  of a leap year, first day of a new year).
- UI: no new component test for the capture path itself — `html2canvas`
  and `navigator.clipboard.write` don't run meaningfully under jsdom (same
  reason this codebase has never tested `isTauri()`-gated
  file/clipboard/dialog code, e.g. the pre-existing "Add a document…"
  button). `StatusBar.tsx`'s existing tests (if any) stay green; the
  button itself gets a light "renders only when isTauri()" style check if
  the existing test file already covers that pattern for its neighbors.
- **Not verified by this session**: the actual on-device behavior (capture
  quality, clipboard-paste round-trip, file lands in the right folder) —
  there's no Windows/macOS runtime available here. Owner verification
  needed after a real rebuild, same as every Rust-shell change this
  session.

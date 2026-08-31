//! Splash window — a small, branded, always-on-top window shown the instant
//! the process starts, covering the gap between launch and the main window
//! actually having something real to show (backend `setup()` + the
//! frontend's first `init()` round-trip). Not a stand-in for the existing
//! first-run experience: whisper model downloads happen lazily on the first
//! *session* start and are already covered by `PreparingOverlay` inside the
//! main window — this window's job ends well before that.
//!
//! Same shared-bundle convention as the partner/HUD windows: the UI branches
//! on `?splash=1` (see `src/main.tsx`) rather than shipping a second HTML
//! file, so there is exactly one frontend build.
//!
//! Lifecycle: [`open`] is called synchronously from the app builder's
//! `setup()` hook — first thing, before any of the rest of `setup()` runs.
//! This is NOT the same context as the Windows `WebviewWindowBuilder::build()`
//! deadlock documented on `partner::open` (that's specific to a *synchronous
//! command's* WebView2 IPC callback thread); `setup()` builds its own
//! windows directly and is Tauri's own documented splash-screen pattern.
//! [`finish`] only shows/closes already-built windows (no `build()` call),
//! so it stays a plain sync fn like `partner::close`.

use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

use conva_core::ipc::{events, SplashProgressEvent};

pub const SPLASH_LABEL: &str = "splash";

/// Matches the splash art's ~1.616:1 aspect (2624×1624 source, shipped at 2x
/// as `src/assets/splash.png` for HiDPI). Fixed size — this window is on
/// screen for well under a second in the common case, not worth making
/// resizable.
const SPLASH_WIDTH: f64 = 640.0;
const SPLASH_HEIGHT: f64 = 396.0;

/// Show the splash window. The main window is created hidden (see
/// `tauri.conf.json`'s `"visible": false`), so this is the only thing on
/// screen until [`finish`] runs.
pub fn open(app: &AppHandle) -> Result<(), String> {
    WebviewWindowBuilder::new(
        app,
        SPLASH_LABEL,
        WebviewUrl::App("index.html?splash=1".into()),
    )
    .title("conva")
    .inner_size(SPLASH_WIDTH, SPLASH_HEIGHT)
    .resizable(false)
    .decorations(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .center()
    .build()
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Emit one boot-progress stage to every window (the splash is the only one
/// listening — see `SplashScreen.tsx` — but events are cheap and this keeps
/// the call sites in `setup()` simple).
pub fn progress(app: &AppHandle, stage: SplashProgressEvent) {
    let _ = app.emit(events::SPLASH_PROGRESS, stage);
}

/// Show the (now-ready) main window and close the splash. Idempotent —
/// safe to call more than once (e.g. a slow/duplicate `finish_splash`
/// invocation from the frontend) since both operations are no-ops on an
/// already-shown/already-closed window.
pub fn finish(app: &AppHandle) -> Result<(), String> {
    if let Some(main) = app.get_webview_window("main") {
        main.show().map_err(|e| e.to_string())?;
        let _ = main.set_focus();
    }
    if let Some(splash) = app.get_webview_window(SPLASH_LABEL) {
        splash.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

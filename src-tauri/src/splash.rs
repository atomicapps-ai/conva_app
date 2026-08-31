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
//! [`finish`] only shows/closes already-built windows (no `build()` call).
//!
//! ⚠️ `setup()` itself must stay CHEAP. Tauri calls the setup hook from
//! inside the event loop's very first callback (`RuntimeRunEvent::Ready` in
//! tauri's `make_run_event_loop_callback`, app.rs) — the loop pumps nothing
//! until it returns. Blocking there means no window paints (this one
//! included, its `build()` notwithstanding), and on Windows WebView2 cannot
//! even finish initializing, since its creation callbacks arrive via the
//! stalled message pump. That was the "splash stays black, then everything
//! appears at once right before it closes" bug: the slow boot work now runs
//! on the `boot` thread (see `lib.rs`), and [`BootGate`] carries its
//! progress + completion signal.

use std::sync::{Arc, Condvar, Mutex};
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

use conva_core::ipc::{events, SplashProgressEvent};

/// Shared boot-sequence state, managed in `setup()` before any webview can
/// run JS. Two jobs: remember the latest progress stage so the splash's
/// `splash_status` snapshot can seed its bar (events emitted before its
/// listener registered would otherwise be lost), and let `finish_splash`
/// block until the boot thread is done, so the main window never shows a
/// half-loaded workspace.
#[derive(Clone)]
pub struct BootGate {
    inner: Arc<BootGateInner>,
}

struct BootGateInner {
    /// (latest progress stage, boot thread finished)
    state: Mutex<(SplashProgressEvent, bool)>,
    cv: Condvar,
}

impl BootGate {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(BootGateInner {
                state: Mutex::new((SplashProgressEvent::Started { percent: 0 }, false)),
                cv: Condvar::new(),
            }),
        }
    }

    fn record(&self, stage: SplashProgressEvent) {
        self.inner.state.lock().expect("boot gate lock").0 = stage;
    }

    /// The latest recorded stage (the `splash_status` snapshot).
    pub fn last(&self) -> SplashProgressEvent {
        self.inner.state.lock().expect("boot gate lock").0
    }

    /// Boot thread is done; release every `wait_ready` caller.
    pub fn set_ready(&self) {
        self.inner.state.lock().expect("boot gate lock").1 = true;
        self.inner.cv.notify_all();
    }

    /// Block until [`Self::set_ready`], or `timeout`. Returns whether boot
    /// actually finished — callers fail OPEN on `false` (showing the app
    /// beats hanging on an uncloseable frameless splash forever).
    pub fn wait_ready(&self, timeout: Duration) -> bool {
        let guard = self.inner.state.lock().expect("boot gate lock");
        let (guard, result) = self
            .inner
            .cv
            .wait_timeout_while(guard, timeout, |(_, ready)| !*ready)
            .expect("boot gate lock");
        drop(guard);
        !result.timed_out()
    }
}

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
    // Debug builds only, same convention as partner.rs/hud.rs — lets a
    // dev right-click → Inspect this window to see console/network errors.
    // Genuinely needed here: this was the only window without it, which
    // left a real "why won't the image load" report undebuggable.
    .devtools(cfg!(debug_assertions))
    .build()
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Record one boot-progress stage on the [`BootGate`] and emit it to every
/// window (the splash is the only one listening — see `SplashScreen.tsx` —
/// but events are cheap and this keeps the boot-thread call sites simple).
pub fn progress(app: &AppHandle, stage: SplashProgressEvent) {
    if let Some(gate) = app.try_state::<BootGate>() {
        gate.record(stage);
    }
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

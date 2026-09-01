//! Branded startup window and durable startup coordination.
//!
//! `setup()` runs inside Tauri's first event-loop callback, so it must only
//! manage [`StartupState`], create this window, and dispatch slow work. Disk
//! and store initialization belongs on the named `startup` thread in `lib.rs`.

use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

use conva_core::ipc::{events, SplashProgressEvent};

#[derive(Debug, Clone, PartialEq, Eq)]
enum InitState {
    Initializing,
    Ready,
    Failed(String),
}

#[derive(Debug)]
struct StartupSnapshot {
    progress: SplashProgressEvent,
    state: InitState,
    not_before: Instant,
}

/// Small, `Send + Sync` state available before `AppState` exists. It retains
/// progress for late webview listeners and lets state-free commands wait for
/// the final `AppState` to be managed.
#[derive(Clone)]
pub struct StartupState {
    inner: Arc<(Mutex<StartupSnapshot>, Condvar)>,
}

impl StartupState {
    pub fn new() -> Self {
        Self::with_minimum_duration(Duration::from_millis(2250))
    }

    fn with_minimum_duration(minimum_duration: Duration) -> Self {
        Self {
            inner: Arc::new((
                Mutex::new(StartupSnapshot {
                    progress: SplashProgressEvent::Started { percent: 0 },
                    state: InitState::Initializing,
                    not_before: Instant::now() + minimum_duration,
                }),
                Condvar::new(),
            )),
        }
    }

    fn record(&self, progress: SplashProgressEvent) {
        self.inner
            .0
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .progress = progress;
    }

    pub fn progress(&self) -> SplashProgressEvent {
        self.inner
            .0
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .progress
            .clone()
    }

    pub fn ready(&self) {
        let mut snapshot = self.inner.0.lock().unwrap_or_else(|e| e.into_inner());
        snapshot.state = InitState::Ready;
        self.inner.1.notify_all();
    }

    pub fn mark_visible(&self) {
        let mut snapshot = self.inner.0.lock().unwrap_or_else(|e| e.into_inner());
        snapshot.not_before = Instant::now() + Duration::from_millis(2250);
    }

    pub fn fail(&self, error: String) -> SplashProgressEvent {
        let mut snapshot = self.inner.0.lock().unwrap_or_else(|e| e.into_inner());
        let progress = SplashProgressEvent::Failed {
            percent: snapshot.progress.percent(),
            message: error.clone(),
        };
        snapshot.progress = progress.clone();
        snapshot.state = InitState::Failed(error);
        self.inner.1.notify_all();
        progress
    }

    pub fn wait(&self) -> Result<(), String> {
        let mut snapshot = self.inner.0.lock().unwrap_or_else(|e| e.into_inner());
        while snapshot.state == InitState::Initializing {
            snapshot = self
                .inner
                .1
                .wait(snapshot)
                .unwrap_or_else(|e| e.into_inner());
        }
        match &snapshot.state {
            InitState::Ready => {
                let remaining = snapshot
                    .not_before
                    .saturating_duration_since(Instant::now());
                drop(snapshot);
                if !remaining.is_zero() {
                    std::thread::sleep(remaining);
                }
                Ok(())
            }
            InitState::Failed(error) => Err(error.clone()),
            InitState::Initializing => unreachable!(),
        }
    }
}

pub const SPLASH_LABEL: &str = "splash";
const SPLASH_WIDTH: f64 = 640.0;
const SPLASH_HEIGHT: f64 = 396.0;

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
    // WebView2 creates the native window before its document can paint. Keep
    // that empty surface hidden; SplashScreen's image onLoad calls `show`.
    .visible(false)
    .center()
    .devtools(cfg!(debug_assertions))
    .build()
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Reveal the splash only after React confirms its artwork is decoded. This
/// avoids exposing WebView2's blank native surface during navigation.
pub fn show(app: &AppHandle) -> Result<(), String> {
    app.state::<StartupState>().mark_visible();
    if let Some(splash) = app.get_webview_window(SPLASH_LABEL) {
        splash.show().map_err(|e| e.to_string())?;
        let _ = splash.set_focus();
    }
    Ok(())
}

/// Update the durable snapshot before emitting the non-durable event.
pub fn progress(app: &AppHandle, progress: SplashProgressEvent) {
    if let Some(startup) = app.try_state::<StartupState>() {
        startup.record(progress.clone());
    }
    let _ = app.emit(events::SPLASH_PROGRESS, progress);
}

/// Record and broadcast a terminal startup failure.
pub fn fail(app: &AppHandle, error: String) {
    if let Some(startup) = app.try_state::<StartupState>() {
        let progress = startup.fail(error);
        let _ = app.emit(events::SPLASH_PROGRESS, progress);
    }
}

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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn retains_latest_progress_for_late_listeners() {
        let startup = StartupState::with_minimum_duration(Duration::ZERO);
        startup.record(SplashProgressEvent::WorkspaceReady { percent: 60 });
        assert_eq!(startup.progress().percent(), 60);
    }

    #[test]
    fn wait_reports_startup_failure() {
        let startup = StartupState::with_minimum_duration(Duration::ZERO);
        startup.fail("library could not be opened".into());
        assert_eq!(startup.wait(), Err("library could not be opened".into()));
    }

    #[test]
    fn wait_releases_after_ready() {
        let startup = StartupState::with_minimum_duration(Duration::ZERO);
        startup.ready();
        assert_eq!(startup.wait(), Ok(()));
    }
}

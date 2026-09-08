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
/// Give the splash time to present Ready (220 ms), visibly fill to 100%
/// (200 ms), and hold the completed state long enough to be read (500 ms).
/// The main window is revealed just before the splash begins fading so it is
/// already painted underneath the transparent native surface.
const READY_BEFORE_REVEAL: Duration = Duration::from_millis(900);
/// Keep the always-on-top splash alive through its 200 ms opacity transition,
/// which reveals the already-rendered main window underneath it.
const CROSSFADE_DURATION: Duration = Duration::from_millis(300);

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
    // The rendered splash remains opaque until its final CSS fade. A
    // transparent native surface lets that fade reveal the initialized main
    // window underneath instead of fading only to the webview's dark body.
    .transparent(true)
    .shadow(false)
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

pub async fn finish(app: &AppHandle) -> Result<(), String> {
    // `finish` is invoked only after the main window's init round-trip. This
    // is the real 100% milestone, not a timer-driven estimate.
    progress(app, SplashProgressEvent::Ready { percent: 100 });
    wait_without_blocking(READY_BEFORE_REVEAL).await?;
    let Some(main) = app.get_webview_window("main") else {
        let message = "The main window was not created".to_owned();
        fail(app, message.clone());
        return Err(message);
    };
    if let Err(error) = main.show() {
        let message = format!("Could not reveal the main window: {error}");
        fail(app, message.clone());
        return Err(message);
    }
    let _ = main.set_focus();
    wait_without_blocking(CROSSFADE_DURATION).await?;
    if let Some(splash) = app.get_webview_window(SPLASH_LABEL) {
        splash.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

async fn wait_without_blocking(duration: Duration) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || std::thread::sleep(duration))
        .await
        .map_err(|error| error.to_string())
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

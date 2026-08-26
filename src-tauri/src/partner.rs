//! Partner window — a normal, resizable OS window that gives one term (or any
//! Ally answer) a large reading surface OUTSIDE the app window (owner mockup,
//! 2026-08-21: "Live Cockpit Tabs" canvas). Unlike the HUD it is an ordinary
//! focusable window: it participates in the taskbar/Alt-Tab, can be dragged by
//! its custom title bar and resized on any edge, and simply overlaps whatever
//! is beneath it. It defaults DOCKED flush to the main window's right edge at
//! the main window's height; `redock` snaps it back there.
//! Locked to the app by default (spec §4.4): while locked it follows the
//! main window (position only — the user's size sticks); dragging it
//! releases the lock; the title-bar toggle re-locks it.
//!
//! Payload handoff: window creation and webview boot race, so the term payload
//! is never passed in the URL. `open` stashes it in a module `Mutex`; the
//! partner view reads it with the `get_partner_payload` command on mount, and
//! an already-open window is updated via `events::PARTNER_TERM` instead of
//! being rebuilt (no flicker, keeps the user's size/position).
//!
//! Threading: `open` builds the webview here but is called from the `async`
//! `open_partner` command in `lib.rs` — NOT the main thread. On Windows,
//! `WebviewWindowBuilder::build()` deadlocks when invoked synchronously
//! (from the main thread, inside the IPC callback that dispatches a sync
//! command); dispatching it from an async command's worker thread instead
//! is the documented fix (see #82, and the comment on `open` below — this
//! was the actual cause of the blank-partner-window bug, now resolved).
//! Native window/handle mutation still ends up on the main thread
//! internally — `build()` (and `show`/`close`/etc.) marshal there
//! themselves — the point is only that *this* code must not already be
//! running on it.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use conva_core::ipc::{events, PartnerLockEvent, PartnerPayload};
use tauri::{AppHandle, Emitter, LogicalPosition, Manager, WebviewUrl, WebviewWindowBuilder};

/// The dedicated window label; the UI bundle branches on `?partner=1`
/// (see `src/main.tsx`) so both windows share one front-end build.
pub const PARTNER_LABEL: &str = "partner";

/// Default (and re-dock) width, logical px — matches the approved mockup.
const PARTNER_WIDTH: f64 = 430.0;

static PAYLOAD: Mutex<Option<PartnerPayload>> = Mutex::new(None);

/// Lock-to-app (spec §4.4): while true, the partner window follows the main
/// window flush at its right edge, keeping its own user-set size. Default on
/// for every app run.
static LOCKED: AtomicBool = AtomicBool::new(true);

/// The last position WE set (physical px). A partner `Moved` event matching
/// it (±2px for DPI rounding) is our own follow/snap echoing back — anything
/// else while locked is a user drag, which releases the lock.
static PROGRAMMATIC_POS: Mutex<Option<(i32, i32)>> = Mutex::new(None);

pub fn locked() -> bool {
    LOCKED.load(Ordering::SeqCst)
}

/// Set the lock state. Turning it ON also snaps the window flush to the
/// main window's right edge (keeping its size) so "locked" is immediately
/// visibly true.
pub fn set_locked(app: &AppHandle, locked: bool) -> Result<(), String> {
    LOCKED.store(locked, Ordering::SeqCst);
    if locked {
        snap(app)?;
    }
    Ok(())
}

/// Move the (open) partner window flush to the main window's right edge,
/// KEEPING its current size — position-only, unlike the old full-height
/// re-dock. Records the target so the resulting `Moved` event is
/// recognized as programmatic.
fn snap(app: &AppHandle) -> Result<(), String> {
    let Some(win) = app.get_webview_window(PARTNER_LABEL) else {
        return Ok(());
    };
    if let Some((x, y, _h)) = dock_rect(app) {
        let scale = win.scale_factor().map_err(|e| e.to_string())?;
        *PROGRAMMATIC_POS.lock().unwrap() =
            Some(((x * scale).round() as i32, (y * scale).round() as i32));
        win.set_position(LogicalPosition::new(x, y))
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Main window moved or resized: drag the locked partner along. Called from
/// `lib.rs`'s `on_window_event` hook. No-op when unlocked or not open.
pub fn follow_main(app: &AppHandle) {
    if locked() {
        let _ = snap(app);
    }
}

/// The partner window reported a move to `pos` (physical px). Our own
/// programmatic snap → ignore. A user drag while locked → release the lock
/// and tell the window so its toggle icon updates.
pub fn on_partner_moved(app: &AppHandle, pos: (i32, i32)) {
    if !locked() {
        return;
    }
    if let Some((px, py)) = *PROGRAMMATIC_POS.lock().unwrap() {
        if (pos.0 - px).abs() <= 2 && (pos.1 - py).abs() <= 2 {
            return;
        }
    }
    LOCKED.store(false, Ordering::SeqCst);
    let _ = app.emit(events::PARTNER_LOCK, PartnerLockEvent { locked: false });
}

/// Open the partner window on `payload` — creating it docked to the main
/// window's right edge, or re-targeting an already-open window via the
/// `PARTNER_TERM` event (which keeps the user's chosen size/position).
pub fn open(app: &AppHandle, payload: PartnerPayload) -> Result<(), String> {
    *PAYLOAD.lock().unwrap() = Some(payload.clone());

    if let Some(win) = app.get_webview_window(PARTNER_LABEL) {
        win.show().map_err(|e| e.to_string())?;
        let _ = win.set_focus();
        let _ = app.emit(events::PARTNER_TERM, &payload);
        return Ok(());
    }

    // ROOT CAUSE FOUND & FIXED (2026-08-21 — see #82): `WebviewWindowBuilder
    // ::build()` deadlocks on Windows when called from a *synchronous* Tauri
    // command — a documented WRY/WebView2 limitation (confirmed against
    // tauri-apps/tauri#13963 and the official `WebviewWindowBuilder::new`
    // docs: "On Windows, this function deadlocks when used in a synchronous
    // command and event handlers... use async commands"). A sync command
    // runs directly on the main thread inside the WebView2 IPC callback;
    // `build()` internally posts the actual window/controller creation back
    // to "the main thread" and blocks waiting for it — which is the thread
    // it's already running on, so it can never unblock itself. The window
    // shell still got created (native HWND creation isn't gated the same
    // way), which is why title/size/position always looked correct — only
    // the WebView2 controller's async setup, stuck behind the deadlock,
    // never completed. Queuing the build via `run_on_main_thread` did NOT
    // fix it (tried first, before the real cause was known) because it's the
    // same self-deadlock relocated to a different tick, still running on the
    // main thread. The actual fix lives in the caller: `open_partner`
    // (lib.rs) is now `async fn`, which Tauri dispatches on a worker
    // thread — `build()` calling back into the (idle) main thread from there
    // is exactly the supported pattern. Verified live on Windows: both the
    // partner window and the HUD (same bug, same fix) now render correctly.
    let builder = WebviewWindowBuilder::new(
        app,
        PARTNER_LABEL,
        WebviewUrl::App("index.html?partner=1".into()),
    )
    .title("conva — Ally")
    .inner_size(PARTNER_WIDTH, 720.0)
    .min_inner_size(320.0, 360.0)
    // Frameless: the view draws its own title bar (drag region + re-dock/
    // close), same convention as the main window's custom chrome.
    .decorations(false)
    .resizable(true)
    // Debug builds only — never shipped in release (see the `devtools`
    // Cargo feature gate too).
    .devtools(cfg!(debug_assertions));

    let builder = match dock_rect(app) {
        Some((x, y, h)) => builder.position(x, y).inner_size(PARTNER_WIDTH, h),
        None => builder,
    };
    builder.build().map_err(|e| e.to_string())?;
    Ok(())
}

/// Snap the (open) partner window back flush to the main window's right
/// edge, keeping its current size, and focus it. A no-op when not open.
pub fn redock(app: &AppHandle) -> Result<(), String> {
    let Some(win) = app.get_webview_window(PARTNER_LABEL) else {
        return Ok(());
    };
    snap(app)?;
    win.show().map_err(|e| e.to_string())?;
    let _ = win.set_focus();
    Ok(())
}

/// Close and fully destroy the partner window. A no-op if it is not open.
pub fn close(app: &AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window(PARTNER_LABEL) {
        win.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// The most recent payload — what a freshly-booted partner view renders.
pub fn payload() -> Option<PartnerPayload> {
    PAYLOAD.lock().unwrap().clone()
}

/// The docked rect (logical px): flush to the main window's right edge, same
/// top and height. `None` when the main window can't be measured — the caller
/// then falls back to the builder's defaults.
fn dock_rect(app: &AppHandle) -> Option<(f64, f64, f64)> {
    let main = app.get_webview_window("main")?;
    let scale = main.scale_factor().ok()?;
    let pos = main.outer_position().ok()?;
    let size = main.outer_size().ok()?;
    Some((
        (pos.x as f64 + size.width as f64) / scale,
        pos.y as f64 / scale,
        size.height as f64 / scale,
    ))
}

//! Partner window — a normal, resizable OS window that gives one term (or any
//! Ally answer) a large reading surface OUTSIDE the app window (owner mockup,
//! 2026-08-21: "Live Cockpit Tabs" canvas). Unlike the HUD it is an ordinary
//! focusable window: it participates in the taskbar/Alt-Tab, can be dragged by
//! its custom title bar and resized on any edge, and simply overlaps whatever
//! is beneath it. It defaults DOCKED flush to the main window's right edge at
//! the main window's height; `redock` snaps it back there.
//!
//! Payload handoff: window creation and webview boot race, so the term payload
//! is never passed in the URL. `open` stashes it in a module `Mutex`; the
//! partner view reads it with the `get_partner_payload` command on mount, and
//! an already-open window is updated via `events::PARTNER_TERM` instead of
//! being rebuilt (no flicker, keeps the user's size/position).
//!
//! Threading: like `hud.rs`, every entry point runs on the main thread — the
//! `#[tauri::command]` wrappers in `lib.rs` are deliberately non-`async`.

use std::sync::Mutex;

use conva_core::ipc::{events, PartnerPayload};
use tauri::{
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, WebviewUrl, WebviewWindowBuilder,
};

/// The dedicated window label; the UI bundle branches on `?partner=1`
/// (see `src/main.tsx`) so both windows share one front-end build.
pub const PARTNER_LABEL: &str = "partner";

/// Default (and re-dock) width, logical px — matches the approved mockup.
const PARTNER_WIDTH: f64 = 430.0;

static PAYLOAD: Mutex<Option<PartnerPayload>> = Mutex::new(None);

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

    // KNOWN ISSUE (owner report, 2026-08-21 — still open): the partner window
    // opens at the right title/size/dock position but its content area stays
    // solid white forever — no paint, no input, not even a right-click
    // context menu with `.devtools(true)` wired up (below), across a
    // decorated *and* a frameless build. That rules out a JS/CSS crash (the
    // identical bundle, hit directly in a browser at the same dev-server URL
    // the app uses, renders correctly) and rules out the window itself
    // failing to construct (title/size/position are all correct — this is
    // Rust-level window creation succeeding). The WebView2 content control
    // for this second window appears to never attach at all. Root cause is
    // still unconfirmed; a live COM-apartment/threading conflict from this
    // app's other native Windows usage (cpal/WASAPI, whisper GPU) on the
    // main thread is the leading suspect, but unverified.
    //
    // `run_on_main_thread` below defers the actual build off the current
    // call stack — `open_partner` (lib.rs) is a synchronous
    // `#[tauri::command]`, so without this it runs nested inside the main
    // window's own webview dispatching the IPC call. That nesting is a
    // real hazard on its own (tried and kept as a hardening step), but it
    // did NOT resolve the blank-window symptom above when tested live.
    let app = app.clone();
    app.clone()
        .run_on_main_thread(move || {
            let builder = WebviewWindowBuilder::new(
                &app,
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

            let builder = match dock_rect(&app) {
                Some((x, y, h)) => builder.position(x, y).inner_size(PARTNER_WIDTH, h),
                None => builder,
            };
            if let Err(e) = builder.build() {
                eprintln!("[partner] failed to build window: {e}");
            }
        })
        .map_err(|e| e.to_string())
}

/// Snap the (open) partner window back flush to the main window's right edge,
/// full main-window height. A no-op when the window isn't open.
pub fn redock(app: &AppHandle) -> Result<(), String> {
    let Some(win) = app.get_webview_window(PARTNER_LABEL) else {
        return Ok(());
    };
    if let Some((x, y, h)) = dock_rect(app) {
        win.set_position(LogicalPosition::new(x, y))
            .map_err(|e| e.to_string())?;
        win.set_size(LogicalSize::new(PARTNER_WIDTH, h))
            .map_err(|e| e.to_string())?;
    }
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

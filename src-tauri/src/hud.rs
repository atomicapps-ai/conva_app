//! Floating HUD panel — a lightweight, always-on-top utility window that
//! renders on a floating layer, stays translucent, and does **not** steal
//! keyboard/mouse focus from the app the user is actually working in.
//!
//! Cross-platform behaviour is layered:
//!
//! * The **portable** attributes (top-most, borderless, transparent, off the
//!   taskbar, unfocused on creation) come from Tauri's own window builder, so
//!   they compile and behave the same everywhere.
//! * The **native** non-activating + floating-level behaviour that Tauri does
//!   not expose is applied per-OS in [`apply_native_panel_style`]:
//!   - **Windows:** `WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW` on the ex-style, then
//!     `SetWindowPos(HWND_TOPMOST, … SWP_NOACTIVATE)` — the panel floats on top
//!     and clicks never activate it, so focus stays with the active app.
//!   - **macOS:** floating window level, all-Spaces collection behaviour,
//!     `hidesOnDeactivate = false`, and the non-activating-panel style bit.
//!   - Any other target is a no-op — the portable attributes still apply.
//!
//! Lifecycle: the window is created lazily by [`open`] and fully destroyed by
//! [`close`] (`WebviewWindow::close` tears down the webview and frees its
//! resources — we never merely hide it). Re-opening while it exists just shows
//! and re-pins the existing window rather than spawning a duplicate.
//!
//! Threading: [`open`] builds the webview here but must be called from an
//! `async` command (`open_hud`/`toggle_hud` in `lib.rs`), NOT the main
//! thread. `WebviewWindowBuilder::build()` deadlocks on Windows when called
//! synchronously — see the detailed comment on `partner::open` and #82 for
//! the full story (this was the cause of the HUD sharing the blank-window
//! bug; fixed the same way, verified live). `close`/`is_open` don't build a
//! window and stay sync.

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

/// The dedicated window label. The UI bundle branches on the matching
/// `?hud=1` query (see `src/main.tsx`) to render the HUD view instead of the
/// full Studio shell, so both share one front-end build.
pub const HUD_LABEL: &str = "hud";

/// Open the HUD, or re-pin it if it is already open. Never steals focus.
pub fn open(app: &AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window(HUD_LABEL) {
        // Already live — surface it and re-assert the native panel style
        // (a display change or DPI move can drop the top-most ordering).
        win.show().map_err(|e| e.to_string())?;
        apply_native_panel_style(&win);
        return Ok(());
    }

    let win = WebviewWindowBuilder::new(app, HUD_LABEL, WebviewUrl::App("index.html?hud=1".into()))
        .title("conva HUD")
        .inner_size(360.0, 260.0)
        .min_inner_size(220.0, 120.0)
        .position(80.0, 80.0)
        // Borderless + transparent so the rounded, alpha-blended panel drawn by
        // the webview is the whole window; no OS chrome around it.
        .decorations(false)
        .transparent(true)
        // Float above ordinary windows and keep it off the taskbar / Alt-Tab as
        // a utility surface (a normal HUD convention — not capture evasion).
        .always_on_top(true)
        .skip_taskbar(true)
        .shadow(false)
        .resizable(true)
        // Do not take focus when it appears — the whole point of the panel.
        .focused(false)
        // Debug builds only — see the matching comment in `partner.rs`.
        .devtools(cfg!(debug_assertions))
        .build()
        .map_err(|e| e.to_string())?;

    apply_native_panel_style(&win);
    Ok(())
}

/// Close and fully destroy the HUD window (frees the webview + native handle).
/// A no-op if it is not open.
pub fn close(app: &AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window(HUD_LABEL) {
        win.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Whether the HUD window currently exists.
pub fn is_open(app: &AppHandle) -> bool {
    app.get_webview_window(HUD_LABEL).is_some()
}

/// Flip the HUD open/closed. Returns the new state (`true` = now open).
pub fn toggle(app: &AppHandle) -> Result<bool, String> {
    if is_open(app) {
        close(app)?;
        Ok(false)
    } else {
        open(app)?;
        Ok(true)
    }
}

// ---------------------------------------------------------------------------
// Native, non-activating floating-panel behaviour (per-OS).
// ---------------------------------------------------------------------------

/// Windows: mark the window non-activating + tool-window and pin it top-most
/// without activating it, so clicking the HUD never pulls focus off the active
/// application.
#[cfg(target_os = "windows")]
fn apply_native_panel_style(window: &WebviewWindow) {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{
        GetWindowLongPtrW, SetWindowLongPtrW, SetWindowPos, GWL_EXSTYLE, HWND_TOPMOST,
        SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, WS_EX_NOACTIVATE,
        WS_EX_TOOLWINDOW,
    };

    let hwnd: HWND = match window.hwnd() {
        Ok(h) => h,
        Err(e) => {
            eprintln!("[hud] no HWND, skipping native panel style: {e}");
            return;
        }
    };

    // SAFETY: `hwnd` is a live top-level window handle owned by this process for
    // the lifetime of the call; all three calls are the documented Win32 way to
    // adjust extended styles and z-order.
    unsafe {
        let ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        let ex = ex | (WS_EX_NOACTIVATE.0 as isize) | (WS_EX_TOOLWINDOW.0 as isize);
        SetWindowLongPtrW(hwnd, GWL_EXSTYLE, ex);

        // SWP_NOACTIVATE: apply the new style + top-most ordering without ever
        // giving the HUD the foreground.
        let _ = SetWindowPos(
            hwnd,
            Some(HWND_TOPMOST),
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_FRAMECHANGED,
        );
    }
}

/// macOS: raise the panel to the floating window level, let it join all Spaces,
/// keep it visible when the app deactivates, and set the non-activating-panel
/// style bit. Driven through the Objective-C runtime so it does not depend on a
/// specific `objc2-app-kit` binding surface.
///
/// NOTE: a plain `NSWindow` with the non-activating style bit is *best effort* —
/// a fully guaranteed non-activating panel needs the window to be an `NSPanel`
/// subclass (e.g. via the `tauri-nspanel` plugin). Combined with the floating
/// level, `hidesOnDeactivate = false`, and `focused(false)` at creation, this is
/// enough for the HUD to stay out of the focus path in practice; the NSPanel
/// swizzle is the follow-up if we ever see it grab key on click.
#[cfg(target_os = "macos")]
fn apply_native_panel_style(window: &WebviewWindow) {
    use objc2::msg_send;
    use objc2::runtime::AnyObject;

    let ptr = match window.ns_window() {
        Ok(p) => p as *mut AnyObject,
        Err(e) => {
            eprintln!("[hud] no NSWindow, skipping native panel style: {e}");
            return;
        }
    };
    if ptr.is_null() {
        return;
    }

    // AppKit constants (AppKit is not linked as typed bindings here):
    //   NSFloatingWindowLevel                       = 3
    //   NSWindowCollectionBehaviorCanJoinAllSpaces  = 1 << 0
    //   NSWindowCollectionBehaviorIgnoresCycle      = 1 << 6
    //   NSWindowCollectionBehaviorFullScreenAuxiliary = 1 << 8
    //   NSWindowStyleMaskNonactivatingPanel         = 1 << 7
    const FLOATING_LEVEL: isize = 3;
    const CAN_JOIN_ALL_SPACES: usize = 1 << 0;
    const IGNORES_CYCLE: usize = 1 << 6;
    const FULL_SCREEN_AUX: usize = 1 << 8;
    const NONACTIVATING_PANEL: usize = 1 << 7;

    // SAFETY: `ptr` is the app's live NSWindow for this webview; each selector is
    // a standard AppKit setter/getter with the shown signature.
    unsafe {
        let _: () = msg_send![ptr, setLevel: FLOATING_LEVEL];
        let behavior: usize = CAN_JOIN_ALL_SPACES | IGNORES_CYCLE | FULL_SCREEN_AUX;
        let _: () = msg_send![ptr, setCollectionBehavior: behavior];
        let _: () = msg_send![ptr, setHidesOnDeactivate: false];
        let mask: usize = msg_send![ptr, styleMask];
        let _: () = msg_send![ptr, setStyleMask: mask | NONACTIVATING_PANEL];
    }
}

/// Every other target: the portable builder attributes (top-most, transparent,
/// unfocused) already applied in [`open`] are the whole story.
#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn apply_native_panel_style(_window: &WebviewWindow) {}

import { useEffect, useState, type MouseEvent } from "react";
import { createPortal } from "react-dom";

import { Icon } from "@/components/ui/Icon";
import { useBackend, type ConvaBackend } from "@/lib/backend";
import { BUILD, collectDebugReport } from "@/lib/debug";
import { isTauri } from "@/lib/ipc";
import { blobToBase64, captureScreenshot } from "@/lib/screenshot";
import { useAppStore } from "@/state/app";
import { useConversationStore } from "@/state/conversation";
import { useDevMode } from "@/state/devMode";

/**
 * Thin ambient status strip (~26px) along the window foot. Read-only signals
 * that don't belong in the top action bar: the privacy posture, the speech
 * engine, and autosave state. Latency HUD and, later, credits/account surface
 * here too as those land (kept out until they carry real values).
 */
function Sep() {
  return <span className="h-3 w-px bg-border" aria-hidden />;
}

/** Copy a diagnostics snapshot to the clipboard and, in the app, write it to a
 *  log file too — so "it didn't work" comes with real, shareable data. */
async function dumpDebug(backend: ConvaBackend) {
  const report = collectDebugReport();
  try {
    await navigator.clipboard.writeText(report);
  } catch {
    /* clipboard may be blocked; the file write below is the fallback */
  }
  if (isTauri()) {
    try {
      const path = await backend.diagnostics.saveDebugLog(report);
      window.alert(`Debug report copied to clipboard and saved to:\n${path}`);
      return;
    } catch (e) {
      window.alert(`Debug report copied. (Saving a file failed: ${String(e)})`);
      return;
    }
  }
  window.alert("Debug report copied to clipboard.");
}

type ScreenshotResult =
  | { ok: true; path: string; pos: { x: number; y: number } }
  | { ok: false; message: string; pos: { x: number; y: number } };

/**
 * Whole-app-window screenshot: capture the `#root` DOM (`captureScreenshot`,
 * `src/lib/screenshot.ts`), copy it to the clipboard (best-effort), and save
 * a timestamped PNG under the current save folder (default
 * `<Pictures>/conva-screenshots/`, right-click → "Set save location…").
 * Desktop-only — `isTauri()` gate, same as every other filesystem-touching
 * StatusBar affordance.
 *
 * Confirms with a camera-style white flash (`.animate-screenshot-flash`,
 * `globals.css`) fired the instant capture completes — never before or
 * during, or the flash overlay itself would get baked into the captured
 * image — followed by a small popover naming where it saved (or, on
 * failure, the actual error: also recorded into `useAppStore`'s
 * `lastError` so it shows up in the "debug ⧉" report even if the popover
 * is missed). Right-click opens a menu (same open/close-on-outside-{click,
 * resize,scroll} shape as `LibraryRowMenu`/`ContextInfoPopover`) for
 * setting a custom save folder or revealing the current one. See
 * `docs/superpowers/specs/2026-08-30-screenshot-button-design.md`.
 */
function ScreenshotButton() {
  const backend = useBackend();
  const [busy, setBusy] = useState(false);
  const [flashWhite, setFlashWhite] = useState(false);
  const [result, setResult] = useState<ScreenshotResult | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!result && !menu) return;
    const close = () => {
      setResult(null);
      setMenu(null);
    };
    window.addEventListener("click", close);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [result, menu]);

  if (!isTauri()) return null;

  const take = async (e: MouseEvent<HTMLButtonElement>) => {
    if (busy) return;
    setBusy(true);
    setResult(null);
    const r = e.currentTarget.getBoundingClientRect();
    const pos = { x: r.left, y: r.bottom + 4 };
    // Reaches the terminal `npm run tauri:gpu` was launched from (desktop)
    // or the browser console (web) — see `screenshot_trace`'s doc comment
    // in `lib.rs`. Fire-and-forget: a trace call itself must never be able
    // to fail the capture it's trying to diagnose.
    const trace = (msg: string) => void backend.diagnostics.trace(`screenshot: ${msg}`).catch(() => {});
    trace("button clicked");
    try {
      const blob = await captureScreenshot(trace);
      // The flash fires the instant we have pixels — matches a real
      // camera (the flash fires with the shutter, not before it), and
      // guarantees the overlay can never appear inside the captured image.
      setFlashWhite(true);
      setTimeout(() => setFlashWhite(false), 260);
      try {
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
        trace("clipboard:done");
      } catch (clipErr) {
        // best-effort — the file save below is what actually matters
        trace(`clipboard:failed (non-fatal): ${String(clipErr)}`);
      }
      const base64 = await blobToBase64(blob);
      trace("base64:done");
      const path = await backend.screenshot.save(base64);
      trace(`save:done -> ${path}`);
      setResult({ ok: true, path, pos });
    } catch (err) {
      const message = String(err).replace(/^Error:\s*/, "");
      // eslint-disable-next-line no-console
      console.error("[conva] screenshot failed:", err);
      trace(`failed: ${message}`);
      useAppStore.setState({ lastError: message });
      setResult({ ok: false, message, pos });
    } finally {
      setBusy(false);
    }
  };

  const openMenu = (e: MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    setResult(null);
    const r = e.currentTarget.getBoundingClientRect();
    const MARGIN = 8;
    const MENU_W = 200;
    const x = Math.max(MARGIN, Math.min(r.right - MENU_W, window.innerWidth - MENU_W - MARGIN));
    setMenu((m) => (m ? null : { x, y: r.top - 4 }));
  };

  const setSaveLocation = async () => {
    setMenu(null);
    const { open } = await import("@tauri-apps/plugin-dialog");
    const current = await backend.screenshot.dir().catch(() => undefined);
    const picked = await open({ directory: true, defaultPath: current });
    const dir = Array.isArray(picked) ? picked[0] : picked;
    if (!dir) return;
    const config = await backend.config.get();
    await backend.config.save({ ...config, screenshot_save_dir: dir });
  };

  return (
    <>
      <span className="relative shrink-0">
        <button
          type="button"
          disabled={busy}
          onClick={(e) => void take(e)}
          onContextMenu={openMenu}
          title={busy ? "Capturing…" : "Screenshot the app window (clipboard + file) — right-click for options"}
          aria-label={busy ? "Capturing a screenshot" : "Take a screenshot"}
          aria-haspopup="menu"
          aria-expanded={menu !== null}
          className="flex items-center rounded px-1 py-0.5 text-fg-faint transition hover:bg-white/[0.06] hover:text-fg"
        >
          {/* animate-pulse — a click must never look like it did nothing.
              Capture can legitimately take a couple of seconds (walking
              every element to fix up colors html2canvas can't parse, see
              screenshot.ts); before this the button gave zero feedback
              between click and the result popover, which read as "broken"
              on its own even when the capture was actually still running. */}
          <Icon name="camera" size={12} className={busy ? "animate-pulse" : undefined} />
        </button>

        {result && (
          <div
            role="status"
            onClick={(e) => e.stopPropagation()}
            style={{ position: "fixed", left: result.pos.x, top: result.pos.y, zIndex: 60 }}
            className="glass-raised max-w-[280px] rounded-lg border border-border p-2 text-[11px] shadow-[var(--shadow-lg)]"
          >
            {result.ok ? (
              <>
                <p className="flex items-center gap-1 font-semibold text-ok">
                  <Icon name="check" size={11} />
                  Saved
                </p>
                <p className="mt-0.5 break-all text-fg-faint">{result.path}</p>
              </>
            ) : (
              <>
                <p className="flex items-center gap-1 font-semibold text-rec">
                  <Icon name="close" size={11} />
                  Screenshot failed
                </p>
                <p className="mt-0.5 break-all text-fg-faint">{result.message}</p>
              </>
            )}
          </div>
        )}

        {menu && (
          <div
            role="menu"
            aria-label="Screenshot options"
            onClick={(e) => e.stopPropagation()}
            style={{
              position: "fixed",
              left: menu.x,
              top: menu.y,
              transform: "translateY(-100%)",
              zIndex: 60,
            }}
            className="glass-raised min-w-[190px] rounded-lg border border-border p-1 shadow-[var(--shadow-lg)]"
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => void setSaveLocation()}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[12px] text-fg transition hover:bg-white/[0.06]"
            >
              Set save location…
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenu(null);
                void backend.screenshot.openFolder();
              }}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[12px] text-fg transition hover:bg-white/[0.06]"
            >
              Open screenshots folder
            </button>
          </div>
        )}
      </span>

      {flashWhite &&
        createPortal(
          <div
            aria-hidden
            className="animate-screenshot-flash pointer-events-none fixed inset-0 z-[9999] bg-white"
          />,
          document.body,
        )}
    </>
  );
}

export function StatusBar() {
  const backend = useBackend();
  const config = useAppStore((s) => s.config);
  const title = useConversationStore((s) => s.title);
  const cloud = config?.asr_engine === "deepgram_cloud";
  const debugChromeVisible = useDevMode((s) => s.debugChromeVisible);
  const toggleDebugChrome = useDevMode((s) => s.toggleDebugChrome);

  return (
    <footer
      // Flush background-step footer, not a floating `.glass` card — V4.0's
      // own rule is elevation (blur/shadow) only where something actually
      // floats over content; in the flow of the screen, depth is a
      // background step (bg → bg-2 → panel), not a drop shadow. Also keeps
      // it flush with the continuous rail+pane frame above it (no gap).
      className="flex h-[22px] shrink-0 items-center gap-3 border-t border-border bg-bg-2 px-4 text-[11px] text-fg-faint"
      aria-label="Status"
    >
      <span className="flex items-center gap-1.5 text-ok" title="Audio and transcripts stay on this device">
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
        >
          <rect x="5" y="11" width="14" height="9" rx="2" />
          <path d="M8 11V8a4 4 0 0 1 8 0v3" />
        </svg>
        On-device · Private
      </span>

      {config && (
        <>
          <Sep />
          <span className="flex items-center gap-1.5">
            <span
              className={`h-1.5 w-1.5 rounded-full ${cloud ? "bg-ai" : "bg-ok"}`}
            />
            {cloud ? "Cloud · Deepgram" : "Local · whisper"}
          </span>
        </>
      )}

      {title && (
        <>
          <Sep />
          <span className="min-w-0 max-w-[20rem] truncate">Saved · {title}</span>
        </>
      )}

      {/* Right side: build stamp + one-click diagnostics. */}
      <span className="ml-auto" />
      {!isTauri() && <span className="text-fg-faint">preview</span>}
      {import.meta.env.DEV && (
        <button
          type="button"
          onClick={toggleDebugChrome}
          aria-pressed={debugChromeVisible}
          title={
            debugChromeVisible
              ? "Debug chrome visible — click to preview production (hides dev-only tools)"
              : "Debug chrome hidden (previewing production) — click to show dev-only tools"
          }
          aria-label={
            debugChromeVisible ? "Hide debug chrome" : "Show debug chrome"
          }
          className={`rounded px-1 py-0.5 transition hover:bg-white/[0.06] ${
            debugChromeVisible ? "text-fg-faint hover:text-fg" : "text-ai"
          }`}
        >
          <Icon name={debugChromeVisible ? "eye" : "eyeOff"} size={12} />
        </button>
      )}
      <ScreenshotButton />
      <button
        type="button"
        onClick={() => void dumpDebug(backend)}
        title="Copy a diagnostics snapshot (and save a log file) for sharing"
        className="rounded px-1.5 py-0.5 font-mono text-[10px] text-fg-faint transition hover:bg-white/[0.06] hover:text-fg"
      >
        v{BUILD.version} · build {BUILD.sha} · debug ⧉
      </button>
    </footer>
  );
}

import { useState } from "react";

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

type ScreenshotFlash = "idle" | "busy" | "saved" | "error";

/**
 * Whole-app-window screenshot: capture the `#root` DOM (`captureScreenshot`,
 * `src/lib/screenshot.ts`), copy it to the clipboard (best-effort), and save
 * a timestamped PNG under `<app-data>/screenshots/`. Desktop-only —
 * `isTauri()` gate, same as every other filesystem-touching StatusBar
 * affordance — and confirms with an inline icon flash rather than a modal
 * (owner spec; unlike the older `dumpDebug` `window.alert` above). See
 * `docs/superpowers/specs/2026-08-30-screenshot-button-design.md`.
 */
function ScreenshotButton() {
  const backend = useBackend();
  const [flash, setFlash] = useState<ScreenshotFlash>("idle");

  if (!isTauri()) return null;

  const take = async () => {
    if (flash === "busy") return;
    setFlash("busy");
    try {
      const blob = await captureScreenshot();
      try {
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      } catch {
        /* best-effort — the clipboard write can fail independently of the
         * file save below, which is what actually matters. */
      }
      const base64 = await blobToBase64(blob);
      await backend.screenshot.save(base64);
      setFlash("saved");
    } catch {
      setFlash("error");
    } finally {
      setTimeout(() => setFlash("idle"), 1200);
    }
  };

  return (
    <button
      type="button"
      disabled={flash === "busy"}
      onClick={() => void take()}
      title={
        flash === "saved"
          ? "Saved to the screenshots folder and copied to the clipboard"
          : flash === "error"
            ? "Screenshot failed — try again"
            : "Screenshot the app window (clipboard + file)"
      }
      aria-label="Take a screenshot"
      className={`flex items-center rounded px-1 py-0.5 transition hover:bg-white/[0.06] ${
        flash === "saved"
          ? "text-ok"
          : flash === "error"
            ? "text-rec"
            : "text-fg-faint hover:text-fg"
      }`}
    >
      <Icon
        name={flash === "saved" ? "check" : flash === "error" ? "close" : "camera"}
        size={12}
      />
    </button>
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

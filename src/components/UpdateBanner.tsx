import { useEffect, useState } from "react";

import { isTauri } from "@/lib/ipc";

type UpdateState =
  | { phase: "idle" }
  | { phase: "available"; version: string }
  | { phase: "installing" }
  | { phase: "error"; message: string };

/**
 * Auto-update flow: check the release feed shortly after startup; when a
 * newer version exists, show a slim banner with a one-click
 * download-install-relaunch. Never interrupts a live session on its own —
 * the user chooses when to restart. All failures are silent-but-visible
 * (banner shows the error; the app keeps working).
 */
export function UpdateBanner() {
  const [state, setState] = useState<UpdateState>({ phase: "idle" });

  useEffect(() => {
    if (!isTauri()) return;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const { check } = await import("@tauri-apps/plugin-updater");
          const update = await check();
          if (update) {
            setState({ phase: "available", version: update.version });
          }
        } catch {
          // No release feed yet / offline / unsigned dev build — stay quiet.
        }
      })();
    }, 5_000);
    return () => clearTimeout(timer);
  }, []);

  if (state.phase === "idle") return null;

  const install = async () => {
    setState({ phase: "installing" });
    try {
      const [{ check }, { relaunch }] = await Promise.all([
        import("@tauri-apps/plugin-updater"),
        import("@tauri-apps/plugin-process"),
      ]);
      const update = await check();
      if (!update) {
        setState({ phase: "idle" });
        return;
      }
      await update.downloadAndInstall();
      await relaunch();
    } catch (e) {
      setState({ phase: "error", message: String(e) });
    }
  };

  return (
    <div
      className="flex shrink-0 items-center gap-3 border-b border-ai/40 bg-ai/10 px-4 py-1.5 text-xs"
      role="status"
    >
      {state.phase === "available" && (
        <>
          <span className="text-fg">
            Update available: conva {state.version}
          </span>
          <button
            type="button"
            onClick={() => void install()}
            className="rounded-md border border-ai/60 px-2.5 py-0.5 text-xs text-fg hover:bg-ai/10"
          >
            Update &amp; restart
          </button>
          <button
            type="button"
            onClick={() => setState({ phase: "idle" })}
            className="ml-auto text-fg-faint hover:text-fg"
            aria-label="Dismiss update notice"
          >
            Later
          </button>
        </>
      )}
      {state.phase === "installing" && (
        <span className="text-fg-muted">
          Downloading update… the app restarts when it&apos;s ready.
        </span>
      )}
      {state.phase === "error" && (
        <>
          <span className="text-rec">Update failed: {state.message}</span>
          <button
            type="button"
            onClick={() => setState({ phase: "idle" })}
            className="ml-auto text-fg-faint hover:text-fg"
          >
            Dismiss
          </button>
        </>
      )}
    </div>
  );
}

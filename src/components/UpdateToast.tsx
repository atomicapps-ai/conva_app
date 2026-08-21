import { useEffect, useRef, useState } from "react";

import { useCapabilities } from "@/lib/backend/context";
import { useNavStore } from "@/state/nav";

type Updater = {
  version: string;
  download: () => Promise<void>;
  install: () => Promise<void>;
};

type UpdateState =
  | { phase: "idle" }
  | { phase: "downloading"; version: string }
  | { phase: "ready"; version: string }
  | { phase: "installing"; version: string }
  | { phase: "error"; message: string };

/**
 * Auto-update flow (SDLC ops plan §5 — the "update ready" toast). Checks the
 * release feed shortly after startup; when a newer version exists, downloads it
 * in the background and then offers a bottom-right toast: Restart and install ·
 * Later · See what's new (→ the What's New view). Never interrupts a live
 * session on its own — the user chooses when to restart. Failures are
 * silent-but-visible (the toast shows the error; the app keeps working).
 * Desktop-only via `capabilities().system.updater`.
 */
export function UpdateToast({ checkDelayMs = 5_000 }: { checkDelayMs?: number }) {
  const caps = useCapabilities();
  const updaterSupported = caps?.system.updater === true;
  const setView = useNavStore((s) => s.setView);
  const [state, setState] = useState<UpdateState>({ phase: "idle" });
  const updateRef = useRef<Updater | null>(null);

  useEffect(() => {
    if (!updaterSupported) return;
    let live = true;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const { check } = await import("@tauri-apps/plugin-updater");
          const update = await check();
          if (!update || !live) return;
          updateRef.current = update;
          setState({ phase: "downloading", version: update.version });
          await update.download();
          if (live) setState({ phase: "ready", version: update.version });
        } catch {
          // No release feed yet / offline / unsigned dev build — stay quiet.
          if (live) setState({ phase: "idle" });
        }
      })();
    }, checkDelayMs);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [updaterSupported, checkDelayMs]);

  if (state.phase === "idle") return null;

  const install = async () => {
    const update = updateRef.current;
    if (!update) return;
    setState({ phase: "installing", version: update.version });
    try {
      await update.install();
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    } catch (e) {
      setState({ phase: "error", message: String(e) });
    }
  };

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-3 right-3 z-50 w-[22rem] max-w-[calc(100vw-1.5rem)] rounded-lg border border-border bg-panel-raised p-3.5 shadow-2xl"
    >
      {(state.phase === "downloading" ||
        state.phase === "ready" ||
        state.phase === "installing") && (
        <>
          <p className="text-sm font-semibold text-fg">
            {state.phase === "downloading"
              ? `Update available · conva v${state.version}`
              : `Update ready · conva v${state.version}`}
          </p>
          <p className="mt-1 text-xs text-fg-muted">
            {state.phase === "downloading" &&
              "Downloading in the background — you can keep working."}
            {state.phase === "ready" &&
              "A new version has been downloaded. Restart to install it now, or install it later."}
            {state.phase === "installing" &&
              "Installing… conva restarts when it's ready."}
          </p>
          <p className="mt-1.5 text-[11px] text-fg-faint">
            Beta builds are only supported on the latest version — please keep
            conva up to date.
          </p>
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={() => setView("releases")}
              className="text-xs text-primary underline-offset-2 hover:underline"
            >
              See what&apos;s new
            </button>
            <button
              type="button"
              onClick={() => setState({ phase: "idle" })}
              disabled={state.phase === "installing"}
              className="ml-auto rounded-md px-2.5 py-1 text-xs text-fg-faint hover:text-fg disabled:opacity-50"
            >
              Later
            </button>
            <button
              type="button"
              onClick={() => void install()}
              disabled={state.phase !== "ready"}
              className="rounded-md border border-primary/50 bg-primary/[0.14] px-2.5 py-1 text-xs font-semibold text-primary hover:bg-primary/25 disabled:opacity-50"
            >
              Restart and install
            </button>
          </div>
        </>
      )}
      {state.phase === "error" && (
        <>
          <p className="text-sm font-semibold text-rec">Update failed</p>
          <p className="mt-1 break-words text-xs text-fg-muted">{state.message}</p>
          <div className="mt-3 flex items-center justify-end">
            <button
              type="button"
              onClick={() => setState({ phase: "idle" })}
              className="rounded-md px-2.5 py-1 text-xs text-fg-faint hover:text-fg"
            >
              Dismiss
            </button>
          </div>
        </>
      )}
    </div>
  );
}

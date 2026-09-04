import { useCallback, useEffect, useRef, useState } from "react";

import { useCapabilities } from "@/lib/backend/context";
import { formatBytes } from "@/lib/formatBytes";
import { useTranscriptStore } from "@/state/transcript";
import { useUiPrefs } from "@/state/uiPrefs";

type DownloadProgressEvent =
  | { event: "Started"; data: { contentLength?: number } }
  | { event: "Progress"; data: { chunkLength: number } }
  | { event: "Finished" };

type Updater = {
  version: string;
  body?: string;
  download: (onEvent?: (event: DownloadProgressEvent) => void) => Promise<void>;
  install: () => Promise<void>;
};

type UpdateState =
  | { phase: "idle" }
  | {
      phase: "downloading";
      version: string;
      body?: string;
      downloaded: number;
      /** null until the "Started" event reports a content length (some hosts omit it). */
      total: number | null;
    }
  | { phase: "ready"; version: string; body?: string }
  | { phase: "installing"; version: string }
  | { phase: "error"; message: string };

/** First line (or ~140 chars) of the release notes — a preview, not the full changelog. */
function previewNotes(body: string | undefined): string | null {
  if (!body) return null;
  const firstLine = body.split("\n").find((l) => l.trim().length > 0) ?? body;
  return firstLine.length > 140 ? `${firstLine.slice(0, 139)}…` : firstLine;
}

/**
 * Auto-update flow (SDLC ops plan §5 — the "update ready" toast). Checks the
 * release feed shortly after startup and hourly — never blocking first render.
 * When a newer version exists, it immediately shows a bottom-right notice and
 * downloads in the background. By default the user chooses when to restart;
 * an explicit auto-install preference installs as soon as the download is
 * ready, but always waits for an active live session to finish. Release notes
 * expand inside the notice. An unreachable/offline release feed is never
 * surfaced to the user as an error — it's the expected steady state for most
 * checks — but is logged to the console in dev builds for diagnostics.
 * Desktop-only via `capabilities().system.updater`.
 */
export function UpdateToast({
  checkDelayMs = 5_000,
  checkIntervalMs = 60 * 60 * 1_000,
}: {
  checkDelayMs?: number;
  checkIntervalMs?: number;
}) {
  const caps = useCapabilities();
  const updaterSupported = caps?.system.updater === true;
  const autoInstall = useUiPrefs((s) => s.autoInstallUpdates);
  const sessionState = useTranscriptStore((s) => s.session.state);
  const [state, setState] = useState<UpdateState>({ phase: "idle" });
  const [notesExpanded, setNotesExpanded] = useState(false);
  const updateRef = useRef<Updater | null>(null);
  const checkRunningRef = useRef(false);
  const installStartedRef = useRef(false);

  const install = useCallback(async () => {
    const update = updateRef.current;
    if (!update || installStartedRef.current) return;
    installStartedRef.current = true;
    setState({ phase: "installing", version: update.version });
    try {
      await update.install();
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    } catch (e) {
      installStartedRef.current = false;
      setState({ phase: "error", message: String(e) });
    }
  }, []);

  useEffect(() => {
    if (!updaterSupported) return;
    let live = true;
    const checkForUpdate = () => {
      if (checkRunningRef.current || updateRef.current) return;
      checkRunningRef.current = true;
      void (async () => {
        try {
          const { check } = await import("@tauri-apps/plugin-updater");
          const update = await check();
          if (!update || !live) return;
          updateRef.current = update;
          setNotesExpanded(false);
          setState({
            phase: "downloading",
            version: update.version,
            body: update.body,
            downloaded: 0,
            total: null,
          });
          await update.download((event) => {
            if (!live) return;
            setState((prev) => {
              if (prev.phase !== "downloading") return prev;
              if (event.event === "Started") {
                return { ...prev, total: event.data.contentLength ?? null };
              }
              if (event.event === "Progress") {
                return { ...prev, downloaded: prev.downloaded + event.data.chunkLength };
              }
              return prev;
            });
          });
          if (live) setState({ phase: "ready", version: update.version, body: update.body });
        } catch (err) {
          // No release feed yet / offline / unsigned dev build — stay quiet
          // for the user; a dev build still wants the reason on the console.
          if (import.meta.env.DEV) {
            console.debug("[updater] check/download failed — staying quiet in the UI:", err);
          }
          if (live) setState({ phase: "idle" });
        } finally {
          checkRunningRef.current = false;
        }
      })();
    };
    const timer = setTimeout(checkForUpdate, checkDelayMs);
    const interval = setInterval(checkForUpdate, checkIntervalMs);
    return () => {
      live = false;
      clearTimeout(timer);
      clearInterval(interval);
    };
  }, [updaterSupported, checkDelayMs, checkIntervalMs]);

  useEffect(() => {
    if (autoInstall && state.phase === "ready" && sessionState !== "listening") {
      void install();
    }
  }, [autoInstall, install, sessionState, state.phase]);

  if (state.phase === "idle") return null;

  const notes =
    state.phase === "downloading" || state.phase === "ready" ? previewNotes(state.body) : null;
  const progressPct =
    state.phase === "downloading" && state.total
      ? Math.min(100, Math.round((state.downloaded / state.total) * 100))
      : null;

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
              (autoInstall && sessionState === "listening"
                ? "Ready to install automatically when your live session ends."
                : "A new version has been downloaded. Restart to install it now, or install it later.")}
            {state.phase === "installing" &&
              "Installing… conva restarts when it's ready."}
          </p>
          {state.phase === "downloading" && (
            <div className="mt-2">
              <div
                role="progressbar"
                aria-label="Update download progress"
                aria-valuenow={progressPct ?? undefined}
                aria-valuemin={0}
                aria-valuemax={100}
                className="h-1.5 w-full overflow-hidden rounded-full bg-border"
              >
                <div
                  className={
                    progressPct === null
                      ? "h-full w-1/3 animate-pulse rounded-full bg-primary/60"
                      : "h-full rounded-full bg-primary transition-[width]"
                  }
                  style={progressPct === null ? undefined : { width: `${progressPct}%` }}
                />
              </div>
              <p className="mt-1 text-[11px] text-fg-faint">
                {progressPct !== null
                  ? `${progressPct}% · ${formatBytes(state.downloaded)}`
                  : `${formatBytes(state.downloaded)} downloaded`}
              </p>
            </div>
          )}
          {notes && !notesExpanded && (
            <p className="mt-1.5 text-xs italic text-fg-muted">“{notes}”</p>
          )}
          {notesExpanded && state.phase !== "installing" && (
            <div className="mt-2 max-h-40 overflow-y-auto rounded-md border border-border bg-bg/50 p-2 text-xs whitespace-pre-wrap text-fg-muted">
              {state.body?.trim() || "Release notes unavailable."}
            </div>
          )}
          <p className="mt-1.5 text-[11px] text-fg-faint">
            Beta builds are only supported on the latest version — please keep
            conva up to date.
          </p>
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={() => setNotesExpanded((expanded) => !expanded)}
              className="text-xs text-primary underline-offset-2 hover:underline"
            >
              {notesExpanded ? "Hide release notes" : "Release notes"}
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

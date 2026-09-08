import { useEffect, useState } from "react";

import splashArt from "@/assets/brand/splash-screen.webp";
import { useBackend } from "@/lib/backend";
import {
  acknowledgeSplashReady,
  getSplashProgress,
  showSplash,
} from "@/lib/commands";
import { isTauri, type SplashProgressEvent } from "@/lib/ipc";

const STAGE_LABEL: Record<SplashProgressEvent["stage"], string> = {
  started: "Starting Conva…",
  library_loaded: "Library loaded",
  workspace_ready: "Workspace loaded",
  almost_ready: "Finishing startup…",
  ready: "Ready",
  failed: "Startup failed",
};

export const SPLASH_STEP_MS = 450;
export const SPLASH_FILL_TRANSITION_MS = 200;
export const SPLASH_READY_HOLD_MS = 650;
export const SPLASH_PROGRESS_POLL_MS = 100;

const PRESENTATION_STAGES: SplashProgressEvent[] = [
  { stage: "started", percent: 0 },
  { stage: "library_loaded", percent: 35 },
  { stage: "workspace_ready", percent: 60 },
  { stage: "almost_ready", percent: 85 },
  { stage: "ready", percent: 100 },
];

/** Replay only milestones the backend has already completed, one visible step
 * at a time. A fast boot can therefore remain truthful without first painting
 * at 85% and appearing frozen. */
export function nextPresentedSplashStage(
  presentedPercent: number,
  completedPercent: number,
): SplashProgressEvent | null {
  return (
    PRESENTATION_STAGES.find(
      (stage) =>
        stage.percent > presentedPercent && stage.percent <= completedPercent,
    ) ?? null
  );
}

/**
 * The `splash` window's whole view (`?splash=1` — see `src/main.tsx` and
 * `src-tauri/src/splash.rs`). Shown at launch, before the main window has
 * anything real to show; closes itself (via the main window invoking
 * `finish_splash` once its own `init()` settles — see `App.tsx`) rather than
 * timing out on its own. The bar reflects real boot milestones (the backend
 * `startup` thread's stages) emitted over `conva://splash-progress`, not a
 * simulated fill. When a fast boot completes milestones before the artwork is
 * visible, those already-completed milestones are presented in order. The
 * explicit 100% state arrives only after the main window has initialized;
 * native dismissal remains blocked until this view acknowledges that its
 * completed animation and readable Ready hold have both finished.
 */
export function SplashScreen({
  getProgress = getSplashProgress,
  show = showSplash,
  acknowledgeReady = acknowledgeSplashReady,
}: {
  getProgress?: () => Promise<SplashProgressEvent>;
  show?: () => Promise<void>;
  acknowledgeReady?: () => Promise<void>;
}) {
  const backend = useBackend();
  const [progress, setProgress] = useState<SplashProgressEvent>({
    stage: "started",
    percent: 0,
  });
  const [completed, setCompleted] = useState<SplashProgressEvent>({
    stage: "started",
    percent: 0,
  });
  const [visible, setVisible] = useState(!isTauri());
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    let alive = true;
    let unsub: (() => void) | undefined;
    let pollTimer: number | undefined;
    // Monotonic: the startup thread races this window's own startup, so a
    // stage can arrive out of order (the snapshot below resolving after a
    // newer live event) — never move the bar backwards.
    const apply = (e: SplashProgressEvent) => {
      if (alive) {
        setCompleted((prev) =>
          e.stage === "failed" || e.percent >= prev.percent ? e : prev,
        );
      }
    };
    void backend.subscribe("splashProgress", apply).then((un) => {
      if (alive) unsub = un;
      else un();
    });
    // Seed and then poll the backend's durable snapshot. Events make normal
    // updates immediate; polling closes the small registration/routing race
    // where a terminal Ready event could be missed by this secondary window.
    // Without this fallback the native timeout could close a splash still
    // presenting AlmostReady (85%).
    if (isTauri()) {
      const refresh = () => {
        void getProgress()
          .then((latest) => {
            apply(latest);
            if (
              alive &&
              (latest.stage === "ready" || latest.stage === "failed") &&
              pollTimer !== undefined
            ) {
              window.clearInterval(pollTimer);
              pollTimer = undefined;
            }
          })
          .catch(() => {});
      };
      refresh();
      pollTimer = window.setInterval(refresh, SPLASH_PROGRESS_POLL_MS);
    }
    return () => {
      alive = false;
      if (pollTimer !== undefined) window.clearInterval(pollTimer);
      unsub?.();
    };
  }, [backend, getProgress]);

  useEffect(() => {
    if (!visible) return;
    if (completed.stage === "failed") {
      setProgress((previous) => ({
        ...completed,
        percent: Math.max(previous.percent, completed.percent),
      }));
      return;
    }
    const next = nextPresentedSplashStage(progress.percent, completed.percent);
    if (!next) return;
    const timer = window.setTimeout(() => setProgress(next), SPLASH_STEP_MS);
    return () => window.clearTimeout(timer);
  }, [completed, progress.percent, visible]);

  useEffect(() => {
    if (progress.stage === "failed") {
      setLeaving(false);
      return;
    }
    if (progress.stage !== "ready") return;
    // The native `finish_splash` command is waiting for this acknowledgement.
    // Send it only after the 85→100 CSS fill has completed and Ready has had a
    // readable hold. That handshake—not a native timeout—authorizes closing.
    const timer = window.setTimeout(() => {
      if (!isTauri()) {
        setLeaving(true);
        return;
      }
      void acknowledgeReady()
        .then(() => setLeaving(true))
        .catch(() => {
          // Stay visibly Ready if the acknowledgement fails. Closing without
          // it would recreate the premature-dismissal bug.
        });
    }, SPLASH_FILL_TRANSITION_MS + SPLASH_READY_HOLD_MS);
    return () => window.clearTimeout(timer);
  }, [acknowledgeReady, progress.stage]);

  return (
    <div
      className={`splash-root relative h-screen w-screen overflow-hidden bg-bg transition-opacity duration-200 ease-out ${leaving ? "opacity-0" : "opacity-100"}`}
    >
      <img
        src={splashArt}
        alt=""
        aria-hidden
        onLoad={() => {
          if (isTauri()) {
            void show()
              .then(() => setVisible(true))
              .catch(() => {});
          } else {
            setVisible(true);
          }
        }}
        className="absolute inset-0 h-full w-full object-cover"
      />
      <div
        className="absolute inset-x-0 bottom-0 flex flex-col items-center gap-2.5 px-8 pb-6 pt-12"
        style={{
          // Fades to --color-bg (#05060e) so the bar/text sit on a readable
          // scrim regardless of what's under them in the art.
          background: "linear-gradient(to top, rgba(5,6,14,0.92), rgba(5,6,14,0) 100%)",
        }}
      >
        <div
          role="status"
          aria-live="polite"
          className="flex w-full max-w-[440px] items-center justify-between gap-4 rounded-md border border-white/10 bg-black/35 px-2.5 py-1.5 shadow-sm backdrop-blur-sm"
        >
          <p className="truncate text-[13px] font-semibold text-white">
            {STAGE_LABEL[progress.stage]}
          </p>
          <span className="shrink-0 font-mono text-[12px] font-semibold tabular-nums text-white/90">
            {progress.percent}%
          </span>
        </div>
        <div
          role="progressbar"
          aria-label="Starting conva"
          aria-valuenow={progress.percent}
          aria-valuemin={0}
          aria-valuemax={100}
          className="h-2.5 w-full max-w-[440px] overflow-hidden rounded-full bg-white/15"
        >
          <div
            className="splash-progress-fill h-full rounded-full bg-primary transition-[width] duration-200 ease-out"
            style={{ width: `${progress.percent}%` }}
          />
        </div>
        {progress.stage === "failed" && (
          <p role="alert" className="max-w-[440px] text-center text-xs text-red-300">
            {progress.message}
          </p>
        )}
      </div>
    </div>
  );
}

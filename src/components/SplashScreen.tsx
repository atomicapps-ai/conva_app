import { useEffect, useState } from "react";

import splashArt from "@/assets/brand/splash-screen.webp";
import { useBackend } from "@/lib/backend";
import type { SplashProgressEvent } from "@/lib/ipc";

const STAGE_LABEL: Record<SplashProgressEvent["stage"], string> = {
  started: "Starting…",
  library_loaded: "Loading your library…",
  workspace_ready: "Preparing your workspace…",
  almost_ready: "Almost ready…",
};

/**
 * The `splash` window's whole view (`?splash=1` — see `src/main.tsx` and
 * `src-tauri/src/splash.rs`). Shown at launch, before the main window has
 * anything real to show; closes itself (via the main window invoking
 * `finish_splash` once its own `init()` settles — see `App.tsx`) rather than
 * timing out on its own. The bar reflects real `setup()` milestones emitted
 * over `conva://splash-progress`, not a simulated fill — it holds at the
 * last real stage (85%) until the app is actually ready, rather than
 * animating to a false 100% and stalling there.
 */
export function SplashScreen() {
  const backend = useBackend();
  const [progress, setProgress] = useState<SplashProgressEvent>({
    stage: "started",
    percent: 0,
  });

  useEffect(() => {
    let alive = true;
    let unsub: (() => void) | undefined;
    void backend.subscribe("splashProgress", (e) => alive && setProgress(e)).then((un) => {
      if (alive) unsub = un;
      else un();
    });
    return () => {
      alive = false;
      unsub?.();
    };
  }, [backend]);

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-bg">
      <img
        src={splashArt}
        alt=""
        aria-hidden
        className="absolute inset-0 h-full w-full object-cover"
      />
      <div
        className="absolute inset-x-0 bottom-0 flex flex-col items-center gap-2 px-8 pb-6 pt-10"
        style={{
          // Fades to --color-bg (#05060e) so the bar/text sit on a readable
          // scrim regardless of what's under them in the art.
          background: "linear-gradient(to top, rgba(5,6,14,0.92), rgba(5,6,14,0) 100%)",
        }}
      >
        <div
          role="progressbar"
          aria-label="Starting conva"
          aria-valuenow={progress.percent}
          aria-valuemin={0}
          aria-valuemax={100}
          className="h-2.5 w-full max-w-[440px] overflow-hidden rounded-full bg-white/15"
        >
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-200 ease-out"
            style={{ width: `${progress.percent}%` }}
          />
        </div>
        <p className="text-sm text-white/70">{STAGE_LABEL[progress.stage]}</p>
      </div>
    </div>
  );
}

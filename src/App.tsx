import { useEffect, useState } from "react";

import mark from "@/assets/brand/conva-mark-cutout-white.svg";
import { FanerReplayPanel } from "@/components/dev/FanerReplayPanel";
import { StudioShell } from "@/components/studio/StudioShell";
import { WebShell } from "@/components/web/WebShell";
import { WebSignIn } from "@/components/web/WebSignIn";
import * as webAuth from "@/lib/backend/webAuth";
import { finishSplash, waitForStartup } from "@/lib/commands";
import { isTauri } from "@/lib/ipc";
import { isWeb } from "@/lib/platform";
import { runStartup } from "@/lib/startup";
import { useIpcBridge } from "@/lib/useIpcBridge";
import { useAppStore } from "@/state/app";
import { useDevMode } from "@/state/devMode";

/** Shown while the web app asks the session BFF whether we're signed in. */
function AuthResolving() {
  return (
    <div className="grid h-full place-items-center bg-bg">
      <div className="flex flex-col items-center gap-3 text-fg-muted">
        <img src={mark} alt="conva" className="h-8 w-8 opacity-80" />
        <p className="text-sm">Checking your sign-in…</p>
      </div>
    </div>
  );
}

export default function App() {
  useIpcBridge();
  const init = useAppStore((s) => s.init);
  const debugChromeVisible = useDevMode((s) => s.debugChromeVisible);
  const [startupReady, setStartupReady] = useState(!isTauri());

  // On the WEB the session lives behind the same-origin BFF (an HttpOnly
  // cookie this page cannot read), so signed-in-ness is only known after the
  // first /api/app/session answer. Track it here: unknown → resolving screen;
  // signed out → the in-app sign-in; signed in → the product. Desktop manages
  // its own auth in-app, so none of this applies there.
  const [webAuthStatus, setWebAuthStatus] = useState(() =>
    isWeb ? (webAuth.isResolved() ? webAuth.status() : null) : null,
  );
  useEffect(() => {
    if (!isWeb) return;
    let alive = true;
    const unsub = webAuth.onAuthChanged((s) => {
      if (alive) setWebAuthStatus(s);
    });
    void webAuth.ready().then(() => {
      if (alive) setWebAuthStatus(webAuth.status());
    });
    return () => {
      alive = false;
      unsub();
    };
  }, []);

  useEffect(() => {
    let alive = true;
    void runStartup({
      wait: isTauri() ? waitForStartup : async () => {},
      ready: () => setStartupReady(true),
      init,
      finish: isTauri() ? finishSplash : async () => {},
      canContinue: () => alive,
    }).catch((error) => {
      // The startup thread has already retained/emitted the useful failure
      // for the visible splash. Keep the hidden main UI unmounted so none of
      // its effects can invoke commands without AppState.
      console.error("[conva] startup failed", error);
    });
    return () => {
      alive = false;
    };
  }, [init]);

  if (isWeb && webAuthStatus === null) return <AuthResolving />;
  if (isWeb && !webAuthStatus?.signed_in) return <WebSignIn />;
  if (!startupReady) return null;

  // Two shells over the SAME views: web gets a top-nav layout, desktop the
  // cockpit rail. See WebShell / StudioShell.
  //
  // Single wrapper, not a Fragment: globals.css's `#root > * { position:
  // relative; z-index: 1 }` targets #root's direct children by ID-selector
  // specificity, which silently beats a plain `.fixed` utility class. A
  // Fragment here would make FanerReplayPanel a second direct child and that
  // rule would flatten its `position: fixed` back to `relative`, shoving it
  // to the bottom of normal document flow (invisible under the status bar).
  // Nesting it one level deeper keeps #root's single-child invariant intact.
  return (
    <div className="h-full">
      {isWeb ? <WebShell /> : <StudioShell />}
      {/* Dev-only FANER capture validator (F11); stripped from prod builds.
          Also hidden by the status bar's debug-chrome toggle, so a dev
          build can preview production chrome without a release build. */}
      {import.meta.env.DEV && !isWeb && debugChromeVisible && <FanerReplayPanel />}
    </div>
  );
}

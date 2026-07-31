import { useEffect } from "react";

import mark from "@/assets/brand/conva-mark-cutout-white.svg";
import { StudioShell } from "@/components/studio/StudioShell";
import * as webAuth from "@/lib/backend/webAuth";
import { isWeb } from "@/lib/platform";
import { useIpcBridge } from "@/lib/useIpcBridge";
import { useAppStore } from "@/state/app";

/** Shown for the instant before the web app bounces to the website login. */
function AuthRedirect() {
  return (
    <div className="grid h-full place-items-center bg-bg">
      <div className="flex flex-col items-center gap-3 text-fg-muted">
        <img src={mark} alt="conva" className="h-8 w-8 opacity-80" />
        <p className="text-sm">Taking you to sign in…</p>
      </div>
    </div>
  );
}

export default function App() {
  useIpcBridge();
  const init = useAppStore((s) => s.init);

  // On the WEB, login is the website's job — this app has no sign-in of its own.
  // No session → bounce to the website login (same origin in prod, the local
  // site in dev) and come back signed in. Desktop manages its own auth in-app,
  // so this guard never fires there.
  const needsWebLogin = isWeb && !webAuth.status().signed_in;

  useEffect(() => {
    void init();
  }, [init]);

  useEffect(() => {
    if (needsWebLogin) webAuth.loginRedirect();
  }, [needsWebLogin]);

  if (needsWebLogin) return <AuthRedirect />;

  return <StudioShell />;
}

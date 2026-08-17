import { useEffect, useState } from "react";

import { useBackend } from "@/lib/backend";
import * as webAuth from "@/lib/backend/webAuth";
import { isWeb } from "@/lib/platform";

/*
 * src/components/web/ — WEB-ONLY views (the "web adds on top of the base" layer).
 * Anything in here renders only on the web build; the shell guards it by
 * platform. Desktop-only screens stay beside their feature. Shared views live
 * in their feature folder and run on both. See src/lib/platform.ts.
 */

/** Where "Request beta access" goes until the application form (roadmap 1.5)
 *  exists: the marketing site's beta section. */
const REQUEST_URL = "https://getconva.com/";

/**
 * The access gate (roadmap 1.2, owner decision D1): signed in on the WEB
 * without the beta-allowlist entitlement → this single page instead of the
 * product. The predicate is `app_metadata.beta_access` (flipped per-user in the
 * Supabase dashboard for now; the beta application form feeds it later, and
 * billing swaps it for a subscription check — same gate either way). Desktop is
 * never gated here.
 */
export function useAccessGate(): boolean {
  const backend = useBackend();
  const [gated, setGated] = useState(
    () => isWeb && webAuth.status().signed_in && webAuth.betaAccess() === false,
  );

  useEffect(() => {
    if (!isWeb) return;
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    const evaluate = () =>
      setGated(webAuth.status().signed_in && webAuth.betaAccess() === false);
    void backend.subscribe("authChanged", evaluate).then((u) => {
      if (cancelled) u();
      else unlisten = u;
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [backend]);

  return gated;
}

export function GateView() {
  const backend = useBackend();
  const email = webAuth.status().email;
  const monogram = (email?.trim()?.[0] ?? "?").toUpperCase();

  return (
    <div className="grid h-full min-h-0 flex-1 place-items-center overflow-y-auto bg-bg p-6">
      <div className="glass w-full max-w-md rounded-xl p-9 text-center">
        <span className="brand-gradient mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full text-xl font-extrabold text-bg">
          {monogram}
        </span>
        <h2 className="text-xl font-extrabold tracking-tight text-fg">
          You're in line
        </h2>
        <p className="mt-2.5 text-sm leading-relaxed text-fg-muted">
          Your account is ready — conva is currently an{" "}
          <span className="font-semibold text-ai">invite-only beta</span>.
          Request access and we'll unlock the app for you.
        </p>
        <p className="mt-1.5 font-mono text-[10px] text-fg-faint">
          signed in as {email ?? "…"}
        </p>
        <button
          type="button"
          onClick={() => void backend.auth.openUrl(REQUEST_URL)}
          className="brand-gradient mt-6 w-full rounded-xl px-4 py-2.5 text-sm font-bold text-bg shadow-[var(--shadow-glow)] transition hover:brightness-110"
        >
          Request beta access
        </button>
        <button
          type="button"
          onClick={() => void backend.auth.signout()}
          className="mt-2 w-full rounded-xl border border-border-strong bg-transparent px-4 py-2 text-xs font-semibold text-fg-muted transition hover:text-fg"
        >
          Sign out
        </button>
      </div>
    </div>
  );
}

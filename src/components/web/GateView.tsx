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
 * The access gate (roadmap 1.2; owner decision 2026-09-05): signed in on the
 * WEB without the beta-allowlist entitlement → this single page instead of the
 * product. The predicate is the server-resolved `beta_access` — an `active` row
 * in spec 10's `beta_allowlist` table (the application form feeds it; billing
 * later swaps it for a subscription check — same gate either way). The held
 * state reads differently for `revoked` than for "waiting" (spec 10 UX
 * contract). Desktop is never gated here.
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

/** Copy per spec-10 status: revoked must not read like "you're in line". */
function heldCopy(status: webAuth.BetaStatus | null): { title: string; body: string; cta: string | null } {
  switch (status) {
    case "revoked":
      return {
        title: "Beta access has ended",
        body: "Access to the conva beta for this account has been withdrawn. Your local data is untouched. If you think this is a mistake, get in touch and we'll take a look.",
        cta: null,
      };
    case "invited":
      return {
        title: "Your invite is waiting",
        body: "You've been invited to the conva beta. Sign out and back in to activate it — if that doesn't unlock the app, we're still finishing the activation step on our side.",
        cta: null,
      };
    case "applied":
      return {
        title: "You're in line",
        body: "Your application is recorded and conva is currently an invite-only beta. We'll email you when your seat opens.",
        cta: null,
      };
    default:
      return {
        title: "You're in line",
        body: "Your account is ready — conva is currently an invite-only beta. Request access and we'll unlock the app for you.",
        cta: "Request beta access",
      };
  }
}

export function GateView() {
  const backend = useBackend();
  const email = webAuth.status().email;
  const monogram = (email?.trim()?.[0] ?? "?").toUpperCase();
  const copy = heldCopy(webAuth.betaStatus());

  return (
    <div className="grid h-full min-h-0 flex-1 place-items-center overflow-y-auto bg-bg p-6">
      <div className="glass w-full max-w-md rounded-xl p-9 text-center">
        <span className="brand-gradient mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full text-xl font-extrabold text-bg">
          {monogram}
        </span>
        <h2 className="text-xl font-extrabold tracking-tight text-fg">
          {copy.title}
        </h2>
        <p className="mt-2.5 text-sm leading-relaxed text-fg-muted">{copy.body}</p>
        <p className="mt-1.5 font-mono text-[10px] text-fg-faint">
          signed in as {email ?? "…"}
        </p>
        {copy.cta && (
          <button
            type="button"
            onClick={() => void backend.auth.openUrl(REQUEST_URL)}
            className="brand-gradient mt-6 w-full rounded-xl px-4 py-2.5 text-sm font-bold text-bg shadow-[var(--shadow-glow)] transition hover:brightness-110"
          >
            {copy.cta}
          </button>
        )}
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

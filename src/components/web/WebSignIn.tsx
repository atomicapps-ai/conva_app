import { useEffect, useState } from "react";

import mark from "@/assets/brand/conva-mark-cutout-white.svg";
import { useBackend, useOperationAvailability } from "@/lib/backend";
import * as webAuth from "@/lib/backend/webAuth";

/*
 * The web app's signed-out state (browser architecture M1: "signed-out /
 * invited / denied states"). The app is served same-origin at /app/, so
 * sign-in happens right here through the session BFF — no bounce to the
 * marketing login page and no token ever reaches this page:
 *   • "Continue with Google" → top-level navigation to /api/app/login
 *   • email + password       → POST /api/app/login/password (cookie set by the Worker)
 * When the Worker reports the session backend is not configured, the controls
 * are replaced by the reason — a control that cannot work is never rendered
 * as if it could.
 */

const FAILURE_COPY: Record<string, string> = {
  access_denied: "Google sign-in was cancelled.",
  signin_expired: "That sign-in attempt expired — please try again.",
  exchange_rejected: "Google sign-in could not be completed. Please try again.",
  auth_unavailable: "The sign-in service is temporarily unavailable.",
  missing_code: "The sign-in did not return a code. Please try again.",
};

export function WebSignIn() {
  const backend = useBackend();
  const startAvailability = useOperationAvailability("auth.start");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // A failed OAuth round-trip lands back here with ?signin=failed&reason=…
  useEffect(() => {
    const reason = webAuth.consumeSigninFailure();
    if (reason) setMessage(FAILURE_COPY[reason] ?? `Sign-in failed (${reason}).`);
  }, []);

  const unavailable =
    startAvailability?.state === "unavailable" ? startAvailability.reason : null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!email.trim() || !password) {
      setMessage("Enter your email address and password.");
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const status = await backend.auth.signinPassword(email, password);
      if (!status.signed_in) setMessage("Signed in, but no session was issued. Please try again.");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid h-full place-items-center overflow-y-auto bg-bg p-6">
      <div className="glass w-full max-w-sm rounded-xl p-8">
        <div className="mb-6 flex items-center gap-2">
          <img src={mark} alt="" className="h-6 w-6" draggable={false} />
          <span className="text-[15px] font-extrabold tracking-tight text-fg">conva</span>
        </div>
        <h1 className="text-xl font-extrabold tracking-tight text-fg">Sign in</h1>
        <p className="mt-1.5 text-sm text-fg-muted">
          One account for desktop and web. conva is an invite-only beta.
        </p>

        {unavailable ? (
          <p
            role="status"
            className="mt-6 rounded border border-border bg-panel-raised/40 p-3 text-sm text-fg-muted"
          >
            Sign-in isn't available on this surface yet.
            <span className="mt-1 block font-mono text-[11px] text-fg-faint">{unavailable}</span>
          </p>
        ) : (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => void backend.auth.start("google")}
              className="brand-gradient mt-6 w-full rounded-xl px-4 py-2.5 text-sm font-bold text-bg shadow-[var(--shadow-glow)] transition hover:brightness-110 disabled:opacity-60"
            >
              Continue with Google
            </button>

            <div className="my-5 flex items-center gap-3 text-[11px] uppercase tracking-wide text-fg-faint">
              <span className="h-px flex-1 bg-border" />
              or
              <span className="h-px flex-1 bg-border" />
            </div>

            <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-3" noValidate>
              <label className="flex flex-col gap-1 text-xs font-semibold text-fg-muted">
                Email
                <input
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="rounded border border-border bg-panel-raised px-3 py-2 text-sm text-fg"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs font-semibold text-fg-muted">
                Password
                <input
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="rounded border border-border bg-panel-raised px-3 py-2 text-sm text-fg"
                />
              </label>
              <button
                type="submit"
                disabled={busy}
                className="mt-1 w-full rounded-xl border border-border-strong bg-transparent px-4 py-2 text-sm font-semibold text-fg transition hover:bg-panel-raised disabled:opacity-60"
              >
                {busy ? "Signing in…" : "Sign in with email"}
              </button>
            </form>
          </>
        )}

        {message && (
          <p role="alert" className="mt-4 text-sm text-fg-muted">
            {message}
          </p>
        )}

        <p className="mt-6 text-center text-xs text-fg-faint">
          No account yet?{" "}
          <a href="/signup.html" className="text-fg-muted underline-offset-2 hover:underline">
            Create one on getconva.com
          </a>
        </p>
      </div>
    </div>
  );
}

import { useCallback, useEffect, useRef, useState } from "react";

import { useBackend } from "@/lib/backend";
import {
  backupSentence,
  clearResume,
  deleteErrorCode,
  emailMatches,
  friendlyDeleteError,
  isFreshSignIn,
  markResume,
} from "@/lib/accountDeletion";
import type { AuthStatus, DeleteAccountResult } from "@/lib/ipc";

type Step = 1 | 2 | 3;

/**
 * Delete account: three steps in one dialog (mockups approved 2026-10-06;
 * design conva_core docs/technical/2026-10-account-deletion-scope.md).
 *
 *   1 · What happens: two columns, what is deleted and what is not.
 *   2 · Confirm it's you: a FRESH sign-in (the server refuses a stale one and
 *       so does the database) plus the email typed out. A still-open laptop
 *       cannot delete an account with one click.
 *   3 · Done: the reference, and what is still on this computer.
 *
 * Deletion is immediate (the server removes the files, then the account, in
 * one step), so the wording says it is deleted now, never that it will be. The backup
 * sentence appears only when the real backup window is known.
 *
 * On the web the OAuth sign-in navigates the whole page away and back, so the
 * dialog marks a short-lived resume flag first and the app reopens it at step 2.
 */
export function DeleteAccountDialog({
  status,
  web,
  startAt = 1,
  onClose,
  onDeleted,
}: {
  /** Who is being deleted; a snapshot taken when the dialog opened. */
  status: AuthStatus;
  web: boolean;
  startAt?: Step;
  onClose: () => void;
  /** Called once, after the account is gone and the session ended. */
  onDeleted?: (result: DeleteAccountResult) => void;
}) {
  const backend = useBackend();
  const [step, setStep] = useState<Step>(startAt);
  const [latest, setLatest] = useState<AuthStatus>(status);
  const [openedWith] = useState(status.last_sign_in_at);
  const [rejectedAt, setRejectedAt] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [usePassword, setUsePassword] = useState(false);
  const [password, setPassword] = useState("");
  const [waiting, setWaiting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DeleteAccountResult | null>(null);
  const emailRef = useRef<HTMLInputElement>(null);

  const email = status.email;

  // Pick up a new sign-in the moment it lands (desktop deep link) or when the
  // person returns to this window (desktop browser round trip).
  const refresh = useCallback(() => {
    void backend.auth
      .status()
      .then((s) => {
        setLatest(s);
        if (s.signed_in) setWaiting(false);
      })
      .catch(() => {});
  }, [backend]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    void backend.subscribe("authChanged", () => refresh()).then((u) => {
      if (cancelled) u();
      else unlisten = u;
    });
    window.addEventListener("focus", refresh);
    return () => {
      cancelled = true;
      unlisten?.();
      window.removeEventListener("focus", refresh);
    };
  }, [backend, refresh]);

  // Confirmed = a sign-in under four minutes old, or a different one from when
  // the dialog opened; and never the one the server just refused.
  const signedInAt = latest.signed_in ? latest.last_sign_in_at : null;
  const confirmed =
    !!signedInAt &&
    signedInAt !== rejectedAt &&
    (isFreshSignIn(signedInAt, Date.now()) || (signedInAt !== openedWith && step === 2));

  useEffect(() => {
    if (step === 2) emailRef.current?.focus();
  }, [step]);

  const canDelete = confirmed && emailMatches(typed, email) && !busy;

  const signInWithProvider = async () => {
    setError(null);
    setWaiting(true);
    if (web) markResume(Date.now()); // the page is about to leave and come back
    try {
      await backend.auth.start("google");
    } catch (e) {
      setWaiting(false);
      setError(String(e));
    }
  };

  const signInWithPassword = async () => {
    if (!email || !password) return;
    setError(null);
    setBusy(true);
    try {
      const s = await backend.auth.signinPassword(email, password);
      setLatest(s);
      setPassword("");
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : "That password didn't work.");
    } finally {
      setBusy(false);
    }
  };

  const doDelete = async () => {
    if (!canDelete) return;
    setBusy(true);
    setError(null);
    try {
      const r = await backend.auth.deleteAccount();
      clearResume();
      setResult(r);
      setStep(3);
      onDeleted?.(r);
    } catch (e) {
      const code = deleteErrorCode(e);
      if (code === "recent_sign_in_required") setRejectedAt(latest.last_sign_in_at);
      setError(friendlyDeleteError(code));
    } finally {
      setBusy(false);
    }
  };

  const close = () => {
    clearResume();
    onClose();
  };

  const stepChip = (n: Step, label: string) => (
    <span
      className={`rounded border px-2 py-0.5 font-mono text-[10.5px] ${
        step === n ? "border-primary/40 bg-primary/10 text-primary" : "border-border-strong text-fg-faint"
      }`}
    >
      {n} · {label}
    </span>
  );

  const backup = backupSentence();

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-bg/80 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-account-title"
      onKeyDown={(e) => {
        if (e.key === "Escape" && !busy && step !== 3) close();
      }}
    >
      <div className="flex w-full max-w-[560px] flex-col rounded-lg border border-border-strong bg-panel-raised shadow-lg">
        <div className="flex flex-wrap gap-1.5 px-[18px] pt-3.5" aria-hidden="true">
          {stepChip(1, "What happens")}
          {stepChip(2, "Confirm it's you")}
          {stepChip(3, "Done")}
        </div>

        {step === 1 && (
          <>
            <h2 id="delete-account-title" className="px-[18px] pt-3 text-[15px] font-bold text-fg">
              Delete your Conva account?
            </h2>
            <div className="flex flex-col gap-2.5 px-[18px] py-3 text-[12.5px] text-fg-muted">
              <div className="grid gap-2.5 sm:grid-cols-2">
                <div className="rounded-md border border-border bg-panel p-2.5">
                  <h3 className="mb-1.5 font-mono text-[10.5px] uppercase tracking-wide text-fg-faint">
                    Deleted from Conva&apos;s servers
                  </h3>
                  <ul className="list-disc pl-4 text-[12px] text-fg">
                    <li>Your profile and email</li>
                    <li>Beta application and access</li>
                    <li>Usage data already sent</li>
                    <li>Conversations, Library and Contexts saved to the cloud</li>
                    <li>Your avatar and uploaded files</li>
                  </ul>
                </div>
                <div className="rounded-md border border-border bg-panel p-2.5">
                  <h3 className="mb-1.5 font-mono text-[10.5px] uppercase tracking-wide text-fg-faint">Not deleted</h3>
                  <ul className="list-disc pl-4 text-[12px] text-fg">
                    <li>
                      {web
                        ? "Data on any computer where you use the desktop app (erase it in Settings → Privacy there)"
                        : "Data on your computers (erase it in Settings → Privacy)"}
                    </li>
                    <li>Copies at AI providers, under their terms (Anthropic: up to 30 days)</li>
                    <li>Anything sent with your own API key</li>
                    <li>Backups kept by our database host, until they age out</li>
                  </ul>
                </div>
              </div>
              <div className="rounded-md border border-rec/40 bg-rec/10 px-2.5 py-2 text-[12px] text-fg" data-testid="delete-warning">
                Your account is deleted straight away and you&apos;re signed out on every device. This can&apos;t be undone.
                {backup && <> {backup}</>}
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-border px-[18px] py-3">
              <button type="button" className="btn" onClick={close}>
                Cancel
              </button>
              <button type="button" className="btn border-rec/40 bg-rec/10 text-rec" onClick={() => setStep(2)}>
                Continue
              </button>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <h2 id="delete-account-title" className="px-[18px] pt-3 text-[15px] font-bold text-fg">
              Confirm it&apos;s you
            </h2>
            <div className="flex flex-col gap-2.5 px-[18px] py-3 text-[12.5px] text-fg-muted">
              <p>
                Sign in again to approve deleting <b className="text-fg">{email ?? "this account"}</b>.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" className="btn" onClick={() => void signInWithProvider()} disabled={busy || waiting}>
                  {waiting ? "Waiting for your browser…" : "Sign in with Google"}
                </button>
                {!usePassword && (
                  <button type="button" className="btn" onClick={() => setUsePassword(true)} disabled={busy}>
                    Use my password instead
                  </button>
                )}
                <span
                  data-testid="reauth-status"
                  className={`rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide ${
                    confirmed ? "border-ok/30 text-ok" : "border-border-strong text-fg-muted"
                  }`}
                >
                  {confirmed ? "Confirmed" : "Not confirmed"}
                </span>
              </div>
              {usePassword && (
                <div className="flex items-center gap-2">
                  <input
                    type="password"
                    aria-label="Password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void signInWithPassword();
                    }}
                    disabled={busy}
                    className="min-w-0 flex-1 rounded-md border border-border-strong bg-bg px-2.5 py-2 text-[13px] text-fg"
                  />
                  <button type="button" className="btn" onClick={() => void signInWithPassword()} disabled={busy || !password}>
                    Confirm password
                  </button>
                </div>
              )}
              <label htmlFor="delete-email" className="text-fg">
                Type your email to confirm
              </label>
              <input
                id="delete-email"
                ref={emailRef}
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                disabled={busy}
                autoComplete="off"
                spellCheck={false}
                placeholder={email ?? ""}
                className="w-full rounded-md border border-border-strong bg-bg px-2.5 py-2 font-mono text-[13px] text-fg"
                onKeyDown={(e) => {
                  if (e.key === "Enter") void doDelete();
                }}
              />
              {error && (
                <p className="text-[12px] text-rec" role="alert">
                  {error}
                </p>
              )}
            </div>
            <div className="flex justify-end gap-2 border-t border-border px-[18px] py-3">
              <button type="button" className="btn" onClick={() => setStep(1)} disabled={busy}>
                Back
              </button>
              <button
                type="button"
                className="btn border-rec bg-rec text-bg disabled:opacity-40"
                disabled={!canDelete}
                onClick={() => void doDelete()}
              >
                {busy ? "Deleting…" : "Delete my account"}
              </button>
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <h2 id="delete-account-title" className="px-[18px] pt-3 text-[15px] font-bold text-fg">
              Your account is deleted
            </h2>
            <div className="flex flex-col gap-2.5 px-[18px] py-3 text-[12.5px] text-fg-muted">
              <p className="text-fg">You&apos;re signed out on every device, and your files and data on Conva&apos;s servers are gone.</p>
              {result?.reference && (
                <div className="rounded-md border border-border bg-panel px-2.5 py-2 text-[12px] text-fg" data-testid="delete-reference">
                  Reference <span className="font-mono">{result.reference}</span>. Keep this if you need to ask about it.
                </div>
              )}
              <p>
                {web
                  ? "Nothing on this browser needs erasing: your sign-in was removed."
                  : "Data on this computer is still here. You can erase it from Settings → Privacy."}
              </p>
              {backup && <p>{backup}</p>}
            </div>
            <div className="flex justify-end gap-2 border-t border-border px-[18px] py-3">
              <button type="button" className="btn border-primary bg-primary text-primary-ink" onClick={close}>
                Close
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

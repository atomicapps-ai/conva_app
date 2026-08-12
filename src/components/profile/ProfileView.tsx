import { useCallback, useEffect, useState } from "react";

import { Section, ViewShell } from "@/components/studio/ViewShell";
import { useBackend } from "@/lib/backend";
import { isTauriRuntime } from "@/lib/backend/detect";
import * as webAuth from "@/lib/backend/webAuth";
import type { AuthStatus } from "@/lib/ipc";
import { useNavStore } from "@/state/nav";

/** First letter of the email, for the monogram avatar (same as Dashboard). */
function initial(email: string | null): string {
  return (email?.trim()?.[0] ?? "?").toUpperCase();
}

function Row({
  label,
  children,
  danger = false,
}: {
  label: string;
  children: React.ReactNode;
  danger?: boolean;
}) {
  return (
    <div
      className={`flex items-center gap-4 rounded-xl border p-3.5 ${
        danger ? "border-rec/25" : "border-border"
      } bg-panel-raised/40`}
    >
      <span
        className={`w-36 shrink-0 font-mono text-[10px] uppercase tracking-[0.1em] ${
          danger ? "text-rec" : "text-fg-faint"
        }`}
      >
        {label}
      </span>
      <span className="min-w-0 flex-1 text-sm text-fg">{children}</span>
    </div>
  );
}

/**
 * Profile / account — one shared identity surface for desktop and web
 * (roadmap 1.2, mockup screen 2). Identity comes from `backend.auth` via the
 * PAL; web-only detail (provider, beta entitlement) comes from the session
 * token and renders "—" on desktop until the shell exposes it.
 */
export function ProfileView() {
  const backend = useBackend();
  const setView = useNavStore((s) => s.setView);
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    void backend.auth
      .status()
      .then(setStatus)
      .catch(() => setStatus(null));
  }, [backend]);

  useEffect(() => {
    refresh();
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    void backend
      .subscribe("authChanged", () => refresh())
      .then((u) => {
        if (cancelled) u();
        else unlisten = u;
      });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [backend, refresh]);

  const web = !isTauriRuntime();
  const provider = web ? webAuth.provider() : null;
  const beta = web ? webAuth.betaAccess() : null;

  const signOut = async () => {
    setBusy(true);
    try {
      await backend.auth.signout();
      setView("dashboard");
    } finally {
      setBusy(false);
    }
  };

  if (!status?.signed_in) {
    return (
      <ViewShell
        icon="account"
        title="Profile"
        subtitle="Your conva identity — one account for desktop and web."
      >
        <Section title="Account">
          <div className="flex items-center justify-between rounded-xl border border-border bg-panel-raised/40 p-4">
            <p className="text-sm text-fg-muted">
              You're not signed in on this surface.
            </p>
            <button
              type="button"
              onClick={() => setView("settings")}
              className="rounded-lg border border-border-strong bg-panel-raised px-3 py-1.5 text-xs font-semibold text-fg transition hover:brightness-110"
            >
              Sign in
            </button>
          </div>
        </Section>
      </ViewShell>
    );
  }

  return (
    <ViewShell
      icon="account"
      title="Profile"
      subtitle="Your conva identity — one account for desktop and web."
      actions={
        <button
          type="button"
          onClick={() => void signOut()}
          disabled={busy}
          className="btn"
        >
          Sign out
        </button>
      }
    >
      <Section title="Account">
        <div className="glass mb-3 flex items-center gap-4 rounded-lg p-4">
          <span className="brand-gradient flex h-12 w-12 items-center justify-center rounded-full text-lg font-extrabold text-bg">
            {initial(status.email)}
          </span>
          <div className="min-w-0">
            <p className="truncate text-base font-bold tracking-tight text-fg">
              {status.email}
            </p>
            <p className="font-mono text-[11px] text-fg-muted">
              synced across desktop &amp; web
            </p>
          </div>
        </div>
        <div className="flex flex-col gap-2.5">
          <Row label="Email">{status.email ?? "—"}</Row>
          <Row label="Sign-in method">
            {provider ? provider[0]?.toUpperCase() + provider.slice(1) : "—"}
          </Row>
          <Row label="Plan">
            {beta === true
              ? "Beta — invited"
              : beta === false
                ? "Beta — awaiting invite"
                : "Beta"}
            <span className="ml-1 text-xs text-fg-faint">· free during beta</span>
          </Row>
          <Row label="User ID">
            <span className="font-mono text-xs text-fg-muted">
              {status.user_id ?? "—"}
            </span>
          </Row>
        </div>
      </Section>

      <Section
        title="Surfaces"
        description="Everywhere this account is signed in."
      >
        <div className="flex flex-col gap-2.5">
          <Row label={web ? "This browser" : "This desktop"}>
            {web ? "conva Lite (web)" : "conva desktop"}
            <span className="ml-1 text-xs text-ok">· signed in now</span>
          </Row>
          <Row label={web ? "Desktop app" : "Web"}>
            <span className="text-fg-muted">
              Sign in with the same account to sync your plan and preferences.
            </span>
          </Row>
        </div>
      </Section>

      <Section
        title="Danger zone"
        description="Sign out here, or permanently delete your account."
      >
        <Row label="Account" danger>
          <span className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void signOut()}
              disabled={busy}
              className="rounded-lg border border-border-strong bg-transparent px-3 py-1.5 text-xs font-semibold text-fg-muted transition hover:text-fg"
            >
              Sign out
            </button>
            <span
              className="rounded-lg border border-rec/40 bg-rec/5 px-3 py-1.5 text-xs font-semibold text-rec/60"
              title="Account deletion arrives with the platform endpoints."
            >
              Delete account — coming soon
            </span>
          </span>
        </Row>
      </Section>
    </ViewShell>
  );
}

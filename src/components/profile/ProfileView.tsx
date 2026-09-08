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
      className={`flex items-center gap-4 rounded border p-3.5 ${
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

  // Display name + avatar (web only — conva_core migration 0001/0010; there's
  // no local desktop store for these yet, so desktop keeps showing "—" like
  // the other web-only rows above until the PAL exposes it there too).
  const [nameInput, setNameInput] = useState("");
  const [savedName, setSavedName] = useState<string | null>(null);
  const [savingName, setSavingName] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [avatarBroken, setAvatarBroken] = useState(true);
  const [avatarNonce, setAvatarNonce] = useState(0);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);

  useEffect(() => {
    if (!web || !status?.signed_in) return;
    setAvatarBroken(false); // let the <img> try; onError flips it back
    void webAuth.getProfile().then(({ display_name }) => {
      setSavedName(display_name);
      setNameInput(display_name ?? "");
    });
  }, [web, status?.signed_in]);

  const saveName = async () => {
    const trimmed = nameInput.trim();
    if (!trimmed || trimmed === savedName) return;
    setSavingName(true);
    setNameError(null);
    try {
      const res = await webAuth.updateDisplayName(trimmed);
      if (res.ok && res.display_name) {
        setSavedName(res.display_name);
        setNameInput(res.display_name);
      } else {
        setNameError("Couldn't save that name — try again.");
      }
    } finally {
      setSavingName(false);
    }
  };

  const AVATAR_ERROR_COPY: Record<string, string> = {
    unsupported_type: "PNG, JPEG, WebP or GIF only.",
    too_large: "That image is over the 5 MB limit.",
    empty_file: "That file looks empty.",
    network: "Couldn't reach the server — try again.",
    unknown: "Couldn't upload that image — try again.",
  };

  const pickAvatar = async (file: File | undefined) => {
    if (!file) return;
    setUploadingAvatar(true);
    setAvatarError(null);
    try {
      const res = await webAuth.uploadAvatar(file);
      if (res.ok) {
        setAvatarBroken(false);
        setAvatarNonce((n) => n + 1);
      } else {
        setAvatarError(AVATAR_ERROR_COPY[res.error ?? "unknown"] ?? "Couldn't upload that image — try again.");
      }
    } finally {
      setUploadingAvatar(false);
    }
  };

  const removeAvatar = async () => {
    setUploadingAvatar(true);
    setAvatarError(null);
    try {
      await webAuth.deleteAvatar();
      setAvatarBroken(true);
      setAvatarNonce((n) => n + 1);
    } finally {
      setUploadingAvatar(false);
    }
  };

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
        breadcrumb="Account"
        onBack={() => setView("dashboard")}
        title="Profile"
        subtitle="Your conva identity — one account for desktop and web."
      >
        <Section title="Account">
          <div className="flex items-center justify-between rounded border border-border bg-panel-raised/40 p-4">
            <p className="text-sm text-fg-muted">
              You're not signed in on this surface.
            </p>
            <button
              type="button"
              onClick={() => setView("settings")}
              className="btn"
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
      breadcrumb="Account"
      onBack={() => setView("dashboard")}
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
        <div className="glass mb-3 flex items-center gap-4 rounded p-4">
          <div className="relative shrink-0">
            {web && !avatarBroken ? (
              <img
                key={avatarNonce}
                src={`${webAuth.avatarUrl()}?v=${avatarNonce}`}
                onError={() => setAvatarBroken(true)}
                alt=""
                className="h-12 w-12 rounded-full object-cover"
              />
            ) : (
              <span className="brand-gradient flex h-12 w-12 items-center justify-center rounded-full text-lg font-extrabold text-bg">
                {initial(status.email)}
              </span>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-bold tracking-tight text-fg">
              {savedName || status.email}
            </p>
            <p className="font-mono text-[11px] text-fg-muted">
              synced across desktop &amp; web
            </p>
          </div>
          {web && (
            <div className="flex shrink-0 flex-col items-end gap-1">
              <div className="flex items-center gap-2">
                <label className="btn cursor-pointer text-xs">
                  {uploadingAvatar ? "Uploading…" : "Change photo"}
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    className="hidden"
                    disabled={uploadingAvatar}
                    onChange={(e) => {
                      void pickAvatar(e.target.files?.[0]);
                      e.target.value = "";
                    }}
                  />
                </label>
                {!avatarBroken && (
                  <button
                    type="button"
                    onClick={() => void removeAvatar()}
                    disabled={uploadingAvatar}
                    className="btn text-xs"
                  >
                    Remove
                  </button>
                )}
              </div>
              {avatarError && <p className="text-xs text-rec">{avatarError}</p>}
            </div>
          )}
        </div>
        <div className="flex flex-col gap-2.5">
          <Row label="Email">{status.email ?? "—"}</Row>
          {web && (
            <Row label="Display name">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  onBlur={() => void saveName()}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                  }}
                  disabled={savingName}
                  maxLength={80}
                  placeholder="Add a name"
                  className="min-w-0 flex-1 rounded border border-border bg-panel-raised/60 px-2.5 py-1.5 text-sm text-fg outline-none focus:border-primary"
                />
                {savingName && <span className="text-xs text-fg-faint">Saving…</span>}
              </div>
              {nameError && <p className="mt-1 text-xs text-rec">{nameError}</p>}
            </Row>
          )}
          <Row label="Sign-in method">
            {provider ? provider[0]?.toUpperCase() + provider.slice(1) : "—"}
          </Row>
          <Row label="Last sign-in">
            {status.last_sign_in_at
              ? new Date(status.last_sign_in_at).toLocaleString()
              : "—"}
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
              className="btn"
            >
              Sign out
            </button>
            <span
              className="rounded border border-rec/40 bg-rec/5 px-3 py-1.5 text-xs font-semibold text-rec/60"
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

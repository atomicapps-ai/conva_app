import { useCallback, useEffect, useState } from "react";

import { resolveAccount, type Account } from "@/lib/account";
import { onAvatarChanged } from "@/lib/avatarSignal";
import { useBackend } from "@/lib/backend";
import type { AuthStatus } from "@/lib/ipc";
import { useAppStore } from "@/state/app";
import { useNavStore } from "@/state/nav";

/**
 * The signed-in user, resolved once for every surface that shows identity
 * (rail account block, Home greeting, Settings → Account).
 *
 * Two real sources, no fixtures: `auth.status()` through the backend
 * abstraction (so web degrades honestly instead of crashing) and the user's
 * own `profile_display_name` / `profile_role` from AppConfig. See
 * `lib/account.ts` for the fallback rules.
 *
 * Re-reads on view change AND whenever sign-in state changes. The second is
 * the one that matters for Google sign-in: the browser hands the result back
 * out-of-band (the `conva://` deep link), the view does not change, and the
 * rail used to keep showing "Sign in to sync" until the next navigation.
 *
 * The profile photo is read from the same shared store as the Profile page
 * (`auth.avatarUrl`) and reloaded when it is uploaded or removed there; if none
 * exists (or the image fails to load) the initials monogram is shown.
 */
export function useAccount(): {
  account: Account;
  auth: AuthStatus | null;
  refresh: () => void;
} {
  const backend = useBackend();
  const view = useNavStore((s) => s.view);
  const config = useAppStore((s) => s.config);
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let live = true;
    void backend.auth
      .status()
      .then((s) => live && setAuth(s))
      .catch(() => live && setAuth(null));
    return () => {
      live = false;
    };
  }, [backend, view, nonce]);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  // Sign-in or sign-out completing out-of-band (OAuth deep link, another tab).
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    // Best-effort: identity must still render if a backend cannot deliver the event.
    void Promise.resolve()
      .then(() => backend.subscribe("authChanged", () => setNonce((n) => n + 1)))
      .then((u) => {
        if (cancelled) u();
        else unlisten = u;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [backend]);

  // The photo: re-read when sign-in state changes or the Profile page changes it.
  const [avatarNonce, setAvatarNonce] = useState(0);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  useEffect(() => onAvatarChanged(() => setAvatarNonce((n) => n + 1)), []);
  const signedIn = auth?.signed_in ?? false;
  useEffect(() => {
    if (!signedIn) {
      setAvatarUrl(null);
      return;
    }
    let live = true;
    let objectUrl: string | null = null;
    void Promise.resolve()
      .then(() => backend.auth.avatarUrl(avatarNonce))
      .then((url) => {
        if (!live) {
          // Desktop hands back an object URL we own; do not leak one we no longer show.
          if (url?.startsWith("blob:")) URL.revokeObjectURL(url);
          return;
        }
        if (url?.startsWith("blob:")) objectUrl = url;
        setAvatarUrl(url);
      })
      .catch(() => live && setAvatarUrl(null));
    return () => {
      live = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [backend, signedIn, avatarNonce]);

  return {
    account: resolveAccount(auth, {
      displayName: config?.profile_display_name ?? null,
      role: config?.profile_role ?? null,
      avatarUrl,
    }),
    auth,
    refresh,
  };
}

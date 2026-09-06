import { useCallback, useEffect, useState } from "react";

import { resolveAccount, type Account } from "@/lib/account";
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
 * Re-reads on view change so signing in via Settings updates the rail without
 * a reload — same trigger the old rail used.
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

  return {
    account: resolveAccount(auth, {
      displayName: config?.profile_display_name ?? null,
      role: config?.profile_role ?? null,
    }),
    auth,
    refresh,
  };
}

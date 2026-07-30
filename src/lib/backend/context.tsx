/**
 * React wiring for the Platform Abstraction Layer.
 *
 * Prefer `useBackend()` in components over the `getBackend()` module singleton —
 * it makes the backend injectable (drop a `FakeBackend` in tests/Storybook via
 * `<BackendProvider backend={fake}>`), which a global can't. `useCapabilities()`
 * resolves the capability descriptor once and is the idiomatic way to gate UI
 * (show/hide/degrade a feature), replacing scattered `isTauri` checks.
 */

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import type { Capabilities } from "@/lib/backend/capabilities";
import type { ConvaBackend } from "@/lib/backend/ConvaBackend";
import { getBackend } from "@/lib/backend";

const BackendContext = createContext<ConvaBackend | null>(null);

/**
 * Provides the active backend to the tree. Defaults to the runtime-resolved
 * singleton; pass `backend` to inject a fake in tests.
 */
export function BackendProvider({
  backend,
  children,
}: {
  backend?: ConvaBackend;
  children: ReactNode;
}) {
  const value = useMemo(() => backend ?? getBackend(), [backend]);
  return (
    <BackendContext.Provider value={value}>{children}</BackendContext.Provider>
  );
}

/** The active backend. Throws if used outside a `<BackendProvider>`. */
export function useBackend(): ConvaBackend {
  const backend = useContext(BackendContext);
  if (!backend) {
    throw new Error("useBackend must be used within a <BackendProvider>");
  }
  return backend;
}

/**
 * The resolved capability descriptor (null until the first async resolve).
 * Branch UI on this — `caps?.overlay.incog === "supported"`, etc. — never on the
 * platform directly.
 */
export function useCapabilities(): Capabilities | null {
  const backend = useBackend();
  const [caps, setCaps] = useState<Capabilities | null>(null);
  useEffect(() => {
    let live = true;
    void backend
      .capabilities()
      .then((c) => {
        if (live) setCaps(c);
      })
      .catch(() => {
        if (live) setCaps(null);
      });
    return () => {
      live = false;
    };
  }, [backend]);
  return caps;
}

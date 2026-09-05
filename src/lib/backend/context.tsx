/**
 * React wiring for the Platform Abstraction Layer.
 *
 * Prefer `useBackend()` in components over the `getBackend()` module singleton —
 * it makes the backend injectable (drop a `FakeBackend` in tests/Storybook via
 * `<BackendProvider backend={fake}>`), which a global can't.
 *
 * Capabilities are LIVE (browser architecture §8): the provider holds the
 * backend's revisioned capability store and every hook below reads it through
 * `useSyncExternalStore`, so a new revision re-renders exactly the components
 * that select a slice that changed. `useCapabilities()` keeps its signature
 * (`Capabilities | null`) and is the idiomatic way to gate UI
 * (show/hide/degrade a feature), replacing scattered `isTauri` checks.
 *
 * Compatibility: a backend that only implements the one-shot `capabilities()`
 * (older partial test fakes) still works — the provider resolves it once and
 * wraps the answer in a `legacy` snapshot, exactly the old behavior (`null`
 * until resolved).
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import type { Capabilities } from "@/lib/backend/capabilities";
import {
  legacySnapshot,
  type BackendOperation,
  type CapabilitySnapshot,
} from "@/lib/backend/capabilitySnapshot";
import type { ConvaBackend } from "@/lib/backend/ConvaBackend";
import { getBackend } from "@/lib/backend";
import {
  createCapabilityStore,
  type CapabilityReader,
} from "@/lib/capture/capabilityStore";
import {
  type Availability,
  type CaptureSourceCapability,
  type CaptureSourceKind,
} from "@/lib/capture/contract";

const BackendContext = createContext<ConvaBackend | null>(null);
const CapabilityStoreContext = createContext<CapabilityReader<CapabilitySnapshot> | null>(null);

/** A backend that ships its own live store (every real adapter + FakeBackend). */
function ownStore(backend: ConvaBackend): CapabilityReader<CapabilitySnapshot> | null {
  const s = (backend as Partial<ConvaBackend>).capabilityStore;
  return s && typeof s.snapshot === "function" && typeof s.subscribe === "function" ? s : null;
}

/**
 * Provides the active backend + its capability store to the tree. Defaults to
 * the runtime-resolved singleton; pass `backend` to inject a fake in tests.
 */
export function BackendProvider({
  backend,
  children,
}: {
  backend?: ConvaBackend;
  children: ReactNode;
}) {
  const value = useMemo(() => backend ?? getBackend(), [backend]);
  const live = useMemo(() => ownStore(value), [value]);
  // Shim path: no store on the backend → resolve `capabilities()` once.
  const [shim, setShim] = useState<CapabilityReader<CapabilitySnapshot> | null>(null);
  useEffect(() => {
    if (live) return;
    let alive = true;
    setShim(null);
    void Promise.resolve()
      .then(() => value.capabilities())
      .then((c) => {
        if (alive) setShim(createCapabilityStore(legacySnapshot(c)));
      })
      .catch(() => {
        if (alive) setShim(null);
      });
    return () => {
      alive = false;
    };
  }, [value, live]);

  return (
    <BackendContext.Provider value={value}>
      <CapabilityStoreContext.Provider value={live ?? shim}>{children}</CapabilityStoreContext.Provider>
    </BackendContext.Provider>
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

const noopSubscribe = () => () => {};

/**
 * Select a slice of the live capability snapshot. Re-renders only when the
 * selected value changes (`Object.is`), so a meter/connection revision that
 * leaves the slice untouched is free for the caller.
 */
export function useCapabilitySelector<T>(select: (snapshot: CapabilitySnapshot | null) => T): T {
  const store = useContext(CapabilityStoreContext);
  const subscribe = useCallback(
    (onChange: () => void) => (store ? store.subscribe(() => onChange()) : noopSubscribe()),
    [store],
  );
  const getSnapshot = useCallback(() => select(store ? store.snapshot() : null), [store, select]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

const selectLegacy = (s: CapabilitySnapshot | null) => s?.legacy ?? null;
const selectSnapshot = (s: CapabilitySnapshot | null) => s;
const selectSources = (s: CapabilitySnapshot | null) => s?.sources ?? null;
const selectRevision = (s: CapabilitySnapshot | null) => s?.revision ?? null;

/**
 * The compatibility descriptor (null until the store exists). Branch UI on
 * this — `caps?.overlay.incog === "supported"`, etc. — never on the platform
 * directly. Same signature as before; now live.
 */
export function useCapabilities(): Capabilities | null {
  return useCapabilitySelector(selectLegacy);
}

/** The whole live snapshot (null until the store exists). */
export function useCapabilitySnapshot(): CapabilitySnapshot | null {
  return useCapabilitySelector(selectSnapshot);
}

/** The current revision — cheap "did anything change" signal. */
export function useCapabilityRevision(): number | null {
  return useCapabilitySelector(selectRevision);
}

/** The capture sources (stable reference across unrelated revisions). */
export function useCaptureSources(): CaptureSourceCapability[] | null {
  return useCapabilitySelector(selectSources);
}

/** One capture source by kind, or null when the store/kind is absent. */
export function useCaptureSource(kind: CaptureSourceKind): CaptureSourceCapability | null {
  const select = useCallback(
    (s: CapabilitySnapshot | null) => s?.sources.find((x) => x.kind === kind) ?? null,
    [kind],
  );
  return useCapabilitySelector(select);
}

/** Availability of one backend operation (null until the store exists). */
export function useOperationAvailability(op: BackendOperation): Availability | null {
  const select = useCallback((s: CapabilitySnapshot | null) => s?.operations[op] ?? null, [op]);
  return useCapabilitySelector(select);
}

/**
 * Revisioned capability store — the live replacement for the one-shot
 * `capabilities()` answer (browser architecture §8: "`capabilities.snapshot()`
 * and `capabilities.subscribe()` with a monotonic revision; retain current
 * `capabilities()` as a compatibility shim during migration").
 *
 * Generic over the snapshot shape so the pure ordering rules are testable
 * without the backend's concrete descriptor. Pure — no React (the React
 * binding is `useSyncExternalStore` in `@/lib/backend/context`), no Tauri.
 */

export interface Revisioned {
  /** Monotonic; a publish whose revision is not strictly greater than the
   *  current one is rejected as stale. */
  revision: number;
}

export type CapabilityListener<S> = (snapshot: S) => void;

export type PublishResult<S> =
  | { accepted: true; snapshot: S }
  | { accepted: false; reason: "stale_revision"; current: S };

export interface CapabilityReader<S extends Revisioned> {
  /** The current snapshot (synchronous, referentially stable per revision). */
  snapshot(): S;
  /** Subscribe to every accepted publish. Returns the unsubscribe handle. */
  subscribe(listener: CapabilityListener<S>): () => void;
}

export interface CapabilityStore<S extends Revisioned> extends CapabilityReader<S> {
  /** Replace the snapshot. Rejected (not thrown) when `next.revision` does
   *  not advance — stale publishes from a slow probe never regress state. */
  publish(next: S): PublishResult<S>;
  /**
   * Shallow-patch the snapshot and bump the revision by one. Fields not in
   * `patch` keep their reference, so slice selectors stay stable across
   * unrelated updates.
   */
  update(patch: Partial<Omit<S, "revision">>): S;
  /** Number of live subscribers (tests / diagnostics). */
  listenerCount(): number;
}

export function createCapabilityStore<S extends Revisioned>(initial: S): CapabilityStore<S> {
  let current = initial;
  const listeners = new Set<CapabilityListener<S>>();

  const notify = () => {
    // Snapshot the set: a listener may unsubscribe (or subscribe) mid-loop.
    for (const l of [...listeners]) l(current);
  };

  return {
    snapshot: () => current,
    subscribe(listener) {
      listeners.add(listener);
      let live = true;
      return () => {
        if (!live) return;
        live = false;
        listeners.delete(listener);
      };
    },
    publish(next) {
      if (next.revision <= current.revision) {
        return { accepted: false, reason: "stale_revision", current };
      }
      current = next;
      notify();
      return { accepted: true, snapshot: current };
    },
    update(patch) {
      current = { ...current, ...patch, revision: current.revision + 1 };
      notify();
      return current;
    },
    listenerCount: () => listeners.size,
  };
}

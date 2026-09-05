import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

import { DESKTOP_CAPABILITIES, WEB_CAPABILITIES } from "@/lib/backend/capabilities";
import {
  desktopSnapshot,
  type CapabilitySnapshot,
  type RuntimeProbe,
} from "@/lib/backend/capabilitySnapshot";
import type { ConvaBackend } from "@/lib/backend/ConvaBackend";
import {
  BackendProvider,
  useCapabilities,
  useCapabilityRevision,
  useCapabilitySnapshot,
  useCaptureSource,
  useCaptureSources,
  useOperationAvailability,
} from "@/lib/backend/context";
import { createCapabilityStore } from "@/lib/capture/capabilityStore";
import { unavailable } from "@/lib/capture/contract";

const probe: RuntimeProbe = {
  os: "windows",
  hasGetUserMedia: true,
  hasGetDisplayMedia: true,
  secureContext: true,
};

function liveBackend(initial: CapabilitySnapshot) {
  const store = createCapabilityStore(initial);
  const backend = {
    capabilities: async () => store.snapshot().legacy,
    capabilityStore: store,
  } as unknown as ConvaBackend;
  return { backend, store };
}

function wrapperFor(backend: ConvaBackend) {
  return ({ children }: { children: ReactNode }) => (
    <BackendProvider backend={backend}>{children}</BackendProvider>
  );
}

describe("useCapabilities — live store", () => {
  it("reads the legacy descriptor synchronously from a backend with a store", () => {
    const { backend } = liveBackend(desktopSnapshot(DESKTOP_CAPABILITIES, probe));
    const { result } = renderHook(() => useCapabilities(), { wrapper: wrapperFor(backend) });
    expect(result.current).toBe(DESKTOP_CAPABILITIES);
  });

  it("re-renders on a new revision and reflects the published snapshot", () => {
    const { backend, store } = liveBackend(desktopSnapshot(DESKTOP_CAPABILITIES, probe));
    const { result } = renderHook(
      () => ({ caps: useCapabilities(), rev: useCapabilityRevision() }),
      { wrapper: wrapperFor(backend) },
    );
    expect(result.current.rev).toBe(1);
    act(() => {
      store.update({ legacy: WEB_CAPABILITIES });
    });
    expect(result.current.rev).toBe(2);
    expect(result.current.caps).toBe(WEB_CAPABILITIES);
  });

  it("unsubscribes on unmount", () => {
    const { backend, store } = liveBackend(desktopSnapshot(DESKTOP_CAPABILITIES, probe));
    const { unmount } = renderHook(() => useCapabilities(), { wrapper: wrapperFor(backend) });
    expect(store.listenerCount()).toBe(1);
    unmount();
    expect(store.listenerCount()).toBe(0);
  });
});

describe("useCapabilities — compatibility shim", () => {
  it("still works for a backend that only has the one-shot capabilities(): null → resolved", async () => {
    const backend = {
      capabilities: vi.fn().mockResolvedValue(DESKTOP_CAPABILITIES),
    } as unknown as ConvaBackend;
    const { result } = renderHook(
      () => ({ caps: useCapabilities(), snap: useCapabilitySnapshot() }),
      { wrapper: wrapperFor(backend) },
    );
    expect(result.current.caps).toBeNull();
    await waitFor(() => expect(result.current.caps).toBe(DESKTOP_CAPABILITIES));
    expect(result.current.snap?.adapter).toBe("legacy");
    expect(result.current.snap?.sources).toEqual([]);
    expect(backend.capabilities).toHaveBeenCalledTimes(1);
  });

  it("stays null when the one-shot capabilities() rejects (old behavior)", async () => {
    const backend = {
      capabilities: vi.fn().mockRejectedValue(new Error("boom")),
    } as unknown as ConvaBackend;
    const { result } = renderHook(() => useCapabilities(), { wrapper: wrapperFor(backend) });
    await waitFor(() => expect(backend.capabilities).toHaveBeenCalled());
    await Promise.resolve();
    expect(result.current).toBeNull();
  });
});

describe("narrow selectors — no unrelated rerenders", () => {
  it("useCaptureSources keeps its reference when an unrelated slice changes", () => {
    const { backend, store } = liveBackend(desktopSnapshot(DESKTOP_CAPABILITIES, probe));
    let renders = 0;
    const { result } = renderHook(
      () => {
        renders += 1;
        return useCaptureSources();
      },
      { wrapper: wrapperFor(backend) },
    );
    const first = result.current;
    const rendersAfterMount = renders;
    act(() => {
      store.update({ legacy: WEB_CAPABILITIES });
    });
    expect(result.current).toBe(first);
    expect(renders).toBe(rendersAfterMount);
  });

  it("useCaptureSource / useOperationAvailability select one entry and track changes to it", () => {
    const snap = desktopSnapshot(DESKTOP_CAPABILITIES, probe);
    const { backend, store } = liveBackend(snap);
    const { result } = renderHook(
      () => ({
        wasapi: useCaptureSource("wasapi"),
        ally: useOperationAvailability("ally.run"),
      }),
      { wrapper: wrapperFor(backend) },
    );
    expect(result.current.wasapi?.availability).toEqual({ state: "available" });
    expect(result.current.ally).toEqual({ state: "available" });
    act(() => {
      store.update({
        sources: snap.sources.map((s) =>
          s.kind === "wasapi"
            ? { ...s, availability: unavailable("output device lost") }
            : s,
        ),
        operations: { ...snap.operations, "ally.run": unavailable("no provider key") },
      });
    });
    expect(result.current.wasapi?.availability).toEqual({
      state: "unavailable",
      reason: "output device lost",
    });
    expect(result.current.ally).toEqual({ state: "unavailable", reason: "no provider key" });
  });
});

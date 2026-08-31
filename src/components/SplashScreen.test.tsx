import { render, screen } from "@testing-library/react";
import { act } from "react";
import { describe, expect, it, vi } from "vitest";

import { SplashScreen } from "@/components/SplashScreen";
import type { ConvaBackend } from "@/lib/backend/ConvaBackend";
import { BackendProvider } from "@/lib/backend/context";
import type { SplashProgressEvent } from "@/lib/ipc";

/** A fake backend whose `subscribe` hands the test direct control over the
 *  event handler, so a "progress event" can be simulated without going
 *  anywhere near a real Tauri event or the mocked-elsewhere plugin APIs. */
function fakeBackend() {
  let handler: ((e: SplashProgressEvent) => void) | undefined;
  const unsubscribe = vi.fn();
  const backend = {
    subscribe: vi.fn(async (_event, h) => {
      handler = h as (e: SplashProgressEvent) => void;
      return unsubscribe;
    }),
  } as unknown as ConvaBackend;
  return {
    backend,
    emit: (e: SplashProgressEvent) => {
      if (!handler) throw new Error("subscribe() was never called");
      act(() => handler!(e));
    },
    unsubscribe,
  };
}

describe("SplashScreen", () => {
  it("starts at 0% with the 'Starting…' label", () => {
    const { backend } = fakeBackend();
    render(
      <BackendProvider backend={backend}>
        <SplashScreen />
      </BackendProvider>,
    );
    expect(screen.getByText("Starting…")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
  });

  it("advances the bar and label as real setup milestones arrive", () => {
    const { backend, emit } = fakeBackend();
    render(
      <BackendProvider backend={backend}>
        <SplashScreen />
      </BackendProvider>,
    );

    emit({ stage: "library_loaded", percent: 35 });
    expect(screen.getByText("Loading your library…")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "35");

    emit({ stage: "almost_ready", percent: 85 });
    expect(screen.getByText("Almost ready…")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "85");
  });

  it("unsubscribes on unmount", async () => {
    const { backend, unsubscribe } = fakeBackend();
    const { unmount } = render(
      <BackendProvider backend={backend}>
        <SplashScreen />
      </BackendProvider>,
    );
    // The fake subscribe() resolves on a microtask; let it settle before
    // unmounting so the effect's cleanup has a real unsubscribe fn to call.
    await act(() => Promise.resolve());
    unmount();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});

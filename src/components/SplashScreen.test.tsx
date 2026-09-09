import { fireEvent, render, screen } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  SPLASH_FILL_TRANSITION_MS,
  SPLASH_PROGRESS_POLL_MS,
  SPLASH_READY_HOLD_MS,
  SPLASH_STEP_MS,
  SplashScreen,
} from "@/components/SplashScreen";
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
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    delete (window as Window & { __TAURI_INTERNALS__?: unknown })
      .__TAURI_INTERNALS__;
  });

  function enableTauriRuntime() {
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {},
    });
  }

  it("starts at 0% with a readable live status and visible percentage", () => {
    const { backend } = fakeBackend();
    render(
      <BackendProvider backend={backend}>
        <SplashScreen />
      </BackendProvider>,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Starting Conva…");
    expect(screen.getByRole("status")).toHaveTextContent("0%");
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
    act(() => vi.advanceTimersByTime(SPLASH_STEP_MS));
    expect(screen.getByText("Library loaded")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "35");

    emit({ stage: "almost_ready", percent: 85 });
    act(() => vi.advanceTimersByTime(SPLASH_STEP_MS));
    expect(screen.getByText("Workspace loaded")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(SPLASH_STEP_MS));
    expect(screen.getByText("Finishing startup…")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "85");
  });

  it("never moves the bar backwards (out-of-order stages)", () => {
    const { backend, emit } = fakeBackend();
    render(
      <BackendProvider backend={backend}>
        <SplashScreen />
      </BackendProvider>,
    );

    emit({ stage: "workspace_ready", percent: 60 });
    act(() => vi.advanceTimersByTime(SPLASH_STEP_MS));
    act(() => vi.advanceTimersByTime(SPLASH_STEP_MS));
    // A stale earlier stage (e.g. the get_splash_progress snapshot resolving
    // after a newer live event) must not regress the bar.
    emit({ stage: "library_loaded", percent: 35 });
    expect(screen.getByText("Workspace loaded")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "60");

    emit({ stage: "failed", percent: 35, message: "Late failure snapshot" });
    expect(screen.getByRole("alert")).toHaveTextContent("Late failure snapshot");
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "60");
  });

  it("recovers progress emitted before its listener registered", async () => {
    enableTauriRuntime();
    const { backend } = fakeBackend();
    const { container } = render(
      <BackendProvider backend={backend}>
        <SplashScreen getProgress={async () => ({
          stage: "workspace_ready",
          percent: 60,
        })} show={async () => {}} />
      </BackendProvider>,
    );

    await act(() => Promise.resolve());
    await act(async () => {
      fireEvent.load(container.querySelector("img")!);
      await Promise.resolve();
    });
    act(() => vi.advanceTimersByTime(SPLASH_STEP_MS));
    act(() => vi.advanceTimersByTime(SPLASH_STEP_MS));
    expect(screen.getByText("Workspace loaded")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "60");
  });

  it("polls the durable snapshot so a missed Ready event still reaches 100%", async () => {
    enableTauriRuntime();
    const { backend } = fakeBackend();
    let durable: SplashProgressEvent = { stage: "almost_ready", percent: 85 };
    const getProgress = vi.fn(async () => durable);
    const acknowledgeReady = vi.fn(async () => {});
    const { container } = render(
      <BackendProvider backend={backend}>
        <SplashScreen
          getProgress={getProgress}
          show={async () => {}}
          acknowledgeReady={acknowledgeReady}
        />
      </BackendProvider>,
    );

    await act(() => Promise.resolve());
    await act(async () => {
      fireEvent.load(container.querySelector("img")!);
      await Promise.resolve();
    });
    durable = { stage: "ready", percent: 100 };
    await act(async () => {
      vi.advanceTimersByTime(SPLASH_PROGRESS_POLL_MS);
      await Promise.resolve();
    });
    for (const percent of [35, 60, 85, 100]) {
      act(() => vi.advanceTimersByTime(SPLASH_STEP_MS));
      expect(screen.getByRole("progressbar")).toHaveAttribute(
        "aria-valuenow",
        String(percent),
      );
    }

    expect(screen.getByRole("status")).toHaveTextContent(/Ready\s*100%/);
    expect(acknowledgeReady).not.toHaveBeenCalled();
    act(() =>
      vi.advanceTimersByTime(
        SPLASH_FILL_TRANSITION_MS + SPLASH_READY_HOLD_MS - 1,
      ),
    );
    expect(acknowledgeReady).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(1);
      await Promise.resolve();
    });
    expect(acknowledgeReady).toHaveBeenCalledOnce();
    expect(container.firstElementChild).toHaveClass("opacity-0");
  });

  it("reveals the native window only after the artwork loads", async () => {
    enableTauriRuntime();
    const { backend } = fakeBackend();
    const show = vi.fn(async () => {});
    const { container } = render(
      <BackendProvider backend={backend}>
        <SplashScreen getProgress={() => new Promise(() => {})} show={show} />
      </BackendProvider>,
    );

    expect(show).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.load(container.querySelector("img")!);
      await Promise.resolve();
    });
    expect(show).toHaveBeenCalledOnce();
  });

  it("shows a retained startup failure instead of hanging silently", async () => {
    enableTauriRuntime();
    const { backend } = fakeBackend();
    const { container } = render(
      <BackendProvider backend={backend}>
        <SplashScreen getProgress={async () => ({
          stage: "failed",
          percent: 35,
          message: "Could not open the local library",
        })} show={async () => {}} />
      </BackendProvider>,
    );

    await act(() => Promise.resolve());
    await act(async () => {
      fireEvent.load(container.querySelector("img")!);
      await Promise.resolve();
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Could not open the local library",
    );
  });

  it("replays a fast completed boot through Ready before fading", () => {
    const { backend, emit } = fakeBackend();
    const { container } = render(
      <BackendProvider backend={backend}>
        <SplashScreen />
      </BackendProvider>,
    );

    emit({ stage: "ready", percent: 100 });
    for (const percent of [35, 60, 85, 100]) {
      act(() => vi.advanceTimersByTime(SPLASH_STEP_MS));
      expect(screen.getByRole("progressbar")).toHaveAttribute(
        "aria-valuenow",
        String(percent),
      );
    }
    expect(screen.getByText("Ready")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("100%");
    expect(container.firstElementChild).toHaveClass("opacity-100");
    act(() => vi.advanceTimersByTime(SPLASH_FILL_TRANSITION_MS));
    expect(container.firstElementChild).toHaveClass("opacity-100");
    act(() => vi.advanceTimersByTime(SPLASH_READY_HOLD_MS));
    expect(container.firstElementChild).toHaveClass("opacity-0");

    emit({
      stage: "failed",
      percent: 100,
      message: "Could not reveal the main window",
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Could not reveal the main window",
    );
    expect(container.firstElementChild).toHaveClass("opacity-100");
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

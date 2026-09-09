import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { UpdateToast } from "@/components/UpdateToast";
import type { ConvaBackend } from "@/lib/backend/ConvaBackend";
import { BackendProvider } from "@/lib/backend/context";
import { useTranscriptStore } from "@/state/transcript";
import { useUiPrefs } from "@/state/uiPrefs";

const checkMock = vi.hoisted(() => vi.fn());
const relaunchMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/plugin-updater", () => ({ check: checkMock }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: relaunchMock }));

function fakeBackend(updater: boolean): ConvaBackend {
  return {
    capabilities: async () => ({ system: { updater } }),
  } as unknown as ConvaBackend;
}

function renderToast(updater = true) {
  return render(
    <BackendProvider backend={fakeBackend(updater)}>
      <UpdateToast checkDelayMs={0} />
    </BackendProvider>,
  );
}

function fakeUpdate(overrides: { body?: string } = {}) {
  return {
    version: "0.4.0",
    body: overrides.body,
    download: vi.fn().mockResolvedValue(undefined),
    install: vi.fn().mockResolvedValue(undefined),
  };
}

describe("UpdateToast", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useUiPrefs.setState({ autoInstallUpdates: false });
    useTranscriptStore.setState({ session: { state: "idle" } });
  });

  it("stays hidden when the platform has no updater", async () => {
    renderToast(false);
    // Give the (absent) check a tick to run if it were going to.
    await act(() => new Promise((r) => setTimeout(r, 20)));
    expect(checkMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("stays hidden when no update is available or the check fails", async () => {
    checkMock.mockResolvedValueOnce(null);
    renderToast();
    await waitFor(() => expect(checkMock).toHaveBeenCalled());
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    checkMock.mockRejectedValueOnce(new Error("offline"));
    renderToast();
    await waitFor(() => expect(checkMock).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("never shows the offline/unreachable-feed failure as a user-visible error", async () => {
    checkMock.mockRejectedValueOnce(new Error("network error"));
    renderToast();
    await waitFor(() => expect(checkMock).toHaveBeenCalled());
    expect(screen.queryByText(/update failed/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("logs the check/download failure to the console only in dev", async () => {
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
    checkMock.mockRejectedValueOnce(new Error("offline"));
    renderToast();
    await waitFor(() => expect(checkMock).toHaveBeenCalled());
    // vitest runs with import.meta.env.DEV = true, so the dev diagnostic fires.
    expect(debugSpy).toHaveBeenCalledWith(
      expect.stringContaining("[updater]"),
      expect.any(Error),
    );
    debugSpy.mockRestore();
  });

  it("downloads in the background, then offers Restart and install", async () => {
    const update = fakeUpdate();
    checkMock.mockResolvedValueOnce(update);
    renderToast();

    await screen.findByText("Update ready · conva v0.4.0");
    expect(update.download).toHaveBeenCalledOnce();
    expect(
      screen.getByRole("button", { name: "Restart and install" }),
    ).toBeEnabled();
  });

  it("shows download progress while the update downloads", async () => {
    const update = fakeUpdate();
    const oneMb = 1024 * 1024;
    // Emits progress then never resolves, so the component stays in the
    // "downloading" phase — isolates the progress UI from the ready-state race.
    update.download.mockImplementation(
      (onEvent) =>
        new Promise<void>(() => {
          onEvent?.({ event: "Started", data: { contentLength: 2 * oneMb } });
          onEvent?.({ event: "Progress", data: { chunkLength: oneMb } });
        }),
    );
    checkMock.mockResolvedValueOnce(update);
    renderToast();

    const bar = await screen.findByRole("progressbar", { name: /update download progress/i });
    await waitFor(() => expect(bar).toHaveAttribute("aria-valuenow", "50"));
    expect(screen.getByText("50% · 1 MB")).toBeInTheDocument();
  });

  it("shows a release-notes preview when the update carries one", async () => {
    checkMock.mockResolvedValueOnce(
      fakeUpdate({ body: "Fixed the thing that was broken.\nAlso some internal cleanup." }),
    );
    renderToast();

    await screen.findByText("Update ready · conva v0.4.0");
    expect(screen.getByText("“Fixed the thing that was broken.”")).toBeInTheDocument();
  });

  it("Restart and install installs the update and relaunches", async () => {
    const update = fakeUpdate();
    checkMock.mockResolvedValueOnce(update);
    renderToast();

    await screen.findByText("Update ready · conva v0.4.0");
    await userEvent.click(
      screen.getByRole("button", { name: "Restart and install" }),
    );
    await waitFor(() => expect(relaunchMock).toHaveBeenCalledOnce());
    expect(update.install).toHaveBeenCalledOnce();
  });

  it("shows the error visibly when install fails", async () => {
    const update = fakeUpdate();
    update.install.mockRejectedValueOnce(new Error("disk full"));
    checkMock.mockResolvedValueOnce(update);
    renderToast();

    await screen.findByText("Update ready · conva v0.4.0");
    await userEvent.click(
      screen.getByRole("button", { name: "Restart and install" }),
    );
    await screen.findByText("Update failed");
    expect(relaunchMock).not.toHaveBeenCalled();
  });

  it("Later dismisses the toast", async () => {
    checkMock.mockResolvedValueOnce(fakeUpdate());
    renderToast();

    await screen.findByText("Update ready · conva v0.4.0");
    await userEvent.click(screen.getByRole("button", { name: "Later" }));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("shows and hides the complete release notes", async () => {
    checkMock.mockResolvedValueOnce(
      fakeUpdate({ body: "## Highlights\n\n- A useful change\n- A second change" }),
    );
    renderToast();

    await screen.findByText("Update ready · conva v0.4.0");
    await userEvent.click(
      screen.getByRole("button", { name: "Release notes" }),
    );
    expect(screen.getByText(/A useful change/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Hide release notes" }));
    expect(screen.queryByText(/A useful change/)).not.toBeInTheDocument();
  });

  it("auto-installs and relaunches when the preference is enabled", async () => {
    const update = fakeUpdate({ body: "A clean release." });
    checkMock.mockResolvedValueOnce(update);
    useUiPrefs.setState({ autoInstallUpdates: true });
    renderToast();

    await waitFor(() => expect(update.install).toHaveBeenCalledOnce());
    await waitFor(() => expect(relaunchMock).toHaveBeenCalledOnce());
  });

  it("postpones auto-install during a live session, then installs when it ends", async () => {
    const update = fakeUpdate({ body: "A clean release." });
    checkMock.mockResolvedValueOnce(update);
    useUiPrefs.setState({ autoInstallUpdates: true });
    useTranscriptStore.setState({ session: { state: "listening" } });
    renderToast();

    await screen.findByText(/Ready to install automatically when your live session ends/);
    expect(update.install).not.toHaveBeenCalled();

    act(() => useTranscriptStore.setState({ session: { state: "idle" } }));
    await waitFor(() => expect(update.install).toHaveBeenCalledOnce());
    await waitFor(() => expect(relaunchMock).toHaveBeenCalledOnce());
  });
});

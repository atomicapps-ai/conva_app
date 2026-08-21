import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { UpdateToast } from "@/components/UpdateToast";
import type { ConvaBackend } from "@/lib/backend/ConvaBackend";
import { BackendProvider } from "@/lib/backend/context";
import { useNavStore } from "@/state/nav";

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

function fakeUpdate() {
  return {
    version: "0.4.0",
    download: vi.fn().mockResolvedValue(undefined),
    install: vi.fn().mockResolvedValue(undefined),
  };
}

describe("UpdateToast", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useNavStore.setState({ view: "dashboard" });
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

  it("See what's new navigates to the What's New view", async () => {
    checkMock.mockResolvedValueOnce(fakeUpdate());
    renderToast();

    await screen.findByText("Update ready · conva v0.4.0");
    await userEvent.click(
      screen.getByRole("button", { name: "See what's new" }),
    );
    expect(useNavStore.getState().view).toBe("releases");
  });
});

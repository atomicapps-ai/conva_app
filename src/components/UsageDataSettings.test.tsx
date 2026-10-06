import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { UsageDataSettings } from "@/components/UsageDataSettings";
import { BackendProvider } from "@/lib/backend";
import type { ConvaBackend } from "@/lib/backend/ConvaBackend";
import type { TelemetryStatus } from "@/lib/ipc";
import { useAppStore } from "@/state/app";

afterEach(cleanup);

const LOG = "C:\\Users\\a\\AppData\\conva\\telemetry\\events.jsonl";

function setup(status: TelemetryStatus, enabled: boolean) {
  const updateConfig = vi.fn().mockResolvedValue(undefined);
  useAppStore.setState({
    config: { telemetry_enabled: enabled } as never,
    updateConfig,
  });
  const backend = {
    usage: { telemetryStatus: vi.fn().mockResolvedValue(status) },
  } as unknown as ConvaBackend;
  render(
    <BackendProvider backend={backend}>
      <UsageDataSettings />
    </BackendProvider>,
  );
  return { updateConfig };
}

describe("UsageDataSettings", () => {
  beforeEach(() => useAppStore.setState({ config: null }));

  it("is a live switch for an ordinary account: shows the log path and says off deletes the unsent queue", async () => {
    const { updateConfig } = setup({ enabled: true, required: false, collecting: true, log_path: LOG }, true);
    const box = await screen.findByRole("checkbox");
    expect(box).toBeChecked();
    expect(box).not.toBeDisabled();
    const note = screen.getByTestId("usage-data-setting");
    expect(note).toHaveTextContent(LOG);
    expect(note).toHaveTextContent(/never records audio, transcripts, document names or document contents/i);
    expect(note).toHaveTextContent(/deletes anything not yet sent/i);
    expect(note).toHaveTextContent(/does not cover signing in, update checks or speech-model downloads/i);
    expect(screen.queryByTestId("usage-data-locked")).toBeNull();
    fireEvent.click(box);
    await waitFor(() => expect(updateConfig).toHaveBeenCalledWith({ telemetry_enabled: false }));
  });

  it("is locked on, with the reason, when the server says the beta terms require usage data", async () => {
    const { updateConfig } = setup({ enabled: false, required: true, collecting: true, log_path: LOG }, false);
    const box = await screen.findByRole("checkbox");
    expect(box).toBeChecked();
    expect(box).toBeDisabled();
    expect(screen.getByTestId("usage-data-locked")).toHaveTextContent(/required for your beta account/i);
    expect(screen.getByTestId("usage-data-setting")).not.toHaveTextContent(/deletes anything not yet sent/i);
    fireEvent.click(box);
    expect(updateConfig).not.toHaveBeenCalled();
  });

  it("renders nothing when the status can't be read (e.g. the web build)", async () => {
    useAppStore.setState({ config: { telemetry_enabled: true } as never });
    const backend = {
      usage: { telemetryStatus: vi.fn().mockRejectedValue(new Error("unsupported")) },
    } as unknown as ConvaBackend;
    const { container } = render(
      <BackendProvider backend={backend}>
        <UsageDataSettings />
      </BackendProvider>,
    );
    await waitFor(() => expect(backend.usage.telemetryStatus).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EraseLocalDataDialog } from "@/components/privacy/EraseLocalDataDialog";
import { LocalDataSettings } from "@/components/privacy/LocalDataSettings";
import { RecordingsView } from "@/components/privacy/RecordingsView";
import { BackendProvider } from "@/lib/backend";
import type { ConvaBackend } from "@/lib/backend/ConvaBackend";
import type { LocalDataSummary, RecordingInfo } from "@/lib/ipc";
import { useNavStore } from "@/state/nav";

const relaunchMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: relaunchMock }));

afterEach(cleanup);
beforeEach(() => {
  relaunchMock.mockReset();
  useNavStore.setState({ view: "settings", pendingSettingsGroup: null });
});

const MB = 1024 * 1024;
const SUMMARY: LocalDataSummary = {
  data_dir: "C:\\Users\\a\\AppData\\conva",
  recordings: { count: 3, bytes: 412 * MB },
  conversations: { count: 12, bytes: 1 * MB },
  session_logs: { count: 48, bytes: 31 * MB },
  library: { count: 31, bytes: 220 * MB },
  contexts: { count: 4, bytes: 1 * MB },
  diagnostics: { count: 3, bytes: Math.round(1.2 * MB) },
  models: { count: 2, bytes: 340 * MB },
};

function backendWith(localData: Partial<ConvaBackend["localData"]>): ConvaBackend {
  return { localData } as unknown as ConvaBackend;
}
const wrap = (b: ConvaBackend, ui: React.ReactNode) => render(<BackendProvider backend={b}>{ui}</BackendProvider>);

describe("LocalDataSettings", () => {
  it("lists each category with its count and size, marks models as kept, and says Conva can't see any of it", async () => {
    wrap(backendWith({ summary: vi.fn().mockResolvedValue(SUMMARY) }), <LocalDataSettings />);
    const box = await screen.findByTestId("local-data-setting");
    expect(box).toHaveTextContent(/stored on this computer\. Conva can.t see it and can.t delete it for you/i);
    expect(box).toHaveTextContent("3 files · 412 MB");
    expect(box).toHaveTextContent(/include the other person.s voice/i);
    expect(box).toHaveTextContent("31 docs · 4 Contexts · 221 MB");
    expect(box).toHaveTextContent("2 files · 340 MB");
    expect(box).toHaveTextContent(/Kept/);
    expect(box).toHaveTextContent(/does not touch your Conva account/i);
  });

  it("Review… opens the recordings sub-view", async () => {
    wrap(backendWith({ summary: vi.fn().mockResolvedValue(SUMMARY) }), <LocalDataSettings />);
    fireEvent.click(await screen.findByRole("button", { name: "Review…" }));
    expect(useNavStore.getState().view).toBe("recordings");
  });

  it("renders nothing when the summary can't be read (the web build)", async () => {
    const summary = vi.fn().mockRejectedValue(new Error("unsupported"));
    const { container } = wrap(backendWith({ summary }), <LocalDataSettings />);
    await waitFor(() => expect(summary).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("opens the erase dialog from the danger button", async () => {
    wrap(backendWith({ summary: vi.fn().mockResolvedValue(SUMMARY) }), <LocalDataSettings />);
    fireEvent.click(await screen.findByRole("button", { name: /Erase everything on this computer/ }));
    expect(await screen.findByRole("dialog", { name: /Erase everything on this computer\?/ })).toBeInTheDocument();
  });
});

describe("EraseLocalDataDialog", () => {
  const open = (erase = vi.fn().mockResolvedValue(undefined), onClose = vi.fn()) => {
    wrap(backendWith({ erase }), <EraseLocalDataDialog summary={SUMMARY} onClose={onClose} />);
    return { erase, onClose };
  };

  it("lists what goes, with counts, and leaves the API-keys option off", () => {
    open();
    const dlg = screen.getByRole("dialog");
    expect(dlg).toHaveTextContent("3 files · 412 MB");
    expect(dlg).toHaveTextContent("12 conversations · 48 logs");
    expect(dlg).toHaveTextContent("31 documents · 4 Contexts");
    expect(dlg).toHaveTextContent(/This can.t be undone/);
    expect(dlg).toHaveTextContent(/not affected/);
    expect(dlg).toHaveTextContent(/Keeps: speech models, settings/);
    expect(screen.getByRole("checkbox", { name: /remove my API keys/i })).not.toBeChecked();
  });

  it("keeps Erase off until ERASE is typed exactly, then erases without keys and relaunches", async () => {
    const { erase } = open();
    const go = screen.getByRole("button", { name: "Erase and restart" });
    expect(go).toBeDisabled();
    const input = screen.getByLabelText(/Type ERASE to confirm/);
    fireEvent.change(input, { target: { value: "erase" } });
    expect(go).toBeDisabled();
    fireEvent.change(input, { target: { value: "ERASE" } });
    expect(go).toBeEnabled();
    fireEvent.click(go);
    await waitFor(() => expect(erase).toHaveBeenCalledWith({ include_keys: false }));
    await waitFor(() => expect(relaunchMock).toHaveBeenCalled());
  });

  it("passes include_keys when the keys box is ticked", async () => {
    const { erase } = open();
    fireEvent.click(screen.getByRole("checkbox", { name: /remove my API keys/i }));
    fireEvent.change(screen.getByLabelText(/Type ERASE to confirm/), { target: { value: "ERASE" } });
    fireEvent.click(screen.getByRole("button", { name: "Erase and restart" }));
    await waitFor(() => expect(erase).toHaveBeenCalledWith({ include_keys: true }));
  });

  it("shows the refusal and does not relaunch when the shell says a session is live", async () => {
    const erase = vi.fn().mockRejectedValue("Stop listening before erasing.");
    open(erase);
    fireEvent.change(screen.getByLabelText(/Type ERASE to confirm/), { target: { value: "ERASE" } });
    fireEvent.click(screen.getByRole("button", { name: "Erase and restart" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Stop listening before erasing.");
    expect(relaunchMock).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Erase and restart" })).toBeEnabled();
  });

  it("Cancel and Escape close without erasing", () => {
    const { erase, onClose } = open();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(erase).not.toHaveBeenCalled();
  });
});

describe("RecordingsView", () => {
  const REC = (id: string, ms: number, size: number, dur: number | null): RecordingInfo => ({
    id,
    started_unix_ms: ms,
    duration_ms: dur,
    size_bytes: size,
  });
  const LIST = [
    REC("call-3.wav", 1_760_000_300_000, 212 * MB, 4_360_000),
    REC("call-2.wav", 1_760_000_200_000, 148 * MB, 2_885_000),
    REC("call-1.wav", 1_760_000_100_000, 52 * MB, null),
  ];

  it("lists recordings, keeps both delete buttons off until something is selected, and sizes the confirm", async () => {
    const del = vi.fn().mockResolvedValue({ deleted: 2, freed_bytes: 360 * MB, failed: [] });
    const recordings = vi.fn().mockResolvedValueOnce(LIST).mockResolvedValue([LIST[2]]);
    wrap(backendWith({ recordings, deleteRecordings: del }), <RecordingsView />);
    expect(await screen.findByText("1:12:40")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument(); // unreadable header
    const buttons = screen.getAllByRole("button", { name: "Delete selected" });
    expect(buttons).toHaveLength(2); // top-right and footer
    buttons.forEach((b) => expect(b).toBeDisabled());
    expect(screen.getByText("None selected")).toBeInTheDocument();

    const boxes = screen.getAllByRole("checkbox", { name: /Select recording from/ });
    fireEvent.click(boxes[0]);
    fireEvent.click(boxes[1]);
    expect(screen.getByText("2 recordings selected · 360 MB")).toBeInTheDocument();
    screen.getAllByRole("button", { name: "Delete selected" }).forEach((b) => expect(b).toBeEnabled());

    fireEvent.click(screen.getAllByRole("button", { name: "Delete selected" })[1]);
    const dlg = await screen.findByRole("dialog", { name: /Delete 2 recordings\?/ });
    expect(dlg).toHaveTextContent("This frees 360 MB. They can't be recovered.");
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(del).toHaveBeenCalledWith(["call-3.wav", "call-2.wav"]));
    expect(await screen.findByText(/Deleted 2 recordings and freed 360 MB/)).toBeInTheDocument();
  });

  it("reports recordings that could not be deleted instead of claiming success", async () => {
    const del = vi.fn().mockResolvedValue({ deleted: 1, freed_bytes: 52 * MB, failed: ["call-1.wav"] });
    wrap(backendWith({ recordings: vi.fn().mockResolvedValue(LIST), deleteRecordings: del }), <RecordingsView />);
    await screen.findByText("1:12:40");
    fireEvent.click(screen.getByLabelText("Select all recordings"));
    fireEvent.click(screen.getAllByRole("button", { name: "Delete selected" })[0]);
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
    expect(await screen.findByText(/1 recording could not be deleted/)).toBeInTheDocument();
  });

  it("Reveal asks the shell to show that file, and Back returns to Settings → Privacy", async () => {
    const reveal = vi.fn().mockResolvedValue(undefined);
    wrap(backendWith({ recordings: vi.fn().mockResolvedValue(LIST), revealRecording: reveal }), <RecordingsView />);
    await screen.findByText("1:12:40");
    fireEvent.click(screen.getAllByRole("button", { name: "Reveal" })[0]);
    expect(reveal).toHaveBeenCalledWith("call-3.wav");
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(useNavStore.getState()).toMatchObject({ view: "settings", pendingSettingsGroup: "privacy" });
  });

  it("says recordings are desktop-only when the backend refuses (web)", async () => {
    wrap(backendWith({ recordings: vi.fn().mockRejectedValue(new Error("unsupported")) }), <RecordingsView />);
    expect(await screen.findByText(/only kept by the desktop app/i)).toBeInTheDocument();
  });
});

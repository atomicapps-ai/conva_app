import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { CaptureControls } from "@/components/web/CaptureControls";
import { BackendProvider } from "@/lib/backend";
import { FakeBackend } from "@/lib/backend/fake";
import { AVAILABLE } from "@/lib/capture/contract";
import { useTranscriptStore } from "@/state/transcript";

function fake() {
  return new FakeBackend({
    sources: [
      { kind: "mic", channels: ["self"], owner: "page", continuity: "page_lifetime", processing: ["hosted"], availability: AVAILABLE },
      { kind: "display", channels: ["remote_mix"], owner: "page", continuity: "page_lifetime", processing: ["hosted"], availability: AVAILABLE },
    ],
  });
}

describe("CaptureControls (web)", () => {
  it("renders nothing until listening, then 'you only' + Share; after sharing 'both sides' + Stop sharing", async () => {
    const backend = fake();
    const { container } = render(
      <BackendProvider backend={backend}>
        <CaptureControls />
      </BackendProvider>,
    );
    expect(container.textContent).toBe("");

    await act(async () => {
      const id = await backend.session.start();
      useTranscriptStore.getState().setSession({ state: "listening", session_id: id, started_at_unix_ms: 1 });
    });
    expect(screen.getByText("you only")).toBeInTheDocument();
    const share = screen.getByRole("button", { name: "Share call audio" });
    expect(share).toBeEnabled();

    await userEvent.click(share);
    expect(await screen.findByText("both sides")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stop sharing" })).toBeInTheDocument();

    // The share ends (tab closed): back to "you only" with the reason.
    const shareId = (await backend.capture.status()).find((s) => s.kind === "display")!.source_id;
    await act(async () => backend.setCapturePhase(shareId, "ended", "track ended"));
    expect(screen.getByText(/you only/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Share call audio" })).toBeInTheDocument();
    useTranscriptStore.getState().setSession({ state: "idle" });
  });

  it("disables Share with the reason when the display source is unavailable", async () => {
    const backend = new FakeBackend({
      sources: [
        { kind: "display", channels: ["remote_mix"], owner: "page", continuity: "page_lifetime", processing: ["hosted"], availability: { state: "unavailable", reason: "Hosted live transcription is not configured." } },
      ],
    });
    render(
      <BackendProvider backend={backend}>
        <CaptureControls />
      </BackendProvider>,
    );
    await act(async () => {
      const id = await backend.session.start();
      useTranscriptStore.getState().setSession({ state: "listening", session_id: id, started_at_unix_ms: 1 });
    });
    expect(screen.getByRole("button", { name: "Share call audio" })).toBeDisabled();
    expect(screen.getByText("call audio unavailable")).toBeInTheDocument();
    useTranscriptStore.getState().setSession({ state: "idle" });
  });
});

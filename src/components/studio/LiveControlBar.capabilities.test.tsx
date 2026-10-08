import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Availability } from "@/lib/capture/contract";

const availability: Record<string, Availability | null> = {};

vi.mock("@/lib/backend", () => ({
  useOperationAvailability: (op: string) => availability[op] ?? null,
}));

import { LiveControlBar } from "@/components/studio/LiveControlBar";
import { useAppStore } from "@/state/app";
import { useTranscriptStore } from "@/state/transcript";

const LISTENING = {
  state: "listening" as const,
  session_id: "s1",
  started_at_unix_ms: Date.now(),
};

describe("LiveControlBar — controls the platform can't do (#395, #396)", () => {
  beforeEach(() => {
    for (const k of Object.keys(availability)) delete availability[k];
    useTranscriptStore.setState({ session: LISTENING });
    useAppStore.setState({
      busy: false,
      lastError: null,
      idleStoppedMinutes: null,
      recording: false,
    });
  });

  it("disables Pause with the reason when the platform has no pause", () => {
    availability["session.pause"] = { state: "unsupported", reason: "No pause on web." };
    render(<LiveControlBar />);
    const pause = screen.getByRole("button", { name: /pause/i });
    expect(pause).toBeDisabled();
    expect(pause).toHaveAttribute("title", expect.stringContaining("No pause on web."));
  });

  it("keeps Pause working while listening when the platform supports it", () => {
    availability["session.pause"] = { state: "available" };
    render(<LiveControlBar />);
    expect(screen.getByRole("button", { name: /pause/i })).not.toBeDisabled();
  });

  it("keeps Pause working before the capability snapshot has loaded", () => {
    render(<LiveControlBar />);
    expect(screen.getByRole("button", { name: /pause/i })).not.toBeDisabled();
  });

  it("disables Record with an honest reason when recording is unsupported", () => {
    availability["recording.start"] = { state: "unsupported", reason: "No file access." };
    render(<LiveControlBar />);
    const record = screen.getByRole("button", { name: /record/i });
    expect(record).toBeDisabled();
    expect(record).toHaveAttribute("title", expect.stringContaining("No file access."));
  });

  it("leaves Record enabled while listening when recording is available", () => {
    availability["recording.start"] = { state: "available" };
    render(<LiveControlBar />);
    expect(screen.getByRole("button", { name: /record/i })).not.toBeDisabled();
  });
});

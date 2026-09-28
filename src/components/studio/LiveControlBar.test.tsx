import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { LiveControlBar } from "@/components/studio/LiveControlBar";
import { useAppStore } from "@/state/app";
import { useTranscriptStore } from "@/state/transcript";

describe("LiveControlBar — idle auto-stop status (lib/idleAutoStop.ts)", () => {
  beforeEach(() => {
    useTranscriptStore.setState({ session: { state: "idle" } });
    useAppStore.setState({
      busy: false,
      lastError: null,
      idleStoppedMinutes: null,
      recording: false,
    });
  });

  it("reports the idle stop and keeps Start listening enabled to resume", () => {
    useAppStore.setState({ idleStoppedMinutes: 5 });
    render(<LiveControlBar />);
    expect(
      screen.getByText(/Stopped after 5 min of inactivity — Start listening to resume\./i),
    ).toBeInTheDocument();
    const startButton = screen.getByRole("button", { name: /start listening/i });
    expect(startButton).not.toBeDisabled();
  });

  it("stays silent once listening again, even if the flag hasn't cleared yet", () => {
    useTranscriptStore.setState({
      session: { state: "listening", session_id: "s1", started_at_unix_ms: Date.now() },
    });
    useAppStore.setState({ idleStoppedMinutes: 5 });
    render(<LiveControlBar />);
    expect(screen.queryByText(/inactivity/i)).toBeNull();
  });

  it("a real error still takes priority over the idle-stop message", () => {
    useAppStore.setState({ idleStoppedMinutes: 5, lastError: "something else broke" });
    render(<LiveControlBar />);
    expect(screen.getByText("something else broke")).toBeInTheDocument();
    expect(screen.queryByText(/inactivity/i)).toBeNull();
  });
});

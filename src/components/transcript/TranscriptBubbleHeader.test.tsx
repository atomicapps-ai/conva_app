import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TranscriptBubbleHeader } from "@/components/transcript/TranscriptBubbleHeader";

afterEach(cleanup);

function renderHeader(
  overrides: Partial<ComponentProps<typeof TranscriptBubbleHeader>> = {},
) {
  const onToggleCollapse = vi.fn();
  const onResearch = vi.fn();
  render(
    <TranscriptBubbleHeader
      speakerLabel="Them"
      speakerTone="inbound"
      timeLabel="00:42"
      timeTitle="42 seconds into the session"
      isFinal
      collapsed={false}
      busy={false}
      onToggleCollapse={onToggleCollapse}
      onResearch={onResearch}
      {...overrides}
    />,
  );
  return { onToggleCollapse, onResearch };
}

describe("TranscriptBubbleHeader", () => {
  it("keeps speaker identity, time, and turn actions on one compact line", () => {
    renderHeader({ speakerLabel: "Sarah Kim" });

    expect(screen.getByText("Sarah Kim")).toHaveAttribute("title", "Sarah Kim");
    expect(screen.getByText("00:42")).toHaveAttribute(
      "title",
      "42 seconds into the session",
    );
    expect(screen.getByRole("button", { name: "Collapse turn" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Ask Ally about this turn" }),
    ).toBeInTheDocument();
  });

  it("is ready for anonymous and uncertain speaker labels", () => {
    const { rerender } = render(
      <TranscriptBubbleHeader
        speakerLabel="New voice"
        speakerTone="inbound"
        timeLabel="now"
        timeTitle="Live"
        isFinal={false}
        collapsed={false}
        busy={false}
        onToggleCollapse={() => {}}
        onResearch={() => {}}
      />,
    );
    expect(screen.getByText("New voice")).toBeInTheDocument();
    expect(screen.getByText("live")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();

    rerender(
      <TranscriptBubbleHeader
        speakerLabel="Possibly Sarah"
        speakerTone="inbound"
        timeLabel="01:08"
        timeTitle="68 seconds into the session"
        isFinal
        collapsed={false}
        busy={false}
        onToggleCollapse={() => {}}
        onResearch={() => {}}
      />,
    );
    expect(screen.getByText("Possibly Sarah")).toBeInTheDocument();
  });

  it("dispatches collapse and Ally actions", () => {
    const { onToggleCollapse, onResearch } = renderHeader();
    fireEvent.click(screen.getByRole("button", { name: "Collapse turn" }));
    fireEvent.click(screen.getByRole("button", { name: "Ask Ally about this turn" }));

    expect(onToggleCollapse).toHaveBeenCalledOnce();
    expect(onResearch).toHaveBeenCalledOnce();
  });

  it("disables the Ally action while its turn is busy", () => {
    renderHeader({ busy: true });
    expect(screen.getByRole("button", { name: "Ask Ally about this turn" })).toBeDisabled();
  });
});

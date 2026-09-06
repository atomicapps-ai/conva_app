import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  TranscriptBubbleHeader,
  type SpeakerHeaderInfo,
} from "@/components/transcript/TranscriptBubbleHeader";

afterEach(cleanup);

const NEW_VOICE: SpeakerHeaderInfo = { id: "voice-unknown", label: "New voice", kind: "anonymous" };
const NAMED: SpeakerHeaderInfo = { id: "voice-unknown", label: "Alex", kind: "named" };

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

describe("TranscriptBubbleHeader — speaker naming/correction (doc §6.4/§6.6)", () => {
  it("without a `speaker`/`onRename`, the label stays a plain non-interactive span (no regression)", () => {
    renderHeader({ speakerLabel: "New voice" });
    expect(screen.getByText("New voice")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /name or correct speaker/i }),
    ).toBeNull();
  });

  it("'You' never becomes editable even if speaker/onRename are supplied", () => {
    renderHeader({
      speakerLabel: "You",
      speakerTone: "outbound",
      speaker: { id: "you", label: "You", kind: "you" },
      onRename: vi.fn(),
    });
    expect(
      screen.queryByRole("button", { name: /name or correct speaker/i }),
    ).toBeNull();
  });

  it("an inbound voice with speaker+onRename becomes an accessible button", () => {
    renderHeader({ speakerLabel: "New voice", speaker: NEW_VOICE, onRename: vi.fn() });
    expect(
      screen.getByRole("button", { name: "New voice, unnamed — name or correct speaker" }),
    ).toBeInTheDocument();
  });

  it("a named voice's accessible name omits 'unnamed' and shows a confirmation mark", () => {
    renderHeader({ speakerLabel: "Alex", speaker: NAMED, onRename: vi.fn() });
    expect(
      screen.getByRole("button", { name: "Alex — name or correct speaker" }),
    ).toBeInTheDocument();
  });

  it("renders an uncertain assignment distinctly, never as a confident guess", () => {
    renderHeader({
      speakerLabel: "New voice",
      speaker: NEW_VOICE,
      onRename: vi.fn(),
      status: "uncertain",
    });
    const btn = screen.getByRole("button", { name: /name or correct speaker/i });
    expect(btn.className).toMatch(/italic/);
  });

  it("clicking the label opens the naming editor with a blank, placeholder-prefilled field for an anonymous voice", () => {
    renderHeader({ speakerLabel: "New voice", speaker: NEW_VOICE, onRename: vi.fn() });
    fireEvent.click(screen.getByRole("button", { name: /name or correct speaker/i }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Name this voice")).toBeInTheDocument();
    const input = screen.getByLabelText("Voice name") as HTMLInputElement;
    expect(input.value).toBe("");
    expect(input.placeholder).toBe("New voice");
  });

  it("clicking the label for a named voice prefills the field with its current name", () => {
    renderHeader({ speakerLabel: "Alex", speaker: NAMED, onRename: vi.fn() });
    fireEvent.click(screen.getByRole("button", { name: /name or correct speaker/i }));
    expect(screen.getByLabelText("Voice name")).toHaveValue("Alex");
  });

  it("Save submits the trimmed name and closes the editor", () => {
    const onRename = vi.fn();
    renderHeader({ speakerLabel: "New voice", speaker: NEW_VOICE, onRename });
    fireEvent.click(screen.getByRole("button", { name: /name or correct speaker/i }));
    fireEvent.change(screen.getByLabelText("Voice name"), { target: { value: "  Alex  " } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onRename).toHaveBeenCalledWith("Alex");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("Save with a blank field does not call onRename", () => {
    const onRename = vi.fn();
    renderHeader({ speakerLabel: "New voice", speaker: NEW_VOICE, onRename });
    fireEvent.click(screen.getByRole("button", { name: /name or correct speaker/i }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onRename).not.toHaveBeenCalled();
  });

  it("Cancel closes the editor without renaming", () => {
    const onRename = vi.fn();
    renderHeader({ speakerLabel: "New voice", speaker: NEW_VOICE, onRename });
    fireEvent.click(screen.getByRole("button", { name: /name or correct speaker/i }));
    fireEvent.change(screen.getByLabelText("Voice name"), { target: { value: "Alex" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onRename).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("Escape closes the editor without renaming", () => {
    const onRename = vi.fn();
    renderHeader({ speakerLabel: "New voice", speaker: NEW_VOICE, onRename });
    fireEvent.click(screen.getByRole("button", { name: /name or correct speaker/i }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onRename).not.toHaveBeenCalled();
  });

  it("the 'Remember for future conversations' toggle is present but disabled and off (doc §15 Phase B)", () => {
    renderHeader({ speakerLabel: "New voice", speaker: NEW_VOICE, onRename: vi.fn() });
    fireEvent.click(screen.getByRole("button", { name: /name or correct speaker/i }));
    const toggle = screen.getByRole("checkbox", { name: /remember for future conversations/i });
    expect(toggle).toBeDisabled();
    expect(toggle).not.toBeChecked();
    expect(screen.getByText(/coming soon/i)).toBeInTheDocument();
  });

  it("hides Merge/Forget when there is nothing to merge with and the voice isn't named", () => {
    renderHeader({ speakerLabel: "New voice", speaker: NEW_VOICE, onRename: vi.fn(), onSplit: vi.fn() });
    fireEvent.click(screen.getByRole("button", { name: /name or correct speaker/i }));
    expect(screen.queryByText("Merge with…")).toBeNull();
    expect(screen.queryByText("Forget")).toBeNull();
    expect(screen.getByText("Different voice from here")).toBeInTheDocument();
  });

  it("expands the merge list and calls onMerge with the chosen voice", () => {
    const onMerge = vi.fn();
    const other: SpeakerHeaderInfo = { id: "voice-manual-1", label: "Voice 2", kind: "anonymous" };
    renderHeader({
      speakerLabel: "New voice",
      speaker: NEW_VOICE,
      onRename: vi.fn(),
      onMerge,
      otherSpeakers: [other],
    });
    fireEvent.click(screen.getByRole("button", { name: /name or correct speaker/i }));
    fireEvent.click(screen.getByText("Merge with…"));
    fireEvent.click(screen.getByText("Voice 2"));
    expect(onMerge).toHaveBeenCalledWith("voice-manual-1");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("'Different voice from here' calls onSplit and closes the editor", () => {
    const onSplit = vi.fn();
    renderHeader({ speakerLabel: "New voice", speaker: NEW_VOICE, onRename: vi.fn(), onSplit });
    fireEvent.click(screen.getByRole("button", { name: /name or correct speaker/i }));
    fireEvent.click(screen.getByText("Different voice from here"));
    expect(onSplit).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("'Forget' only appears for a named voice and calls onForget", () => {
    const onForget = vi.fn();
    renderHeader({ speakerLabel: "Alex", speaker: NAMED, onRename: vi.fn(), onForget });
    fireEvent.click(screen.getByRole("button", { name: /name or correct speaker/i }));
    fireEvent.click(screen.getByText("Forget"));
    expect(onForget).toHaveBeenCalledTimes(1);
  });

  it("a still-streaming (non-final) turn's label is not editable, even with speaker+onRename", () => {
    renderHeader({
      speakerLabel: "New voice",
      speaker: NEW_VOICE,
      onRename: vi.fn(),
      isFinal: false,
    });
    expect(
      screen.queryByRole("button", { name: /name or correct speaker/i }),
    ).toBeNull();
  });
});

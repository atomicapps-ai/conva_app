import { beforeEach, describe, expect, it } from "vitest";

import type { TranscriptSegment } from "@/lib/ipc";
import type { AllyCard } from "@/state/ally";
import { useAllyStore } from "@/state/ally";
import { useConversationStore } from "@/state/conversation";
import { useTranscriptStore } from "@/state/transcript";

function seg(text: string): TranscriptSegment {
  return { text, is_final: true } as unknown as TranscriptSegment;
}

describe("conversation discard / + New (owner, 2026-08-21)", () => {
  beforeEach(() => {
    useTranscriptStore.setState({ segments: [], archived: [], retainHistory: false });
    useAllyStore.setState({ cards: [], capture: null });
    useConversationStore.setState({
      openId: null,
      title: null,
      linkedDocs: [],
      savePromptOpen: false,
      pendingNew: false,
      notice: null,
    });
  });

  it("discard fully resets the live pane — transcript, conversation, and Ally", () => {
    useTranscriptStore.setState({ segments: [seg("hello")], archived: [seg("old")] });
    useAllyStore.setState({ cards: [{ id: "a" } as unknown as AllyCard] });
    useConversationStore.setState({ openId: "c1", title: "T", savePromptOpen: true });

    useConversationStore.getState().discard();

    expect(useTranscriptStore.getState().segments).toEqual([]);
    expect(useTranscriptStore.getState().archived).toEqual([]);
    expect(useAllyStore.getState().cards).toEqual([]);
    const c = useConversationStore.getState();
    expect(c.openId).toBeNull();
    expect(c.savePromptOpen).toBe(false);
    expect(c.pendingNew).toBe(false);
  });

  it("+ New with unsaved content opens the save prompt instead of wiping", () => {
    useTranscriptStore.setState({ segments: [seg("hello")] });
    useConversationStore.getState().requestNew();
    const c = useConversationStore.getState();
    expect(c.savePromptOpen).toBe(true);
    expect(c.pendingNew).toBe(true);
    expect(useTranscriptStore.getState().segments).toHaveLength(1);
  });

  it("+ New with an empty pane resets immediately", () => {
    useConversationStore.getState().requestNew();
    expect(useConversationStore.getState().savePromptOpen).toBe(false);
  });

  it("cancelling the prompt clears the pending-new flag", () => {
    useTranscriptStore.setState({ segments: [seg("hello")] });
    useConversationStore.getState().requestNew();
    useConversationStore.getState().setSavePromptOpen(false);
    expect(useConversationStore.getState().pendingNew).toBe(false);
  });
});

import { beforeEach, describe, expect, it } from "vitest";

import {
  CLAIM_SNAPSHOT_CONTRACT_VERSION,
  type ClaimSnapshotEvent,
  type TranscriptSegment,
} from "@/lib/ipc";
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
      sourceSessionIds: [],
      claimSnapshots: [],
      savePromptOpen: false,
      pendingNew: false,
      notice: null,
    });
  });

  it("retains exact source-session ids and only the newest snapshot per session", () => {
    const snapshot = (revision: number): ClaimSnapshotEvent => ({
      contract_version: CLAIM_SNAPSHOT_CONTRACT_VERSION,
      session_id: "session-42",
      epoch: 0,
      revision,
      claims: [],
    });

    const state = useConversationStore.getState();
    state.recordSession({ state: "listening", session_id: "session-42", started_at_unix_ms: 1 });
    state.recordSession({ state: "paused", session_id: "session-42" });
    state.recordClaimSnapshot(snapshot(2));
    state.recordClaimSnapshot(snapshot(1));
    state.recordClaimSnapshot(snapshot(3));

    expect(useConversationStore.getState().sourceSessionIds).toEqual(["session-42"]);
    expect(useConversationStore.getState().claimSnapshots).toEqual([snapshot(3)]);
  });

  it("loads and clears persisted conversation linkage with the conversation", () => {
    const snapshot: ClaimSnapshotEvent = {
      contract_version: CLAIM_SNAPSHOT_CONTRACT_VERSION,
      session_id: "session-saved",
      epoch: 0,
      revision: 1,
      claims: [],
    };
    useConversationStore.getState().openConversation({
      id: "conv-1",
      title: "Saved",
      created_at_unix_ms: 1,
      updated_at_unix_ms: 2,
      segments: [],
      linked_docs: [],
      source_session_ids: ["session-saved"],
      claim_snapshots: [snapshot],
    });
    expect(useConversationStore.getState().sourceSessionIds).toEqual(["session-saved"]);
    expect(useConversationStore.getState().claimSnapshots).toEqual([snapshot]);

    useConversationStore.getState().newConversation();
    expect(useConversationStore.getState().sourceSessionIds).toEqual([]);
    expect(useConversationStore.getState().claimSnapshots).toEqual([]);
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

import { create } from "zustand";

import { getBackend } from "@/lib/backend";
import type { Conversation } from "@/lib/ipc";
import { useAllyStore } from "@/state/ally";
import { useGroundingStore } from "@/state/grounding";
import { useLiveTermsStore } from "@/state/liveTerms";
import { useTranscriptStore, withLiveArchived } from "@/state/transcript";

/**
 * The open (named, saved) conversation. While one is open, new listening
 * runs append to it on screen and re-saving replaces the stored record with
 * the fuller transcript — that's the append behavior. Library documents can
 * be linked to it; links persist with the record.
 */
interface ConversationState {
  /** Saved record id, once the conversation has been saved at least once. */
  openId: string | null;
  title: string | null;
  linkedDocs: string[];
  /** Stop offers to save; this drives the modal. */
  savePromptOpen: boolean;
  /** The save modal was opened by "+ New" — after Save (or Discard) the live
   *  pane resets for a fresh conversation instead of staying open. */
  pendingNew: boolean;
  notice: string | null;

  setSavePromptOpen: (open: boolean) => void;
  /**
   * "+ New" (owner, 2026-08-21): start a fresh conversation from the Live
   * view. With unsaved content on screen the save modal opens first
   * (Save / Discard / Cancel); with nothing on screen it resets immediately.
   */
  requestNew: () => void;
  /**
   * Fully reset the live pane (owner, 2026-08-21): transcript, open
   * conversation, and everything Ally (cards, captures, radar, tracker).
   * The raw run is untouched — sessions persist on-device regardless
   * (Sessions history).
   */
  discard: () => void;
  setNotice: (notice: string | null) => void;
  /** Pre-fill the save-dialog title (e.g. mark a rehearsal as a Sim Con). */
  setTitle: (title: string | null) => void;
  /** Show a loaded conversation and make it the open one. */
  openConversation: (conversation: Conversation) => void;
  /** Close the current conversation and clear the screen. */
  newConversation: () => void;
  toggleLinkedDoc: (docId: string) => Promise<void>;
  /**
   * Persist the full on-screen transcript (archived runs + the live run's
   * finals) under the open conversation id, or create one.
   */
  save: (title?: string) => Promise<void>;
}

export const useConversationStore = create<ConversationState>((set, get) => ({
  openId: null,
  title: null,
  linkedDocs: [],
  savePromptOpen: false,
  pendingNew: false,
  notice: null,

  setSavePromptOpen: (open) =>
    set(open ? { savePromptOpen: true } : { savePromptOpen: false, pendingNew: false }),

  requestNew: () => {
    const t = useTranscriptStore.getState();
    const hasContent =
      t.archived.length > 0 ||
      t.segments.some((s) => s.is_final && s.text.trim().length > 0);
    if (hasContent) {
      set({ savePromptOpen: true, pendingNew: true });
    } else {
      get().discard();
    }
  },

  discard: () => {
    get().newConversation();
    useAllyStore.getState().clear();
    set({ savePromptOpen: false, pendingNew: false, notice: null });
  },
  setNotice: (notice) => set({ notice }),
  setTitle: (title) => set({ title }),

  openConversation: (conversation) => {
    const transcript = useTranscriptStore.getState();
    transcript.loadConversation(conversation.segments);
    transcript.setRetainHistory(true);
    set({
      openId: conversation.id,
      title: conversation.title,
      linkedDocs: conversation.linked_docs,
      notice: null,
    });
  },

  newConversation: () => {
    const transcript = useTranscriptStore.getState();
    transcript.clear();
    transcript.setRetainHistory(false);
    useLiveTermsStore.getState().clear();
    set({ openId: null, title: null, linkedDocs: [], notice: null });
  },

  toggleLinkedDoc: async (docId) => {
    const linked = get().linkedDocs.includes(docId)
      ? get().linkedDocs.filter((id) => id !== docId)
      : [...get().linkedDocs, docId];
    set({ linkedDocs: linked });
    // An already-saved conversation persists the link change immediately;
    // an unsaved one carries it into the first save.
    if (get().openId) {
      try {
        await get().save();
      } catch (e) {
        set({ notice: String(e) });
      }
    }
  },

  save: async (title) => {
    const transcript = useTranscriptStore.getState();
    const segments = withLiveArchived(transcript.archived, transcript.segments);
    const saved = await getBackend().conversations.save(
      get().openId,
      title?.trim() || get().title,
      segments,
      get().linkedDocs,
      useGroundingStore.getState().activeId,
    );
    if (get().pendingNew) {
      // "+ New" flow: the save was a farewell — reset for a fresh start.
      get().discard();
      set({ notice: `Saved "${saved.title}".` });
      return;
    }
    transcript.setRetainHistory(true);
    set({
      openId: saved.id,
      title: saved.title,
      notice: `Saved "${saved.title}".`,
    });
  },
}));

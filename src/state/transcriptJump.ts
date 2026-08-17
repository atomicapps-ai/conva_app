import { create } from "zustand";

export interface TranscriptJumpRequest {
  /** `segmentKey`/turn key to scroll to and flash — see TranscriptView. */
  key: string;
  /** The search term to highlight (every occurrence, not just this turn)
   *  once the transcript lands — optional, omitted for non-search jumps. */
  query?: string;
}

interface TranscriptJumpState {
  pending: TranscriptJumpRequest | null;
  /** Queue a scroll+flash (and optional highlight) for next time
   *  TranscriptView mounts on the "live" view. */
  request: (key: string, query?: string) => void;
  /** Read-and-clear — call once on mount so a stale request can't replay on
   *  every subsequent visit. */
  consume: () => TranscriptJumpRequest | null;
}

/**
 * One-shot cross-navigation intent, same pattern as `contextsQuickOpen.ts` /
 * `libraryQuickAdd.ts`: Conversations' search results (owner request,
 * 2026-08-17) need to open a conversation/session AND land on the specific
 * matched turn, scrolled into view and flashed — without TranscriptView
 * taking props (it's mounted by view name only, see ViewRouter). Set the
 * conversation's segments into the transcript store first (`openConversation`
 * / `loadPastSession`), call `request(turnKey, query)`, then switch to the
 * "live" view — TranscriptView consumes this once on mount.
 */
export const useTranscriptJump = create<TranscriptJumpState>((set, get) => ({
  pending: null,
  request: (key, query) => set({ pending: { key, query } }),
  consume: () => {
    const req = get().pending;
    if (req) set({ pending: null });
    return req;
  },
}));

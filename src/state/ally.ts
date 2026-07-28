import { create } from "zustand";

import { ally as invokeAlly } from "@/lib/commands";
import type {
  AllyChunkEvent,
  AllyKind,
  AllySource,
  AllySourcesEvent,
  RadarEvent,
  TrackerEvent,
} from "@/lib/ipc";
import { useTranscriptStore } from "@/state/transcript";

export interface AllyCard {
  id: string;
  kind: AllyKind;
  question: string | null;
  text: string;
  done: boolean;
  error: string | null;
  sources: AllySource[];
  startedAtMs: number;
  /** Transcript bubble this answer researches (`"<side>-<seq>"`), if any —
   *  drives the connector line from the Ally column back to the bubble. */
  sourceKey: string | null;
  /** Short quote of the researched bubble, shown on the card. */
  sourceQuote: string | null;
}

interface AllyState {
  cards: AllyCard[];
  busy: boolean;
  /** Latest Question Radar hit (§6.2); replaced by each new question. */
  radar: RadarEvent | null;
  /** Cumulative session tracker state (§6.3). */
  tracker: TrackerEvent | null;

  request: (
    kind: AllyKind,
    question?: string,
    source?: { key: string; quote: string },
  ) => Promise<void>;
  applyChunk: (chunk: AllyChunkEvent) => void;
  applySources: (event: AllySourcesEvent) => void;
  applyRadar: (event: RadarEvent) => void;
  applyTracker: (event: TrackerEvent) => void;
  dismissRadar: () => void;
  clear: () => void;
}

let counter = 0;

export const useAllyStore = create<AllyState>((set, get) => ({
  cards: [],
  busy: false,
  radar: null,
  tracker: null,

  request: async (kind, question, source) => {
    if (get().busy) return;
    counter += 1;
    const id = `ally-${Date.now()}-${counter}`;
    set((s) => ({
      busy: true,
      // Keep the last few cards; newest first.
      cards: [
        {
          id,
          kind,
          question: question ?? null,
          text: "",
          done: false,
          error: null,
          sources: [],
          startedAtMs: Date.now(),
          sourceKey: source?.key ?? null,
          sourceQuote: source?.quote ?? null,
        },
        ...s.cards.slice(0, 5),
      ],
    }));
    try {
      // Ground Ally in the whole open conversation (earlier runs
      // included), not just the live run.
      const t = useTranscriptStore.getState();
      await invokeAlly(id, kind, question ?? null, [
        ...t.archived,
        ...t.segments,
      ]);
    } catch (e) {
      set((s) => ({
        busy: false,
        cards: s.cards.map((c) =>
          c.id === id ? { ...c, done: true, error: String(e) } : c,
        ),
      }));
    }
  },

  applyChunk: (chunk) =>
    set((s) => ({
      busy: chunk.done ? false : s.busy,
      cards: s.cards.map((c) =>
        c.id === chunk.request_id
          ? {
              ...c,
              text: c.text + chunk.token,
              done: chunk.done,
              error: chunk.error,
            }
          : c,
      ),
    })),

  applySources: (event) =>
    set((s) => ({
      cards: s.cards.map((c) =>
        c.id === event.request_id ? { ...c, sources: event.sources } : c,
      ),
    })),

  applyRadar: (event) => set({ radar: event }),

  applyTracker: (event) => set({ tracker: event }),

  dismissRadar: () => set({ radar: null }),

  clear: () => set({ cards: [], radar: null, tracker: null }),
}));

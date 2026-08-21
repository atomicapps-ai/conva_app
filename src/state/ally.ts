import { create } from "zustand";

import { getBackend } from "@/lib/backend";
import type {
  AllyChunkEvent,
  AllyKind,
  AllySource,
  AllySourcesEvent,
  CaptureEvent,
  RadarEvent,
  TrackerEvent,
} from "@/lib/ipc";
import { useTranscriptStore } from "@/state/transcript";

export interface AllyCard {
  id: string;
  /** Stable per-conversation number → the "A1/A2/A3" identity shared by the
   *  spine node, the card badge, and the bubble's "Linked to A#" chip. */
  seq: number;
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

/** Which content the live-call right panel shows by default (F12 — Live
 *  panel redesign, see docs/superpowers/specs/2026-08-21-live-panel-starred-
 *  board-design.md). `"starred"` is the board of starred cards; `"dock"` is
 *  the existing Summary/Threads/Grounding panel (`AllyMetaPanel`,
 *  unchanged). */
export type PanelMode = "starred" | "dock";

interface AllyState {
  cards: AllyCard[];
  busy: boolean;
  /** Latest Question Radar hit (§6.2); replaced by each new question. */
  radar: RadarEvent | null;
  /** Cumulative session tracker state (§6.3). */
  tracker: TrackerEvent | null;
  /** Cumulative FANER routed captures for the session (F11). */
  capture: CaptureEvent | null;
  /** Card ids the user has starred (F12). Starred cards are exempt from
   *  `cards`' rolling cap — see `request` below — so a board built over a
   *  long call never silently loses an entry once more questions get asked. */
  starred: Set<string>;
  /** Which content `RightPanelShell` shows by default. */
  panelMode: PanelMode;
  /** Right panel collapsed state — defaults to collapsed on entering a live
   *  call (F12 goal 1). */
  panelCollapsed: boolean;

  /** Kick off an Ally request. Resolves with the new card's id as soon as
   *  the card is created — NOT once the answer finishes streaming — so a
   *  caller can star it immediately; the loading state a starred card shows
   *  on the board comes from that early resolution, not from waiting for
   *  the backend call to finish. */
  request: (
    kind: AllyKind,
    question?: string,
    source?: { key: string; quote: string },
  ) => Promise<string>;
  applyChunk: (chunk: AllyChunkEvent) => void;
  applySources: (event: AllySourcesEvent) => void;
  applyRadar: (event: RadarEvent) => void;
  applyTracker: (event: TrackerEvent) => void;
  applyCapture: (event: CaptureEvent) => void;
  dismissRadar: () => void;
  clear: () => void;
  star: (id: string) => void;
  unstar: (id: string) => void;
  toggleStar: (id: string) => void;
  setPanelMode: (mode: PanelMode) => void;
  setPanelCollapsed: (collapsed: boolean) => void;
}

let counter = 0;

export const useAllyStore = create<AllyState>((set, get) => ({
  cards: [],
  busy: false,
  radar: null,
  tracker: null,
  capture: null,
  starred: new Set(),
  panelMode: "dock",
  panelCollapsed: false,

  request: async (kind, question, source) => {
    if (get().busy) return "";
    counter += 1;
    const id = `ally-${Date.now()}-${counter}`;
    const newCard: AllyCard = {
      id,
      seq: counter,
      kind,
      question: question ?? null,
      text: "",
      done: false,
      error: null,
      sources: [],
      startedAtMs: Date.now(),
      sourceKey: source?.key ?? null,
      sourceQuote: source?.quote ?? null,
    };
    set((s) => {
      // Keep every starred card regardless of age, plus the 5 most recent
      // UNstarred ones — otherwise a card the user starred early in a long
      // call would silently fall off this rolling window the moment 6 more
      // questions get asked, and vanish from their board.
      let keptUnstarred = 0;
      const survivors = s.cards.filter((c) => {
        if (s.starred.has(c.id)) return true;
        if (keptUnstarred < 5) {
          keptUnstarred += 1;
          return true;
        }
        return false;
      });
      return { busy: true, cards: [newCard, ...survivors] };
    });
    // Fire the backend call without blocking the id returned below — a
    // caller that wants to star this card right away (F12) needs the id as
    // soon as the card exists, not once the whole answer has streamed in.
    void (async () => {
      try {
        const t = useTranscriptStore.getState();
        await getBackend().ally.run(id, kind, question ?? null, [
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
    })();
    return id;
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
  applyCapture: (event) => set({ capture: event }),

  dismissRadar: () => set({ radar: null }),

  clear: () => {
    // Reset the A# counter so each conversation numbers from A1.
    counter = 0;
    set({ cards: [], radar: null, tracker: null, capture: null, starred: new Set() });
  },

  star: (id) => set((s) => ({ starred: new Set(s.starred).add(id) })),
  unstar: (id) =>
    set((s) => {
      const next = new Set(s.starred);
      next.delete(id);
      return { starred: next };
    }),
  toggleStar: (id) =>
    set((s) => {
      const next = new Set(s.starred);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { starred: next };
    }),
  setPanelMode: (mode) => set({ panelMode: mode }),
  setPanelCollapsed: (collapsed) => set({ panelCollapsed: collapsed }),
}));

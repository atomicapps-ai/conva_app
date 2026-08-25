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
  /** Plain-English summary of the answer (the card's collapsible "Summary"
   *  section, owner 2026-08-22). `null` = never requested; `""` = streaming. */
  summary: string | null;
}

/** Unique source file names, first-appearance order — the CLEAN citation
 *  line an answer card shows (owner, 2026-08-22: the raw per-chunk "file ·
 *  ¶57–68 · file · ¶17–36 …" wall is not for users). */
export function uniqueSourceFiles(sources: readonly AllySource[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of sources) {
    if (!seen.has(s.file_name)) {
      seen.add(s.file_name);
      out.push(s.file_name);
    }
  }
  return out;
}

/** Sources grouped per file ("file — ¶1–16, ¶17–36") for the detail views
 *  (thread viewer) where the passage locations genuinely matter. */
export function groupSourcesByFile(
  sources: readonly AllySource[],
): { file: string; locations: string[] }[] {
  const order: string[] = [];
  const by = new Map<string, string[]>();
  for (const s of sources) {
    if (!by.has(s.file_name)) {
      by.set(s.file_name, []);
      order.push(s.file_name);
    }
    const locs = by.get(s.file_name)!;
    if (!locs.includes(s.location)) locs.push(s.location);
  }
  return order.map((file) => ({ file, locations: by.get(file)! }));
}

/** Chunk-stream id prefix that routes into a card's `summary` instead of its
 *  answer text (the Summarize action). */
const SUMMARY_PREFIX = "sum:";

interface AllyState {
  cards: AllyCard[];
  busy: boolean;
  /** Latest Question Radar hit (§6.2); replaced by each new question. */
  radar: RadarEvent | null;
  /** Cumulative session tracker state (§6.3). */
  tracker: TrackerEvent | null;
  /** Cumulative FANER routed captures for the session (F11). */
  capture: CaptureEvent | null;

  request: (
    kind: AllyKind,
    question?: string,
    source?: { key: string; quote: string },
  ) => Promise<void>;
  /** Summarize an existing card's answer into its collapsible Summary
   *  section (a second LLM pass streamed via a `sum:`-prefixed request). */
  summarize: (cardId: string) => Promise<void>;
  applyChunk: (chunk: AllyChunkEvent) => void;
  applySources: (event: AllySourcesEvent) => void;
  applyRadar: (event: RadarEvent) => void;
  applyTracker: (event: TrackerEvent) => void;
  applyCapture: (event: CaptureEvent) => void;
  dismissRadar: () => void;
  clear: () => void;
}

let counter = 0;

export const useAllyStore = create<AllyState>((set, get) => ({
  cards: [],
  busy: false,
  radar: null,
  tracker: null,
  capture: null,

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
          summary: null,
        },
        // Keep enough history for several partner-window tabs' answers to
        // coexist (spec §4.1) — the newest 12, not 6.
        ...s.cards.slice(0, 11),
      ],
    }));
    try {
      // Ground Ally in the whole open conversation (earlier runs
      // included), not just the live run.
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
  },

  summarize: async (cardId) => {
    if (get().busy) return;
    const card = get().cards.find((c) => c.id === cardId);
    if (!card || !card.text.trim()) return;
    // "" (not null) = summarizing — the card shows the section immediately.
    set((s) => ({
      busy: true,
      cards: s.cards.map((c) => (c.id === cardId ? { ...c, summary: "" } : c)),
    }));
    try {
      await getBackend().ally.run(
        `${SUMMARY_PREFIX}${cardId}`,
        "question",
        `Summarize the following answer as 2–3 short, plain-English bullet points a reader can scan mid-conversation. No preamble, no headings.\n\n${card.text}`,
        [],
      );
    } catch (e) {
      set((s) => ({
        busy: false,
        cards: s.cards.map((c) =>
          c.id === cardId ? { ...c, summary: `Summary failed: ${String(e)}` } : c,
        ),
      }));
    }
  },

  applyChunk: (chunk) => {
    // A `sum:`-prefixed stream feeds the target card's Summary section.
    if (chunk.request_id.startsWith(SUMMARY_PREFIX)) {
      const target = chunk.request_id.slice(SUMMARY_PREFIX.length);
      set((s) => ({
        busy: chunk.done ? false : s.busy,
        cards: s.cards.map((c) =>
          c.id === target
            ? {
                ...c,
                summary:
                  chunk.error != null
                    ? `Summary failed: ${chunk.error}`
                    : (c.summary ?? "") + chunk.token,
              }
            : c,
        ),
      }));
      return;
    }
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
    }));
  },

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
    set({ cards: [], radar: null, tracker: null, capture: null });
  },
}));

import {
  buildTermChips,
  type TermChip,
} from "@/components/transcript/terms";
import type {
  Capture,
  RadarEvent,
  TrackedCommitment,
  TrackedEntity,
  TrackerEvent,
} from "@/lib/ipc";

/**
 * The Found half's supply (live-panel re-scope spec §3.2): everything the
 * AI surfaced from the call, grouped in urgency order — Questions (radar),
 * Commitments (tracker), Terms (FANER/RAG chips), Mentions (tracker
 * entities). Pure; the panel selects items from here into the View half.
 */
export interface FoundItem {
  /** Stable select/dedupe key ("q-…", "c-…", "t-…", "m-…"). */
  id: string;
  group: "question" | "commitment" | "term" | "mention";
  label: string;
  /** Secondary line — commitment "who · due …", mention detail. */
  detail: string | null;
  /** Term items only — the underlying chip (carries the FANER capture). */
  chip?: TermChip;
  /** Question items only — the radar hit (question + instant sources). */
  radar?: RadarEvent;
  commitment?: TrackedCommitment;
  entity?: TrackedEntity;
}

export interface FoundGroups {
  questions: FoundItem[];
  commitments: FoundItem[];
  terms: FoundItem[];
  mentions: FoundItem[];
}

export function buildFoundGroups(args: {
  radarHistory: readonly RadarEvent[];
  tracker: TrackerEvent | null;
  captures: readonly Capture[];
  liveTerms: readonly string[];
  docTerms: readonly string[];
}): FoundGroups {
  const questions: FoundItem[] = args.radarHistory.map((r) => ({
    id: `q-${r.question.trim().toLowerCase()}`,
    group: "question",
    label: r.question,
    detail: null,
    radar: r,
  }));

  const commitments: FoundItem[] = (args.tracker?.commitments ?? []).map(
    (c) => ({
      id: `c-${c.who}-${c.what.trim().toLowerCase()}`,
      group: "commitment",
      label: c.what,
      detail: `${c.who === "you" ? "you" : "them"}${c.due ? ` · due ${c.due}` : ""}`,
      commitment: c,
    }),
  );

  const chips = buildTermChips(args.captures, args.liveTerms, args.docTerms);
  const terms: FoundItem[] = [...chips.detected, ...chips.docs].map((chip) => ({
    id: `t-${chip.id}`,
    group: "term",
    label: chip.label,
    detail: null,
    chip,
  }));
  const termLabels = new Set(terms.map((t) => t.label.toLowerCase()));

  const mentions: FoundItem[] = (args.tracker?.entities ?? [])
    .filter((e) => !termLabels.has(e.label.trim().toLowerCase()))
    .map((e) => ({
      id: `m-${e.label.trim().toLowerCase()}`,
      group: "mention",
      label: e.label,
      detail: e.detail || null,
      entity: e,
    }));

  return { questions, commitments, terms, mentions };
}

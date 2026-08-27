import {
  buildTermChips,
  type TermChip,
} from "@/components/transcript/terms";
import type { PrepQaPair } from "@/components/transcript/qaPairs";
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
  /** Stable select/dedupe key ("q-…", "c-…", "t-…", "m-…", "p-…"). */
  id: string;
  group: "question" | "commitment" | "term" | "mention" | "prep";
  label: string;
  /** Secondary line — commitment "who · due …", mention detail; for a prep
   *  pair this is the FULL prepared answer (the View card shows it). */
  detail: string | null;
  /** Term items only — the underlying chip (carries the FANER capture). */
  chip?: TermChip;
  /** Question items only — the radar hit (question + instant sources). */
  radar?: RadarEvent;
  commitment?: TrackedCommitment;
  entity?: TrackedEntity;
  /** Prep items only — the prepared pair (theme + source doc). */
  prep?: PrepQaPair;
}

export interface FoundGroups {
  questions: FoundItem[];
  commitments: FoundItem[];
  terms: FoundItem[];
  mentions: FoundItem[];
  /** Prep Q&A pairs (Questions split-source spec, 2026-08-27) — the
   *  Questions section's PREP mode; never mixed into the live feed. */
  prepQa: FoundItem[];
}

export function buildFoundGroups(args: {
  radarHistory: readonly RadarEvent[];
  tracker: TrackerEvent | null;
  captures: readonly Capture[];
  liveTerms: readonly string[];
  docTerms: readonly string[];
  /** term → cached definition (spec 2026-08-26); threaded to buildTermChips
   *  so a doc term's FoundItem carries it as `detail`. */
  docDefinitions?: Record<string, string>;
  /** Prepared Q&A pairs from the grounded context's documents (split-source
   *  spec 2026-08-27); omitted → empty PREP mode. */
  prepQa?: readonly PrepQaPair[];
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

  const chips = buildTermChips(
    args.captures,
    args.liveTerms,
    args.docTerms,
    args.docDefinitions,
  );
  const terms: FoundItem[] = [...chips.detected, ...chips.docs].map((chip) => ({
    id: `t-${chip.id}`,
    group: "term",
    label: chip.label,
    detail: chip.definition ?? null,
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

  const prepQa: FoundItem[] = (args.prepQa ?? []).map((p) => ({
    id: `p-${p.question.trim().toLowerCase()}`,
    group: "prep",
    label: p.question,
    detail: p.answer,
    prep: p,
  }));

  return { questions, commitments, terms, mentions, prepQa };
}

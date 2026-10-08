import type { FoundItem } from "@/components/transcript/foundGroups";
import type { GridPayload, LiveAssistResult, ViewChoice } from "@/lib/ipc";
import type { PanelSectionId } from "@/components/transcript/panelSections";
import { uniqueSourceFiles, type AllyCard } from "@/state/ally";

export const TERM_DEFINITION_REQUEST_PREFIX = "term-definition:";

export type AllyFocusStatus = "instant" | "streaming" | "ready" | "error";

/** Maps a `FoundItem`/`AllyFocusItem` group to the Active (3) panel section
 *  it belongs under — the same mapping the cockpit uses to keep Active (3)
 *  and View (4) in sync, and what View (4) uses for a tab's icon/colour. */
export function sectionOfGroup(group: FoundItem["group"]): PanelSectionId {
  if (group === "question" || group === "prep") return "questions";
  if (group === "commitment" || group === "mention") return "tracking";
  return "terms";
}

/** One labelled fact row ("Who · You") View (4) shows under a tracking item. */
export interface AllyFocusFact {
  label: string;
  value: string;
}

export interface AllyFocusItem {
  id: string;
  /** Which `FoundItem` group this is — drives View's outer type-tab and the
   *  "Question"/"Definition"/"Detail" answer-section label (owner,
   *  2026-09-28). */
  group: FoundItem["group"];
  question: string;
  answer: string;
  sourceLabel: string;
  /** Human-readable grounding files kept beside the focused answer. */
  sourceFiles?: string[];
  status: AllyFocusStatus;
  cardId?: string;
  /** The originating `FoundItem.id`, when this item was built directly from
   *  one (an instant radar hit, a term's cached definition, a tracking
   *  item) rather than a streamed Ally card. */
  foundId?: string;
  /** FANER's tier for a captured term — decides how much View (4) writes:
   *  a quick refresher (`field`) or a fuller entry (`specialized`). */
  tier?: "field" | "specialized";
  /** FANER's kind for a captured term. A `problem` leads with the fix. */
  kind?: "concept" | "problem";
  /** Labelled facts (a commitment's who / when). */
  facts?: AllyFocusFact[];
  /** A computed grid answer (spreadsheet totals). `answer` still holds the
   *  speakable Say-now line, so anything that ignores `table` degrades to text. */
  table?: GridPayload;
  /** A question waiting on the user's pick (which column, which file). */
  choice?: ViewChoice;
  /** A newer question replaced this live-assist result. */
  stale?: boolean;
  /** The live-assist result behind this item, when there is one. Main window
   *  only: the partner window answers a choice by item id instead. */
  resultId?: string;
}

export function isTermDefinitionCard(
  card: Pick<AllyCard, "id" | "presentation">,
): boolean {
  return (
    card.presentation === "term" ||
    card.id.startsWith(TERM_DEFINITION_REQUEST_PREFIX)
  );
}

export function makeTermDefinitionRequestId(
  term: string,
  nowMs: number,
  sequence: number,
): string {
  const slug = term
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 32);
  return `${TERM_DEFINITION_REQUEST_PREFIX}${nowMs}:${sequence}:${slug || "term"}`;
}

function itemFromCard(card: AllyCard): AllyFocusItem {
  const question =
    card.sourceQuote?.trim() ||
    card.question?.trim() ||
    (card.kind === "summarize" ? "Summarize this conversation" : "Ally response");
  return {
    id: `card:${card.id}`,
    group: isTermDefinitionCard(card) ? "term" : "question",
    question,
    answer: card.error ?? card.text,
    sourceLabel: `A${card.seq}`,
    sourceFiles: uniqueSourceFiles(card.sources),
    status: card.error ? "error" : card.done ? "ready" : "streaming",
    cardId: card.id,
  };
}

/** Builds a View item directly from a `FoundItem` — the "instant" content
 *  shown the moment something is selected in Active, before (or absent)
 *  any fuller Ally elaboration. */
function itemFromFoundItem(item: FoundItem): AllyFocusItem | null {
  if (item.group === "prep" && item.prep) {
    return {
      id: `found:${item.id}`,
      group: "prep",
      question: item.label,
      answer: item.prep.answer,
      sourceLabel: item.prep.source === "ally" ? "Prepared by Ally" : item.prep.source,
      sourceFiles: item.prep.source === "ally" ? [] : [item.prep.source],
      status: "instant",
      foundId: item.id,
    };
  }
  if (item.group === "question" && item.radar) {
    return {
      id: `found:${item.id}`,
      group: "question",
      question: item.label,
      answer: item.radar.bridge.text,
      sourceLabel:
        item.radar.outcome === "miss" ? "Question Radar · refining" : "Question Radar",
      sourceFiles: [...new Set(item.radar.sources.map((source) => source.file_name))],
      status: "instant",
      foundId: item.id,
    };
  }
  if (item.group === "term" || item.group === "commitment" || item.group === "mention") {
    const capture = item.chip?.capture;
    const facts: AllyFocusFact[] = [];
    if (item.commitment) {
      facts.push({
        label: "Who",
        value: item.commitment.who === "you" ? "You" : "Them",
      });
      if (item.commitment.due) facts.push({ label: "When", value: item.commitment.due });
    }
    return {
      id: `found:${item.id}`,
      group: item.group,
      question: item.label,
      answer: item.detail ?? capture?.preview ?? "No detail yet — Elaborate for one.",
      sourceLabel:
        item.group === "term" ? "Term" : item.group === "commitment" ? "Commitment" : "Mentioned",
      sourceFiles: [],
      status: item.detail || capture?.preview ? "instant" : "ready",
      foundId: item.id,
      ...(capture?.tier ? { tier: capture.tier } : {}),
      ...(capture?.kind ? { kind: capture.kind } : {}),
      ...(facts.length > 0 ? { facts } : {}),
    };
  }
  return null;
}

const ASSIST_STATUS: Record<LiveAssistResult["lifecycle"], AllyFocusStatus> = {
  provisional: "streaming",
  needs_choice: "instant",
  complete: "ready",
  declined: "ready",
  failed: "error",
  superseded: "ready",
};

/**
 * The View item for a live-assist result. Heard questions take the identity
 * of their Questions-list row (`found:q-<turn id>`, the radar's own turn id),
 * so clicking that row shows the grid instead of the radar bridge; typed
 * questions get their own `assist:` item.
 */
export function itemFromLiveAssist(result: LiveAssistResult): AllyFocusItem {
  const payload = result.payload ?? null;
  const heard = result.correlation_id.includes(":them:");
  const text = payload?.type === "text" ? payload.text : "";
  const sayNow = result.say_now?.trim() ?? "";
  // Say now first; any longer explanation follows as the body.
  const answer =
    result.lifecycle === "failed" || result.lifecycle === "declined"
      ? [sayNow, text].filter(Boolean).join("\n\n")
      : result.lifecycle === "provisional"
        ? [sayNow, text].filter(Boolean).join("\n\n")
        : sayNow;
  let table: GridPayload | undefined;
  if (payload?.type === "grid") {
    const { type: _type, ...grid } = payload;
    table = grid;
  }
  const choice: ViewChoice | undefined =
    payload?.type === "choice"
      ? { question: payload.question, options: payload.options }
      : undefined;
  return {
    id: heard ? `found:q-${result.correlation_id}` : `assist:${result.result_id}`,
    group: "question",
    question: result.question,
    answer,
    sourceLabel: "Table answer",
    sourceFiles: table?.source_files ?? [],
    status: ASSIST_STATUS[result.lifecycle],
    ...(heard ? { foundId: `q-${result.correlation_id}` } : {}),
    ...(table ? { table } : {}),
    ...(choice ? { choice } : {}),
    ...(result.lifecycle === "superseded" ? { stale: true } : {}),
    resultId: result.result_id,
  };
}

/**
 * All material eligible for the View panel — Questions, Terms, and Tracking
 * alike (owner, 2026-09-28; term definitions used to be excluded here and
 * shown only in a separate Term Peek popover — that separation is retired).
 * `activeItems` is Active's current per-type selection
 * (`Object.values(activeByType)`); `cards` are the streamed Ally
 * cards/answers. Elaborating an instant `FoundItem`-derived entry opens a
 * new, separately-tabbed card alongside it rather than replacing it in
 * place — the same "each ask is its own thread" behavior Questions already
 * had, now shared by every type (`card:`/`found:` id prefixes keep the two
 * sources from ever colliding).
 */
export function buildAllyFocusItems(
  cards: readonly AllyCard[],
  activeItems: readonly FoundItem[],
  assist: readonly LiveAssistResult[] = [],
): AllyFocusItem[] {
  const items: AllyFocusItem[] = [];
  const seen = new Set<string>();

  // Computed answers first (newest first, like cards). A heard question's
  // result shares its id with that question's radar item, so the radar item
  // below is skipped and the row shows the grid.
  for (const result of [...assist].reverse()) {
    const item = itemFromLiveAssist(result);
    if (seen.has(item.id)) continue;
    items.push(item);
    seen.add(item.id);
  }

  for (const card of cards) {
    const item = itemFromCard(card);
    items.push(item);
    seen.add(item.id);
  }

  for (const found of activeItems) {
    const item = itemFromFoundItem(found);
    if (!item || seen.has(item.id)) continue;
    items.push(item);
    seen.add(item.id);
  }

  return items;
}

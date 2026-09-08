import type { ViewEntry } from "@/components/transcript/viewEntries";
import { uniqueSourceFiles, type AllyCard } from "@/state/ally";

export const TERM_DEFINITION_REQUEST_PREFIX = "term-definition:";

export type AllyFocusStatus = "instant" | "streaming" | "ready" | "error";

export interface AllyFocusItem {
  id: string;
  question: string;
  answer: string;
  sourceLabel: string;
  /** Human-readable grounding files kept beside the focused answer. */
  sourceFiles?: string[];
  status: AllyFocusStatus;
  cardId?: string;
  entryKey?: string;
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
    question,
    answer: card.error ?? card.text,
    sourceLabel: `A${card.seq}`,
    sourceFiles: uniqueSourceFiles(card.sources),
    status: card.error ? "error" : card.done ? "ready" : "streaming",
    cardId: card.id,
  };
}

function itemFromEntry(entry: ViewEntry): AllyFocusItem | null {
  if (entry.item.group === "prep" && entry.item.prep) {
    return {
      id: `entry:${entry.key}`,
      question: entry.item.label,
      answer: entry.item.prep.answer,
      sourceLabel:
        entry.item.prep.source === "ally"
          ? "Prepared by Ally"
          : entry.item.prep.source,
      sourceFiles:
        entry.item.prep.source === "ally" ? [] : [entry.item.prep.source],
      status: "instant",
      entryKey: entry.key,
    };
  }
  if (entry.item.group === "question" && entry.item.radar) {
    return {
      id: `entry:${entry.key}`,
      question: entry.item.label,
      answer: entry.item.radar.bridge.text,
      sourceLabel:
        entry.item.radar.outcome === "miss" ? "Question Radar · refining" : "Question Radar",
      sourceFiles: [
        ...new Set(entry.item.radar.sources.map((source) => source.file_name)),
      ],
      status: "instant",
      entryKey: entry.key,
    };
  }
  return null;
}

/**
 * Question/answer material eligible for the Focus canvas. Term definition
 * requests deliberately stay out of this list and out of the Answers archive.
 */
export function buildAllyFocusItems(
  cards: readonly AllyCard[],
  entries: readonly ViewEntry[],
): AllyFocusItem[] {
  const items: AllyFocusItem[] = [];
  const seen = new Set<string>();

  for (const card of cards) {
    if (isTermDefinitionCard(card)) continue;
    const item = itemFromCard(card);
    items.push(item);
    seen.add(item.id);
  }

  for (const entry of entries) {
    const item = itemFromEntry(entry);
    if (!item || seen.has(item.id)) continue;
    items.push(item);
    seen.add(item.id);
  }

  return items;
}

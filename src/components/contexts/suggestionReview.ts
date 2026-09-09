import type { SuggestionDecision } from "@/lib/ipc";

export type SuggestionSection = "overview" | "qa" | "briefing" | "research";

/** Stable FNV-1a key: generated text is the identity, so a changed Ally
 * proposal correctly returns as a new pending suggestion. */
export function suggestionKey(section: SuggestionSection, value: string): string {
  let hash = 0x811c9dc5;
  const input = `${section}\0${value.trim()}`;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${section}-${(hash >>> 0).toString(36)}`;
}

export function visibleSuggestionValue(
  generated: string,
  decision?: SuggestionDecision,
): string {
  return decision?.edited_value?.trim() || generated;
}

export function isPending(decision?: SuggestionDecision): boolean {
  return decision == null;
}


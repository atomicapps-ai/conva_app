/**
 * Pure content model for View (4) (owner-approved mockup, 2026-09-29):
 * every item is presented as **Say now** (the one or two sentences you can
 * read aloud) → the rest of the answer → sources. Nothing is hidden — the
 * rest is always shown in full, never behind a "show more".
 */

export interface AnswerParts {
  /** The at-a-glance line(s). May carry inline markdown (`**bold**`). */
  sayNow: string;
  /** The remainder of the answer above the `---` line (markdown). */
  points: string;
  /** Deeper background below a `---` line (markdown), when present. */
  background: string;
}

const BULLET = /^\s*(?:[-*•]|\d+[.)])\s+(.*)$/;
const MAX_SAY_NOW = 240;

/** Split an Ally answer at the `---` line the research prompt asks for. */
function splitBackground(text: string): { answer: string; background: string } {
  const m = text.match(/\n[ \t]*-{3,}[ \t]*(?:\n|$)/);
  if (!m || m.index === undefined) return { answer: text.trim(), background: "" };
  return {
    answer: text.slice(0, m.index).trim(),
    background: text.slice(m.index + m[0].length).trim(),
  };
}

/** Up to two sentences of `paragraph`, capped at [`MAX_SAY_NOW`] chars. */
function leadSentences(paragraph: string): { lead: string; rest: string } {
  const flat = paragraph.replace(/\s+/g, " ").trim();
  const sentences = flat.match(/[^.!?]+(?:[.!?]+(?=\s|$)|$)/g) ?? [flat];
  let lead = "";
  let used = 0;
  for (const raw of sentences) {
    const sentence = raw.trim();
    if (!sentence) continue;
    if (used > 0 && lead.length + 1 + sentence.length > MAX_SAY_NOW) break;
    lead = lead ? `${lead} ${sentence}` : sentence;
    used += 1;
    if (used === 2 || lead.length >= MAX_SAY_NOW) break;
  }
  if (!lead) lead = flat;
  if (lead.length > MAX_SAY_NOW && used <= 1) {
    // One very long sentence: keep it whole rather than cutting mid-word.
    return { lead, rest: flat.slice(lead.length).trim() };
  }
  return { lead, rest: flat.slice(lead.length).trim() };
}

export function splitAnswer(text: string): AnswerParts {
  const { answer, background } = splitBackground(text ?? "");
  if (!answer) return { sayNow: "", points: "", background };

  const lines = answer.split("\n");
  // Skip leading blank lines and bare headings ("### Answer").
  let i = 0;
  while (i < lines.length && (lines[i]!.trim() === "" || /^#{1,4}\s/.test(lines[i]!))) i++;
  if (i >= lines.length) return { sayNow: "", points: "", background };

  const first = lines[i]!;
  const bullet = first.match(BULLET);
  if (bullet) {
    return {
      sayNow: (bullet[1] ?? "").trim(),
      points: lines.slice(i + 1).join("\n").trim(),
      background,
    };
  }

  // Prose: first paragraph up to a blank line.
  let end = i;
  while (end < lines.length && lines[end]!.trim() !== "") end++;
  const paragraph = lines.slice(i, end).join(" ");
  const { lead, rest } = leadSentences(paragraph);
  const tail = lines.slice(end).join("\n").trim();
  return {
    sayNow: lead,
    points: [rest, tail].filter(Boolean).join("\n\n").trim(),
    background,
  };
}

/** The eyebrow above the "Say now" callout — a problem leads with the fix. */
export function sayNowLabel(item: {
  group: "question" | "commitment" | "term" | "mention" | "prep";
  kind?: "concept" | "problem";
}): string {
  if (item.group === "term") return item.kind === "problem" ? "The fix" : "Definition";
  if (item.group === "commitment") return "Commitment";
  if (item.group === "mention") return "Detail";
  return "Say now";
}

/** The eyebrow above the rest of the answer. */
export function pointsLabel(item: {
  group: "question" | "commitment" | "term" | "mention" | "prep";
  kind?: "concept" | "problem";
}): string {
  if (item.group === "term") return item.kind === "problem" ? "What it is" : "More";
  if (item.group === "commitment" || item.group === "mention") return "More";
  return "Key points";
}

/** Plain-text talking points for the Copy button. */
export function talkingPoints(parts: AnswerParts): string {
  const strip = (s: string) => s.replace(/\*\*(.+?)\*\*/g, "$1").replace(/`([^`]+)`/g, "$1");
  return [parts.sayNow, parts.points]
    .filter(Boolean)
    .map(strip)
    .join("\n\n")
    .trim();
}

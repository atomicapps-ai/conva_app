/**
 * Prep Q&A parsing (Questions split-source spec, 2026-08-27): the Questions
 * accordion section's PREP mode lists question+answer pairs prepared BEFORE
 * the call — Ally's generated Interview Q&A document plus any attached
 * document the user wrote in a Q/A format. Pure; loaded by the cockpit's
 * grounding effect at context activation, never on the audio path.
 */
export interface PrepQaPair {
  question: string;
  answer: string;
  /** The document's own `##` theme heading ("Behavioral", …), when present. */
  theme: string | null;
  /** "ally" for the generated Q&A doc; the file name for a user document. */
  source: string;
}

const MAX_Q_CHARS = 300;
const MAX_A_CHARS = 4000;

function clean(s: string): string {
  return s.trim().replace(/\s+/g, " ");
}

function push(
  out: PrepQaPair[],
  seen: Set<string>,
  question: string,
  answer: string,
  theme: string | null,
  source: string,
): void {
  const q = clean(question).slice(0, MAX_Q_CHARS);
  const a = answer.trim().slice(0, MAX_A_CHARS);
  if (!q || !a) return;
  const key = q.toLowerCase();
  if (seen.has(key)) return;
  seen.add(key);
  out.push({ question: q, answer: a, theme, source });
}

/**
 * Parse a document's text for Q&A pairs. Two forms, matching what the
 * generated Q&A document emits and what a hand-written prep sheet looks
 * like:
 *
 * 1. The canonical bullet `**Q: <question>** A: <answer>` (what
 *    `interview_qa_prompt` instructs, and what `buildQaMarkdown` writes) —
 *    the answer runs to the next bullet/heading/blank-gap.
 * 2. Loose consecutive lines `Q: <question>` then `A: <answer>` (a plain
 *    prep sheet), the answer running until the next `Q:` line or heading.
 *
 * `## <theme>` headings group the pairs that follow them. Pairs are
 * de-duplicated by normalized question text — first occurrence wins.
 */
export function parseQaPairs(text: string, source: string): PrepQaPair[] {
  const out: PrepQaPair[] = [];
  const seen = new Set<string>();
  const lines = text.split("\n");
  let theme: string | null = null;

  let i = 0;
  while (i < lines.length) {
    const raw = lines[i] ?? "";
    const line = raw.trim();

    const heading = /^#{1,4}\s+(.*)$/.exec(line);
    if (heading?.[1]) {
      theme = clean(heading[1]) || null;
      i += 1;
      continue;
    }

    // Form 1 — bold bullet: **Q: ...** A: ... (answer may span lines).
    const bulletBody = line.replace(/^[-*+•]\s*/, "");
    const bold = /^\*\*\s*Q\s*[:.]\s*(.+?)\s*\*\*\s*(?:A\s*[:.]\s*)?(.*)$/i.exec(
      bulletBody,
    );
    if (bold?.[1] !== undefined) {
      const question = bold[1];
      const answerParts: string[] = [];
      if (bold[2]) answerParts.push(bold[2].trim());
      i += 1;
      while (i < lines.length) {
        const next = (lines[i] ?? "").trim();
        if (
          /^#{1,4}\s+/.test(next) ||
          /^[-*+•]?\s*\*\*\s*Q\s*[:.]/i.test(next) ||
          /^Q\s*[:.]\s*/i.test(next)
        ) {
          break;
        }
        if (next) answerParts.push(next);
        i += 1;
      }
      push(out, seen, question, answerParts.join(" "), theme, source);
      continue;
    }

    // Form 2 — loose "Q: ..." line followed by "A: ..." line(s).
    const looseQ = /^Q\s*[:.]\s*(.+)$/i.exec(bulletBody);
    if (looseQ?.[1]) {
      const question = looseQ[1];
      i += 1;
      // Skip blank lines between Q and A.
      while (i < lines.length && !(lines[i] ?? "").trim()) i += 1;
      const answerLine = (lines[i] ?? "").trim().replace(/^[-*+•]\s*/, "");
      const looseA = /^A\s*[:.]\s*(.*)$/i.exec(answerLine);
      if (looseA) {
        const answerParts: string[] = [];
        if (looseA[1]) answerParts.push(looseA[1].trim());
        i += 1;
        while (i < lines.length) {
          const next = (lines[i] ?? "").trim();
          if (/^#{1,4}\s+/.test(next) || /^[-*+•]?\s*(\*\*)?\s*Q\s*[:.]/i.test(next)) {
            break;
          }
          if (next) answerParts.push(next);
          i += 1;
        }
        push(out, seen, question, answerParts.join(" "), theme, source);
        continue;
      }
      continue; // Q with no A — skip it, keep scanning from the non-A line.
    }

    i += 1;
  }

  return out;
}

/**
 * Parse the context-setup "Import Q&A" paste (spec 2026-08-27, owner):
 * one pair per line, `question|answer`. Everything after the FIRST pipe is
 * the answer (answers may themselves contain pipes). Lines with no pipe or
 * an empty side are skipped and counted so the UI can say so.
 */
export function parseQaImport(text: string): {
  pairs: PrepQaPair[];
  skipped: number;
} {
  const pairs: PrepQaPair[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const cut = line.indexOf("|");
    if (cut <= 0 || cut === line.length - 1) {
      skipped += 1;
      continue;
    }
    const before = pairs.length;
    push(pairs, seen, line.slice(0, cut), line.slice(cut + 1), null, "import");
    if (pairs.length === before) skipped += 1;
  }
  return { pairs, skipped };
}

/** Render pairs as the canonical document form `parseQaPairs` reads back —
 *  what the Import button ingests into the library as a plain-text doc. */
export function buildQaMarkdown(pairs: readonly PrepQaPair[]): string {
  const lines = ["## Imported Q&A", ""];
  for (const p of pairs) {
    lines.push(`- **Q: ${p.question}** A: ${p.answer}`);
  }
  return lines.join("\n");
}

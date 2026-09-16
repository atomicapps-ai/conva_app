import type { ReactNode } from "react";

/**
 * The minimal markdown renderer Ally's answers use everywhere they're shown
 * — the transcript's Focus canvas and Answers cards (`TranscriptView.tsx`)
 * and the partner/viewer window (`PartnerWindow.tsx`, the deep-dive surface
 * CLAUDE.md's architecture rule 10 designates as "the" viewer). Previously
 * this lived only inside `TranscriptView.tsx` as unexported functions, so
 * `PartnerWindow` — the one place a longer answer is actually read in full —
 * had no markdown handling at all and dumped raw `**bold**`/`- bullet`
 * markup as plain text (owner report, 2026-09-15). Factored out here so both
 * surfaces render the same way; no full markdown dependency, just enough for
 * fast, scannable, call-ready output.
 */

/** Inline `**bold**`, `*italic*`/`_italic_`, and `` `code` `` → their tags;
 *  everything else passes through unchanged. */
export function inlineMd(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  // One pass, first-match-wins per position: bold, then italic, then code.
  const re = /\*\*(.+?)\*\*|\*(.+?)\*|_(.+?)_|`(.+?)`/g;
  let last = 0;
  let k = 0;
  for (let m = re.exec(text); m !== null; m = re.exec(text)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1] !== undefined) {
      out.push(
        <strong key={`b${k++}`} className="font-semibold text-fg">
          {m[1]}
        </strong>,
      );
    } else if (m[2] !== undefined || m[3] !== undefined) {
      out.push(<em key={`i${k++}`}>{m[2] ?? m[3]}</em>);
    } else {
      out.push(
        <code key={`c${k++}`} className="rounded bg-panel-raised px-1 py-0.5 font-mono text-[0.9em]">
          {m[4]}
        </code>,
      );
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Minimal markdown for Ally answers: bullet + numbered lists, ### headings,
 *  inline emphasis, paragraphs. */
export function AnswerBody({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let bullets: string[] = [];
  let ordered: string[] = [];
  let key = 0;
  const flushBullets = () => {
    if (bullets.length === 0) return;
    const items = bullets;
    bullets = [];
    blocks.push(
      <ul key={`u${key++}`} className="ml-4 list-disc space-y-1">
        {items.map((b, i) => (
          <li key={i}>{inlineMd(b)}</li>
        ))}
      </ul>,
    );
  };
  const flushOrdered = () => {
    if (ordered.length === 0) return;
    const items = ordered;
    ordered = [];
    blocks.push(
      <ol key={`o${key++}`} className="ml-4 list-decimal space-y-1">
        {items.map((b, i) => (
          <li key={i}>{inlineMd(b)}</li>
        ))}
      </ol>,
    );
  };
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    const heading = line.match(/^#{1,4}\s+(.*)$/);
    if (bullet) {
      flushOrdered();
      bullets.push(bullet[1] ?? "");
      continue;
    }
    if (numbered) {
      flushBullets();
      ordered.push(numbered[1] ?? "");
      continue;
    }
    flushBullets();
    flushOrdered();
    if (heading) {
      blocks.push(
        <p key={`h${key++}`} className="font-bold text-fg">
          {inlineMd(heading[1] ?? "")}
        </p>,
      );
    } else if (line.trim() !== "") {
      blocks.push(<p key={`p${key++}`}>{inlineMd(line)}</p>);
    }
  }
  flushBullets();
  flushOrdered();
  return <div className="flex flex-col gap-1.5">{blocks}</div>;
}

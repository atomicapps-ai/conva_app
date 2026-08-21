import { useState, type ReactNode } from "react";

import { Icon } from "@/components/ui/Icon";
import type { AllyCard } from "@/state/ally";
import { useUiPrefs } from "@/state/uiPrefs";

/** Inline **bold** → <strong>; everything else passes through. Keeps Ally's
 *  call-ready answers scannable without a full markdown dependency. */
export function inlineMd(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*(.+?)\*\*/g;
  let last = 0;
  let k = 0;
  for (let m = re.exec(text); m !== null; m = re.exec(text)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(
      <strong key={`b${k++}`} className="font-semibold text-fg">
        {m[1]}
      </strong>,
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Minimal markdown for Ally answers: bullet lists, ### headings, **bold**,
 *  paragraphs — enough for fast, scannable, call-ready output. */
export function AnswerBody({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let bullets: string[] = [];
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
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    const heading = line.match(/^#{1,4}\s+(.*)$/);
    if (bullet) {
      bullets.push(bullet[1] ?? "");
      continue;
    }
    flushBullets();
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
  return <div className="flex flex-col gap-1.5">{blocks}</div>;
}

/** Split an Ally answer into the at-a-glance part and the optional context that
 *  follows a `---` line (the prompt asks Ally to separate them this way). */
export function splitReasoning(text: string): { answer: string; context: string } {
  const m = text.match(/\n[ \t]*-{3,}[ \t]*(?:\n|$)/);
  if (!m || m.index === undefined) return { answer: text, context: "" };
  return {
    answer: text.slice(0, m.index).trim(),
    context: text.slice(m.index + m[0].length).trim(),
  };
}

/** Collapsible "reasoning" region — default collapsed; keeps deeper context out
 *  of the way during a call but one tap away. */
export function ReasoningBlock({ text }: { text: string }) {
  const defaultOpen = useUiPrefs((s) => s.reasoningDefaultOpen);
  const [open, setOpen] = useState(defaultOpen);
  if (!text.trim()) return null;
  return (
    <div className="rounded-md border border-border/70 bg-bg/30">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-fg-faint transition-colors hover:text-fg-muted"
      >
        <Icon name="reasoning" size={13} />
        Reasoning
        <Icon
          name="chevron"
          size={12}
          className={`ml-auto transition-transform ${open ? "" : "-rotate-90"}`}
        />
      </button>
      {open && (
        <div className="border-t border-border/70 px-2.5 py-2 text-[12px] text-fg-muted">
          <AnswerBody text={text} />
        </div>
      )}
    </div>
  );
}

export function cardLabel(card: AllyCard): string {
  if (card.kind === "suggest_reply") return "Suggested reply";
  if (card.kind === "summarize") return "Summary";
  return card.sourceQuote ? "Research" : "Answer";
}

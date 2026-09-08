import { Fragment, useState, type ReactNode } from "react";

function safeHref(value: string): string | null {
  const href = value.trim();
  if (/^(https?:\/\/|mailto:)/i.test(href)) return href;
  return null;
}

function inlineMarkdown(text: string): ReactNode[] {
  const tokens = text.split(/(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/g);
  return tokens.map((token, index) => {
    if (token.startsWith("`") && token.endsWith("`")) {
      return (
        <code key={index} className="rounded bg-bg px-1 py-0.5 font-mono text-[0.92em] text-fg">
          {token.slice(1, -1)}
        </code>
      );
    }
    if (token.startsWith("**") && token.endsWith("**")) {
      return <strong key={index} className="font-semibold text-fg">{token.slice(2, -2)}</strong>;
    }
    const link = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (link) {
      const href = safeHref(link[2]!);
      if (!href) return <Fragment key={index}>{link[1]!}</Fragment>;
      return (
        <a
          key={index}
          href={href}
          target="_blank"
          rel="noreferrer"
          className="font-medium text-primary underline decoration-primary/40 underline-offset-2 hover:decoration-primary"
        >
          {link[1]!}
        </a>
      );
    }
    return <Fragment key={index}>{token}</Fragment>;
  });
}

type Block =
  | { kind: "heading"; level: number; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "quote"; text: string }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "rule" };

export function parseMarkdownBlocks(markdown: string): Block[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let list: Extract<Block, { kind: "list" }> | null = null;

  const flushParagraph = () => {
    const text = paragraph.join(" ").trim();
    if (text) blocks.push({ kind: "paragraph", text });
    paragraph = [];
  };
  const flushList = () => {
    if (list) blocks.push(list);
    list = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }
    if (/^([-*_])\1\1+$/.test(line)) {
      flushParagraph();
      flushList();
      blocks.push({ kind: "rule" });
      continue;
    }
    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();
      blocks.push({ kind: "heading", level: heading[1]!.length, text: heading[2]! });
      continue;
    }
    const listItem = line.match(/^([-*+] |\d+[.)] )(.+)$/);
    if (listItem) {
      flushParagraph();
      const ordered = /^\d/.test(listItem[1]!);
      if (!list || list.ordered !== ordered) {
        flushList();
        list = { kind: "list", ordered, items: [] };
      }
      list.items.push(listItem[2]!);
      continue;
    }
    const quote = line.match(/^>\s?(.+)$/);
    if (quote) {
      flushParagraph();
      flushList();
      blocks.push({ kind: "quote", text: quote[1]! });
      continue;
    }
    flushList();
    paragraph.push(line);
  }
  flushParagraph();
  flushList();
  return blocks;
}

export function MarkdownDocument({
  text,
  className = "",
  maxHeight,
  fill = false,
}: {
  text: string;
  className?: string;
  maxHeight?: string;
  /** Fill a constrained flex parent and give the document body one explicit
   * scroll region. Used by the resizable partner-window document viewer. */
  fill?: boolean;
}) {
  const [raw, setRaw] = useState(false);
  const blocks = parseMarkdownBlocks(text);

  return (
    <section className={`${fill ? "flex min-h-0 flex-1 flex-col " : ""}overflow-hidden rounded-lg border border-border bg-bg/45 ${className}`}>
      <div className="flex shrink-0 items-center justify-end border-b border-border/70 bg-bg-elevated/35 px-2 py-1">
        <div className="flex rounded-md border border-border bg-bg p-0.5" aria-label="Document view">
          {([false, true] as const).map((isRaw) => (
            <button
              key={String(isRaw)}
              type="button"
              onClick={() => setRaw(isRaw)}
              aria-pressed={raw === isRaw}
              className={`rounded px-2 py-1 text-[10px] font-semibold transition ${
                raw === isRaw ? "bg-primary/15 text-primary" : "text-fg-faint hover:text-fg"
              }`}
            >
              {isRaw ? "Raw" : "Formatted"}
            </button>
          ))}
        </div>
      </div>
      <div
        data-testid="markdown-document-scroll"
        className={`${fill ? "min-h-0 flex-1 overflow-y-scroll [scrollbar-gutter:stable] " : "overflow-y-auto "}px-4 py-3`}
        style={maxHeight ? { maxHeight } : undefined}
      >
        {raw ? (
          <pre className="whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed text-fg-muted">
            {text}
          </pre>
        ) : (
          <article className="max-w-[82ch] break-words text-[13px] leading-relaxed text-fg-muted">
            {blocks.map((block, index) => {
              if (block.kind === "heading") {
                const headingClass = block.level === 1
                  ? "mb-3 mt-1 text-xl font-bold text-fg"
                  : block.level === 2
                    ? "mb-2 mt-5 text-base font-bold text-fg"
                    : "mb-1.5 mt-4 text-sm font-semibold text-fg";
                return <h2 key={index} className={headingClass}>{inlineMarkdown(block.text)}</h2>;
              }
              if (block.kind === "list") {
                const List = block.ordered ? "ol" : "ul";
                return (
                  <List key={index} className={`my-2 space-y-1 pl-5 ${block.ordered ? "list-decimal" : "list-disc"}`}>
                    {block.items.map((item, itemIndex) => <li key={itemIndex}>{inlineMarkdown(item)}</li>)}
                  </List>
                );
              }
              if (block.kind === "quote") {
                return <blockquote key={index} className="my-3 border-l-2 border-ai/60 bg-ai/5 px-3 py-2 italic text-fg-muted">{inlineMarkdown(block.text)}</blockquote>;
              }
              if (block.kind === "rule") return <hr key={index} className="my-4 border-border" />;
              return <p key={index} className="my-2">{inlineMarkdown(block.text)}</p>;
            })}
          </article>
        )}
      </div>
    </section>
  );
}

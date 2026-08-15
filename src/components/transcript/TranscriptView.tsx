import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { Icon, type IconName } from "@/components/ui/Icon";
import { useBackend } from "@/lib/backend";
import type { AllyKind, TranscriptSegment } from "@/lib/ipc";
import { isTauri } from "@/lib/ipc";
import { useAppStore } from "@/state/app";
import { useAllyStore, type AllyCard } from "@/state/ally";
import { useRehearsalStore } from "@/state/rehearsal";
import { useTranscriptStore } from "@/state/transcript";
import { ALLY_FONT_MAX, ALLY_FONT_MIN, useUiPrefs } from "@/state/uiPrefs";

/** Stable identity for a transcript bubble (also the Ally-card link key). */
function segmentKey(seg: TranscriptSegment): string {
  return `${seg.side}-${seg.seq}`;
}

function formatMs(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

function researchPrompt(text: string): string {
  return `On a live call — give me what I need to respond in seconds to: "${text}". Lead with the key facts/answer as short bold-highlighted bullets; put any deeper background below a --- line.`;
}

/** Inline **bold** → <strong>; everything else passes through. Keeps Ally's
 *  call-ready answers scannable without a full markdown dependency. */
function inlineMd(text: string): ReactNode[] {
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
function AnswerBody({ text }: { text: string }) {
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
function splitReasoning(text: string): { answer: string; context: string } {
  const m = text.match(/\n[ \t]*-{3,}[ \t]*(?:\n|$)/);
  if (!m || m.index === undefined) return { answer: text, context: "" };
  return {
    answer: text.slice(0, m.index).trim(),
    context: text.slice(m.index + m[0].length).trim(),
  };
}

/** Collapsible "reasoning" region — default collapsed; keeps deeper context out
 *  of the way during a call but one tap away. */
function ReasoningBlock({ text }: { text: string }) {
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

function cardLabel(card: AllyCard): string {
  if (card.kind === "suggest_reply") return "Suggested reply";
  if (card.kind === "summarize") return "Summary";
  return card.sourceQuote ? "Research" : "Answer";
}

/** Which link is emphasized (clicked = inspected, else hovered). */
interface Active {
  cardId: string;
  sourceKey: string | null;
}

/** Term actions — icons only; the tooltip names the action (owner request).
 *  Labels align with V4.0 §9's "Ask Ally about this · Explain the term" —
 *  same prompts underneath, retitled to match. "Research → new thread" from
 *  the same spec line isn't buildable yet (there's no Threads list to file
 *  into — README #7); "How-to" stays as a bonus fourth action rather than
 *  being dropped to force an exact 3-slot match. */
const TERM_ACTIONS: { action: TermAction; icon: IconName; tip: string }[] = [
  { action: "definition", icon: "book", tip: "Explain the term" },
  { action: "howto", icon: "howto", tip: "How-to" },
  { action: "elaborate", icon: "elaborate", tip: "Ask Ally about this" },
];
type TermAction = "definition" | "howto" | "elaborate";

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** A small icon popover anchored to a highlighted word: definition / how-to /
 *  elaborate. Opens upward from the term (V4.0 §9) so it never collides with
 *  the turn below — `y` is the term's TOP edge; `position: fixed` already
 *  escapes the transcript's scroll clipping, translateY does the rest.
 *  Closes on outside click, scroll, or resize. */
function TermMenu({
  term,
  x,
  y,
  onPick,
  onClose,
}: {
  term: string;
  x: number;
  /** The highlighted term's top edge (viewport coords) — the menu grows
   *  upward from here, not down from the bottom edge. */
  y: number;
  onPick: (action: TermAction) => void;
  onClose: () => void;
}) {
  const backend = useBackend();
  const feedback = (signal: "up" | "down") => {
    void backend.rag.recordHighlightFeedback(term, signal);
    onClose();
  };
  useEffect(() => {
    const close = () => onClose();
    window.addEventListener("click", close);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [onClose]);
  return (
    <div
      style={{
        position: "fixed",
        left: x,
        top: y - 4,
        transform: "translateY(-100%)",
        zIndex: 60,
      }}
      onClick={(e) => e.stopPropagation()}
      role="menu"
      aria-label={`Ask Ally about "${term}"`}
      className="glass-raised flex items-center gap-0.5 rounded-lg border border-border p-1 shadow-[var(--shadow-lg)]"
    >
      {TERM_ACTIONS.map((a) => (
        <button
          key={a.action}
          type="button"
          title={a.tip}
          aria-label={`${a.tip}: ${term}`}
          onClick={() => {
            // Researching a term is an implicit 👍 (Phase 4b).
            void backend.rag.recordTermPick(term);
            onPick(a.action);
          }}
          className="rounded p-1.5 text-fg-faint transition-colors hover:bg-ai/10 hover:text-ai"
        >
          <Icon name={a.icon} size={16} />
        </button>
      ))}
      <span className="mx-0.5 h-4 w-px bg-border" aria-hidden />
      <button
        type="button"
        title="Useful — surface terms like this"
        aria-label={`Mark "${term}" useful`}
        onClick={() => feedback("up")}
        className="rounded p-1.5 text-fg-faint transition-colors hover:bg-ai/10 hover:text-ai"
      >
        <Icon name="thumbUp" size={16} />
      </button>
      <button
        type="button"
        title="Not useful — stop highlighting this"
        aria-label={`Mark "${term}" not useful`}
        onClick={() => feedback("down")}
        className="rounded p-1.5 text-fg-faint transition-colors hover:bg-rec/10 hover:text-rec"
      >
        <Icon name="thumbDown" size={16} />
      </button>
    </div>
  );
}

/** Renders `text` with `terms` highlighted as clickable chips that open a
 *  TermMenu. Terms are matched case-insensitively with flexible whitespace. */
function HighlightedText({
  text,
  terms,
  onAsk,
}: {
  text: string;
  terms: string[];
  onAsk: (action: TermAction, term: string) => void;
}) {
  const [menu, setMenu] = useState<{ term: string; x: number; y: number } | null>(
    null,
  );
  if (terms.length === 0) return <>{text}</>;

  const alts = [...terms]
    .sort((a, b) => b.length - a.length)
    .map((t) => t.split(/\s+/).map(escapeRegExp).join("\\s+"));
  const re = new RegExp(`\\b(${alts.join("|")})\\b`, "gi");

  const parts: ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (let m = re.exec(text); m !== null; m = re.exec(text)) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const word = m[0];
    parts.push(
      <button
        key={`h${key++}`}
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          const r = e.currentTarget.getBoundingClientRect();
          setMenu({ term: word, x: r.left, y: r.top });
        }}
        className="rounded-[3px] bg-ai/15 px-0.5 font-semibold text-ai underline decoration-ai/50 decoration-dotted underline-offset-2 hover:bg-ai/25 hover:decoration-ai"
      >
        {word}
      </button>,
    );
    last = m.index + word.length;
    if (m.index === re.lastIndex) re.lastIndex++;
  }
  if (last < text.length) parts.push(text.slice(last));

  return (
    <>
      {parts}
      {menu && (
        <TermMenu
          term={menu.term}
          x={menu.x}
          y={menu.y}
          onPick={(action) => {
            onAsk(action, menu.term);
            setMenu(null);
          }}
          onClose={() => setMenu(null)}
        />
      )}
    </>
  );
}

/** Icon menu shown when the user selects text inside a bubble: ask Ally about
 *  the selection, copy it, or drop it into the Ask-Ally box. */
function SelectionMenu({
  x,
  y,
  text,
  onAsk,
  onSendToAsk,
  onClose,
}: {
  x: number;
  y: number;
  text: string;
  onAsk: (t: string) => void;
  onSendToAsk: (t: string) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const close = () => onClose();
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);
  const left = Math.max(8, Math.min(x - 52, window.innerWidth - 120));
  return (
    <div
      style={{ position: "fixed", left, top: y + 6, zIndex: 60 }}
      onMouseDown={(e) => e.stopPropagation()}
      role="menu"
      className="glass-raised flex items-center gap-0.5 rounded-lg border border-border p-1 shadow-[var(--shadow-lg)]"
    >
      <button
        type="button"
        title="Ask Ally about this"
        aria-label="Ask Ally about the selection"
        onClick={() => {
          onAsk(text);
          onClose();
        }}
        className="rounded p-1.5 text-ai/80 transition-colors hover:bg-ai/10 hover:text-ai"
      >
        <Icon name="lightbulb" size={15} />
      </button>
      <button
        type="button"
        title="Copy"
        aria-label="Copy the selection"
        onClick={() => {
          void navigator.clipboard.writeText(text);
          onClose();
        }}
        className="rounded p-1.5 text-fg-faint transition-colors hover:bg-panel-raised/60 hover:text-fg"
      >
        <Icon name="copy" size={15} />
      </button>
      <button
        type="button"
        title="Send to Ask Ally"
        aria-label="Send the selection to Ask Ally"
        onClick={() => {
          onSendToAsk(text);
          onClose();
        }}
        className="rounded p-1.5 text-fg-faint transition-colors hover:bg-panel-raised/60 hover:text-fg"
      >
        <Icon name="chevron" size={15} className="rotate-90" />
      </button>
    </div>
  );
}

/** A collapsed bubble: one dense line; the full message peeks in a readable
 *  popup on hover, and clicking expands the bubble. */
function CollapsedPreview({
  text,
  onExpand,
}: {
  text: string;
  onExpand: () => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const open = () => {
    if (ref.current) setRect(ref.current.getBoundingClientRect());
  };
  return (
    <>
      <button
        ref={ref}
        type="button"
        onMouseEnter={open}
        onMouseLeave={() => setRect(null)}
        onClick={onExpand}
        title="Click to expand"
        className="line-clamp-1 block w-full text-left text-fg-muted"
      >
        {text || "…"}
      </button>
      {rect && (
        <div
          style={{
            position: "fixed",
            left: Math.max(8, rect.left),
            top: rect.bottom + 4,
            maxWidth: "min(620px, 92vw)",
            zIndex: 40,
          }}
          className="glass-raised pointer-events-none rounded-lg border border-border px-3 py-2 text-[13px] leading-relaxed text-fg shadow-[var(--shadow-lg)]"
        >
          {text}
        </div>
      )}
    </>
  );
}

/** The expanded content: sentences flow on one continuous line, separated by a
 *  coloured `|`. Hovering a sentence highlights it and reveals a lightbulb to
 *  ask Ally about just that sentence; RAG terms stay clickable within. */
function FlowText({
  units,
  terms,
  onAskText,
  onAskTerm,
}: {
  units: string[];
  terms: string[];
  onAskText: (t: string) => void;
  onAskTerm: (action: TermAction, term: string) => void;
}) {
  return (
    <span className="leading-snug">
      {units.map((unit, i) => (
        <span
          key={i}
          className="group/u rounded-[3px] px-0.5 transition-colors hover:bg-ai/10"
        >
          {i > 0 && (
            <span className="mx-1 font-bold text-ai/70 select-none" aria-hidden>
              |
            </span>
          )}
          <HighlightedText text={unit} terms={terms} onAsk={onAskTerm} />
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onAskText(unit);
            }}
            title="Ask Ally about this"
            aria-label="Ask Ally about this sentence"
            className="ml-0.5 inline-flex align-middle text-ai/70 opacity-0 transition-opacity hover:text-ai group-hover/u:opacity-100"
          >
            <Icon name="lightbulb" size={12} />
          </button>
        </span>
      ))}
    </span>
  );
}

/** One conversation turn = consecutive segments from the same speaker. Full
 *  width with a 2px voice-colour accent (cyan = them, violet = you); expanded
 *  content flows with `|` separators, collapsed content peeks on hover. The
 *  lightbulb + time sit outside the bubble on the right; the collapse toggle
 *  floats at the top-centre edge. */
function Bubble({
  segments,
  turnKey,
  registerEl,
  highlighted,
  flashToken,
  collapsed,
  onToggleCollapse,
  onResearch,
  onAskText,
  onSendToAsk,
  onAskTerm,
  onContextMenu,
  linkedSeq,
  onJumpLink,
  busy,
  fontPx,
  sessionStartMs,
}: {
  segments: TranscriptSegment[];
  turnKey: string;
  registerEl: (key: string, el: HTMLElement | null) => void;
  highlighted: boolean;
  /** Non-null → play the one-shot azure jump-flash; changes each jump so it
   *  replays even on a repeat click (V4.0 §8). */
  flashToken: number | null;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onResearch: () => void;
  onAskText: (text: string) => void;
  onSendToAsk: (text: string) => void;
  onAskTerm: (action: TermAction, term: string) => void;
  onContextMenu: (e: React.MouseEvent) => void;
  linkedSeq: number | null;
  onJumpLink: () => void;
  busy: boolean;
  fontPx: number;
  /** Session start (epoch ms) so the time hover can show a wall-clock. */
  sessionStartMs: number | null;
}) {
  const backend = useBackend();
  const inbound = segments[0]?.side === "inbound";
  const finals = segments.filter((s) => s.is_final);
  const hasFinal = finals.length > 0;
  const firstFinal = finals[0];
  const units = finals.map((s) => s.text.trim()).filter(Boolean);
  const combinedText = units.join(" ");
  const partialTail = segments
    .filter((s) => !s.is_final && s.text.trim())
    .map((s) => s.text.trim())
    .join(" ");

  // RAG-grounded highlight terms for the whole turn (best-effort).
  const [terms, setTerms] = useState<string[]>([]);
  useEffect(() => {
    if (!combinedText || !isTauri()) return;
    let alive = true;
    void backend.rag
      .analyzeTerms(combinedText)
      .then((t) => alive && setTerms(t))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [combinedText, backend]);

  // Selection → icon menu (ask / copy / send-to-ask).
  const [sel, setSel] = useState<{ x: number; y: number; text: string } | null>(
    null,
  );
  const onMouseUp = () => {
    const s = window.getSelection();
    const text = s?.toString().trim() ?? "";
    if (!text || !s || s.rangeCount === 0) {
      setSel(null);
      return;
    }
    const r = s.getRangeAt(0).getBoundingClientRect();
    setSel({ x: r.left + r.width / 2, y: r.bottom, text });
  };

  const accent = inbound ? "bg-inbound" : "bg-outbound";
  const tint = inbound ? "bg-inbound/[0.05]" : "bg-outbound/[0.05]";

  const timeMs = firstFinal ? firstFinal.start_ms : 0;
  const timeLabel = firstFinal ? formatMs(timeMs) : "now";
  const timeTitle =
    sessionStartMs && sessionStartMs > 0
      ? new Date(sessionStartMs + timeMs).toLocaleString()
      : `${timeLabel} into the session`;

  return (
    <div
      ref={(el) => registerEl(turnKey, el)}
      onContextMenu={onContextMenu}
      className="group w-full"
    >
      <div
        onMouseUp={onMouseUp}
        style={{ fontSize: `${fontPx}px` }}
        className={[
          // Contour (V4.0 §10): squared at the speaker's corner, rounded
          // away elsewhere — them bottom-left, you bottom-right. Width,
          // padding, and every other bubble dimension are unchanged.
          "relative min-w-0 rounded-tl-[var(--radius-bubble)] rounded-tr-[var(--radius-bubble)] border border-border py-1.5 pl-2.5 pr-6 transition-shadow",
          inbound
            ? "rounded-br-[var(--radius-bubble)] rounded-bl-[4px]"
            : "rounded-bl-[var(--radius-bubble)] rounded-br-[4px]",
          tint,
          !hasFinal ? "border-dashed text-fg-muted" : "",
          highlighted ? "ring-2 ring-ai/60" : "",
        ].join(" ")}
      >
        {/* One-shot azure flash — a thread just opened to this bubble
            (V4.0 §8). The accent, not a voice colour: this is chrome
            feedback, not speaker identity. Separate from `highlighted`
            above (gold, persistent) so "currently linked" and "just
            jumped here" stay visually distinct. Keyed by token so it
            remounts — and replays — on every jump, including repeats. */}
        {flashToken !== null && (
          <span
            key={flashToken}
            className="pointer-events-none absolute inset-0 rounded-[4px] ring-2 ring-primary/70 animate-flash-ring"
            aria-hidden
          />
        )}
        {/* 2px voice-colour accent bar (density law). */}
        <span
          className={`absolute inset-y-0 left-0 w-[2px] rounded-l ${accent}`}
          aria-hidden
        />
        {/* Collapse toggle — floats at the top-centre edge (down = collapsed). */}
        {hasFinal && (
          <button
            type="button"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onToggleCollapse();
            }}
            aria-expanded={!collapsed}
            title={collapsed ? "Expand" : "Collapse"}
            aria-label={collapsed ? "Expand turn" : "Collapse turn"}
            className="absolute left-1/2 top-0 z-20 grid h-[16px] w-[18px] -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-border bg-panel text-fg-faint transition-colors hover:border-ai/50 hover:text-ai"
          >
            <Icon
              name="chevron"
              size={12}
              strokeWidth={2.6}
              className={collapsed ? "" : "rotate-180"}
            />
          </button>
        )}
        {/* Ask Ally about the whole turn — top-right corner, saves inline space. */}
        {hasFinal && (
          <button
            type="button"
            disabled={busy}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={onResearch}
            title="Ask Ally about this turn"
            aria-label="Ask Ally about this turn"
            className="absolute right-0.5 top-0.5 z-10 rounded p-0.5 text-ai/60 transition-colors hover:bg-ai/10 hover:text-ai disabled:opacity-40"
          >
            <Icon name="lightbulb" size={14} />
          </button>
        )}

        {collapsed ? (
          <CollapsedPreview text={combinedText} onExpand={onToggleCollapse} />
        ) : (
          <div className="min-w-0">
            {units.length > 0 && (
              <FlowText
                units={units}
                terms={terms}
                onAskText={onAskText}
                onAskTerm={onAskTerm}
              />
            )}
            {partialTail && (
              <span className="text-fg-muted">
                {units.length > 0 ? " " : ""}
                {partialTail}…
              </span>
            )}
            {units.length === 0 && !partialTail && (
              <span className="text-fg-muted">…</span>
            )}
            {/* Time — the last item, right after the words; hover = full date. */}
            {hasFinal && (
              <span
                title={timeTitle}
                className="ml-1.5 cursor-help whitespace-nowrap align-baseline font-mono text-[9px] text-fg-faint"
              >
                {timeLabel}
                {linkedSeq !== null && (
                  <button
                    type="button"
                    onClick={onJumpLink}
                    title={`Jump to Ally card A${linkedSeq}`}
                    className="ml-1 rounded px-0.5 font-bold text-ai hover:bg-ai/10"
                  >
                    A{linkedSeq}
                  </button>
                )}
              </span>
            )}
          </div>
        )}

        {sel && (
          <SelectionMenu
            x={sel.x}
            y={sel.y}
            text={sel.text}
            onAsk={onAskText}
            onSendToAsk={onSendToAsk}
            onClose={() => setSel(null)}
          />
        )}
      </div>
    </div>
  );
}

/** Large detail drawer for one Ally card (V4.0 §7) — SAY THIS, grounding,
 *  why Ally suggests it, and action chips. Elevated (a true floating layer,
 *  --shadow-lg/r-float), slides over the transcript from the right. Reuses
 *  splitReasoning/AnswerBody so this stays in lockstep with the inline card
 *  instead of re-deriving its own copy of "what the answer is." */
function ThreadViewer({
  card,
  onClose,
  onRequest,
}: {
  card: AllyCard | null;
  onClose: () => void;
  onRequest: (
    kind: AllyKind,
    question?: string,
    source?: { key: string; quote: string },
  ) => void;
}) {
  if (!card) return null;
  const label = cardLabel(card);
  const { answer, context } = splitReasoning(card.text);
  const sayText = answer || card.text;
  const sources = [
    ...new Set(card.sources.map((s) => `${s.file_name} · ${s.location}`)),
  ];
  const rephrase = () =>
    onRequest(
      "question",
      `Rephrase this a different way, same meaning: "${sayText}"`,
      card.sourceKey ? { key: card.sourceKey, quote: card.sourceQuote ?? "" } : undefined,
    );
  const researchMore = () =>
    onRequest(
      "question",
      `Research this further and go deeper: "${sayText}"`,
      card.sourceKey ? { key: card.sourceKey, quote: card.sourceQuote ?? "" } : undefined,
    );

  return (
    <div
      role="dialog"
      aria-label={`A${card.seq} — ${label}, full detail`}
      className="glass-raised absolute right-0 top-0 z-40 flex h-full w-[min(600px,88%)] flex-col border-l border-border-strong shadow-[var(--shadow-lg)]"
    >
      <div className="flex shrink-0 items-center gap-3 border-b border-border px-5 py-3">
        <span
          className={`h-2.5 w-2.5 shrink-0 rounded-full ${card.error ? "bg-rec" : "bg-ai"}`}
          aria-hidden
        />
        <h3 className="min-w-0 flex-1 truncate text-[15px] font-bold text-fg">
          A{card.seq} · {label}
        </h3>
        <button
          type="button"
          onClick={onClose}
          title="Close"
          aria-label="Close viewer"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-[var(--radius)] border border-border-strong bg-bg-2 text-fg-muted transition hover:text-fg"
        >
          <Icon name="close" size={15} />
        </button>
      </div>

      <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-5 py-5">
        <div>
          <p className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-ai">
            {card.error ? "Error" : "Say this"}
          </p>
          {card.error ? (
            <p className="mt-2 text-sm text-rec">{card.error}</p>
          ) : (
            <div className="mt-2 border-l-[3px] border-ai/50 pl-3 text-[15px] leading-relaxed text-fg">
              <AnswerBody text={sayText || "…"} />
            </div>
          )}
        </div>

        {(card.sourceQuote || sources.length > 0) && (
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-fg-faint">
              Grounding
            </p>
            {card.sourceQuote && (
              <p className="mt-1.5 text-[13px] italic leading-relaxed text-fg-muted">
                “{card.sourceQuote}”
              </p>
            )}
            {sources.length > 0 && (
              <p className="mt-1.5 text-[12px] text-fg-faint">{sources.join(" · ")}</p>
            )}
          </div>
        )}

        {context && (
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-fg-faint">
              Why Ally suggests this
            </p>
            <p className="mt-1.5 text-[13px] leading-relaxed text-fg-muted">{context}</p>
          </div>
        )}

        {!card.error && (
          <div className="mt-1 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void navigator.clipboard.writeText(sayText)}
              title="Copy the line to use it as-is"
              className="rounded-full bg-ai px-3.5 py-1.5 text-[12px] font-bold text-bg transition hover:brightness-110"
            >
              Use it
            </button>
            <button
              type="button"
              onClick={rephrase}
              className="rounded-full border border-ai/40 px-3.5 py-1.5 text-[12px] font-bold text-ai transition hover:bg-ai/10"
            >
              Rephrase
            </button>
            <button
              type="button"
              onClick={researchMore}
              className="rounded-full border border-border-strong px-3.5 py-1.5 text-[12px] font-medium text-fg-muted transition hover:text-fg"
            >
              Research this line
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** One Ally card: A# badge + typed treatment + collapse + docs-hover citation. */
function AllyCardView({
  card,
  registerEl,
  highlighted,
  collapsed,
  pinned,
  onTogglePin,
  onOpenViewer,
  onToggleCollapse,
  onHover,
  onInspect,
  onContextMenu,
}: {
  card: AllyCard;
  registerEl: (id: string, el: HTMLElement | null) => void;
  highlighted: boolean;
  collapsed: boolean;
  /** V4.0 §7: pinned cards rise to the top under a PINNED divider. */
  pinned: boolean;
  onTogglePin: () => void;
  /** Opens the large detail drawer (V4.0 §7) — hover-revealed, like `onTogglePin`. */
  onOpenViewer: () => void;
  onToggleCollapse: () => void;
  onHover: (a: Active | null) => void;
  onInspect: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  const label = cardLabel(card);
  const allyFontPx = useUiPrefs((s) => s.allyFontPx);
  const suggest = card.kind === "suggest_reply";
  const summary = card.kind === "summarize";
  const sources = [
    ...new Set(card.sources.map((s) => `${s.file_name} · ${s.location}`)),
  ];

  return (
    <div
      ref={(el) => registerEl(card.id, el)}
      onMouseEnter={() => onHover({ cardId: card.id, sourceKey: card.sourceKey })}
      onMouseLeave={() => onHover(null)}
      onContextMenu={onContextMenu}
      className={[
        "group min-h-[40px] overflow-hidden rounded-2xl border transition-shadow",
        suggest ? "border-ai/34 bg-ai/[0.08]" : "border-border bg-panel",
        highlighted ? "ring-2 ring-ai/40" : "",
        pinned ? "ring-1 ring-ai/50" : "",
      ].join(" ")}
    >
      {/* One click anywhere on the header collapses/expands (owner request). */}
      <div
        onClick={onToggleCollapse}
        role="button"
        tabIndex={0}
        aria-expanded={!collapsed}
        aria-label={`${collapsed ? "Expand" : "Collapse"} ${label} answer`}
        className={`flex cursor-pointer select-none items-center gap-2.5 px-4 py-2 ${collapsed ? "" : suggest ? "border-b border-ai/18" : "border-b border-border"}`}
      >
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onInspect();
          }}
          title={`A${card.seq}`}
          className={[
            "grid h-[18px] min-w-[18px] shrink-0 place-items-center rounded-full px-1 font-mono text-[9px] font-bold",
            suggest ? "bg-ai text-bg" : "border border-ai/50 bg-ai/24 text-ai",
          ].join(" ")}
        >
          A{card.seq}
        </button>
        <span className="shrink-0 text-[10px] font-bold uppercase tracking-[0.2em] text-ai">
          {label}
        </span>
        {!card.done && (
          <span className="shrink-0 text-[11px] text-fg-faint" role="status">
            thinking…
          </span>
        )}
        {/* Collapsed: a one-line preview keeps the row informative and sized. */}
        {collapsed && card.text && (
          <span className="min-w-0 flex-1 truncate text-[11px] text-fg-muted">
            {card.text}
          </span>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          {/* Pin + open-in-viewer — hover-revealed (V4.0 §7); pin stays
              visible once pinned so its state is legible without hovering. */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onTogglePin();
            }}
            title={pinned ? `Unpin A${card.seq}` : `Pin A${card.seq} to the top`}
            aria-label={pinned ? "Unpin" : "Pin to the top"}
            aria-pressed={pinned}
            className={[
              "rounded p-0.5 transition-opacity",
              pinned
                ? "text-ai opacity-100"
                : "text-fg-faint opacity-0 hover:text-ai group-hover:opacity-100",
            ].join(" ")}
          >
            <Icon name="pin" size={13} />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onOpenViewer();
            }}
            title="Open in viewer"
            aria-label={`Open A${card.seq} in the viewer`}
            className="rounded p-0.5 text-fg-faint opacity-0 transition-opacity hover:text-ai group-hover:opacity-100"
          >
            <Icon name="expand" size={13} />
          </button>
          <span className="mx-0.5 h-3 w-px bg-border" aria-hidden />
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              void navigator.clipboard.writeText(card.text);
            }}
            className="text-[11px] text-fg-faint hover:text-fg"
          >
            Copy
          </button>
          <Icon
            name="chevron"
            size={14}
            className={`text-fg-faint transition-transform ${collapsed ? "-rotate-90" : ""}`}
          />
        </div>
      </div>

      {!collapsed && !(summary && card.done) && (
        <div
          className="flex max-h-[46vh] flex-col gap-2.5 overflow-y-auto px-4 py-3"
          style={{ fontSize: `${allyFontPx}px` }}
        >
          {card.sourceQuote && (
            <p className="border-l-2 border-ai/40 pl-2 text-[11px] italic text-fg-muted">
              “
              {card.sourceQuote.length > 90
                ? `${card.sourceQuote.slice(0, 90)}…`
                : card.sourceQuote}
              ”
            </p>
          )}
          {card.error ? (
            <p className="text-xs text-rec">{card.error}</p>
          ) : card.text ? (
            (() => {
              const { answer, context } = splitReasoning(card.text);
              return (
                <div className="flex flex-col gap-2 leading-relaxed">
                  <AnswerBody text={answer} />
                  <ReasoningBlock text={context} />
                </div>
              );
            })()
          ) : (
            <p className="text-sm leading-relaxed text-fg-muted">…</p>
          )}

          {(suggest || sources.length > 0) && (
            <div className="flex items-center gap-2">
              {suggest && (
                <div className="flex flex-wrap items-center gap-1">
                  <span className="flex h-6 items-center gap-1.5 rounded-lg bg-ai px-2 text-[11px] font-bold text-bg">
                    <Icon name="chevron" size={11} className="-rotate-90" />
                    Use it
                  </span>
                  <span className="flex h-6 items-center rounded-lg px-2 text-[11px] font-semibold text-ai">
                    Rephrase
                  </span>
                  <span className="flex h-6 items-center rounded-lg px-2 text-[11px] font-semibold text-fg-muted">
                    More detail
                  </span>
                </div>
              )}
              {sources.length > 0 && (
                <span
                  tabIndex={0}
                  className="group/docs relative ml-auto flex cursor-default items-center gap-1.5 text-[11px] font-semibold text-fg-faint hover:text-fg-muted"
                >
                  <svg
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                  >
                    <rect x="8" y="4" width="11" height="14" rx="2" />
                    <path d="M5 8v10a2 2 0 0 0 2 2h8" />
                  </svg>
                  {sources.length}
                  <span className="pointer-events-none absolute bottom-[calc(100%+7px)] right-0 z-10 hidden min-w-[210px] rounded-xl border border-border-strong bg-panel-raised p-2.5 shadow-lg group-hover/docs:block group-focus/docs:block">
                    {sources.slice(0, 5).map((s) => (
                      <span
                        key={s}
                        className="block truncate py-0.5 text-[11px] text-fg-muted"
                      >
                        {s}
                      </span>
                    ))}
                  </span>
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function useAutoScroll(dep: unknown) {
  const ref = useRef<HTMLDivElement>(null);
  const [pinned, setPinned] = useState(true);
  useEffect(() => {
    if (pinned && ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [pinned, dep]);
  const onScroll = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setPinned(el.scrollHeight - el.scrollTop - el.clientHeight < 48);
  }, []);
  return { ref, pinned, setPinned, onScroll };
}

function centerInScroller(scroller: HTMLElement, el: HTMLElement) {
  const s = scroller.getBoundingClientRect();
  const e = el.getBoundingClientRect();
  const delta = e.top - s.top - (scroller.clientHeight / 2 - e.height / 2);
  scroller.scrollTo({ top: scroller.scrollTop + delta, behavior: "smooth" });
}

type MenuItem =
  | { sep: true }
  | { label: string; danger?: boolean; run: () => void };

interface MenuState {
  x: number;
  y: number;
  items: MenuItem[];
}

/** A right-click menu positioned at the cursor; closes on any outside action. */
function ContextMenu({
  menu,
  onClose,
}: {
  menu: MenuState;
  onClose: () => void;
}) {
  useEffect(() => {
    const close = () => onClose();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("click", close);
    window.addEventListener("resize", close);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
    };
  }, [onClose]);

  const x = Math.min(menu.x, window.innerWidth - 236);
  const y = Math.min(menu.y, window.innerHeight - (menu.items.length * 34 + 16));

  return (
    <div
      className="glass-raised fixed z-50 w-[220px] rounded-xl p-1.5"
      style={{ left: x, top: y }}
      onClick={(e) => e.stopPropagation()}
      role="menu"
    >
      {menu.items.map((item, i) =>
        "sep" in item ? (
          <div key={i} className="my-1 h-px bg-border" />
        ) : (
          <button
            key={i}
            type="button"
            role="menuitem"
            onClick={() => {
              item.run();
              onClose();
            }}
            className={`flex w-full items-center rounded-lg px-2.5 py-1.5 text-left text-[12.5px] transition hover:bg-white/[0.06] ${
              item.danger ? "text-rec" : "text-fg"
            }`}
          >
            {item.label}
          </button>
        ),
      )}
    </div>
  );
}

interface NodePos {
  cardId: string;
  seq: number;
  sourceKey: string | null;
  y: number;
}

/** Compact fallback: one merged chronological feed with a voice-coloured edge. */
function CompactFeed({ segments }: { segments: TranscriptSegment[] }) {
  const merged = [...segments].sort((a, b) => a.start_ms - b.start_ms);
  const { ref, pinned, setPinned, onScroll } = useAutoScroll(
    merged[merged.length - 1],
  );
  return (
    <main className="relative flex h-full min-h-0 flex-1 flex-col">
      <div
        ref={ref}
        onScroll={onScroll}
        className="flex flex-1 flex-col gap-2 overflow-y-auto px-3 pb-4 pt-2"
        role="log"
        aria-live="polite"
        aria-label="Conversation transcript"
      >
        {merged.length === 0 ? (
          <p className="mt-8 text-center text-xs text-fg-faint">
            Both sides of the conversation appear here.
          </p>
        ) : (
          merged.map((seg) => {
            const inbound = seg.side === "inbound";
            return (
              <div
                key={segmentKey(seg)}
                className={`rounded-xl border-l-2 px-3 py-2 text-[13px] leading-snug ${
                  inbound
                    ? "border-inbound bg-inbound/[0.09]"
                    : "border-outbound bg-outbound/10"
                }`}
              >
                <div
                  className={`mb-1 text-[9px] font-bold uppercase tracking-[0.18em] ${inbound ? "text-inbound" : "text-[var(--voice-you-text)]"}`}
                >
                  {inbound ? "Them" : "You"} · {formatMs(seg.start_ms)}
                </div>
                {seg.text}
              </div>
            );
          })
        )}
      </div>
      {!pinned && (
        <button
          type="button"
          onClick={() => setPinned(true)}
          className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full border border-border bg-panel px-3 py-1 text-[11px] text-fg-muted shadow hover:text-fg"
        >
          ↓ Jump to live
        </button>
      )}
    </main>
  );
}

/**
 * The live cockpit (v2): transcript left, a 72px relationship spine centre, the
 * Ally column right. Each Ally entry gets one spine node (A1/A2/A3…) aligned to
 * the bubble it was derived from; hovering reveals a preview + connectors,
 * clicking brings the pair into view. Everything collapses; new lines never
 * yank the view. Compact mode keeps the single merged feed.
 *
 * Breadcrumb-header audit (V4.0): every other routed view composes
 * `ViewShell`, which gives it a `breadcrumb › title` crown per the app-UI
 * brief's "always" rule (§4.1). This is the one deliberate exception — Live
 * renders straight into its two/three-column layout with no crown above it.
 * ViewShell's own crown costs ~64-68px of vertical height, taken directly
 * from the transcript; §4.3 says "never shrink the transcript first" and §8
 * locks this surface as the one everything else modernizes *around*. TopBar
 * (always visible one strip up, mounted by StudioShell for every view) plus
 * the nav rail's active-row highlight already tell you you're on Live
 * without spending any of this view's own height on it — so the omission is
 * a deliberate trade, not an oversight.
 */
export function TranscriptView() {
  const liveSegments = useTranscriptStore((s) => s.segments);
  const archived = useTranscriptStore((s) => s.archived);
  const compact = useAppStore((s) => s.compact);
  const cards = useAllyStore((s) => s.cards);
  const busy = useAllyStore((s) => s.busy);
  const request = useAllyStore((s) => s.request);
  const clearAlly = useAllyStore((s) => s.clear);
  // While a rehearsal is running, the floating RehearsalBar sits over the
  // bottom of both columns — pad them so their last content stays reachable.
  const rehearsing = useRehearsalStore((s) => s.active);
  const barPad = rehearsing ? " pb-16" : "";
  // Ally column prefs (font size, reasoning default) + the 3-dot menu.
  const allyFontPx = useUiPrefs((s) => s.allyFontPx);
  const bumpAllyFont = useUiPrefs((s) => s.bumpAllyFont);
  const reasoningDefaultOpen = useUiPrefs((s) => s.reasoningDefaultOpen);
  const setReasoningDefaultOpen = useUiPrefs((s) => s.setReasoningDefaultOpen);
  const transcriptFontPx = useUiPrefs((s) => s.transcriptFontPx);
  const bumpTranscriptFont = useUiPrefs((s) => s.bumpTranscriptFont);
  const collapseYou = useUiPrefs((s) => s.collapseYou);
  const setCollapseYou = useUiPrefs((s) => s.setCollapseYou);
  const [allyMenu, setAllyMenu] = useState(false);
  // Session start (epoch ms) — lets a bubble's time hover show a wall-clock.
  const sessionEvent = useTranscriptStore((s) => s.session);
  const sessionStartMs =
    sessionEvent.state === "listening" ? sessionEvent.started_at_unix_ms : null;

  const containerRef = useRef<HTMLDivElement>(null);
  const spineColRef = useRef<HTMLDivElement>(null);
  const bubbleEls = useRef(new Map<string, HTMLElement>());
  const cardEls = useRef(new Map<string, HTMLElement>());

  const [hover, setHover] = useState<Active | null>(null);
  const [inspected, setInspected] = useState<Active | null>(null);
  const active = inspected ?? hover;

  // One-shot azure flash on the bubble a thread opens to (V4.0 §8) — layered
  // on top of the persistent `highlighted` ring above, not a replacement for
  // it. `token` forces the flash element to remount (via its React `key`) so
  // jumping to the same bubble twice in a row still replays the animation.
  const [flash, setFlash] = useState<{ key: string; token: number } | null>(
    null,
  );
  const flashToken = useRef(0);
  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 900);
    return () => clearTimeout(t);
  }, [flash]);

  // Pinned Ally cards (V4.0 §7) — session-only, not persisted, same as
  // `collapsed` below. Pinned rise to the top under a divider; order among
  // themselves follows the existing newest-first `cards` order.
  const [pinned, setPinned] = useState<Set<string>>(new Set());
  const togglePin = useCallback((id: string) => {
    setPinned((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // The card currently open in the large detail drawer (V4.0 §7).
  const [viewerCardId, setViewerCardId] = useState<string | null>(null);

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggleCollapse = useCallback((k: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  }, []);

  const [tick, setTick] = useState(0);
  const bump = useCallback(() => setTick((t) => t + 1), []);
  const [ask, setAsk] = useState("");
  const [menu, setMenu] = useState<MenuState | null>(null);

  const merged = useMemo(
    () => [
      ...archived,
      ...[...liveSegments].sort((a, b) => a.start_ms - b.start_ms),
    ],
    [archived, liveSegments],
  );
  // Consolidate consecutive same-speaker segments into one turn (bubble). A new
  // bubble starts only when the speaker switches — no pause/time split. The
  // turn is keyed by its first segment, so Ally-card links + spine stay stable.
  const turns = useMemo(() => {
    const out: { side: TranscriptSegment["side"]; key: string; segments: TranscriptSegment[] }[] =
      [];
    for (const seg of merged) {
      const last = out[out.length - 1];
      if (last && last.side === seg.side) last.segments.push(seg);
      else out.push({ side: seg.side, key: segmentKey(seg), segments: [seg] });
    }
    return out;
  }, [merged]);

  // Keep the user's own ("you") turns collapsed by default (a persisted pref) —
  // you rarely re-read your own words. Each key is seeded once, so manually
  // re-expanding one sticks.
  const seededYou = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!collapseYou) return;
    const fresh = turns.filter(
      (t) => t.side === "outbound" && !seededYou.current.has(t.key),
    );
    if (fresh.length === 0) return;
    setCollapsed((prev) => {
      const next = new Set(prev);
      fresh.forEach((t) => {
        next.add(t.key);
        seededYou.current.add(t.key);
      });
      return next;
    });
  }, [turns, collapseYou]);

  // The header toggle applies immediately to every "you" turn on screen.
  const toggleCollapseYou = () => {
    const next = !collapseYou;
    setCollapseYou(next);
    setCollapsed((prev) => {
      const s = new Set(prev);
      turns
        .filter((t) => t.side === "outbound")
        .forEach((t) => {
          if (next) s.add(t.key);
          else s.delete(t.key);
          seededYou.current.add(t.key);
        });
      return s;
    });
  };

  const convo = useAutoScroll(merged[merged.length - 1]);
  const allyCol = useAutoScroll(cards[0]?.id);

  // Keep all three columns inline until the container is genuinely too narrow
  // to fit them at their floors (2×MIN_COL + spine ≈ 508px). Only below ~640px
  // does the Ally column fold into an overlay drawer (the spine's nodes open
  // it). This keeps the 3-column instrument visible at normal window sizes.
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((es) => {
      const r = es[0];
      if (r) setWidth(r.contentRect.width);
    });
    ro.observe(el);
    setWidth(el.getBoundingClientRect().width);
    return () => ro.disconnect();
  }, []);
  const drawer = width > 0 && width < 640;
  const [drawerOpen, setDrawerOpen] = useState(false);

  // User-adjustable split between the transcript (left) and Ally (right)
  // columns. The centre spine IS the divider: drag it to reallocate space.
  // Stored as the transcript's fraction of the flexible area, so the chosen
  // proportion holds as the window resizes. Persisted across launches.
  const SPINE_W = 28; // px — keep in sync with the spine column width (w-7)
  const MIN_COL = 240; // px — floor for both flexible columns
  const [splitRatio, setSplitRatio] = useState(() => {
    const v = Number(localStorage.getItem("conva.layout.split"));
    return v > 0.2 && v < 0.8 ? v : 0.608; // default ≈ the old 1.55 : 1
  });
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    localStorage.setItem("conva.layout.split", String(splitRatio));
  }, [splitRatio]);
  const startSplitDrag = useCallback(
    (e: React.PointerEvent) => {
      if (drawer) return; // Ally is an overlay here — nothing to resize against
      e.preventDefault();
      const container = containerRef.current;
      if (!container) return;
      setDragging(true);
      const move = (ev: PointerEvent) => {
        const base = container.getBoundingClientRect();
        const avail = base.width - SPINE_W;
        if (avail <= MIN_COL * 2) return;
        let tw = ev.clientX - base.left - SPINE_W / 2;
        tw = Math.max(MIN_COL, Math.min(avail - MIN_COL, tw));
        setSplitRatio(tw / avail);
        bump();
      };
      const up = () => {
        setDragging(false);
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    },
    [drawer, bump],
  );

  // sourceKey → newest card that derived from it (drives the bubble's chip).
  const linkBySource = useMemo(() => {
    const m = new Map<string, AllyCard>();
    for (const c of cards) if (c.sourceKey && !m.has(c.sourceKey)) m.set(c.sourceKey, c);
    return m;
  }, [cards]);

  useEffect(() => {
    window.addEventListener("resize", bump);
    return () => window.removeEventListener("resize", bump);
  }, [bump]);

  const convoBaseline = useRef(merged.length);
  useEffect(() => {
    if (convo.pinned) convoBaseline.current = merged.length;
  }, [convo.pinned, merged.length]);
  const newCount = convo.pinned
    ? 0
    : Math.max(0, merged.length - convoBaseline.current);

  const registerBubble = useCallback((key: string, el: HTMLElement | null) => {
    if (el) bubbleEls.current.set(key, el);
    else bubbleEls.current.delete(key);
  }, []);
  const registerCard = useCallback((id: string, el: HTMLElement | null) => {
    if (el) cardEls.current.set(id, el);
    else cardEls.current.delete(id);
  }, []);

  // Spine node positions: each node aligns to its source bubble (clamped into
  // the visible band); unlinked entries stack near the foot.
  const [nodes, setNodes] = useState<NodePos[]>([]);
  const [spineX, setSpineX] = useState(0);
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const base = container.getBoundingClientRect();
    if (spineColRef.current) {
      const s = spineColRef.current.getBoundingClientRect();
      setSpineX(s.left + s.width / 2 - base.left);
    }
    const top = 56;
    const bottom = base.height - 20;
    let stack = bottom;
    const next: NodePos[] = cards.map((c) => {
      let y = bottom;
      if (c.sourceKey) {
        const b = bubbleEls.current.get(c.sourceKey);
        if (b) {
          const r = b.getBoundingClientRect();
          y = r.top + r.height / 2 - base.top;
        } else {
          y = (stack -= 30);
        }
      } else {
        y = (stack -= 30);
      }
      return {
        cardId: c.id,
        seq: c.seq,
        sourceKey: c.sourceKey,
        y: Math.max(top, Math.min(bottom, y)),
      };
    });
    setNodes(next);
  }, [cards, tick, merged.length]);

  const inspect = useCallback(
    (cardId: string, sourceKey: string | null) => {
      setInspected({ cardId, sourceKey });
      setDrawerOpen(true);
      if (sourceKey) {
        flashToken.current += 1;
        setFlash({ key: sourceKey, token: flashToken.current });
      }
      // Expand both if collapsed.
      setCollapsed((prev) => {
        const n = new Set(prev);
        n.delete(cardId);
        if (sourceKey) n.delete(sourceKey);
        return n;
      });
      convo.setPinned(false);
      allyCol.setPinned(false);
      requestAnimationFrame(() => {
        const cardEl = cardEls.current.get(cardId);
        if (cardEl && allyCol.ref.current)
          centerInScroller(allyCol.ref.current, cardEl);
        if (sourceKey) {
          const b = bubbleEls.current.get(sourceKey);
          if (b && convo.ref.current) centerInScroller(convo.ref.current, b);
        }
        bump();
      });
    },
    [allyCol, convo, bump],
  );

  const jumpToLive = useCallback(() => {
    setInspected(null);
    convo.setPinned(true);
    allyCol.setPinned(true);
    if (convo.ref.current)
      convo.ref.current.scrollTop = convo.ref.current.scrollHeight;
  }, [convo, allyCol]);

  const research = useCallback(
    (seg: TranscriptSegment) =>
      void request("question", researchPrompt(seg.text), {
        key: segmentKey(seg),
        quote: seg.text,
      }),
    [request],
  );

  const askTerm = useCallback(
    (action: TermAction, term: string) => {
      const prompt =
        action === "definition"
          ? `Define "${term}" concisely, in the context of this conversation.`
          : action === "howto"
            ? `How do I "${term}"? Give concise, actionable steps.`
            : `Elaborate on "${term}" using the most relevant context from my documents.`;
      void request("question", prompt, { key: "", quote: term });
    },
    [request],
  );

  // Ask Ally about an arbitrary slice (a sentence unit or a text selection).
  const askText = useCallback(
    (text: string) =>
      void request("question", researchPrompt(text), { key: "", quote: text }),
    [request],
  );
  // Drop a selection into the Ask-Ally box so the user can build a question.
  const sendToAsk = useCallback((text: string) => setAsk(text), []);

  const submitAsk = () => {
    const q = ask.trim();
    if (!q) return;
    setAsk("");
    void request("question", q);
  };

  const allKeys = [...turns.map((t) => t.key), ...cards.map((c) => c.id)];
  const collapseAll = () => setCollapsed(new Set(allKeys));
  const expandAll = () => setCollapsed(new Set());

  const bubbleMenu = (e: React.MouseEvent, seg: TranscriptSegment) => {
    e.preventDefault();
    const key = segmentKey(seg);
    const link = linkBySource.get(key);
    const items: MenuItem[] = [
      { label: "Copy", run: () => void navigator.clipboard.writeText(seg.text) },
      { label: "Research with Ally", run: () => research(seg) },
      {
        label: "Ask Ally about this…",
        run: () =>
          setAsk(
            `About "${seg.text.slice(0, 60)}${seg.text.length > 60 ? "…" : ""}" — `,
          ),
      },
    ];
    if (link) items.push({ label: `Jump to A${link.seq}`, run: () => inspect(link.id, key) });
    items.push({ sep: true });
    items.push({
      label: collapsed.has(key) ? "Expand" : "Collapse",
      run: () => toggleCollapse(key),
    });
    setMenu({ x: e.clientX, y: e.clientY, items });
  };

  const cardMenu = (e: React.MouseEvent, card: AllyCard) => {
    e.preventDefault();
    const srcs = [
      ...new Set(card.sources.map((s) => `${s.file_name} · ${s.location}`)),
    ];
    const items: MenuItem[] = [
      { label: "Copy", run: () => void navigator.clipboard.writeText(card.text) },
    ];
    if (srcs.length)
      items.push({
        label: "Copy with citation",
        run: () =>
          void navigator.clipboard.writeText(
            `${card.text}\n\nSources: ${srcs.join("; ")}`,
          ),
      });
    items.push({ label: "Bring into view", run: () => inspect(card.id, card.sourceKey) });
    items.push({ sep: true });
    items.push({
      label: collapsed.has(card.id) ? "Expand" : "Collapse",
      run: () => toggleCollapse(card.id),
    });
    setMenu({ x: e.clientX, y: e.clientY, items });
  };

  if (compact) return <CompactFeed segments={merged} />;

  const activeNode = active
    ? nodes.find((n) => n.cardId === active.cardId)
    : undefined;
  const activeBubbleEl = active?.sourceKey
    ? bubbleEls.current.get(active.sourceKey)
    : undefined;
  const activeCardEl = active ? cardEls.current.get(active.cardId) : undefined;
  const base = containerRef.current?.getBoundingClientRect();
  // Is the source bubble already visible in the transcript scroller? If so we
  // skip the spine's "derived from" tooltip — no need to preview what's on
  // screen. (Re-evaluated on scroll via bump().)
  const sourceBubbleInView = (() => {
    const scroller = convo.ref.current;
    if (!activeBubbleEl || !scroller) return false;
    const er = activeBubbleEl.getBoundingClientRect();
    const sr = scroller.getBoundingClientRect();
    return er.bottom > sr.top + 4 && er.top < sr.bottom - 4;
  })();
  // The transcript scroller's band, in container coordinates — used to clamp
  // connectors so a line to an off-screen (scrolled-away) bubble never draws up
  // into the column header (and over the header icons).
  const paneBand = (() => {
    const scr = convo.ref.current;
    if (!scr || !base) return { top: 56, bottom: base ? base.height - 20 : 0 };
    const r = scr.getBoundingClientRect();
    return { top: r.top - base.top, bottom: r.bottom - base.top };
  })();
  const clampY = (y: number) =>
    Math.max(paneBand.top, Math.min(paneBand.bottom, y));

  // How many Ally-research source bubbles are scrolled above the visible pane —
  // shown as a "+N" hint at the top rather than a connector into the header.
  const researchAbove = (() => {
    const scr = convo.ref.current;
    if (!scr) return 0;
    const sr = scr.getBoundingClientRect();
    let n = 0;
    for (const c of cards) {
      if (!c.sourceKey) continue;
      const b = bubbleEls.current.get(c.sourceKey);
      if (b && b.getBoundingClientRect().bottom <= sr.top + 4) n += 1;
    }
    return n;
  })();

  const connector =
    active && activeNode && base
      ? (() => {
          let d = "";
          if (activeBubbleEl) {
            const b = activeBubbleEl.getBoundingClientRect();
            const bx = b.right - base.left;
            const by = clampY(b.top + b.height / 2 - base.top);
            const mid = (bx + spineX) / 2;
            d += `M ${bx} ${by} C ${mid} ${by}, ${mid} ${activeNode.y}, ${spineX} ${activeNode.y} `;
          }
          if (activeCardEl) {
            const c = activeCardEl.getBoundingClientRect();
            const cx = c.left - base.left;
            const cy = clampY(c.top + c.height / 2 - base.top);
            const mid = (spineX + cx) / 2;
            d += `M ${spineX} ${activeNode.y} C ${mid} ${activeNode.y}, ${mid} ${cy}, ${cx} ${cy}`;
          }
          return d;
        })()
      : "";

  return (
    <main
      ref={containerRef}
      className={`relative flex h-full min-h-0 min-w-0 flex-1${
        dragging ? " cursor-col-resize select-none" : ""
      }`}
    >
      {/* Transcript — left (flexes proportionally with the Ally column) */}
      <section
        data-col="transcript"
        style={drawer ? undefined : { flexGrow: splitRatio, flexBasis: 0 }}
        className="relative flex min-w-[240px] flex-1 flex-col border-r border-border"
      >
        <div className="flex h-11 shrink-0 items-center gap-3 border-b border-border px-5">
          <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-fg-faint">
            Conversation
          </span>
          <span className="flex items-center gap-1.5 text-[11px] font-semibold text-inbound">
            <span className="h-[7px] w-[7px] rounded-full bg-inbound" />
            Them
          </span>
          <span className="flex items-center gap-1.5 text-[11px] font-semibold text-[var(--voice-you-text)]">
            <span className="h-[7px] w-[7px] rounded-full bg-outbound" />
            You
          </span>
          <div className="ml-auto flex items-center gap-1 text-fg-faint">
            {drawer && (
              <button
                type="button"
                onClick={() => setDrawerOpen((o) => !o)}
                className="mr-1 flex items-center gap-1.5 rounded-lg border border-ai/40 px-2.5 py-1 text-[11px] font-semibold text-ai"
              >
                ✦ Ally{cards.length > 0 ? ` ${cards.length}` : ""}
              </button>
            )}
            {/* Transcript text size. */}
            <button
              type="button"
              onClick={() => bumpTranscriptFont(-1)}
              disabled={transcriptFontPx <= ALLY_FONT_MIN}
              title="Smaller transcript text"
              aria-label="Smaller transcript text"
              className="rounded px-1 text-[11px] font-semibold hover:text-fg disabled:opacity-30"
            >
              A−
            </button>
            <button
              type="button"
              onClick={() => bumpTranscriptFont(1)}
              disabled={transcriptFontPx >= ALLY_FONT_MAX}
              title="Larger transcript text"
              aria-label="Larger transcript text"
              className="rounded px-1 text-[13px] font-semibold hover:text-fg disabled:opacity-30"
            >
              A+
            </button>
            <span className="mx-0.5 h-4 w-px bg-border" />
            {/* Keep my own turns collapsed (persisted). */}
            <button
              type="button"
              onClick={toggleCollapseYou}
              aria-pressed={collapseYou}
              title={
                collapseYou
                  ? "Your turns are collapsed — click to show them"
                  : "Collapse your own turns"
              }
              aria-label="Collapse your own turns"
              className={`rounded p-1 transition-colors ${collapseYou ? "text-outbound" : "hover:text-fg"}`}
            >
              <Icon name="mic" size={15} />
            </button>
            <span className="mx-0.5 h-4 w-px bg-border" />
            <button
              type="button"
              onClick={expandAll}
              title="Expand all"
              aria-label="Expand all messages"
              className="rounded p-1 hover:text-fg"
            >
              <Icon name="unfoldMore" size={16} />
            </button>
            <button
              type="button"
              onClick={collapseAll}
              title="Collapse all"
              aria-label="Collapse all messages"
              className="rounded p-1 hover:text-fg"
            >
              <Icon name="unfoldLess" size={16} />
            </button>
          </div>
        </div>
        {/* Research above: source bubbles for Ally cards scrolled off the top.
            A vertical tick + "+N" near the spine edge, tap to scroll up. */}
        {researchAbove > 0 && (
          <button
            type="button"
            onClick={() => {
              const el = convo.ref.current;
              if (!el) return;
              convo.setPinned(false);
              el.scrollBy({ top: -el.clientHeight * 0.8, behavior: "smooth" });
            }}
            title={`${researchAbove} researched message${researchAbove > 1 ? "s" : ""} above — scroll up`}
            aria-label={`${researchAbove} researched messages above; scroll up`}
            className="glass-raised absolute right-1 top-[46px] z-10 flex items-center gap-1 rounded-full border border-ai/40 py-0.5 pl-1 pr-2 text-[10px] font-bold text-ai"
          >
            <Icon name="chevron" size={12} className="rotate-180" />
            <span className="h-3 w-px bg-ai/50" />+{researchAbove}
          </button>
        )}
        <div
          ref={convo.ref}
          onScroll={() => {
            convo.onScroll();
            bump();
          }}
          className={`flex flex-1 flex-col gap-2 overflow-y-auto px-2 py-3${barPad}`}
          role="log"
          aria-live="polite"
          aria-label="Conversation transcript"
        >
          {merged.length === 0 ? (
            <p className="mt-8 text-center text-xs text-fg-faint">
              The conversation appears here — them on the left, you on the
              right. Tap the ✦ lightbulb on any message to ask Ally.
            </p>
          ) : (
            turns.map((turn) => {
              const key = turn.key;
              const link = linkBySource.get(key);
              // A representative segment for the whole turn: first segment's
              // identity (so segmentKey === turn.key) with the combined final
              // text — lets research()/bubbleMenu() work unchanged.
              const finalText = turn.segments
                .filter((s) => s.is_final)
                .map((s) => s.text)
                .join(" ");
              const repSeg = {
                ...turn.segments[0]!,
                text: finalText,
                is_final: turn.segments.some((s) => s.is_final),
              };
              return (
                <Bubble
                  key={key}
                  segments={turn.segments}
                  turnKey={key}
                  registerEl={registerBubble}
                  highlighted={active?.sourceKey === key}
                  flashToken={flash?.key === key ? flash.token : null}
                  collapsed={collapsed.has(key)}
                  onToggleCollapse={() => toggleCollapse(key)}
                  onResearch={() => research(repSeg)}
                  onAskText={askText}
                  onSendToAsk={sendToAsk}
                  onAskTerm={askTerm}
                  onContextMenu={(e) => bubbleMenu(e, repSeg)}
                  linkedSeq={link ? link.seq : null}
                  onJumpLink={() => link && inspect(link.id, key)}
                  busy={busy}
                  fontPx={transcriptFontPx}
                  sessionStartMs={sessionStartMs}
                />
              );
            })
          )}
        </div>
        {!convo.pinned && (
          <button
            type="button"
            onClick={jumpToLive}
            className="glass-raised absolute bottom-[68px] left-1/2 flex -translate-x-1/2 items-center gap-2.5 rounded-full px-4 py-1.5 text-[12px]"
          >
            <span className="h-[7px] w-[7px] rounded-full bg-rec" />
            <span className="font-bold">{newCount > 0 ? `${newCount} new` : "Live"}</span>
            <span className="h-3.5 w-px bg-border-strong" />
            <span className="font-semibold text-inbound">Jump to live</span>
          </button>
        )}

        {/* Always-available Ask Ally field — lives with the conversation
            (moved here from the Ally column so it's reachable even when Ally
            folds into a drawer at narrow widths). */}
        <div className="shrink-0 border-t border-border px-3 py-2.5">
          <label className="flex h-9 items-center gap-2.5 rounded-[4px] border border-ai/30 bg-white/[0.04] px-3 transition-colors focus-within:border-ai/60">
            <Icon name="lightbulb" size={16} className="shrink-0 text-ai/70" />
            <input
              value={ask}
              onChange={(e) => setAsk(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submitAsk()}
              placeholder="Ask Ally anything…"
              aria-label="Ask Ally"
              className="min-w-0 flex-1 bg-transparent text-sm text-fg placeholder:text-fg-faint focus:outline-none"
            />
            <button
              type="button"
              onClick={submitAsk}
              disabled={busy || !ask.trim()}
              title="Ask Ally"
              aria-label="Send question to Ally"
              className="shrink-0 rounded-[4px] p-1.5 text-ai transition-colors hover:bg-ai/10 disabled:opacity-30"
            >
              <Icon name="chevron" size={16} className="rotate-90" />
            </button>
          </label>
        </div>
      </section>

      {/* Relationship spine — centre. Doubles as the draggable divider between
          the transcript and Ally columns (visual rail; nodes float in the
          overlay). */}
      <div
        ref={spineColRef}
        data-col="spine"
        onPointerDown={startSplitDrag}
        title={drawer ? undefined : "Drag to resize columns"}
        className={`group relative flex w-7 shrink-0 flex-col items-center border-r border-border bg-bg-2/40${
          drawer ? "" : " cursor-col-resize"
        }`}
      >
        <div className="h-11 w-full shrink-0 border-b border-border" />
        <div className="relative w-full flex-1">
          <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-[linear-gradient(180deg,transparent,var(--spine-line)_4%,var(--spine-line)_92%,transparent)]" />
          {!drawer && (
            <div
              className={`absolute inset-y-0 left-1/2 w-[3px] -translate-x-1/2 rounded-full transition-colors ${
                dragging ? "bg-ai/60" : "bg-transparent group-hover:bg-ai/30"
              }`}
            />
          )}
          <span className="absolute bottom-2 left-1/2 -translate-x-1/2 bg-bg-2/80 px-1 font-mono text-[9px] text-fg-faint">
            {nodes.length}
          </span>
        </div>
      </div>

      {/* Ally — right (inline ≥1180px, else an overlay drawer) */}
      {drawer && drawerOpen && (
        <button
          type="button"
          aria-label="Close Ally"
          onClick={() => setDrawerOpen(false)}
          className="absolute inset-0 z-20 cursor-default bg-bg/40"
        />
      )}
      <section
        data-col="ally"
        style={drawer ? undefined : { flexGrow: 1 - splitRatio, flexBasis: 0 }}
        className={
          drawer
            ? `absolute right-0 top-0 z-30 flex h-full w-[min(452px,88%)] flex-col border-l border-border bg-panel-raised shadow-[var(--shadow-lg)] transition-transform duration-200 ${drawerOpen ? "translate-x-0" : "translate-x-full"}`
            : "flex min-w-[240px] flex-1 flex-col bg-panel/40"
        }
      >
        <div className="relative flex h-11 shrink-0 items-center gap-3 border-b border-border px-5">
          <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-ai">
            Ally
          </span>
          <div className="ml-auto flex items-center gap-0.5 text-fg-faint">
            {/* One-tap Ally actions. */}
            <button
              type="button"
              disabled={busy}
              onClick={() => void request("suggest_reply")}
              title="Suggest a reply"
              aria-label="Suggest a reply"
              className="rounded p-1 text-ai/80 hover:bg-ai/10 hover:text-ai disabled:opacity-40"
            >
              <Icon name="lightbulb" size={16} />
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void request("summarize")}
              title="Summarize the conversation"
              aria-label="Summarize the conversation"
              className="rounded p-1 hover:text-fg disabled:opacity-40"
            >
              <Icon name="summarize" size={16} />
            </button>
            {/* Fold/unfold everything (one intuitive toggle). */}
            {(() => {
              const allCollapsed =
                allKeys.length > 0 && allKeys.every((k) => collapsed.has(k));
              return (
                <button
                  type="button"
                  onClick={allCollapsed ? expandAll : collapseAll}
                  title={allCollapsed ? "Expand all" : "Collapse all"}
                  aria-label={allCollapsed ? "Expand all" : "Collapse all"}
                  className="rounded p-1 hover:text-fg"
                >
                  <Icon name={allCollapsed ? "unfoldMore" : "unfoldLess"} size={16} />
                </button>
              );
            })()}
            {/* Overflow: text size, reasoning default, clear. */}
            <button
              type="button"
              onClick={() => setAllyMenu((o) => !o)}
              title="Ally options"
              aria-label="Ally options"
              aria-expanded={allyMenu}
              className={`rounded p-1 hover:text-fg ${allyMenu ? "text-fg" : ""}`}
            >
              <Icon name="more" size={16} />
            </button>
            {drawer && (
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                title="Close"
                aria-label="Close Ally"
                className="rounded p-1 hover:text-fg"
              >
                <Icon name="close" size={16} />
              </button>
            )}
          </div>

          {allyMenu && (
            <>
              <button
                type="button"
                aria-hidden
                tabIndex={-1}
                onClick={() => setAllyMenu(false)}
                className="fixed inset-0 z-40 cursor-default"
              />
              <div
                role="menu"
                className="glass-raised absolute right-3 top-[42px] z-50 w-56 rounded-lg border border-border p-2 shadow-[var(--shadow-lg)]"
              >
                <div className="flex items-center justify-between px-1.5 py-1 text-[12px]">
                  <span className="text-fg-muted">Text size</span>
                  <span className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => bumpAllyFont(-1)}
                      disabled={allyFontPx <= ALLY_FONT_MIN}
                      aria-label="Smaller text"
                      className="grid h-6 w-6 place-items-center rounded border border-border text-fg-muted hover:text-fg disabled:opacity-30"
                    >
                      A−
                    </button>
                    <span className="w-8 text-center font-mono text-[11px] text-fg-faint">
                      {allyFontPx}px
                    </span>
                    <button
                      type="button"
                      onClick={() => bumpAllyFont(1)}
                      disabled={allyFontPx >= ALLY_FONT_MAX}
                      aria-label="Larger text"
                      className="grid h-6 w-6 place-items-center rounded border border-border text-fg-muted hover:text-fg disabled:opacity-30"
                    >
                      A+
                    </button>
                  </span>
                </div>
                <button
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={reasoningDefaultOpen}
                  onClick={() => setReasoningDefaultOpen(!reasoningDefaultOpen)}
                  className="flex w-full items-center gap-2 rounded px-1.5 py-1.5 text-left text-[12px] text-fg hover:bg-white/[0.06]"
                >
                  <span
                    className={`grid h-4 w-4 place-items-center rounded-sm border ${reasoningDefaultOpen ? "border-ai bg-ai text-bg" : "border-border"}`}
                  >
                    {reasoningDefaultOpen && <Icon name="chevron" size={10} />}
                  </span>
                  Expand reasoning by default
                </button>
                <div className="my-1 h-px bg-border" />
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    clearAlly();
                    setAllyMenu(false);
                  }}
                  className="flex w-full items-center gap-2 rounded px-1.5 py-1.5 text-left text-[12px] text-fg-muted hover:bg-rec/10 hover:text-rec"
                >
                  <Icon name="trash" size={14} />
                  Clear Ally cards
                </button>
              </div>
            </>
          )}
        </div>
        <div
          ref={allyCol.ref}
          onScroll={() => {
            allyCol.onScroll();
            bump();
          }}
          className={`flex flex-1 flex-col gap-3.5 overflow-y-auto px-4 py-5${barPad}`}
          aria-label="Ally output"
        >
          {cards.length === 0 ? (
            <p className="mt-8 text-center text-xs text-fg-faint">
              Ally's answers land here — tap the lightbulb on any message, or use
              Ask Ally beneath the conversation.
            </p>
          ) : (
            <>
              {/* Pinned rise under a divider (V4.0 §7) — order among
                  themselves follows the normal newest-first list order. */}
              {cards.filter((c) => pinned.has(c.id)).length > 0 && (
                <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-ai/70">
                  Pinned
                </span>
              )}
              {cards
                .filter((c) => pinned.has(c.id))
                .map((card) => (
                  <AllyCardView
                    key={card.id}
                    card={card}
                    registerEl={registerCard}
                    highlighted={active?.cardId === card.id}
                    collapsed={collapsed.has(card.id)}
                    pinned
                    onTogglePin={() => togglePin(card.id)}
                    onOpenViewer={() => setViewerCardId(card.id)}
                    onToggleCollapse={() => toggleCollapse(card.id)}
                    onHover={setHover}
                    onInspect={() => inspect(card.id, card.sourceKey)}
                    onContextMenu={(e) => cardMenu(e, card)}
                  />
                ))}
              {cards
                .filter((c) => !pinned.has(c.id))
                .map((card) => (
                  <AllyCardView
                    key={card.id}
                    card={card}
                    registerEl={registerCard}
                    highlighted={active?.cardId === card.id}
                    collapsed={collapsed.has(card.id)}
                    pinned={false}
                    onTogglePin={() => togglePin(card.id)}
                    onOpenViewer={() => setViewerCardId(card.id)}
                    onToggleCollapse={() => toggleCollapse(card.id)}
                    onHover={setHover}
                    onInspect={() => inspect(card.id, card.sourceKey)}
                    onContextMenu={(e) => cardMenu(e, card)}
                  />
                ))}
            </>
          )}
        </div>
        {/* Minimized-cards dock (V4.0 §6: "a dock of toggle icon-buttons...
            minimize/maximize each card"). The reference packet assumes a
            fixed, named set of cards (Live summary/Open threads/Grounding);
            this app's Ally column is an open-ended, chronological feed
            instead, so an icon-only dock wouldn't stay legible. Adapted as a
            restore tray: a slim strip, one labeled chip per currently
            collapsed card, that appears only when there's something to
            restore — same intent (glance-and-recall what's tucked away)
            without forcing cards out of their scroll position. */}
        {(() => {
          const minimized = cards.filter((c) => collapsed.has(c.id));
          if (minimized.length === 0) return null;
          return (
            <div
              className="flex shrink-0 items-center gap-1.5 overflow-x-auto border-t border-border bg-bg-2 px-3 py-2"
              aria-label="Minimized Ally cards"
            >
              {minimized.map((card) => (
                <button
                  key={card.id}
                  type="button"
                  onClick={() => inspect(card.id, card.sourceKey)}
                  title={`Restore — A${card.seq} ${cardLabel(card)}`}
                  className="flex shrink-0 items-center gap-1.5 rounded-[var(--radius)] border border-border bg-panel px-2 py-1 text-[11px] font-semibold text-fg-muted transition hover:border-ai/40 hover:text-ai"
                >
                  <span className="font-mono text-[9px] text-fg-faint">
                    A{card.seq}
                  </span>
                  {cardLabel(card)}
                </button>
              ))}
            </div>
          );
        })()}
      </section>

      <ThreadViewer
        card={cards.find((c) => c.id === viewerCardId) ?? null}
        onClose={() => setViewerCardId(null)}
        onRequest={(kind, question, source) =>
          void request(kind, question, source)
        }
      />

      {/* Overlay: connector + floating spine nodes + hover preview */}
      <div className="pointer-events-none absolute inset-0">
        {connector && (
          <svg className="absolute inset-0 h-full w-full" aria-hidden>
            <path d={connector} fill="none" className="stroke-ai" strokeWidth={1.75} />
          </svg>
        )}
        {nodes.map((n) => {
          const on = active?.cardId === n.cardId;
          return (
            <button
              key={n.cardId}
              type="button"
              onMouseEnter={() => setHover({ cardId: n.cardId, sourceKey: n.sourceKey })}
              onMouseLeave={() => setHover(null)}
              onClick={() => inspect(n.cardId, n.sourceKey)}
              aria-label={`Ally entry A${n.seq}`}
              className="pointer-events-auto absolute grid -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full font-mono font-bold"
              style={{
                left: spineX,
                top: n.y,
                width: on ? 24 : 18,
                height: on ? 24 : 18,
                fontSize: 9,
                background: on ? "var(--color-ai)" : "rgba(255,194,75,0.28)",
                border: on ? "none" : "1px solid rgba(255,194,75,0.55)",
                color: on ? "var(--color-bg)" : "var(--color-ai)",
                boxShadow: on ? "0 0 0 5px rgba(255,194,75,0.14)" : "none",
              }}
            >
              A{n.seq}
            </button>
          );
        })}
        {active?.sourceKey && activeNode && base && !sourceBubbleInView && (
          <div
            className="glass-raised absolute w-[240px] -translate-y-1/2 rounded-xl p-3 text-[12px]"
            style={{ top: activeNode.y, left: spineX - 24, transform: "translate(-100%,-50%)" }}
          >
            <div className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-ai">
              A{activeNode.seq} · derived from
            </div>
            <div className="leading-snug text-fg-muted">
              {(() => {
                const c = cards.find((x) => x.id === active.cardId);
                return c?.sourceQuote
                  ? `“${c.sourceQuote.slice(0, 110)}${c.sourceQuote.length > 110 ? "…" : ""}”`
                  : "this message";
              })()}
            </div>
          </div>
        )}
      </div>

      {menu && <ContextMenu menu={menu} onClose={() => setMenu(null)} />}
    </main>
  );
}

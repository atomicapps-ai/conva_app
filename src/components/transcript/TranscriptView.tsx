import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { LiveControlBar } from "@/components/studio/LiveControlBar";
import { LiveTopBar } from "@/components/studio/LiveTopBar";
import { TrackerRail } from "@/components/TrackerRail";
import { Icon, type IconName } from "@/components/ui/Icon";
import { useBackend } from "@/lib/backend";
import type { AllyKind, AudioLevelEvent, Capture, TranscriptSegment } from "@/lib/ipc";
import { isTauri } from "@/lib/ipc";
import {
  collectFanerHits,
  fanerAccent,
  fanerLabel,
  fanerPrompt,
  isFanerBoundaryMatch,
  type FanerHit,
} from "@/lib/faner";
import { useAppStore } from "@/state/app";
import { useAllyStore, type AllyCard } from "@/state/ally";
import { useGroundingStore } from "@/state/grounding";
import { useRehearsalStore } from "@/state/rehearsal";
import { useTranscriptStore } from "@/state/transcript";
import { useTranscriptJump } from "@/state/transcriptJump";
import { ALLY_FONT_MAX, ALLY_FONT_MIN, useUiPrefs } from "@/state/uiPrefs";
import { groupTurns, segmentKey } from "@/lib/turns";

// Stable reference so a Zustand selector reading `capture?.captures` never
// hands React a "new" empty array on every render before the first
// CaptureEvent lands (same fix `FanerReplayPanel.tsx` uses).
const EMPTY_CAPTURES: Capture[] = [];

function formatMs(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/** dBFS [-60,0] → 0..1. */
function levelUnit(level: AudioLevelEvent | null): number {
  if (!level) return 0;
  return Math.max(0, Math.min(1, (level.rms_dbfs + 60) / 60));
}

/** Tiny live level meter — moved here from the now-removed global `TopBar`
 *  (V4.0's `chanhead` puts Them/You meters in the transcript header itself,
 *  not a separate global strip). */
function Bars({ level, color }: { level: AudioLevelEvent | null; color: string }) {
  const u = levelUnit(level);
  const shape = [0.5, 0.8, 1, 0.75, 0.55];
  const H = 14;
  return (
    <span className="flex h-[14px] items-end gap-[2px]" aria-hidden>
      {shape.map((k, i) => (
        <span
          key={i}
          className="w-[2px] rounded-full transition-[height,opacity] duration-100 ease-out"
          style={{
            height: `${Math.max(2, u * k * H)}px`,
            background: color,
            opacity: 0.3 + u * 0.7,
          }}
        />
      ))}
    </span>
  );
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
        className="font-semibold text-ai underline decoration-2 underline-offset-2 hover:decoration-ai"
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

/** One FANER-marked term: persistently bold+underlined, color-coded by the
 *  capture's routed `action` (F11 handoff, 2026-08-20). Hovering reveals a
 *  popover with the capture's `preview` and the same three action icons
 *  `SelectionMenu` uses (Ask Ally / Copy / Send to Ask Ally) — consistent
 *  with the rest of the app's "act on this text" vocabulary rather than a
 *  one-off FANER-specific control set. Pure CSS group-hover (like the dev
 *  panel's tooltip): the popover is a normal, clickable descendant of the
 *  hover group, not a `pointer-events-none` tooltip, so its icons work. */
function FanerMark({
  hit,
  onAsk,
  onSendToAsk,
}: {
  hit: FanerHit;
  onAsk: (capture: Capture, phrase: string) => void;
  onSendToAsk: (text: string) => void;
}) {
  const { phrase, capture } = hit;
  return (
    <span className={`group relative inline-block ${fanerAccent(capture)}`}>
      <span className="cursor-help underline decoration-2 underline-offset-2 font-semibold">
        {phrase}
      </span>
      <span className="invisible absolute left-0 top-full z-50 mt-1 w-64 max-w-[85vw] -translate-x-1/2 rounded-lg border border-border bg-panel-raised p-2 text-[12px] normal-case leading-snug text-fg opacity-0 shadow-[var(--shadow-lg)] transition-opacity duration-100 group-hover:visible group-hover:opacity-100">
        <span className="mb-1 block font-mono text-[9px] uppercase tracking-wide text-fg-faint">
          {fanerLabel(capture)}
        </span>
        <p className="mb-1.5 text-fg-muted">{capture.preview || "(no preview yet)"}</p>
        <span className="flex items-center gap-0.5 border-t border-border pt-1">
          <button
            type="button"
            title="Ask Ally about this"
            aria-label={`Ask Ally about "${phrase}"`}
            onClick={() => onAsk(capture, phrase)}
            className="rounded p-1 text-ai/80 transition-colors hover:bg-ai/10 hover:text-ai"
          >
            <Icon name="lightbulb" size={14} />
          </button>
          <button
            type="button"
            title="Copy"
            aria-label={`Copy "${phrase}"`}
            onClick={() => void navigator.clipboard.writeText(phrase)}
            className="rounded p-1 text-fg-faint transition-colors hover:bg-panel-raised/60 hover:text-fg"
          >
            <Icon name="copy" size={14} />
          </button>
          <button
            type="button"
            title="Send to Ask Ally"
            aria-label={`Send "${phrase}" to Ask Ally`}
            onClick={() => onSendToAsk(phrase)}
            className="rounded p-1 text-fg-faint transition-colors hover:bg-panel-raised/60 hover:text-fg"
          >
            <Icon name="chevron" size={14} className="rotate-90" />
          </button>
        </span>
      </span>
    </span>
  );
}

/** Splits `text` between FANER-marked spans (`FanerMark`) and everything
 *  else, which still goes through `HighlightedText` — so a FANER span and a
 *  RAG term/search-highlight can coexist in the same unit without one
 *  mechanism overriding the other. Hit computation is memoized on `text` +
 *  `captures`'s reference (F11 handoff requirement — the transcript
 *  re-renders on every streamed token, but `captures` only changes when a
 *  new CaptureEvent lands and `text` only changes for the turn currently
 *  streaming). */
function FanerAwareText({
  text,
  captures,
  terms,
  onAskTerm,
  onAskFaner,
  onSendToAsk,
}: {
  text: string;
  captures: Capture[];
  terms: string[];
  onAskTerm: (action: TermAction, term: string) => void;
  onAskFaner: (capture: Capture, phrase: string) => void;
  onSendToAsk: (text: string) => void;
}) {
  const hits = useMemo(() => collectFanerHits(text, captures), [text, captures]);
  if (hits.length === 0) return <HighlightedText text={text} terms={terms} onAsk={onAskTerm} />;

  const lower = text.toLowerCase();
  const nodes: ReactNode[] = [];
  let plainStart = 0;
  let key = 0;
  const flushPlain = (end: number) => {
    if (end > plainStart) {
      nodes.push(
        <HighlightedText
          key={`p${key++}`}
          text={text.slice(plainStart, end)}
          terms={terms}
          onAsk={onAskTerm}
        />,
      );
    }
  };
  let i = 0;
  outer: while (i < text.length) {
    for (const h of hits) {
      const p = h.phrase.toLowerCase();
      // `collectFanerHits` only proves the phrase appears *somewhere* at a
      // real word boundary; re-check the boundary here too, since this scan
      // finds every raw substring occurrence and a phrase can have both
      // valid (whole-word) and invalid (mid-word) occurrences in the same
      // text — only the valid ones should render as a mark.
      if (p && lower.startsWith(p, i) && isFanerBoundaryMatch(lower, i, p.length)) {
        flushPlain(i);
        nodes.push(
          <FanerMark
            key={`f${key++}`}
            hit={h}
            onAsk={onAskFaner}
            onSendToAsk={onSendToAsk}
          />,
        );
        i += h.phrase.length;
        plainStart = i;
        continue outer;
      }
    }
    i += 1;
  }
  flushPlain(text.length);
  return <>{nodes}</>;
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
  onMouseEnter,
  onMouseLeave,
}: {
  x: number;
  y: number;
  text: string;
  onAsk: (t: string) => void;
  onSendToAsk: (t: string) => void;
  onClose: () => void;
  /** Set while the pointer is over the menu itself — the hover-triggered
   *  (post-selection) instance uses this so moving from the selected text
   *  into the menu doesn't close it (F11, 2026-08-20). Unused by the
   *  right-click instance, which isn't hover-gated. */
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
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
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
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
  captures,
  onAskText,
  onAskTerm,
  onAskFaner,
  onSendToAsk,
}: {
  units: string[];
  terms: string[];
  /** FANER captures to mark inline (F11) — filtered/matched per-unit by
   *  `FanerAwareText`, not here. */
  captures: Capture[];
  onAskText: (t: string) => void;
  onAskTerm: (action: TermAction, term: string) => void;
  onAskFaner: (capture: Capture, phrase: string) => void;
  onSendToAsk: (text: string) => void;
}) {
  return (
    <span className="leading-snug">
      {units.map((unit, i) => (
        <span
          key={i}
          className="group/u rounded-[3px] px-0.5 transition-colors hover:bg-ai/10"
        >
          <FanerAwareText
            text={unit}
            captures={captures}
            terms={terms}
            onAskTerm={onAskTerm}
            onAskFaner={onAskFaner}
            onSendToAsk={onSendToAsk}
          />
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
 *  floats at the top-centre edge. A turn with derived Ally research carries a
 *  "N threads" pill below it (V4.0's `.turn-thread`) — replaces the old
 *  single "A#" jump chip now that a turn can have more than one card and
 *  cards no longer live in a separate column to jump *to*. */
function Bubble({
  segments,
  turnKey,
  registerEl,
  flashToken,
  collapsed,
  onToggleCollapse,
  onResearch,
  onAskText,
  onSendToAsk,
  onAskTerm,
  onContextMenu,
  threadCount,
  onOpenThreads,
  busy,
  fontPx,
  sessionStartMs,
  searchHighlight,
  captures,
  onAskFaner,
}: {
  segments: TranscriptSegment[];
  turnKey: string;
  registerEl: (key: string, el: HTMLElement | null) => void;
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
  /** How many Ally cards derive from this turn — 0 hides the pill. */
  threadCount: number;
  onOpenThreads: () => void;
  busy: boolean;
  fontPx: number;
  /** Session start (epoch ms) so the time hover can show a wall-clock. */
  sessionStartMs: number | null;
  /** A landed search query (owner request, 2026-08-17) — folded into the
   *  RAG `terms` highlight pass below so every occurrence in this bubble
   *  renders highlighted, same visual treatment as a RAG term. */
  searchHighlight?: string | null;
  /** FANER's routed captures for the whole session (F11, 2026-08-20) —
   *  matched against this bubble's own text by `FanerAwareText`. Applies to
   *  both columns (you + them): a `task_frame`/`prep_reference` capture can
   *  originate from either speaker, and matching is purely text-based
   *  (same principle as the search highlight above), so side-restricting
   *  would silently drop real captures without a corresponding upside. */
  captures: Capture[];
  onAskFaner: (capture: Capture, phrase: string) => void;
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

  // Fold the landed search query into the RAG term list so it renders
  // highlighted with the same treatment (HighlightedText doesn't care which
  // list a term came from) — case-insensitively de-duped against a RAG term
  // that already covers the same word.
  const highlightTerms =
    searchHighlight && !terms.some((t) => t.toLowerCase() === searchHighlight.toLowerCase())
      ? [...terms, searchHighlight]
      : terms;

  // Selection → icon menu (ask / copy / send-to-ask). Two ways in, both
  // opening the SAME `SelectionMenu` (F11, 2026-08-20 — owner decision):
  //  - Passive: release the mouse after dragging a selection. The pointer
  //    is already exactly where the drag ended, so the menu shows
  //    immediately with no extra action — then behaves like a real hover
  //    card, closing the moment the pointer leaves both the selected text
  //    and the menu itself (`rect` below is what makes an instance
  //    hover-gated; see the effect after this).
  //  - Explicit: right-click a selection, e.g. after the pointer has
  //    already moved off it. Opens at the click point and stays open until
  //    dismissed (Escape / resize / scroll / an icon click) — not
  //    hover-gated, since right-click is already a deliberate action, not
  //    something that should vanish if you don't hold still.
  const [sel, setSel] = useState<
    { x: number; y: number; text: string; rect: DOMRect | null } | null
  >(null);
  // True while the pointer is over the menu itself, for the hover-gated
  // instance — read by the effect below so crossing the small visual gap
  // between the selected text and the menu doesn't close it.
  const menuHoveredRef = useRef(false);
  const onMouseUp = () => {
    const s = window.getSelection();
    const text = s?.toString().trim() ?? "";
    if (!text || !s || s.rangeCount === 0) {
      setSel(null);
      return;
    }
    const r = s.getRangeAt(0).getBoundingClientRect();
    setSel({ x: r.left + r.width / 2, y: r.bottom, text, rect: r });
  };
  const onBubbleContextMenu = (e: React.MouseEvent) => {
    const text = window.getSelection()?.toString().trim() ?? "";
    if (text) {
      e.preventDefault();
      setSel({ x: e.clientX, y: e.clientY, text, rect: null });
      return;
    }
    onContextMenu(e);
  };
  // Hover-gating for the passive (mouseup) instance: close it the moment
  // the pointer is over neither the selected text's bounding box (padded a
  // little so the small visual gap up to the menu doesn't false-trigger a
  // close) nor the menu itself. Skipped entirely when `rect` is null — the
  // right-click instance stays open regardless of pointer position.
  useEffect(() => {
    if (!sel?.rect) return;
    const rect = sel.rect;
    const PAD = 8;
    const onMove = (e: MouseEvent) => {
      const overText =
        e.clientX >= rect.left - PAD &&
        e.clientX <= rect.right + PAD &&
        e.clientY >= rect.top - PAD &&
        e.clientY <= rect.bottom + PAD;
      if (!overText && !menuHoveredRef.current) setSel(null);
    };
    window.addEventListener("mousemove", onMove);
    return () => window.removeEventListener("mousemove", onMove);
  }, [sel]);

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
      onContextMenu={onBubbleContextMenu}
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
        ].join(" ")}
      >
        {/* One-shot azure flash — a thread just opened to this bubble
            (V4.0 §8). The accent, not a voice colour: this is chrome
            feedback, not speaker identity. Keyed by token so it remounts —
            and replays — on every jump, including repeats. */}
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
                terms={highlightTerms}
                captures={captures}
                onAskText={onAskText}
                onAskTerm={onAskTerm}
                onAskFaner={onAskFaner}
                onSendToAsk={onSendToAsk}
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
            onMouseEnter={() => {
              menuHoveredRef.current = true;
            }}
            onMouseLeave={() => {
              menuHoveredRef.current = false;
            }}
          />
        )}
      </div>

      {/* "N threads" pill (V4.0's `.turn-thread`) — opens the viewer on the
          newest card derived from this turn. Aligned to the speaker's side,
          same as the bubble above it. */}
      {threadCount > 0 && (
        <div className={`mt-1.5 flex ${inbound ? "justify-start" : "justify-end"}`}>
          <button
            type="button"
            onClick={onOpenThreads}
            title={`${threadCount} Ally thread${threadCount > 1 ? "s" : ""} from this message`}
            className="flex items-center gap-1.5 rounded-full border border-ai/35 bg-ai/10 px-2.5 py-1 font-mono text-[9.5px] font-semibold text-ai transition hover:bg-ai/20"
          >
            <Icon name="lightbulb" size={11} />
            {threadCount} thread{threadCount > 1 ? "s" : ""}
          </button>
        </div>
      )}
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
  // Distinct from both neighbors: expand on the SAME answer (more context,
  // not a reword like Rephrase, not a wider dig like Research this line).
  const moreDetail = () =>
    onRequest(
      "question",
      `Give more detail on this — expand with more context, keep the same core answer: "${sayText}"`,
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
              onClick={moreDetail}
              className="rounded-full border border-ai/40 px-3.5 py-1.5 text-[12px] font-bold text-ai transition hover:bg-ai/10"
            >
              More detail
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

/**
 * An Ally answer rendered INLINE in the transcript stream (V4.0's
 * `.allycard` — notched top-left corner, gold left spine, "SAY THIS"/label
 * eyebrow). Replaces the old separate-column `AllyCardView`: cards with a
 * `sourceKey` now render right after the turn they were derived from;
 * cards with none (freeform "Ask Ally" questions) render at the end of the
 * stream, in the order they were asked.
 */
function InlineAllyCard({
  card,
  registerEl,
  flashToken,
  collapsed,
  onToggleCollapse,
  onOpenViewer,
  onContextMenu,
  onRequest,
  fontPx,
}: {
  card: AllyCard;
  registerEl: (id: string, el: HTMLElement | null) => void;
  flashToken: number | null;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onOpenViewer: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onRequest: (
    kind: AllyKind,
    question?: string,
    source?: { key: string; quote: string },
  ) => void;
  fontPx: number;
}) {
  const label = cardLabel(card);
  const suggest = card.kind === "suggest_reply";
  const eyebrow = suggest ? "Say this" : label;
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
  // Distinct from both neighbors: expand on the SAME answer (more context,
  // not a reword like Rephrase, not a wider dig like Research this line).
  const moreDetail = () =>
    onRequest(
      "question",
      `Give more detail on this — expand with more context, keep the same core answer: "${sayText}"`,
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
      ref={(el) => registerEl(card.id, el)}
      onContextMenu={onContextMenu}
      style={{ clipPath: "polygon(0 10px, 10px 0, 100% 0, 100% 100%, 0 100%)" }}
      className="relative w-[96%] border border-ai/34 bg-ai/[0.06] py-2.5 pl-4 pr-3"
    >
      {flashToken !== null && (
        <span
          key={flashToken}
          className="pointer-events-none absolute inset-0 ring-2 ring-primary/70 animate-flash-ring"
          aria-hidden
        />
      )}
      {/* Gold left spine — Ally's identity colour, never borrowed by chrome. */}
      <span
        className="absolute bottom-2.5 left-0 top-2.5 w-[3px] rounded-full bg-ai"
        aria-hidden
      />
      <div
        onClick={onToggleCollapse}
        role="button"
        tabIndex={0}
        aria-expanded={!collapsed}
        aria-label={`${collapsed ? "Expand" : "Collapse"} ${eyebrow} answer`}
        className="flex cursor-pointer select-none items-center gap-2.5"
      >
        <span className="grid h-[20px] min-w-[20px] shrink-0 place-items-center rounded-[6px] bg-ai font-mono text-[9px] font-bold text-bg">
          AI
        </span>
        <span className="shrink-0 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-ai">
          {eyebrow}
        </span>
        {!card.done && (
          <span className="shrink-0 text-[11px] text-fg-faint" role="status">
            thinking…
          </span>
        )}
        {collapsed && card.text && (
          <span className="min-w-0 flex-1 truncate text-[11px] text-fg-muted">
            {card.text}
          </span>
        )}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onOpenViewer();
          }}
          title="Open in viewer"
          aria-label={`Open A${card.seq} in the viewer`}
          className="ml-auto shrink-0 rounded p-0.5 text-fg-faint transition-colors hover:text-ai"
        >
          <Icon name="expand" size={13} />
        </button>
      </div>

      {!collapsed && (
        <div
          className="mt-2 flex flex-col gap-2 text-fg leading-relaxed"
          style={{ fontSize: `${fontPx}px` }}
        >
          {card.error ? (
            <p className="text-[13px] text-rec">{card.error}</p>
          ) : card.text ? (
            <>
              <AnswerBody text={sayText} />
              <ReasoningBlock text={context} />
            </>
          ) : (
            <p className="text-[13px] text-fg-muted">…</p>
          )}

          {sources.length > 0 && (
            <p className="flex items-center gap-1.5 font-mono text-[10.5px] text-fg-faint">
              <Icon name="file" size={12} className="text-ai" />
              {sources.join(" · ")}
            </p>
          )}

          {!card.error && card.done && (
            <div className="mt-0.5 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void navigator.clipboard.writeText(sayText)}
                className="rounded-full bg-ai px-3 py-1 text-[11.5px] font-bold text-bg transition hover:brightness-110"
              >
                Use it
              </button>
              <button
                type="button"
                onClick={rephrase}
                className="rounded-full border border-ai/40 px-3 py-1 text-[11.5px] font-bold text-ai transition hover:bg-ai/10"
              >
                Rephrase
              </button>
              <button
                type="button"
                onClick={moreDetail}
                className="rounded-full border border-ai/40 px-3 py-1 text-[11.5px] font-bold text-ai transition hover:bg-ai/10"
              >
                More detail
              </button>
              <button
                type="button"
                onClick={researchMore}
                className="rounded-full border border-border-strong px-3 py-1 text-[11.5px] font-medium text-fg-muted transition hover:text-fg"
              >
                Research this line
              </button>
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

/** One row in the meta panel's "Open threads" list (V4.0's `.thread`) — a
 *  status dot, a one-line preview, pin. Clicking opens the viewer. */
function ThreadRow({
  card,
  pinned,
  onTogglePin,
  onOpen,
}: {
  card: AllyCard;
  pinned: boolean;
  onTogglePin: () => void;
  onOpen: () => void;
}) {
  const label = cardLabel(card);
  const dotClass = card.error
    ? "bg-rec"
    : card.done
      ? "bg-ok"
      : "bg-ai animate-pulse";
  const tag = card.error ? "ERROR" : card.done ? "DONE" : "OPEN";
  return (
    <div className="group flex items-center gap-2 py-1.5 text-[12.5px]">
      <span className={`h-2 w-2 shrink-0 rounded-full ${dotClass}`} aria-hidden />
      <button
        type="button"
        onClick={onOpen}
        title={`A${card.seq} · ${label}`}
        className="min-w-0 flex-1 truncate text-left text-fg transition hover:text-ai"
      >
        {card.text || label}
      </button>
      <span className="shrink-0 font-mono text-[9px] tracking-[0.1em] text-fg-faint">
        {tag}
      </span>
      <button
        type="button"
        onClick={onTogglePin}
        title={pinned ? `Unpin A${card.seq}` : `Pin A${card.seq} to the top`}
        aria-pressed={pinned}
        className={[
          "shrink-0 rounded p-0.5 transition-opacity",
          pinned ? "text-ai opacity-100" : "text-fg-faint opacity-0 hover:text-ai group-hover:opacity-100",
        ].join(" ")}
      >
        <Icon name="pin" size={12} />
      </button>
    </div>
  );
}

/**
 * The right meta panel (V4.0's `.ally-panel`) — Live summary / Open threads /
 * Grounding, replacing the old answer-card column now that answers render
 * inline in the transcript. See the note at the top of `TranscriptView` for
 * the two honest gaps this surfaces (no continuously-updating summary, no
 * open/waiting/resolved thread lifecycle — both flagged inline below rather
 * than faked).
 */
function AllyMetaPanel({
  cards,
  pinned,
  togglePin,
  onOpenViewer,
  busy,
  request,
  allyFontPx,
  bumpAllyFont,
  reasoningDefaultOpen,
  setReasoningDefaultOpen,
  clearAlly,
  barPad,
}: {
  cards: AllyCard[];
  pinned: Set<string>;
  togglePin: (id: string) => void;
  onOpenViewer: (card: AllyCard) => void;
  busy: boolean;
  request: (
    kind: AllyKind,
    question?: string,
    source?: { key: string; quote: string },
  ) => Promise<void>;
  allyFontPx: number;
  bumpAllyFont: (d: number) => void;
  reasoningDefaultOpen: boolean;
  setReasoningDefaultOpen: (v: boolean) => void;
  clearAlly: () => void;
  barPad: string;
}) {
  const backend = useBackend();
  const activeId = useGroundingStore((s) => s.activeId);
  const activeTitle = useGroundingStore((s) => s.activeTitle);
  const [groundingDocs, setGroundingDocs] = useState<string[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!activeId || !isTauri()) {
      setGroundingDocs([]);
      return;
    }
    let alive = true;
    void Promise.all([backend.simcon.load(activeId), backend.rag.list()])
      .then(([session, docs]) => {
        if (!alive) return;
        const names = session.source_doc_ids
          .map((id) => docs.find((d) => d.id === id)?.file_name)
          .filter((n): n is string => Boolean(n));
        setGroundingDocs(names);
      })
      .catch(() => alive && setGroundingDocs([]));
    return () => {
      alive = false;
    };
  }, [activeId, backend]);

  const [visible, setVisible] = useState({ summary: true, threads: true, grounding: true });
  const toggleVisible = (k: keyof typeof visible) =>
    setVisible((v) => ({ ...v, [k]: !v[k] }));

  // Most recent manual summary, if any — not a continuously-updating live
  // summary (that would need a background summarizer this app doesn't have
  // yet; see the doc comment above).
  const latestSummary = cards.find((c) => c.kind === "summarize") ?? null;
  const pinnedCards = cards.filter((c) => pinned.has(c.id));
  const restCards = cards.filter((c) => !pinned.has(c.id));

  return (
    <aside className={`flex h-full w-[300px] shrink-0 flex-col border-l border-border bg-bg-2${barPad}`}>
      <div className="relative flex h-11 shrink-0 items-center gap-2 border-b border-border px-4">
        <Icon name="ally" size={15} className="text-ai" />
        <span className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-ai">
          Ally
        </span>
        <span className="ml-auto font-mono text-[10.5px] text-fg-faint">
          {groundingDocs.length > 0
            ? `${groundingDocs.length} doc${groundingDocs.length === 1 ? "" : "s"} indexed`
            : "no docs indexed"}
        </span>
        <button
          type="button"
          onClick={() => setMenuOpen((o) => !o)}
          title="Ally options"
          aria-label="Ally options"
          aria-expanded={menuOpen}
          className={`ml-1 rounded p-1 text-fg-faint hover:text-fg ${menuOpen ? "text-fg" : ""}`}
        >
          <Icon name="more" size={15} />
        </button>
        {menuOpen && (
          <>
            <button
              type="button"
              aria-hidden
              tabIndex={-1}
              onClick={() => setMenuOpen(false)}
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
                  setMenuOpen(false);
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

      <div className="flex flex-1 flex-col gap-3.5 overflow-y-auto p-3.5">
        {visible.summary && (
          <div className="rounded-[var(--radius)] border border-border bg-panel p-3.5">
            <h4 className="mb-2 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-fg-muted">
              Live summary
            </h4>
            {latestSummary ? (
              latestSummary.error ? (
                <p className="text-[12px] text-rec">{latestSummary.error}</p>
              ) : (
                <p className="text-[12.5px] leading-relaxed text-fg-muted">
                  {latestSummary.text || "…"}
                </p>
              )
            ) : (
              <p className="text-[12.5px] leading-relaxed text-fg-faint">
                No summary yet — ask Ally to summarize.
              </p>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={() => void request("summarize")}
              className="mt-2.5 text-[11px] font-semibold text-ai transition hover:underline disabled:opacity-40"
            >
              {latestSummary ? "Refresh summary" : "Summarize now"}
            </button>
          </div>
        )}

        {visible.threads && (
          <div className="rounded-[var(--radius)] border border-border bg-panel p-3.5">
            <h4 className="mb-2 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-fg-muted">
              Open threads
            </h4>
            {cards.length === 0 ? (
              <p className="text-[12px] text-fg-faint">
                Ally's answers land here as you go — tap the lightbulb on any
                message, or use Ask Ally beneath the conversation.
              </p>
            ) : (
              <div className="flex flex-col divide-y divide-border">
                {pinnedCards.length > 0 && (
                  <>
                    <span className="pb-1 font-mono text-[9.5px] font-bold uppercase tracking-[0.16em] text-fg-faint">
                      Pinned
                    </span>
                    {pinnedCards.map((c) => (
                      <ThreadRow
                        key={c.id}
                        card={c}
                        pinned
                        onTogglePin={() => togglePin(c.id)}
                        onOpen={() => onOpenViewer(c)}
                      />
                    ))}
                  </>
                )}
                <div className="max-h-[160px] overflow-y-auto">
                  {restCards.map((c) => (
                    <ThreadRow
                      key={c.id}
                      card={c}
                      pinned={false}
                      onTogglePin={() => togglePin(c.id)}
                      onOpen={() => onOpenViewer(c)}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {visible.grounding && (
          <div className="rounded-[var(--radius)] border border-border bg-panel p-3.5">
            <h4 className="mb-2 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-fg-muted">
              Grounding
            </h4>
            {groundingDocs.length === 0 ? (
              <p className="text-[12px] text-fg-faint">
                {activeTitle ?? "No context grounded yet."}
              </p>
            ) : (
              <div className="flex flex-col gap-1.5">
                {groundingDocs.map((name) => (
                  <div key={name} className="flex items-center gap-2 text-[12px] text-fg-muted">
                    <Icon name="file" size={13} className="shrink-0 text-fg-faint" />
                    <span className="min-w-0 flex-1 truncate">{name}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Dock — show/hide each card. Deliberately BUTTONS, not tabs
          (owner, 2026-08-17): these are independent on/off toggles —
          several can be on at once — and the tab silhouette is reserved
          for exclusive selection (the nav rail: exactly one page active).
          A tab treatment was built here once and reverted the same day
          over exactly that semantics clash. ON = the visible-pressed look
          (raised fill + azure, the earlier "invisible active state" fix);
          OFF = quiet hairline. */}
      <div className="flex shrink-0 gap-1.5 border-t border-border p-2.5">
        {(
          [
            ["summary", "summarize", "live summary"],
            ["threads", "lightbulb", "open threads"],
            ["grounding", "file", "grounding"],
          ] as const
        ).map(([key, icon, name]) => (
          <button
            key={key}
            type="button"
            onClick={() => toggleVisible(key)}
            aria-pressed={visible[key]}
            title={visible[key] ? `Hide ${name}` : `Show ${name}`}
            className={[
              "grid h-8 flex-1 place-items-center rounded-[var(--radius)] border transition",
              visible[key]
                ? "border-primary/50 bg-panel-raised text-primary"
                : "border-border text-fg-faint hover:border-border-strong hover:text-fg",
            ].join(" ")}
          >
            <Icon name={icon} size={15} />
          </button>
        ))}
      </div>
    </aside>
  );
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
 * The live cockpit (V4.0 full rebuild): transcript left — Ally answers
 * render INLINE as notched gold-spine cards, chronologically among the
 * turns they were derived from — and a meta panel right (Live summary /
 * Open threads / Grounding), replacing the old transcript | spine |
 * answer-column three-way split. The spine (a 72px relationship column with
 * hand-drawn connector lines) is gone entirely: nothing to connect across
 * once an answer sits right next to the turn it came from. See
 * `AllyMetaPanel`'s doc comment for the two honest gaps this surfaced (no
 * live-updating summary, no open/waiting/resolved thread lifecycle) and
 * `LiveControlBar`/`LiveTopBar` for the earlier chrome-rebuild stage.
 *
 * Breadcrumb-header audit (V4.0 full rebuild): every other routed view
 * composes `ViewShell`, which gives it a `breadcrumb › title` crown per the
 * app-UI brief's "always" rule (§4.1). Live used to be the one deliberate
 * exception (ViewShell's crown cost ~64-68px taken from the transcript,
 * and §4.3/§8 said never shrink the transcript first). The mockup's own
 * Live cockpit *does* carry a crown though (`Contexts › Amazon Interview`),
 * so that exception is retired: `LiveTopBar` gives Live its own lighter
 * crown (no scrolling-body wrapper, just the header row) and `LiveControlBar`
 * replaces the Start/Stop/Record cluster that used to live in the now-
 * removed global `TopBar` — see both files for the mockup mapping and the
 * gaps found along the way (Pause/mic-mute/Ally-mute have no backend yet).
 */
export function TranscriptView() {
  const liveSegments = useTranscriptStore((s) => s.segments);
  const levels = useTranscriptStore((s) => s.levels);
  const archived = useTranscriptStore((s) => s.archived);
  const compact = useAppStore((s) => s.compact);
  const cards = useAllyStore((s) => s.cards);
  const busy = useAllyStore((s) => s.busy);
  const request = useAllyStore((s) => s.request);
  const clearAlly = useAllyStore((s) => s.clear);
  // FANER's routed captures for this session (F11) — matched against each
  // bubble's text by `FanerAwareText`/`FlowText`.
  const captures = useAllyStore((s) => s.capture?.captures ?? EMPTY_CAPTURES);
  // While a rehearsal is running, the floating RehearsalBar sits over the
  // bottom of both panes — pad them so their last content stays reachable.
  const rehearsing = useRehearsalStore((s) => s.active);
  const barPad = rehearsing ? " pb-16" : "";
  // Ally prefs (font size, reasoning default) — read by AllyMetaPanel/InlineAllyCard.
  const allyFontPx = useUiPrefs((s) => s.allyFontPx);
  const bumpAllyFont = useUiPrefs((s) => s.bumpAllyFont);
  const reasoningDefaultOpen = useUiPrefs((s) => s.reasoningDefaultOpen);
  const setReasoningDefaultOpen = useUiPrefs((s) => s.setReasoningDefaultOpen);
  const transcriptFontPx = useUiPrefs((s) => s.transcriptFontPx);
  const bumpTranscriptFont = useUiPrefs((s) => s.bumpTranscriptFont);
  const collapseYou = useUiPrefs((s) => s.collapseYou);
  const setCollapseYou = useUiPrefs((s) => s.setCollapseYou);
  // Session start (epoch ms) — lets a bubble's time hover show a wall-clock.
  const sessionEvent = useTranscriptStore((s) => s.session);
  const sessionStartMs =
    sessionEvent.state === "listening" ? sessionEvent.started_at_unix_ms : null;

  const containerRef = useRef<HTMLDivElement>(null);
  const bubbleEls = useRef(new Map<string, HTMLElement>());
  const cardEls = useRef(new Map<string, HTMLElement>());

  // Search result hand-off (owner request, 2026-08-17): consumed once at
  // mount, same one-shot pattern as ContextsView's quickOpenId. `key` drives
  // the scroll+flash below; `query`, if present, stays around for the
  // lifetime of this mount so every occurrence of the searched word — not
  // just the jumped-to turn — renders highlighted (Bubble → FlowText →
  // HighlightedText, folded into its `terms` list).
  const [jumpRequest] = useState(() => useTranscriptJump.getState().consume());
  const [searchHighlight] = useState<string | null>(jumpRequest?.query ?? null);

  // One-shot azure flash on the bubble/card a thread opens to (V4.0 §8).
  // `token` forces the flash element to remount (via its React `key`) so
  // opening the same thread twice in a row still replays the animation.
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
  // `collapsed` below. Pinned rise to the top of the meta panel's threads
  // list, under a divider.
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
  // turn is keyed by its first segment, so Ally-card links stay stable.
  const turns = useMemo(() => groupTurns(merged), [merged]);

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

  // Perform the queued search-result jump once turns have rendered (their
  // refs land in bubbleEls via registerEl — double rAF gives the DOM a
  // paint cycle after the segments this component was just mounted with).
  useEffect(() => {
    if (!jumpRequest) return;
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        const el = bubbleEls.current.get(jumpRequest.key);
        if (el && convo.ref.current) centerInScroller(convo.ref.current, el);
        flashToken.current += 1;
        setFlash({ key: jumpRequest.key, token: flashToken.current });
      });
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
    // Intentionally mount-only — jumpRequest is a one-shot consumed value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Below ~640px the meta panel folds into an overlay drawer, opened by the
  // "✦ Ally N" chip in the header (same threshold/pattern the old Ally
  // answer-column used).
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

  // sourceKey → ALL cards derived from it, oldest-first (cards itself is
  // newest-first — reverse while grouping). Drives both the turn's thread
  // count/pill and where each inline card renders in the stream.
  const cardsBySource = useMemo(() => {
    const m = new Map<string, AllyCard[]>();
    for (let i = cards.length - 1; i >= 0; i--) {
      const c = cards[i]!;
      if (!c.sourceKey) continue;
      const arr = m.get(c.sourceKey) ?? [];
      arr.push(c);
      m.set(c.sourceKey, arr);
    }
    return m;
  }, [cards]);

  // TrackerRail (FANER Engine — merged from main, #49): the old spine/
  // split-drag layout it was written against is gone here (V4.0 rebuild
  // retired it — transcript | Ally meta panel is the whole column set now),
  // so the width gate is re-derived from `drawer`'s own breakpoint (640px)
  // instead of the old MIN_COL/SPINE_W pair.
  const TRACKER_W = 256; // px — TrackerRail's own w-64
  // Only show the tracker rail once transcript + Ally can hold their floors
  // (the existing drawer breakpoint) AND still leave room for a third
  // 256px column — otherwise it'd squeeze the other two below comfortable
  // width.
  const showTracker = !drawer && width >= 640 + TRACKER_W;
  // Freeform "Ask Ally" cards (no turn to attach to) — appended at the end
  // of the stream, oldest-first, in the order they were asked.
  const sourcelessCards = useMemo(
    () => [...cards].filter((c) => !c.sourceKey).reverse(),
    [cards],
  );

  type StreamItem =
    | { type: "turn"; turn: (typeof turns)[number] }
    | { type: "card"; card: AllyCard };
  const streamItems = useMemo<StreamItem[]>(() => {
    const out: StreamItem[] = [];
    for (const turn of turns) {
      out.push({ type: "turn", turn });
      for (const c of cardsBySource.get(turn.key) ?? []) out.push({ type: "card", card: c });
    }
    for (const c of sourcelessCards) out.push({ type: "card", card: c });
    return out;
  }, [turns, cardsBySource, sourcelessCards]);

  const registerBubble = useCallback((key: string, el: HTMLElement | null) => {
    if (el) bubbleEls.current.set(key, el);
    else bubbleEls.current.delete(key);
  }, []);
  const registerCard = useCallback((id: string, el: HTMLElement | null) => {
    if (el) cardEls.current.set(id, el);
    else cardEls.current.delete(id);
  }, []);

  /** Open the viewer on `card`, flash + scroll to wherever it lives in the
   *  stream. Replaces the old dual-scroller `inspect()` — with cards inline,
   *  there's only one scroller to sync, and no spine positions to compute. */
  const openThread = useCallback(
    (card: AllyCard) => {
      setViewerCardId(card.id);
      flashToken.current += 1;
      setFlash({ key: card.id, token: flashToken.current });
      setCollapsed((prev) => {
        const n = new Set(prev);
        n.delete(card.id);
        if (card.sourceKey) n.delete(card.sourceKey);
        return n;
      });
      if (drawer) setDrawerOpen(true);
      convo.setPinned(false);
      requestAnimationFrame(() => {
        const el = cardEls.current.get(card.id);
        if (el && convo.ref.current) centerInScroller(convo.ref.current, el);
      });
    },
    [convo, drawer],
  );

  const jumpToLive = useCallback(() => {
    convo.setPinned(true);
    if (convo.ref.current)
      convo.ref.current.scrollTop = convo.ref.current.scrollHeight;
  }, [convo]);

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
  // Ask Ally about a FANER-marked span (F11) — phrased by the capture's
  // routed action (`fanerPrompt`) rather than the generic `researchPrompt`
  // wrapper, since FANER's prompt is already a complete question.
  const askFaner = useCallback(
    (capture: Capture, phrase: string) =>
      void request("question", fanerPrompt(capture, phrase), { key: "", quote: phrase }),
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
    const linked = cardsBySource.get(key);
    const newest = linked?.[linked.length - 1];
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
    if (newest) items.push({ label: `Open A${newest.seq}`, run: () => openThread(newest) });
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
    items.push({ label: "Open in viewer", run: () => openThread(card) });
    items.push({ sep: true });
    items.push({
      label: collapsed.has(card.id) ? "Expand" : "Collapse",
      run: () => toggleCollapse(card.id),
    });
    setMenu({ x: e.clientX, y: e.clientY, items });
  };

  // Compact mode shrinks the window to a narrow strip — skip the crown
  // (decorative context name) but keep the control bar, since Start/Stop/
  // End-&-summarise used to be reachable here via the (now-removed) global
  // TopBar and must stay reachable.
  if (compact) {
    return (
      <div className="flex h-full flex-col">
        <CompactFeed segments={merged} />
        <LiveControlBar />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <LiveTopBar />
      <main ref={containerRef} className="relative flex min-h-0 min-w-0 flex-1">
        {/* Transcript — Ally answers render inline among the turns. */}
        <section
          data-col="transcript"
          className="relative flex min-w-[240px] flex-1 flex-col border-r border-border"
        >
          <div className="flex h-11 shrink-0 items-center gap-3 border-b border-border px-5">
            <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-fg-faint">
              Conversation
            </span>
            <span className="flex items-center gap-1.5 text-[11px] font-semibold text-inbound">
              <span className="h-[7px] w-[7px] rounded-full bg-inbound" />
              Them
              {isTauri() && <Bars level={levels.inbound} color="var(--color-inbound)" />}
            </span>
            <span className="flex items-center gap-1.5 text-[11px] font-semibold text-[var(--voice-you-text)]">
              <span className="h-[7px] w-[7px] rounded-full bg-outbound" />
              You
              {isTauri() && <Bars level={levels.outbound} color="var(--color-outbound)" />}
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
          <div
            ref={convo.ref}
            onScroll={convo.onScroll}
            className={`flex flex-1 flex-col gap-2.5 overflow-y-auto px-2 py-3${barPad}`}
            role="log"
            aria-live="polite"
            aria-label="Conversation transcript"
          >
            {merged.length === 0 && cards.length === 0 ? (
              <p className="mt-8 text-center text-xs text-fg-faint">
                The conversation appears here — them on the left, you on the
                right. Tap the ✦ lightbulb on any message to ask Ally.
              </p>
            ) : (
              streamItems.map((item) => {
                if (item.type === "card") {
                  const c = item.card;
                  return (
                    <InlineAllyCard
                      key={c.id}
                      card={c}
                      registerEl={registerCard}
                      flashToken={flash?.key === c.id ? flash.token : null}
                      collapsed={collapsed.has(c.id)}
                      onToggleCollapse={() => toggleCollapse(c.id)}
                      onOpenViewer={() => openThread(c)}
                      onContextMenu={(e) => cardMenu(e, c)}
                      onRequest={(kind, question, source) =>
                        void request(kind, question, source)
                      }
                      fontPx={allyFontPx}
                    />
                  );
                }
                const turn = item.turn;
                const key = turn.key;
                const linked = cardsBySource.get(key) ?? [];
                const newest = linked[linked.length - 1];
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
                    flashToken={flash?.key === key ? flash.token : null}
                    collapsed={collapsed.has(key)}
                    onToggleCollapse={() => toggleCollapse(key)}
                    onResearch={() => research(repSeg)}
                    onAskText={askText}
                    onSendToAsk={sendToAsk}
                    onAskTerm={askTerm}
                    onContextMenu={(e) => bubbleMenu(e, repSeg)}
                    threadCount={linked.length}
                    onOpenThreads={() => newest && openThread(newest)}
                    busy={busy}
                    fontPx={transcriptFontPx}
                    sessionStartMs={sessionStartMs}
                    searchHighlight={searchHighlight}
                    captures={captures}
                    onAskFaner={askFaner}
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
              <span className="font-bold">Jump to live</span>
            </button>
          )}

          {/* Always-available Ask Ally field. */}
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

        {/* Meta panel — inline (wide) or an overlay drawer (narrow). */}
        {drawer && drawerOpen && (
          <button
            type="button"
            aria-label="Close Ally"
            onClick={() => setDrawerOpen(false)}
            className="absolute inset-0 z-20 cursor-default bg-bg/40"
          />
        )}
        <div
          className={
            drawer
              ? `absolute right-0 top-0 z-30 h-full w-[min(320px,88%)] shadow-[var(--shadow-lg)] transition-transform duration-200 ${drawerOpen ? "translate-x-0" : "translate-x-full"}`
              // Not a flex item of `main` in the drawer case (it's absolutely
              // positioned), but inline it IS one — without an explicit
              // height it shrink-wraps to content instead of filling the
              // column, which is why the dock ("tabs") wasn't pinned to the
              // bottom when there wasn't much to show above it.
              : "flex h-full"
          }
        >
          <AllyMetaPanel
            cards={cards}
            pinned={pinned}
            togglePin={togglePin}
            onOpenViewer={openThread}
            busy={busy}
            request={request}
            allyFontPx={allyFontPx}
            bumpAllyFont={bumpAllyFont}
            reasoningDefaultOpen={reasoningDefaultOpen}
            setReasoningDefaultOpen={setReasoningDefaultOpen}
            clearAlly={clearAlly}
            barPad={barPad}
          />
        </div>

        {/* Commitments & entities (FANER Engine — §6.3) — a persistent side
            rail once the tracker has produced something; collapsible to a
            thin edge tab. Hidden until the window is wide enough that it
            doesn't squeeze the transcript/Ally columns below comfortable
            width (see `showTracker` above). */}
        {showTracker && <TrackerRail />}

        <ThreadViewer
          card={cards.find((c) => c.id === viewerCardId) ?? null}
          onClose={() => setViewerCardId(null)}
          onRequest={(kind, question, source) =>
            void request(kind, question, source)
          }
        />

        {menu && <ContextMenu menu={menu} onClose={() => setMenu(null)} />}
      </main>
      <LiveControlBar />
    </div>
  );
}

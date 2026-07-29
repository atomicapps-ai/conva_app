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
import { analyzeTerms } from "@/lib/commands";
import type { TranscriptSegment } from "@/lib/ipc";
import { isTauri } from "@/lib/ipc";
import { useAppStore } from "@/state/app";
import { useAllyStore, type AllyCard } from "@/state/ally";
import { useTranscriptStore } from "@/state/transcript";

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
  return `Research this statement from the conversation. Give concise, immediately useful context — key facts, definitions, and anything I should know or verify: "${text}"`;
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

/** Term actions — icons only; the tooltip names the action (owner request). */
const TERM_ACTIONS: { action: TermAction; icon: IconName; tip: string }[] = [
  { action: "definition", icon: "book", tip: "Definition" },
  { action: "howto", icon: "howto", tip: "How-to" },
  { action: "elaborate", icon: "elaborate", tip: "Elaborate" },
];
type TermAction = "definition" | "howto" | "elaborate";

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** A small icon popover anchored to a highlighted word: definition / how-to /
 *  elaborate. Closes on outside click, scroll, or resize. */
function TermMenu({
  term,
  x,
  y,
  onPick,
  onClose,
}: {
  term: string;
  x: number;
  y: number;
  onPick: (action: TermAction) => void;
  onClose: () => void;
}) {
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
      style={{ position: "fixed", left: x, top: y + 4, zIndex: 60 }}
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
          onClick={() => onPick(a.action)}
          className="rounded p-1.5 text-fg-faint transition-colors hover:bg-ai/10 hover:text-ai"
        >
          <Icon name={a.icon} size={16} />
        </button>
      ))}
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
          setMenu({ term: word, x: r.left, y: r.bottom });
        }}
        className="rounded-[3px] bg-ai/15 px-0.5 font-semibold text-ai decoration-ai/40 decoration-dotted underline-offset-2 hover:bg-ai/25 hover:underline"
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

/** A caret that toggles a bubble/card between collapsed and expanded. */
function Caret({
  collapsed,
  onToggle,
  label,
}: {
  collapsed: boolean;
  onToggle: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={!collapsed}
      aria-label={`${collapsed ? "Expand" : "Collapse"} ${label}`}
      title={collapsed ? "Expand" : "Collapse"}
      className="shrink-0 rounded text-fg-faint transition-colors hover:text-fg"
    >
      <Icon
        name="chevron"
        size={14}
        className={`transition-transform ${collapsed ? "-rotate-90" : ""}`}
      />
    </button>
  );
}

/** One transcript turn: them = cyan left, you = violet right, with a 4px corner
 *  on the speaker's side, a label row, collapse, and an action row on finals. */
function Bubble({
  segment,
  registerEl,
  highlighted,
  collapsed,
  onToggleCollapse,
  onResearch,
  onAskTerm,
  onContextMenu,
  linkedSeq,
  onJumpLink,
  busy,
}: {
  segment: TranscriptSegment;
  registerEl: (key: string, el: HTMLElement | null) => void;
  highlighted: boolean;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onResearch: () => void;
  onAskTerm: (action: TermAction, term: string) => void;
  onContextMenu: (e: React.MouseEvent) => void;
  linkedSeq: number | null;
  onJumpLink: () => void;
  busy: boolean;
}) {
  const inbound = segment.side === "inbound";
  const key = segmentKey(segment);
  const final = segment.is_final;

  // RAG-grounded highlight terms for this finalized message (best-effort).
  const [terms, setTerms] = useState<string[]>([]);
  useEffect(() => {
    if (!final || !segment.text || !isTauri()) return;
    let alive = true;
    void analyzeTerms(segment.text)
      .then((t) => alive && setTerms(t))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [final, segment.text]);

  return (
    <div
      ref={(el) => registerEl(key, el)}
      onContextMenu={onContextMenu}
      className={`flex max-w-[92%] items-start gap-2 ${inbound ? "self-start" : "self-end"}`}
    >
      {/* Timestamp on the left — replaces the label row above to save height. */}
      <span className="mt-2.5 shrink-0 font-mono text-[10px] leading-none text-fg-faint">
        {final ? formatMs(segment.start_ms) : "now"}
      </span>
      <div
        className={[
          "min-w-0 border px-4 py-2.5 text-sm leading-relaxed transition-shadow",
          inbound
            ? "rounded-2xl rounded-bl-[4px] border-inbound/28 bg-inbound/[0.09]"
            : "rounded-2xl rounded-br-[4px] border-outbound/30 bg-outbound/10",
          !final ? "border-dashed text-fg-muted" : "",
          highlighted ? "ring-2 ring-ai/60" : "",
        ].join(" ")}
      >
        <div className="flex items-center gap-2">
          <span className={collapsed ? "line-clamp-1 flex-1" : "flex-1"}>
            {final && !collapsed && segment.text ? (
              <HighlightedText
                text={segment.text}
                terms={terms}
                onAsk={onAskTerm}
              />
            ) : (
              segment.text || (!final ? "…" : "")
            )}
          </span>
          {final && (
            <div className="flex shrink-0 items-center gap-0.5 self-center">
              {/* Ask Ally — the lightbulb initiates the AI response for this turn
                  (replaces the old "Research with Ally" pill). */}
              <button
                type="button"
                disabled={busy}
                onClick={onResearch}
                title="Ask Ally"
                aria-label="Ask Ally about this message"
                className="rounded p-1 text-ai/70 transition-colors hover:bg-ai/10 hover:text-ai disabled:opacity-40"
              >
                <Icon name="lightbulb" size={16} />
              </button>
              {/* Jump to the linked Ally card, if any (icon + number, no label). */}
              {linkedSeq !== null && (
                <button
                  type="button"
                  onClick={onJumpLink}
                  title={`Jump to Ally card A${linkedSeq}`}
                  aria-label={`Jump to Ally card ${linkedSeq}`}
                  className="flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] font-bold text-ai transition-colors hover:bg-ai/10"
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-ai" />
                  A{linkedSeq}
                </button>
              )}
              <Caret
                collapsed={collapsed}
                onToggle={onToggleCollapse}
                label={inbound ? "received message" : "sent message"}
              />
            </div>
          )}
        </div>
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
  onToggleCollapse,
  onHover,
  onInspect,
  onContextMenu,
}: {
  card: AllyCard;
  registerEl: (id: string, el: HTMLElement | null) => void;
  highlighted: boolean;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onHover: (a: Active | null) => void;
  onInspect: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  const label = cardLabel(card);
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
        "min-h-[40px] overflow-hidden rounded-2xl border transition-shadow",
        suggest ? "border-ai/34 bg-ai/[0.08]" : "border-border bg-panel",
        highlighted ? "ring-2 ring-ai/40" : "",
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
        <div className="ml-auto flex shrink-0 items-center gap-2.5">
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
        <div className="flex flex-col gap-2.5 px-4 py-3">
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
          ) : (
            <p className="whitespace-pre-wrap text-sm leading-relaxed">
              {card.text || "…"}
            </p>
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
 */
export function TranscriptView() {
  const liveSegments = useTranscriptStore((s) => s.segments);
  const archived = useTranscriptStore((s) => s.archived);
  const compact = useAppStore((s) => s.compact);
  const cards = useAllyStore((s) => s.cards);
  const busy = useAllyStore((s) => s.busy);
  const request = useAllyStore((s) => s.request);

  const containerRef = useRef<HTMLDivElement>(null);
  const spineColRef = useRef<HTMLDivElement>(null);
  const bubbleEls = useRef(new Map<string, HTMLElement>());
  const cardEls = useRef(new Map<string, HTMLElement>());

  const [hover, setHover] = useState<Active | null>(null);
  const [inspected, setInspected] = useState<Active | null>(null);
  const active = inspected ?? hover;

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

  const submitAsk = () => {
    const q = ask.trim();
    if (!q) return;
    setAsk("");
    void request("question", q);
  };

  const allKeys = [...merged.map(segmentKey), ...cards.map((c) => c.id)];
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
  const connector =
    active && activeNode && base
      ? (() => {
          let d = "";
          if (activeBubbleEl) {
            const b = activeBubbleEl.getBoundingClientRect();
            const bx = b.right - base.left;
            const by = b.top + b.height / 2 - base.top;
            const mid = (bx + spineX) / 2;
            d += `M ${bx} ${by} C ${mid} ${by}, ${mid} ${activeNode.y}, ${spineX} ${activeNode.y} `;
          }
          if (activeCardEl) {
            const c = activeCardEl.getBoundingClientRect();
            const cx = c.left - base.left;
            const cy = c.top + c.height / 2 - base.top;
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
          onScroll={() => {
            convo.onScroll();
            bump();
          }}
          className="flex flex-1 flex-col gap-3.5 overflow-y-auto px-5 py-5"
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
            merged.map((seg) => {
              const key = segmentKey(seg);
              const link = linkBySource.get(key);
              return (
                <Bubble
                  key={key}
                  segment={seg}
                  registerEl={registerBubble}
                  highlighted={active?.sourceKey === key}
                  collapsed={collapsed.has(key)}
                  onToggleCollapse={() => toggleCollapse(key)}
                  onResearch={() => research(seg)}
                  onAskTerm={askTerm}
                  onContextMenu={(e) => bubbleMenu(e, seg)}
                  linkedSeq={link ? link.seq : null}
                  onJumpLink={() => link && inspect(link.id, key)}
                  busy={busy}
                />
              );
            })
          )}
        </div>
        {!convo.pinned && (
          <button
            type="button"
            onClick={jumpToLive}
            className="glass-raised absolute bottom-5 left-1/2 flex -translate-x-1/2 items-center gap-2.5 rounded-full px-4 py-1.5 text-[12px]"
          >
            <span className="h-[7px] w-[7px] rounded-full bg-rec" />
            <span className="font-bold">{newCount > 0 ? `${newCount} new` : "Live"}</span>
            <span className="h-3.5 w-px bg-border-strong" />
            <span className="font-semibold text-inbound">Jump to live</span>
          </button>
        )}
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
        <div className="flex h-11 shrink-0 items-center gap-3 border-b border-border px-5">
          <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-ai">
            Ally
          </span>
          <div className="ml-auto flex items-center gap-0.5 text-fg-faint">
            <button
              type="button"
              onClick={expandAll}
              title="Expand all"
              aria-label="Expand all Ally cards"
              className="rounded p-1 hover:text-fg"
            >
              <Icon name="unfoldMore" size={16} />
            </button>
            <button
              type="button"
              onClick={collapseAll}
              title="Collapse all"
              aria-label="Collapse all Ally cards"
              className="rounded p-1 hover:text-fg"
            >
              <Icon name="unfoldLess" size={16} />
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
        </div>
        <div
          ref={allyCol.ref}
          onScroll={() => {
            allyCol.onScroll();
            bump();
          }}
          className="flex flex-1 flex-col gap-3.5 overflow-y-auto px-4 py-5"
          aria-label="Ally output"
        >
          {cards.length === 0 ? (
            <p className="mt-8 text-center text-xs text-fg-faint">
              Ally's answers land here — tap the lightbulb on any message, or
              ask below.
            </p>
          ) : (
            cards.map((card) => (
              <AllyCardView
                key={card.id}
                card={card}
                registerEl={registerCard}
                highlighted={active?.cardId === card.id}
                collapsed={collapsed.has(card.id)}
                onToggleCollapse={() => toggleCollapse(card.id)}
                onHover={setHover}
                onInspect={() => inspect(card.id, card.sourceKey)}
                onContextMenu={(e) => cardMenu(e, card)}
              />
            ))
          )}
        </div>
        <div className="flex shrink-0 flex-col gap-2 border-t border-border px-3 py-2.5">
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void request("suggest_reply")}
              className="flex h-7 items-center rounded-md border border-ai/40 px-2.5 text-[12px] font-semibold text-ai hover:bg-ai/10 disabled:opacity-40"
            >
              Suggest reply
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void request("summarize")}
              className="flex h-7 items-center rounded-md border border-border px-2.5 text-[12px] font-semibold text-fg-muted hover:text-fg disabled:opacity-40"
            >
              Summarize
            </button>
          </div>
          {/* Always-available, prominent Ask Ally field. */}
          <label className="flex h-11 items-center gap-2.5 rounded-xl border border-ai/30 bg-white/[0.04] px-3.5 transition-colors focus-within:border-ai/60">
            <Icon name="lightbulb" size={17} className="shrink-0 text-ai/70" />
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
              className="shrink-0 rounded-lg p-1.5 text-ai transition-colors hover:bg-ai/10 disabled:opacity-30"
            >
              <Icon name="chevron" size={16} className="rotate-90" />
            </button>
          </label>
        </div>
      </section>

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

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { Icon } from "@/components/ui/Icon";
import type { TranscriptSegment } from "@/lib/ipc";
import { useAppStore } from "@/state/app";
import { useAllyStore, type AllyCard } from "@/state/ally";
import { useTranscriptStore } from "@/state/transcript";

/** Stable identity for a transcript bubble (also the Ally-card link key). */
function segmentKey(seg: TranscriptSegment): string {
  return `${seg.side}-${seg.seq}`;
}

/** The stream a `sourceKey` points at ("inbound-3" → "inbound"). */
function sideOfKey(key: string | null): "inbound" | "outbound" | null {
  if (key?.startsWith("inbound")) return "inbound";
  if (key?.startsWith("outbound")) return "outbound";
  return null;
}

function formatMs(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

function researchPrompt(text: string): string {
  return `Research this statement from the conversation. Give concise, immediately useful context — key facts, definitions, and anything I should know or verify: "${text}"`;
}

/** The relationship a spine dot represents. */
interface Link {
  cardId: string;
  sourceKey: string | null;
}

/** Which link is currently emphasized (clicked = inspected, else hovered). */
interface Active {
  cardId: string;
  sourceKey: string | null;
}

/** A small caret that toggles a bubble/card between collapsed and expanded. */
function CollapseToggle({
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

/** One SMS-style bubble: them left, you right. Final bubbles carry the ✦
 *  research action + a collapse caret. Collapsed → single-line preview. */
function Bubble({
  segment,
  registerEl,
  highlighted,
  collapsed,
  onToggleCollapse,
  onResearch,
  busy,
}: {
  segment: TranscriptSegment;
  registerEl: (key: string, el: HTMLElement | null) => void;
  highlighted: boolean;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onResearch: (segment: TranscriptSegment) => void;
  busy: boolean;
}) {
  const inbound = segment.side === "inbound";
  const key = segmentKey(segment);
  return (
    <div
      className={`group flex w-full items-end gap-1.5 ${inbound ? "justify-start" : "justify-end"}`}
    >
      {!inbound && segment.is_final && (
        <ResearchButton
          onClick={() => onResearch(segment)}
          busy={busy}
          side="outbound"
        />
      )}
      <div
        ref={(el) => registerEl(key, el)}
        className={[
          "max-w-[78%] rounded-2xl border px-3 py-2 text-sm leading-relaxed",
          segment.is_final ? "segment-final" : "segment-partial border-dashed",
          inbound
            ? "rounded-bl-sm border-inbound/30 bg-inbound/10"
            : "rounded-br-sm border-outbound/30 bg-outbound/10",
          highlighted ? "ring-2 ring-ai/70" : "",
        ].join(" ")}
      >
        <div className="flex items-start gap-2">
          <span className={collapsed ? "line-clamp-1 flex-1" : "flex-1"}>
            {segment.text}
          </span>
          {segment.is_final && (
            <CollapseToggle
              collapsed={collapsed}
              onToggle={onToggleCollapse}
              label={inbound ? "received message" : "sent message"}
            />
          )}
        </div>
        <div className="mt-1 flex items-center gap-2 font-mono text-[10px] text-fg-faint">
          <span>{inbound ? "Them" : "You"}</span>
          <span>{formatMs(segment.start_ms)}</span>
        </div>
      </div>
      {inbound && segment.is_final && (
        <ResearchButton
          onClick={() => onResearch(segment)}
          busy={busy}
          side="inbound"
        />
      )}
    </div>
  );
}

function ResearchButton({
  onClick,
  busy,
  side,
}: {
  onClick: () => void;
  busy: boolean;
  side: "inbound" | "outbound";
}) {
  return (
    <button
      type="button"
      disabled={busy}
      onClick={onClick}
      title="Research with Ally"
      aria-label={`Research this ${side === "inbound" ? "received" : "sent"} message with Ally`}
      className="mb-1 shrink-0 rounded-full border border-ai/40 px-1.5 py-0.5 text-[11px] text-ai opacity-0 transition-opacity hover:bg-ai/10 focus:opacity-100 group-hover:opacity-100 disabled:opacity-30"
    >
      ✦
    </button>
  );
}

const COLLAPSE_CHARS = 380;

function cardLabel(card: AllyCard): string {
  if (card.kind === "suggest_reply") return "Suggested reply";
  if (card.kind === "summarize") return "Summary";
  return card.sourceQuote ? "Research" : (card.question ?? "Question");
}

/** Ally answer card. Collapsed → just the label + one-line preview. Expanded →
 *  full text (very long answers still get an inner Show more). Hover/inspect
 *  ties it to its source bubble via the spine. */
function AllyCardView({
  card,
  registerEl,
  highlighted,
  collapsed,
  onToggleCollapse,
  onHover,
}: {
  card: AllyCard;
  registerEl: (id: string, el: HTMLElement | null) => void;
  highlighted: boolean;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onHover: (active: Active | null) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const label = cardLabel(card);
  const long = card.text.length > COLLAPSE_CHARS;
  const shown =
    long && !expanded ? `${card.text.slice(0, COLLAPSE_CHARS)}…` : card.text;

  return (
    <div
      ref={(el) => registerEl(card.id, el)}
      onMouseEnter={() => onHover({ cardId: card.id, sourceKey: card.sourceKey })}
      onMouseLeave={() => onHover(null)}
      className={[
        "rounded-md border bg-ai/5 px-3 py-2 transition-shadow",
        highlighted ? "border-ai/70 ring-2 ring-ai/40" : "border-ai/25",
      ].join(" ")}
    >
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-ai">
          {label}
        </span>
        {!card.done && (
          <span className="text-[11px] text-fg-faint" role="status">
            thinking…
          </span>
        )}
        <button
          type="button"
          onClick={() => void navigator.clipboard.writeText(card.text)}
          className="ml-auto text-[11px] text-fg-faint hover:text-fg"
        >
          Copy
        </button>
        <CollapseToggle
          collapsed={collapsed}
          onToggle={onToggleCollapse}
          label={`${label} answer`}
        />
      </div>

      {collapsed ? (
        <p className="mt-1 line-clamp-1 text-xs text-fg-muted">
          {card.error ?? card.text ?? "…"}
        </p>
      ) : (
        <>
          {card.sourceQuote && (
            <p className="mb-1 mt-1 border-l-2 border-ai/40 pl-2 text-[11px] italic text-fg-muted">
              “
              {card.sourceQuote.length > 100
                ? `${card.sourceQuote.slice(0, 100)}…`
                : card.sourceQuote}
              ”
            </p>
          )}
          {card.error ? (
            <p className="mt-1 text-xs text-rec">{card.error}</p>
          ) : (
            <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed">
              {shown || "…"}
            </p>
          )}
          {long && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="mt-1 text-[11px] font-semibold text-ai hover:underline"
            >
              {expanded ? "Show less" : "Show more"}
            </button>
          )}
          {card.sources.length > 0 && (
            <p className="mt-1.5 text-[11px] text-fg-faint">
              sources:{" "}
              {[
                ...new Set(
                  card.sources.map((s) => `${s.file_name} · ${s.location}`),
                ),
              ]
                .slice(0, 3)
                .join("  ·  ")}
            </p>
          )}
        </>
      )}
    </div>
  );
}

/**
 * The relationship spine — the center panel. One clickable dot per Ally entry,
 * stacked in order down a hairline rail; the dot echoes the source bubble's
 * side color (cyan/violet) or reads gold when the entry is derived from the
 * whole conversation. Hovering a dot reveals a connector line to its source
 * bubble; clicking brings the pair into context. The newest dot pings while
 * the user is away inspecting an earlier moment.
 */
function Spine({
  cards,
  registerDot,
  active,
  onHover,
  onInspect,
  pingNewest,
}: {
  cards: AllyCard[];
  registerDot: (id: string, el: HTMLElement | null) => void;
  active: Active | null;
  onHover: (active: Active | null) => void;
  onInspect: (link: Link) => void;
  pingNewest: boolean;
}) {
  return (
    <div className="relative flex w-9 shrink-0 flex-col items-center">
      {/* the rail */}
      <div
        className="absolute bottom-2 top-9 w-px bg-border"
        aria-hidden
      />
      <div className="mt-9 flex flex-col items-center gap-3 pt-1">
        {cards.map((card, i) => {
          const side = sideOfKey(card.sourceKey);
          const isActive = active?.cardId === card.id;
          const dotColor =
            side === "inbound"
              ? "bg-inbound border-inbound"
              : side === "outbound"
                ? "bg-outbound border-outbound"
                : "bg-transparent border-ai";
          return (
            <button
              key={card.id}
              type="button"
              ref={(el) => registerDot(card.id, el)}
              onMouseEnter={() =>
                onHover({ cardId: card.id, sourceKey: card.sourceKey })
              }
              onMouseLeave={() => onHover(null)}
              onClick={() =>
                onInspect({ cardId: card.id, sourceKey: card.sourceKey })
              }
              aria-label={
                card.sourceKey
                  ? "Show the message this Ally entry came from"
                  : "Show this Ally entry"
              }
              className="relative grid h-6 w-6 place-items-center rounded-full"
            >
              <span
                className={[
                  "h-2.5 w-2.5 rounded-full border transition-transform",
                  dotColor,
                  isActive ? "scale-150" : "",
                  pingNewest && i === 0 && !isActive ? "spine-ping" : "",
                ].join(" ")}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Connector lines drawn on hover/inspect: source bubble → spine dot → card.
 *  Only the active link is drawn, and only while its bubble is on-screen. */
function Connector({
  container,
  active,
  bubbleEls,
  dotEls,
  cardEls,
  tick,
}: {
  container: HTMLElement | null;
  active: Active | null;
  bubbleEls: Map<string, HTMLElement>;
  dotEls: Map<string, HTMLElement>;
  cardEls: Map<string, HTMLElement>;
  tick: number;
}) {
  const [path, setPath] = useState<string | null>(null);

  useLayoutEffect(() => {
    if (!container || !active) {
      setPath(null);
      return;
    }
    const base = container.getBoundingClientRect();
    const dot = dotEls.get(active.cardId);
    if (!dot) {
      setPath(null);
      return;
    }
    const d = dot.getBoundingClientRect();
    const dx = d.left + d.width / 2 - base.left;
    const dy = d.top + d.height / 2 - base.top;

    let dPath = "";
    // Left leg: dot → source bubble (only if the bubble is on-screen).
    const bubble = active.sourceKey ? bubbleEls.get(active.sourceKey) : null;
    if (bubble) {
      const b = bubble.getBoundingClientRect();
      const by = b.top + b.height / 2 - base.top;
      // Skip if the bubble scrolled out of the visible area.
      if (b.bottom > base.top && b.top < base.bottom) {
        const bx = b.right - base.left;
        const mid = (bx + dx) / 2;
        dPath += `M ${bx} ${by} C ${mid} ${by}, ${mid} ${dy}, ${dx} ${dy} `;
      }
    }
    // Right leg: dot → card.
    const card = cardEls.get(active.cardId);
    if (card) {
      const c = card.getBoundingClientRect();
      const cx = c.left - base.left;
      const cy = c.top + c.height / 2 - base.top;
      const mid = (dx + cx) / 2;
      dPath += `M ${dx} ${dy} C ${mid} ${dy}, ${mid} ${cy}, ${cx} ${cy}`;
    }
    setPath(dPath || null);
  }, [container, active, bubbleEls, dotEls, cardEls, tick]);

  if (!path) return null;
  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden>
      <path d={path} fill="none" className="stroke-ai" strokeWidth={1.75} />
    </svg>
  );
}

function useAutoScroll(dep: unknown) {
  const ref = useRef<HTMLDivElement>(null);
  const [pinned, setPinned] = useState(true);
  useEffect(() => {
    if (pinned && ref.current) {
      ref.current.scrollTop = ref.current.scrollHeight;
    }
  }, [pinned, dep]);
  const onScroll = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setPinned(el.scrollHeight - el.scrollTop - el.clientHeight < 48);
  }, []);
  return { ref, pinned, setPinned, onScroll };
}

/** Smoothly bring an element to the vertical center of its scroll container. */
function centerInScroller(scroller: HTMLElement, el: HTMLElement) {
  const s = scroller.getBoundingClientRect();
  const e = el.getBoundingClientRect();
  const delta = e.top - s.top - (scroller.clientHeight / 2 - e.height / 2);
  scroller.scrollTo({ top: scroller.scrollTop + delta, behavior: "smooth" });
}

/** Compact fallback: single merged feed that fits a 380 px strip (no spine). */
function CompactFeed({ segments }: { segments: TranscriptSegment[] }) {
  const merged = [...segments].sort((a, b) => a.start_ms - b.start_ms);
  const { ref, pinned, setPinned, onScroll } = useAutoScroll(
    merged[merged.length - 1],
  );
  const noop = useCallback(() => {}, []);
  const request = useAllyStore((s) => s.request);
  const busy = useAllyStore((s) => s.busy);
  return (
    <main className="relative flex min-h-0 flex-1 flex-col">
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
          merged.map((seg) => (
            <Bubble
              key={segmentKey(seg)}
              segment={seg}
              registerEl={noop}
              highlighted={false}
              collapsed={false}
              onToggleCollapse={noop}
              busy={busy}
              onResearch={(s) =>
                void request("question", researchPrompt(s.text), {
                  key: segmentKey(s),
                  quote: s.text,
                })
              }
            />
          ))
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
 * Conversation workspace: left — the live conversation as SMS-style bubbles;
 * center — the relationship spine (a dot per Ally entry, click to bring its
 * source into context); right — the Ally output column. Every bubble and card
 * collapses; the header carries expand-all / collapse-all. Clicking a spine dot
 * enters "inspect": both columns un-pin, the pair centers, live content keeps
 * arriving below without yanking the view, and a "N new" pill offers the way
 * back to the live edge. Compact mode (U9) keeps the single merged feed.
 */
export function TranscriptView() {
  const liveSegments = useTranscriptStore((s) => s.segments);
  const archived = useTranscriptStore((s) => s.archived);
  const compact = useAppStore((s) => s.compact);
  const cards = useAllyStore((s) => s.cards);
  const busy = useAllyStore((s) => s.busy);
  const request = useAllyStore((s) => s.request);

  const containerRef = useRef<HTMLDivElement>(null);
  const bubbleEls = useRef(new Map<string, HTMLElement>());
  const cardEls = useRef(new Map<string, HTMLElement>());
  const dotEls = useRef(new Map<string, HTMLElement>());

  // Hover previews a link; a click "inspects" (sticky) it. Inspected wins.
  const [hover, setHover] = useState<Active | null>(null);
  const [inspected, setInspected] = useState<Active | null>(null);
  const active = inspected ?? hover;

  // Collapsed bubble keys + card ids (they never collide).
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const isCollapsed = useCallback((k: string) => collapsed.has(k), [collapsed]);
  const toggleCollapse = useCallback((k: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  }, []);

  // Bumped on scroll/resize/content/collapse so connector geometry follows.
  const [tick, setTick] = useState(0);
  const bump = useCallback(() => setTick((t) => t + 1), []);

  const merged = [
    ...archived,
    ...[...liveSegments].sort((a, b) => a.start_ms - b.start_ms),
  ];
  const convo = useAutoScroll(merged[merged.length - 1]);
  const allyCol = useAutoScroll(cards[0]?.id);

  useEffect(() => {
    window.addEventListener("resize", bump);
    return () => window.removeEventListener("resize", bump);
  }, [bump]);

  // "N new" tracking for the conversation column: freeze a baseline whenever
  // we're pinned to the live edge; the delta while un-pinned is what's new.
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
  const registerDot = useCallback((id: string, el: HTMLElement | null) => {
    if (el) dotEls.current.set(id, el);
    else dotEls.current.delete(id);
  }, []);

  // Bring a link's pair into context: un-pin both columns and center each.
  const inspect = useCallback(
    (link: Link) => {
      setInspected({ cardId: link.cardId, sourceKey: link.sourceKey });
      convo.setPinned(false);
      allyCol.setPinned(false);
      requestAnimationFrame(() => {
        const cardEl = cardEls.current.get(link.cardId);
        if (cardEl && allyCol.ref.current)
          centerInScroller(allyCol.ref.current, cardEl);
        if (link.sourceKey) {
          const b = bubbleEls.current.get(link.sourceKey);
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
    if (allyCol.ref.current)
      allyCol.ref.current.scrollTop = allyCol.ref.current.scrollHeight;
  }, [convo, allyCol]);

  const research = useCallback(
    (seg: TranscriptSegment) =>
      void request("question", researchPrompt(seg.text), {
        key: segmentKey(seg),
        quote: seg.text,
      }),
    [request],
  );

  const allKeys = [...merged.map(segmentKey), ...cards.map((c) => c.id)];
  const collapseAll = () => setCollapsed(new Set(allKeys));
  const expandAll = () => setCollapsed(new Set());

  if (compact) {
    return <CompactFeed segments={merged} />;
  }

  return (
    <main ref={containerRef} className="relative flex min-h-0 min-w-0 flex-1">
      {/* Conversation — left */}
      <section className="relative flex min-w-0 flex-[3] flex-col">
        <div className="flex shrink-0 items-center gap-2 px-4 py-2">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-fg-muted">
            Conversation
          </h2>
          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              onClick={expandAll}
              title="Expand all"
              aria-label="Expand all messages"
              className="rounded p-1 text-fg-faint hover:text-fg"
            >
              <Icon name="unfoldMore" size={16} />
            </button>
            <button
              type="button"
              onClick={collapseAll}
              title="Collapse all"
              aria-label="Collapse all messages"
              className="rounded p-1 text-fg-faint hover:text-fg"
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
          className="flex flex-1 flex-col gap-2 overflow-y-auto px-4 pb-4"
          role="log"
          aria-live="polite"
          aria-label="Conversation transcript"
        >
          {merged.length === 0 ? (
            <p className="mt-8 text-center text-xs text-fg-faint">
              The conversation appears here — them on the left, you on the
              right. Hover a message and press ✦ to have Ally research it.
            </p>
          ) : (
            merged.map((seg) => {
              const key = segmentKey(seg);
              return (
                <Bubble
                  key={key}
                  segment={seg}
                  registerEl={registerBubble}
                  highlighted={active?.sourceKey === key}
                  collapsed={isCollapsed(key)}
                  onToggleCollapse={() => toggleCollapse(key)}
                  onResearch={research}
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
            className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full border border-border bg-panel px-3 py-1 text-[11px] text-fg-muted shadow hover:text-fg"
          >
            {newCount > 0 ? `↓ ${newCount} new` : "↓ Jump to live"}
          </button>
        )}
      </section>

      {/* Relationship spine — center */}
      <Spine
        cards={cards}
        registerDot={registerDot}
        active={active}
        onHover={setHover}
        onInspect={inspect}
        pingNewest={!allyCol.pinned}
      />

      {/* Ally output — right */}
      <section className="flex min-w-0 flex-[2] flex-col">
        <h2 className="shrink-0 px-4 py-2 text-xs font-semibold uppercase tracking-widest text-ai">
          ✦ ALLY
        </h2>
        <div
          ref={allyCol.ref}
          onScroll={() => {
            allyCol.onScroll();
            bump();
          }}
          className="flex flex-1 flex-col gap-2 overflow-y-auto px-4 pb-4"
          aria-label="Ally output"
        >
          {cards.length === 0 ? (
            <p className="mt-8 text-center text-xs text-fg-faint">
              Ally output lands here — press ✦ on any message, or use Suggest
              reply / Summarize below.
            </p>
          ) : (
            cards.map((card) => (
              <AllyCardView
                key={card.id}
                card={card}
                registerEl={registerCard}
                highlighted={active?.cardId === card.id}
                collapsed={isCollapsed(card.id)}
                onToggleCollapse={() => toggleCollapse(card.id)}
                onHover={setHover}
              />
            ))
          )}
        </div>
      </section>

      <Connector
        container={containerRef.current}
        active={active}
        bubbleEls={bubbleEls.current}
        dotEls={dotEls.current}
        cardEls={cardEls.current}
        tick={tick + cards.length + merged.length}
      />
    </main>
  );
}

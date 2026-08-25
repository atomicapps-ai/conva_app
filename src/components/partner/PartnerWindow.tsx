import { useCallback, useEffect, useState } from "react";

import { derivePartnerAnswer } from "@/components/partner/deriveAnswer";
import {
  addOrFocus,
  closeTab,
  itemTab,
  tabLabel,
  type PartnerTab,
} from "@/components/partner/partnerTabs";
import { Icon } from "@/components/ui/Icon";
import { useBackend } from "@/lib/backend";
import { useIpcBridge } from "@/lib/useIpcBridge";
import { useAllyStore } from "@/state/ally";
import { ALLY_FONT_MAX, ALLY_FONT_MIN, useUiPrefs } from "@/state/uiPrefs";

/**
 * The partner window's whole view (`?partner=1` — see `src/main.tsx` and
 * `src-tauri/src/partner.rs`). THE viewer (owner, 2026-08-22): a real OS
 * window, docked to the app's right edge by default, not an internal
 * drawer — every "open in viewer" affordance in the main window routes
 * here. Every delivery becomes a TAB (spec §4.1) — opening a second item
 * keeps the first; re-opening an item focuses its existing tab. Each tab's
 * research/follow-ups are tagged `partner::<tabKey>` via the ally request's
 * `source` param, so per-tab content is a filter over this window's own
 * ally store (each webview has its own store instance; `conva://*` events
 * are emitted app-wide).
 */
export function PartnerWindow() {
  useIpcBridge();
  const backend = useBackend();
  const [tabs, setTabs] = useState<PartnerTab[]>([]);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const cards = useAllyStore((s) => s.cards);
  const busy = useAllyStore((s) => s.busy);
  const [ask, setAsk] = useState("");
  const partnerFontPx = useUiPrefs((s) => s.partnerFontPx);
  const bumpPartnerFont = useUiPrefs((s) => s.bumpPartnerFont);
  const [fontMenuOpen, setFontMenuOpen] = useState(false);

  /** Kick off the tab's research if it's a fresh term with no answer yet —
   *  on first open, and again on focus (heals a cap-evicted answer). */
  const ensureResearched = useCallback((tab: PartnerTab) => {
    if (tab.kind !== "item" || tab.payload.answer !== null) return;
    const store = useAllyStore.getState();
    const key = `partner::${tab.key}`;
    if (store.busy || store.cards.some((c) => c.sourceKey === key)) return;
    const context = tab.payload.preview
      ? ` Known so far: ${tab.payload.preview}`
      : "";
    void store.request(
      "question",
      `Research "${tab.payload.term}" in depth for this conversation: a concise definition, the standard approaches or fixes, and how it connects to my material.${context}`,
      { key, quote: tab.payload.term },
    );
  }, []);

  const openTab = useCallback(
    (tab: PartnerTab) => {
      setTabs((prev) => addOrFocus(prev, tab).tabs);
      setActiveKey(tab.key);
      ensureResearched(tab);
    },
    [ensureResearched],
  );

  // Initial payload on boot + re-targeting events while open.
  useEffect(() => {
    let alive = true;
    void backend.partner.payload().then((p) => {
      if (alive && p) openTab(itemTab(p));
    });
    let unsub: (() => void) | undefined;
    void backend
      .subscribe("partnerTerm", (p) => openTab(itemTab(p)))
      .then((un) => {
        if (alive) unsub = un;
        else un();
      });
    return () => {
      alive = false;
      unsub?.();
    };
  }, [backend, openTab]);

  const close = async () => {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().close();
  };
  const minimize = async () => {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().minimize();
  };

  const active = tabs.find((t) => t.key === activeKey) ?? null;
  // Per-tab content: the newest card tagged for this tab wins over the
  // payload's already-answered text (asking something new shows the new
  // thing — same rule as before, now per tab).
  const activeCard = active
    ? (cards.find((c) => c.sourceKey === `partner::${active.key}`) ?? null)
    : null;
  const {
    heading: answerHeading,
    text: answerText,
    error: answerError,
    sources,
  } = derivePartnerAnswer(
    active?.kind === "item" ? active.payload : null,
    activeCard,
  );

  const submitAsk = () => {
    const q = ask.trim();
    if (!q || !active) return;
    setAsk("");
    void useAllyStore
      .getState()
      .request("question", `About "${tabLabel(active)}": ${q}`, {
        key: `partner::${active.key}`,
        quote: tabLabel(active),
      });
  };

  return (
    <div className="relative flex h-screen flex-col overflow-hidden border border-border-strong bg-bg text-fg">
      {/* Title bar — the drag region. */}
      <header
        data-tauri-drag-region
        className="flex h-[34px] shrink-0 items-center gap-2 border-b border-border bg-bg-2 px-3"
      >
        <span data-tauri-drag-region className="font-bold text-ai">
          ✦
        </span>
        <span
          data-tauri-drag-region
          className="min-w-0 flex-1 truncate text-xs font-bold"
        >
          Ally{active ? ` — ${tabLabel(active)}` : ""}
        </span>
        <button
          type="button"
          onClick={() => setFontMenuOpen((o) => !o)}
          title="Text size"
          aria-label="Text size"
          aria-expanded={fontMenuOpen}
          className={`rounded px-1.5 py-0.5 text-[11px] font-bold ${fontMenuOpen ? "text-fg" : "text-fg-faint hover:text-fg"}`}
        >
          Aa
        </button>
        <button
          type="button"
          onClick={() => void backend.partner.redock()}
          title="Re-dock to the app's right side"
          aria-label="Re-dock to the app's right side"
          className="rounded px-1.5 py-0.5 text-fg-faint hover:text-fg"
        >
          ⇥
        </button>
        <button
          type="button"
          onClick={() => void minimize()}
          title="Minimize"
          aria-label="Minimize"
          className="rounded px-1.5 py-0.5 text-fg-faint hover:text-fg"
        >
          —
        </button>
        <button
          type="button"
          onClick={() => void close()}
          title="Close"
          aria-label="Close"
          className="rounded px-1.5 py-0.5 text-fg-faint hover:text-rec"
        >
          ×
        </button>
      </header>

      {fontMenuOpen && (
        <>
          <button
            type="button"
            aria-hidden
            tabIndex={-1}
            onClick={() => setFontMenuOpen(false)}
            className="fixed inset-0 z-40 cursor-default"
          />
          <div
            role="menu"
            aria-label="Text size"
            className="glass-raised absolute right-2 top-[38px] z-50 flex items-center gap-1 rounded-lg border border-border p-2 shadow-[var(--shadow-lg)]"
          >
            <button
              type="button"
              onClick={() => bumpPartnerFont(-1)}
              disabled={partnerFontPx <= ALLY_FONT_MIN}
              aria-label="Smaller text"
              className="grid h-6 w-6 place-items-center rounded border border-border text-fg-muted hover:text-fg disabled:opacity-30"
            >
              A−
            </button>
            <span className="w-10 text-center font-mono text-[11px] text-fg-faint">
              {partnerFontPx}px
            </span>
            <button
              type="button"
              onClick={() => bumpPartnerFont(1)}
              disabled={partnerFontPx >= ALLY_FONT_MAX}
              aria-label="Larger text"
              className="grid h-6 w-6 place-items-center rounded border border-border text-fg-muted hover:text-fg disabled:opacity-30"
            >
              A+
            </button>
          </div>
        </>
      )}

      {/* Tab strip — one tab per open item (spec §4.1); the sanctioned
          exclusive-tab silhouette (2px top spine + raised fill). */}
      {tabs.length > 0 && (
        <div
          role="tablist"
          aria-label="Open items"
          className="flex shrink-0 items-stretch overflow-x-auto border-b border-border bg-bg-2"
        >
          {tabs.map((t) => {
            const isActive = t.key === activeKey;
            return (
              <div
                key={t.key}
                className={[
                  "relative flex h-[30px] shrink-0 items-stretch border-r border-border",
                  isActive ? "bg-panel-raised" : "",
                ].join(" ")}
              >
                {isActive && (
                  <span
                    className="absolute inset-x-0 top-0 h-[2px] bg-primary"
                    aria-hidden
                  />
                )}
                <button
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => {
                    setActiveKey(t.key);
                    ensureResearched(t);
                  }}
                  className={[
                    "max-w-[16ch] truncate pl-2.5 pr-1 text-[11.5px]",
                    isActive
                      ? "font-bold text-primary"
                      : "font-semibold text-fg-faint hover:text-fg",
                  ].join(" ")}
                >
                  {tabLabel(t)}
                </button>
                <button
                  type="button"
                  title="Close tab"
                  aria-label={`Close "${tabLabel(t)}"`}
                  onClick={() => {
                    const r = closeTab(tabs, t.key, activeKey);
                    setTabs(r.tabs);
                    setActiveKey(r.activeKey);
                  }}
                  className="pr-2 text-fg-faint hover:text-rec"
                >
                  <Icon name="close" size={10} />
                </button>
              </div>
            );
          })}
        </div>
      )}

      <div
        data-testid="partner-body"
        style={{ fontSize: partnerFontPx }}
        className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4"
      >
        {!active ? (
          <p className="mt-8 text-center text-[0.86em] text-fg-faint">
            Open a term from the Terms tab to research it here.
          </p>
        ) : (
          <>
            <div>
              <h2 className="text-[1.3em] font-extrabold">{tabLabel(active)}</h2>
              {active.kind === "item" && active.payload.kind && (
                <p className="mt-0.5 font-mono text-[0.72em] uppercase text-fg-faint">
                  {active.payload.kind}
                </p>
              )}
            </div>

            {active.kind === "item" && active.payload.preview && (
              <div className="border border-ai/34 bg-ai/[0.06] p-3">
                <h4 className="mb-1.5 font-mono text-[0.72em] font-bold tracking-[0.14em] text-ai">
                  PREVIEW
                </h4>
                <p className="text-[0.93em] leading-relaxed">
                  {active.payload.preview}
                </p>
              </div>
            )}

            <div className="rounded-[var(--radius)] border border-border bg-bg-2 p-3">
              <h4 className="mb-1.5 font-mono text-[0.72em] font-bold tracking-[0.14em] text-fg-muted">
                {answerHeading}
              </h4>
              {answerError ? (
                <p className="text-[0.9em] text-rec">{answerError}</p>
              ) : (
                <p className="whitespace-pre-line text-[0.9em] leading-relaxed text-fg-muted">
                  {answerText || (busy ? "Researching…" : "…")}
                </p>
              )}
            </div>

            {sources.length > 0 && (
              <div className="rounded-[var(--radius)] border border-border bg-bg-2 p-3">
                <h4 className="mb-1.5 font-mono text-[0.72em] font-bold tracking-[0.14em] text-fg-muted">
                  FROM YOUR DOCUMENTS
                </h4>
                {sources.map((s) => (
                  <p key={s} className="text-[0.86em] text-fg-muted">
                    {s}
                  </p>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* Follow-up ask — tags the ACTIVE tab. */}
      <div className="shrink-0 border-t border-border px-3 py-2.5">
        <label className="flex h-9 items-center gap-2.5 rounded-[4px] border border-ai/30 bg-white/[0.04] px-3 transition-colors focus-within:border-ai/60">
          <Icon name="lightbulb" size={16} className="shrink-0 text-ai/70" />
          <input
            value={ask}
            onChange={(e) => setAsk(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submitAsk()}
            placeholder="Ask a follow-up…"
            aria-label="Ask a follow-up"
            className="min-w-0 flex-1 bg-transparent text-sm text-fg placeholder:text-fg-faint focus:outline-none"
          />
          <button
            type="button"
            onClick={submitAsk}
            disabled={busy || !ask.trim()}
            title="Ask Ally"
            aria-label="Ask Ally"
            className="shrink-0 rounded-[4px] p-1.5 text-ai transition-colors hover:bg-ai/10 disabled:opacity-30"
          >
            <Icon name="chevron" size={16} className="rotate-90" />
          </button>
        </label>
      </div>
    </div>
  );
}

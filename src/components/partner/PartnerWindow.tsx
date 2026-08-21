import { useCallback, useEffect, useRef, useState } from "react";

import { Icon } from "@/components/ui/Icon";
import { useBackend } from "@/lib/backend";
import type { PartnerPayload } from "@/lib/ipc";
import { useIpcBridge } from "@/lib/useIpcBridge";
import { useAllyStore } from "@/state/ally";

/**
 * The partner window's whole view (`?partner=1` — see `src/main.tsx` and
 * `src-tauri/src/partner.rs`). A large reading surface for one term: its
 * FANER preview (when it came from a capture) plus a full Ally answer
 * requested on arrival, streamed via this window's own ally store (the
 * `conva://*` events are emitted app-wide, so the bridge works per-window).
 * The custom title bar is the drag region; ⇥ re-docks flush to the app's
 * right edge; the window is an ordinary resizable OS window, not a HUD.
 */
export function PartnerWindow() {
  useIpcBridge();
  const backend = useBackend();
  const [payload, setPayload] = useState<PartnerPayload | null>(null);
  const cards = useAllyStore((s) => s.cards);
  const busy = useAllyStore((s) => s.busy);
  const request = useAllyStore((s) => s.request);
  const clearAlly = useAllyStore((s) => s.clear);
  const [ask, setAsk] = useState("");
  // The term we already researched — a re-delivered payload for the same term
  // (window refocus, double-click) must not re-ask.
  const askedFor = useRef<string | null>(null);

  const research = useCallback(
    (p: PartnerPayload) => {
      if (askedFor.current === p.term) return;
      askedFor.current = p.term;
      clearAlly();
      const context = p.preview ? ` Known so far: ${p.preview}` : "";
      void request(
        "question",
        `Research "${p.term}" in depth for this conversation: a concise definition, the standard approaches or fixes, and how it connects to my material.${context}`,
      );
    },
    [clearAlly, request],
  );

  // Initial payload on boot + re-targeting events while open.
  useEffect(() => {
    let alive = true;
    void backend.partner.payload().then((p) => {
      if (alive && p) {
        setPayload(p);
        research(p);
      }
    });
    let unsub: (() => void) | undefined;
    void backend.subscribe("partnerTerm", (p) => {
      setPayload(p);
      research(p);
    }).then((un) => {
      if (alive) unsub = un;
      else un();
    });
    return () => {
      alive = false;
      unsub?.();
    };
  }, [backend, research]);

  const close = async () => {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().close();
  };
  const minimize = async () => {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().minimize();
  };

  const answer = cards[0] ?? null;
  const sources = answer
    ? [...new Set(answer.sources.map((s) => `${s.file_name} · ${s.location}`))]
    : [];

  const submitAsk = () => {
    const q = ask.trim();
    if (!q || !payload) return;
    setAsk("");
    askedFor.current = `${payload.term}::${q}`;
    void request("question", `About "${payload.term}": ${q}`);
  };

  return (
    <div className="flex h-screen flex-col overflow-hidden border border-border-strong bg-bg text-fg">
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
          Ally{payload ? ` — ${payload.term}` : ""}
        </span>
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

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
        {!payload ? (
          <p className="mt-8 text-center text-xs text-fg-faint">
            Open a term from the Terms tab to research it here.
          </p>
        ) : (
          <>
            <div>
              <h2 className="text-lg font-extrabold">{payload.term}</h2>
              {payload.kind && (
                <p className="mt-0.5 font-mono text-[10px] uppercase text-fg-faint">
                  {payload.kind}
                </p>
              )}
            </div>

            {payload.preview && (
              <div className="border border-ai/34 bg-ai/[0.06] p-3">
                <h4 className="mb-1.5 font-mono text-[10px] font-bold tracking-[0.14em] text-ai">
                  PREVIEW
                </h4>
                <p className="text-[13px] leading-relaxed">{payload.preview}</p>
              </div>
            )}

            <div className="rounded-[var(--radius)] border border-border bg-bg-2 p-3">
              <h4 className="mb-1.5 font-mono text-[10px] font-bold tracking-[0.14em] text-fg-muted">
                FETCHED INFO
              </h4>
              {answer?.error ? (
                <p className="text-[12.5px] text-rec">{answer.error}</p>
              ) : (
                <p className="whitespace-pre-line text-[12.5px] leading-relaxed text-fg-muted">
                  {answer?.text || (busy ? "Researching…" : "…")}
                </p>
              )}
            </div>

            {sources.length > 0 && (
              <div className="rounded-[var(--radius)] border border-border bg-bg-2 p-3">
                <h4 className="mb-1.5 font-mono text-[10px] font-bold tracking-[0.14em] text-fg-muted">
                  FROM YOUR DOCUMENTS
                </h4>
                {sources.map((s) => (
                  <p key={s} className="text-[12px] text-fg-muted">
                    {s}
                  </p>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* Follow-up ask. */}
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

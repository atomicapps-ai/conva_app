import { useEffect, useState } from "react";

import { useBackend } from "@/lib/backend";
import { plural } from "@/lib/localData";
import { useNavStore } from "@/state/nav";

type Counts = { conversations: number | null; documents: number | null; contexts: number | null };

/**
 * Profile → "Your data on Conva" (web). What Conva holds for this account, so
 * the delete dialog is not the first time anyone sees it. In the browser the
 * only things on Conva's side are what the person chose to save to the cloud;
 * nothing else is kept in this browser beyond the sign-in. A count that cannot
 * be read shows a dash, never a made-up number.
 */
export function YourDataOnConva({ email }: { email: string | null }) {
  const backend = useBackend();
  const setView = useNavStore((s) => s.setView);
  const [counts, setCounts] = useState<Counts>({ conversations: null, documents: null, contexts: null });

  useEffect(() => {
    let live = true;
    const len = (p: Promise<unknown[]>) => p.then((r) => r.length).catch(() => null);
    void Promise.all([
      len(backend.conversations.list()),
      len(backend.rag.list()),
      len(backend.context.list()),
    ]).then(([conversations, documents, contexts]) => {
      if (live) setCounts({ conversations, documents, contexts });
    });
    return () => {
      live = false;
    };
  }, [backend]);

  const n = (v: number | null, one: string, many?: string) => (v === null ? "—" : plural(v, one, many));

  const row = (name: string, detail: string | null, value: string, action: React.ReactNode) => (
    <div className="grid grid-cols-[1fr_auto_auto] items-center gap-3.5 border-t border-border py-2.5 first:border-t-0">
      <div className="min-w-0">
        <div className="text-[13px] font-semibold text-fg">{name}</div>
        {detail && <div className="mt-0.5 text-[11.5px] text-fg-faint">{detail}</div>}
      </div>
      <div className="whitespace-nowrap text-right font-mono text-[12px] text-fg-muted">{value}</div>
      <div className="justify-self-end">{action}</div>
    </div>
  );
  const open = (label: string, view: Parameters<typeof setView>[0]) => (
    <button type="button" className="btn" onClick={() => setView(view)}>
      {label}
    </button>
  );

  return (
    <div className="flex flex-col gap-2" data-testid="your-data-on-conva">
      <p className="text-[12px] leading-relaxed text-fg-muted">
        What we hold for <b className="text-fg">{email ?? "this account"}</b>. You choose what gets saved here; nothing
        else is kept.
      </p>
      <div>
        {row("Account", "Email, name, avatar, beta access", "1", null)}
        {row("Saved conversations", null, n(counts.conversations, "conversation"), open("Open", "conversations"))}
        {row("Library documents", "Text and the original files", n(counts.documents, "document"), open("Open", "library"))}
        {row("Contexts", null, n(counts.contexts, "Context"), open("Open", "context"))}
        {row("Usage counts", "Counts and timings, no content", "today", null)}
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
        <button type="button" className="btn" disabled title="Not available yet">
          Download my data
        </button>
        <span className="rounded border border-border-strong px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-fg-muted">
          Later
        </span>
      </div>
    </div>
  );
}

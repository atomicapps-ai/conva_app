import { useCallback, useEffect, useState } from "react";

import { EraseLocalDataDialog } from "@/components/privacy/EraseLocalDataDialog";
import { useBackend } from "@/lib/backend";
import { formatBytes } from "@/lib/formatBytes";
import type { LocalDataSummary } from "@/lib/ipc";
import { describeCategory, plural } from "@/lib/localData";
import { useNavStore } from "@/state/nav";

/**
 * Settings → Privacy → Your data on this computer. Lists what the desktop app
 * keeps on this machine and how to remove it. Conva cannot see or delete any
 * of this; the section says so. Desktop only (the web build keeps nothing
 * here beyond the sign-in), so the summary read failing renders nothing.
 */
export function LocalDataSettings() {
  const backend = useBackend();
  const setView = useNavStore((s) => s.setView);
  const [summary, setSummary] = useState<LocalDataSummary | null>(null);
  const [erasing, setErasing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    void backend.localData
      .summary()
      .then(setSummary)
      .catch(() => setSummary(null));
  }, [backend]);
  useEffect(refresh, [refresh]);

  if (!summary) return null;

  const row = (
    name: string,
    detail: string | null,
    value: string,
    action: React.ReactNode,
  ) => (
    <div className="grid grid-cols-[1fr_auto_auto] items-center gap-3.5 border-t border-border py-2.5 first:border-t-0">
      <div className="min-w-0">
        <div className="text-[13px] font-semibold text-fg">{name}</div>
        {detail && <div className="mt-0.5 text-[11.5px] text-fg-faint">{detail}</div>}
      </div>
      <div className="whitespace-nowrap text-right font-mono text-[12px] text-fg-muted">{value}</div>
      <div className="justify-self-end">{action}</div>
    </div>
  );

  const open = (label: string, onClick: () => void, disabled = false) => (
    <button type="button" className="btn" onClick={onClick} disabled={disabled}>
      {label}
    </button>
  );

  const docsAndContexts = `${plural(summary.library.count, "doc")} · ${plural(
    summary.contexts.count,
    "Context",
  )} · ${formatBytes(summary.library.bytes + summary.contexts.bytes)}`;

  return (
    <div className="flex flex-col gap-2" data-testid="local-data-setting">
      <p className="text-[12px] leading-relaxed text-fg-muted">
        Everything below is stored on this computer. Conva can&apos;t see it and can&apos;t delete it for
        you.
      </p>
      <div>
        {row(
          "Call recordings",
          "Include the other person's voice. Kept until you delete them.",
          describeCategory(summary.recordings, "file"),
          open("Review…", () => setView("recordings")),
        )}
        {row(
          "Saved conversations",
          null,
          summary.conversations.count.toLocaleString(),
          open("Open", () => setView("conversations")),
        )}
        {row(
          "Session logs",
          "Written automatically each session.",
          describeCategory(summary.session_logs, "log"),
          open("Open", () => setView("conversations")),
        )}
        {row(
          "Library documents and Contexts",
          null,
          docsAndContexts,
          open("Open", () => setView("library")),
        )}
        {row(
          "Usage counts and diagnostics log",
          null,
          formatBytes(summary.diagnostics.bytes),
          null,
        )}
        {row(
          "Downloaded speech models",
          "Not personal. Kept when you erase.",
          describeCategory(summary.models, "file"),
          <span className="rounded border border-ok/30 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-ok">
            Kept
          </span>,
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
        <button
          type="button"
          className="btn"
          onClick={() => {
            setError(null);
            void backend.localData.openDataFolder().catch((e) => setError(String(e)));
          }}
        >
          Open data folder
        </button>
        <span className="flex-1" />
        <button
          type="button"
          className="btn border-rec/40 bg-rec/10 text-rec"
          onClick={() => setErasing(true)}
        >
          Erase everything on this computer…
        </button>
      </div>
      {error && (
        <p className="text-[11px] text-rec" role="alert">
          {error}
        </p>
      )}
      <p className="text-[11px] text-fg-faint">
        Erasing here does not touch your Conva account or anything saved to Conva&apos;s servers. To remove
        those, delete your account in Profile.
      </p>
      {erasing && <EraseLocalDataDialog summary={summary} onClose={() => setErasing(false)} />}
    </div>
  );
}

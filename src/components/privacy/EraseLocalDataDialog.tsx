import { useEffect, useRef, useState } from "react";

import { useBackend } from "@/lib/backend";
import { formatBytes } from "@/lib/formatBytes";
import type { LocalDataSummary } from "@/lib/ipc";
import { describeCategory, erasableBytes, plural } from "@/lib/localData";

/** The word the user types to enable the Erase button. */
export const ERASE_CONFIRM_WORD = "ERASE";

/**
 * "Erase everything on this computer?" — lists exactly what goes, with counts,
 * before anything is touched. The Erase button stays off until the user types
 * ERASE. The erase itself runs at the next start (the shell queues it), so on
 * success this relaunches the app. API keys are a separate, unticked option:
 * erasing data should not make someone re-enter their keys. The dialog's one
 * affirmative action stays in its always-visible footer.
 */
export function EraseLocalDataDialog({
  summary,
  onClose,
}: {
  summary: LocalDataSummary;
  onClose: () => void;
}) {
  const backend = useBackend();
  const [typed, setTyped] = useState("");
  const [includeKeys, setIncludeKeys] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => inputRef.current?.focus(), []);

  const ready = typed.trim() === ERASE_CONFIRM_WORD && !busy;

  const erase = async () => {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      await backend.localData.erase({ include_keys: includeKeys });
      // The shell erases at the next start, before anything is opened.
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    } catch (e) {
      setBusy(false);
      setError(String(e));
    }
  };

  const item = (title: string, detail: string) => (
    <li className="flex items-start gap-2 text-fg">
      <input type="checkbox" checked disabled readOnly className="mt-0.5 accent-primary" aria-label={title} />
      <span>
        {title}
        <small className="block text-[11px] text-fg-faint">{detail}</small>
      </span>
    </li>
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-bg/80 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="erase-local-title"
      onKeyDown={(e) => {
        if (e.key === "Escape" && !busy) onClose();
      }}
    >
      <div className="flex w-full max-w-[520px] flex-col rounded-lg border border-border-strong bg-panel-raised shadow-lg">
        <h2 id="erase-local-title" className="px-[18px] pt-4 text-[15px] font-bold text-fg">
          Erase everything on this computer?
        </h2>
        <div className="flex flex-col gap-2.5 px-[18px] py-3 text-[12.5px] text-fg-muted">
          <ul className="flex flex-col gap-1.5">
            {item("Call recordings", describeCategory(summary.recordings, "file"))}
            {item(
              "Saved conversations and session logs",
              `${plural(summary.conversations.count, "conversation")} · ${plural(summary.session_logs.count, "log")}`,
            )}
            {item(
              "Library documents and Contexts",
              `${plural(summary.library.count, "document")} · ${plural(summary.contexts.count, "Context")} · ${formatBytes(
                summary.library.bytes + summary.contexts.bytes,
              )}`,
            )}
            {item("Usage counts and diagnostics log", formatBytes(summary.diagnostics.bytes))}
            <li className="flex items-start gap-2 text-fg">
              <input
                id="erase-keys"
                type="checkbox"
                checked={includeKeys}
                onChange={(e) => setIncludeKeys(e.target.checked)}
                disabled={busy}
                className="mt-0.5 accent-primary"
              />
              <label htmlFor="erase-keys">
                Also remove my API keys from the Windows Credential Manager
                <small className="block text-[11px] text-fg-faint">Leave this off to keep your keys.</small>
              </label>
            </li>
          </ul>
          <div className="rounded-md border border-rec/40 bg-rec/10 px-2.5 py-2 text-[12px] text-fg">
            This can&apos;t be undone. Your Conva account and anything saved to Conva&apos;s servers are not
            affected.
          </div>
          <label htmlFor="erase-confirm" className="text-fg">
            Type <b className="font-mono">{ERASE_CONFIRM_WORD}</b> to confirm
          </label>
          <input
            id="erase-confirm"
            ref={inputRef}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            disabled={busy}
            autoComplete="off"
            spellCheck={false}
            placeholder={ERASE_CONFIRM_WORD}
            className="w-full rounded-md border border-border-strong bg-bg px-2.5 py-2 font-mono text-[13px] text-fg"
            onKeyDown={(e) => {
              if (e.key === "Enter") void erase();
            }}
          />
          {error && (
            <p className="text-[12px] text-rec" role="alert">
              {error}
            </p>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-border px-[18px] py-3">
          <span className="mr-auto text-[11px] text-fg-faint">
            Keeps: speech models, settings · {formatBytes(erasableBytes(summary))} to remove
          </span>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="btn border-rec bg-rec text-bg disabled:opacity-40"
            disabled={!ready}
            onClick={() => void erase()}
          >
            {busy ? "Restarting…" : "Erase and restart"}
          </button>
        </div>
      </div>
    </div>
  );
}

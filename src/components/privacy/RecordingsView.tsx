import { useCallback, useEffect, useMemo, useState } from "react";

import { ViewActionFooter, ViewShell } from "@/components/studio/ViewShell";
import { useBackend } from "@/lib/backend";
import { formatBytes } from "@/lib/formatBytes";
import type { RecordingInfo } from "@/lib/ipc";
import { formatDuration, formatRecordedAt, plural } from "@/lib/localData";
import { useNavStore } from "@/state/nav";

/**
 * Settings → Privacy → Call recordings. A sub-view of Settings, so it has the
 * back control top-left and the delete action twice (top-right and in the
 * footer, one handler, one disabled state). Deleting asks once, naming how
 * many files and how much space, and a deleted recording is gone — it is not
 * moved to a recycle bin.
 */
export function RecordingsView() {
  const backend = useBackend();
  const openSettingsGroup = useNavStore((s) => s.openSettingsGroup);
  const [items, setItems] = useState<RecordingInfo[] | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    backend.localData
      .recordings()
      .then((list) => {
        setItems(list);
        setPicked((prev) => new Set(list.filter((r) => prev.has(r.id)).map((r) => r.id)));
      })
      .catch(() => setUnavailable(true));
  }, [backend]);
  useEffect(load, [load]);

  const selected = useMemo(() => (items ?? []).filter((r) => picked.has(r.id)), [items, picked]);
  const selectedBytes = selected.reduce((sum, r) => sum + r.size_bytes, 0);
  const allPicked = !!items && items.length > 0 && selected.length === items.length;

  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const doDelete = async () => {
    setBusy(true);
    setError(null);
    try {
      const report = await backend.localData.deleteRecordings(selected.map((r) => r.id));
      setMessage(
        report.failed.length > 0
          ? `Deleted ${plural(report.deleted, "recording")}. ${plural(report.failed.length, "recording")} could not be deleted.`
          : `Deleted ${plural(report.deleted, "recording")} and freed ${formatBytes(report.freed_bytes)}.`,
      );
      setPicked(new Set());
      load();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };

  const deleteButton = (solid: boolean) => (
    <button
      type="button"
      className={solid ? "btn border-rec bg-rec text-bg disabled:opacity-40" : "btn border-rec/40 bg-rec/10 text-rec disabled:opacity-40"}
      disabled={selected.length === 0 || busy}
      onClick={() => setConfirming(true)}
    >
      Delete selected
    </button>
  );

  return (
    <ViewShell
      icon="record"
      breadcrumb="Settings"
      title="Call recordings"
      onBack={() => openSettingsGroup("privacy")}
      actions={deleteButton(false)}
      footer={
        <ViewActionFooter
          status={selected.length ? `${plural(selected.length, "recording")} selected · ${formatBytes(selectedBytes)}` : "None selected"}
        >
          {deleteButton(true)}
        </ViewActionFooter>
      }
    >
      {unavailable ? (
        <p className="text-sm text-fg-muted" role="status">
          Recordings are only kept by the desktop app.
        </p>
      ) : items === null ? (
        <p className="text-sm text-fg-faint" role="status">
          Loading…
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-[12px] text-fg-muted">
            Recordings are stereo files: you on the left, the other party on the right. They stay on this computer
            until you delete them.
          </p>
          {message && (
            <p className="rounded-md border border-ok/30 bg-ok/10 px-3 py-2 text-[12px] text-fg" role="status">
              {message}
            </p>
          )}
          {error && (
            <p className="text-[12px] text-rec" role="alert">
              {error}
            </p>
          )}
          {items.length === 0 ? (
            <p className="text-sm text-fg-faint">No recordings on this computer.</p>
          ) : (
            <table className="w-full border-collapse text-[12.5px]">
              <thead>
                <tr className="border-b border-border text-left font-mono text-[10.5px] uppercase tracking-wide text-fg-faint">
                  <th className="w-8 px-2 py-1.5">
                    <input
                      type="checkbox"
                      aria-label="Select all recordings"
                      checked={allPicked}
                      onChange={() => setPicked(allPicked ? new Set() : new Set(items.map((r) => r.id)))}
                    />
                  </th>
                  <th className="px-2 py-1.5">Recorded</th>
                  <th className="px-2 py-1.5">Length</th>
                  <th className="px-2 py-1.5">Size</th>
                  <th className="px-2 py-1.5" />
                </tr>
              </thead>
              <tbody>
                {items.map((r) => (
                  <tr key={r.id} className={`border-b border-border ${picked.has(r.id) ? "bg-rec/10" : ""}`}>
                    <td className="px-2 py-2">
                      <input
                        type="checkbox"
                        aria-label={`Select recording from ${formatRecordedAt(r.started_unix_ms)}`}
                        checked={picked.has(r.id)}
                        onChange={() => toggle(r.id)}
                      />
                    </td>
                    <td className="px-2 py-2 text-fg">{formatRecordedAt(r.started_unix_ms)}</td>
                    <td className="px-2 py-2 font-mono text-[12px] text-fg-muted">{formatDuration(r.duration_ms)}</td>
                    <td className="px-2 py-2 font-mono text-[12px] text-fg-muted">{formatBytes(r.size_bytes)}</td>
                    <td className="px-2 py-2 text-right">
                      <button
                        type="button"
                        className="btn"
                        onClick={() => {
                          setError(null);
                          void backend.localData.revealRecording(r.id).catch((e) => setError(String(e)));
                        }}
                      >
                        Reveal
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {confirming && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-bg/80 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-recordings-title"
          onKeyDown={(e) => {
            if (e.key === "Escape" && !busy) setConfirming(false);
          }}
        >
          <div className="w-full max-w-[440px] rounded-lg border border-border-strong bg-panel-raised shadow-lg">
            <h2 id="delete-recordings-title" className="px-[18px] pt-4 text-[15px] font-bold text-fg">
              Delete {plural(selected.length, "recording")}?
            </h2>
            <p className="px-[18px] py-3 text-[12.5px] text-fg">
              This frees {formatBytes(selectedBytes)}. They can&apos;t be recovered.
            </p>
            <div className="flex justify-end gap-2 border-t border-border px-[18px] py-3">
              <button type="button" className="btn" onClick={() => setConfirming(false)} disabled={busy}>
                Cancel
              </button>
              <button
                type="button"
                className="btn border-rec bg-rec text-bg"
                onClick={() => void doDelete()}
                disabled={busy}
                autoFocus
              >
                {busy ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </ViewShell>
  );
}

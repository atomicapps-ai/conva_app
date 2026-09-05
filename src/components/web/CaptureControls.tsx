import { useEffect, useState } from "react";

import { useBackend, useCaptureSource, useOperationAvailability } from "@/lib/backend";
import { coverageOf, type CaptureStatus } from "@/lib/capture/pal";
import { useTranscriptStore } from "@/state/transcript";

/*
 * src/components/web/ — WEB-ONLY. "Share call audio" is the explicit second
 * action of a browser live session (architecture §7A.3): the mic starts on
 * Start; the other party's audio needs the user to pick a tab/screen and enable
 * "share audio" — every time, from a click. This strip shows, truthfully, what
 * is being transcribed right now ("both sides" / "you only") and why not.
 */

const FAILURE_COPY: Record<string, string> = {
  denied: "Sharing was cancelled or blocked.",
  no_audio_track: "That selection had no audio. Pick a tab or screen and tick “share audio”.",
  cancelled: "Sharing was cancelled.",
  no_session: "Press Start first, then share call audio.",
  unsupported: "This browser can't share tab or screen audio — you'll be transcribed alone.",
  not_found: "No shareable source was found.",
};

export function CaptureControls() {
  const backend = useBackend();
  const session = useTranscriptStore((s) => s.session);
  const share = useCaptureSource("display");
  const startAvailability = useOperationAvailability("capture.start");
  const [statuses, setStatuses] = useState<CaptureStatus[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [op, setOp] = useState(0);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    void backend.capture
      .subscribe((s) => setStatuses(s))
      .then((u) => {
        if (cancelled) u();
        else unlisten = u;
      })
      .catch(() => {
        /* desktop: per-source status is unimplemented — this strip never renders there */
      });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [backend]);

  const listening = session.state === "listening";
  const coverage = coverageOf(statuses);
  // The remote-mix source of this session (display/tab share), whatever id the adapter gave it.
  const shareStatus = statuses.find((s) => s.channel === "remote_mix" || s.channel === "remote_track");
  const sharing = shareStatus?.phase === "capturing";
  const canShare =
    listening && !sharing && share?.availability.state === "available" && startAvailability?.state === "available";
  const cannotShareReason =
    share && share.availability.state !== "available" ? share.availability.reason : null;

  const onShare = async () => {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    const id = `share-${op + 1}`;
    setOp((n) => n + 1);
    try {
      await backend.capture.start("display", id);
    } catch (e) {
      const code = (e as { code?: string } | null)?.code ?? "";
      setMessage(FAILURE_COPY[code] ?? (e instanceof Error ? e.message : "Could not share call audio."));
    } finally {
      setBusy(false);
    }
  };

  const onStopShare = async () => {
    if (!shareStatus) return;
    setBusy(true);
    try {
      await backend.capture.stop(shareStatus.source_id);
    } finally {
      setBusy(false);
    }
  };

  if (!listening) return null;

  return (
    <span className="flex items-center gap-2 font-mono text-[11px]">
      <span
        className={coverage === "both" ? "text-inbound" : "text-fg-muted"}
        title={shareStatus?.reason ?? undefined}
        aria-live="polite"
      >
        {coverage === "both" ? "both sides" : coverage === "self_only" ? "you only" : coverage === "remote_only" ? "call only" : "no audio"}
        {shareStatus?.phase === "degraded" || shareStatus?.phase === "ended" ? " · call audio ended" : ""}
      </span>
      {sharing ? (
        <button
          type="button"
          onClick={() => void onStopShare()}
          disabled={busy}
          className="rounded border border-border-strong px-2 py-0.5 text-[11px] font-semibold text-fg-muted transition hover:text-fg disabled:opacity-60"
        >
          Stop sharing
        </button>
      ) : (
        <button
          type="button"
          onClick={() => void onShare()}
          disabled={!canShare || busy}
          title={cannotShareReason ?? "Pick the tab or screen with your call and enable “share audio”"}
          className="rounded border border-border-strong px-2 py-0.5 text-[11px] font-semibold text-fg transition hover:bg-panel-raised disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? "Choosing…" : "Share call audio"}
        </button>
      )}
      {message && (
        <span role="alert" className="text-fg-muted">
          {message}
        </span>
      )}
      {!message && cannotShareReason && (
        <span className="text-fg-faint" title={cannotShareReason}>
          call audio unavailable
        </span>
      )}
    </span>
  );
}

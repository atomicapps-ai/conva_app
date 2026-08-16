import { Icon } from "@/components/ui/Icon";
import { ResponsiveLabel } from "@/components/ui/ResponsiveLabel";
import { useAppStore } from "@/state/app";
import { useElapsed } from "@/lib/useElapsed";
import { useTranscriptStore } from "@/state/transcript";

/**
 * Live session's own control bar (V4.0's `.controlbar`) — replaces the
 * Start/Stop + Record cluster that used to live in the now-removed global
 * `TopBar`. Maps onto the mockup's row as:
 *
 * - `core` → the Start/Stop toggle itself (idle = click to start, listening
 *   = pulses, click to stop). The mockup draws it as a passive "Listening"
 *   indicator with no visible Start anywhere in its (mid-call) demo state;
 *   making it the click target is the one place this session's rebuild
 *   fills in a gap the mockup's single frozen frame doesn't show.
 * - `Pause` → present but disabled. `Paused` exists as an IPC enum variant
 *   (`crates/conva-core/src/ipc.rs`) but nothing in `src-tauri` ever
 *   constructs or handles it — there's no backend to wire this to yet.
 * - mic / Ally toggles → present but disabled, same reason: no mid-call
 *   mute or Ally-silence command exists today. Shipping them visibly-off
 *   rather than omitting them keeps the gap honest instead of hidden.
 * - the "ASK CONVA" hint → informational only. The real, working ask box
 *   stays exactly where it already lived (bottom of the transcript column,
 *   `TranscriptView.tsx`) rather than being uprooted into this 62px-tall
 *   strip — moving working, tested state wiring wasn't worth the risk for
 *   a purely cosmetic slot.
 * - `End & summarise` → today's Stop, which already opens
 *   `SaveConversationDialog` to save the transcript as a named conversation
 *   — a genuine semantic match, not a relabel.
 * - Record sits here too (owner feedback) — it was stranded alone up in
 *   `LiveTopBar`; it's a session-lifecycle action, same family as Start/Stop
 *   and End & summarise, so it belongs grouped with them.
 */
export function LiveControlBar() {
  const session = useTranscriptStore((s) => s.session);
  const listening = session.state === "listening";
  const preparing = session.state === "preparing";
  const busy = useAppStore((s) => s.busy);
  const lastError = useAppStore((s) => s.lastError);
  const modelStatus = useAppStore((s) => s.modelStatus);
  const start = useAppStore((s) => s.start);
  const stop = useAppStore((s) => s.stop);
  const recording = useAppStore((s) => s.recording);
  const startRecording = useAppStore((s) => s.startRecording);
  const stopRecording = useAppStore((s) => s.stopRecording);
  const elapsed = useElapsed(listening);

  const statusText = (() => {
    if (preparing) return session.message;
    if (modelStatus?.state === "downloading") {
      return `Downloading speech model ${modelStatus.model}… ${modelStatus.percent}%`;
    }
    if (modelStatus?.state === "error") return `Model download failed: ${modelStatus.message}`;
    if (lastError === "consent_required") return "Acknowledge the consent notice first.";
    if (lastError?.includes("model_downloading")) {
      return "Fetching the speech model — Start again when it's ready.";
    }
    if (session.state === "error") return session.message;
    return lastError ?? "";
  })();
  const isError =
    modelStatus?.state === "error" ||
    session.state === "error" ||
    lastError === "consent_required" ||
    (lastError !== null && !lastError.includes("model_downloading"));

  return (
    <div className="flex h-[52px] shrink-0 items-center gap-3 border-t border-border bg-bg-2 px-3.5">
      <button
        type="button"
        disabled={busy || preparing}
        onClick={() => void (listening ? stop() : start())}
        title={listening ? "Stop listening" : "Start listening"}
        aria-pressed={listening}
        className={[
          "grid h-10 w-10 shrink-0 place-items-center rounded-full border transition disabled:opacity-50",
          listening
            ? "border-ok/50 bg-ok/10 text-ok"
            : "border-border-strong bg-panel-raised text-fg-muted hover:text-fg",
        ].join(" ")}
      >
        {listening ? (
          <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-ok" aria-hidden />
        ) : (
          <Icon name="live" size={18} />
        )}
      </button>

      {statusText ? (
        <span
          className={`min-w-0 max-w-[26ch] truncate text-[11.5px] ${isError ? "text-rec" : "text-fg-muted"}`}
          role="status"
          aria-live="polite"
        >
          {statusText}
        </span>
      ) : (
        <>
          <button
            type="button"
            disabled
            title="Pause — not wired up yet"
            aria-label="Pause (not yet available)"
            className="flex h-9 shrink-0 items-center gap-2 whitespace-nowrap rounded-[6px] border border-border-strong px-3 text-[13px] font-bold text-fg-faint opacity-50"
          >
            <Icon name="pause" size={16} />
            <ResponsiveLabel full="Pause" short="" />
          </button>
          <button
            type="button"
            disabled
            title="Mute microphone — not wired up yet"
            aria-label="Mute microphone (not yet available)"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-[6px] border border-border-strong text-inbound opacity-50"
          >
            <Icon name="mic" size={16} />
          </button>
          <button
            type="button"
            disabled
            title="Silence Ally — not wired up yet"
            aria-label="Silence Ally (not yet available)"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-[6px] border border-border-strong text-ai opacity-50"
          >
            <Icon name="ally" size={16} />
          </button>
        </>
      )}

      <span className="flex-1" aria-hidden />

      {listening && (
        <span className="hidden shrink-0 items-center gap-1.5 font-mono text-[10.5px] text-fg-faint sm:flex">
          <Icon name="lightbulb" size={13} className="text-ai/70" />
          Ask Ally below
          <kbd className="rounded border border-border-strong px-1.5 py-0.5 text-[9.5px] text-fg-muted">
            Ctrl ⇧ Space
          </kbd>
        </span>
      )}

      <button
        type="button"
        disabled={!listening}
        onClick={() => void (recording ? stopRecording() : startRecording())}
        aria-pressed={recording}
        title={
          !listening
            ? "Start listening first to record"
            : recording
              ? "Stop recording"
              : "Record the call (stereo WAV: you left, them right)"
        }
        className={[
          "flex h-9 shrink-0 items-center gap-2 whitespace-nowrap rounded-[6px] border px-3 text-[13px] font-bold transition disabled:opacity-40",
          recording
            ? "border-rec/50 bg-rec/10 text-rec"
            : "border-border-strong text-fg-muted hover:text-fg",
        ].join(" ")}
      >
        <Icon name="record" size={15} />
        <ResponsiveLabel full={recording ? "Recording" : "Record"} short="Rec" />
      </button>

      <button
        type="button"
        disabled={!listening}
        onClick={() => void stop()}
        title="End & summarise — stops listening and offers to save the transcript"
        className="flex h-9 shrink-0 items-center gap-2 whitespace-nowrap rounded-[6px] border border-rec/50 bg-rec/10 px-3 text-[13px] font-bold text-rec transition hover:brightness-110 disabled:opacity-40"
      >
        <Icon name="record" size={15} />
        <ResponsiveLabel full="End & summarise" short="End" />
        {listening && (
          <span className="font-mono text-[11px] font-bold text-rec/80">{elapsed}</span>
        )}
      </button>
    </div>
  );
}

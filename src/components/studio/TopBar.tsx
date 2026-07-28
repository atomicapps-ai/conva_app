import { Core, coreStateFrom } from "@/components/ui/Core";
import { Icon } from "@/components/ui/Icon";
import { isTauri } from "@/lib/ipc";
import { useAppStore } from "@/state/app";
import { useConversationStore } from "@/state/conversation";
import { useTranscriptStore } from "@/state/transcript";

/**
 * The Studio top bar (UI overhaul M2) — the curved instrument crown. Left lobe
 * carries the sonar Core + state readout; the right lobe carries the primary
 * Start/Stop control with Record + Sidecar. The former StatusBar's panel
 * buttons moved to the NavRail, so this bar is now purely the live control
 * surface. Its silhouette curves asymmetrically at the foot (a larger radius on
 * the left) to echo the pod language.
 */
export function TopBar() {
  const session = useTranscriptStore((s) => s.session);
  const conversationTitle = useConversationStore((s) => s.title);
  const sidecar = useAppStore((s) => s.sidecar);
  const toggleSidecar = useAppStore((s) => s.toggleSidecar);
  const busy = useAppStore((s) => s.busy);
  const lastError = useAppStore((s) => s.lastError);
  const modelStatus = useAppStore((s) => s.modelStatus);
  const start = useAppStore((s) => s.start);
  const stop = useAppStore((s) => s.stop);
  const recording = useAppStore((s) => s.recording);
  const startRecording = useAppStore((s) => s.startRecording);
  const stopRecording = useAppStore((s) => s.stopRecording);
  const listening = session.state === "listening";
  const preparing = session.state === "preparing";

  const statusText = (() => {
    if (preparing) return session.message;
    if (modelStatus?.state === "downloading") {
      return `Downloading speech model ${modelStatus.model}… ${modelStatus.percent}%`;
    }
    if (modelStatus?.state === "error") {
      return `Model download failed: ${modelStatus.message}`;
    }
    if (lastError === "consent_required") {
      return "Acknowledge the consent notice first.";
    }
    if (lastError?.includes("model_downloading")) {
      return "Fetching the speech model — Start again when it's ready.";
    }
    if (session.state === "error") return session.message;
    if (modelStatus?.state === "ready" && !listening) {
      return "Speech model ready — press Start listening.";
    }
    return lastError ?? "";
  })();
  const isError =
    modelStatus?.state === "error" ||
    session.state === "error" ||
    lastError === "consent_required" ||
    (lastError !== null && !lastError.includes("model_downloading"));

  const coreState = coreStateFrom(session.state, recording);
  const coreLabel = preparing
    ? "PREP"
    : recording
      ? "REC"
      : listening
        ? "LIVE"
        : "IDLE";

  return (
    <header className="glass flex h-14 shrink-0 items-center gap-3 rounded-bl-[26px] rounded-br-[14px] border-t-0 px-4">
      <span className="flex items-center gap-2 font-mono text-[11px] tracking-widest">
        <Core state={coreState} size={26} />
        <span
          className={
            recording
              ? "text-rec"
              : listening
                ? "text-inbound"
                : "text-fg-faint"
          }
        >
          {coreLabel}
        </span>
      </span>
      <h1 className="text-sm font-extrabold tracking-tight">
        conva
      </h1>
      {conversationTitle && (
        <span className="max-w-[16rem] truncate rounded-full border border-ai/40 px-2 py-0.5 text-[11px] text-ai">
          {conversationTitle}
        </span>
      )}

      <span
        className={`ml-auto max-w-[40%] truncate text-xs ${isError ? "text-rec" : "text-fg-muted"}`}
        role="status"
        aria-live="polite"
      >
        {statusText}
      </span>

      {isTauri() && (
        <div className="flex items-center gap-2">
          {listening && (
            <button
              type="button"
              onClick={() =>
                void (recording ? stopRecording() : startRecording())
              }
              aria-pressed={recording}
              aria-label={
                recording
                  ? "Stop recording the call"
                  : "Record the call to a stereo audio file"
              }
              title={
                recording
                  ? "Stop recording"
                  : "Record the call (stereo WAV: you left, them right)"
              }
              className={[
                "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition",
                recording
                  ? "border-rec/60 text-rec hover:bg-rec/10"
                  : "border-border text-fg-muted hover:text-fg",
              ].join(" ")}
            >
              <span
                className={
                  recording
                    ? "h-2 w-2 animate-pulse rounded-full bg-rec"
                    : "h-2 w-2 rounded-full bg-rec/70"
                }
                aria-hidden
              />
              {recording ? "Stop recording" : "Record"}
            </button>
          )}

          <button
            type="button"
            onClick={() => void toggleSidecar()}
            aria-pressed={sidecar}
            aria-label="Toggle sidecar mode (narrow always-on-top)"
            title="Sidecar — narrow always-on-top strip beside a call window"
            className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition ${
              sidecar
                ? "border-ai/50 text-ai"
                : "border-border text-fg-muted hover:text-fg"
            }`}
          >
            <Icon name="sidecar" size={15} />
            Sidecar
          </button>

          {/* Primary control — the Start/Stop instrument switch. */}
          <button
            type="button"
            disabled={busy || preparing}
            onClick={() => void (listening ? stop() : start())}
            className={[
              "rounded-full px-4 py-1.5 text-xs font-semibold transition disabled:opacity-50",
              listening
                ? "border border-rec/50 text-rec hover:bg-rec/10"
                : "iris-gradient glow text-bg hover:brightness-110",
            ].join(" ")}
          >
            {listening ? "Stop" : preparing ? "Preparing…" : "Start listening"}
          </button>
        </div>
      )}
    </header>
  );
}

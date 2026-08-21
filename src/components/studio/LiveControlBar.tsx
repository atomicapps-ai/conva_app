import { Core, coreStateFrom } from "@/components/ui/Core";
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
 *   = pulses, click to stop), now the real `<Core>` sonar instrument
 *   (rings + radar sweep + orbiting node + breathing center — the same
 *   component the mockup's own `.core` JS builds) instead of a plain
 *   pulsing dot. `Core.tsx` already existed, fully built, just never
 *   wired into anything (owner feedback 2026-08-17). The mockup draws it
 *   as a passive "Listening" indicator with no visible Start anywhere in
 *   its (mid-call) demo state; making it the click target is the one
 *   place this session's rebuild fills in a gap the mockup's single
 *   frozen frame doesn't show.
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
 * - Record + End & summarise sit in the LEFT group (owner, 2026-08-21) so
 *   the bar's absolute bottom-right corner holds the two Ally-panel TABS —
 *   Details · Terms — exclusive tabs in the left-nav silhouette, aligned
 *   under the 340px right panel. Passed via `tabs` by the live cockpit;
 *   omitted (e.g. compact mode) the bar renders without them.
 */
export type AllyPanelTab = "details" | "terms";

export function LiveControlBar({
  tabs,
}: {
  tabs?: { tab: AllyPanelTab; onSelect: (tab: AllyPanelTab) => void };
}) {
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
  const coreState = coreStateFrom(session.state, recording);

  return (
    <div className="flex h-[52px] shrink-0 items-stretch border-t border-border bg-bg-2">
      <div className="flex min-w-0 flex-1 items-center gap-3 px-3.5">
      <button
        type="button"
        disabled={busy || preparing}
        onClick={() => void (listening ? stop() : start())}
        title={listening ? "Stop listening" : "Start listening"}
        aria-pressed={listening}
        className="grid h-10 w-10 shrink-0 place-items-center rounded-full transition hover:brightness-110 disabled:opacity-50"
      >
        <Core state={coreState} size={34} />
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

      <span className="flex-1" aria-hidden />

      {listening && (
        <span className="hidden shrink-0 items-center gap-1.5 font-mono text-[10.5px] text-fg-faint sm:flex">
          <Icon name="lightbulb" size={13} className="text-ai/70" />
          Ask Ally
          <kbd className="rounded border border-border-strong px-1.5 py-0.5 text-[9.5px] text-fg-muted">
            Ctrl ⇧ Space
          </kbd>
        </span>
      )}
      </div>

      {/* Ally-panel tabs — the absolute bottom-right corner, aligned under
          the 340px panel. Exclusive tabs (one active), the same silhouette
          language as the left nav rail's active state. */}
      {tabs && (
        <div
          role="tablist"
          aria-label="Ally panel tabs"
          className="flex w-[340px] shrink-0 items-stretch border-l border-border"
        >
          {(
            [
              ["details", "Details"],
              ["terms", "Terms"],
            ] as const
          ).map(([key, label], i) => {
            const active = tabs.tab === key;
            return (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => tabs.onSelect(key)}
                className={[
                  "relative flex flex-1 items-center justify-center gap-2 text-[12.5px] transition",
                  i > 0 ? "border-l border-border" : "",
                  active
                    ? "bg-panel-raised font-bold text-primary"
                    : "font-semibold text-fg-faint hover:text-fg",
                ].join(" ")}
              >
                {active && (
                  <span
                    className="absolute inset-x-0 top-0 h-[2px] bg-primary"
                    aria-hidden
                  />
                )}
                <Icon name={key === "details" ? "summarize" : "file"} size={14} />
                {label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

import { Core, coreStateFrom } from "@/components/ui/Core";
import { Icon } from "@/components/ui/Icon";
import { ResponsiveLabel } from "@/components/ui/ResponsiveLabel";
import { useAppStore } from "@/state/app";
import { useElapsed } from "@/lib/useElapsed";
import { hasTranscribedContent } from "@/lib/turns";
import { useConversationStore } from "@/state/conversation";
import { useRehearsalStore } from "@/state/rehearsal";
import { useTranscriptStore } from "@/state/transcript";

/**
 * Live session's own control bar (V4.0's `.controlbar`) — replaces the
 * Start/Stop + Record cluster that used to live in the now-removed global
 * `TopBar`. Maps onto the mockup's row as:
 *
 * - `core` → a passive LIVE INDICATOR, not a control (owner, 2026-08-21:
 *   "the animation is not the button to start listening"): the `<Core>`
 *   sonar is lit while listening/preparing and dimmed when idle. The
 *   session toggle is the labeled button — idle: "Start listening"
 *   (primary), listening: "End" (red, with elapsed). (V4.0 briefly made the
 *   sonar the click target; reversed per the same owner feedback.)
 * - `Pause` → real (owner, 2026-09-15 — previously present but hard-disabled
 *   with no backend at all). Mic/loopback devices stay open; the session's
 *   frame sink just stops forwarding while paused, so resume is instant.
 *   Toggles to "Resume" when `session.state === "paused"`.
 * - `Save` → also real, 2026-09-15: End used to ALWAYS force a save/discard
 *   decision the moment anything was transcribed, which read as "I just
 *   wanted to pause, not be interrogated." End is now a plain stop — the
 *   transcript just stays on screen, undecided — and this button is the
 *   explicit, always-available way to save it (opens the same naming
 *   dialog, `SaveConversationDialog`), enabled whenever there's something to
 *   save (`hasTranscribedContent`). Nothing is silently lost either way: the
 *   raw run persists on-device in Sessions regardless, and "+ New" still
 *   asks what to do with unsaved content before discarding it
 *   (`requestNew`) — only the forced prompt on every End is gone.
 * - mic / Ally mute toggles → present but disabled: no mid-call mute or
 *   Ally-silence command exists today. Shipping them visibly-off rather than
 *   omitting them keeps the gap honest instead of hidden.
 * - the "ASK CONVA" hint → informational only. The real, working ask box
 *   stays exactly where it already lived (bottom of the transcript column,
 *   `TranscriptView.tsx`) rather than being uprooted into this 62px-tall
 *   strip — moving working, tested state wiring wasn't worth the risk for
 *   a purely cosmetic slot.
 * - Record sits here too (owner feedback) — it was stranded alone up in
 *   `LiveTopBar`; it's a session-lifecycle action, same family as Start/Stop
 *   and Save, so it belongs grouped with them.
 * - The Details/Terms tab zone is RETIRED (spine-accordion spec,
 *   2026-08-26): the right panel is now a spine-icon accordion that
 *   carries its own section controls, so the bar holds no panel tabs.
 *   In drawer mode (<640px) the cockpit passes `onOpenPanel`, and the
 *   bar's right edge grows a single Ally button that opens the overlay
 *   panel; omitted (inline panel, compact mode) the bar ends at the
 *   control cluster.
 */
export function LiveControlBar({
  onOpenPanel,
}: {
  /** Drawer mode only: opens the Ally panel overlay. */
  onOpenPanel?: () => void;
}) {
  const session = useTranscriptStore((s) => s.session);
  const listening = session.state === "listening";
  const paused = session.state === "paused";
  // A paused session is still an active session (not idle) — the End toggle
  // below must keep offering End, not silently flip to "Start listening"
  // (which would try to start a SECOND session on top of the paused one).
  const sessionActive = listening || paused;
  const preparing = session.state === "preparing";
  // A rehearsal is a Live session under the hood (session.state === "listening"
  // exactly as a normal call), so this bar's own session toggle would show a
  // SECOND, identically-behaving "End" alongside RehearsalBar's floating one —
  // both call the exact same stop(), just labeled/positioned differently
  // (owner report, 2026-09-15: "strange to have two end buttons"). RehearsalBar
  // is the fuller, rehearsal-aware control surface, so it owns End here.
  const rehearsalActive = useRehearsalStore((s) => s.active);
  const archived = useTranscriptStore((s) => s.archived);
  const segments = useTranscriptStore((s) => s.segments);
  const canSave = hasTranscribedContent(archived, segments);
  const requestSave = useConversationStore((s) => s.setSavePromptOpen);
  const busy = useAppStore((s) => s.busy);
  const lastError = useAppStore((s) => s.lastError);
  const idleStoppedMinutes = useAppStore((s) => s.idleStoppedMinutes);
  const modelStatus = useAppStore((s) => s.modelStatus);
  const start = useAppStore((s) => s.start);
  const stop = useAppStore((s) => s.stop);
  const pause = useAppStore((s) => s.pause);
  const resume = useAppStore((s) => s.resume);
  const recording = useAppStore((s) => s.recording);
  const startRecording = useAppStore((s) => s.startRecording);
  const stopRecording = useAppStore((s) => s.stopRecording);
  // Keeps ticking through a pause (matches the backend: resume() re-emits
  // Listening with the ORIGINAL start time, not now) — resetting to 00:00
  // on every pause/resume would read as "did this start a new session?".
  const elapsed = useElapsed(sessionActive);

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
    // lib/idleAutoStop.ts already called the same stop() this bar's End
    // button does — Start listening (still fully functional below) IS the
    // resume action, and clears this the moment it's clicked.
    if (idleStoppedMinutes != null && !sessionActive && !lastError) {
      return `Stopped after ${idleStoppedMinutes} min of inactivity — Start listening to resume.`;
    }
    return lastError ?? "";
  })();
  const isError =
    modelStatus?.state === "error" ||
    session.state === "error" ||
    lastError === "consent_required" ||
    (lastError !== null && !lastError.includes("model_downloading"));
  const coreState = coreStateFrom(session.state, recording);

  return (
    <div className="flex h-[38px] shrink-0 items-stretch border-t border-border bg-bg-2">
      {/* overflow-hidden is load-bearing: every child here is shrink-0 +
          nowrap, so at narrow widths the cluster's content would otherwise
          paint straight across the border into the tab zone / right panel
          (the "Start button bleeds into the right pane" bug). Clipping at
          the cluster edge guarantees the bar's zones stay separate at any
          window width; the md:-gated placeholders below keep the real
          controls (Record, Start/End) inside the visible range. */}
      <div className="flex min-w-0 flex-1 items-center gap-[11px] overflow-hidden px-3">
      {/* Live indicator — NOT a control: lit while listening, dimmed idle.
          Sized deliberately close to the bar's own height (owner,
          2026-08-30: "keep [it] as large as possible" when the rest of the
          bar shrank) — 34px in a 38px bar, vs. every button's 28px. */}
      <div
        role="status"
        aria-label={
          listening ? "Listening" : paused ? "Paused" : preparing ? "Preparing" : "Not listening"
        }
        title={
          listening ? "Listening" : paused ? "Paused" : preparing ? "Preparing" : "Not listening"
        }
        className={`grid h-[34px] w-[34px] shrink-0 place-items-center rounded-full transition-opacity ${
          listening || preparing ? "" : "opacity-35 saturate-50"
        }`}
      >
        <Core state={coreState} size={28} />
      </div>

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
            disabled={!listening && !paused}
            onClick={() => void (paused ? resume() : pause())}
            aria-pressed={paused}
            title={
              paused
                ? "Resume — mic was idle, nothing was transcribed while paused"
                : "Pause — the mic stays connected; nothing is transcribed or recorded until you resume"
            }
            className="hidden h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[6px] border border-border-strong px-2 text-xs font-bold text-fg-muted transition hover:text-fg disabled:text-fg-faint disabled:opacity-50 md:flex"
          >
            <Icon name={paused ? "live" : "pause"} size={13} />
            <ResponsiveLabel full={paused ? "Resume" : "Pause"} short="" />
          </button>
          <button
            type="button"
            disabled
            title="Mute microphone — not wired up yet"
            aria-label="Mute microphone (not yet available)"
            className="hidden h-7 w-7 shrink-0 place-items-center rounded-[6px] border border-border-strong text-inbound opacity-50 md:grid"
          >
            <Icon name="mic" size={13} />
          </button>
          <button
            type="button"
            disabled
            title="Silence Ally — not wired up yet"
            aria-label="Silence Ally (not yet available)"
            className="hidden h-7 w-7 shrink-0 place-items-center rounded-[6px] border border-border-strong text-ai opacity-50 md:grid"
          >
            <Icon name="ally" size={13} />
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
          "flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[6px] border px-2 text-xs font-bold transition disabled:opacity-40",
          recording
            ? "border-rec/50 bg-rec/10 text-rec"
            : "border-border-strong text-fg-muted hover:text-fg",
        ].join(" ")}
      >
        <Icon name="record" size={12} />
        <ResponsiveLabel full={recording ? "Recording" : "Record"} short="Rec" />
      </button>

      {/* THE session toggle (owner, 2026-08-21): Start listening ↔ End.
          Hidden during an active rehearsal — see rehearsalActive above. */}
      {!rehearsalActive && (
        <button
          type="button"
          disabled={busy || preparing}
          onClick={() => void (sessionActive ? stop() : start())}
          aria-pressed={sessionActive}
          title={
            sessionActive
              ? "End — stops listening (a plain stop; use Save to keep the transcript)"
              : "Start listening"
          }
          className={[
            "flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[6px] px-2 text-xs font-bold transition hover:brightness-110 disabled:opacity-40",
            sessionActive
              ? "border border-rec/50 bg-rec/10 text-rec"
              : "bg-primary text-primary-ink",
          ].join(" ")}
        >
          <Icon name={sessionActive ? "record" : "live"} size={12} />
          <ResponsiveLabel
            full={sessionActive ? "End" : "Start listening"}
            short={sessionActive ? "End" : "Start"}
          />
          {sessionActive && (
            <span className="font-mono text-[10.5px] font-bold text-rec/80">{elapsed}</span>
          )}
        </button>
      )}

      {/* Explicit Save, next to End (owner, 2026-09-15) — see the doc
          comment above. Available any time there's something to save, not
          just right after End. */}
      <button
        type="button"
        disabled={!canSave}
        onClick={() => requestSave(true)}
        // Explicit aria-label (not left to ResponsiveLabel's text) — with
        // short="" this button is icon-only below the `lg` breakpoint, and
        // an accessible name that changed with viewport width would be a
        // trap for anything (a test, a screen reader) that looks it up by
        // name.
        aria-label="Save this conversation"
        title={canSave ? "Save this conversation" : "Nothing to save yet"}
        className="flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[6px] border border-border-strong px-2 text-xs font-bold text-fg-muted transition hover:text-fg disabled:opacity-40"
      >
        <Icon name="save" size={12} />
        <ResponsiveLabel full="Save" short="" />
      </button>

      <span className="flex-1" aria-hidden />

      {listening && (
        <span className="hidden shrink-0 items-center gap-[5px] font-mono text-[10.5px] text-fg-faint sm:flex">
          <Icon name="lightbulb" size={11} className="text-ai/70" />
          Ask Ally
          <kbd className="rounded border border-border-strong px-[5px] py-[1.5px] text-[9.5px] text-fg-muted">
            Ctrl ⇧ Space
          </kbd>
        </span>
      )}
      </div>

      {onOpenPanel && (
        <button
          type="button"
          onClick={onOpenPanel}
          title="Open Ally panel"
          aria-label="Open Ally panel"
          className="grid w-12 shrink-0 place-items-center border-l border-border text-ai hover:bg-panel-raised/60"
        >
          <Icon name="ally" size={16} />
        </button>
      )}
    </div>
  );
}

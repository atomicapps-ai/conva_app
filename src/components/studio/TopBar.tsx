import { useEffect, useRef, useState } from "react";

import { Icon } from "@/components/ui/Icon";
import wordmark from "@/assets/brand/conva-wordmark-white.png";
import { isTauri, type AudioLevelEvent } from "@/lib/ipc";
import { useAppStore } from "@/state/app";
import { useNavStore } from "@/state/nav";
import { useTranscriptStore } from "@/state/transcript";

/** dBFS [-60,0] → 0..1. */
function levelUnit(level: AudioLevelEvent | null): number {
  if (!level) return 0;
  return Math.max(0, Math.min(1, (level.rms_dbfs + 60) / 60));
}

function clock(ms: number): string {
  const t = Math.floor(ms / 1000);
  const m = Math.floor(t / 60);
  const s = t % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** Elapsed mm:ss since `active` went true; resets when it goes false. */
function useElapsed(active: boolean): string {
  const [ms, setMs] = useState(0);
  const startRef = useRef<number | null>(null);
  useEffect(() => {
    if (!active) {
      startRef.current = null;
      setMs(0);
      return;
    }
    startRef.current = Date.now();
    setMs(0);
    const id = setInterval(
      () => setMs(Date.now() - (startRef.current ?? Date.now())),
      1000,
    );
    return () => clearInterval(id);
  }, [active]);
  return clock(ms);
}

/** Four-bar level meter for one stream (heights ride real RMS). */
function Bars({ level, color }: { level: AudioLevelEvent | null; color: string }) {
  const u = levelUnit(level);
  // A little per-bar shaping so it reads as a meter, not one block.
  const shape = [0.55, 0.85, 1, 0.7];
  return (
    <span className="flex h-[13px] items-end gap-[2px]" aria-hidden>
      {shape.map((k, i) => (
        <span
          key={i}
          className="w-[2px] rounded-[1px]"
          style={{
            height: `${Math.max(2, u * k * 13)}px`,
            background: color,
            opacity: 0.4 + u * 0.6,
          }}
        />
      ))}
    </span>
  );
}

function MeterCluster() {
  const levels = useTranscriptStore((s) => s.levels);
  const config = useAppStore((s) => s.config);
  const cloud = config?.asr_engine === "deepgram_cloud";
  return (
    <div className="flex h-8 items-center gap-3.5 rounded-full border border-border bg-white/[0.035] px-3.5">
      <span className="flex items-center gap-1.5" title="Your microphone level">
        <Icon name="mic" size={13} className="text-outbound" />
        <Bars level={levels.outbound} color="var(--color-outbound)" />
      </span>
      <span className="flex items-center gap-1.5" title="System / other-party level">
        <Icon name="system" size={13} className="text-inbound" />
        <Bars level={levels.inbound} color="var(--color-inbound)" />
      </span>
      <span className="h-4 w-px bg-border" />
      <span className="flex items-center gap-1.5 text-[11px] font-semibold text-fg-muted">
        <span
          className={`h-1.5 w-1.5 rounded-full ${cloud ? "bg-ai" : "bg-ok"}`}
        />
        {cloud ? "Cloud · Deepgram" : "Local · whisper"}
      </span>
    </div>
  );
}

function IconBtn({
  label,
  onClick,
  pressed,
  children,
}: {
  label: string;
  onClick: () => void;
  pressed?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={pressed}
      title={label}
      className={`grid h-[34px] w-[34px] place-items-center rounded-[10px] border transition ${
        pressed
          ? "border-ai/50 bg-ai/10 text-ai"
          : "border-border bg-white/[0.035] text-fg-muted hover:text-fg"
      }`}
    >
      {children}
    </button>
  );
}

/**
 * The Studio top bar (v2) — 56px control crown. Left: wordmark + live meter
 * cluster (mic/system + engine chip). Right, grouped: ⌘K and Compact as icons,
 * then Record + the primary Listening control side by side (Listening shows the
 * elapsed timer and doubles as Stop; both flat, no gradient).
 */
export function TopBar() {
  const session = useTranscriptStore((s) => s.session);
  const compact = useAppStore((s) => s.compact);
  const toggleCompact = useAppStore((s) => s.toggleCompact);
  const busy = useAppStore((s) => s.busy);
  const lastError = useAppStore((s) => s.lastError);
  const modelStatus = useAppStore((s) => s.modelStatus);
  const start = useAppStore((s) => s.start);
  const stop = useAppStore((s) => s.stop);
  const recording = useAppStore((s) => s.recording);
  const startRecording = useAppStore((s) => s.startRecording);
  const stopRecording = useAppStore((s) => s.stopRecording);
  const openPalette = useNavStore((s) => s.openPalette);
  const listening = session.state === "listening";
  const preparing = session.state === "preparing";
  const elapsed = useElapsed(listening);

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
    return lastError ?? "";
  })();
  const isError =
    modelStatus?.state === "error" ||
    session.state === "error" ||
    lastError === "consent_required" ||
    (lastError !== null && !lastError.includes("model_downloading"));

  return (
    <header className="glass flex h-14 shrink-0 items-center gap-3 border-t-0 px-4">
      <img
        src={wordmark}
        alt="conva"
        className="h-[15px] w-auto opacity-90"
        draggable={false}
      />
      <span className="h-5 w-px bg-border" />

      {isTauri() && <MeterCluster />}

      <span
        className={`min-w-0 flex-1 truncate text-xs ${isError ? "text-rec" : "text-fg-muted"}`}
        role="status"
        aria-live="polite"
      >
        {statusText}
      </span>

      {isTauri() && (
        <div className="flex items-center gap-2">
          <IconBtn label="Command palette — ⌘K" onClick={openPalette}>
            <Icon name="search" size={16} />
          </IconBtn>
          <IconBtn
            label="Compact — pin a small strip on top of your call"
            onClick={() => void toggleCompact()}
            pressed={compact}
          >
            <Icon name="compact" size={16} />
          </IconBtn>

          <div className="ml-1 flex items-center gap-2 border-l border-border pl-3">
            <button
              type="button"
              disabled={!listening}
              onClick={() =>
                void (recording ? stopRecording() : startRecording())
              }
              aria-pressed={recording}
              title={
                !listening
                  ? "Start listening first to record"
                  : recording
                    ? "Stop recording"
                    : "Record the call (stereo WAV: you left, them right)"
              }
              className={[
                "flex h-[34px] items-center gap-2 rounded-[10px] border px-3 text-xs font-semibold transition disabled:opacity-40",
                recording
                  ? "border-rec/50 bg-rec/10 text-rec"
                  : "border-border bg-white/[0.035] text-fg-muted hover:text-fg",
              ].join(" ")}
            >
              <span
                className={`h-2 w-2 rounded-full bg-rec ${recording ? "animate-pulse" : "opacity-70"}`}
                aria-hidden
              />
              {recording ? "Recording" : "Record"}
            </button>

            <button
              type="button"
              disabled={busy || preparing}
              onClick={() => void (listening ? stop() : start())}
              title={listening ? "Stop listening" : "Start listening"}
              className="flex h-[34px] items-center gap-2 rounded-[10px] border border-border-strong bg-panel-raised px-3.5 text-xs font-bold text-fg transition hover:brightness-110 disabled:opacity-50"
            >
              {listening ? (
                <>
                  <span
                    className="h-[7px] w-[7px] animate-pulse rounded-full bg-ok"
                    aria-hidden
                  />
                  Listening
                  <span className="font-mono text-[11px] font-bold text-fg-muted">
                    {elapsed}
                  </span>
                </>
              ) : (
                <>
                  <Icon name="live" size={15} className="text-inbound" />
                  {preparing ? "Preparing…" : "Start listening"}
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </header>
  );
}

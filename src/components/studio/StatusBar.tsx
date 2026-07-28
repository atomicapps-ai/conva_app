import { isTauri } from "@/lib/ipc";
import { useAppStore } from "@/state/app";
import { useConversationStore } from "@/state/conversation";

/**
 * Thin ambient status strip (~26px) along the window foot. Read-only signals
 * that don't belong in the top action bar: the privacy posture, the speech
 * engine, and autosave state. Latency HUD and, later, credits/account surface
 * here too as those land (kept out until they carry real values).
 */
function Sep() {
  return <span className="h-3 w-px bg-border" aria-hidden />;
}

export function StatusBar() {
  const config = useAppStore((s) => s.config);
  const title = useConversationStore((s) => s.title);
  const cloud = config?.asr_engine === "deepgram_cloud";

  return (
    <footer
      className="glass flex h-[26px] shrink-0 items-center gap-3 border-b-0 px-4 text-[11px] text-fg-faint"
      aria-label="Status"
    >
      <span className="flex items-center gap-1.5 text-ok" title="Audio and transcripts stay on this device">
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
        >
          <rect x="5" y="11" width="14" height="9" rx="2" />
          <path d="M8 11V8a4 4 0 0 1 8 0v3" />
        </svg>
        On-device · Private
      </span>

      {config && (
        <>
          <Sep />
          <span className="flex items-center gap-1.5">
            <span
              className={`h-1.5 w-1.5 rounded-full ${cloud ? "bg-ai" : "bg-ok"}`}
            />
            {cloud ? "Cloud · Deepgram" : "Local · whisper"}
          </span>
        </>
      )}

      {title && (
        <>
          <Sep />
          <span className="min-w-0 max-w-[20rem] truncate">Saved · {title}</span>
        </>
      )}

      {/* Right side reserved for the latency HUD + credits/account once wired. */}
      <span className="ml-auto" />
      {!isTauri() && <span className="text-fg-faint">preview</span>}
    </footer>
  );
}

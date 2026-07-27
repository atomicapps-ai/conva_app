import { useEffect } from "react";

import { AssistDock } from "@/components/AssistDock";
import { ConsentGate } from "@/components/ConsentGate";
import { ConversationsPanel } from "@/components/ConversationsPanel";
import { HealthStrip } from "@/components/HealthStrip";
import { PreparingOverlay } from "@/components/PreparingOverlay";
import { RagPanel } from "@/components/RagPanel";
import { SaveConversationDialog } from "@/components/SaveConversationDialog";
import { SessionsPanel } from "@/components/SessionsPanel";
import { SettingsPanel } from "@/components/SettingsPanel";
import { CommandPalette } from "@/components/studio/CommandPalette";
import { NavRail } from "@/components/studio/NavRail";
import { TopBar } from "@/components/studio/TopBar";
import { TrackerRail } from "@/components/TrackerRail";
import { TranscriptView } from "@/components/transcript/TranscriptView";
import { UpdateBanner } from "@/components/UpdateBanner";
import { useNavStore } from "@/state/nav";

/** The live cockpit: dual-column transcript + tracker rail, assist dock, meters. */
function LiveView() {
  return (
    <div className="flex h-full flex-col">
      <div className="flex min-h-0 flex-1">
        <TranscriptView />
        <TrackerRail />
      </div>
      <AssistDock />
      <HealthStrip />
    </div>
  );
}

/**
 * The Studio shell (UI overhaul M2). One instrument: a left NavRail selecting
 * the active view, a curved TopBar carrying the Core + Start/Stop control, and
 * a routed content area. The former dropdown panels (Settings/Library/Sessions/
 * Conversations) are now first-class views; ⌘K opens the command palette from
 * anywhere. Replaces the old StatusBar + inline-panel App layout.
 */
export function StudioShell() {
  const view = useNavStore((s) => s.view);
  const setView = useNavStore((s) => s.setView);
  const togglePalette = useNavStore((s) => s.togglePalette);
  const backToLive = () => setView("live");

  // Global ⌘K / Ctrl+K → command palette.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        togglePalette();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePalette]);

  return (
    <div className="flex h-full flex-col">
      <UpdateBanner />
      <div className="flex min-h-0 flex-1 gap-1 p-1">
        <NavRail />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <TopBar />
          <main className="min-h-0 flex-1 overflow-hidden">
            {view === "live" && <LiveView />}
            {view === "settings" && <SettingsPanel onClose={backToLive} />}
            {view === "library" && <RagPanel onClose={backToLive} />}
            {view === "sessions" && <SessionsPanel onClose={backToLive} />}
            {view === "conversations" && (
              <ConversationsPanel onClose={backToLive} />
            )}
          </main>
        </div>
      </div>

      {/* Overlays — render above any view. */}
      <ConsentGate />
      <PreparingOverlay />
      <SaveConversationDialog />
      <CommandPalette />
    </div>
  );
}

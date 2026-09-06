import { AboutMoreView } from "@/components/about/AboutMoreView";
import { CoachingView } from "@/components/coaching/CoachingView";
import { ConversationsPanel } from "@/components/ConversationsPanel";
import { ContextsView } from "@/components/contexts/ContextsView";
import { DashboardView } from "@/components/dashboard/DashboardView";
import { LibraryView } from "@/components/library/LibraryView";
import { FeaturesView } from "@/components/product/FeaturesView";
import { WhatsComingView } from "@/components/product/WhatsComingView";
import { WhatsNewView } from "@/components/product/WhatsNewView";
import { ProfileView } from "@/components/profile/ProfileView";
import { SettingsPanel } from "@/components/SettingsPanel";
import { TranscriptView } from "@/components/transcript/TranscriptView";
import { useNavStore } from "@/state/nav";

/**
 * Renders the body of the active view. Shared by BOTH shells — the desktop
 * StudioShell (rail/cockpit) and the web WebShell (top nav) wrap the SAME view
 * bodies, so a new view is added here once and appears on both platforms. Only
 * the surrounding chrome differs per platform.
 */
export function ViewRouter() {
  const view = useNavStore((s) => s.view);
  const setView = useNavStore((s) => s.setView);
  // Conversations is a sub-view of Home now (AppUI V5.0 decision 2), so its
  // back control returns there — `railState.activeRailView` agrees.
  const backToHome = () => setView("dashboard");

  return (
    <>
      {view === "dashboard" && <DashboardView />}
      {view === "live" && <TranscriptView />}
      {view === "features" && <FeaturesView />}
      {view === "whatsnew" && <WhatsComingView />}
      {view === "releases" && <WhatsNewView />}
      {view === "settings" && <SettingsPanel />}
      {view === "profile" && <ProfileView />}
      {view === "conversations" && <ConversationsPanel onClose={backToHome} />}
      {view === "context" && <ContextsView />}
      {view === "library" && <LibraryView />}
      {view === "coaching" && <CoachingView />}
      {view === "about" && <AboutMoreView />}
    </>
  );
}

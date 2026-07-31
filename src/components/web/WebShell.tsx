import { useEffect } from "react";

import { HealthStrip } from "@/components/HealthStrip";
import { ViewRouter } from "@/components/studio/ViewRouter";
import { GateView, useAccessGate } from "@/components/web/GateView";
import { WebTopNav } from "@/components/web/WebTopNav";
import { useNavStore } from "@/state/nav";

/**
 * The WEB shell (web-only): a top navigation bar over a scrollable content
 * area. The desktop cockpit (StudioShell: left rail, meters, compact mode) is a
 * separate shell — both render the SAME view bodies via ViewRouter, so web and
 * desktop share content while each owns its chrome. This is where the web
 * experience is free to diverge without touching desktop.
 */
export function WebShell() {
  const togglePalette = useNavStore((s) => s.togglePalette);
  // Beta allowlist: signed in without access → the gate replaces the product.
  const gated = useAccessGate();

  // ⌘K / Ctrl+K → command palette (shared affordance).
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
    <div className="flex h-full flex-col bg-bg">
      {/* App nav (icons) — the website header sits ABOVE this (in the host page). */}
      <WebTopNav />
      <main className="min-h-0 flex-1 overflow-y-auto">
        {gated ? <GateView /> : <ViewRouter />}
      </main>
      {/* Bottom app bar: mic/system meters + engine/latency (features, not auth). */}
      {!gated && <HealthStrip />}
    </div>
  );
}

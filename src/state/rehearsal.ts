import { create } from "zustand";

import type { RehearsalStateEvent } from "@/lib/ipc";

/** UI-side state for a live Context rehearsal: whether one is running, who the
 *  counterparty is, and the current phase (drives the speaking indicator). The
 *  phase is fed by `conva://rehearsal-state` events via the IPC bridge. */
export type RehearsalPhase = RehearsalStateEvent["phase"];

interface RehearsalState {
  active: boolean;
  personaTitle: string | null;
  phase: RehearsalPhase;
  /** False when no Deepgram key is configured (Aura TTS reuses it) — the
   *  rehearsal still runs, but text-only. Drives the "voice unavailable"
   *  notice in `RehearsalBar` instead of leaving the user wondering why the
   *  persona never speaks (owner, 2026-09-15). */
  voiceEnabled: boolean;
  /** Called when the user launches a rehearsal (before events arrive). */
  begin: (personaTitle: string, voiceEnabled: boolean) => void;
  /** Called when the user ends it locally. */
  end: () => void;
  applyPhase: (event: RehearsalStateEvent) => void;
}

export const useRehearsalStore = create<RehearsalState>((set) => ({
  active: false,
  personaTitle: null,
  phase: "thinking",
  voiceEnabled: true,

  begin: (personaTitle, voiceEnabled) =>
    set({ active: true, personaTitle, phase: "thinking", voiceEnabled }),
  end: () => set({ active: false, phase: "ended" }),
  applyPhase: (event) =>
    set(() =>
      event.phase === "ended"
        ? { active: false, phase: "ended" }
        : { phase: event.phase },
    ),
}));

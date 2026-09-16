import { create } from "zustand";

import type { RehearsalStateEvent } from "@/lib/ipc";

/** UI-side state for a live Context rehearsal: whether one is running, who the
 *  counterparty is, and the current phase (drives the speaking indicator). The
 *  phase is fed by `conva://rehearsal-state` events via the IPC bridge.
 *  "speech_failed" is a transient notice, not a durable phase — it never
 *  lands in `phase` (see `speechError` instead). */
export type RehearsalPhase = Exclude<RehearsalStateEvent["phase"], "speech_failed">;

interface RehearsalState {
  active: boolean;
  personaTitle: string | null;
  phase: RehearsalPhase;
  /** False when no Deepgram key is configured (Aura TTS reuses it) — the
   *  rehearsal still runs, but text-only. Drives the "voice unavailable"
   *  notice in `RehearsalBar` instead of leaving the user wondering why the
   *  persona never speaks (owner, 2026-09-15). */
  voiceEnabled: boolean;
  /** Last "Aura TTS failed to speak this reply" reason, or null. Set when a
   *  `speech_failed` event arrives, cleared by `dismissSpeechError` or the
   *  next `begin`/`end`. The reply's text is already in the transcript —
   *  this only explains why nothing was heard. */
  speechError: string | null;
  /** Called when the user launches a rehearsal (before events arrive). */
  begin: (personaTitle: string, voiceEnabled: boolean) => void;
  /** Called when the user ends it locally. */
  end: () => void;
  applyPhase: (event: RehearsalStateEvent) => void;
  dismissSpeechError: () => void;
}

export const useRehearsalStore = create<RehearsalState>((set) => ({
  active: false,
  personaTitle: null,
  phase: "thinking",
  voiceEnabled: true,
  speechError: null,

  begin: (personaTitle, voiceEnabled) =>
    set({ active: true, personaTitle, phase: "thinking", voiceEnabled, speechError: null }),
  end: () => set({ active: false, phase: "ended" }),
  applyPhase: (event) =>
    set(() =>
      event.phase === "ended"
        ? { active: false, phase: "ended" }
        : event.phase === "speech_failed"
          ? { speechError: event.error }
          : { phase: event.phase },
    ),
  dismissSpeechError: () => set({ speechError: null }),
}));

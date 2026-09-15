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
  /** Last "Aura TTS failed to speak this reply" reason, or null. Set when a
   *  `speech_failed` event arrives, cleared by `dismissSpeechError` or the
   *  next `begin`/`end`. The reply's text is already in the transcript —
   *  this only explains why nothing was heard. */
  speechError: string | null;
  /** Called when the user launches a rehearsal (before events arrive). */
  begin: (personaTitle: string) => void;
  /** Called when the user ends it locally. */
  end: () => void;
  applyPhase: (event: RehearsalStateEvent) => void;
  dismissSpeechError: () => void;
}

export const useRehearsalStore = create<RehearsalState>((set) => ({
  active: false,
  personaTitle: null,
  phase: "thinking",
  speechError: null,

  begin: (personaTitle) =>
    set({ active: true, personaTitle, phase: "thinking", speechError: null }),
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

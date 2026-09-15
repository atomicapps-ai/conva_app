import { create } from "zustand";

import { getBackend } from "@/lib/backend";
import {
  DEFAULT_CONTEXT_ID,
  isTauri,
  type AppConfig,
  type AudioDevice,
  type ModelStatusEvent,
  type ProviderId,
  type ProviderInfo,
} from "@/lib/ipc";
import { useGroundingStore } from "@/state/grounding";

interface AppState {
  config: AppConfig | null;
  devices: AudioDevice[];
  busy: boolean;
  lastError: string | null;
  modelStatus: ModelStatusEvent | null;
  setModelStatus: (status: ModelStatusEvent) => void;
  registry: ProviderInfo[];
  keyStatus: Partial<Record<ProviderId, boolean>>;
  refreshKeyStatus: () => Promise<void>;
  /** Compact mode (U9): narrow always-on-top strip beside a call window. */
  compact: boolean;
  toggleCompact: () => Promise<void>;
  /** Call recording (stereo WAV: you = left, them = right). */
  recording: boolean;
  recordingPath: string | null;
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<void>;

  init: () => Promise<void>;
  /** Re-enumerate audio devices (e.g. after plugging one in). */
  refreshDevices: () => Promise<void>;
  updateConfig: (patch: Partial<AppConfig>) => Promise<void>;
  acknowledgeConsent: () => Promise<void>;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  /** Mic/loopback devices stay open; nothing is transcribed or recorded
   *  while paused, so resume is instant. No-op if no session is active. */
  pause: () => Promise<void>;
  resume: () => Promise<void>;
}

export const useAppStore = create<AppState>((set, get) => ({
  config: null,
  devices: [],
  busy: false,
  lastError: null,
  modelStatus: null,
  setModelStatus: (status) => {
    // A finished download clears the "model_downloading" start error.
    set((s) => ({
      modelStatus: status,
      lastError:
        status.state === "ready" &&
        s.lastError?.includes("model_downloading")
          ? null
          : s.lastError,
    }));
  },

  registry: [],
  keyStatus: {},
  recording: false,
  recordingPath: null,
  startRecording: async () => {
    try {
      const path = await getBackend().recording.start();
      set({ recording: true, recordingPath: path });
    } catch (e) {
      set({ lastError: String(e) });
    }
  },
  stopRecording: async () => {
    try {
      const path = await getBackend().recording.stop();
      set({ recording: false, recordingPath: path });
    } catch (e) {
      set({ recording: false, lastError: String(e) });
    }
  },
  compact: false,
  toggleCompact: async () => {
    const next = !get().compact;
    set({ compact: next });
    try {
      const { applyCompact } = await import("@/lib/compact");
      await applyCompact(next);
    } catch (e) {
      set({ compact: !next, lastError: String(e) });
    }
  },
  refreshKeyStatus: async () => {
    const statuses = await getBackend().providers.keyStatus();
    set({
      keyStatus: Object.fromEntries(statuses.map((s) => [s.id, s.has_key])),
    });
  },

  init: async () => {
    if (!isTauri()) return;
    try {
      const backend = getBackend();
      const [config, devices, registry, keys, recording] = await Promise.all([
        backend.config.get(),
        backend.audio.listDevices(),
        backend.providers.registry(),
        backend.providers.keyStatus(),
        backend.recording.status(),
      ]);
      set({
        config,
        devices,
        registry,
        keyStatus: Object.fromEntries(keys.map((s) => [s.id, s.has_key])),
        recording,
      });
    } catch (e) {
      set({ lastError: String(e) });
    }
  },

  refreshDevices: async () => {
    if (!isTauri()) return;
    try {
      set({ devices: await getBackend().audio.listDevices() });
    } catch (e) {
      set({ lastError: String(e) });
    }
  },

  updateConfig: async (patch) => {
    const current = get().config;
    if (!current) return;
    const next = { ...current, ...patch };
    set({ config: next });
    try {
      await getBackend().config.save(next);
    } catch (e) {
      set({ config: current, lastError: String(e) });
    }
  },

  acknowledgeConsent: async () => {
    await get().updateConfig({ consent_acknowledged: true });
  },

  start: async () => {
    set({ busy: true, lastError: null });
    try {
      await getBackend().session.start();
    } catch (e) {
      set({ lastError: String(e) });
    } finally {
      set({ busy: false });
    }
  },

  // Stop is a plain stop (owner, 2026-09-15) — like a hard pause, not a
  // decision point. It used to always pop the save/discard dialog when
  // anything was transcribed; now the transcript just stays on screen,
  // undecided, and the control bar's persistent Save action (next to End)
  // is the explicit way to keep it. Nothing is silently lost either way:
  // the raw run persists on-device in Sessions regardless, and starting a
  // genuinely NEW conversation ("+ New") still asks what to do with unsaved
  // content first (`requestNew`) — this only removes the forced prompt on
  // every Stop.
  stop: async () => {
    set({ busy: true });
    try {
      await getBackend().session.stop();
      // Session grounding is required — never leave the app truly ungrounded.
      // stop_session clears the backend's active-context scope; fall back to
      // the always-present default rather than a bare "nothing active", so a
      // *different* next call never silently inherits a stale, specific
      // context (e.g. still grounded on "Acme interview").
      try {
        const session = await getBackend().context.activateContext(DEFAULT_CONTEXT_ID);
        useGroundingStore.getState().setActive(session.id, session.title);
      } catch {
        useGroundingStore.getState().clear();
      }
    } catch (e) {
      set({ lastError: String(e) });
    } finally {
      // The session stop finalizes any recording backend-side.
      set({ busy: false, recording: false });
    }
  },

  pause: async () => {
    set({ busy: true });
    try {
      await getBackend().session.pause();
    } catch (e) {
      set({ lastError: String(e) });
    } finally {
      set({ busy: false });
    }
  },

  resume: async () => {
    set({ busy: true });
    try {
      await getBackend().session.resume();
    } catch (e) {
      set({ lastError: String(e) });
    } finally {
      set({ busy: false });
    }
  },
}));

/**
 * Capability descriptor — the heart of the platform abstraction.
 *
 * Shared UI components branch on CAPABILITIES, never on `isTauri`. A capability
 * that is `false`/`"none"`/`"unavailable"` renders the honest degraded state
 * (and, on web, doubles as the "get the desktop app" funnel). Resolved exactly
 * once at bootstrap by the active {@link ConvaBackend}.
 *
 * Canonical model: `conva_core/docs/technical/CONVA_ARCHITECTURE.md` (§3) and
 * `CONVA_SDLC_RELEASE_STRATEGY.md` §1.2 — keep this shape in sync with them.
 */

export type SystemAudioMode = "loopback" | "tab-share" | "none";
export type GpuBackend = "vulkan" | "cuda" | "metal" | "cpu" | null;
export type IncogState = "supported" | "unsupported" | "unavailable";

export interface Capabilities {
  /** Audio capture. Layer 4 on desktop; mic-only + best-effort tab-share on web. */
  capture: {
    mic: boolean;
    /** "loopback" = hear the other party (desktop/WASAPI); "tab-share" = getDisplayMedia (web, best-effort); "none" = unavailable. */
    systemAudio: SystemAudioMode;
  };
  /** Speech recognition. Local whisper is desktop-only; web is hosted-only. */
  asr: {
    local: boolean;
    gpuBackend: GpuBackend;
    hosted: boolean;
  };
  /** Retrieval. Local vault is desktop; cloud (pgvector) is the web/opt-in path. */
  rag: {
    local: boolean;
    cloud: boolean;
  };
  /** Language model access. BYO keys need the OS keyring (desktop only). */
  llm: {
    byoKeys: boolean;
    hosted: boolean;
    localOllama: boolean;
  };
  /** Overlays. All Layer 4 — desktop only. */
  overlay: {
    hud: boolean;
    incog: IncogState;
  };
  /** OS integration. All Layer 4 — desktop only. */
  system: {
    tray: boolean;
    globalHotkeys: boolean;
    keyring: boolean;
    updater: boolean;
    deepLink: boolean;
  };
}

/**
 * Desktop defaults. NOTE: this is the static bootstrap descriptor; a future
 * `capabilities()` implementation should refine the dynamic fields from the
 * shell — `gpuBackend` from the `[asr] whisper backend` probe, `systemAudio`
 * from the OS (WASAPI loopback is Windows-only; macOS degrades to "none" until
 * the ScreenCaptureKit tap lands), and `overlay.incog` from `incog_status()`
 * (Win < 19041 / Linux → "unsupported"; not-yet-built → "unavailable").
 */
export const DESKTOP_CAPABILITIES: Capabilities = {
  capture: { mic: true, systemAudio: "loopback" },
  asr: { local: true, gpuBackend: "cpu", hosted: false },
  rag: { local: true, cloud: false },
  llm: { byoKeys: true, hosted: false, localOllama: true },
  overlay: { hud: true, incog: "unavailable" },
  system: {
    tray: true,
    globalHotkeys: true,
    keyring: true,
    updater: true,
    deepLink: true,
  },
};

/**
 * Web ("conva Lite") defaults. Layer 4 is entirely absent; content runs through
 * the hosted-inference proxy (Layer 1). Incog is impossible in a tab — not a
 * lock, an honest-limits state.
 */
export const WEB_CAPABILITIES: Capabilities = {
  capture: { mic: true, systemAudio: "none" },
  asr: { local: false, gpuBackend: null, hosted: true },
  rag: { local: false, cloud: true },
  llm: { byoKeys: false, hosted: true, localOllama: false },
  overlay: { hud: false, incog: "unavailable" },
  system: {
    tray: false,
    globalHotkeys: false,
    keyring: false,
    updater: false,
    deepLink: false,
  },
};

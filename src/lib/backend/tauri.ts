/**
 * Desktop adapter — binds {@link ConvaBackend} to the Rust shell via the
 * existing typed command wrappers (`@/lib/commands`) and `conva://*` events.
 *
 * This is a thin, 1:1 delegation: it re-exposes today's shell surface behind the
 * PAL so components can migrate off `commands.ts` onto `getBackend()` without any
 * behavior change. No new behavior lives here.
 */

import { listen } from "@tauri-apps/api/event";

import * as cmd from "@/lib/commands";
import {
  DESKTOP_CAPABILITIES,
  type Capabilities,
} from "@/lib/backend/capabilities";
import {
  desktopSnapshot,
  probeRuntime,
  type CapabilitySnapshot,
  type RuntimeProbe,
} from "@/lib/backend/capabilitySnapshot";
import type { ConvaBackend } from "@/lib/backend/ConvaBackend";
import type { CaptureSourceCapability, CaptureSourceKind } from "@/lib/capture/contract";
import type { CapturePrepare, CaptureStatus } from "@/lib/capture/pal";
import { EVENT_CHANNEL, type EventMap, type Unsubscribe } from "@/lib/backend/events";
import {
  createCapabilityStore,
  type CapabilityReader,
  type CapabilityStore,
} from "@/lib/capture/capabilityStore";
import type { TranscriptEvent } from "@/lib/capture/contract";
import { LegacyEnvelopeAdapter } from "@/lib/capture/legacy";
import type { SessionStateEvent, TranscriptSegment } from "@/lib/ipc";

/** Session id used for segments that arrive before a `listening` state. */
export const DESKTOP_UNKNOWN_SESSION = "desktop:unknown-session";

/** A PAL operation the desktop shell does not offer yet (per-source capture
 *  control). Rejecting keeps the UI honest — the capability table already says
 *  `unimplemented` for these. */
export class UnimplementedOnDesktopError extends Error {
  constructor(operation: string) {
    super(`"${operation}" is not implemented on desktop yet.`);
    this.name = "UnimplementedOnDesktopError";
  }
}

export class TauriBackend implements ConvaBackend {
  private readonly store: CapabilityStore<CapabilitySnapshot>;

  /** `probe` is injectable for tests; defaults to the live runtime. */
  constructor(probe: RuntimeProbe = probeRuntime()) {
    // The legacy descriptor is the SAME static object as before — behavior
    // unchanged. The snapshot adds the per-source/per-operation truth around
    // it (WASAPI loopback honest per OS). TODO(M1+): refine dynamic fields
    // from the shell — gpuBackend from the whisper-backend probe, overlay.incog
    // from incog_status() once that command exists — and publish revisions.
    this.store = createCapabilityStore(desktopSnapshot(DESKTOP_CAPABILITIES, probe));
  }

  get capabilityStore(): CapabilityReader<CapabilitySnapshot> {
    return this.store;
  }

  async capabilities(): Promise<Capabilities> {
    return this.store.snapshot().legacy;
  }

  async subscribe<K extends keyof EventMap>(
    event: K,
    handler: (payload: EventMap[K]) => void,
  ): Promise<Unsubscribe> {
    return listen<EventMap[K]>(EVENT_CHANNEL[event], (e) => handler(e.payload));
  }

  /**
   * Lifts the shell's legacy `transcriptSegment` stream into versioned
   * envelopes. The session id comes from the `sessionState` stream (each
   * `listening` starts a fresh adapter: new session, epoch 0, per-source
   * seq from 0); segments seen before any `listening` fall under
   * {@link DESKTOP_UNKNOWN_SESSION}. Nothing here changes what the legacy
   * `subscribe("transcriptSegment")` path delivers.
   */
  async subscribeEnvelopes(handler: (event: TranscriptEvent) => void): Promise<Unsubscribe> {
    let adapter = new LegacyEnvelopeAdapter({ sessionId: DESKTOP_UNKNOWN_SESSION });
    const unlistenState = await listen<SessionStateEvent>(
      EVENT_CHANNEL.sessionState,
      (e) => {
        if (e.payload.state === "listening") {
          adapter = new LegacyEnvelopeAdapter({ sessionId: e.payload.session_id });
        }
      },
    );
    const unlistenSegment = await listen<TranscriptSegment>(
      EVENT_CHANNEL.transcriptSegment,
      (e) => handler(adapter.lift(e.payload)),
    );
    return () => {
      unlistenState();
      unlistenSegment();
    };
  }

  config = {
    get: cmd.getConfig,
    save: cmd.saveConfig,
    export: cmd.exportConfig,
    import: cmd.importConfig,
  };

  providers = {
    registry: cmd.getProviderRegistry,
    setKey: cmd.setApiKey,
    keyStatus: cmd.providerKeyStatus,
    test: cmd.testProvider,
    listModels: cmd.listProviderModels,
  };

  ally = {
    run: cmd.ally,
  };

  audio = {
    listDevices: cmd.listAudioDevices,
    listWhisperModels: cmd.listWhisperModels,
    setDeepgramKey: cmd.setDeepgramKey,
    deepgramKeyStatus: cmd.deepgramKeyStatus,
  };

  session = {
    start: cmd.startSession,
    stop: cmd.stopSession,
  };

  /** Desktop starts mic + system audio together on `session.start()`; there is
   *  no per-source shell command yet, so the honest answer is "unimplemented"
   *  (capabilitySnapshot.ts marks these the same way) — never a silent no-op. */
  capture = {
    enumerateSources: (): Promise<CaptureSourceCapability[]> => Promise.resolve(this.store.snapshot().sources),
    prepare: (kind: CaptureSourceKind): Promise<CapturePrepare> => {
      const src = this.store.snapshot().sources.find((x) => x.kind === kind);
      return Promise.resolve({
        kind,
        channel: src?.channels[0] ?? (kind === "mic" ? "self" : "remote_mix"),
        availability: src?.availability ?? { state: "unsupported", reason: `Unknown source kind ${kind}.` },
        requires_user_gesture: false,
        notice: "Desktop captures your microphone and the system audio together when you press Start.",
      });
    },
    start: (kind: CaptureSourceKind): Promise<string> => Promise.reject(new UnimplementedOnDesktopError(`capture.start(${kind})`)),
    stop: (sourceId: string): Promise<void> => Promise.reject(new UnimplementedOnDesktopError(`capture.stop(${sourceId})`)),
    recover: (sourceId: string): Promise<string> => Promise.reject(new UnimplementedOnDesktopError(`capture.recover(${sourceId})`)),
    status: (): Promise<CaptureStatus[]> => Promise.reject(new UnimplementedOnDesktopError("capture.status")),
    subscribe: (): Promise<Unsubscribe> => Promise.reject(new UnimplementedOnDesktopError("capture.subscribe")),
  };

  recording = {
    start: cmd.startRecording,
    stop: cmd.stopRecording,
    status: cmd.recordingStatus,
  };

  rag = {
    ingest: cmd.ragIngest,
    ingestText: cmd.ragIngestText,
    list: cmd.ragList,
    setEnabled: cmd.ragSetEnabled,
    delete: cmd.ragDelete,
    attachContext: cmd.ragAttachContext,
    detachContext: cmd.ragDetachContext,
    download: cmd.ragDownload,
    syncLibrary: cmd.ragSyncLibrary,
    analyzeTerms: cmd.analyzeTerms,
    recordHighlightFeedback: cmd.recordHighlightFeedback,
    recordTermPick: cmd.recordTermPick,
    documentText: cmd.ragDocumentText,
  };

  secrets = {
    status: cmd.secretsStatus,
    export: cmd.secretsExport,
    import: cmd.secretsImport,
  };

  auth = {
    start: cmd.authStart,
    cancel: cmd.authCancel,
    signinPassword: cmd.authSigninPassword,
    signupPassword: cmd.authSignupPassword,
    status: cmd.authStatus,
    signout: cmd.authSignout,
    openUrl: cmd.openUrl,
  };

  conversations = {
    save: cmd.conversationSave,
    list: cmd.conversationList,
    load: cmd.conversationLoad,
    delete: cmd.conversationDelete,
  };

  context = {
    save: cmd.contextSave,
    list: cmd.contextList,
    load: cmd.contextLoad,
    delete: cmd.contextDelete,
    activateContext: cmd.activateContext,
    deactivateContext: cmd.deactivateContext,
    storeDocs: cmd.contextStoreDocs,
    prepare: cmd.contextPrepare,
    loadProfile: cmd.contextLoadProfile,
    generateDossier: cmd.contextGenerateDossier,
    generatePersonas: cmd.contextGeneratePersonas,
    choosePersona: cmd.contextChoosePersona,
    startRehearsal: cmd.contextStartRehearsal,
    rehearsalYourTurn: cmd.contextRehearsalYourTurn,
    rehearsalSay: cmd.contextRehearsalSay,
    setResearchKey: cmd.setTavilyKey,
    researchKeyStatus: cmd.tavilyKeyStatus,
  };

  usage = {
    summary: cmd.usageSummary,
    reset: cmd.usageReset,
  };

  sessions = {
    list: cmd.sessionList,
    load: cmd.sessionLoad,
    delete: cmd.sessionDelete,
    exportTranscript: cmd.exportTranscript,
    analyzeConversation: cmd.analyzeConversation,
    writeTextFile: cmd.writeTextFile,
  };

  diagnostics = {
    saveDebugLog: cmd.saveDebugLog,
    trace: cmd.screenshotTrace,
  };

  screenshot = {
    save: cmd.saveScreenshot,
    dir: cmd.screenshotsDir,
    openFolder: cmd.openScreenshotsFolder,
  };

  hud = {
    open: cmd.openHud,
    close: cmd.closeHud,
    toggle: cmd.toggleHud,
    isOpen: cmd.hudIsOpen,
  };

  partner = {
    open: cmd.openPartner,
    close: cmd.closePartner,
    redock: cmd.redockPartner,
    payload: cmd.getPartnerPayload,
    setLocked: cmd.setPartnerLocked,
    locked: cmd.getPartnerLocked,
  };
}

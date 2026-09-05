/**
 * Web adapter — SKELETON. Implements {@link ConvaBackend} for "conva Lite" in a
 * browser tab. Layers 1–3 route to `api.conva.app/v1` + the hosted-inference
 * proxy + `getUserMedia`; Layer 4 (loopback, local ASR, keyring, HUD, recording,
 * secrets, file-path I/O) is unsupported and the UI renders the honest degraded
 * state via `capabilities()`.
 *
 * This is the SPEC, not the implementation: methods are stubbed to make the
 * contract explicit and typecheck. `unsupported()` = Layer-4, never coming to
 * web; `todo()` = Layer 1–3, to be wired to the named endpoint (roadmap 1.3/1.4).
 * Nothing here should silently pretend to work.
 */

import {
  WEB_CAPABILITIES,
  type Capabilities,
} from "@/lib/backend/capabilities";
import {
  probeRuntime,
  webSnapshot,
  type CapabilitySnapshot,
  type RuntimeProbe,
} from "@/lib/backend/capabilitySnapshot";
import type { ConvaBackend } from "@/lib/backend/ConvaBackend";
import type { EventMap, Unsubscribe } from "@/lib/backend/events";
import * as webAuth from "@/lib/backend/webAuth";
import {
  createCapabilityStore,
  type CapabilityReader,
  type CapabilityStore,
} from "@/lib/capture/capabilityStore";
import { AVAILABLE, unavailable, type TranscriptEvent } from "@/lib/capture/contract";
import { startAudioGraph } from "@/lib/audio/audioGraph";
import { fetchLiveStatus } from "@/lib/live/liveStatus";
import { LiveSessionRunner, browserMedia } from "@/lib/live/runner";
import type { CapturePrepare, CaptureStatus } from "@/lib/capture/pal";
import type { CaptureSourceCapability, CaptureSourceKind } from "@/lib/capture/contract";
import type { SocketLike } from "@/lib/live/liveClient";
import type {
  AppConfig,
  AudioDevice,
  AuthStatus,
  Conversation,
  ConversationSummary,
  KnowledgeProfile,
  ConversationContext,
  ContextSummary,
  IngestReport,
  ModelInfo,
  ProviderInfo,
  ProviderKeyStatus,
  RagDocument,
  SecretsStatus,
  SessionSummary,
  TranscriptSegment,
  UsageSummary,
  WhisperModelInfo,
} from "@/lib/ipc";

/** Capability genuinely absent in a browser (Layer 4) — never coming to web. */
export class UnsupportedOnWebError extends Error {
  constructor(feature: string) {
    super(`"${feature}" is a desktop-only capability — not available on the web.`);
    this.name = "UnsupportedOnWebError";
  }
}

function unsupported<T>(feature: string): Promise<T> {
  return Promise.reject(new UnsupportedOnWebError(feature));
}

/**
 * Capability the browser COULD have but Conva hasn't built yet — distinct from
 * {@link UnsupportedOnWebError} on purpose (architecture §8: unsupported vs
 * unimplemented must stay visible). Matches `Availability.unimplemented`.
 */
export class UnimplementedOnWebError extends Error {
  constructor(feature: string) {
    super(`"${feature}" is not implemented on the web yet.`);
    this.name = "UnimplementedOnWebError";
  }
}

/** Layer 1–3 method not yet wired to the API. Roadmap 1.3 (proxy) / 1.4 (adapter). */
function todo<T>(endpoint: string): Promise<T> {
  return Promise.reject(
    new Error(`WebBackend not implemented yet — will call ${endpoint}`),
  );
}

type Handler<K extends keyof EventMap> = (payload: EventMap[K]) => void;

export class WebBackend implements ConvaBackend {
  private readonly store: CapabilityStore<CapabilitySnapshot>;
  /** In-page event bus for the browser-sourced events (sessionState, transcriptSegment, audioLevel). */
  private readonly handlers = new Map<keyof EventMap, Set<Handler<keyof EventMap>>>();
  private readonly envelopeHandlers = new Set<(e: TranscriptEvent) => void>();
  private readonly captureHandlers = new Set<(s: CaptureStatus[]) => void>();
  private runner: LiveSessionRunner | null = null;

  /** `probe` is injectable for tests; defaults to the live runtime. */
  constructor(probe: RuntimeProbe = probeRuntime()) {
    // `WEB_CAPABILITIES` (the legacy descriptor) is unchanged. The snapshot
    // around it tells the truth per operation: every `todo()` below is
    // `unimplemented`, every `unsupported()` is `unsupported`, and the
    // auth methods that really work are `available`. See `webOperations()`.
    this.store = createCapabilityStore(webSnapshot(WEB_CAPABILITIES, probe));
    // Auth is the one group that is really implemented on web — through the
    // same-origin session BFF. If the Worker reports that backend is NOT set
    // up (503), publish a revision that says so, so the UI shows "sign-in
    // unavailable: <reason>" instead of a button that can't work.
    // Live gateway probe → SOURCE availability. The browser may well be able to
    // capture a mic, but without a configured hosted gateway nothing can
    // transcribe it — so mic/display stay `unavailable` with the server's
    // reason until /api/live/status says configured. Never `available` early.
    void fetchLiveStatus().then((status) => {
      const snap = this.store.snapshot();
      const sources = snap.sources.map((src) => {
        if (src.kind !== "mic" && src.kind !== "display" && src.kind !== "tab") return src;
        if (src.availability.state === "unsupported") return src; // browser can't, regardless of server
        if (!status.configured) {
          return { ...src, availability: unavailable(status.reason ?? "Hosted live transcription is not configured on this deployment.") };
        }
        // Mic (session.start) and call-audio sharing (capture.start "display")
        // are both wired to the live gateway; `tab` is the same getDisplayMedia
        // chooser (the user picks a tab), so it shares display's availability.
        return { ...src, availability: AVAILABLE };
      });
      const ops = { ...snap.operations };
      const liveOps = ["session.start", "session.stop", "capture.start", "capture.stop"] as const;
      if (status.configured) {
        for (const op of liveOps) ops[op] = AVAILABLE;
      } else {
        const why = unavailable(status.reason ?? "Hosted live transcription is not configured on this deployment.");
        for (const op of liveOps) ops[op] = why;
      }
      this.store.update({ sources, operations: ops });
    });
    void webAuth.ready().then((info) => {
      if (info.configured) return;
      const reason = `Web sign-in backend not configured: ${info.reason ?? info.error ?? "unknown"}`;
      const unavailable = { state: "unavailable" as const, reason };
      const ops = this.store.snapshot().operations;
      this.store.update({
        operations: {
          ...ops,
          "auth.start": unavailable,
          "auth.signinPassword": unavailable,
          "auth.signupPassword": unavailable,
          "auth.signout": unavailable,
        },
      });
    });
  }

  get capabilityStore(): CapabilityReader<CapabilitySnapshot> {
    return this.store;
  }

  async capabilities(): Promise<Capabilities> {
    return this.store.snapshot().legacy;
  }

  /** Typed envelopes from the live gateway (already de-duplicated/ordered by
   *  the client's EventLedger). */
  subscribeEnvelopes(handler: (event: TranscriptEvent) => void): Promise<Unsubscribe> {
    this.envelopeHandlers.add(handler);
    return Promise.resolve(() => {
      this.envelopeHandlers.delete(handler);
    });
  }

  private emit<K extends keyof EventMap>(event: K, payload: EventMap[K]): void {
    const set = this.handlers.get(event);
    if (!set) return;
    for (const h of set) (h as Handler<K>)(payload);
  }

  private ensureRunner(): LiveSessionRunner {
    if (this.runner) return this.runner;
    this.runner = new LiveSessionRunner(
      {
        media: browserMedia(),
        startGraph: (stream, onBlock) => startAudioGraph(stream as unknown as MediaStream, onBlock),
        client: {
          fetch: (input, init) => fetch(input, init),
          // DOM WebSocket satisfies the structural SocketLike (binaryType/onmessage typings differ nominally).
          socket: (url) => new WebSocket(url) as unknown as SocketLike,
          clientBuild: typeof __GIT_SHA__ === "string" ? __GIT_SHA__ : "dev",
        },
      },
      {
        sessionState: (e) => this.emit("sessionState", e),
        transcriptSegment: (seg) => this.emit("transcriptSegment", seg),
        audioLevel: (e) => this.emit("audioLevel", e),
        transcriptEvent: (e) => {
          for (const h of this.envelopeHandlers) h(e);
        },
        captureStatus: (statuses) => {
          for (const h of this.captureHandlers) h(statuses);
        },
        notice: (code, message) => {
          if (import.meta.env?.DEV) console.info(`[live] ${code}: ${message}`);
        },
      },
    );
    return this.runner;
  }

  async subscribe<K extends keyof EventMap>(
    event: K,
    handler: (payload: EventMap[K]) => void,
  ): Promise<Unsubscribe> {
    // `authChanged` is live: sign-in/out in this tab, or the login page
    // completing in another same-origin tab (storage event), both fire it.
    if (event === "authChanged") {
      return webAuth.onAuthChanged((status) => {
        handler({ status, error: null } as EventMap[K]);
      });
    }
    // Browser-sourced live events come from the LiveSessionRunner (M2).
    if (event === "sessionState" || event === "transcriptSegment" || event === "audioLevel") {
      let set = this.handlers.get(event);
      if (!set) {
        set = new Set();
        this.handlers.set(event, set);
      }
      set.add(handler as Handler<keyof EventMap>);
      return () => {
        set?.delete(handler as Handler<keyof EventMap>);
      };
    }
    // Everything else (Ally streaming, radar, tracker, capture, rehearsal,
    // partner, splash) has no browser producer yet — capabilitySnapshot.ts
    // reports the matching operations `unimplemented`, so no UI control
    // depends on a subscription that would never fire.
    if (import.meta.env?.DEV) console.warn(`[web] subscribe("${event}") has no browser producer yet`);
    return () => {};
  }

  config = {
    get: (): Promise<AppConfig> => todo("GET /v1/settings"),
    save: (_config: AppConfig): Promise<void> => todo("PUT /v1/settings"),
    export: (_path: string): Promise<void> => unsupported("config.export"),
    import: (_path: string): Promise<AppConfig> => unsupported("config.import"),
  };

  providers = {
    registry: (): Promise<ProviderInfo[]> => todo("GET /v1/models"),
    setKey: (): Promise<void> => unsupported("providers.setKey (BYO keys)"),
    keyStatus: (): Promise<ProviderKeyStatus[]> => Promise.resolve([]),
    test: (): Promise<number> => unsupported("providers.test (BYO keys)"),
    listModels: (): Promise<ModelInfo[]> => todo("GET /v1/models"),
  };

  ally = {
    run: (): Promise<void> => todo("POST /v1/inference/complete (SSE)"),
  };

  audio = {
    listDevices: (): Promise<AudioDevice[]> =>
      todo("navigator.mediaDevices.enumerateDevices"),
    listWhisperModels: (): Promise<WhisperModelInfo[]> => Promise.resolve([]),
    setDeepgramKey: (): Promise<void> => unsupported("audio.setDeepgramKey"),
    deepgramKeyStatus: (): Promise<boolean> => Promise.resolve(false),
  };

  session = {
    // Explicit user Start: mic prompt → server session (ticket) → WebSocket →
    // AudioWorklet → PCM16 frames under credit → transcript envelopes. Refused
    // with a stable code (signed_out / not_entitled / unconfigured / denied…)
    // when any step can't proceed — never a silent no-op.
    start: (): Promise<string> =>
      this.ensureRunner().start({ processing_mode: "hosted", retention_mode: "ephemeral", context_id: null }),
    stop: (): Promise<void> => (this.runner ? this.runner.stop() : Promise.resolve()),
  };

  capture = {
    enumerateSources: (): Promise<CaptureSourceCapability[]> => Promise.resolve(this.store.snapshot().sources),
    prepare: (kind: CaptureSourceKind): Promise<CapturePrepare> => {
      const src = this.store.snapshot().sources.find((x) => x.kind === kind);
      const channel = src?.channels[0] ?? (kind === "mic" ? "self" : "remote_mix");
      const availability = src?.availability ?? { state: "unsupported" as const, reason: `Unknown source kind ${kind}.` };
      const notice =
        kind === "mic"
          ? "Your microphone is transcribed by conva's hosted service for this session only; audio is not stored."
          : "You choose a tab or screen and enable “share audio”; only that audio is transcribed (video is never sent). Recording rules for your participants still apply.";
      return Promise.resolve({ kind, channel, availability, requires_user_gesture: kind !== "mic", notice });
    },
    start: (kind: CaptureSourceKind, operationId: string): Promise<string> => {
      if (kind === "display" || kind === "tab") return this.ensureRunner().startShare(operationId);
      if (kind === "mic") return this.ensureRunner().start({ processing_mode: "hosted", retention_mode: "ephemeral", context_id: null });
      return Promise.reject(new UnimplementedOnWebError(`capture.start(${kind})`));
    },
    stop: (sourceId: string): Promise<void> => (this.runner ? this.runner.stopSource(sourceId) : Promise.resolve()),
    status: (): Promise<CaptureStatus[]> => Promise.resolve(this.runner ? this.runner.statuses() : []),
    subscribe: (handler: (s: CaptureStatus[]) => void): Promise<Unsubscribe> => {
      this.captureHandlers.add(handler);
      return Promise.resolve(() => {
        this.captureHandlers.delete(handler);
      });
    },
  };

  recording = {
    start: (): Promise<string> => unsupported("recording.start"),
    stop: (): Promise<string | null> => unsupported("recording.stop"),
    status: () => Promise.resolve(false),
  };

  rag = {
    ingest: (): Promise<IngestReport[]> => unsupported("rag.ingest (file paths)"),
    ingestText: (_name: string, _text: string): Promise<IngestReport> =>
      todo("POST /v1/library (server-side embeddings)"),
    list: (): Promise<RagDocument[]> => todo("GET /v1/library"),
    setEnabled: (): Promise<void> => todo("PATCH /v1/library/:id"),
    delete: (): Promise<void> => todo("DELETE /v1/library/:id"),
    attachContext: (): Promise<void> => todo("PATCH /v1/library/:id (context_ids)"),
    detachContext: (): Promise<void> => todo("PATCH /v1/library/:id (context_ids)"),
    download: (): Promise<void> => unsupported("rag.download (file path)"),
    syncLibrary: (): Promise<string> => unsupported("rag.syncLibrary (git)"),
    analyzeTerms: (): Promise<string[]> => Promise.resolve([]),
    recordHighlightFeedback: (): Promise<void> => Promise.resolve(),
    recordTermPick: (): Promise<void> => Promise.resolve(),
    documentText: (): Promise<string | null> => todo("GET /v1/library/:id/text"),
  };

  secrets = {
    status: (): Promise<SecretsStatus> => unsupported("secrets.status"),
    export: (): Promise<string> => unsupported("secrets.export"),
    import: (): Promise<string> => unsupported("secrets.import"),
  };

  auth = {
    // OAuth sign-in is a top-level navigation to the same-origin session BFF
    // (/api/app/login → IdP → /api/app/callback → HttpOnly cookie → back
    // here). The page never holds a token. See webAuth.ts.
    start: (provider?: string): Promise<void> => {
      webAuth.loginRedirect(provider ?? "google");
      return Promise.resolve();
    },
    cancel: (): Promise<void> => Promise.resolve(),
    signinPassword: (e: string, p: string): Promise<AuthStatus> =>
      webAuth.signinPassword(e, p),
    signupPassword: (e: string, p: string): Promise<AuthStatus> =>
      webAuth.signupPassword(e, p),
    // Always a fresh, server-validated answer (the Worker refreshes/re-verifies
    // as needed); the cached webAuth.status() is for synchronous render paths.
    status: (): Promise<AuthStatus> => webAuth.load().then(() => webAuth.status()),
    signout: (): Promise<void> => webAuth.signout(),
    openUrl: (url: string): Promise<void> => {
      window.open(url, "_blank", "noopener");
      return Promise.resolve();
    },
  };

  conversations = {
    save: (): Promise<Conversation> => todo("POST /v1/conversations"),
    list: (): Promise<ConversationSummary[]> => todo("GET /v1/conversations"),
    load: (): Promise<Conversation> => todo("GET /v1/conversations/:id"),
    delete: (): Promise<void> => todo("DELETE /v1/conversations/:id"),
  };

  context = {
    save: (): Promise<ConversationContext> => todo("POST /v1/contexts"),
    list: (): Promise<ContextSummary[]> => todo("GET /v1/contexts"),
    load: (): Promise<ConversationContext> => todo("GET /v1/contexts/:id"),
    delete: (): Promise<void> => todo("DELETE /v1/contexts/:id"),
    activateContext: (): Promise<ConversationContext> =>
      unsupported("context.activateContext (desktop session)"),
    deactivateContext: (): Promise<void> =>
      unsupported("context.deactivateContext (desktop session)"),
    storeDocs: (): Promise<string[]> =>
      unsupported("context.storeDocs (local file paths)"),
    prepare: (): Promise<ConversationContext> => todo("POST /v1/contexts/:id/prepare"),
    loadProfile: (): Promise<KnowledgeProfile> =>
      todo("GET /v1/contexts/profiles/:id"),
    generateDossier: (): Promise<ConversationContext> =>
      todo("POST /v1/contexts/:id/dossier"),
    generatePersonas: (): Promise<ConversationContext> =>
      todo("POST /v1/contexts/:id/personas"),
    choosePersona: (): Promise<ConversationContext> =>
      todo("PATCH /v1/contexts/:id/persona"),
    startRehearsal: (): Promise<string> =>
      unsupported("context.startRehearsal (desktop audio)"),
    rehearsalYourTurn: (): Promise<void> =>
      unsupported("context.rehearsalYourTurn (desktop audio)"),
    rehearsalSay: (): Promise<void> =>
      unsupported("context.rehearsalSay (desktop audio)"),
    setResearchKey: (): Promise<void> =>
      unsupported("context.setResearchKey (server-side on web)"),
    researchKeyStatus: () => Promise.resolve(false),
  };

  usage = {
    summary: (): Promise<UsageSummary> => todo("GET /v1/usage"),
    reset: (): Promise<UsageSummary> => todo("POST /v1/usage/reset"),
  };

  sessions = {
    list: (): Promise<SessionSummary[]> => todo("GET /v1/sessions"),
    load: (): Promise<TranscriptSegment[]> => todo("GET /v1/sessions/:id"),
    delete: (): Promise<void> => todo("DELETE /v1/sessions/:id"),
    exportTranscript: (): Promise<void> => unsupported("sessions.exportTranscript (file path)"),
    analyzeConversation: (): Promise<string> =>
      unsupported("sessions.analyzeConversation (desktop LLM analysis)"),
    writeTextFile: (): Promise<void> => unsupported("sessions.writeTextFile (file path)"),
  };

  diagnostics = {
    saveDebugLog: (): Promise<string> => unsupported("diagnostics.saveDebugLog (file)"),
    // Purely diagnostic, never worth failing loudly for: the browser's own
    // console is the web equivalent of the desktop terminal this exists to
    // reach, so just log there instead of throwing "unsupported".
    trace: (msg: string): Promise<void> => {
      // eslint-disable-next-line no-console
      console.debug(`[trace] ${msg}`);
      return Promise.resolve();
    },
  };

  screenshot = {
    save: (): Promise<string> => unsupported("screenshot.save (file)"),
    dir: (): Promise<string> => unsupported("screenshot.dir (file)"),
    openFolder: (): Promise<void> => unsupported("screenshot.openFolder (file)"),
  };

  hud = {
    open: (): Promise<void> => unsupported("hud.open"),
    close: (): Promise<void> => unsupported("hud.close"),
    toggle: (): Promise<boolean> => unsupported("hud.toggle"),
    isOpen: () => Promise.resolve(false),
  };

  partner = {
    open: (): Promise<void> => unsupported("partner.open"),
    close: (): Promise<void> => unsupported("partner.close"),
    redock: (): Promise<void> => unsupported("partner.redock"),
    payload: () => Promise.resolve(null),
    setLocked: (): Promise<void> => Promise.resolve(),
    locked: (): Promise<boolean> => Promise.resolve(false),
  };
}

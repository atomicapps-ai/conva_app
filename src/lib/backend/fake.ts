/**
 * FakeBackend — an injectable, fully deterministic {@link ConvaBackend} for
 * unit/integration tests (browser architecture §14 M0 "FakeBackend", §15
 * "Fake capture + fake gateway/provider").
 *
 * What it does for real, in memory:
 *  - a live capability store you can drive (`publishCapabilities`,
 *    `publishSnapshot`) — revisions obey the same monotonic rule;
 *  - typed envelope delivery (`emitEnvelope`, `replay`) and legacy event
 *    delivery (`emit`) to whatever subscribed;
 *  - conversations (save/list/load/delete) with deterministic ids;
 *  - session start/stop with `sessionState` events and deterministic ids.
 *
 * Everything else REJECTS with {@link FakeBackendNotConfiguredError} and is
 * reported `unimplemented` in the default snapshot — a fake must never look
 * like a working operation that silently discards work.
 *
 * Usage: `<BackendProvider backend={new FakeBackend()}>` or pass it to any
 * function taking a `ConvaBackend`. No React, no Tauri, no timers.
 */

import type { Capabilities } from "@/lib/backend/capabilities";
import { DESKTOP_CAPABILITIES } from "@/lib/backend/capabilities";
import {
  ALL_OPERATIONS,
  type BackendOperation,
  type CapabilitySnapshot,
  type OperationAvailability,
} from "@/lib/backend/capabilitySnapshot";
import type { ConvaBackend } from "@/lib/backend/ConvaBackend";
import type { EventMap, Unsubscribe } from "@/lib/backend/events";
import {
  createCapabilityStore,
  type CapabilityStore,
  type PublishResult,
} from "@/lib/capture/capabilityStore";
import {
  AVAILABLE,
  CONTRACT_SCHEMA_VERSION,
  unimplemented,
  type Availability,
  type CaptureSourceCapability,
  type TranscriptEvent,
} from "@/lib/capture/contract";
import type { Conversation, ConversationSummary, TranscriptSegment } from "@/lib/ipc";
import type { CapturePrepare, CaptureStatus } from "@/lib/capture/pal";
import type { CaptureSourceKind } from "@/lib/capture/contract";

export class FakeBackendNotConfiguredError extends Error {
  constructor(readonly operation: BackendOperation) {
    super(`FakeBackend: "${operation}" is not configured in this test.`);
    this.name = "FakeBackendNotConfiguredError";
  }
}

/** The operations the fake really implements. */
export const FAKE_IMPLEMENTED: readonly BackendOperation[] = [
  "conversations.save",
  "conversations.list",
  "conversations.load",
  "conversations.delete",
  "session.start",
  "session.stop",
  "capture.enumerateSources",
  "capture.prepare",
  "capture.start",
  "capture.stop",
  "capture.status",
  "capture.subscribe",
  "diagnostics.trace",
];

export interface FakeBackendOptions {
  /** Legacy descriptor for the default snapshot (desktop defaults). */
  legacy?: Capabilities;
  /** Capture sources for the default snapshot (none by default). */
  sources?: CaptureSourceCapability[];
  /** Override the per-operation table (defaults: implemented → available,
   *  everything else → unimplemented). */
  operations?: Partial<OperationAvailability>;
  /** A full snapshot to start from (wins over the three above). */
  snapshot?: CapabilitySnapshot;
  /** Pre-loaded conversation records (e.g. legacy fixtures). */
  conversations?: Conversation[];
  /** Deterministic clock for timestamps (default: a fixed counter). */
  now?: () => number;
}

export function fakeOperations(overrides: Partial<OperationAvailability> = {}): OperationAvailability {
  const table = {} as Record<string, Availability>;
  for (const op of ALL_OPERATIONS) {
    table[op] = FAKE_IMPLEMENTED.includes(op)
      ? AVAILABLE
      : unimplemented("FakeBackend: not configured in this test.");
  }
  return { ...(table as OperationAvailability), ...overrides };
}

export function fakeSnapshot(options: FakeBackendOptions = {}): CapabilitySnapshot {
  return (
    options.snapshot ?? {
      schema_version: CONTRACT_SCHEMA_VERSION,
      revision: 1,
      adapter: "fake",
      legacy: options.legacy ?? DESKTOP_CAPABILITIES,
      sources: options.sources ?? [],
      operations: fakeOperations(options.operations),
    }
  );
}

type Handler<K extends keyof EventMap> = (payload: EventMap[K]) => void;

export class FakeBackend implements ConvaBackend {
  /** The full store — tests publish through it (or the helpers below). */
  readonly store: CapabilityStore<CapabilitySnapshot>;
  private readonly now: () => number;
  private tick = 0;
  private readonly legacyHandlers = new Map<keyof EventMap, Set<Handler<keyof EventMap>>>();
  private readonly envelopeHandlers = new Set<(e: TranscriptEvent) => void>();
  private readonly records = new Map<string, Conversation>();
  private convCounter = 0;
  private sessionCounter = 0;
  private liveSession: string | null = null;
  private readonly captureStatuses = new Map<string, CaptureStatus>();
  private readonly captureHandlers = new Set<(s: CaptureStatus[]) => void>();
  private captureCounter = 0;
  /** Every envelope delivered, in order — the replay log tests compare. */
  readonly delivered: TranscriptEvent[] = [];

  constructor(options: FakeBackendOptions = {}) {
    this.store = createCapabilityStore(fakeSnapshot(options));
    this.now = options.now ?? (() => 1_700_000_000_000 + ++this.tick);
    for (const c of options.conversations ?? []) this.records.set(c.id, c);
  }

  // ── capabilities ──────────────────────────────────────────────────────────

  get capabilityStore() {
    return this.store;
  }

  async capabilities(): Promise<Capabilities> {
    return this.store.snapshot().legacy;
  }

  /** Patch the snapshot; bumps the revision by one. */
  publishCapabilities(patch: Partial<Omit<CapabilitySnapshot, "revision">>): CapabilitySnapshot {
    return this.store.update(patch);
  }

  /** Publish a whole snapshot; rejected (not thrown) when the revision is stale. */
  publishSnapshot(snapshot: CapabilitySnapshot): PublishResult<CapabilitySnapshot> {
    return this.store.publish(snapshot);
  }

  // ── events ────────────────────────────────────────────────────────────────

  async subscribe<K extends keyof EventMap>(event: K, handler: Handler<K>): Promise<Unsubscribe> {
    const set = this.legacyHandlers.get(event) ?? new Set();
    set.add(handler as Handler<keyof EventMap>);
    this.legacyHandlers.set(event, set);
    return () => {
      set.delete(handler as Handler<keyof EventMap>);
    };
  }

  /** Deliver a legacy event to its subscribers (synchronously). */
  emit<K extends keyof EventMap>(event: K, payload: EventMap[K]): number {
    const set = this.legacyHandlers.get(event);
    if (!set) return 0;
    for (const h of [...set]) h(payload);
    return set.size;
  }

  async subscribeEnvelopes(handler: (event: TranscriptEvent) => void): Promise<Unsubscribe> {
    this.envelopeHandlers.add(handler);
    return () => {
      this.envelopeHandlers.delete(handler);
    };
  }

  /** Deliver one envelope to every envelope subscriber (synchronously). */
  emitEnvelope(event: TranscriptEvent): number {
    this.delivered.push(event);
    for (const h of [...this.envelopeHandlers]) h(event);
    return this.envelopeHandlers.size;
  }

  /** Deliver a fixture stream in order. Returns how many were delivered. */
  replay(events: readonly TranscriptEvent[]): number {
    for (const e of events) this.emitEnvelope(e);
    return events.length;
  }

  envelopeSubscriberCount(): number {
    return this.envelopeHandlers.size;
  }

  // ── implemented groups ────────────────────────────────────────────────────

  session = {
    start: async (): Promise<string> => {
      this.sessionCounter += 1;
      const id = `fake-session-${this.sessionCounter}`;
      this.liveSession = id;
      this.captureStatuses.clear();
      this.captureStatuses.set("fake-mic", { source_id: "fake-mic", kind: "mic", channel: "self", phase: "capturing", reason: null });
      this.publishCapture();
      this.emit("sessionState", { state: "listening", session_id: id, started_at_unix_ms: this.now() });
      return id;
    },
    stop: async (): Promise<void> => {
      this.liveSession = null;
      for (const c of this.captureStatuses.values()) if (c.phase !== "ended") { c.phase = "ended"; c.reason = "session_stopped"; }
      this.publishCapture();
      this.emit("sessionState", { state: "idle" });
    },
  };

  /** The session id `session.start()` last returned, or null after stop. */
  currentSessionId(): string | null {
    return this.liveSession;
  }

  private publishCapture(): void {
    const list = [...this.captureStatuses.values()];
    for (const h of this.captureHandlers) h(list);
  }

  /** Tests drive a source's phase directly (e.g. simulate a share ending). */
  setCapturePhase(sourceId: string, phase: CaptureStatus["phase"], reason: string | null = null): void {
    const s = this.captureStatuses.get(sourceId);
    if (!s) return;
    s.phase = phase;
    s.reason = reason;
    this.publishCapture();
  }

  capture = {
    enumerateSources: async () => this.store.snapshot().sources,
    prepare: async (kind: CaptureSourceKind): Promise<CapturePrepare> => {
      const src = this.store.snapshot().sources.find((x) => x.kind === kind);
      return {
        kind,
        channel: src?.channels[0] ?? (kind === "mic" ? "self" : "remote_mix"),
        availability: src?.availability ?? AVAILABLE,
        requires_user_gesture: kind !== "mic",
        notice: `FakeBackend: ${kind} capture.`,
      };
    },
    start: async (kind: CaptureSourceKind): Promise<string> => {
      if (!this.liveSession) throw new Error("FakeBackend: no live session — call session.start() first.");
      const channel = kind === "mic" ? "self" : kind === "meeting" ? "remote_track" : "remote_mix";
      const id = `fake-${kind}-${++this.captureCounter}`;
      this.captureStatuses.set(id, { source_id: id, kind, channel, phase: "capturing", reason: null });
      this.publishCapture();
      return id;
    },
    stop: async (sourceId: string): Promise<void> => {
      const s = this.captureStatuses.get(sourceId);
      if (!s) return;
      s.phase = "ended";
      s.reason = "user";
      this.publishCapture();
    },
    status: async (): Promise<CaptureStatus[]> => [...this.captureStatuses.values()],
    subscribe: async (handler: (s: CaptureStatus[]) => void): Promise<Unsubscribe> => {
      this.captureHandlers.add(handler);
      return () => {
        this.captureHandlers.delete(handler);
      };
    },
  };

  conversations = {
    save: async (
      id: string | null,
      title: string | null,
      segments: TranscriptSegment[],
      linkedDocs: string[],
      contextId?: string | null,
    ): Promise<Conversation> => {
      const existing = id ? this.records.get(id) : undefined;
      const now = this.now();
      const record: Conversation = {
        id: existing?.id ?? id ?? `fake-conv-${++this.convCounter}`,
        title: title ?? existing?.title ?? "Untitled",
        created_at_unix_ms: existing?.created_at_unix_ms ?? now,
        updated_at_unix_ms: now,
        segments: [...segments],
        linked_docs: [...linkedDocs],
        linked_context_id: contextId ?? existing?.linked_context_id ?? null,
      };
      this.records.set(record.id, record);
      return record;
    },
    list: async (): Promise<ConversationSummary[]> =>
      [...this.records.values()]
        .sort((a, b) => b.updated_at_unix_ms - a.updated_at_unix_ms)
        .map((c) => ({
          id: c.id,
          title: c.title,
          created_at_unix_ms: c.created_at_unix_ms,
          updated_at_unix_ms: c.updated_at_unix_ms,
          segment_count: c.segments.length,
          linked_docs: c.linked_docs,
          linked_context_id: c.linked_context_id ?? null,
          preview: c.segments[0]?.text ?? "",
        })),
    load: async (id: string): Promise<Conversation> => {
      const c = this.records.get(id);
      if (!c) throw new Error(`FakeBackend: conversation "${id}" not found`);
      // Return the stored object untouched — legacy records must read as saved.
      return c;
    },
    delete: async (id: string): Promise<void> => {
      this.records.delete(id);
    },
  };

  diagnostics = {
    saveDebugLog: nc<string>("diagnostics.saveDebugLog"),
    trace: async (_msg: string): Promise<void> => {},
  };

  // ── not configured (honest rejects) ───────────────────────────────────────

  config = {
    get: nc("config.get"),
    save: nc("config.save"),
    export: nc("config.export"),
    import: nc("config.import"),
  };
  providers = {
    registry: nc("providers.registry"),
    setKey: nc("providers.setKey"),
    keyStatus: nc("providers.keyStatus"),
    test: nc("providers.test"),
    listModels: nc("providers.listModels"),
  };
  ally = { run: nc("ally.run") };
  audio = {
    listDevices: nc("audio.listDevices"),
    listWhisperModels: nc("audio.listWhisperModels"),
    setDeepgramKey: nc("audio.setDeepgramKey"),
    deepgramKeyStatus: nc("audio.deepgramKeyStatus"),
  };
  recording = {
    start: nc("recording.start"),
    stop: nc("recording.stop"),
    status: nc("recording.status"),
  };
  rag = {
    ingest: nc("rag.ingest"),
    ingestText: nc("rag.ingestText"),
    list: nc("rag.list"),
    setEnabled: nc("rag.setEnabled"),
    delete: nc("rag.delete"),
    attachContext: nc("rag.attachContext"),
    detachContext: nc("rag.detachContext"),
    download: nc("rag.download"),
    syncLibrary: nc("rag.syncLibrary"),
    analyzeTerms: nc("rag.analyzeTerms"),
    recordHighlightFeedback: nc("rag.recordHighlightFeedback"),
    recordTermPick: nc("rag.recordTermPick"),
    documentText: nc("rag.documentText"),
  };
  secrets = {
    status: nc("secrets.status"),
    export: nc("secrets.export"),
    import: nc("secrets.import"),
  };
  auth = {
    start: nc("auth.start"),
    cancel: nc("auth.cancel"),
    signinPassword: nc("auth.signinPassword"),
    signupPassword: nc("auth.signupPassword"),
    status: nc("auth.status"),
    signout: nc("auth.signout"),
    openUrl: nc("auth.openUrl"),
  };
  context = {
    save: nc("context.save"),
    list: nc("context.list"),
    load: nc("context.load"),
    delete: nc("context.delete"),
    activateContext: nc("context.activateContext"),
    deactivateContext: nc("context.deactivateContext"),
    storeDocs: nc("context.storeDocs"),
    prepare: nc("context.prepare"),
    loadProfile: nc("context.loadProfile"),
    generateDossier: nc("context.generateDossier"),
    generatePersonas: nc("context.generatePersonas"),
    choosePersona: nc("context.choosePersona"),
    startRehearsal: nc("context.startRehearsal"),
    rehearsalYourTurn: nc("context.rehearsalYourTurn"),
    rehearsalSay: nc("context.rehearsalSay"),
    setResearchKey: nc("context.setResearchKey"),
    researchKeyStatus: nc("context.researchKeyStatus"),
  };
  usage = { summary: nc("usage.summary"), reset: nc("usage.reset") };
  sessions = {
    list: nc("sessions.list"),
    load: nc("sessions.load"),
    delete: nc("sessions.delete"),
    exportTranscript: nc("sessions.exportTranscript"),
    analyzeConversation: nc("sessions.analyzeConversation"),
    writeTextFile: nc("sessions.writeTextFile"),
  };
  screenshot = {
    save: nc("screenshot.save"),
    dir: nc("screenshot.dir"),
    openFolder: nc("screenshot.openFolder"),
  };
  hud = {
    open: nc("hud.open"),
    close: nc("hud.close"),
    toggle: nc("hud.toggle"),
    isOpen: nc("hud.isOpen"),
  };
  partner = {
    open: nc("partner.open"),
    close: nc("partner.close"),
    redock: nc("partner.redock"),
    payload: nc("partner.payload"),
    setLocked: nc("partner.setLocked"),
    locked: nc("partner.locked"),
  };
}

/** A method that honestly rejects as "not configured". */
function nc<T = never>(op: BackendOperation): (...args: never[]) => Promise<T> {
  return () => Promise.reject(new FakeBackendNotConfiguredError(op));
}

/**
 * The revisioned capability snapshot every {@link ConvaBackend} publishes
 * (browser architecture §8) and the per-adapter tables that build it.
 *
 * A snapshot carries three things:
 *  - `legacy`     — today's {@link Capabilities} descriptor, unchanged, so the
 *                   existing `useCapabilities()` consumers keep working;
 *  - `sources`    — one {@link CaptureSourceCapability} per capture source
 *                   (mic / display / tab / wasapi / meeting);
 *  - `operations` — an {@link Availability} for EVERY invocable backend
 *                   operation, so the UI can know an operation is
 *                   `unimplemented` BEFORE it renders the control. The type is
 *                   derived from the interface, so adding a backend method
 *                   without an availability entry is a compile error.
 *
 * Availability is never inferred from "am I in Tauri / a browser": each table
 * states its answer per operation, and the runtime facts that DO matter (OS,
 * media APIs present, secure context) arrive through an injectable
 * {@link RuntimeProbe} so tests are deterministic.
 *
 * Pure data + functions — no React, no Tauri, no `navigator` access except in
 * {@link probeRuntime} (adapters call it; tests pass a probe).
 */

import type { Capabilities } from "@/lib/backend/capabilities";
import type { ConvaBackend } from "@/lib/backend/ConvaBackend";
import {
  AVAILABLE,
  CONTRACT_SCHEMA_VERSION,
  degraded,
  unimplemented,
  unsupported,
  type Availability,
  type CaptureSourceCapability,
  type CaptureSourceKind,
  type ContractSchemaVersion,
} from "@/lib/capture/contract";
import type { Revisioned } from "@/lib/capture/capabilityStore";

// ── Operation ids (derived from the interface) ───────────────────────────────

type Leaf<T, P extends string> = T extends (...args: never[]) => unknown
  ? P
  : T extends object
    ? { [K in keyof T & string]: Leaf<T[K], `${P}.${K}`> }[keyof T & string]
    : never;

/** Every invocable `group.method` on the backend (meta members excluded). */
export type BackendOperation = Exclude<
  { [K in keyof ConvaBackend & string]: Leaf<ConvaBackend[K], K> }[keyof ConvaBackend & string],
  "capabilities" | "subscribe" | "subscribeEnvelopes" | `capabilityStore.${string}`
>;

export type OperationAvailability = Record<BackendOperation, Availability>;

// ── Snapshot ─────────────────────────────────────────────────────────────────

/** Which adapter produced the snapshot — informational; never a gating input. */
export type CapabilityAdapter = "tauri" | "web" | "fake" | "legacy";

export interface CapabilitySnapshot extends Revisioned {
  schema_version: ContractSchemaVersion;
  revision: number;
  adapter: CapabilityAdapter;
  /** The compatibility descriptor `capabilities()` returns. */
  legacy: Capabilities;
  sources: CaptureSourceCapability[];
  operations: OperationAvailability;
}

/** Find one source by kind. */
export function sourceOfKind(
  snapshot: CapabilitySnapshot,
  kind: CaptureSourceKind,
): CaptureSourceCapability | undefined {
  return snapshot.sources.find((s) => s.kind === kind);
}

// ── Runtime probe ────────────────────────────────────────────────────────────

export type RuntimeOs = "windows" | "macos" | "linux" | "unknown";

/** The runtime facts the tables consult. Injected — never read ad hoc. */
export interface RuntimeProbe {
  os: RuntimeOs;
  hasGetUserMedia: boolean;
  hasGetDisplayMedia: boolean;
  secureContext: boolean;
}

/** Read the probe from the live `navigator`/`window`. Adapters only. */
export function probeRuntime(): RuntimeProbe {
  const nav = typeof navigator === "undefined" ? undefined : navigator;
  const ua = nav?.userAgent ?? "";
  const os: RuntimeOs = /windows/i.test(ua)
    ? "windows"
    : /mac os|macintosh/i.test(ua)
      ? "macos"
      : /linux/i.test(ua)
        ? "linux"
        : "unknown";
  const md = nav?.mediaDevices as
    | { getUserMedia?: unknown; getDisplayMedia?: unknown }
    | undefined;
  return {
    os,
    hasGetUserMedia: typeof md?.getUserMedia === "function",
    hasGetDisplayMedia: typeof md?.getDisplayMedia === "function",
    secureContext: typeof window !== "undefined" ? window.isSecureContext === true : false,
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Every operation set to the same availability (the desktop default). */
export function uniformOperations(a: Availability): OperationAvailability {
  const table = {} as Record<string, Availability>;
  for (const op of ALL_OPERATIONS) table[op] = a;
  return table as OperationAvailability;
}

/**
 * The runtime list of operations. Kept in lockstep with {@link ConvaBackend}
 * by the `satisfies` check below — a method added to the interface without an
 * entry here (or vice-versa) fails typecheck.
 */
export const ALL_OPERATIONS = [
  "config.get",
  "config.save",
  "config.export",
  "config.import",
  "providers.registry",
  "providers.setKey",
  "providers.keyStatus",
  "providers.test",
  "providers.listModels",
  "ally.run",
  "audio.listDevices",
  "audio.listWhisperModels",
  "audio.setDeepgramKey",
  "audio.deepgramKeyStatus",
  "session.start",
  "session.stop",
  "capture.enumerateSources",
  "capture.prepare",
  "capture.start",
  "capture.stop",
  "capture.recover",
  "capture.status",
  "capture.subscribe",
  "recording.start",
  "recording.stop",
  "recording.status",
  "rag.ingest",
  "rag.ingestText",
  "rag.list",
  "rag.setEnabled",
  "rag.delete",
  "rag.attachContext",
  "rag.detachContext",
  "rag.download",
  "rag.syncLibrary",
  "rag.analyzeTerms",
  "rag.recordHighlightFeedback",
  "rag.recordTermPick",
  "rag.documentText",
  "secrets.status",
  "secrets.export",
  "secrets.import",
  "auth.start",
  "auth.cancel",
  "auth.signinPassword",
  "auth.signupPassword",
  "auth.status",
  "auth.signout",
  "auth.openUrl",
  "conversations.save",
  "conversations.list",
  "conversations.load",
  "conversations.delete",
  "context.save",
  "context.list",
  "context.load",
  "context.delete",
  "context.activateContext",
  "context.deactivateContext",
  "context.storeDocs",
  "context.prepare",
  "context.loadProfile",
  "context.generateDossier",
  "context.generatePersonas",
  "context.choosePersona",
  "context.startRehearsal",
  "context.rehearsalYourTurn",
  "context.rehearsalSay",
  "context.setResearchKey",
  "context.researchKeyStatus",
  "usage.summary",
  "usage.reset",
  "sessions.list",
  "sessions.load",
  "sessions.delete",
  "sessions.exportTranscript",
  "sessions.analyzeConversation",
  "sessions.writeTextFile",
  "diagnostics.saveDebugLog",
  "diagnostics.trace",
  "screenshot.save",
  "screenshot.dir",
  "screenshot.openFolder",
  "hud.open",
  "hud.close",
  "hud.toggle",
  "hud.isOpen",
  "partner.open",
  "partner.close",
  "partner.redock",
  "partner.payload",
  "partner.setLocked",
  "partner.locked",
] as const satisfies readonly BackendOperation[];

// Completeness in the other direction: every BackendOperation appears above.
type _MissingOps = Exclude<BackendOperation, (typeof ALL_OPERATIONS)[number]>;
const _assertComplete: _MissingOps extends never ? true : never = true;
void _assertComplete;

// ── Desktop (Tauri shell) ────────────────────────────────────────────────────

const NATIVE_LOOPBACK_WINDOWS_ONLY =
  "System-audio (other-party) capture is WASAPI loopback, Windows-only; this OS runs mic-only.";

/**
 * Desktop sources. The legacy descriptor stays exactly as today; the source
 * list adds the honest per-OS answer for WASAPI loopback (Windows-only — see
 * CLAUDE.md "Platform capability gaps").
 */
export function desktopSources(probe: RuntimeProbe): CaptureSourceCapability[] {
  const loopback: Availability =
    probe.os === "windows"
      ? AVAILABLE
      : probe.os === "unknown"
        ? degraded("Could not determine the OS; WASAPI loopback is Windows-only.")
        : unsupported(NATIVE_LOOPBACK_WINDOWS_ONLY);
  return [
    {
      kind: "mic",
      channels: ["self"],
      owner: "native",
      continuity: "native_lease",
      processing: ["local", "hosted"],
      availability: AVAILABLE,
    },
    {
      kind: "wasapi",
      channels: ["remote_mix"],
      owner: "native",
      continuity: "native_lease",
      processing: ["local", "hosted"],
      availability: loopback,
    },
    {
      kind: "display",
      channels: ["remote_mix"],
      owner: "page",
      continuity: "page_lifetime",
      processing: ["hosted"],
      availability: unsupported("The desktop shell captures through its native engine, not browser sharing."),
    },
    {
      kind: "tab",
      channels: ["remote_mix"],
      owner: "page",
      continuity: "page_lifetime",
      processing: ["hosted"],
      availability: unsupported("The desktop shell captures through its native engine, not browser sharing."),
    },
    {
      kind: "meeting",
      channels: ["remote_track"],
      owner: "integration",
      continuity: "hosted",
      processing: ["hosted"],
      availability: unimplemented("Meeting integrations are a later, opt-in adapter (architecture M6)."),
    },
  ];
}

export function desktopSnapshot(
  legacy: Capabilities,
  probe: RuntimeProbe,
  revision = 1,
): CapabilitySnapshot {
  return {
    schema_version: CONTRACT_SCHEMA_VERSION,
    revision,
    adapter: "tauri",
    legacy,
    sources: desktopSources(probe),
    // Every shell command exists today; the static desktop descriptor is what
    // `capabilities()` has always answered. Refining per-command availability
    // from the shell (e.g. incog_status) is later work, not M0. The PAL-only
    // per-source `capture` control is honest about desktop: both sides start
    // together on `session.start()`, so per-source start/stop/status is not
    // something the shell offers yet.
    operations: {
      ...uniformOperations(AVAILABLE),
      "capture.start": unimplemented(DESKTOP_CAPTURE),
      "capture.stop": unimplemented(DESKTOP_CAPTURE),
      "capture.recover": unimplemented(DESKTOP_CAPTURE),
      "capture.status": unimplemented(DESKTOP_CAPTURE),
      "capture.subscribe": unimplemented(DESKTOP_CAPTURE),
    },
  };
}

const DESKTOP_CAPTURE =
  "Desktop starts microphone and system audio together on session.start(); per-source control is not a shell command yet.";

// ── Web (browser) ────────────────────────────────────────────────────────────

const M2 = "Browser capture pipeline is not implemented yet (architecture M2).";
const M1 = "Not wired to the hosted API yet (architecture M1/M2).";
const FILE_PATHS = "Takes a desktop file path; a browser-safe download/upload descriptor is not implemented yet.";
const NO_KEYRING = "BYO keys need the OS keyring — the web uses hosted inference.";
const NO_OS_WINDOW = "A browser tab cannot spawn or control an OS window.";
const NO_FS = "No local file system in a browser tab.";
const NO_LOCAL_ASR = "Local whisper checkpoints are a desktop capability.";

/**
 * Browser sources. Nothing is `available` in M0: the mic/display/tab
 * pipelines are not built, so they are `unimplemented` where the runtime API
 * exists and `unsupported` where it doesn't (Firefox/Safari display audio).
 */
export function webSources(probe: RuntimeProbe): CaptureSourceCapability[] {
  const insecure = !probe.secureContext;
  const mic: Availability = !probe.hasGetUserMedia
    ? unsupported("navigator.mediaDevices.getUserMedia is not available in this browser.")
    : insecure
      ? unsupported("Microphone capture requires a secure (https) context.")
      : unimplemented(M2);
  const share: Availability = !probe.hasGetDisplayMedia
    ? unsupported("navigator.mediaDevices.getDisplayMedia is not available in this browser.")
    : insecure
      ? unsupported("Call-audio sharing requires a secure (https) context.")
      : unimplemented(M2);
  return [
    {
      kind: "mic",
      channels: ["self"],
      owner: "page",
      continuity: "page_lifetime",
      processing: ["hosted"],
      availability: mic,
    },
    {
      kind: "display",
      channels: ["remote_mix"],
      owner: "page",
      continuity: "page_lifetime",
      processing: ["hosted"],
      availability: share,
    },
    {
      kind: "tab",
      channels: ["remote_mix"],
      owner: "page",
      continuity: "page_lifetime",
      processing: ["hosted"],
      availability: share,
    },
    {
      kind: "wasapi",
      channels: ["remote_mix"],
      owner: "bridge",
      continuity: "native_lease",
      processing: ["local", "hybrid"],
      availability: unimplemented("Windows Capture Bridge is not built (architecture M5)."),
    },
    {
      kind: "meeting",
      channels: ["remote_track"],
      owner: "integration",
      continuity: "hosted",
      processing: ["hosted"],
      availability: unimplemented("Meeting integrations are a later, opt-in adapter (architecture M6)."),
    },
  ];
}

/**
 * Per-operation truth for `WebBackend`. Mirrors `web.ts` method by method:
 * a `todo()` stub is `unimplemented`, a Layer-4-only method is `unsupported`,
 * and the auth methods that really work are `available`. The scaffold
 * successes the audit flagged (`analyzeTerms → []`, feedback that resolves
 * without persisting) are `unimplemented` here — the UI must not present
 * them as working.
 */
export function webOperations(): OperationAvailability {
  return {
    "config.get": unimplemented(M1),
    "config.save": unimplemented(M1),
    "config.export": unsupported(NO_FS),
    "config.import": unsupported(NO_FS),
    "providers.registry": unimplemented(M1),
    "providers.setKey": unsupported(NO_KEYRING),
    "providers.keyStatus": unsupported(NO_KEYRING),
    "providers.test": unsupported(NO_KEYRING),
    "providers.listModels": unimplemented(M1),
    // Flipped at runtime by WebBackend from GET /api/live/status `ally` (M2 cp3).
    "ally.run": unimplemented(M1),
    "audio.listDevices": unimplemented(M2),
    "audio.listWhisperModels": unsupported(NO_LOCAL_ASR),
    "audio.setDeepgramKey": unsupported("ASR keys are held server-side on the web."),
    "audio.deepgramKeyStatus": unsupported("ASR keys are held server-side on the web."),
    "session.start": unimplemented(M2),
    "session.stop": unimplemented(M2),
    "capture.enumerateSources": AVAILABLE,
    "capture.prepare": AVAILABLE,
    "capture.start": unimplemented(M2),
    "capture.stop": unimplemented(M2),
    // Flipped at runtime by WebBackend with capture.start/stop (M2 cp4).
    "capture.recover": unimplemented(M2),
    "capture.status": AVAILABLE,
    "capture.subscribe": AVAILABLE,
    "recording.start": unsupported(NO_FS),
    "recording.stop": unsupported(NO_FS),
    "recording.status": unsupported(NO_FS),
    "rag.ingest": unsupported("Takes local file paths; browser uploads use ingestText / a future upload descriptor."),
    "rag.ingestText": unimplemented(M1),
    "rag.list": unimplemented(M1),
    "rag.setEnabled": unimplemented(M1),
    "rag.delete": unimplemented(M1),
    "rag.attachContext": unimplemented(M1),
    "rag.detachContext": unimplemented(M1),
    "rag.download": unimplemented(FILE_PATHS),
    "rag.syncLibrary": unsupported("Syncs to a local git checkout — desktop only."),
    "rag.analyzeTerms": unimplemented("Returns an empty list on the web today; hosted term analysis is not wired."),
    "rag.recordHighlightFeedback": unimplemented("Resolves without persisting on the web today."),
    "rag.recordTermPick": unimplemented("Resolves without persisting on the web today."),
    "rag.documentText": unimplemented(M1),
    "secrets.status": unsupported(NO_FS),
    "secrets.export": unsupported(NO_FS),
    "secrets.import": unsupported(NO_FS),
    "auth.start": AVAILABLE,
    "auth.cancel": AVAILABLE,
    "auth.signinPassword": AVAILABLE,
    "auth.signupPassword": AVAILABLE,
    "auth.status": AVAILABLE,
    "auth.signout": AVAILABLE,
    "auth.openUrl": AVAILABLE,
    "conversations.save": unimplemented(M1),
    "conversations.list": unimplemented(M1),
    "conversations.load": unimplemented(M1),
    "conversations.delete": unimplemented(M1),
    "context.save": unimplemented(M1),
    "context.list": unimplemented(M1),
    "context.load": unimplemented(M1),
    "context.delete": unimplemented(M1),
    // Not desktop-only in principle (architecture §8) — a hosted session
    // implementation makes these real; until then they are unimplemented.
    "context.activateContext": unimplemented("Session grounding needs the hosted live session (architecture M2)."),
    "context.deactivateContext": unimplemented("Session grounding needs the hosted live session (architecture M2)."),
    "context.storeDocs": unsupported("Copies local file paths — desktop only; browser uploads land with the hosted library."),
    "context.prepare": unimplemented(M1),
    "context.loadProfile": unimplemented(M1),
    "context.generateDossier": unimplemented(M1),
    "context.generatePersonas": unimplemented(M1),
    "context.choosePersona": unimplemented(M1),
    "context.startRehearsal": unimplemented("Rehearsal needs the browser mic pipeline + hosted TTS (architecture M2+)."),
    "context.rehearsalYourTurn": unimplemented("Rehearsal needs the browser mic pipeline + hosted TTS (architecture M2+)."),
    "context.rehearsalSay": unimplemented("Rehearsal needs the browser mic pipeline + hosted TTS (architecture M2+)."),
    "context.setResearchKey": unsupported("Research keys are held server-side on the web."),
    "context.researchKeyStatus": unsupported("Research keys are held server-side on the web."),
    // Flipped at runtime by WebBackend when the gateway's session backend answers (M2 cp4).
    "usage.summary": unimplemented(M1),
    "usage.reset": unsupported("The hosted usage ledger is server-side and resets every UTC day; there is nothing to clear locally."),
    "sessions.list": unimplemented(M1),
    "sessions.load": unimplemented(M1),
    "sessions.delete": unimplemented(M1),
    "sessions.exportTranscript": unimplemented(FILE_PATHS),
    "sessions.analyzeConversation": unimplemented("Post-call analysis runs through hosted inference (architecture M1/M2)."),
    "sessions.writeTextFile": unimplemented(FILE_PATHS),
    "diagnostics.saveDebugLog": unimplemented(FILE_PATHS),
    "diagnostics.trace": AVAILABLE,
    "screenshot.save": unimplemented(FILE_PATHS),
    "screenshot.dir": unsupported(NO_FS),
    "screenshot.openFolder": unsupported(NO_FS),
    "hud.open": unsupported(NO_OS_WINDOW),
    "hud.close": unsupported(NO_OS_WINDOW),
    "hud.toggle": unsupported(NO_OS_WINDOW),
    "hud.isOpen": unsupported(NO_OS_WINDOW),
    "partner.open": unsupported(NO_OS_WINDOW),
    "partner.close": unsupported(NO_OS_WINDOW),
    "partner.redock": unsupported(NO_OS_WINDOW),
    "partner.payload": unsupported(NO_OS_WINDOW),
    "partner.setLocked": unsupported(NO_OS_WINDOW),
    "partner.locked": unsupported(NO_OS_WINDOW),
  };
}

export function webSnapshot(
  legacy: Capabilities,
  probe: RuntimeProbe,
  revision = 1,
): CapabilitySnapshot {
  return {
    schema_version: CONTRACT_SCHEMA_VERSION,
    revision,
    adapter: "web",
    legacy,
    sources: webSources(probe),
    operations: webOperations(),
  };
}

// ── Legacy shim ──────────────────────────────────────────────────────────────

/**
 * Wrap a bare {@link Capabilities} descriptor (a backend that only implements
 * the one-shot `capabilities()` — e.g. a partial test fake) in a snapshot.
 * Sources and operations are unknown, so nothing is claimed `available`.
 */
export function legacySnapshot(legacy: Capabilities, revision = 1): CapabilitySnapshot {
  return {
    schema_version: CONTRACT_SCHEMA_VERSION,
    revision,
    adapter: "legacy",
    legacy,
    sources: [],
    operations: uniformOperations(
      unimplemented("This backend only reports the legacy capability descriptor."),
    ),
  };
}

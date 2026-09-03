/**
 * Typed mirror of the Rust IPC contract.
 *
 * Source of truth: crates/conva-core/src/ipc.rs — if that file changes,
 * this one changes in the same commit (ts-rs codegen replaces this hand
 * mirror later in Phase 1).
 */

export type StreamSide = "inbound" | "outbound";

export const EVENTS = {
  transcriptSegment: "conva://transcript-segment",
  audioLevel: "conva://audio-level",
  sessionState: "conva://session-state",
  allyChunk: "conva://ally-chunk",
  modelStatus: "conva://model-status",
  allySources: "conva://ally-sources",
  radar: "conva://radar",
  tracker: "conva://tracker",
  capture: "conva://capture",
  authChanged: "conva://auth-changed",
  partnerTerm: "conva://partner-term",
  partnerLock: "conva://partner-lock",
  splashProgress: "conva://splash-progress",
} as const;

export interface TranscriptSegment {
  side: StreamSide;
  seq: number;
  text: string;
  is_final: boolean;
  start_ms: number;
  end_ms: number;
  confidence: number | null;
  latency_ms: number;
}

export interface AudioLevelEvent {
  side: StreamSide;
  rms_dbfs: number;
  healthy: boolean;
}

export type SessionStateEvent =
  | { state: "idle" }
  /** Start underway: model loading / first-run GPU shader compile. */
  | { state: "preparing"; message: string }
  | { state: "listening"; session_id: string; started_at_unix_ms: number }
  | { state: "paused"; session_id: string }
  | { state: "error"; message: string };

/** Live Context rehearsal phase — drives the speaking/active-speaker UI. */
export type RehearsalStateEvent =
  | { phase: "listening" }
  | { phase: "thinking" }
  | { phase: "speaking" }
  | { phase: "ended" };

export interface AllyChunkEvent {
  request_id: string;
  token: string;
  done: boolean;
  error: string | null;
}

/** Mirror of conva-core prompt::AllyKind. */
export type AllyKind = "suggest_reply" | "summarize" | "question";

export interface ModelInfo {
  id: string;
  display_name: string;
}

/** Mirror of the shell's WhisperModelInfo (speech-to-text model picker). */
export interface WhisperModelInfo {
  id: string;
  label: string;
  note: string;
  approx_mb: number;
}

export interface ProviderKeyStatus {
  id: ProviderId;
  has_key: boolean;
}

export interface AllySource {
  file_name: string;
  location: string;
}

export interface AllySourcesEvent {
  request_id: string;
  sources: AllySource[];
}

/** Mirror of conva-core rag::DocSource — a library document's provenance. */
export type DocSource = "file" | "pasted" | "generated";

/** Mirror of conva-core rag::RagDocument. */
export interface RagDocument {
  id: string;
  file_name: string;
  enabled: boolean;
  chunk_count: number;
  ingested_at_unix_ms: number;
  source: DocSource;
  /** Conversation Context ids this document is attached to. */
  context_ids: string[];
  /** Content size in bytes — real file size for a file-sourced document,
   *  ingested text length for pasted/generated. Format with
   *  `formatBytes()` (`@/lib/formatBytes`), never display the raw number. */
  size_bytes: number;
}

export interface IngestReport {
  document: RagDocument;
  warnings: string[];
}

/** Mirror of the shell's SecretsStatus (portable encrypted secrets). */
export interface SecretsStatus {
  passphrase_set: boolean;
  file_present: boolean;
  file_path: string;
  passphrase_env: string;
}

/** Mirror of the shell's AuthStatus (account sign-in via Supabase OAuth). */
export interface AuthStatus {
  signed_in: boolean;
  email: string | null;
  user_id: string | null;
  expires_at_unix: number | null;
  /** Supabase's `last_sign_in_at` — ISO 8601, passed through as-is (no
   *  Rust-side date parsing). Reflects the most recent actual
   *  authentication, not token refreshes. `new Date(iso)` parses it fine. */
  last_sign_in_at: string | null;
  /** False when no Supabase anon key is configured — sign-in unavailable. */
  configured: boolean;
}

/** Mirror of the shell's AuthChangedEvent: an OAuth sign-in finishing
 *  out-of-band via the conva://auth/callback deep link. Exactly one of
 *  `status` / `error` is set. */
export interface AuthChangedEvent {
  status: AuthStatus | null;
  error: string | null;
}

export interface ScoredChunk {
  document_id: string;
  file_name: string;
  location: string;
  text: string;
  score: number;
}

export type RetrievalKind = "prepared_hit" | "evidence_hit" | "miss";
export type BridgeKind =
  | "evidence"
  | "comparison"
  | "process"
  | "behavioral"
  | "rationale"
  | "definition"
  | "boundary"
  | "framework";

export interface BridgeResponse {
  kind: BridgeKind;
  text: string;
}

export interface RadarEvent {
  turn_id: string;
  source_key: string;
  question: string;
  outcome: RetrievalKind;
  confidence: number;
  bridge: BridgeResponse;
  sources: ScoredChunk[];
}

export interface TrackedEntity {
  label: string;
  detail: string;
}

export interface TrackedCommitment {
  who: string; // "you" | "them"
  what: string;
  due: string;
}

export interface TrackerEvent {
  entities: TrackedEntity[];
  commitments: TrackedCommitment[];
}

// ── FANER capture routing (F11) — mirrors `conva-core/src/capture.rs` ─────────
export type CaptureTrigger = "question" | "task_frame" | "prep_reference" | "gap";
export type CaptureAction = "EXPLAIN" | "RECALL" | "ASSIST" | "SYNTHESIZE";
/** How likely a term is to be unknown — only set on EXPLAIN captures. */
export type CaptureTier = "field" | "specialized";
/** What kind of thing the term names — decides what `preview` contains. */
export type CaptureKind = "concept" | "problem";

/** One routed capture: what to help with, how, and about what. */
export interface Capture {
  trigger: CaptureTrigger;
  action: CaptureAction;
  arguments: string[];
  /** Null for RECALL/ASSIST/SYNTHESIZE — only EXPLAIN is tiered. */
  tier: CaptureTier | null;
  /** Null for RECALL/ASSIST/SYNTHESIZE — only EXPLAIN is classified. */
  kind: CaptureKind | null;
  /** A short (<=2 sentence) preview of the actual answer — a definition, the
   *  standard fix (when `kind` is "problem"), a recall pointer, or a
   *  SYNTHESIZE teaser. */
  preview: string;
}

/** The full deduped list of routed captures, re-emitted after each pass. */
export interface CaptureEvent {
  captures: Capture[];
}

/** What the partner window shows (mirror of `ipc.rs::PartnerPayload`) — the
 *  term it was opened for, plus the FANER classification + preview when it
 *  came from a capture. Read via `get_partner_payload` on window boot;
 *  re-sent over `conva://partner-term` when a new term targets an open
 *  window. */
export interface PartnerPayload {
  term: string;
  kind: string | null;
  preview: string | null;
  /** An already-answered card's text ("Open in viewer" — owner, 2026-08-22:
   *  the viewer IS the partner window). `null` = a fresh term, researched
   *  by the window itself. */
  answer: string | null;
  /** Already-grouped "file — ¶loc, ¶loc" citation lines for `answer`. */
  source_lines: string[];
  /** Set when this open targets a library document directly (e.g. "view" on
   *  a Library/Context row) rather than a term or answer — `term` doubles
   *  as the file name and the window fetches the full text itself via
   *  `documentText`, same as clicking a "FROM YOUR DOCUMENTS" citation
   *  line. `null` for every other open. */
  doc_id: string | null;
}

/** Mirror of `ipc.rs::PartnerLockEvent` — sent when the shell changes the
 *  partner window's lock-to-app state (e.g. a manual drag released it). */
export interface PartnerLockEvent {
  locked: boolean;
}

export interface SessionSummary {
  id: string;
  started_at_unix_ms: number;
  segment_count: number;
  preview: string;
  /** True when this session was a Context rehearsal. */
  is_rehearsal: boolean;
  /** The context's title, when this was a rehearsal. */
  simcon_title: string | null;
}

/** Mirror of the shell's conversations::Conversation (named saved record). */
export interface Conversation {
  id: string;
  title: string;
  created_at_unix_ms: number;
  updated_at_unix_ms: number;
  segments: TranscriptSegment[];
  linked_docs: string[];
  linked_context_id?: string | null;
}

/** Mirror of the shell's conversations::ConversationSummary. */
export interface ConversationSummary {
  id: string;
  title: string;
  created_at_unix_ms: number;
  updated_at_unix_ms: number;
  segment_count: number;
  linked_docs: string[];
  linked_context_id?: string | null;
  preview: string;
}

/* ── Context — Conversation Context (mirror of conva_core::context) ──────────
   A rehearsal of a high-stakes call: setup → knowledge profile (docs + bounded
   web research) → generated personas → real-time run. Persistence + pipeline
   land in the shell (Phase A.2). Keep these in lockstep with
   `crates/conva-core/src/context.rs`. */

/** Mirror of conva_core::context::DEFAULT_CONTEXT_ID — the reserved id of the
 * always-present "General conversation" default context (session-grounding's
 * "required selection" invariant). Not user-deletable. */
export const DEFAULT_CONTEXT_ID = "default";

/** The kind of conversation this context is for. Launch set (fixed but
 * extensible later); drives the setup template + web-research default. */
export type ContextCategory =
  | "interview"
  | "company_meeting"
  | "sales_call"
  | "live_stream"
  | "other";

/** Lifecycle of a Context, start to finish. */
export type ContextStatus =
  | "draft"
  | "ingesting"
  | "ready"
  | "running"
  | "ended";

/** The avatar gender presentation a generated persona was assigned — Ally's
 *  choice, cosmetic only (drives which silhouette icon the counterparty
 *  cards show). `undefined`/absent for personas generated before this
 *  field existed, or when the model's answer didn't parse as male/female. */
export type PersonaGender = "male" | "female";

/** One generated counterparty persona/strategy option (3 per context). */
export interface ContextPersona {
  id: string;
  title: string;
  summary: string;
  style_tags: string[];
  recommended: boolean;
  gender?: PersonaGender | null;
}

/** A web-research source folded into a knowledge profile. */
export interface ResearchSource {
  title: string;
  url: string;
  snippet: string;
  fetched_at_unix_ms: number;
}

/** The reusable, indexed knowledge base for a Context (library docs + web
 *  research). Reusable across future Contexts and live calls, by id. */
export interface KnowledgeProfile {
  id: string;
  title: string;
  created_at_unix_ms: number;
  updated_at_unix_ms: number;
  doc_ids: string[];
  research: ResearchSource[];
  ready: boolean;
}

/** One Conversation Context record: Step 1 setup through Step 4 run. */
export interface ConversationContext {
  id: string;
  title: string;
  purpose: string;
  /** For interviews: the target role's job description (Step 1). */
  job_description: string | null;
  category: ContextCategory;
  status: ContextStatus;
  created_at_unix_ms: number;
  updated_at_unix_ms: number;
  /** Library docs attached at setup (Path A) — RagDocument ids. */
  source_doc_ids: string[];
  /** Whether Ally should auto-generate context (Path B) during ingest. */
  auto_generate_context: boolean;
  /** Whether web research runs during prep — defaults from the type template,
   * user-overridable (decision 2 — research gated by type). */
  research_enabled?: boolean;
  /** User-declared key terms/points — first-class highlight terms (Phase 3c). */
  key_terms?: string[];
  /** Glossary terms extracted from the generated digest (backend-derived). */
  glossary?: string[];
  /** Definition text captured alongside each surviving glossary term
   * (keyed by the exact term string in `glossary`) — empty/absent for
   * terms mined without a written definition. */
  glossary_definitions?: Record<string, string>;
  knowledge_profile_id: string | null;
  personas: ContextPersona[];
  chosen_persona_id: string | null;
  conversation_id: string | null;
  /** RagDocument id of the Ally-generated prep briefing, once generated. */
  dossier_doc_id: string | null;
  /** RagDocument id of the Stage-2 Research findings document, once
   * generated (replaced on regeneration, like the knowledge doc). */
  research_doc_id?: string | null;
  /** Opt-in deep interview Q&A research (Interview category only) —
   * costs meaningfully more searches/tokens than default research. */
  deep_qa_enabled?: boolean;
  /** RagDocument id of the generated Interview Q&A document, once
   * generated (replaced on regeneration). */
  qa_doc_id?: string | null;
  /** True when grounding inputs changed after resources were generated —
   * the digest/glossary no longer reflect the inputs (cleared by a
   * successful regeneration). Optional: older records omit it. */
  resources_stale?: boolean;
  /** When Stage 1-3 (generateDossier) last actually ran, if ever. Distinct
   *  from updated_at_unix_ms (which also bumps on a plain edit) — this is
   *  what the row's Regenerate-icon tooltip reads. null until the first
   *  regenerate. */
  resources_generated_at_unix_ms?: number | null;
}

/** Catalog entry for the Contexts list — carries enough to render the
 * readiness checklist without loading the full session per row. */
export interface ContextSummary {
  id: string;
  title: string;
  category: ContextCategory;
  status: ContextStatus;
  created_at_unix_ms: number;
  updated_at_unix_ms: number;
  source_doc_count: number;
  has_key_terms: boolean;
  research_enabled: boolean;
  has_job_description: boolean;
  has_generated_resources: boolean;
  /** Mirrors ConversationContext.resources_stale for the list row's pill. */
  resources_stale?: boolean;
  /** Mirrors ConversationContext.resources_generated_at_unix_ms for the
   *  list row's Regenerate-icon tooltip. */
  resources_generated_at_unix_ms?: number | null;
}

export type ModelStatusEvent =
  | { state: "downloading"; model: string; percent: number }
  | { state: "ready"; model: string }
  | { state: "error"; model: string; message: string };

/** Startup progress for the splash window — each stage is a real,
 *  completed background-initialization milestone. `percent`
 *  strictly increases across the sequence; there is no "100" stage —
 *  the splash closes once the main window's own `init()` resolves. */
export type SplashProgressEvent =
  | { stage: "started"; percent: number }
  | { stage: "library_loaded"; percent: number }
  | { stage: "workspace_ready"; percent: number }
  | { stage: "almost_ready"; percent: number }
  | { stage: "failed"; percent: number; message: string };

/** Mirror of conva-core llm::ProviderId (snake_case serde). */
export type ProviderId =
  | "anthropic"
  | "openai"
  | "google"
  | "xai"
  | "deepseek"
  | "ollama_local";

export interface ProviderInfo {
  id: ProviderId;
  name: string;
  default_quality_model: string;
  default_fast_model: string;
  requires_api_key: boolean;
  is_local: boolean;
}

export interface ModelSelection {
  provider: ProviderId;
  model: string;
}

/* ── Usage metering (mirror of conva_core::metering) ────────────────────────
   LLM tokens per provider + Tavily search count, for Settings → Usage. On the
   desktop this is BYO-key visibility; the hosted future turns it into billable
   credits (roadmap F8b). */

/** Running LLM usage for one provider. */
export interface ProviderUsage {
  provider: ProviderId;
  input_tokens: number;
  output_tokens: number;
  requests: number;
}

/**
 * Running LLM usage for one feature × provider × model bucket. `feature` is a
 * stable snake_case label owned by the Rust call site (the full set is listed
 * in `src-tauri/src/metering.rs`); failed attempts keep the tokens billed
 * before the failure.
 */
export interface LlmFeatureUsage {
  feature: string;
  provider: ProviderId;
  model: string;
  input_tokens: number;
  output_tokens: number;
  requests: number;
  failed_requests: number;
}

/** Usage snapshot with cross-provider running totals. */
export interface UsageSummary {
  providers: ProviderUsage[];
  /** Feature × provider × model buckets, heaviest (total tokens) first. */
  llm_features: LlmFeatureUsage[];
  total_input_tokens: number;
  total_output_tokens: number;
  total_requests: number;
  /** Tavily searches (Tavily bills per search, not per token). */
  tavily_searches: number;
  /** TTS characters synthesized (Aura bills per character). */
  tts_characters: number;
  /** Milliseconds an active session (Live or rehearsal) has run, summed
   *  across every stop. */
  listening_ms: number;
  /** When the current window opened (first record / last reset); 0 = never. */
  since_unix_ms: number;
  updated_at_unix_ms: number;
}

export interface AppConfig {
  asr_engine: "whisper_local" | "deepgram_cloud";
  whisper_model: string;
  llm_quality: ModelSelection;
  llm_fast: ModelSelection | null;
  consent_acknowledged: boolean;
  input_device: string | null;
  loopback_device: string | null;
  tracker_enabled: boolean;
  vad_neural: boolean;
  vad_sensitivity: number;
  /** Screenshot button's save folder override (right-click → "Set save
   *  location…"). `null` = the default `<Pictures>/conva-screenshots/`. */
  screenshot_save_dir: string | null;
  /** Display name for the account block (rail, Home greeting, Settings →
   *  Account). AppUI V5.0 decision 6: production shows the REAL user, so this
   *  is the user's own text, edited in Settings. `null` = fall back to the
   *  account email's local part — never a fabricated name. */
  profile_display_name: string | null;
  /** The user's own role/title line under their name. `null` renders no role
   *  at all rather than guessing one. */
  profile_role: string | null;
}

/** Mirror of conva-core audio::AudioDevice. */
export interface AudioDevice {
  id: string;
  name: string;
  side: StreamSide;
  is_default: boolean;
}

/** True when running inside the Tauri shell (vs a plain browser dev tab). */
export function isTauri(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

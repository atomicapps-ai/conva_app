/**
 * Typed mirror of the Rust IPC contract.
 *
 * Source of truth: crates/conva-core/src/ipc.rs — if that file changes,
 * this one changes in the same commit (ts-rs codegen replaces this hand
 * mirror later in Phase 1).
 */

/**
 * Legacy two-side model. The versioned capture/source/event contract (browser
 * product architecture M0) lives in `@/lib/capture/contract` — mirror of
 * `crates/conva-core/src/capture_contract.rs` — and maps these additively:
 * `outbound → self`, `inbound → remote_mix`. Nothing here changed.
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
  claimSnapshot: "conva://claim-snapshot",
  authChanged: "conva://auth-changed",
  partnerTerm: "conva://partner-term",
  partnerLock: "conva://partner-lock",
  splashProgress: "conva://splash-progress",
  contextGenerateProgress: "conva://context-generate-progress",
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
  /** False for view-only artifacts that must never enter retrieval. */
  searchable?: boolean;
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

/** Mirror of the shell's `avatar::AvatarBytes` — a downloaded avatar,
 *  base64-encoded for the IPC boundary (same convention as the screenshot
 *  command's `pngBase64`). */
export interface AvatarBytes {
  bytes_base64: string;
  mime: string;
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
export type CaptureTrigger =
  "question" | "task_frame" | "prep_reference" | "gap";
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

// ── FANER claim snapshot — mirrors claim/evidence/source_policy + ipc.rs ────
export const CLAIM_SNAPSHOT_CONTRACT_VERSION = 2;

export type FrameKind =
  | "question"
  | "request"
  | "claim"
  | "attributed_claim"
  | "decision"
  | "commitment"
  | "objection"
  | "requirement"
  | "definition"
  | "observation"
  | "opinion"
  | "prediction"
  | "correction";
export type Confidence = "unknown" | "low" | "medium" | "high";
export type Modality =
  | "asserted"
  | "reported"
  | "hedged"
  | "possible"
  | "hypothetical"
  | "questioned";
export type Sensitivity =
  "public" | "internal" | "private_personal" | "restricted";
export type ClaimConsequence = "low" | "medium" | "high";
export type ClaimState =
  | "detected"
  | "attributed"
  | "needs_clarification"
  | "queued"
  | "checking"
  | "supported"
  | "partly_supported"
  | "conflicting_evidence"
  | "not_verified"
  | "not_externally_verifiable"
  | "superseded"
  | "dismissed";
export type SuggestedAction =
  | "explain"
  | "recall"
  | "assist"
  | "synthesize"
  | "verify"
  | "resolve"
  | "link"
  | "track_claim"
  | "flag_conflict";
export interface ClaimAttribution {
  source_label: string;
  reporting_verb: string;
  directness:
    "direct_statement" | "reported_by_speaker" | "hearsay" | "unknown";
}
export interface ClaimQualifier {
  kind:
    | "quantity"
    | "date"
    | "time"
    | "location"
    | "condition"
    | "scope"
    | "cause"
    | "other";
  value: string;
  unit: string | null;
}
export interface ClaimReferenceCandidate {
  target_id: string;
  label: string;
  confidence: Confidence;
}
export interface ClaimReferenceEdge {
  surface_text: string;
  kind:
    | "pronoun"
    | "demonstrative"
    | "person_alias"
    | "artifact"
    | "event"
    | "place";
  required_for_verification: boolean;
  resolved_target_id: string | null;
  candidates: ClaimReferenceCandidate[];
}
export type ClaimImportanceReason =
  | "purpose_relevant"
  | "consequence_if_wrong"
  | "novel"
  | "specific_and_checkable"
  | "named_detail"
  | "conflicts_with_known_material"
  | "unresolved_reference"
  | "changes_decision"
  | "time_sensitive"
  | "repeated_without_change"
  | "already_supported_by_fresh_evidence"
  | "private_personal_assertion";
export type SourceClass =
  | "context_document"
  | "approved_internal_repository"
  | "primary_official"
  | "recognized_reporting"
  | "specialist_reference"
  | "community_material"
  | "general_web_discovery"
  | "model_knowledge";
export type AdmissionRejection =
  | "model_knowledge_cannot_verify"
  | "automatic_check_requires_user"
  | "normalized_claim_egress_denied"
  | "private_claim_egress_denied"
  | "open_web_disabled"
  | "source_class_not_allowed"
  | "blocked_domain"
  | "domain_not_allowed";
export type AdmissionDecision =
  | { decision: "admitted" }
  | { decision: "rejected"; reason: AdmissionRejection };
export type EvidenceScope = "attribution" | "underlying_proposition";
export type EvidenceStance =
  "supports" | "partly_supports" | "contradicts" | "inconclusive";
export type QualityAssessment = "unknown" | "weak" | "adequate" | "strong";
export interface EvidenceQuality {
  authority: QualityAssessment;
  directness: QualityAssessment;
  specificity: QualityAssessment;
  freshness: QualityAssessment;
  independence: QualityAssessment;
  completeness: QualityAssessment;
  provenance: QualityAssessment;
}
export interface ClaimEvidenceRecord {
  source_id: string;
  source_class: SourceClass;
  publisher: string;
  title: string;
  url: string | null;
  local_document_id: string | null;
  excerpt: string;
  addressed_claim_part: string;
  scope: EvidenceScope;
  stance: EvidenceStance;
  quality: EvidenceQuality;
  independence_group: string | null;
  admission: AdmissionDecision;
  admission_policy_id: string;
  admission_policy_version: number;
  published_at_unix_ms: number | null;
  retrieved_at_unix_ms: number;
}
export type ClaimConfidence =
  "none" | "limited" | "moderate" | "strong" | "conflicted";
export interface ClaimCorrection {
  kind:
    "transcript" | "attribution" | "reference" | "proposition" | "consequence";
  previous_value: string;
  corrected_value: string;
  corrected_by: string;
  created_at_unix_ms: number;
}
export interface ClaimRecord {
  id: string;
  source_segment_ids: string[];
  speaker_side: StreamSide;
  speaker_label: string | null;
  exact_quote: string;
  normalized_proposition: string;
  predicate: string;
  subject: string | null;
  object: string | null;
  frame_kind: FrameKind;
  attribution_chain: ClaimAttribution[];
  qualifiers: ClaimQualifier[];
  references: ClaimReferenceEdge[];
  modality: Modality;
  negated: boolean;
  sensitivity: Sensitivity;
  consequence: ClaimConsequence;
  importance_reasons: ClaimImportanceReason[];
  state: ClaimState;
  recommended_action: SuggestedAction | null;
  policy_id: string;
  policy_version: number;
  extraction_confidence: Confidence;
  resolution_confidence: Confidence;
  claim_confidence: ClaimConfidence | null;
  evidence: ClaimEvidenceRecord[];
  corrections: ClaimCorrection[];
  created_at_unix_ms: number;
  updated_at_unix_ms: number;
}

export interface ClaimSnapshotEvent {
  contract_version: number;
  session_id: string;
  epoch: number;
  revision: number;
  claims: ClaimRecord[];
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
  /** Complete typed claim state for a Tracking evidence view. `null` for
   *  terms, answers, and documents. Mirrors the Rust optional field. */
  claim: ClaimRecord | null;
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
  /** Exact live-session ids whose finalized transcript was saved here. */
  source_session_ids?: string[];
  /** Latest accepted cumulative claim snapshot for each linked session. */
  claim_snapshots?: ClaimSnapshotEvent[];
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
  source_session_count?: number;
  has_claim_review?: boolean;
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
  "interview" | "company_meeting" | "sales_call" | "live_stream" | "other";

/** The user's role in this Context. Mirrors
 * conva_core::context_snapshot::ParticipationLens. */
export type ParticipationLens =
  | "interviewer"
  | "interviewee"
  | "interview_observer_coach"
  | "meeting_lead"
  | "meeting_participant"
  | "meeting_presenter"
  | "meeting_decision_owner"
  | "meeting_observer"
  | "buyer"
  | "seller"
  | "sales_customer_success"
  | "sales_coach"
  | "live_host"
  | "live_guest"
  | "live_producer"
  | "live_moderator"
  | "other_speaker"
  | "other_listener"
  | "other_facilitator"
  | "other_advisor"
  | "other_presenter";

export type HighConsequenceRequirement =
  "primary_official_or_independent_reports" | "primary_official_only";

/** Exact source-admission and privacy policy used by claim checks. Mirrors
 * conva_core::source_policy::SourcePolicy. */
export interface SourcePolicy {
  id: string;
  version: number;
  allowed_classes: SourceClass[];
  allowed_domains: string[];
  blocked_domains: string[];
  allow_open_web: boolean;
  allow_normalized_claim_egress: boolean;
  allow_private_claim_egress: boolean;
  allow_cached_evidence: boolean;
  allow_automatic_checks: boolean;
  freshness_window_hours: number | null;
  minimum_independent_sources: number;
  high_consequence_requirement: HighConsequenceRequirement;
}

/** Lifecycle of a Context, start to finish. */
export type ContextStatus =
  "draft" | "ingesting" | "ready" | "running" | "ended";

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

export interface SuggestionDecision {
  status: "accepted" | "dismissed";
  /** User-edited replacement; absent means Ally's value was accepted verbatim. */
  edited_value?: string | null;
}

/** One Conversation Context record: Step 1 setup through Step 4 run. */
export interface ConversationContext {
  id: string;
  title: string;
  purpose: string;
  /** For interviews: the target role's job description (Step 1). */
  job_description: string | null;
  category: ContextCategory;
  /** Optional only because Contexts saved before claim intelligence omit it. */
  participation_lens?: ParticipationLens | null;
  /** Optional only because Contexts saved before claim intelligence omit it. */
  source_policy?: SourcePolicy | null;
  status: ContextStatus;
  created_at_unix_ms: number;
  updated_at_unix_ms: number;
  /** Library docs attached at setup (Path A) — RagDocument ids. */
  source_doc_ids: string[];
  /** Which attached doc ids are filed under which of the category's file
   * slots, keyed by slot key (see `categoryTemplates.ts`'s `ContextFileSlot`).
   * Purely organizational for the setup/detail UI. Optional: older records
   * (and any object literal that predates this field) read as empty —
   * every doc renders as unslotted ("Other documents") until re-filed. */
  slot_doc_ids?: Record<string, string[]>;
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
  /** Stable suggestion-key -> explicit decision. Missing means pending. */
  suggestion_decisions?: Record<string, SuggestionDecision>;
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
 *  completed initialization milestone. Ready is emitted only after the main
 *  window's own `init()` resolves, before the visible completion crossfade. */
export type SplashProgressEvent =
  | { stage: "started"; percent: number }
  | { stage: "library_loaded"; percent: number }
  | { stage: "workspace_ready"; percent: number }
  | { stage: "almost_ready"; percent: number }
  | { stage: "ready"; percent: number }
  | { stage: "failed"; percent: number; message: string };

/** Coarse progress ticks for the desktop "Generate/Regenerate Context
 *  resources" pipeline — `context.generateDossier` is one blocking round
 *  trip with no return until every stage finishes, so this is the only
 *  signal the UI gets for however long that takes. `percent` is a fixed
 *  checkpoint per stage, not a measured duration — there's no real ETA to
 *  give (depends on LLM + web-research latency), so treat it as "how far
 *  through", not "how long left". `researching` is only emitted when web
 *  research is enabled for the Context; a run with it off starts at
 *  `writing_qa`. Filter by `context_id` — nothing else scopes this event to
 *  a single generation run. */
export type ContextGenerateProgressEvent =
  | { stage: "researching"; context_id: string; percent: number }
  | { stage: "writing_qa"; context_id: string; percent: number }
  | { stage: "compiling_knowledge"; context_id: string; percent: number }
  | { stage: "saving"; context_id: string; percent: number };

/** Mirror of conva-core llm::ProviderId (snake_case serde). */
export type ProviderId =
  "anthropic" | "openai" | "google" | "xai" | "deepseek" | "ollama_local";

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
  /** Research-provider web searches (billed per search, not per token,
   *  regardless of which provider — Firecrawl/Anthropic web search/Tavily —
   *  is active). */
  research_searches: number;
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
  /** Web-research provider for Context resource generation. Firecrawl by
   *  default; switchable to Anthropic web search or Tavily so the three can
   *  be compared without a rebuild. */
  research_provider: "firecrawl" | "anthropic_web_search" | "tavily";
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

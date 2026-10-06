/**
 * Typed mirror of the Rust IPC contract.
 *
 * Source of truth: crates/conva-core/src/ipc.rs — if that file changes,
 * this one changes in the same commit (ts-rs codegen replaces this hand
 * mirror later in Phase 1).
 */

import type { StopReason } from "./stopReason";

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
  partnerViewState: "conva://partner-view-state",
  partnerViewAction: "conva://partner-view-action",
  splashProgress: "conva://splash-progress",
  contextGenerateProgress: "conva://context-generate-progress",
  liveAssist: "conva://live-assist",
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

/** Result of starting a live Context rehearsal. `voice_enabled` is false when
 *  no Deepgram key is configured (Aura TTS reuses it) — the rehearsal still
 *  runs, but text-only, so the UI should flag that instead of leaving the
 *  user wondering why the persona never speaks. */
export interface StartRehearsalResult {
  session_id: string;
  voice_enabled: boolean;
}

/** Live Context rehearsal phase — drives the speaking/active-speaker UI. */
export type RehearsalStateEvent =
  | { phase: "listening" }
  | { phase: "thinking" }
  | { phase: "speaking" }
  /** The reply was generated (and shown as text) but Aura TTS failed to
   *  speak it — a transient notice, always immediately followed by
   *  "listening". Surface it, don't drop it silently. */
  | { phase: "speech_failed"; error: string }
  | { phase: "ended" };

export interface AllyChunkEvent {
  request_id: string;
  token: string;
  done: boolean;
  error: string | null;
  /** Set with `done: true` on a stream that finished: why the model stopped.
   *  Absent on token chunks, errors and older peers; a missing value is
   *  treated as complete. Mirror of `AllyChunkEvent.stop_reason`. */
  stop_reason?: StopReason | null;
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
  /** Present for CSV / XLSX documents that also carry a typed table, so
   *  spreadsheet questions can be answered by exact arithmetic. */
  table?: TableInfo;
}

/** Mirror of `rag::TableInfo`. */
export interface TableInfo {
  rows: number;
  columns: number;
  /** False when the sheet's structure can't be totalled safely (merged
   *  cells, no header row, ...). It is still searchable as text. */
  supported: boolean;
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
  /** True when live assist is computing an exact answer for this question, so
   *  no model answer may be started for it. Absent on older emitters. */
  computed?: boolean;
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

// ── FANER phrase resolution — DEV-ONLY debug surface ─────────────────────────
// Mirrors `conva-core/src/phrase.rs` (trace), `phrase_eval.rs` (eval cases),
// `capture.rs` (`ArgumentTrace`), and `src-tauri/src/faner_debug.rs` +
// `capture.rs` (`ReplayOutcome`). Produced only by the `faner_debug_*` /
// `faner_replay` commands; never part of a production payload.

export interface SignalTrace {
  /** `context term` | `boost` | `document phrase` | `document overlap` |
   *  `entity/acronym` | `rarity` | `domain lexicon (core)` |
   *  `domain lexicon (extended)` */
  source: string;
  weight: number;
}

export interface SpanTrace {
  /** Char offsets into the analysed text. */
  start: number;
  end: number;
  /** The transcript's own text (original casing). */
  text: string;
  status: "selected" | "contained";
  /** The longer phrase that swallowed this occurrence, when `contained`. */
  container: string | null;
}

/** Why a highlighted term is shown — drives its visual weight. Mirrors
 *  `conva_core::phrase::HighlightOrigin` (snake_case). */
export type HighlightOrigin =
  "context" | "document" | "entity" | "domain" | "rarity";

/** One highlighted term with its origin — the return of `analyze_terms`.
 *  Mirrors `conva_core::ipc::HighlightTerm`. */
export interface HighlightTerm {
  term: string;
  origin: HighlightOrigin;
}

export interface CandidateTrace {
  term: string;
  /** Normalized identity, e.g. `api gateway`. */
  key: string;
  score: number;
  signals: SignalTrace[];
  spans: SpanTrace[];
  decision: "selected" | "rejected";
  reason: string;
  origin: HighlightOrigin;
}

export interface DebugHighlightRequest {
  text: string;
  terms: string[];
  docText: string;
  useActiveContext: boolean;
  /** Bundled domain pack ids to apply in manual mode. */
  lexiconPacks: string[];
}

export interface DebugHighlightResponse {
  /** Exactly what `relevant_terms` returns — what a bubble would render. */
  terms: string[];
  /** Origin of each entry of `terms`, index for index. */
  origins: HighlightOrigin[];
  trace: CandidateTrace[];
  source: "manual" | "active_context";
  knownTerms: string[];
  activeContextTerms: string[];
  activeScopeDocCount: number;
  /** Domain packs this run used. */
  packs: string[];
  /** Packs the app's active Context has selected right now. */
  activePacks: string[];
}

export interface FanerEvalCase {
  id: string;
  seed: number;
  transcript: string;
  known_terms: string[];
  expected_terms: string[];
  forbidden_terms: string[];
}

export interface FanerEvalResult {
  case: FanerEvalCase;
  actual_terms: string[];
  /** null when the case declares no expectations. */
  passed: boolean | null;
  failures: string[];
  trace: CandidateTrace[];
}

export type ArgumentOutcome =
  "kept" | "canonicalized" | "rewritten" | "unverified" | "dropped";

export interface ArgumentTrace {
  capture_index: number;
  raw: string;
  resolved: string;
  outcome: ArgumentOutcome;
  reason: string;
  container: string | null;
  matched_text: string | null;
}

/** `faner_replay` result: raw model captures vs. the deterministic
 *  phrase-resolved captures the live path emits, plus the per-argument trace. */
export interface ReplayOutcome {
  raw: Capture[];
  resolved: Capture[];
  trace: ArgumentTrace[];
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

/** Mirror of `ipc.rs::ViewFact` — one labelled fact row under a View item. */
export interface ViewFact {
  label: string;
  value: string;
}

/** Mirror of `ipc.rs::ViewItem` — one item in View (4); the wire form of the
 *  UI's `AllyFocusItem` (`viewMirror.ts` converts). */
export interface ViewItem {
  id: string;
  group: "question" | "prep" | "term" | "commitment" | "mention";
  question: string;
  answer: string;
  source_label: string;
  source_files: string[];
  status: "instant" | "streaming" | "ready" | "error";
  card_id: string | null;
  found_id: string | null;
  tier: "field" | "specialized" | null;
  kind: "concept" | "problem" | null;
  facts: ViewFact[];
  /** A structured grid answer (spreadsheet totals); `answer` still carries
   *  the speakable Say-now line. */
  table?: GridPayload | null;
  /** A question waiting on the user's pick (ambiguous column or file). */
  choice?: ViewChoice | null;
  /** True when a newer question replaced this live-assist result. */
  stale?: boolean;
}

/** Mirror of `ipc.rs::ViewChoice`. */
export interface ViewChoice {
  question: string;
  options: ChoiceOption[];
}

/** Mirror of `ipc.rs::ViewState` — everything View (4) shows. The main
 *  window owns the truth; the partner window mirrors it. */
export interface ViewState {
  items: ViewItem[];
  active_id: string | null;
  pinned_ids: string[];
}

// ---------------------------------------------------------------------------
// Table datasets (mirror of `crates/conva-core/src/table.rs`,
// `table_aggregate.rs`, `table_query.rs`). Numbers travel as plain decimal
// strings ("1234.50"): exact, and safe for JavaScript. The UI never does
// arithmetic on them.
// ---------------------------------------------------------------------------

export const TABLE_SCHEMA_VERSION = 1;

export type RawKind =
  | "text"
  | "number"
  | "formula_value"
  | "formula_no_value"
  | "error";
export type CellKind = "blank" | "number" | "text" | "unusable";
export type ColumnKind = "number" | "text" | "empty";

export interface TableCell {
  raw: string;
  kind: CellKind;
  /** Exact decimal string when `kind === "number"`. */
  number?: string;
}

export interface TableColumn {
  index: number;
  header: string;
  kind: ColumnKind;
  currency?: string;
  percent: boolean;
  scale: number;
}

export interface TableRow {
  /** One-based row number in the source sheet. */
  source_row: number;
  cells: TableCell[];
  /** Source row of the earlier row this one exactly repeats. */
  duplicate_of?: number;
  /** A "Total" line inside the data; never aggregated. */
  subtotal: boolean;
}

export type IssueCode =
  | "blank_values"
  | "malformed_numbers"
  | "formula_without_value"
  | "duplicate_rows"
  | "ragged_rows"
  | "duplicate_headers"
  | "blank_header"
  | "subtotal_row_skipped"
  | "group_variants_merged"
  | "blank_group"
  | "mixed_currency"
  | "other_sheets_ignored";

export interface TableIssue {
  code: IssueCode;
  column?: number;
  /** First 20 affected source rows. */
  rows: number[];
  /** True number of affected rows. */
  count: number;
  message: string;
}

export type UnsupportedReason =
  | "merged_cells"
  | "no_header_row"
  | "no_data_rows"
  | "too_many_rows"
  | "empty_sheet";

export interface TableDataset {
  schema_version: number;
  doc_id: string;
  file_name: string;
  sheet?: string;
  columns: TableColumn[];
  rows: TableRow[];
  issues: TableIssue[];
  /** Empty when the sheet can be aggregated safely. */
  unsupported: UnsupportedReason[];
}

export type AggFunc = "sum" | "count" | "average" | "min" | "max";
export type DuplicatePolicy = "keep_all" | "exclude_exact";

export interface ColumnRef {
  index: number;
  header: string;
}

/** Mirror of `table_aggregate::AggregatePlan`. */
export interface AggregatePlan {
  schema_version: number;
  doc_id: string;
  func: AggFunc;
  /** `null` only for `count`. */
  measure: ColumnRef | null;
  group_by: ColumnRef[];
  duplicates: DuplicatePolicy;
}

/** Mirror of `table_query::ChoiceOption`. */
export interface ChoiceOption {
  /** Column index or document id, as text. */
  id: string;
  label: string;
  detail?: string;
}

// ---------------------------------------------------------------------------
// Live assist (mirror of `ipc.rs`). Progressive answers that need real
// computation: a holding response, then the finished source-linked grid,
// under one `result_id` with a rising `revision`.
// ---------------------------------------------------------------------------

export const LIVE_ASSIST_CONTRACT_VERSION = 1;

export type LiveAssistKind = "table_aggregate";

export type LiveAssistLifecycle =
  | "provisional"
  | "needs_choice"
  | "complete"
  | "declined"
  | "failed"
  | "superseded";

/** Where a figure came from: the file, the column and the rows. */
export interface SourceRef {
  doc_id: string;
  file_name: string;
  sheet?: string;
  column?: string;
  /** First source rows that contributed (capped at 20). */
  rows: number[];
  /** True number of rows that contributed. */
  row_count: number;
}

export type GridAlign = "left" | "right";

export interface GridColumn {
  key: string;
  label: string;
  align: GridAlign;
}

export interface GridCell {
  /** Display text, e.g. `$439,519.85`. */
  text: string;
  /** Exact machine value as a plain decimal string, for number cells. */
  value?: string;
  /** Provenance; absent for labels. */
  sources?: SourceRef[];
}

export type GridRowKind = "body" | "total";

export interface GridRow {
  kind: GridRowKind;
  cells: GridCell[];
}

export type NoticeLevel = "info" | "caution";

export interface GridNotice {
  level: NoticeLevel;
  text: string;
  rows?: number[];
}

export interface GridPayload {
  title: string;
  columns: GridColumn[];
  rows: GridRow[];
  notices: GridNotice[];
  source_files: string[];
}

export type LiveAssistPayload =
  | { type: "text"; text: string }
  | ({ type: "grid" } & GridPayload)
  | { type: "choice"; question: string; options: ChoiceOption[] };

/** Milliseconds measured from `enqueued_at_unix_ms`. */
export interface LiveAssistTiming {
  enqueued_at_unix_ms: number;
  /** Enqueue to holding response emitted. */
  holding_ms?: number | null;
  /** Enqueue to this revision emitted. */
  emitted_ms?: number | null;
  /** Time spent computing (excludes queueing). */
  compute_ms?: number | null;
}

export interface LiveAssistResult {
  contract_version: number;
  result_id: string;
  /** Ties the result to its turn: `{session}:them:{seq}` or `ask:ask:{n}`. */
  correlation_id: string;
  session_id: string;
  context_id?: string | null;
  /** Rises with every emission of the same `result_id`. */
  revision: number;
  kind: LiveAssistKind;
  lifecycle: LiveAssistLifecycle;
  question: string;
  say_now?: string | null;
  payload?: LiveAssistPayload | null;
  timing: LiveAssistTiming;
  /** Set when `lifecycle === "superseded"`: the newer result's id. */
  superseded_by?: string | null;
}

/** Return value of `live_assist_submit`. */
export interface LiveAssistAck {
  /** False when the text is not a data request; hand it to Ally as usual. */
  handled: boolean;
  result_id?: string | null;
}

/** True once no further revision of a result is expected. */
export function isFinalLifecycle(l: LiveAssistLifecycle): boolean {
  return l !== "provisional" && l !== "needs_choice";
}

/** Mirror of `ipc.rs::ViewActionKind`. */
export type ViewActionKind = "select" | "pin" | "elaborate" | "ask" | "choose";

/** Mirror of `ipc.rs::ViewAction` — what the user did in View (4). */
export interface ViewAction {
  kind: ViewActionKind;
  id: string;
  text?: string | null;
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
  /** User-marked favorite (owner, 2026-09-15) — survives "Generate personas"
   *  for this same context instead of being discarded with the rest. Scoped
   *  to one context for now; reuse across different contexts is a separate,
   *  larger feature. */
  favorite: boolean;
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
  /** Replies that hit the output cap (successful stream, cut-off text). */
  cut_off_requests?: number;
  /** Replies the provider declined or filtered. */
  refused_requests?: number;
  /** Replies that streamed but could not be used (unparseable JSON). */
  unusable_replies?: number;
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

/* ── Local telemetry queue (mirror of conva_core::telemetry_events) ─────────
   docs/platform/15-events-implementation.md §6, §9. The wire shape only —
   the taxonomy + per-event field validation this mirrors is in
   src/lib/telemetry/events.ts, hand-kept in lockstep with
   crates/conva-core/src/telemetry_events.rs the same way ipc.ts mirrors the
   rest of the Rust↔TS contract. */

/** One taxonomy event, exactly as stored in `<app-data>/telemetry/events.jsonl`
 *  and as `/api/events`/`/api/live/events` expect it. Counts, timings, enums
 *  and booleans only — no free text, no identifiers of user content. */
export interface TelemetryEvent {
  ev: string;
  seq: number;
  /** Unix ms — when the event occurred (client clock). */
  t: number;
  schema_v: number;
  session_id: string | null;
  app_version: string;
  /** `"desktop"` | `"web"`. */
  platform: string;
  fields: Record<string, unknown>;
}

export interface AppConfig {
  asr_engine: "whisper_local" | "deepgram_cloud";
  whisper_model: string;
  llm_quality: ModelSelection;
  llm_fast: ModelSelection | null;
  consent_acknowledged: boolean;
  /** The first-run "How should Ally think?" choice was made or skipped. */
  ai_setup_completed: boolean;
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
  /** Auto-stop a listening session after this many minutes with no new
   *  transcribed speech on either side — releases the mic/loopback devices
   *  and finalizes any recording instead of burning resources unattended.
   *  `null` disables it. Settings → Devices offers presets + a custom value. */
  idle_stop_minutes: number | null;
  /** "Send nothing to an AI provider": no conversation or library content
   *  goes to a remote provider (LLM, cloud transcription, cloud speech, web
   *  research). Local providers stay allowed. Default off. */
  offline_mode: boolean;
  /** Content-free usage events (counts and feature use, never audio,
   *  transcripts or documents). Default on; off stops collection and deletes
   *  the unsent queue, unless the server marks the account as a beta
   *  participant (`TelemetryStatus.required`). */
  telemetry_enabled: boolean;
}

/** Count and total size for one kind of data kept on this computer. */
export interface LocalDataCategory {
  count: number;
  bytes: number;
}

/** Mirror of conva-core `ipc::LocalDataSummary` (Settings → Privacy → Your data on this computer). */
export interface LocalDataSummary {
  data_dir: string | null;
  recordings: LocalDataCategory;
  conversations: LocalDataCategory;
  session_logs: LocalDataCategory;
  /** `count` is documents; `bytes` includes the originals. */
  library: LocalDataCategory;
  contexts: LocalDataCategory;
  /** Usage counts and the diagnostics log; `count` is files. */
  diagnostics: LocalDataCategory;
  /** Downloaded speech and embedding models. Not personal; kept on erase. */
  models: LocalDataCategory;
}

/** One call recording. `id` is the file name (`call-<epoch ms>.wav`). */
export interface RecordingInfo {
  id: string;
  started_unix_ms: number;
  duration_ms: number | null;
  size_bytes: number;
}

export interface DeleteRecordingsReport {
  deleted: number;
  freed_bytes: number;
  /** Ids that could not be deleted (invalid, already gone, or in use). */
  failed: string[];
}

export interface EraseOptions {
  /** Also remove API keys from the OS credential store. Off by default. */
  include_keys: boolean;
}

/** What an erase did; read once after the app restarts. */
export interface EraseReport {
  removed_files: number;
  removed_bytes: number;
  /** Paths (relative to the app-data folder) that could not be removed. */
  failed: string[];
  keys_removed: boolean;
  finished_unix_ms: number;
}

/** Mirror of the shell's `telemetry_status` command. */
export interface TelemetryStatus {
  /** The user's setting. */
  enabled: boolean;
  /** The server says this account's beta terms require usage data; the
   *  switch is locked on. */
  required: boolean;
  /** What is actually happening: `enabled || required`. */
  collecting: boolean;
  /** Absolute path of the local, inspectable event log, when known. */
  log_path: string | null;
}

/** Error string a remote call refused by `offline_mode` carries. */
export const OFFLINE_MODE_ERROR = "offline_mode";

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

/* ── `.cva` archive operation contract (checkpoint A) ────────────────────────
 * Mirror of the `.cva archive operation contract` block in
 * `crates/conva-core/src/ipc.rs` — see that file's MAINTENANCE comment.
 * OPERATION-level types only (what `ConvaBackend.archive` exchanges with the
 * shell/hosted API), never the pure portable DTOs
 * (`PortableContextV1`/`PortableConversationV1`/...), which stay Rust-side —
 * an inspection preview is a deliberately reduced, sanitized view, not a raw
 * payload. No adapter implements these operations yet: every capability
 * answers "unimplemented" (`capabilitySnapshot.ts`) until real ZIP I/O and
 * persistence exist behind it (`.cva` spec checkpoints B+). */

/** What to export: a Context alone, or a saved conversation optionally
 *  bundled with its linked Context (spec §2.4). */
export type ArchiveExportScope =
  | { kind: "context"; context_id: string }
  | { kind: "conversation"; conversation_id: string; include_context: boolean };

/** User choice controlling source-document inclusion (spec §2.4). */
export interface ArchiveExportOptions {
  include_source_documents: boolean;
}

/** A coarse, content-free size/privacy estimate shown before the user
 *  commits to writing the file (spec §8.2). Never a preview of document or
 *  transcript text. */
export interface ArchiveExportEstimate {
  document_count: number;
  estimated_bytes: number;
  includes_source_documents: boolean;
}

/** Result of a completed export. */
export interface ArchiveExportResult {
  /** Desktop: the saved file path. Web: an opaque download reference the UI
   *  already used to trigger the browser download — never a raw local path
   *  on either platform beyond what the OS save dialog itself shows. */
  destination: string;
  archive_digest: string;
  bytes: number;
}

/** Sanitized summary of one Context inside an inspected archive — never the
 *  raw portable Context DTO. */
export interface ArchiveContextPreview {
  title: string;
  category: ContextCategory;
  key_terms_count: number;
  prepared_qa_count: number;
  has_source_documents: boolean;
}

/** Sanitized summary of one conversation inside an inspected archive. */
export interface ArchiveConversationPreview {
  title: string;
  created_at_unix_ms: number;
  segment_count: number;
  speaker_count: number;
  duration_ms: number;
  has_claim_review: boolean;
}

/** One document/generated-artifact entry as shown in the import preview
 *  (spec §8.3) — `included` is false for a metadata-only reference whose
 *  original bytes were not part of this export. */
export interface ArchiveDocumentPreview {
  portable_id: string;
  file_name: string;
  bytes: number | null;
  included: boolean;
}

/** Non-blocking compatibility/duplicate signals shown in the import preview
 *  (spec §7.2). Never a reason to refuse the preview itself — only to shape
 *  the default "Import as copy" choice. */
export type ArchiveCompatibilityWarning =
  | { kind: "duplicate_archive_digest" }
  | { kind: "duplicate_document"; portable_id: string }
  | { kind: "possible_duplicate_context" }
  | { kind: "possible_duplicate_conversation" }
  | { kind: "unsupported_document"; portable_id: string; reason: string }
  | { kind: "migrated_from_older_version"; from_format_version: number };

/** Side-effect-free preview of a selected/uploaded `.cva`. Selecting a file
 *  must never itself create a record (spec §8.3) — this is the entire
 *  result of that inspection step. */
export interface ArchiveInspection {
  archive_digest: string;
  format_version: number;
  created_by_app_version: string;
  created_at: string;
  title: string;
  context: ArchiveContextPreview | null;
  conversation: ArchiveConversationPreview | null;
  documents: ArchiveDocumentPreview[];
  warnings: ArchiveCompatibilityWarning[];
}

/** User decisions confirmed on the import preview screen (spec §8.3):
 *  editable destination titles plus which previewed documents to actually
 *  bring in vs. reuse an existing identical one. */
export interface ArchiveImportOptions {
  context_title?: string | null;
  conversation_title?: string | null;
  include_document_ids: string[];
  reuse_exact_document_ids?: string[];
}

/** One document the importer declined to bring in, with a user-facing
 *  reason (spec §5.3/§6.3) — the import itself still succeeds for the rest. */
export interface ArchiveOmittedDocument {
  portable_id: string;
  reason: string;
}

/** Result of a completed import (spec §8.3/§9). IDs are always freshly
 *  minted destination IDs — an import never reuses a portable/source ID. */
export interface ArchiveImportResult {
  context_id: string | null;
  conversation_id: string | null;
  imported_document_ids: string[];
  reused_document_ids: string[];
  omitted_documents: ArchiveOmittedDocument[];
}

/** Streamed progress for an in-flight export/import/inspect operation (spec
 *  §10), delivered over `conva://archive-progress` — `operation_id` scopes
 *  cancellation and lets the UI ignore stale events from an operation it
 *  already gave up on. Never carries transcript or document content, only
 *  coarse counts and a safe display message. */
export type ArchiveProgressEvent =
  | { phase: "hashing"; operation_id: string; processed_bytes: number; total_bytes: number }
  | { phase: "writing_entries"; operation_id: string; processed_items: number; total_items: number }
  | { phase: "validating"; operation_id: string }
  | { phase: "importing"; operation_id: string; processed_items: number; total_items: number }
  | { phase: "completed"; operation_id: string }
  | { phase: "cancelled"; operation_id: string }
  | { phase: "failed"; operation_id: string; message: string };

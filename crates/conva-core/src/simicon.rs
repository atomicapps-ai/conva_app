//! Simicon — Simulated Conversation: the data model.
//!
//! A **Simicon** is a rehearsal of a high-stakes call (interview, financial
//! review, pitch). The user sets a name + purpose + category and attaches
//! library documents (or asks Ally to generate context); an async pipeline
//! builds a reusable [`KnowledgeProfile`] (library docs + bounded web research,
//! embedded into the RAG store); the AI generates [`SimiconPersona`] options and
//! the user picks one; then a real-time session runs the chosen counterparty.
//!
//! Distinct from `conversations` (saved real transcripts) and `session`
//! (per-listen JSONL) — a finished Simicon **saves as** a `Conversation`, and a
//! [`KnowledgeProfile`] can be reattached to a future Simicon *or* a live call.
//!
//! These are pure data types (no OS/storage deps), mirrored to TypeScript in
//! `src/lib/ipc.ts`. Persistence + the async pipeline live in the shell
//! (`src-tauri/src/simicon.rs`, Phase A.2).

use serde::{Deserialize, Serialize};

/// The kind of call being rehearsed — drives persona generation + the web
/// research prompts.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SimiconCategory {
    Interview,
    FinancialReview,
    PerformanceReview,
    SalesPitch,
    Other,
}

/// Lifecycle of a Simicon, start to finish.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SimiconStatus {
    /// Being set up (Step 1).
    Draft,
    /// Building the knowledge profile — ingest + web research (Step 2).
    Ingesting,
    /// Personas generated, awaiting the user's Start (Step 3).
    Ready,
    /// A live simulated session is in progress (Step 4).
    Running,
    /// The session finished; its transcript is saved as a `Conversation`.
    Ended,
}

/// One generated counterparty persona/strategy option (three per session,
/// Step 3), one of which the AI flags [`recommended`](Self::recommended).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SimiconPersona {
    pub id: String,
    /// e.g. "Highly technical & skeptical CFO".
    pub title: String,
    /// One-paragraph summary of how this counterparty behaves, shown to the user
    /// before they choose.
    pub summary: String,
    /// Short style tags that seed the roleplay system prompt (e.g. "skeptical",
    /// "behavioral", "time-pressured").
    #[serde(default)]
    pub style_tags: Vec<String>,
    /// The AI's suggested pick for this meeting context.
    pub recommended: bool,
}

/// A web-research source folded into a [`KnowledgeProfile`] (Step 2), kept for
/// grounding and provenance.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ResearchSource {
    pub title: String,
    pub url: String,
    /// Short extracted snippet stored alongside the embedded chunk.
    pub snippet: String,
    pub fetched_at_unix_ms: u64,
}

/// The reusable, indexed knowledge base for a Simicon — attached library
/// documents + bounded web research, embedded into the RAG store. **Reusable**:
/// attach the same profile to a later Simicon or to a live call by id.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct KnowledgeProfile {
    pub id: String,
    pub title: String,
    pub created_at_unix_ms: u64,
    pub updated_at_unix_ms: u64,
    /// `RagDocument` ids from the shared library this profile indexes (both
    /// user-attached files and Ally-generated context land in the library).
    #[serde(default)]
    pub doc_ids: Vec<String>,
    /// Bounded web-research results (Step 2).
    #[serde(default)]
    pub research: Vec<ResearchSource>,
    /// Whether ingest + indexing has completed and the profile is queryable.
    pub ready: bool,
}

/// One simulated-conversation record: Step 1 setup through Step 4 run.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SimiconSession {
    pub id: String,
    /// e.g. "Senior Accountant Interview with CFO".
    pub title: String,
    /// The user's goal, e.g. "Prep for technical GAAP questions + leadership
    /// scenarios".
    pub purpose: String,
    pub category: SimiconCategory,
    pub status: SimiconStatus,
    pub created_at_unix_ms: u64,
    pub updated_at_unix_ms: u64,
    /// The knowledge profile driving this session (reusable; referenced by id).
    #[serde(default)]
    pub knowledge_profile_id: Option<String>,
    /// The generated persona options (Step 3).
    #[serde(default)]
    pub personas: Vec<SimiconPersona>,
    /// The persona the user chose to run against.
    #[serde(default)]
    pub chosen_persona_id: Option<String>,
    /// Once run, the resulting transcript is saved as a `Conversation` (by id).
    #[serde(default)]
    pub conversation_id: Option<String>,
}

/// Catalog entry for the Simicon list view (cheap to list without loading the
/// full record + personas).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SimiconSummary {
    pub id: String,
    pub title: String,
    pub category: SimiconCategory,
    pub status: SimiconStatus,
    pub created_at_unix_ms: u64,
    pub updated_at_unix_ms: u64,
}

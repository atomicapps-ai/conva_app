//! SimCon — Simulated Conversation: the data model.
//!
//! A **SimCon** is a rehearsal of a high-stakes call (interview, financial
//! review, pitch). The user sets a name + purpose + category and attaches
//! library documents (or asks Ally to generate context); an async pipeline
//! builds a reusable [`KnowledgeProfile`] (library docs + bounded web research,
//! embedded into the RAG store); the AI generates [`SimConPersona`] options and
//! the user picks one; then a real-time session runs the chosen counterparty.
//!
//! Distinct from `conversations` (saved real transcripts) and `session`
//! (per-listen JSONL) — a finished SimCon **saves as** a `Conversation`, and a
//! [`KnowledgeProfile`] can be reattached to a future SimCon *or* a live call.
//!
//! These are pure data types (no OS/storage deps), mirrored to TypeScript in
//! `src/lib/ipc.ts`. Persistence + the async pipeline live in the shell
//! (`src-tauri/src/simcon.rs`, Phase A.2).

use serde::{Deserialize, Serialize};

/// The kind of call being rehearsed — drives persona generation + the web
/// research prompts.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SimConCategory {
    Interview,
    FinancialReview,
    PerformanceReview,
    SalesPitch,
    Other,
}

/// Lifecycle of a SimCon, start to finish.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SimConStatus {
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
pub struct SimConPersona {
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

/// The reusable, indexed knowledge base for a SimCon — attached library
/// documents + bounded web research, embedded into the RAG store. **Reusable**:
/// attach the same profile to a later SimCon or to a live call by id.
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
pub struct SimConSession {
    pub id: String,
    /// e.g. "Senior Accountant Interview with CFO".
    pub title: String,
    /// The user's goal, e.g. "Prep for technical GAAP questions + leadership
    /// scenarios".
    pub purpose: String,
    /// For interviews (and similar roles), the target role's job description
    /// (Step 1). Grounds the counterparty's questions.
    #[serde(default)]
    pub job_description: Option<String>,
    pub category: SimConCategory,
    pub status: SimConStatus,
    pub created_at_unix_ms: u64,
    pub updated_at_unix_ms: u64,
    /// Library documents attached at setup (Step 1, Path A) — `RagDocument` ids
    /// the ingestion phase folds into the `KnowledgeProfile`.
    #[serde(default)]
    pub source_doc_ids: Vec<String>,
    /// Whether Ally should auto-generate context (Step 1, Path B) during ingest.
    #[serde(default)]
    pub auto_generate_context: bool,
    /// The knowledge profile driving this session (reusable; referenced by id).
    #[serde(default)]
    pub knowledge_profile_id: Option<String>,
    /// The generated persona options (Step 3).
    #[serde(default)]
    pub personas: Vec<SimConPersona>,
    /// The persona the user chose to run against.
    #[serde(default)]
    pub chosen_persona_id: Option<String>,
    /// Once run, the resulting transcript is saved as a `Conversation` (by id).
    #[serde(default)]
    pub conversation_id: Option<String>,
}

/// Catalog entry for the SimCon list view (cheap to list without loading the
/// full record + personas).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SimConSummary {
    pub id: String,
    pub title: String,
    pub category: SimConCategory,
    pub status: SimConStatus,
    pub created_at_unix_ms: u64,
    pub updated_at_unix_ms: u64,
}

impl SimConCategory {
    /// Human phrase for prompts.
    pub fn label(self) -> &'static str {
        match self {
            SimConCategory::Interview => "job interview",
            SimConCategory::FinancialReview => "financial review",
            SimConCategory::PerformanceReview => "performance review",
            SimConCategory::SalesPitch => "sales pitch",
            SimConCategory::Other => "high-stakes conversation",
        }
    }
}

// ── Persona generation (Step 3) — pure prompt + parser ──────────────────────

/// Build the `(system, user)` prompt for generating 3 counterparty personas.
pub fn persona_prompt(session: &SimConSession) -> (String, String) {
    let system = "You generate realistic counterparty personas for rehearsing a \
high-stakes conversation. Return ONLY a JSON array of exactly 3 objects, each with \
keys: \"title\" (a short label), \"summary\" (2–3 sentences on how this person \
behaves in the room), \"style_tags\" (3–5 short lowercase strings), and \
\"recommended\" (boolean — set exactly one persona true, the best fit for this \
context). No prose, no markdown, no code fences."
        .to_string();

    let mut user = format!(
        "Rehearsal type: {}\nName: {}\nGoal: {}\n",
        session.category.label(),
        session.title,
        session.purpose,
    );
    if let Some(jd) = &session.job_description {
        if !jd.trim().is_empty() {
            user.push_str(&format!("Job description:\n{}\n", jd.trim()));
        }
    }
    user.push_str(
        "\nGenerate the 3 distinct counterparty personas the user should be ready \
to face, spanning different styles/difficulties.",
    );
    (system, user)
}

/// Parse the LLM's persona JSON into [`SimConPersona`]s, assigning ids. Tolerant:
/// extracts the first JSON array from the text (models sometimes wrap it in
/// prose/fences) and returns empty on malformed output. Ensures exactly one
/// persona is flagged recommended.
pub fn parse_personas(text: &str) -> Vec<SimConPersona> {
    #[derive(Deserialize)]
    struct Gen {
        title: String,
        #[serde(default)]
        summary: String,
        #[serde(default)]
        style_tags: Vec<String>,
        #[serde(default)]
        recommended: bool,
    }

    let slice = match (text.find('['), text.rfind(']')) {
        (Some(a), Some(b)) if b > a => &text[a..=b],
        _ => return Vec::new(),
    };
    let gens: Vec<Gen> = serde_json::from_str(slice).unwrap_or_default();

    let mut out: Vec<SimConPersona> = gens
        .into_iter()
        .filter(|g| !g.title.trim().is_empty())
        .enumerate()
        .map(|(i, g)| SimConPersona {
            id: format!("p{}", i + 1),
            title: g.title,
            summary: g.summary,
            style_tags: g.style_tags,
            recommended: g.recommended,
        })
        .collect();

    if !out.is_empty() && !out.iter().any(|p| p.recommended) {
        out[0].recommended = true;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_extracts_array_and_forces_one_recommended() {
        let text = r#"Here you go:
        [{"title":"Skeptical CFO","summary":"Tough.","style_tags":["skeptical"]},
         {"title":"Behavioral VP","summary":"Warm.","recommended":false}]"#;
        let p = parse_personas(text);
        assert_eq!(p.len(), 2);
        assert_eq!(p[0].id, "p1");
        assert!(p[0].recommended, "first is forced recommended when none set");
    }

    #[test]
    fn parse_returns_empty_on_garbage() {
        assert!(parse_personas("no json here").is_empty());
    }
}

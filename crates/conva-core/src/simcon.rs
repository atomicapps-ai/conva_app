//! SimCon — Simulated Conversation: the data model.
//!
//! A **SimCon** is a rehearsal of a high-stakes call (interview, company
//! meeting, sales call). The user sets a name + purpose + type and attaches
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

use crate::asr::TranscriptSegment;
use crate::audio::StreamSide;
use crate::llm::LlmRequest;
use crate::rag::ScoredChunk;

/// Reserved id of the always-present default context ("General conversation")
/// — a baseline briefing Ally grounds in when nothing more specific has been
/// chosen (session-grounding design, "required selection" — a fresh install
/// has this from first launch, so requiring a selection never locks out
/// Start Listening). System-managed: not user-deletable. Precedes the
/// community-voting + LLM-inference evolution (design doc, not yet built).
pub const DEFAULT_CONTEXT_ID: &str = "default";

/// The kind of conversation this context is for — drives the setup template
/// (documents to collect + digest sections), persona generation, and the
/// web-research default. The launch set (Interview · Company Meeting ·
/// Sales Call · Other) is fixed but extensible later; see
/// `conva_core/docs/technical/conversation-context.md`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SimConCategory {
    Interview,
    CompanyMeeting,
    SalesCall,
    Other,
}

/// One attachable document slot in a conversation type's setup template.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FileSlot {
    /// Stable key for wiring the upload control (e.g. "resume").
    pub key: &'static str,
    /// Human label shown in the setup wizard (e.g. "Résumé / CV").
    pub label: &'static str,
    /// Whether the user can attach more than one file to this slot.
    pub multiple: bool,
}

/// The per-type setup + generation template: which documents to collect, what
/// the Context Digest should contain, and whether web research is on by
/// default. Static and derived from [`SimConCategory`] — the single source of
/// truth for both the setup UI and the generation pipeline.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ConversationTemplate {
    /// Human phrase for prompts (e.g. "job interview").
    pub label: &'static str,
    /// Document slots offered at setup, in display order.
    pub file_slots: &'static [FileSlot],
    /// Section headings the generated digest should contain.
    pub digest_sections: &'static [&'static str],
    /// Web research on by default? (Interview/Sales yes; internal meetings no —
    /// their documents are confidential and open-web results are often wrong.)
    pub default_research_enabled: bool,
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
    /// Whether autonomous web research runs during preparation. Defaults from
    /// the type template ([`SimConCategory::default_research_enabled`]) at
    /// setup and is user-overridable (decision 2 — research gated by type).
    #[serde(default)]
    pub research_enabled: bool,
    /// User-declared key terms/points for this context ("Key contexts" at
    /// setup). First-class highlight terms during the conversation (Phase 3c).
    #[serde(default)]
    pub key_terms: Vec<String>,
    /// Glossary terms extracted from the generated Context Digest — derived, not
    /// user-entered. Joined with [`key_terms`](Self::key_terms) to drive
    /// context-aware highlighting.
    #[serde(default)]
    pub glossary: Vec<String>,
    /// The definition text captured alongside each surviving glossary term
    /// (spec 2026-08-26, cached term definitions) — keyed by the exact term
    /// string as it appears in [`glossary`](Self::glossary) (both derive
    /// from the same sanitized extraction, so lookup is an exact match).
    /// Empty for terms mined without a written definition (heuristic
    /// per-document mining, JD mining) — those still fall back to a live
    /// Ally lookup on Define.
    #[serde(default)]
    pub glossary_definitions: std::collections::BTreeMap<String, String>,
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
    /// The `RagDocument` id of the Ally-generated prep briefing, if one has been
    /// generated (also included in the profile's `doc_ids` so it grounds too).
    #[serde(default)]
    pub dossier_doc_id: Option<String>,
    /// The `RagDocument` id of the Stage-2 **Research findings** document,
    /// if one has been generated (also in the profile's `doc_ids`).
    /// Replaced on regeneration, like the knowledge document.
    #[serde(default)]
    pub research_doc_id: Option<String>,
    /// True when a grounding input (documents, job description, key terms,
    /// research toggle) changed after resources were generated — the digest/
    /// glossary no longer reflect the inputs. Set by the shell's save paths,
    /// cleared by a successful dossier regeneration.
    #[serde(default)]
    pub resources_stale: bool,
}

/// Catalog entry for the SimCon list view (cheap to list without loading the
/// full record + personas). Carries just enough to render the Conversation
/// Context list row's readiness checklist without an extra load per row (the
/// "at least one grounding source" gate — Conversation Context UI design).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SimConSummary {
    pub id: String,
    pub title: String,
    pub category: SimConCategory,
    pub status: SimConStatus,
    pub created_at_unix_ms: u64,
    pub updated_at_unix_ms: u64,
    /// Number of library documents attached at setup.
    #[serde(default)]
    pub source_doc_count: u32,
    /// Whether the user declared any key terms.
    #[serde(default)]
    pub has_key_terms: bool,
    /// Whether web research is enabled for this context.
    #[serde(default)]
    pub research_enabled: bool,
    /// Whether a job description is attached (Interview-only relevance).
    #[serde(default)]
    pub has_job_description: bool,
    /// Whether the Context Digest has been generated at least once.
    #[serde(default)]
    pub has_generated_resources: bool,
    /// Mirrors [`SimConSession::resources_stale`] for the list row's pill.
    #[serde(default)]
    pub resources_stale: bool,
}

impl SimConCategory {
    /// Human phrase for prompts (e.g. "job interview").
    pub fn label(self) -> &'static str {
        self.template().label
    }

    /// Whether web research is on by default for this type (decision 2).
    pub fn default_research_enabled(self) -> bool {
        self.template().default_research_enabled
    }

    /// The setup + generation template for this type — the single source of
    /// truth for the setup wizard's document slots, the digest's sections, and
    /// the web-research default.
    pub fn template(self) -> ConversationTemplate {
        match self {
            SimConCategory::Interview => ConversationTemplate {
                label: "job interview",
                file_slots: &[
                    FileSlot {
                        key: "resume",
                        label: "Résumé / CV",
                        multiple: false,
                    },
                    FileSlot {
                        key: "job_description",
                        label: "Job description",
                        multiple: false,
                    },
                    FileSlot {
                        key: "interview_test",
                        label: "Take-home / test",
                        multiple: true,
                    },
                ],
                digest_sections: &[
                    "Role profile",
                    "Core vocabulary",
                    "Likely questions & strong answers",
                    "Facts & figures",
                ],
                default_research_enabled: true,
            },
            SimConCategory::CompanyMeeting => ConversationTemplate {
                label: "company meeting",
                file_slots: &[
                    FileSlot {
                        key: "financials",
                        label: "Financials / reports",
                        multiple: true,
                    },
                    FileSlot {
                        key: "decks",
                        label: "Decks",
                        multiple: true,
                    },
                    FileSlot {
                        key: "minutes",
                        label: "Prior minutes",
                        multiple: true,
                    },
                ],
                digest_sections: &["Key figures", "Core vocabulary", "Likely discussion points"],
                default_research_enabled: false,
            },
            SimConCategory::SalesCall => ConversationTemplate {
                label: "sales call",
                file_slots: &[FileSlot {
                    key: "account",
                    label: "Prospect / account docs",
                    multiple: true,
                }],
                // Core vocabulary included so sales contexts harvest highlight
                // terms like every other category (extract_glossary reads it).
                digest_sections: &[
                    "Company background",
                    "Core vocabulary",
                    "Objections",
                    "Talking points",
                ],
                default_research_enabled: true,
            },
            SimConCategory::Other => ConversationTemplate {
                label: "high-stakes conversation",
                file_slots: &[FileSlot {
                    key: "files",
                    label: "Files",
                    multiple: true,
                }],
                digest_sections: &["Core vocabulary", "Summary", "Likely questions"],
                default_research_enabled: false,
            },
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

// ── Live rehearsal (Step 4) — the counterparty's spoken turn ────────────────

/// Character budget for the transcript window fed to the persona (≈spoken
/// context; newest turns win when it bites).
const LIVE_TRANSCRIPT_CHAR_BUDGET: usize = 6_000;
/// Character budget for grounding (RAG chunks + research snippets).
const LIVE_REFERENCE_CHAR_BUDGET: usize = 4_000;

/// Build the LLM request for the AI counterparty's **next spoken turn** in a
/// live rehearsal. The model roleplays `persona`, grounded in the knowledge
/// profile (RAG `chunks` + `research`), replying to the conversation so far.
///
/// From the model's point of view it *is* the counterparty, so turns are
/// relabeled: the human's turns (outbound) are `User:` and the persona's own
/// prior turns (inbound) are `You:`. Output is spoken aloud, so the system
/// prompt asks for short, natural speech — no markdown, no stage directions.
pub fn persona_live_prompt(
    session: &SimConSession,
    persona: &SimConPersona,
    research: &[ResearchSource],
    segments: &[TranscriptSegment],
    chunks: &[ScoredChunk],
    max_tokens: u32,
) -> LlmRequest {
    let style = if persona.style_tags.is_empty() {
        String::new()
    } else {
        format!(" Your style: {}.", persona.style_tags.join(", "))
    };

    let mut system = format!(
        "You are roleplaying the user's counterparty in a {category} so they can \
rehearse. Stay fully in character as:\n{title} — {summary}{style}\n\n\
The user is the other person in the room. Speak ONLY as your character, in the \
first person, one turn at a time. This is spoken conversation: keep each reply \
short and natural (1–4 sentences), no markdown, no lists, no stage directions, \
no narration — just what your character says out loud. Stay realistic and \
specific using the background material. Never break character and never say you \
are an AI or that this is a simulation.",
        category = session.category.label(),
        title = persona.title,
        summary = persona.summary,
        style = style,
    );
    if let Some(jd) = session.job_description.as_deref() {
        let jd = jd.trim();
        if !jd.is_empty() {
            system.push_str(&format!(
                "\n\nThe role under discussion (for context you'd realistically \
know):\n{}",
                jd.chars().take(1_500).collect::<String>()
            ));
        }
    }

    // Grounding: RAG chunks first, then research snippets, under one budget.
    let mut reference = String::new();
    for chunk in chunks {
        let block = format!(
            "[source: {} — {}]\n{}\n\n",
            chunk.file_name, chunk.location, chunk.text
        );
        if reference.len() + block.len() > LIVE_REFERENCE_CHAR_BUDGET {
            break;
        }
        reference.push_str(&block);
    }
    for src in research {
        let block = format!("[web: {}]\n{}\n\n", src.title, src.snippet);
        if reference.len() + block.len() > LIVE_REFERENCE_CHAR_BUDGET {
            break;
        }
        reference.push_str(&block);
    }

    // Transcript window: newest-first until the budget is spent, then restore
    // order. Persona = inbound ("You:"), human = outbound ("User:").
    let mut lines: Vec<String> = Vec::new();
    let mut used = 0usize;
    for segment in segments.iter().rev() {
        if !segment.is_final || segment.text.trim().is_empty() {
            continue;
        }
        let who = match segment.side {
            StreamSide::Inbound => "You",
            StreamSide::Outbound => "User",
        };
        let line = format!("{who}: {}\n", segment.text.trim());
        if used + line.len() > LIVE_TRANSCRIPT_CHAR_BUDGET {
            break;
        }
        used += line.len();
        lines.push(line);
    }
    lines.reverse();

    let mut user = String::new();
    if !reference.is_empty() {
        user.push_str("Background material:\n\n");
        user.push_str(&reference);
    }
    if lines.is_empty() {
        user.push_str(
            "The rehearsal is just starting. Open the conversation with your \
first line, in character.\n",
        );
    } else {
        user.push_str("Conversation so far:\n\n");
        user.push_str(&lines.concat());
        user.push_str(&format!(
            "\nIt's your turn. Reply as {}, in character.",
            persona.title
        ));
    }

    LlmRequest {
        system,
        user,
        max_tokens,
    }
}

// ── Prep dossier — Ally-authored briefing document ──────────────────────────

/// Reference budget for the knowledge prompt (docs + research it synthesizes).
const DOSSIER_REFERENCE_CHAR_BUDGET: usize = 10_000;

/// Build the prompt for the Stage-1 **Context Knowledge** document (the
/// logic layer of the two-stage grounding pipeline, spec 2026-08-26): one
/// dense, high-signal briefing Ally *writes* from the context's documents +
/// web research, saved back to the library as a readable document and
/// re-indexed into RAG. Its sections come from the type's template
/// ([`ConversationTemplate::digest_sections`]) so the document is tailored
/// to the conversation — role profile and likely Q&A for an interview, key
/// figures for a meeting, and so on — and its `## Core vocabulary` section
/// carries the 20–30-term contract `extract_glossary` harvests. Distinct
/// from retrieval — this is synthesis (see
/// `conva_core/docs/technical/conversation-context.md`).
pub fn knowledge_prompt(
    session: &SimConSession,
    research: &[ResearchSource],
    chunks: &[ScoredChunk],
    max_tokens: u32,
) -> LlmRequest {
    let template = session.category.template();
    // Required sections, in order: a short overview, the type's own sections,
    // then watch-outs. Each becomes a `## ` Markdown heading.
    let mut sections: Vec<&str> = Vec::with_capacity(template.digest_sections.len() + 2);
    sections.push("Overview");
    sections.extend(template.digest_sections.iter().copied());
    sections.push("Watch-outs");
    let section_list = sections.join(", ");

    let system = format!(
        "You are Ally, writing a Context Knowledge document — one dense, \
high-signal briefing the user (and later the AI) will rely on before a \
{label}. Write it in Markdown with exactly these `##` sections, in this \
order: {sections}. Give `## Overview` 2–3 sentences; keep the other \
sections tight and scannable — short bullets, **bold** the key term, name, \
or figure in each. EXCEPTION — `## Core vocabulary` must be thorough, not \
tight: list 20–30 terms the other party is likely to actually say — \
services, tools, acronyms, methodologies, named practices — as bullets of \
the form `**Term** — one-line why it matters here`, drawn from the job \
description FIRST, then the documents; use exact product and service names \
verbatim (e.g. \"API Gateway\", never just \"Gateway\"). Ground everything \
strictly in the provided material: be specific, never generic, and never \
invent facts or figures. Output only the Markdown document — no preamble.",
        label = template.label,
        sections = section_list,
    );

    let mut reference = String::new();
    for chunk in chunks {
        let block = format!("[{}]\n{}\n\n", chunk.file_name, chunk.text);
        if reference.len() + block.len() > DOSSIER_REFERENCE_CHAR_BUDGET {
            break;
        }
        reference.push_str(&block);
    }
    for src in research {
        let block = format!("[web: {}]\n{}\n\n", src.title, src.snippet);
        if reference.len() + block.len() > DOSSIER_REFERENCE_CHAR_BUDGET {
            break;
        }
        reference.push_str(&block);
    }

    let mut user = format!("Context: {}\nGoal: {}\n", session.title, session.purpose);
    if let Some(jd) = session.job_description.as_deref() {
        let jd = jd.trim();
        if !jd.is_empty() {
            user.push_str(&format!(
                "Role / job description:\n{}\n",
                jd.chars().take(8_000).collect::<String>()
            ));
        }
    }
    if reference.is_empty() {
        user.push_str(
            "\nNo documents or research were provided — write the digest from \
what a well-prepared person should know for this conversation, and keep it \
clearly general.",
        );
    } else {
        user.push_str("\nMaterial to synthesize:\n\n");
        user.push_str(&reference);
    }

    LlmRequest {
        system,
        user,
        max_tokens,
    }
}

/// The bounded research query set for a context — base queries from its
/// topic/type/goal/JD, plus up to 2 queries seeded from Stage 1's mined
/// vocabulary (spec 2026-08-26 stage 2: "smarter queries"). Pure; the
/// shell passes its budget as `cap` and issues the searches.
pub fn research_queries(session: &SimConSession, vocabulary: &[String], cap: usize) -> Vec<String> {
    let topic = if session.title.trim().is_empty() {
        session.category.label().to_string()
    } else {
        session.title.trim().to_string()
    };
    let mut q = vec![
        format!("{topic} common questions"),
        format!("how to prepare for a {}", session.category.label()),
    ];
    if !session.purpose.trim().is_empty() {
        q.push(session.purpose.trim().chars().take(120).collect());
    }
    if let Some(jd) = &session.job_description {
        let jd = jd.trim();
        if !jd.is_empty() {
            q.push(format!(
                "interview questions for role: {}",
                jd.chars().take(120).collect::<String>()
            ));
        }
    }
    // Vocabulary-seeded queries: the terms the other party will actually
    // say make the sharpest search keys (e.g. "Amazon Interview API
    // Gateway Terraform interview questions").
    for chunk in vocabulary.chunks(3).take(2) {
        q.push(format!(
            "{topic} {} {}",
            chunk.join(" "),
            session.category.label()
        ));
    }
    q.truncate(cap);
    q
}

/// Prompt for the Stage-2 **Research findings** document: synthesize the
/// collected web sources into a human-readable, cited brief the user can
/// inspect (and RAG can chunk by its `##` sections).
pub fn research_findings_prompt(session: &SimConSession, sources: &[ResearchSource]) -> LlmRequest {
    let template = session.category.template();
    let system = format!(
        "You are Ally, writing a Research Findings document from web \
sources gathered for a {label}. Organize the findings into themed `##` \
sections (you choose the themes — e.g. likely question areas, company \
signals, process/format intel). Every finding bullet MUST cite its source \
inline as a Markdown link: [source title](url). Only state what the \
sources support — never invent. End with a `## Sources` section listing \
every source as `- [title](url)`. Output only the Markdown document — no \
preamble.",
        label = template.label,
    );

    let mut user = format!(
        "Context: {}\nGoal: {}\n\nSources:\n\n",
        session.title, session.purpose
    );
    for src in sources {
        user.push_str(&format!(
            "[{}]({})\n{}\n\n",
            src.title, src.url, src.snippet
        ));
    }

    LlmRequest {
        system,
        user,
        max_tokens: 2000,
    }
}

/// Broader query set for the deep interview Q&A pass (spec 2026-08-26,
/// part A) — many more queries than [`research_queries`], deliberately
/// aimed at question BANKS rather than general background. No fixed
/// per-role count is baked in here; breadth comes from more queries and a
/// bigger source budget (the shell's `QA_MAX_QUERIES`/`QA_MAX_SOURCES`),
/// and the synthesis prompt decides how many distinct pairs the material
/// actually supports.
pub fn qa_research_queries(
    session: &SimConSession,
    vocabulary: &[String],
    cap: usize,
) -> Vec<String> {
    let topic = if session.title.trim().is_empty() {
        session.category.label().to_string()
    } else {
        session.title.trim().to_string()
    };
    let role = session
        .job_description
        .as_deref()
        .map(|jd| jd.trim())
        .filter(|jd| !jd.is_empty())
        .map(|jd| jd.chars().take(80).collect::<String>())
        .unwrap_or_else(|| topic.clone());

    let mut q = vec![
        format!("{topic} most common interview questions"),
        format!("top interview questions for {role}"),
        format!("{role} technical interview questions"),
        format!("{role} behavioral interview questions"),
        format!("{topic} interview questions and answers"),
    ];
    for chunk in vocabulary.chunks(3).take(3) {
        q.push(format!("{} interview questions {}", chunk.join(" "), topic));
    }
    q.truncate(cap);
    q
}

/// Prompt for the deep interview Q&A pass's document: synthesize the
/// gathered sources into a standalone bank of real, distinct question +
/// strong-answer pairs — spec 2026-08-26 part A. Themed `##` sections
/// (the model chooses themes that fit what the sources support); each
/// entry `**Q: ...** A: ...` so it reads well AND is harvestable by
/// `extract_glossary_entries` incidentally. At least 20 pairs, up to 100
/// — driven by how much the material supports, not a fixed target.
pub fn interview_qa_prompt(session: &SimConSession, sources: &[ResearchSource]) -> LlmRequest {
    let template = session.category.template();
    let system = format!(
        "You are Ally, building an Interview Q&A bank from web sources \
gathered for a {label}. Organize into themed `##` sections (e.g. \
Behavioral, Technical, Company & role-specific — choose themes that fit \
what the sources actually support). Each entry: a bullet in the form \
`**Q: <question>** A: <strong, specific answer>`, grounded strictly in \
the sources — never invent a question or fact the sources don't support. \
Produce as many DISTINCT, well-supported pairs as the material justifies \
— at least 20, up to 100; do not pad with near-duplicates to hit a \
number, and do not stop early if the sources clearly support more. \
Output only the Markdown document — no preamble.",
        label = template.label,
    );

    let mut user = format!(
        "Context: {}\nGoal: {}\n\nSources:\n\n",
        session.title, session.purpose
    );
    for src in sources {
        user.push_str(&format!(
            "[{}]({})\n{}\n\n",
            src.title, src.url, src.snippet
        ));
    }

    LlmRequest {
        system,
        user,
        max_tokens: 6000,
    }
}

// ── Glossary extraction — digest → context-highlight terms (Phase 3c) ────────

/// Max glossary terms harvested from a digest.
const MAX_GLOSSARY_TERMS: usize = 32;

/// Extract `(term, definition)` pairs from a generated Context Digest — the
/// entries under its `## Glossary` or `## Core vocabulary` section (or, when
/// that section is missing entirely, every **bolded** phrase in the digest —
/// spec B.3's truncation fallback). The definition is whatever text follows
/// the term on its line (after the closing `**`, or after the first
/// em/en-dash or colon when the term isn't bolded), trimmed of leading
/// punctuation/whitespace and capped at 200 chars; empty when nothing
/// follows. Case-insensitively deduped by term, capped at
/// [`MAX_GLOSSARY_TERMS`]. Pure; [`extract_glossary`] is a thin wrapper over
/// this that keeps only the term (existing callers, existing behavior); the
/// shell also reads the definition half to cache instant term lookups
/// (spec 2026-08-26, cached term definitions).
pub fn extract_glossary_entries(digest_md: &str) -> Vec<(String, String)> {
    fn clean_definition(raw: &str) -> String {
        raw.trim()
            .trim_start_matches(['—', '–', ':', '-'])
            .trim()
            .chars()
            .take(200)
            .collect()
    }

    let mut out: Vec<(String, String)> = Vec::new();
    let mut in_section = false;

    for raw in digest_md.lines() {
        let line = raw.trim();
        if let Some(title) = line.strip_prefix("## ") {
            let t = title.trim();
            in_section =
                t.eq_ignore_ascii_case("glossary") || t.eq_ignore_ascii_case("core vocabulary");
            continue;
        }
        if !in_section || line.is_empty() {
            continue;
        }
        let content = line.trim_start_matches(['-', '*', '+', '•']).trim_start();
        let (term, definition) = if let Some(rest) = content.strip_prefix("**") {
            let mut parts = rest.splitn(2, "**");
            let term = parts.next().unwrap_or("").trim().to_string();
            let definition = clean_definition(parts.next().unwrap_or(""));
            (term, definition)
        } else {
            let mut parts = content.splitn(2, ['—', '–', ':']);
            let term = parts
                .next()
                .unwrap_or("")
                .trim_matches(['*', ' '])
                .to_string();
            let definition = clean_definition(parts.next().unwrap_or(""));
            (term, definition)
        };
        if term.is_empty() || term.chars().count() > 60 {
            continue;
        }
        if !out.iter().any(|(t, _)| t.eq_ignore_ascii_case(&term)) {
            out.push((term, definition));
        }
        if out.len() >= MAX_GLOSSARY_TERMS {
            break;
        }
    }
    // Fallback (spec B.3): a digest cut off before its ## Glossary section
    // still bolds the key term in each bullet per the prompt — harvest
    // every **bolded** phrase (plus whatever follows it on the line, up to
    // the next bold marker) instead of yielding nothing.
    if out.is_empty() {
        for raw in digest_md.lines() {
            let mut rest = raw;
            while let Some(start) = rest.find("**") {
                let after = &rest[start + 2..];
                let Some(end) = after.find("**") else { break };
                let term = after[..end].trim().to_string();
                let mut tail = &after[end + 2..];
                if let Some(next_bold) = tail.find("**") {
                    tail = &tail[..next_bold];
                }
                let definition = clean_definition(tail);
                rest = &after[end + 2..];
                if term.is_empty() || term.chars().count() > 60 {
                    continue;
                }
                if !out.iter().any(|(t, _)| t.eq_ignore_ascii_case(&term)) {
                    out.push((term, definition));
                }
                if out.len() >= MAX_GLOSSARY_TERMS {
                    return out;
                }
            }
        }
    }
    out
}

/// Extract just the glossary TERMS (see [`extract_glossary_entries`] for the
/// full term+definition pairs). Pure; the shell stores the result on the
/// context (`SimConSession::glossary`) to drive context-aware highlighting
/// (see `docs/technical/highlighting-relevance.md`).
pub fn extract_glossary(digest_md: &str) -> Vec<String> {
    extract_glossary_entries(digest_md)
        .into_iter()
        .map(|(term, _)| term)
        .collect()
}

/// True when any grounding input differs between two versions of a context —
/// the signal that derived resources (glossary, dossier) no longer reflect
/// the inputs. Job description compares trimmed (`None` ≡ empty); key terms
/// and source docs compare as order-insensitive sets; research toggle
/// compares directly. Non-grounding edits (title, purpose, personas, status)
/// never count.
pub fn grounding_changed(old: &SimConSession, new: &SimConSession) -> bool {
    fn norm_jd(jd: Option<&str>) -> &str {
        jd.map(str::trim).unwrap_or("")
    }
    fn as_set(items: &[String]) -> std::collections::BTreeSet<&str> {
        items.iter().map(String::as_str).collect()
    }
    norm_jd(old.job_description.as_deref()) != norm_jd(new.job_description.as_deref())
        || as_set(&old.key_terms) != as_set(&new.key_terms)
        || as_set(&old.source_doc_ids) != as_set(&new.source_doc_ids)
        || old.research_enabled != new.research_enabled
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
        assert!(
            p[0].recommended,
            "first is forced recommended when none set"
        );
    }

    #[test]
    fn parse_returns_empty_on_garbage() {
        assert!(parse_personas("no json here").is_empty());
    }

    #[test]
    fn every_type_has_a_nonempty_template() {
        for cat in [
            SimConCategory::Interview,
            SimConCategory::CompanyMeeting,
            SimConCategory::SalesCall,
            SimConCategory::Other,
        ] {
            let t = cat.template();
            assert!(!t.label.is_empty());
            assert!(!t.file_slots.is_empty(), "{cat:?} has file slots");
            assert!(!t.digest_sections.is_empty(), "{cat:?} has digest sections");
            // Every category's digest must carry a Core vocabulary section —
            // extract_glossary harvests it into context-highlight terms, and
            // a category without one silently produces contexts that never
            // highlight (the empty "From your documents" bug, 2026-08-21).
            assert!(
                t.digest_sections.contains(&"Core vocabulary"),
                "{cat:?} digest has a Core vocabulary section"
            );
            assert_eq!(cat.label(), t.label);
        }
    }

    #[test]
    fn research_defaults_match_decision_two() {
        // Interview + sales: on (public info helps). Internal meeting: off.
        assert!(SimConCategory::Interview.default_research_enabled());
        assert!(SimConCategory::SalesCall.default_research_enabled());
        assert!(!SimConCategory::CompanyMeeting.default_research_enabled());
        assert!(!SimConCategory::Other.default_research_enabled());
    }

    fn sample_session() -> SimConSession {
        SimConSession {
            id: "s1".into(),
            title: "Senior Accountant Interview".into(),
            purpose: "Prep for GAAP questions".into(),
            job_description: Some("Own the monthly close.".into()),
            category: SimConCategory::Interview,
            status: SimConStatus::Ready,
            created_at_unix_ms: 0,
            updated_at_unix_ms: 0,
            source_doc_ids: vec![],
            auto_generate_context: false,
            research_enabled: true,
            key_terms: vec![],
            glossary: vec![],
            glossary_definitions: std::collections::BTreeMap::new(),
            knowledge_profile_id: None,
            personas: vec![],
            chosen_persona_id: None,
            conversation_id: None,
            dossier_doc_id: None,
            research_doc_id: None,
            resources_stale: false,
        }
    }

    fn persona() -> SimConPersona {
        SimConPersona {
            id: "p1".into(),
            title: "Skeptical CFO".into(),
            summary: "Direct, numbers-first.".into(),
            style_tags: vec!["skeptical".into(), "technical".into()],
            recommended: true,
        }
    }

    fn seg(side: StreamSide, seq: u64, text: &str) -> TranscriptSegment {
        TranscriptSegment {
            side,
            seq,
            text: text.to_string(),
            is_final: true,
            start_ms: seq * 1000,
            end_ms: seq * 1000 + 900,
            confidence: None,
            latency_ms: 100,
        }
    }

    #[test]
    fn live_prompt_roleplays_persona_and_relabels_turns() {
        let segments = vec![
            seg(StreamSide::Outbound, 0, "Hi, thanks for meeting me."),
            seg(StreamSide::Inbound, 1, "Let's get into the numbers."),
            seg(StreamSide::Outbound, 2, "Sure, ask away."),
        ];
        let req = persona_live_prompt(&sample_session(), &persona(), &[], &segments, &[], 300);

        assert!(req.system.contains("Skeptical CFO"));
        assert!(req.system.contains("job interview"));
        assert!(req.system.contains("Own the monthly close."), "JD included");
        // Human = User:, persona = You:
        assert!(req.user.contains("User: Hi, thanks for meeting me."));
        assert!(req.user.contains("You: Let's get into the numbers."));
        assert!(req.user.contains("It's your turn"));
    }

    #[test]
    fn live_prompt_opens_when_no_turns_yet() {
        let req = persona_live_prompt(&sample_session(), &persona(), &[], &[], &[], 300);
        assert!(req.user.contains("Open the conversation"));
    }

    #[test]
    fn knowledge_prompt_has_sections_and_synthesizes_material() {
        let chunks = vec![ScoredChunk {
            document_id: "d1".into(),
            file_name: "resume.pdf".into(),
            location: "p1".into(),
            text: "Led the monthly close for 3 years.".into(),
            score: 0.9,
        }];
        let req = knowledge_prompt(&sample_session(), &[], &chunks, 1200);
        // Interview digest carries the interview template's sections + label.
        assert!(req.system.contains("job interview"));
        assert!(req.system.contains("Overview"));
        assert!(req.system.contains("Likely questions"));
        assert!(req.system.contains("Facts & figures"));
        assert!(req.system.contains("Watch-outs"));
        assert!(req.user.contains("Led the monthly close"));
    }

    #[test]
    fn knowledge_prompt_has_fixed_interview_sections_and_vocab_contract() {
        let mut s = sample_session();
        // A JD longer than the old 2,000-char slice, with the key service
        // name appearing only past that point.
        let mut jd = "Senior DevOps Engineer. ".repeat(100); // ~2,400 chars
        jd.push_str("Experience with API Gateway and Lambda required.");
        s.job_description = Some(jd);
        let req = knowledge_prompt(&s, &[], &[], 3000);
        for section in [
            "Role profile",
            "Core vocabulary",
            "Likely questions & strong answers",
            "Facts & figures",
            "Watch-outs",
        ] {
            assert!(req.system.contains(section), "missing section {section}");
        }
        assert!(req.system.contains("20"), "vocab floor missing");
        assert!(req.system.contains("30"), "vocab ceiling missing");
        assert!(
            req.system.to_lowercase().contains("verbatim"),
            "verbatim-names instruction missing"
        );
        // The full JD reaches the prompt — past the old 2,000-char cut.
        assert!(req.user.contains("API Gateway"), "JD truncated too early");
        assert_eq!(req.max_tokens, 3000);
    }

    #[test]
    fn extract_glossary_pulls_bold_terms_from_the_section() {
        let digest = "## Overview\nSome intro.\n\n## Glossary\n\
- **Pensive theory** — a way of reasoning under doubt.\n\
- **GAAP**: accounting standards.\n\
- Deferred revenue – money not yet earned.\n\n\
## Watch-outs\n- **Not a glossary term** here.";
        let g = extract_glossary(digest);
        assert!(g.iter().any(|t| t == "Pensive theory"), "{g:?}");
        assert!(g.iter().any(|t| t == "GAAP"), "{g:?}");
        assert!(g.iter().any(|t| t == "Deferred revenue"), "{g:?}");
        // Terms outside the Glossary section are not harvested.
        assert!(!g.iter().any(|t| t.contains("Not a glossary")), "{g:?}");
    }

    #[test]
    fn extract_glossary_falls_back_to_bolded_phrases_without_a_section() {
        // A digest truncated before its ## Glossary section (the 2026-08-26
        // Amazon-interview failure) still bolds key terms inline per the
        // prompt — harvest those instead of yielding nothing.
        let md = "## Overview\nStrong match.\n\n## Strong talking points\n\
                  - Used **Terraform** and **EKS** on the account.\n\
                  - Governance via **HashiCorp Sentinel**.\n\
                  - Standards adopted across **12 engineering teams**.";
        let terms = extract_glossary(md);
        assert!(terms.iter().any(|t| t == "Terraform"), "{terms:?}");
        assert!(terms.iter().any(|t| t == "EKS"), "{terms:?}");
        assert!(terms.iter().any(|t| t == "HashiCorp Sentinel"), "{terms:?}");
    }

    #[test]
    fn extract_glossary_prefers_the_real_section_when_present() {
        let md = "## Glossary\n- **RRF** — rank fusion.\n\n## Notes\n\
                  Also mentions **Terraform** in prose.";
        let terms = extract_glossary(md);
        assert_eq!(terms, vec!["RRF".to_string()]);
    }

    #[test]
    fn extract_glossary_reads_core_vocabulary_heading() {
        let digest = "## Overview\nIntro.\n\n## Core vocabulary\n\
- **API Gateway** — managed API front door.\n\
- **Terraform** — IaC tool.\n\n## Watch-outs\n- none";
        let g = extract_glossary(digest);
        assert!(g.iter().any(|t| t == "API Gateway"), "{g:?}");
        assert!(g.iter().any(|t| t == "Terraform"), "{g:?}");
    }

    #[test]
    fn extract_glossary_caps_at_thirty_two() {
        let mut digest = String::from("## Core vocabulary\n");
        for i in 0..40 {
            digest.push_str(&format!("- **Term number {i}** — meaning.\n"));
        }
        assert_eq!(extract_glossary(&digest).len(), 32);
    }

    #[test]
    fn dossier_sections_are_type_specific() {
        // A company meeting gets its own sections, not the interview's.
        let mut session = sample_session();
        session.category = SimConCategory::CompanyMeeting;
        let req = knowledge_prompt(&session, &[], &[], 1200);
        assert!(req.system.contains("company meeting"));
        assert!(req.system.contains("Key figures"));
        assert!(req.system.contains("Likely discussion points"));
        assert!(!req.system.contains("Your talking points"));
    }

    fn grounding_base() -> SimConSession {
        SimConSession {
            id: "sim-1".into(),
            title: "Acme interview".into(),
            purpose: "Prep".into(),
            job_description: Some("Build on AWS.".into()),
            category: SimConCategory::Interview,
            status: SimConStatus::Ready,
            created_at_unix_ms: 0,
            updated_at_unix_ms: 0,
            source_doc_ids: vec!["doc-a".into(), "doc-b".into()],
            auto_generate_context: false,
            research_enabled: true,
            key_terms: vec!["GAAP".into()],
            glossary: vec!["EKS".into()],
            glossary_definitions: std::collections::BTreeMap::new(),
            knowledge_profile_id: Some("kp-1".into()),
            personas: Vec::new(),
            chosen_persona_id: None,
            conversation_id: None,
            dossier_doc_id: Some("dossier-1".into()),
            research_doc_id: None,
            resources_stale: false,
        }
    }

    #[test]
    fn grounding_changed_detects_each_grounding_input() {
        let old = grounding_base();

        let mut jd = grounding_base();
        jd.job_description = Some("Build on Azure.".into());
        assert!(grounding_changed(&old, &jd));

        let mut terms = grounding_base();
        terms.key_terms.push("SOX".into());
        assert!(grounding_changed(&old, &terms));

        let mut docs = grounding_base();
        docs.source_doc_ids = vec!["doc-a".into()];
        assert!(grounding_changed(&old, &docs));

        let mut research = grounding_base();
        research.research_enabled = false;
        assert!(grounding_changed(&old, &research));
    }

    #[test]
    fn grounding_changed_ignores_non_grounding_edits_and_ordering() {
        let old = grounding_base();

        // Same sets, different order + a renamed title/purpose: no change.
        let mut same = grounding_base();
        same.title = "Renamed".into();
        same.purpose = "New purpose".into();
        same.source_doc_ids = vec!["doc-b".into(), "doc-a".into()];
        same.glossary = vec!["different".into()];
        same.status = SimConStatus::Ended;
        assert!(!grounding_changed(&old, &same));

        // None vs empty/whitespace JD is not a change.
        let mut old_no_jd = grounding_base();
        old_no_jd.job_description = None;
        let mut new_blank_jd = grounding_base();
        new_blank_jd.job_description = Some("   ".into());
        assert!(!grounding_changed(&old_no_jd, &new_blank_jd));
    }

    #[test]
    fn research_queries_seed_from_vocabulary_and_cap() {
        let s = sample_session();
        let vocab: Vec<String> = vec!["API Gateway".into(), "Terraform".into(), "EKS".into()];
        let q = research_queries(&s, &vocab, 6);
        assert!(q.len() <= 6, "{q:?}");
        assert!(
            q.iter().any(|x| x.contains("API Gateway")),
            "vocabulary must seed a query: {q:?}"
        );
        // Base queries survive alongside.
        assert!(q.iter().any(|x| x.contains("common questions")), "{q:?}");
    }

    #[test]
    fn research_queries_without_vocabulary_are_base_only() {
        let s = sample_session();
        let q = research_queries(&s, &[], 6);
        assert!(!q.is_empty());
        assert!(q.iter().all(|x| !x.is_empty()));
    }

    #[test]
    fn research_findings_prompt_embeds_sources_and_demands_citations() {
        let s = sample_session();
        let sources = vec![ResearchSource {
            title: "Top SRE interview questions".into(),
            url: "https://example.com/sre".into(),
            snippet: "Expect SLO and error-budget questions.".into(),
            fetched_at_unix_ms: 0,
        }];
        let req = research_findings_prompt(&s, &sources);
        assert!(req.user.contains("Top SRE interview questions"));
        assert!(req.user.contains("https://example.com/sre"));
        assert!(req.user.contains("error-budget"));
        assert!(req.system.contains("## Sources"));
        let sys = req.system.to_lowercase();
        assert!(sys.contains("cite"), "citation instruction missing");
        assert!(req.max_tokens == 2000);
    }

    #[test]
    fn extract_glossary_entries_captures_bolded_term_definitions() {
        let digest = "## Overview\nIntro.\n\n## Core vocabulary\n\
- **API Gateway** — managed API front door for backend services.\n\
- **Terraform**: infrastructure-as-code tool.\n\n## Watch-outs\n- none";
        let entries = extract_glossary_entries(digest);
        let gateway = entries
            .iter()
            .find(|(t, _)| t == "API Gateway")
            .expect("API Gateway missing");
        assert_eq!(gateway.1, "managed API front door for backend services.");
        let terraform = entries
            .iter()
            .find(|(t, _)| t == "Terraform")
            .expect("Terraform missing");
        assert_eq!(terraform.1, "infrastructure-as-code tool.");
    }

    #[test]
    fn extract_glossary_entries_empty_definition_when_nothing_follows() {
        let digest = "## Glossary\n- **GAAP**\n";
        let entries = extract_glossary_entries(digest);
        let gaap = entries
            .iter()
            .find(|(t, _)| t == "GAAP")
            .expect("GAAP missing");
        assert_eq!(gaap.1, "");
    }

    #[test]
    fn extract_glossary_still_returns_only_terms() {
        // extract_glossary is now a thin wrapper — every pre-existing test
        // of it already covers this, but pin the relationship explicitly.
        let digest = "## Glossary\n- **GAAP**: accounting standards.\n";
        assert_eq!(extract_glossary(digest), vec!["GAAP".to_string()]);
        assert_eq!(
            extract_glossary(digest),
            extract_glossary_entries(digest)
                .into_iter()
                .map(|(t, _)| t)
                .collect::<Vec<_>>()
        );
    }

    #[test]
    fn qa_research_queries_are_broader_than_general_research() {
        let s = sample_session();
        let vocab: Vec<String> = vec!["API Gateway".into(), "Terraform".into()];
        let q = qa_research_queries(&s, &vocab, 18);
        assert!(q.len() <= 18);
        assert!(
            q.iter()
                .any(|x| x.to_lowercase().contains("most common interview questions")),
            "{q:?}"
        );
        assert!(
            q.iter()
                .any(|x| x.to_lowercase().contains("technical interview questions")),
            "{q:?}"
        );
        assert!(
            q.iter()
                .any(|x| x.to_lowercase().contains("behavioral interview questions")),
            "{q:?}"
        );
        assert!(q.iter().any(|x| x.contains("API Gateway")), "{q:?}");
    }

    #[test]
    fn qa_research_queries_without_vocabulary_still_yields_base_queries() {
        let s = sample_session();
        let q = qa_research_queries(&s, &[], 18);
        assert!(!q.is_empty());
    }

    #[test]
    fn interview_qa_prompt_demands_themed_broad_coverage() {
        let s = sample_session();
        let sources = vec![ResearchSource {
            title: "Top 50 accounting interview questions".into(),
            url: "https://example.com/q".into(),
            snippet: "Tell me about a time you found an error in a close.".into(),
            fetched_at_unix_ms: 0,
        }];
        let req = interview_qa_prompt(&s, &sources);
        assert!(req.user.contains("Top 50 accounting interview questions"));
        assert!(req.user.contains("https://example.com/q"));
        let sys = req.system.to_lowercase();
        assert!(sys.contains("20"), "floor missing");
        assert!(sys.contains("100"), "cap missing");
        assert!(
            sys.contains("behavioral") || sys.contains("theme"),
            "{}",
            req.system
        );
        assert_eq!(req.max_tokens, 6000);
    }
}

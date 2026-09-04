//! Context — a Conversation Context: the data model.
//!
//! A **Context** is a rehearsal of a high-stakes call (interview, company
//! meeting, sales call). The user sets a name + purpose + type and attaches
//! library documents (or asks Ally to generate context); an async pipeline
//! builds a reusable [`KnowledgeProfile`] (library docs + bounded web research,
//! embedded into the RAG store); the AI generates [`ContextPersona`] options and
//! the user picks one; then a real-time session runs the chosen counterparty.
//!
//! Distinct from `conversations` (saved real transcripts) and `session`
//! (per-listen JSONL) — a finished Context **saves as** a `Conversation`, and a
//! [`KnowledgeProfile`] can be reattached to a future Context *or* a live call.
//!
//! These are pure data types (no OS/storage deps), mirrored to TypeScript in
//! `src/lib/ipc.ts`. Persistence + the async pipeline live in the shell
//! (`src-tauri/src/context.rs`, Phase A.2).

use serde::{Deserialize, Serialize};

use crate::asr::TranscriptSegment;
use crate::audio::StreamSide;
use crate::llm::LlmRequest;
use crate::rag::{DocSource, RagDocument, ScoredChunk};

/// Reserved id of the always-present default context ("General conversation")
/// — a baseline briefing Ally grounds in when nothing more specific has been
/// chosen (session-grounding design, "required selection" — a fresh install
/// has this from first launch, so requiring a selection never locks out
/// Start Listening). System-managed: not user-deletable. Precedes the
/// community-voting + LLM-inference evolution (design doc, not yet built).
pub const DEFAULT_CONTEXT_ID: &str = "default";

/// The kind of conversation this context is for — drives the setup template
/// (documents to collect + digest sections), persona generation, and the
/// web-research default. Interview · Company Meeting · Sales Call · Live
/// Stream · Other (`LiveStream` added 2026-09-02 — podcast/streamer/
/// live-commerce hosts prepping a broadcast, per
/// `conva_core/docs/product/use-cases.md`); extensible later — see
/// `conva_core/docs/technical/conversation-context.md`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ContextCategory {
    Interview,
    CompanyMeeting,
    SalesCall,
    LiveStream,
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
/// default. Static and derived from [`ContextCategory`] — the single source of
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

/// Lifecycle of a Context, start to finish.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ContextStatus {
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

/// The avatar gender presentation a generated persona was assigned (Ally's
/// choice, part of how it envisioned the counterparty — Counterparty card
/// redesign, 2026-08-30). Cosmetic only: drives which silhouette icon
/// `ContextDetail.tsx` shows, nothing about the roleplay itself.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PersonaGender {
    Male,
    Female,
}

/// One generated counterparty persona/strategy option (three per session,
/// Step 3), one of which the AI flags [`recommended`](Self::recommended).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ContextPersona {
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
    /// `None` for personas generated before this field existed, or on the
    /// rare occasion the model's answer doesn't parse as male/female — the
    /// UI falls back to a neutral avatar in that case rather than guessing.
    #[serde(default)]
    pub gender: Option<PersonaGender>,
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

/// The reusable, indexed knowledge base for a Context — attached library
/// documents + bounded web research, embedded into the RAG store. **Reusable**:
/// attach the same profile to a later Context or to a live call by id.
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

/// One Conversation Context record: Step 1 setup through Step 4 run.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ConversationContext {
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
    pub category: ContextCategory,
    pub status: ContextStatus,
    pub created_at_unix_ms: u64,
    pub updated_at_unix_ms: u64,
    /// Library documents attached at setup (Step 1, Path A) — `RagDocument` ids
    /// the ingestion phase folds into the `KnowledgeProfile`.
    #[serde(default)]
    pub source_doc_ids: Vec<String>,
    /// Which attached document ids are filed under which of the category's
    /// `ConversationTemplate::file_slots`, keyed by `FileSlot::key`. Purely
    /// organizational for the setup/detail UI — the grounding pipeline still
    /// reads `source_doc_ids` (the flat union) for what actually indexes, this
    /// map only drives per-slot display. A doc id present in `source_doc_ids`
    /// but absent from every slot's list here is unslotted — rendered under
    /// the UI's "Other documents" catch-all rather than under a synthetic
    /// slot key. `#[serde(default)]` so a context saved before this field
    /// existed deserializes with an empty map (all its docs read as
    /// unslotted) — no migration, no data loss.
    #[serde(default)]
    pub slot_doc_ids: std::collections::BTreeMap<String, Vec<String>>,
    /// Whether Ally should auto-generate context (Step 1, Path B) during ingest.
    #[serde(default)]
    pub auto_generate_context: bool,
    /// Whether autonomous web research runs during preparation. Defaults from
    /// the type template ([`ContextCategory::default_research_enabled`]) at
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
    pub personas: Vec<ContextPersona>,
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
    /// Opt-in: research the web broadly for common interview questions +
    /// strong answers and write them into their own generated document
    /// (spec 2026-08-26, part A) — costs meaningfully more searches/tokens
    /// than default research, so it's a separate toggle. Interview
    /// category only.
    #[serde(default)]
    pub deep_qa_enabled: bool,
    /// The `RagDocument` id of the generated Interview Q&A document, once
    /// generated (replaced on regeneration, like the other two).
    #[serde(default)]
    pub qa_doc_id: Option<String>,
    /// True when a grounding input (documents, job description, key terms,
    /// research toggle) changed after resources were generated — the digest/
    /// glossary no longer reflect the inputs. Set by the shell's save paths,
    /// cleared by a successful dossier regeneration.
    #[serde(default)]
    pub resources_stale: bool,
    /// When Stage 1-3 (`generateDossier`) last actually ran, if ever
    /// (Contexts-screen-redesign spec, requirement 5). Deliberately
    /// separate from `updated_at_unix_ms`, which also bumps on a plain
    /// title/purpose edit — reusing it would make a "last regenerated"
    /// tooltip lie. `None` until the first regenerate.
    #[serde(default)]
    pub resources_generated_at_unix_ms: Option<u64>,
}

/// Catalog entry for the Context list view (cheap to list without loading the
/// full record + personas). Carries just enough to render the Conversation
/// Context list row's readiness checklist without an extra load per row (the
/// "at least one grounding source" gate — Conversation Context UI design).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ContextSummary {
    pub id: String,
    pub title: String,
    pub category: ContextCategory,
    pub status: ContextStatus,
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
    /// Mirrors [`ConversationContext::resources_stale`] for the list row's pill.
    #[serde(default)]
    pub resources_stale: bool,
    /// Mirrors [`ConversationContext::resources_generated_at_unix_ms`] for
    /// the list row's Regenerate-icon tooltip.
    #[serde(default)]
    pub resources_generated_at_unix_ms: Option<u64>,
}

impl ContextCategory {
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
            ContextCategory::Interview => ConversationTemplate {
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
            ContextCategory::CompanyMeeting => ConversationTemplate {
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
            ContextCategory::SalesCall => ConversationTemplate {
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
            ContextCategory::LiveStream => ConversationTemplate {
                label: "livestream or podcast",
                file_slots: &[
                    FileSlot {
                        key: "rundown",
                        label: "Show rundown / outline",
                        multiple: false,
                    },
                    FileSlot {
                        key: "guest_bio",
                        label: "Guest bio",
                        multiple: true,
                    },
                    FileSlot {
                        key: "talking_points",
                        label: "Talking points / script",
                        multiple: true,
                    },
                ],
                digest_sections: &[
                    "Episode outline",
                    "Core vocabulary",
                    "Guest background",
                    "Likely audience questions",
                ],
                // On by default — current-events/topic research is exactly
                // what a host prepping a broadcast wants, same reasoning as
                // Interview/SalesCall (public info helps; nothing here is
                // internal/confidential the way a company meeting's is).
                default_research_enabled: true,
            },
            ContextCategory::Other => ConversationTemplate {
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
pub fn persona_prompt(context: &ConversationContext) -> (String, String) {
    let system = "You generate realistic counterparty personas for rehearsing a \
high-stakes conversation. Return ONLY a JSON array of exactly 3 objects, each with \
keys: \"title\" (a short label), \"summary\" (2–3 sentences on how this person \
behaves in the room), \"style_tags\" (3–5 short lowercase strings), \
\"recommended\" (boolean — set exactly one persona true, the best fit for this \
context), and \"gender\" (the string \"male\" or \"female\" — whichever \
presentation best fits how you're envisioning this counterparty). No prose, no \
markdown, no code fences."
        .to_string();

    let mut user = format!(
        "Rehearsal type: {}\nName: {}\nGoal: {}\n",
        context.category.label(),
        context.title,
        context.purpose,
    );
    if let Some(jd) = &context.job_description {
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

/// Parse the LLM's persona JSON into [`ContextPersona`]s, assigning ids. Tolerant:
/// extracts the first JSON array from the text (models sometimes wrap it in
/// prose/fences) and returns empty on malformed output. Ensures exactly one
/// persona is flagged recommended.
pub fn parse_personas(text: &str) -> Vec<ContextPersona> {
    #[derive(Deserialize)]
    struct Gen {
        title: String,
        #[serde(default)]
        summary: String,
        #[serde(default)]
        style_tags: Vec<String>,
        #[serde(default)]
        recommended: bool,
        // A plain string, not `Option<PersonaGender>` directly: a model
        // occasionally answers with something that isn't exactly "male" or
        // "female" (extra words, wrong case, a third option) — deserializing
        // straight into the enum would fail the WHOLE array over one
        // cosmetic field. `parse_gender` below is the tolerant mapping.
        #[serde(default)]
        gender: Option<String>,
    }

    let slice = match (text.find('['), text.rfind(']')) {
        (Some(a), Some(b)) if b > a => &text[a..=b],
        _ => return Vec::new(),
    };
    let gens: Vec<Gen> = serde_json::from_str(slice).unwrap_or_default();

    let mut out: Vec<ContextPersona> = gens
        .into_iter()
        .filter(|g| !g.title.trim().is_empty())
        .enumerate()
        .map(|(i, g)| ContextPersona {
            id: format!("p{}", i + 1),
            title: g.title,
            summary: g.summary,
            style_tags: g.style_tags,
            recommended: g.recommended,
            gender: parse_gender(g.gender.as_deref()),
        })
        .collect();

    if !out.is_empty() && !out.iter().any(|p| p.recommended) {
        out[0].recommended = true;
    }
    out
}

/// Tolerant mapping from the model's free-text `gender` answer to
/// [`PersonaGender`] — exact "male"/"female" (any case) match; anything
/// else (missing, a third option, stray words) is `None` rather than a
/// parse failure, since this field is cosmetic (avatar choice only).
fn parse_gender(raw: Option<&str>) -> Option<PersonaGender> {
    match raw?.trim().to_ascii_lowercase().as_str() {
        "male" => Some(PersonaGender::Male),
        "female" => Some(PersonaGender::Female),
        _ => None,
    }
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
    context: &ConversationContext,
    persona: &ContextPersona,
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
        category = context.category.label(),
        title = persona.title,
        summary = persona.summary,
        style = style,
    );
    if let Some(jd) = context.job_description.as_deref() {
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
    context: &ConversationContext,
    research: &[ResearchSource],
    chunks: &[ScoredChunk],
    max_tokens: u32,
) -> LlmRequest {
    let template = context.category.template();
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

    let mut user = format!("Context: {}\nGoal: {}\n", context.title, context.purpose);
    if let Some(jd) = context.job_description.as_deref() {
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
pub fn research_queries(
    context: &ConversationContext,
    vocabulary: &[String],
    cap: usize,
) -> Vec<String> {
    let topic = if context.title.trim().is_empty() {
        context.category.label().to_string()
    } else {
        context.title.trim().to_string()
    };
    let mut q = vec![
        format!("{topic} common questions"),
        format!("how to prepare for a {}", context.category.label()),
    ];
    if !context.purpose.trim().is_empty() {
        q.push(context.purpose.trim().chars().take(120).collect());
    }
    if let Some(jd) = &context.job_description {
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
            context.category.label()
        ));
    }
    q.truncate(cap);
    q
}

/// Prompt for the Stage-2 **Research findings** document: synthesize the
/// collected web sources into a human-readable, cited brief the user can
/// inspect (and RAG can chunk by its `##` sections).
pub fn research_findings_prompt(
    context: &ConversationContext,
    sources: &[ResearchSource],
) -> LlmRequest {
    let template = context.category.template();
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
        context.title, context.purpose
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
    context: &ConversationContext,
    vocabulary: &[String],
    cap: usize,
) -> Vec<String> {
    let topic = if context.title.trim().is_empty() {
        context.category.label().to_string()
    } else {
        context.title.trim().to_string()
    };
    let role = context
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

/// Budget (chars) for the candidate's own material embedded in
/// [`interview_qa_prompt`] — kept modest since the prompt's (unbudgeted)
/// web-sources block already carries the bulk of the reference material.
const QA_PERSONAL_CHAR_BUDGET: usize = 6_000;

/// Prompt for the deep interview Q&A pass's document: synthesize the
/// gathered sources into a standalone bank of real, distinct question +
/// strong-answer pairs — spec 2026-08-26 part A. Themed `##` sections
/// (the model chooses themes that fit what the sources support); each
/// entry `**Q: ...** A: ...` so it reads well AND is harvestable by
/// `extract_glossary_entries` incidentally. At least 20 pairs, up to 100
/// — driven by how much the material supports, not a fixed target.
/// `chunks` — the candidate's own document material (résumé, etc.), the
/// same retrieval [`knowledge_prompt`] already receives — lets each
/// answer draw on the candidate's real experience where it applies
/// (spec 2026-08-26, interview Q&A personalization); the background
/// block is omitted entirely when `chunks` is empty.
pub fn interview_qa_prompt(
    context: &ConversationContext,
    sources: &[ResearchSource],
    chunks: &[ScoredChunk],
) -> LlmRequest {
    let template = context.category.template();
    let system = format!(
        "You are Ally, building an Interview Q&A bank from web sources \
gathered for a {label}. Organize into themed `##` sections (e.g. \
Behavioral, Technical, Company & role-specific — choose themes that fit \
what the sources actually support). Each entry: a bullet in the form \
`**Q: <question>** A: <strong, specific answer>`, grounded strictly in \
the sources — never invent a question or fact the sources don't support. \
Produce as many DISTINCT, well-supported pairs as the material justifies \
— at least 20, up to 100; do not pad with near-duplicates to hit a \
number, and do not stop early if the sources clearly support more. When \
the candidate's own background below supports a strong, specific answer \
to a question — their real projects, technologies, outcomes — write that \
answer from their own experience, concretely; when their background \
doesn't cover a question, give a strong, correct, role-appropriate \
answer instead. Never claim something the candidate's background doesn't \
support as their own. Output only the Markdown document — no preamble.",
        label = template.label,
    );

    let mut user = format!("Context: {}\nGoal: {}\n\n", context.title, context.purpose);
    if !chunks.is_empty() {
        let mut background = String::new();
        for chunk in chunks {
            let block = format!("[{}]\n{}\n\n", chunk.file_name, chunk.text);
            if background.len() + block.len() > QA_PERSONAL_CHAR_BUDGET {
                break;
            }
            background.push_str(&block);
        }
        if !background.is_empty() {
            user.push_str("Candidate's own background:\n\n");
            user.push_str(&background);
        }
    }
    user.push_str("Sources:\n\n");
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

/// Category-aware analytical performance report prompt (spec 2026-08-26,
/// part B) — grounded in the linked context's job description/vocabulary
/// when available, otherwise a generic structural analysis the transcript
/// alone supports. `category: None` covers a conversation with no linked
/// context (or one whose context was since deleted) — never an error,
/// always a valid, useful prompt.
pub fn performance_analysis_prompt(
    category: Option<ContextCategory>,
    job_description: Option<&str>,
    glossary: &[String],
    transcript_text: &str,
) -> LlmRequest {
    let task = match category {
        Some(ContextCategory::Interview) => {
            "Analyze how well the user performed as the CANDIDATE in this \
interview — strengths, gaps versus the job description and the \
vocabulary an interviewer would expect, clarity and structure of \
answers, and concrete, specific suggestions for improvement. Cite \
specific moments from the transcript."
        }
        Some(ContextCategory::SalesCall) => {
            "Analyze how well the user handled this sales call — objection \
handling, rapport, and any close attempts. Cite specific moments from \
the transcript and give concrete suggestions for improvement."
        }
        Some(ContextCategory::CompanyMeeting) => {
            "Analyze this meeting's structure — decisions reached, action \
items and who owns them, and how clearly the user communicated. Cite \
specific moments from the transcript."
        }
        Some(ContextCategory::LiveStream) => {
            "Analyze how well the user performed as HOST of this livestream \
or podcast — pacing, energy, clarity, how well they kept to the outline, \
and how they handled the guest or audience questions. Cite specific \
moments from the transcript and give concrete suggestions for improvement."
        }
        Some(ContextCategory::Other) | None => {
            "Analyze this conversation's clarity and structure — what \
went well, what was unclear, and concrete suggestions for improvement. \
Cite specific moments from the transcript."
        }
    };
    let system = format!(
        "You are Ally, writing an analytical performance report. {task} \
Ground every claim in what's actually in the transcript — never invent. \
Output only the Markdown report — no preamble."
    );

    let mut user = String::new();
    if let Some(jd) = job_description {
        let jd = jd.trim();
        if !jd.is_empty() {
            user.push_str(&format!(
                "Role expectations (job description):\n{}\n\n",
                jd.chars().take(4_000).collect::<String>()
            ));
        }
    }
    if !glossary.is_empty() {
        user.push_str(&format!(
            "Vocabulary the candidate was expected to know: {}\n\n",
            glossary.join(", ")
        ));
    }
    user.push_str("Transcript:\n\n");
    user.push_str(transcript_text);

    LlmRequest {
        system,
        user,
        max_tokens: 3000,
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
/// context (`ConversationContext::glossary`) to drive context-aware highlighting
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
pub fn grounding_changed(old: &ConversationContext, new: &ConversationContext) -> bool {
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

/// Generated documents (Stage 1-3 dossier/research findings/interview Q&A)
/// an old bug could orphan: the setup wizard's save payload used to silently
/// null out a context's `dossier_doc_id`/`research_doc_id`/`qa_doc_id` on
/// every edit-save, so `generateDossier`'s "delete the old doc, then create
/// the new one" step never found an "old" doc to delete — regenerating left
/// the previous doc behind, forever, instead of replacing it. Fixed going
/// forward; this is the retroactive cleanup for libraries that already
/// accumulated orphans before the fix (run once at startup, idempotent).
///
/// A generated doc survives if any context it's tagged to (`context_ids`)
/// currently claims it as ITS dossier/research/qa doc id right now.
/// Everything else — a doc tagged to a context that's since been deleted, or
/// belonging to a context that has since regenerated onto a different doc
/// id — is an orphan: nothing in the app can reach it, and regenerating
/// again would delete it anyway if it were still wired up, so it's safe to
/// delete now. Generated docs with no `context_ids` at all are left alone —
/// out of scope for this cleanup, not a state this always tags into
/// existence today, but not this function's call to second-guess.
pub fn orphaned_generated_doc_ids(
    contexts: &[ConversationContext],
    docs: &[RagDocument],
) -> Vec<String> {
    let mut keep: std::collections::HashSet<&str> = std::collections::HashSet::new();
    for c in contexts {
        for id in [&c.dossier_doc_id, &c.research_doc_id, &c.qa_doc_id]
            .into_iter()
            .flatten()
        {
            keep.insert(id.as_str());
        }
    }
    docs.iter()
        .filter(|d| d.source == DocSource::Generated)
        .filter(|d| !d.context_ids.is_empty())
        .filter(|d| !keep.contains(d.id.as_str()))
        .map(|d| d.id.clone())
        .collect()
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
    fn parse_maps_gender_case_insensitively_and_defaults_missing_to_none() {
        let text = r#"[{"title":"Skeptical CFO","summary":"Tough.","gender":"Female"},
         {"title":"Behavioral VP","summary":"Warm.","gender":"MALE"},
         {"title":"Wildcard","summary":"?"}]"#;
        let p = parse_personas(text);
        assert_eq!(p.len(), 3);
        assert_eq!(p[0].gender, Some(PersonaGender::Female));
        assert_eq!(p[1].gender, Some(PersonaGender::Male));
        assert_eq!(p[2].gender, None, "missing gender defaults to None");
    }

    #[test]
    fn parse_treats_an_unrecognized_gender_value_as_none_not_a_parse_failure() {
        // A single stray gender value must never wipe out all 3 personas —
        // it's a cosmetic field, not a validity gate.
        let text = r#"[{"title":"Skeptical CFO","summary":"Tough.","gender":"nonbinary"},
         {"title":"Behavioral VP","summary":"Warm.","gender":"female"}]"#;
        let p = parse_personas(text);
        assert_eq!(p.len(), 2);
        assert_eq!(p[0].gender, None);
        assert_eq!(p[1].gender, Some(PersonaGender::Female));
    }

    #[test]
    fn every_type_has_a_nonempty_template() {
        for cat in [
            ContextCategory::Interview,
            ContextCategory::CompanyMeeting,
            ContextCategory::SalesCall,
            ContextCategory::LiveStream,
            ContextCategory::Other,
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
        // Interview + sales + livestream: on (public info helps). Internal
        // meeting: off.
        assert!(ContextCategory::Interview.default_research_enabled());
        assert!(ContextCategory::SalesCall.default_research_enabled());
        assert!(ContextCategory::LiveStream.default_research_enabled());
        assert!(!ContextCategory::CompanyMeeting.default_research_enabled());
        assert!(!ContextCategory::Other.default_research_enabled());
    }

    #[test]
    fn old_contexts_without_slot_doc_ids_deserialize_with_an_empty_map() {
        // A context persisted before slot_doc_ids existed — must still load
        // (serde default), reading every attached doc as unslotted (it falls
        // into the UI's "Other documents" catch-all rather than losing data
        // or failing to deserialize).
        let old_json = r#"{
            "id": "s1",
            "title": "Senior Accountant Interview",
            "purpose": "Prep for GAAP questions",
            "job_description": null,
            "category": "interview",
            "status": "ready",
            "created_at_unix_ms": 0,
            "updated_at_unix_ms": 0,
            "source_doc_ids": [],
            "auto_generate_context": false,
            "research_enabled": true,
            "key_terms": [],
            "glossary": [],
            "glossary_definitions": {},
            "knowledge_profile_id": null,
            "personas": [],
            "chosen_persona_id": null,
            "conversation_id": null,
            "dossier_doc_id": null,
            "research_doc_id": null,
            "deep_qa_enabled": false,
            "qa_doc_id": null,
            "resources_stale": false,
            "resources_generated_at_unix_ms": null
        }"#;
        let ctx: ConversationContext = serde_json::from_str(old_json).unwrap();
        assert!(ctx.slot_doc_ids.is_empty());
    }

    fn sample_context() -> ConversationContext {
        ConversationContext {
            id: "s1".into(),
            title: "Senior Accountant Interview".into(),
            purpose: "Prep for GAAP questions".into(),
            job_description: Some("Own the monthly close.".into()),
            category: ContextCategory::Interview,
            status: ContextStatus::Ready,
            created_at_unix_ms: 0,
            updated_at_unix_ms: 0,
            source_doc_ids: vec![],
            slot_doc_ids: std::collections::BTreeMap::new(),
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
            deep_qa_enabled: false,
            qa_doc_id: None,
            resources_stale: false,
            resources_generated_at_unix_ms: None,
        }
    }

    fn persona() -> ContextPersona {
        ContextPersona {
            id: "p1".into(),
            title: "Skeptical CFO".into(),
            summary: "Direct, numbers-first.".into(),
            style_tags: vec!["skeptical".into(), "technical".into()],
            recommended: true,
            gender: Some(PersonaGender::Female),
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
        let req = persona_live_prompt(&sample_context(), &persona(), &[], &segments, &[], 300);

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
        let req = persona_live_prompt(&sample_context(), &persona(), &[], &[], &[], 300);
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
        let req = knowledge_prompt(&sample_context(), &[], &chunks, 1200);
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
        let mut s = sample_context();
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
        let mut session = sample_context();
        session.category = ContextCategory::CompanyMeeting;
        let req = knowledge_prompt(&session, &[], &[], 1200);
        assert!(req.system.contains("company meeting"));
        assert!(req.system.contains("Key figures"));
        assert!(req.system.contains("Likely discussion points"));
        assert!(!req.system.contains("Your talking points"));
    }

    fn grounding_base() -> ConversationContext {
        ConversationContext {
            id: "sim-1".into(),
            title: "Acme interview".into(),
            purpose: "Prep".into(),
            job_description: Some("Build on AWS.".into()),
            category: ContextCategory::Interview,
            status: ContextStatus::Ready,
            created_at_unix_ms: 0,
            updated_at_unix_ms: 0,
            source_doc_ids: vec!["doc-a".into(), "doc-b".into()],
            slot_doc_ids: std::collections::BTreeMap::new(),
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
            deep_qa_enabled: false,
            qa_doc_id: None,
            resources_stale: false,
            resources_generated_at_unix_ms: None,
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
        same.status = ContextStatus::Ended;
        assert!(!grounding_changed(&old, &same));

        // None vs empty/whitespace JD is not a change.
        let mut old_no_jd = grounding_base();
        old_no_jd.job_description = None;
        let mut new_blank_jd = grounding_base();
        new_blank_jd.job_description = Some("   ".into());
        assert!(!grounding_changed(&old_no_jd, &new_blank_jd));
    }

    fn generated_doc(id: &str, context_ids: Vec<String>) -> RagDocument {
        RagDocument {
            id: id.into(),
            file_name: format!("{id}.md"),
            enabled: true,
            chunk_count: 3,
            ingested_at_unix_ms: 0,
            source: DocSource::Generated,
            context_ids,
            size_bytes: 1024,
        }
    }

    #[test]
    fn orphaned_generated_doc_ids_keeps_only_currently_claimed_docs() {
        let mut ctx = sample_context();
        ctx.dossier_doc_id = Some("doc-current-dossier".into());
        ctx.research_doc_id = Some("doc-current-research".into());
        ctx.qa_doc_id = None;

        let docs = vec![
            // Claimed right now — survives.
            generated_doc("doc-current-dossier", vec!["s1".into()]),
            generated_doc("doc-current-research", vec!["s1".into()]),
            // Tagged to the context but not claimed by any of its three
            // doc-id fields (the exact shape of the historical bug) — orphan.
            generated_doc("doc-stale-dossier", vec!["s1".into()]),
            // Tagged to a context id that no longer exists — orphan.
            generated_doc("doc-deleted-context", vec!["gone".into()]),
            // Not a generated doc — never a candidate, even if unclaimed.
            RagDocument {
                id: "doc-user-file".into(),
                file_name: "resume.pdf".into(),
                enabled: true,
                chunk_count: 5,
                ingested_at_unix_ms: 0,
                source: DocSource::File,
                context_ids: vec!["s1".into()],
                size_bytes: 51200,
            },
            // No context_ids at all — out of scope, left alone.
            generated_doc("doc-untagged", vec![]),
        ];

        let mut orphans = orphaned_generated_doc_ids(&[ctx], &docs);
        orphans.sort();
        assert_eq!(orphans, vec!["doc-deleted-context", "doc-stale-dossier"]);
    }

    #[test]
    fn orphaned_generated_doc_ids_empty_when_nothing_to_clean() {
        let mut ctx = sample_context();
        ctx.dossier_doc_id = Some("doc-1".into());
        let docs = vec![generated_doc("doc-1", vec!["s1".into()])];
        assert!(orphaned_generated_doc_ids(&[ctx], &docs).is_empty());
    }

    #[test]
    fn research_queries_seed_from_vocabulary_and_cap() {
        let s = sample_context();
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
        let s = sample_context();
        let q = research_queries(&s, &[], 6);
        assert!(!q.is_empty());
        assert!(q.iter().all(|x| !x.is_empty()));
    }

    #[test]
    fn research_findings_prompt_embeds_sources_and_demands_citations() {
        let s = sample_context();
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
        let s = sample_context();
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
        let s = sample_context();
        let q = qa_research_queries(&s, &[], 18);
        assert!(!q.is_empty());
    }

    #[test]
    fn interview_qa_prompt_demands_themed_broad_coverage() {
        let s = sample_context();
        let sources = vec![ResearchSource {
            title: "Top 50 accounting interview questions".into(),
            url: "https://example.com/q".into(),
            snippet: "Tell me about a time you found an error in a close.".into(),
            fetched_at_unix_ms: 0,
        }];
        let req = interview_qa_prompt(&s, &sources, &[]);
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

    #[test]
    fn interview_qa_prompt_grounds_personal_material_when_provided() {
        let s = sample_context();
        let sources = vec![ResearchSource {
            title: "Top 50 accounting interview questions".into(),
            url: "https://example.com/q".into(),
            snippet: "Tell me about a time you found an error in a close.".into(),
            fetched_at_unix_ms: 0,
        }];
        let chunks = vec![ScoredChunk {
            document_id: "d1".into(),
            file_name: "resume.pdf".into(),
            location: "p1".into(),
            text: "Led the monthly close for 3 years at Acme Corp.".into(),
            score: 0.9,
        }];
        let req = interview_qa_prompt(&s, &sources, &chunks);
        assert!(req
            .user
            .contains("Led the monthly close for 3 years at Acme Corp."));
        assert!(req.user.contains("Candidate's own background"));
        // Sources still present alongside the new background block.
        assert!(req.user.contains("Top 50 accounting interview questions"));
        let sys = req.system.to_lowercase();
        assert!(
            sys.contains("own experience") || sys.contains("own background"),
            "{}",
            req.system
        );
    }

    #[test]
    fn interview_qa_prompt_omits_background_section_when_no_chunks() {
        let s = sample_context();
        let sources = vec![ResearchSource {
            title: "Top 50 accounting interview questions".into(),
            url: "https://example.com/q".into(),
            snippet: "Tell me about a time you found an error in a close.".into(),
            fetched_at_unix_ms: 0,
        }];
        let req = interview_qa_prompt(&s, &sources, &[]);
        assert!(!req.user.contains("Candidate's own background"));
        assert!(req.user.contains("Top 50 accounting interview questions"));
    }

    #[test]
    fn interview_qa_prompt_caps_personal_background_at_budget() {
        // Ten ~1,000-char chunks (realistic RAG-chunk sizing — never one
        // giant blob) so the budget actually caps something mid-list,
        // instead of the single-chunk-exceeds-budget edge case (which,
        // like knowledge_prompt's identical reference-budget loop, drops
        // that one oversized block whole rather than truncating it).
        let s = sample_context();
        let chunks: Vec<ScoredChunk> = (0..10)
            .map(|i| ScoredChunk {
                document_id: "d1".into(),
                file_name: "resume.pdf".into(),
                location: format!("p{i}"),
                text: "x".repeat(1_000),
                score: 0.9,
            })
            .collect();
        let req = interview_qa_prompt(&s, &[], &chunks);
        let background_start = req
            .user
            .find("Candidate's own background")
            .expect("background section missing");
        let sources_start = req
            .user
            .find("Sources:\n\n")
            .expect("sources section missing");
        let background_len = sources_start - background_start;
        assert!(
            background_len <= QA_PERSONAL_CHAR_BUDGET + 200,
            "background section grew unbounded: {background_len} chars"
        );
    }

    #[test]
    fn performance_analysis_prompt_interview_framing_with_grounding() {
        let req = performance_analysis_prompt(
            Some(ContextCategory::Interview),
            Some("Senior DevOps role requiring Terraform and EKS."),
            &["Terraform".to_string(), "EKS".to_string()],
            "Them: Tell me about your Terraform experience.\nYou: I've used it for three years.",
        );
        let sys = req.system.to_lowercase();
        assert!(sys.contains("candidate"));
        assert!(sys.contains("job description"));
        assert!(req.user.contains("Senior DevOps role"));
        assert!(req.user.contains("Terraform"));
        assert!(req.user.contains("Tell me about your Terraform experience"));
        assert_eq!(req.max_tokens, 3000);
    }

    #[test]
    fn performance_analysis_prompt_ungrounded_still_produces_valid_prompt() {
        let req = performance_analysis_prompt(None, None, &[], "Them: Hi.\nYou: Hello.");
        assert!(!req.system.trim().is_empty());
        assert!(!req.user.contains("Role expectations"));
        assert!(req.user.contains("Them: Hi."));
    }

    #[test]
    fn performance_analysis_prompt_sales_framing_differs_from_interview() {
        let interview =
            performance_analysis_prompt(Some(ContextCategory::Interview), None, &[], "x");
        let sales = performance_analysis_prompt(Some(ContextCategory::SalesCall), None, &[], "x");
        assert_ne!(interview.system, sales.system);
        assert!(sales.system.to_lowercase().contains("objection"));
    }

    #[test]
    fn performance_analysis_prompt_livestream_framing_is_host_specific() {
        let stream = performance_analysis_prompt(Some(ContextCategory::LiveStream), None, &[], "x");
        let sys = stream.system.to_lowercase();
        assert!(sys.contains("host"));
        assert!(sys.contains("pacing"));
    }
}

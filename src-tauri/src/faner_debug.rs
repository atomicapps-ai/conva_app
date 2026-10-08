//! Dev-only FANER debug commands (the `FanerReplayPanel` Highlighter and
//! Batch modes). Design: `conva_core/docs/technical/faner-phrase-resolution.md`.
//!
//! Every command refuses to run in a release build, so the trace/eval surface
//! never ships: the panel itself is only mounted behind `import.meta.env.DEV`,
//! and this is the belt to that pair of braces.

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};

use conva_core::highlight::{evaluate_terms, HighlightContext, MAX_TERMS};
use conva_core::lexicon::Lexicon;
use conva_core::phrase::{CandidateTrace, HighlightOrigin};
use conva_core::phrase_eval::{evaluate_case, generate_cases, EvalCase, EvalResult};

use crate::AppState;

fn dev_only() -> Result<(), String> {
    if cfg!(debug_assertions) {
        Ok(())
    } else {
        Err("FANER debug commands are dev-only".into())
    }
}

/// Where the known terms for a highlight evaluation came from.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TermSource {
    /// The terms typed into the panel (no RAG, no rarity, no feedback).
    Manual,
    /// The live pipeline: active Context terms + scoped RAG + rarity + 👍/👎 —
    /// byte-for-byte what `analyze_terms` runs for transcript bubbles.
    ActiveContext,
}

#[derive(Debug, Clone, Deserialize)]
pub struct DebugHighlightRequest {
    pub text: String,
    /// Manual known terms (ignored when `use_active_context`).
    #[serde(default)]
    pub terms: Vec<String>,
    /// Optional pasted document text for the doc-overlap / doc-phrase signals
    /// (manual mode only).
    #[serde(default)]
    pub doc_text: String,
    #[serde(default)]
    pub use_active_context: bool,
    /// Bundled domain pack ids to apply in manual mode (unknown ids ignored).
    /// Active-Context mode uses the packs the Context itself selected.
    #[serde(default)]
    pub lexicon_packs: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct DebugHighlightResponse {
    /// What `relevant_terms` returns — exactly what a bubble would render.
    pub terms: Vec<String>,
    /// Origin of each entry of `terms`, index for index.
    pub origins: Vec<HighlightOrigin>,
    pub trace: Vec<CandidateTrace>,
    pub source: TermSource,
    /// The known terms this run used (manual list, or the active context's).
    pub known_terms: Vec<String>,
    /// The app's current `active_context_terms`, always reported, so a stale
    /// activation is visible even in manual mode.
    pub active_context_terms: Vec<String>,
    pub active_scope_doc_count: usize,
    /// Domain packs this run used (manual: the requested ones that exist;
    /// active Context: the packs it selected).
    pub packs: Vec<String>,
    /// Packs the app's active Context has selected right now, always
    /// reported, so a Context that selected none is visible in manual mode.
    pub active_packs: Vec<String>,
}

/// Run the deterministic highlighter (no LLM, no tokens) and explain it.
#[tauri::command]
pub fn faner_debug_highlight(
    app: AppHandle,
    state: State<'_, AppState>,
    request: DebugHighlightRequest,
) -> Result<DebugHighlightResponse, String> {
    dev_only()?;
    let active_context_terms = state.active_context_terms.lock().expect("ctx lock").clone();
    let active_scope_doc_count = state.active_context_doc_ids.lock().expect("ctx lock").len();
    let active_packs: Vec<String> = state
        .active_lexicon
        .lock()
        .expect("ctx lock")
        .as_ref()
        .map(|l| l.pack_ids().to_vec())
        .unwrap_or_default();
    let (eval, source, known_terms, packs) = if request.use_active_context {
        let eval = crate::evaluate_live_terms(&app, &state, &request.text);
        (
            eval,
            TermSource::ActiveContext,
            active_context_terms.clone(),
            active_packs.clone(),
        )
    } else {
        let known: Vec<String> = request
            .terms
            .iter()
            .map(|t| t.trim().to_string())
            .filter(|t| !t.is_empty())
            .collect();
        let ids: Vec<&str> = request.lexicon_packs.iter().map(String::as_str).collect();
        let lexicon = Lexicon::from_pack_ids(&ids);
        let ctx = HighlightContext {
            context_terms: &known,
            lexicon: Some(&lexicon),
            ..HighlightContext::from_doc_text(&request.doc_text)
        };
        let eval = evaluate_terms(&request.text, &ctx, MAX_TERMS);
        (eval, TermSource::Manual, known, lexicon.pack_ids().to_vec())
    };
    Ok(DebugHighlightResponse {
        terms: eval.terms,
        origins: eval.origins,
        trace: eval.trace,
        source,
        known_terms,
        active_context_terms,
        active_scope_doc_count,
        packs,
        active_packs,
    })
}

/// Generate `count` reproducible cases from `terms` (curated defaults when
/// empty). Same `(seed, count, terms)` → same cases.
#[tauri::command]
pub fn faner_debug_generate_cases(
    seed: u64,
    count: usize,
    terms: Vec<String>,
) -> Result<Vec<EvalCase>, String> {
    dev_only()?;
    Ok(generate_cases(seed, count.min(500), &terms))
}

/// Evaluate cases (generated or hand-written) against the real highlighter.
#[tauri::command]
pub fn faner_debug_evaluate(cases: Vec<EvalCase>) -> Result<Vec<EvalResult>, String> {
    dev_only()?;
    Ok(cases.iter().take(500).map(evaluate_case).collect())
}

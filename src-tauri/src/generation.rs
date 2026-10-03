//! Background document generation that finishes what it starts (answer-integrity
//! check C2, `answer-integrity-checks.md` in `conva_core`).
//!
//! Prepared Q&A, the knowledge pack, the research brief and the post-call
//! analysis are stored and, for the first three, indexed for live retrieval.
//! A reply that hit its token cap used to be stored exactly like a finished
//! one. [`generate_document`] retries a cut-off reply once with a larger cap;
//! a reply that is still cut off comes back flagged so the caller can mark the
//! stored text as incomplete instead of letting it pose as whole.

use tauri::AppHandle;

use conva_core::llm::{LlmRequest, ModelSelection};
use conva_core::stop_reason::complete_with_one_retry;
use conva_core::CoreError;

/// A finished background generation.
pub struct Generated {
    /// The trimmed reply (possibly empty; callers keep their own empty check).
    pub text: String,
    /// Still cut off at the output cap after the one retry.
    pub truncated: bool,
}

/// Stream one background generation through the metered path, with the single
/// automatic retry for a cut-off reply. Every attempt is metered under
/// `feature`, so a retry shows up in Settings → Usage as its own request.
pub fn generate_document(
    app: &AppHandle,
    feature: &str,
    selection: &ModelSelection,
    api_key: &str,
    request: &LlmRequest,
) -> Result<Generated, CoreError> {
    let done = complete_with_one_retry(request.max_tokens, |cap| {
        let mut attempt = request.clone();
        attempt.max_tokens = cap;
        let mut buffer = String::new();
        let outcome = crate::metering::metered_stream(
            app,
            feature,
            selection,
            api_key,
            &attempt,
            &mut |token| buffer.push_str(token),
        )?;
        Ok::<_, CoreError>((buffer, outcome.stop))
    })?;
    if done.retried {
        eprintln!(
            "[generation] {feature} hit its {}-token cap; retried once (still cut off: {})",
            request.max_tokens,
            done.stop.is_truncated()
        );
    }
    Ok(Generated {
        text: done.text.trim().to_string(),
        truncated: done.stop.is_truncated(),
    })
}

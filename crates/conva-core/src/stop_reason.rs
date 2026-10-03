//! Why a model stream ended, normalised across providers, plus the pure helpers
//! that act on it (answer-integrity checks C1/C2/C9, `answer-integrity-checks.md`
//! in `conva_core`).
//!
//! Before this existed a reply that hit the token cap finished exactly like a
//! complete one: the stream returned `Ok`, the UI saw `done` with no error, and
//! a half-written prepared Q&A or knowledge document was stored and indexed as
//! finished. The provider tells us the truth in every stream (`stop_reason`,
//! `finish_reason`, `finishReason`); this module turns it into one enum.
//!
//! Pure and OS-free, so it is unit-tested here and shared by the shell.

use serde::{Deserialize, Serialize};

/// Why a completion stream ended.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StopReason {
    /// The model finished on its own (`end_turn`, `stop`, `STOP`, a stop
    /// sequence, or a tool call being requested).
    Complete,
    /// The reply hit the output cap or the context window: the text ends
    /// mid-thought (`max_tokens`, `length`, `MAX_TOKENS`).
    Truncated,
    /// The provider declined or filtered the reply (`refusal`,
    /// `content_filter`, `SAFETY`, ...). Any text that did arrive is partial.
    Refused,
    /// A signal we do not classify (for example `pause_turn`, `RECITATION`).
    Other,
    /// The stream ended with no terminal signal at all (some local endpoints
    /// omit it, or the connection closed early). Not treated as a truncation:
    /// we cannot tell, and a retry would double-bill.
    Unknown,
}

impl StopReason {
    /// Anthropic Messages API `stop_reason`.
    pub fn from_anthropic(raw: &str) -> Self {
        match raw {
            "end_turn" | "stop_sequence" | "tool_use" => Self::Complete,
            "max_tokens" | "model_context_window_exceeded" => Self::Truncated,
            "refusal" => Self::Refused,
            _ => Self::Other,
        }
    }

    /// OpenAI-compatible `finish_reason` (OpenAI, xAI, DeepSeek, Ollama).
    pub fn from_openai(raw: &str) -> Self {
        match raw {
            "stop" | "tool_calls" | "function_call" => Self::Complete,
            "length" => Self::Truncated,
            "content_filter" => Self::Refused,
            _ => Self::Other,
        }
    }

    /// Gemini `finishReason`.
    pub fn from_gemini(raw: &str) -> Self {
        match raw {
            "STOP" => Self::Complete,
            "MAX_TOKENS" => Self::Truncated,
            "SAFETY" | "PROHIBITED_CONTENT" | "BLOCKLIST" | "SPII" => Self::Refused,
            _ => Self::Other,
        }
    }

    /// The reply stopped because it ran out of room.
    pub fn is_truncated(self) -> bool {
        self == Self::Truncated
    }

    /// The provider declined or filtered the reply.
    pub fn is_refused(self) -> bool {
        self == Self::Refused
    }

    /// Stable snake_case label for logs, the usage-event row and the IPC.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Complete => "complete",
            Self::Truncated => "truncated",
            Self::Refused => "refused",
            Self::Other => "other",
            Self::Unknown => "unknown",
        }
    }
}

/// Upper bound for a retry's output cap. Generous enough for a 6,000-token deep
/// Q&A to grow, small enough that one retry cannot run away on cost.
pub const MAX_RETRY_TOKENS: u32 = 9_000;

/// The output cap for the single automatic retry of a truncated background
/// generation: 50% more room, never above [`MAX_RETRY_TOKENS`] and never lower
/// than the cap that just failed.
pub fn escalated_cap(cap: u32) -> u32 {
    cap.saturating_add(cap / 2).min(MAX_RETRY_TOKENS).max(cap)
}

/// The result of [`complete_with_one_retry`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Completed {
    pub text: String,
    /// Why the attempt whose text is returned stopped. `Truncated` here means
    /// the text is still cut off even after the retry.
    pub stop: StopReason,
    /// A second attempt was made.
    pub retried: bool,
}

/// Run a background generation (prepared Q&A, knowledge pack, research brief,
/// post-call analysis); when the first attempt is cut off at `cap`, retry
/// **once** with [`escalated_cap`]. `attempt(cap)` streams one completion at
/// that cap and returns its text and stop reason.
///
/// The retry never makes things worse: if it errors, the first (cut-off) text
/// is returned; if the cap cannot grow, no retry is made.
pub fn complete_with_one_retry<E>(
    cap: u32,
    mut attempt: impl FnMut(u32) -> Result<(String, StopReason), E>,
) -> Result<Completed, E> {
    let (text, stop) = attempt(cap)?;
    if !stop.is_truncated() {
        return Ok(Completed {
            text,
            stop,
            retried: false,
        });
    }
    let bigger = escalated_cap(cap);
    if bigger <= cap {
        return Ok(Completed {
            text,
            stop,
            retried: false,
        });
    }
    match attempt(bigger) {
        Ok((text, stop)) => Ok(Completed {
            text,
            stop,
            retried: true,
        }),
        Err(_) => Ok(Completed {
            text,
            stop,
            retried: true,
        }),
    }
}

/// Appended to a stored document that was still cut off after the retry, so
/// the stored (and indexed) text says what it is instead of posing as complete.
pub const INCOMPLETE_NOTE: &str = "_Generation stopped at the length limit, so this document is incomplete. Regenerate it to complete it._";

/// Append [`INCOMPLETE_NOTE`] on its own paragraph.
pub fn mark_incomplete(text: &str) -> String {
    format!("{}\n\n{INCOMPLETE_NOTE}", text.trim_end())
}

fn bullet_body(line: &str) -> &str {
    line.trim().trim_start_matches(['-', '*', '+', '•']).trim()
}

fn starts_question(line: &str) -> bool {
    let body = bullet_body(line);
    ["**Q:", "**Q.", "Q:", "Q."]
        .iter()
        .any(|prefix| body.starts_with(prefix))
}

/// Drop the last question and answer from a prepared-Q&A document whose
/// generation was cut off, and any heading left with nothing under it.
///
/// A cut-off pair is a question with a half-finished answer; the live
/// "prepared hit" path would serve it verbatim. Returns the text unchanged when
/// it contains no `Q:` entry. May return an empty string when the only entry was
/// the cut-off one: the caller keeps the original and marks it incomplete then.
pub fn drop_cut_off_qa_tail(text: &str) -> String {
    let lines: Vec<&str> = text.lines().collect();
    let Some(last_question) = lines.iter().rposition(|line| starts_question(line)) else {
        return text.to_string();
    };
    let mut kept = &lines[..last_question];
    // A heading that now has no entries under it is noise.
    while let Some(last) = kept.last() {
        let trimmed = last.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            kept = &kept[..kept.len() - 1];
        } else {
            break;
        }
    }
    kept.join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn anthropic_reasons_map_to_the_same_meaning_as_the_api_docs() {
        assert_eq!(StopReason::from_anthropic("end_turn"), StopReason::Complete);
        assert_eq!(
            StopReason::from_anthropic("stop_sequence"),
            StopReason::Complete
        );
        assert_eq!(StopReason::from_anthropic("tool_use"), StopReason::Complete);
        assert_eq!(
            StopReason::from_anthropic("max_tokens"),
            StopReason::Truncated
        );
        assert_eq!(
            StopReason::from_anthropic("model_context_window_exceeded"),
            StopReason::Truncated
        );
        assert_eq!(StopReason::from_anthropic("refusal"), StopReason::Refused);
        assert_eq!(StopReason::from_anthropic("pause_turn"), StopReason::Other);
        assert_eq!(
            StopReason::from_anthropic("something_new"),
            StopReason::Other
        );
    }

    #[test]
    fn openai_compatible_reasons_map() {
        assert_eq!(StopReason::from_openai("stop"), StopReason::Complete);
        assert_eq!(StopReason::from_openai("tool_calls"), StopReason::Complete);
        assert_eq!(StopReason::from_openai("length"), StopReason::Truncated);
        assert_eq!(
            StopReason::from_openai("content_filter"),
            StopReason::Refused
        );
        assert_eq!(StopReason::from_openai("weird"), StopReason::Other);
    }

    #[test]
    fn gemini_reasons_map() {
        assert_eq!(StopReason::from_gemini("STOP"), StopReason::Complete);
        assert_eq!(StopReason::from_gemini("MAX_TOKENS"), StopReason::Truncated);
        assert_eq!(StopReason::from_gemini("SAFETY"), StopReason::Refused);
        assert_eq!(
            StopReason::from_gemini("PROHIBITED_CONTENT"),
            StopReason::Refused
        );
        assert_eq!(StopReason::from_gemini("RECITATION"), StopReason::Other);
    }

    #[test]
    fn only_truncated_and_refused_have_predicates() {
        assert!(StopReason::Truncated.is_truncated());
        assert!(!StopReason::Unknown.is_truncated());
        assert!(!StopReason::Complete.is_truncated());
        assert!(StopReason::Refused.is_refused());
        assert!(!StopReason::Other.is_refused());
    }

    #[test]
    fn labels_are_stable_snake_case_and_match_serde() {
        for reason in [
            StopReason::Complete,
            StopReason::Truncated,
            StopReason::Refused,
            StopReason::Other,
            StopReason::Unknown,
        ] {
            let json = serde_json::to_string(&reason).unwrap();
            assert_eq!(json, format!("\"{}\"", reason.as_str()));
        }
    }

    #[test]
    fn retry_cap_grows_by_half_and_is_bounded() {
        assert_eq!(escalated_cap(3_000), 4_500);
        assert_eq!(escalated_cap(6_000), 9_000);
        assert_eq!(escalated_cap(8_000), 9_000, "bounded at the ceiling");
        assert_eq!(
            escalated_cap(20_000),
            20_000,
            "never lower than the cap that failed"
        );
        assert_eq!(escalated_cap(0), 0);
    }

    #[test]
    fn a_finished_generation_is_not_retried() {
        let mut caps = Vec::new();
        let done = complete_with_one_retry::<()>(3_000, |cap| {
            caps.push(cap);
            Ok(("all of it".into(), StopReason::Complete))
        })
        .unwrap();
        assert_eq!(caps, vec![3_000]);
        assert!(!done.retried);
        assert_eq!(done.text, "all of it");
    }

    #[test]
    fn a_cut_off_generation_is_retried_once_with_a_bigger_cap() {
        let mut caps = Vec::new();
        let done = complete_with_one_retry::<()>(3_000, |cap| {
            caps.push(cap);
            if cap == 3_000 {
                Ok(("half".into(), StopReason::Truncated))
            } else {
                Ok(("the whole thing".into(), StopReason::Complete))
            }
        })
        .unwrap();
        assert_eq!(caps, vec![3_000, 4_500]);
        assert!(done.retried);
        assert_eq!(done.text, "the whole thing");
        assert_eq!(done.stop, StopReason::Complete);
    }

    #[test]
    fn a_second_cut_off_is_returned_not_retried_again() {
        let mut calls = 0;
        let done = complete_with_one_retry::<()>(3_000, |_| {
            calls += 1;
            Ok(("still half".into(), StopReason::Truncated))
        })
        .unwrap();
        assert_eq!(calls, 2, "exactly one retry");
        assert_eq!(done.stop, StopReason::Truncated);
    }

    #[test]
    fn a_failed_retry_keeps_the_first_text() {
        let mut calls = 0;
        let done = complete_with_one_retry(3_000, |_| {
            calls += 1;
            if calls == 1 {
                Ok(("half".to_string(), StopReason::Truncated))
            } else {
                Err("network")
            }
        })
        .unwrap();
        assert_eq!(done.text, "half");
        assert!(done.stop.is_truncated());
    }

    #[test]
    fn a_failed_first_attempt_is_an_error() {
        let result = complete_with_one_retry(3_000, |_| Err::<(String, StopReason), _>("boom"));
        assert_eq!(result, Err("boom"));
    }

    #[test]
    fn no_retry_when_the_cap_cannot_grow() {
        let mut calls = 0;
        let done = complete_with_one_retry::<()>(MAX_RETRY_TOKENS + 1_000, |_| {
            calls += 1;
            Ok(("half".into(), StopReason::Truncated))
        })
        .unwrap();
        assert_eq!(calls, 1);
        assert!(!done.retried);
    }

    #[test]
    fn incomplete_note_goes_on_its_own_paragraph() {
        let marked = mark_incomplete("## Heading\ntext  \n\n");
        assert!(marked.starts_with("## Heading\ntext\n\n_Generation stopped"));
    }

    #[test]
    fn cut_off_qa_tail_is_dropped_with_its_orphaned_heading() {
        // The 3,000-token Haiku output from the benchmark ended mid-answer.
        let text = "## Role\n\
- **Q: Why this firm?** A: Because of the audit mix.\n\
- **Q: Walk me through a close.** A: First I reconcile\n\
\n\
## Tax\n\
- **Q: What is a K-1?** A: A schedule that reports each partner's share and the";
        let got = drop_cut_off_qa_tail(text);
        assert_eq!(
            got,
            "## Role\n- **Q: Why this firm?** A: Because of the audit mix.\n- **Q: Walk me through a close.** A: First I reconcile"
        );
    }

    #[test]
    fn cut_off_qa_tail_handles_plain_q_and_a_lines() {
        let text = "Q: First?\nA: Yes.\nQ: Second?\nA: Partly, and";
        assert_eq!(drop_cut_off_qa_tail(text), "Q: First?\nA: Yes.");
    }

    #[test]
    fn text_without_questions_is_returned_unchanged() {
        assert_eq!(drop_cut_off_qa_tail("just prose"), "just prose");
    }

    #[test]
    fn a_document_whose_only_entry_was_cut_off_becomes_empty() {
        assert_eq!(drop_cut_off_qa_tail("## T\n- **Q: Only?** A: half"), "");
    }
}

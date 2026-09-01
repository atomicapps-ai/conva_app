//! Deterministic first-response support for FANER's two-speed delivery.
//!
//! A Bridge Response is not filler: it is a short, safe sentence the user can
//! say while richer retrieval/generation continues. This first slice uses no
//! model: evidence bridges quote a retained source sentence, while miss
//! templates introduce no factual claims. Later prepared-Q&A hits can replace
//! either with a verified opening from the cached answer.

use serde::{Deserialize, Serialize};

/// What the retrieval layer knows about the current question.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RetrievalKind {
    /// A structured, pre-generated answer matched confidently. Reserved until
    /// the prepared-Q&A index is wired; generic chunk retrieval never emits it.
    PreparedHit,
    /// The active Context contains confidently overlapping evidence.
    EvidenceHit,
    /// No sufficiently grounded match was found in the active Context.
    Miss,
}

/// The conversational strategy used by a Bridge Response.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BridgeKind {
    Evidence,
    Comparison,
    Process,
    Behavioral,
    Rationale,
    Definition,
    Boundary,
    Framework,
}

/// Immediately speakable first content while the refined response is prepared.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BridgeResponse {
    pub kind: BridgeKind,
    pub text: String,
}

/// Build a safe, deterministic Bridge Response from the question's intent.
/// The templates deliberately avoid names, figures, and purported experience:
/// those may only come from a verified prepared answer or retrieved evidence.
pub fn bridge_response(
    question: &str,
    retrieval: RetrievalKind,
    evidence: Option<&str>,
) -> BridgeResponse {
    let lower = question.trim().to_lowercase();

    if retrieval != RetrievalKind::Miss {
        if let Some(sentence) = evidence.and_then(first_speakable_sentence) {
            return BridgeResponse {
                kind: BridgeKind::Evidence,
                text: sentence,
            };
        }
    }

    let (kind, text) = if retrieval == RetrievalKind::Miss
        && [
            "exact",
            "how much",
            "how many",
            "percentage",
            " rate",
            " date",
        ]
        .iter()
        .any(|cue| lower.contains(cue))
    {
        (
            BridgeKind::Boundary,
            "I don't want to guess at the exact detail; I'd separate what is verified from what still needs confirmation.",
        )
    } else if [
        "compare",
        "difference",
        "versus",
        " vs ",
        "better",
        "between",
    ]
    .iter()
    .any(|cue| lower.contains(cue))
    {
        (
            BridgeKind::Comparison,
            "I'd compare them on fit, tradeoffs, and execution risk, starting with the deciding constraint.",
        )
    } else if [
        "tell me about a time",
        "describe a time",
        "give me an example",
    ]
    .iter()
    .any(|cue| lower.contains(cue))
    {
        (
            BridgeKind::Behavioral,
            "I'd anchor this in one specific example and focus on the decision, tradeoff, and outcome.",
        )
    } else if lower.starts_with("how ")
        || ["walk me through", "process", "steps", "approach"]
            .iter()
            .any(|cue| lower.contains(cue))
    {
        (
            BridgeKind::Process,
            "I'd start by clarifying the goal and constraints, then walk through a practical, reversible sequence.",
        )
    } else if lower.starts_with("why ") || lower.contains("reason") {
        (
            BridgeKind::Rationale,
            "The key is to connect the underlying reason to the practical outcome and its main tradeoff.",
        )
    } else if lower.starts_with("what is ")
        || lower.starts_with("what are ")
        || lower.contains("define ")
    {
        (
            BridgeKind::Definition,
            "I'd define it in one line first, then connect it directly to why it matters here.",
        )
    } else if retrieval == RetrievalKind::Miss {
        (
            BridgeKind::Boundary,
            "I don't want to overstate the details; I'd start with the governing principle and verify the specifics.",
        )
    } else {
        (
            BridgeKind::Framework,
            "I'd lead with the main point, then support it with the most relevant evidence and tradeoff.",
        )
    };

    BridgeResponse {
        kind,
        text: text.to_string(),
    }
}

/// Extract a compact first sentence from grounded evidence. This is the only
/// bridge path that makes a factual claim, and the words come directly from a
/// retained source chunk rather than being generated.
fn first_speakable_sentence(evidence: &str) -> Option<String> {
    let clean = evidence.split_whitespace().collect::<Vec<_>>().join(" ");
    if clean.is_empty() {
        return None;
    }
    let sentence_end = clean
        .char_indices()
        .find_map(|(index, ch)| matches!(ch, '.' | '!' | '?').then_some(index + ch.len_utf8()))
        .unwrap_or(clean.len());
    let clip_end = clean
        .char_indices()
        .map(|(index, _)| index)
        .find(|index| *index >= 220)
        .unwrap_or(clean.len());
    let end = sentence_end.min(clip_end);
    let mut sentence = clean[..end].trim().to_string();
    if end < clean.len() && !sentence.ends_with(['.', '!', '?', '…']) {
        sentence.push('…');
    }
    Some(sentence)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn comparison_bridge_is_immediately_speakable() {
        let bridge = bridge_response(
            "Would you use Terraform versus CloudFormation?",
            RetrievalKind::EvidenceHit,
            None,
        );
        assert_eq!(bridge.kind, BridgeKind::Comparison);
        assert!(bridge.text.contains("tradeoffs"));
        assert!(bridge.text.split_whitespace().count() <= 24);
    }

    #[test]
    fn an_exact_miss_never_invents_the_number() {
        let bridge = bridge_response("What is the exact failure rate?", RetrievalKind::Miss, None);
        assert_eq!(bridge.kind, BridgeKind::Boundary);
        assert!(bridge.text.contains("don't want to guess"));
        assert!(!bridge.text.chars().any(|c| c.is_ascii_digit()));
    }

    #[test]
    fn process_and_behavioral_questions_get_useful_structures() {
        assert_eq!(
            bridge_response("How would you migrate it?", RetrievalKind::Miss, None).kind,
            BridgeKind::Process
        );
        assert_eq!(
            bridge_response(
                "Tell me about a time you disagreed with a senior engineer.",
                RetrievalKind::EvidenceHit,
                None,
            )
            .kind,
            BridgeKind::Behavioral
        );
    }

    #[test]
    fn grounded_hit_uses_a_compact_source_sentence() {
        let bridge = bridge_response(
            "What does the maintenance plan include?",
            RetrievalKind::EvidenceHit,
            Some("The maintenance plan includes filters and annual inspection. Additional details follow."),
        );
        assert_eq!(bridge.kind, BridgeKind::Evidence);
        assert_eq!(
            bridge.text,
            "The maintenance plan includes filters and annual inspection."
        );
    }

    #[test]
    fn grounded_bridge_truncates_unicode_on_a_character_boundary() {
        let evidence = format!("{} additional detail", "é".repeat(150));
        let bridge = bridge_response(
            "What happened?",
            RetrievalKind::EvidenceHit,
            Some(&evidence),
        );
        assert!(bridge.text.ends_with('…'));
        assert!(bridge.text.len() < evidence.len());
    }
}

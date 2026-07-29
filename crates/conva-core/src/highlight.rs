//! Relevant-term detection for transcript highlighting.
//!
//! Given a transcript message and the text of the RAG-retrieved library
//! chunks (the "context"), find the words/phrases in the message that also
//! appear as significant terms in the context. Those are the phrases worth
//! surfacing an Ally action on (definition / how-to / elaborate).
//!
//! Pure and deterministic — this is the RAG-grounded layer. An optional LLM
//! enrichment pass (conceptual terms not literally in the docs) can be merged
//! on top in the shell; it is not part of this module.

use std::collections::HashSet;

/// Very common words that carry no topical weight — never highlight these.
const STOPWORDS: &[&str] = &[
    "the", "and", "for", "are", "but", "not", "you", "your", "with", "this", "that", "have", "has",
    "had", "was", "were", "will", "would", "could", "should", "from", "they", "them", "their",
    "what", "when", "where", "which", "about", "into", "than", "then", "there", "here", "been",
    "being", "just", "like", "some", "more", "most", "also", "only", "over", "such", "very",
    "much", "many", "each", "other", "because", "while", "after", "before", "these", "those",
    "still", "want", "need", "know", "make", "made", "does", "done", "going", "gonna",
];

const MIN_LEN: usize = 4;
const MAX_TERMS: usize = 12;

fn is_word_char(c: char) -> bool {
    c.is_alphanumeric() || c == '-' || c == '\''
}

/// Lowercased significant words from the context: length ≥ MIN_LEN and not a
/// stopword. These are the terms the message is matched against.
fn significant_terms(context: &str) -> HashSet<String> {
    context
        .split(|c: char| !is_word_char(c))
        .filter(|w| w.chars().count() >= MIN_LEN)
        .map(|w| w.to_lowercase())
        .filter(|w| !STOPWORDS.contains(&w.as_str()))
        .collect()
}

/// Phrases in `message` that also appear as significant terms in `context`.
/// Consecutive matching words merge into one phrase (e.g. "migration SLA").
/// Returns deduped, original-cased phrases in first-seen order, capped.
pub fn relevant_terms(message: &str, context: &str) -> Vec<String> {
    let terms = significant_terms(context);
    if terms.is_empty() {
        return Vec::new();
    }
    let mut out: Vec<String> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    let mut phrase: Vec<&str> = Vec::new();

    let mut flush = |phrase: &mut Vec<&str>| {
        if phrase.is_empty() {
            return;
        }
        let p = phrase.join(" ");
        phrase.clear();
        if seen.insert(p.to_lowercase()) {
            out.push(p);
        }
    };

    for word in message
        .split(|c: char| !is_word_char(c))
        .filter(|w| !w.is_empty())
    {
        if terms.contains(&word.to_lowercase()) {
            phrase.push(word);
        } else {
            flush(&mut phrase);
        }
    }
    flush(&mut phrase);

    out.truncate(MAX_TERMS);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_document_terms_and_merges_adjacent() {
        let context = "Enterprise onboarding covers the rollout for teams.";
        let message = "What does enterprise onboarding mean, and how fast is rollout for teams?";
        let hits = relevant_terms(message, context);
        // Adjacent matches ("enterprise onboarding") merge into one phrase.
        assert!(hits
            .iter()
            .any(|h| h.eq_ignore_ascii_case("enterprise onboarding")));
        assert!(hits.iter().any(|h| h.eq_ignore_ascii_case("rollout")));
        assert!(hits.iter().any(|h| h.eq_ignore_ascii_case("teams")));
    }

    #[test]
    fn ignores_stopwords_and_short_words() {
        let context = "the plan will have some data";
        let message = "the plan will have some data";
        // "plan" and "data" are ≥4 and not stopwords; the rest are filtered.
        let hits = relevant_terms(message, context);
        assert!(hits.iter().any(|h| h.eq_ignore_ascii_case("plan")));
        assert!(hits.iter().any(|h| h.eq_ignore_ascii_case("data")));
        assert!(!hits.iter().any(|h| h.eq_ignore_ascii_case("will")));
    }

    #[test]
    fn empty_when_no_overlap_or_no_context() {
        assert!(relevant_terms("hello there friend", "").is_empty());
        assert!(relevant_terms("completely unrelated words", "banana orange grape").is_empty());
    }

    #[test]
    fn dedupes_repeats() {
        // Non-adjacent repeats of "pricing" collapse to a single hit.
        let hits = relevant_terms(
            "Pricing matters, and pricing wins deals.",
            "pricing deals tiers",
        );
        let count = hits
            .iter()
            .filter(|h| h.eq_ignore_ascii_case("pricing"))
            .count();
        assert_eq!(count, 1);
    }
}

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

/// Phrases in `message` that also appear as significant terms in `context`
/// (the RAG-grounded signal). Consecutive matching words merge into one phrase.
fn doc_overlap_phrases(message: &str, context: &str) -> Vec<String> {
    let terms = significant_terms(context);
    if terms.is_empty() {
        return Vec::new();
    }
    let mut out: Vec<String> = Vec::new();
    let mut phrase: Vec<&str> = Vec::new();

    let flush = |phrase: &mut Vec<&str>, out: &mut Vec<String>| {
        if !phrase.is_empty() {
            out.push(phrase.join(" "));
            phrase.clear();
        }
    };

    for word in message
        .split(|c: char| !is_word_char(c))
        .filter(|w| !w.is_empty())
    {
        if terms.contains(&word.to_lowercase()) {
            phrase.push(word);
        } else {
            flush(&mut phrase, &mut out);
        }
    }
    flush(&mut phrase, &mut out);
    out
}

/// Capitalized/entity-ish tokens that never warrant a research chip.
fn is_noise_token(lower: &str) -> bool {
    matches!(
        lower,
        "i" | "i'm" | "i've" | "i'll" | "i'd" | "ok" | "okay" | "yeah" | "yep" | "yes" | "no"
    ) || STOPWORDS.contains(&lower)
}

/// Is `token` a proper noun (capitalized, not the sentence's first word) or an
/// acronym (all-caps, distinctive anywhere)? Sentence-initial capitals ("The",
/// "So", "Before") are excluded — they're grammar, not entities.
fn is_entity_token(token: &str, sentence_start: bool) -> bool {
    let lower = token.to_lowercase();
    if is_noise_token(&lower) {
        return false;
    }
    let letters: Vec<char> = token.chars().filter(|c| c.is_alphabetic()).collect();
    if letters.len() < 2 {
        return false; // drop single letters, bare numbers, timestamps
    }
    if letters.iter().all(|c| c.is_uppercase()) {
        return true; // acronym (GAAP, SLA, API)
    }
    token.chars().next().is_some_and(|c| c.is_uppercase()) && !sentence_start
}

/// Proper nouns + acronyms in `message` — names, places, brands, products
/// worth researching mid-conversation. Consecutive proper nouns merge
/// ("Kansas City"); sentence boundaries reset the "first word" rule.
fn proper_noun_phrases(message: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut phrase: Vec<String> = Vec::new();
    let mut token = String::new();
    let mut sentence_start = true;

    let flush = |phrase: &mut Vec<String>, out: &mut Vec<String>| {
        if !phrase.is_empty() {
            out.push(phrase.join(" "));
            phrase.clear();
        }
    };

    for c in message.chars() {
        if is_word_char(c) {
            token.push(c);
            continue;
        }
        if !token.is_empty() {
            if is_entity_token(&token, sentence_start) {
                phrase.push(std::mem::take(&mut token));
            } else {
                token.clear();
                flush(&mut phrase, &mut out);
            }
            sentence_start = false;
        }
        if matches!(c, '.' | '!' | '?' | '…') {
            flush(&mut phrase, &mut out);
            sentence_start = true;
        }
    }
    if !token.is_empty() && is_entity_token(&token, sentence_start) {
        phrase.push(token);
    }
    flush(&mut phrase, &mut out);
    out
}

/// Terms in `message` worth surfacing an Ally action on: **proper nouns /
/// acronyms first** (names, places, brands — the things a user looks up
/// mid-conversation, found regardless of the library), then **RAG-grounded
/// terms** that also appear in the retrieved documents. Deduped (case-
/// insensitive), first-seen order, capped at [`MAX_TERMS`].
pub fn relevant_terms(message: &str, context: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    for phrase in proper_noun_phrases(message)
        .into_iter()
        .chain(doc_overlap_phrases(message, context))
    {
        if phrase.trim().is_empty() {
            continue;
        }
        if seen.insert(phrase.to_lowercase()) {
            out.push(phrase);
        }
        if out.len() >= MAX_TERMS {
            break;
        }
    }
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
    fn highlights_proper_nouns_not_sentence_starts() {
        // Owner sample line — the researchable entities, no library needed.
        let msg =
            "Before I go ahead to Kansas City to meet Cole, I watched his YouTube videos online.";
        let hits = relevant_terms(msg, "");
        assert!(hits.iter().any(|h| h == "Kansas City"), "{hits:?}");
        assert!(hits.iter().any(|h| h == "Cole"), "{hits:?}");
        assert!(hits.iter().any(|h| h == "YouTube"), "{hits:?}");
        // Sentence-initial word + pronoun must NOT be flagged.
        assert!(!hits.iter().any(|h| h.eq_ignore_ascii_case("before")));
        assert!(!hits.iter().any(|h| h.eq_ignore_ascii_case("i")));
    }

    #[test]
    fn no_entities_from_lowercase_or_sentence_start_caps() {
        // "So" / "People" are sentence-initial; nothing else is capitalized.
        let msg = "So now, this is one of our number one games. People love shooting.";
        assert!(
            relevant_terms(msg, "").is_empty(),
            "{:?}",
            relevant_terms(msg, "")
        );
    }

    #[test]
    fn acronyms_are_flagged_anywhere() {
        let hits = relevant_terms("We follow GAAP and track the SLA closely.", "");
        assert!(hits.iter().any(|h| h == "GAAP"), "{hits:?}");
        assert!(hits.iter().any(|h| h == "SLA"), "{hits:?}");
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

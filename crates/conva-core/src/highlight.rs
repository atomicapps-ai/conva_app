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

use std::collections::{HashMap, HashSet};

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

// ── Signal weights (see docs/technical/highlighting-relevance.md) ────────────
// Signals compose additively per phrase, so a term that is both an entity and a
// context term outranks a bare entity. Context-first; rarity is the weakest,
// so it can only fill slots the stronger signals leave open.
const W_CONTEXT: f32 = 1.0;
const W_DOC: f32 = 0.6;
const W_ENTITY: f32 = 0.5;
const W_RARITY: f32 = 0.3;
/// Explicit 👍 (Phase 4): outscores every heuristic so the term always admits.
const W_BOOST: f32 = 2.0;

/// A rarity token must be at least this long (short words are rarely jargon).
const MIN_RARE_LEN: usize = 6;
/// Corpus IDF (`ln(N/df)`) at or above which a token counts as "rare". IDF is
/// already corpus-size-normalized, so this threshold is independent of N —
/// ≈ present in ≤ 13.5% of documents.
const RARITY_MIN_IDF: f32 = 2.0;

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

/// Everything needed to score one transcript message. All corpus- and
/// feedback-derived inputs are assembled by the shell and passed in, so this
/// module stays pure and deterministic. See
/// `docs/technical/highlighting-relevance.md`.
pub struct HighlightContext<'a> {
    /// Retrieved RAG chunk text — the doc-overlap signal.
    pub doc_text: &'a str,
    /// Active `ConversationContext` terms (its key terms + digest glossary).
    /// Empty when no context is active — the Tier-0 fallback.
    pub context_terms: &'a [String],
    /// Terms the user 👎'd — always dropped (decision 4). `None` until Phase 4.
    pub suppress: Option<&'a HashSet<String>>,
    /// Terms the user 👍'd/selected — always surfaced (decision 4). `None`
    /// until Phase 4.
    pub boost: Option<&'a HashSet<String>>,
    /// Rarity oracle: lowercased token → corpus IDF (`ln(N/df)`, higher =
    /// rarer). `None` disables rarity (Phase 3a); wired to the RAG store's BM25
    /// document frequencies in Phase 3b.
    pub rarity: Option<&'a dyn Fn(&str) -> f32>,
}

impl<'a> HighlightContext<'a> {
    /// Doc-only context: no active conversation context, feedback, or rarity
    /// oracle. The plain RAG-grounded fallback used by generic term analysis.
    pub fn from_doc_text(doc_text: &'a str) -> Self {
        Self {
            doc_text,
            context_terms: &[],
            suppress: None,
            boost: None,
            rarity: None,
        }
    }
}

/// A scored highlight candidate, keyed (deduped) by lowercased phrase.
struct Candidate {
    display: String,
    score: f32,
    /// Byte offset of the phrase's first appearance — the ordering tiebreak.
    first: usize,
}

/// Lowercased word tokens of `s` (same tokenizer the signals use).
fn tokens(s: &str) -> Vec<String> {
    s.split(|c: char| !is_word_char(c))
        .filter(|w| !w.is_empty())
        .map(|w| w.to_lowercase())
        .collect()
}

/// Does the token sequence `needle` appear consecutively (word-bounded) in
/// `hay`? Used for phrase-level context/boost matching.
fn contains_phrase(hay: &[String], needle: &[String]) -> bool {
    if needle.is_empty() || needle.len() > hay.len() {
        return false;
    }
    hay.windows(needle.len()).any(|w| w == needle)
}

/// Is `lower` (already lowercased) eligible as a rarity token before the corpus
/// check? Uncommon domain word — long enough, alphabetic, not stop/noise.
fn is_rarity_candidate(lower: &str) -> bool {
    lower.chars().count() >= MIN_RARE_LEN
        && lower.chars().all(|c| c.is_alphabetic())
        && !is_noise_token(lower)
}

/// Accumulate `weight` onto the candidate for `phrase`, merging case-insensitive
/// duplicates (scores add).
fn add_candidate(
    cands: &mut Vec<Candidate>,
    index: &mut HashMap<String, usize>,
    lower_msg: &str,
    phrase: &str,
    weight: f32,
) {
    let key = phrase.to_lowercase();
    if key.trim().is_empty() {
        return;
    }
    if let Some(&i) = index.get(&key) {
        cands[i].score += weight;
        return;
    }
    let first = lower_msg.find(&key).unwrap_or(usize::MAX);
    index.insert(key, cands.len());
    cands.push(Candidate {
        display: phrase.to_string(),
        score: weight,
        first,
    });
}

/// Terms in `message` worth surfacing an Ally action on, scored by a composed,
/// **context-first** model: declared context terms (strongest), then
/// RAG-grounded doc overlap, then proper nouns / acronyms, then rare words
/// (weakest — fills only the slots the others leave). Feedback overrides apply
/// (👍 boost / 👎 suppress). Deduped case-insensitively, highest score first
/// (ties by first appearance), capped at [`MAX_TERMS`].
pub fn relevant_terms(message: &str, ctx: &HighlightContext) -> Vec<String> {
    let lower_msg = message.to_lowercase();
    let msg_tokens = tokens(message);
    let mut cands: Vec<Candidate> = Vec::new();
    let mut index: HashMap<String, usize> = HashMap::new();

    // Context terms declared/derived for this conversation (strongest).
    for term in ctx.context_terms {
        if contains_phrase(&msg_tokens, &tokens(term)) {
            add_candidate(&mut cands, &mut index, &lower_msg, term.trim(), W_CONTEXT);
        }
    }
    // RAG-grounded overlap with the retrieved library chunks.
    for phrase in doc_overlap_phrases(message, ctx.doc_text) {
        add_candidate(&mut cands, &mut index, &lower_msg, &phrase, W_DOC);
    }
    // Proper nouns / acronyms — researchable regardless of the library.
    for phrase in proper_noun_phrases(message) {
        add_candidate(&mut cands, &mut index, &lower_msg, &phrase, W_ENTITY);
    }
    // Rare words (corpus IDF via the shell oracle) — the no-context fallback.
    if let Some(idf) = ctx.rarity {
        for token in message
            .split(|c: char| !is_word_char(c))
            .filter(|w| !w.is_empty())
        {
            let lower = token.to_lowercase();
            if is_rarity_candidate(&lower) && idf(&lower) >= RARITY_MIN_IDF {
                add_candidate(&mut cands, &mut index, &lower_msg, token, W_RARITY);
            }
        }
    }
    // Explicit 👍 (Phase 4): surface even if the heuristics missed it.
    if let Some(boost) = ctx.boost {
        for term in boost {
            if contains_phrase(&msg_tokens, &tokens(term)) {
                add_candidate(&mut cands, &mut index, &lower_msg, term.trim(), W_BOOST);
            }
        }
    }

    // Drop 👎 terms outright (case-insensitive), whatever they scored.
    if let Some(suppress) = ctx.suppress {
        cands.retain(|c| !suppress.iter().any(|s| s.eq_ignore_ascii_case(&c.display)));
    }

    // Strongest first; ties by earliest appearance. Score ordering makes rarity
    // (0.3) fall behind every grounded/context/entity signal automatically.
    cands.sort_by(|a, b| {
        b.score
            .partial_cmp(&a.score)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then(a.first.cmp(&b.first))
    });

    let mut out: Vec<String> = Vec::new();
    let mut admitted: Vec<Vec<String>> = Vec::new();
    for cand in cands {
        let cand_tokens = tokens(&cand.display);
        // Skip a single word already contained in a stronger admitted phrase
        // (e.g. "lambda" when "AWS Lambda" is already in).
        if cand_tokens.len() == 1
            && admitted
                .iter()
                .any(|a| a.len() > 1 && a.contains(&cand_tokens[0]))
        {
            continue;
        }
        out.push(cand.display);
        admitted.push(cand_tokens);
        if out.len() >= MAX_TERMS {
            break;
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Doc-only convenience (the Tier-0 fallback): no context, feedback, or
    /// rarity oracle.
    fn terms(message: &str, doc: &str) -> Vec<String> {
        relevant_terms(message, &HighlightContext::from_doc_text(doc))
    }

    #[test]
    fn matches_document_terms_and_merges_adjacent() {
        let context = "Enterprise onboarding covers the rollout for teams.";
        let message = "What does enterprise onboarding mean, and how fast is rollout for teams?";
        let hits = terms(message, context);
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
        let hits = terms(message, context);
        assert!(hits.iter().any(|h| h.eq_ignore_ascii_case("plan")));
        assert!(hits.iter().any(|h| h.eq_ignore_ascii_case("data")));
        assert!(!hits.iter().any(|h| h.eq_ignore_ascii_case("will")));
    }

    #[test]
    fn empty_when_no_overlap_or_no_context() {
        assert!(terms("hello there friend", "").is_empty());
        assert!(terms("completely unrelated words", "banana orange grape").is_empty());
    }

    #[test]
    fn highlights_proper_nouns_not_sentence_starts() {
        // Owner sample line — the researchable entities, no library needed.
        let msg =
            "Before I go ahead to Kansas City to meet Cole, I watched his YouTube videos online.";
        let hits = terms(msg, "");
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
        assert!(terms(msg, "").is_empty(), "{:?}", terms(msg, ""));
    }

    #[test]
    fn acronyms_are_flagged_anywhere() {
        let hits = terms("We follow GAAP and track the SLA closely.", "");
        assert!(hits.iter().any(|h| h == "GAAP"), "{hits:?}");
        assert!(hits.iter().any(|h| h == "SLA"), "{hits:?}");
    }

    #[test]
    fn dedupes_repeats() {
        // Non-adjacent repeats of "pricing" collapse to a single hit.
        let hits = terms(
            "Pricing matters, and pricing wins deals.",
            "pricing deals tiers",
        );
        let count = hits
            .iter()
            .filter(|h| h.eq_ignore_ascii_case("pricing"))
            .count();
        assert_eq!(count, 1);
    }

    // ── Phase 3 — context-aware scoring ─────────────────────────────────────

    #[test]
    fn context_term_surfaces_lowercase_and_outranks_entity() {
        // The motivating case: "pensive theory" is lowercase, not in the docs,
        // not a proper noun — only the context makes it matter. And a context
        // term (1.0) must rank ahead of a bare entity (0.5).
        let context_terms = vec!["pensive theory".to_string()];
        let ctx = HighlightContext {
            context_terms: &context_terms,
            ..HighlightContext::from_doc_text("")
        };
        // "Denver" is a mid-sentence entity (0.5); the context term scores 1.0
        // and must rank ahead of it despite appearing later in the sentence.
        let hits = relevant_terms(
            "We met in Denver, but the pensive theory is what matters here.",
            &ctx,
        );
        assert!(
            hits.iter()
                .any(|h| h.eq_ignore_ascii_case("pensive theory")),
            "{hits:?}"
        );
        assert!(hits.iter().any(|h| h == "Denver"), "{hits:?}");
        let pos = |needle: &str| hits.iter().position(|h| h.eq_ignore_ascii_case(needle));
        assert!(
            pos("pensive theory") < pos("Denver"),
            "context term ranks before the entity: {hits:?}"
        );
    }

    #[test]
    fn lowercase_non_context_term_is_not_flagged_without_rarity() {
        // Same phrase, but not declared and no rarity oracle → stays quiet.
        let hits = terms("the pensive theory is what matters here.", "");
        assert!(!hits
            .iter()
            .any(|h| h.eq_ignore_ascii_case("pensive theory")));
        assert!(!hits.iter().any(|h| h.eq_ignore_ascii_case("pensive")));
    }

    #[test]
    fn rarity_surfaces_uncommon_word_via_oracle() {
        // Oracle marks "pensive" corpus-rare; "matters" is common.
        let idf = |t: &str| if t == "pensive" { 5.0 } else { 0.0 };
        let ctx = HighlightContext {
            rarity: Some(&idf),
            ..HighlightContext::from_doc_text("")
        };
        let hits = relevant_terms("the pensive theory matters here.", &ctx);
        assert!(
            hits.iter().any(|h| h.eq_ignore_ascii_case("pensive")),
            "{hits:?}"
        );
        assert!(
            !hits.iter().any(|h| h.eq_ignore_ascii_case("matters")),
            "{hits:?}"
        );
    }

    #[test]
    fn suppress_drops_and_boost_surfaces() {
        // 👎 removes a would-be hit; 👍 surfaces one the heuristics miss.
        let suppress: HashSet<String> = ["GAAP".to_string()].into_iter().collect();
        let boost: HashSet<String> = ["gut feel".to_string()].into_iter().collect();
        let ctx = HighlightContext {
            suppress: Some(&suppress),
            boost: Some(&boost),
            ..HighlightContext::from_doc_text("")
        };
        let hits = relevant_terms("We follow GAAP but I go on gut feel.", &ctx);
        assert!(
            !hits.iter().any(|h| h.eq_ignore_ascii_case("GAAP")),
            "{hits:?}"
        );
        assert!(
            hits.iter().any(|h| h.eq_ignore_ascii_case("gut feel")),
            "{hits:?}"
        );
    }
}

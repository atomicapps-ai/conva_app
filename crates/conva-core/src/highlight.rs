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
//!
//! One of three tiers of the **FANER Engine** (proprietary live extraction
//! layer, alongside `tracker.rs` and `radar.rs`) — see
//! `conva_core/docs/technical/faner-engine.md`.

use std::collections::{HashMap, HashSet};

use crate::phrase::{
    self, CandidateTrace, HighlightEvaluation, ResolveInput, SignalTrace, Span, SpanTrace,
};

/// Very common words that carry no topical weight — never highlight these.
///
/// This is deliberately broader than a classic grammatical stopword list
/// (owner report, 2026-09-23: a live conversation's Terms tab filled up with
/// noise like "current", "background", "It's", "So", "Mhmm" instead of
/// jargon). Two failure modes converge on this one list:
///  - `doc_overlap_phrases` flags ANY shared word ≥ [`MIN_LEN`] between the
///    spoken text and the indexed document, with no rarity check — a
///    résumé-style document is mostly ordinary prose, so ordinary words
///    shared with speech (e.g. "background", "expertise", "question") were
///    passing straight through the old 36-word list.
///  - `is_entity_token`'s sentence-start tracking only resets on `.`/`!`/
///    `?`/`…` in the flattened turn text, but ASR turns are joined with a
///    plain space — Whisper capitalizes each new utterance's first word
///    without necessarily closing the previous one with terminal
///    punctuation, so backchannel/filler words and ordinary sentence-initial
///    words ("Always", "So", "Mhmm", "It's") get mistaken for proper nouns.
///
/// Both paths already gate through `is_noise_token` -> `STOPWORDS`, so one
/// broader list fixes both. Deliberately keeps out words with a real dual
/// technical sense even though they're common prose (e.g. "message",
/// "service", "point", "development", "information", "long") — those stay
/// eligible so a genuine "message broker"/"service architecture" still
/// surfaces; see `doc_overlap_ignores_common_words_the_oracle_scores_low` below.
const STOPWORDS: &[&str] = &[
    "the",
    "and",
    "for",
    "are",
    "but",
    "not",
    "you",
    "your",
    "with",
    "this",
    "that",
    "have",
    "has",
    "had",
    "was",
    "were",
    "will",
    "would",
    "could",
    "should",
    "from",
    "they",
    "them",
    "their",
    "what",
    "when",
    "where",
    "which",
    "about",
    "into",
    "than",
    "then",
    "there",
    "here",
    "been",
    "being",
    "just",
    "like",
    "some",
    "more",
    "most",
    "also",
    "only",
    "over",
    "such",
    "very",
    "much",
    "many",
    "each",
    "other",
    "because",
    "while",
    "after",
    "before",
    "these",
    "those",
    "still",
    "want",
    "wanted",
    "need",
    "know",
    "knew",
    "make",
    "made",
    "does",
    "done",
    "going",
    "gonna",
    "so",
    "worked",
    "always",
    "although",
    "driven",
    "kind",
    "sort",
    "sorta",
    // Contractions — ASR renders these as one apostrophe'd token.
    "it's",
    "that's",
    "there's",
    "here's",
    "what's",
    "let's",
    "who's",
    "he's",
    "she's",
    "i'm",
    "i've",
    "i'll",
    "i'd",
    "you're",
    "you've",
    "you'll",
    "you'd",
    "we're",
    "we've",
    "we'll",
    "we'd",
    "they're",
    "they've",
    "they'll",
    "they'd",
    "isn't",
    "aren't",
    "wasn't",
    "weren't",
    "doesn't",
    "didn't",
    "wouldn't",
    "couldn't",
    "shouldn't",
    "won't",
    "can't",
    "don't",
    // Backchannel / filler — near-universal in a live ASR transcript, never jargon.
    "mhmm",
    "hmm",
    "uh",
    "um",
    "huh",
    "uh-huh",
    "alright",
    // Common qualifiers/adverbs — carry no topical weight regardless of context.
    "maybe",
    "probably",
    "really",
    "actually",
    "basically",
    "mostly",
    "definitely",
    "especially",
    "exactly",
    "currently",
    "recently",
    "previously",
    "already",
    "somewhat",
    // Common adjectives — generic in any domain.
    "current",
    "fine",
    "strong",
    "general",
    "specific",
    "different",
    "first",
    "next",
    "last",
    "same",
    "own",
    "whole",
    "little",
    "certain",
    "various",
    "particular",
    // Common resume/bio-prose nouns — generic filler in a self-introduction.
    "background",
    "interest",
    "expertise",
    "introduction",
    "question",
    "details",
    "name",
    "area",
    "areas",
    "moment",
    "moments",
    "thing",
    "things",
    "way",
    "ways",
    // Common verbs — generic regardless of domain.
    "think",
    "thought",
    "wanted",
    "understand",
    "understood",
    "talk",
    "talking",
    "ask",
    "asking",
    "tell",
    "telling",
    "look",
    "looking",
    "come",
    "coming",
    "give",
    "giving",
];

const MIN_LEN: usize = 4;
pub const MAX_TERMS: usize = 12;

// ── Signal weights (see docs/technical/highlighting-relevance.md) ────────────
// Signals compose additively per phrase, so a term that is both an entity and a
// context term outranks a bare entity. Context-first; rarity is the weakest,
// so it can only fill slots the stronger signals leave open.
const W_CONTEXT: f32 = 1.0;
const W_DOC: f32 = 0.6;
const W_ENTITY: f32 = 0.5;
const W_RARITY: f32 = 0.3;
/// Domain-lexicon phrases (`crate::lexicon`): core sits just under document
/// signals and above bare entities; extended sits under entities.
const W_DOMAIN_CORE: f32 = 0.55;
const W_DOMAIN_EXTENDED: f32 = 0.40;
/// Explicit 👍 (Phase 4): outscores every heuristic so the term always admits.
const W_BOOST: f32 = 2.0;

/// A rarity token must be at least this long (short words are rarely jargon).
const MIN_RARE_LEN: usize = 6;
/// Corpus IDF (`ln(N/df)`) at or above which a token counts as "rare". IDF is
/// already corpus-size-normalized, so this threshold is independent of N —
/// ≈ present in ≤ 13.5% of documents.
const RARITY_MIN_IDF: f32 = 2.0;
/// Corpus IDF at or above which a *doc-overlap* word counts as "significant"
/// when a rarity oracle is supplied — lower than [`RARITY_MIN_IDF`] because
/// doc-overlap already has a stronger corroborating signal than bare rarity
/// (the word is grounded in an actively retrieved, topically-relevant
/// document, not just globally uncommon). Defense-in-depth alongside the
/// broadened [`STOPWORDS`]: a short résumé/bio document is mostly ordinary
/// prose, so presence-in-doc alone doesn't distinguish jargon from filler —
/// see the 2026-09-23 noisy-Terms-tab report.
const DOC_OVERLAP_MIN_IDF: f32 = 1.0;

fn is_word_char(c: char) -> bool {
    c.is_alphanumeric() || c == '-' || c == '\''
}

/// Lowercased significant words from the context: length ≥ MIN_LEN, not a
/// stopword, and — when `rarity` is supplied — not a high-frequency corpus
/// word either. These are the terms the message is matched against.
/// `rarity: None` (the doc-only mining paths: `salient_doc_terms`,
/// `interviewer_terms`, and every test using `HighlightContext::from_doc_text`)
/// keeps the STOPWORDS-only behavior unchanged — this only tightens the LIVE
/// conversation path, which always supplies a real IDF oracle
/// (`src-tauri/src/lib.rs`'s `analyze_terms`).
fn significant_terms(context: &str, rarity: Option<&dyn Fn(&str) -> f32>) -> HashSet<String> {
    context
        .split(|c: char| !is_word_char(c))
        .filter(|w| w.chars().count() >= MIN_LEN)
        .map(|w| w.to_lowercase())
        .filter(|w| !STOPWORDS.contains(&w.as_str()))
        .filter(|w| match rarity {
            Some(idf) => idf(w) >= DOC_OVERLAP_MIN_IDF,
            None => true,
        })
        .collect()
}

/// Byte spans of the words in `text` under the highlighter's word-char rule.
fn word_spans(text: &str) -> Vec<(usize, usize)> {
    let mut out = Vec::new();
    let mut start: Option<usize> = None;
    for (i, c) in text.char_indices() {
        match (is_word_char(c), start) {
            (true, None) => start = Some(i),
            (false, Some(s)) => {
                out.push((s, i));
                start = None;
            }
            _ => {}
        }
    }
    if let Some(s) = start {
        out.push((s, text.len()));
    }
    out
}

/// Phrases in `message` made only of significant document words (the
/// RAG-grounded signal). Consecutive matching words merge into one phrase —
/// but only across a plain space: a comma, period, line break, or bracket
/// between two matching words ends the phrase (`crate::phrase` gap policy), so
/// "Python, Kafka" is two terms rather than one invented "Python Kafka".
fn doc_overlap_phrases(message: &str, terms: &HashSet<String>) -> Vec<String> {
    if terms.is_empty() {
        return Vec::new();
    }
    let mut out: Vec<String> = Vec::new();
    // (start, end) byte span of the phrase being built.
    let mut run: Option<(usize, usize)> = None;

    let flush = |run: &mut Option<(usize, usize)>, out: &mut Vec<String>| {
        if let Some((s, e)) = run.take() {
            out.push(message[s..e].to_string());
        }
    };

    for (start, end) in word_spans(message) {
        if terms.contains(&message[start..end].to_lowercase()) {
            match run {
                Some((s, e)) if phrase::classify_gap(&message[e..start]) == phrase::Gap::Join => {
                    run = Some((s, end));
                }
                _ => {
                    flush(&mut run, &mut out);
                    run = Some((start, end));
                }
            }
        } else {
            flush(&mut run, &mut out);
        }
    }
    flush(&mut run, &mut out);
    out
}

/// Capitalized/entity-ish tokens that never warrant a research chip.
pub(crate) fn is_noise_token(lower: &str) -> bool {
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
/// ("Kansas City") across a plain space only; sentence boundaries reset the
/// "first word" rule, and any hard gap (quote, bracket, line break, spaced
/// dash) also ends the phrase (`crate::phrase` gap policy).
fn proper_noun_phrases(message: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    // (start, end) byte span of the phrase being built.
    let mut run: Option<(usize, usize)> = None;
    let mut token = String::new();
    let mut token_start = 0usize;
    let mut sentence_start = true;

    let flush = |run: &mut Option<(usize, usize)>, out: &mut Vec<String>| {
        if let Some((s, e)) = run.take() {
            out.push(message[s..e].to_string());
        }
    };
    // Extend the phrase with the entity token at `start..end`, or start a
    // new phrase when the gap since the last token is not a plain join.
    let push =
        |run: &mut Option<(usize, usize)>, out: &mut Vec<String>, start: usize, end: usize| {
            match *run {
                Some((s, e)) if phrase::classify_gap(&message[e..start]) == phrase::Gap::Join => {
                    *run = Some((s, end));
                }
                _ => {
                    flush(run, out);
                    *run = Some((start, end));
                }
            }
        };

    for (i, c) in message.char_indices() {
        if is_word_char(c) {
            if token.is_empty() {
                token_start = i;
            }
            token.push(c);
            continue;
        }
        if !token.is_empty() {
            if is_entity_token(&token, sentence_start) {
                push(&mut run, &mut out, token_start, i);
            } else {
                flush(&mut run, &mut out);
            }
            token.clear();
            sentence_start = false;
        }
        if matches!(c, '.' | '!' | '?' | '…') {
            flush(&mut run, &mut out);
            sentence_start = true;
        } else if matches!(c, ',' | ';' | ':') {
            // A clause break, not a sentence end: the next capital is still
            // mid-sentence (so still entity-eligible), but it must start a
            // new phrase rather than glue onto the one before the comma —
            // "IBM Watson, Claude, and ChatGPT" is three entities, not one.
            flush(&mut run, &mut out);
        }
    }
    if !token.is_empty() && is_entity_token(&token, sentence_start) {
        push(&mut run, &mut out, token_start, message.len());
    }
    flush(&mut run, &mut out);
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
    /// Domain lexicon (bundled packs selected for the active Context) — the
    /// "vocabulary any LLM already knows" signal. `None` = off.
    pub lexicon: Option<&'a crate::lexicon::Lexicon>,
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
            lexicon: None,
        }
    }
}

/// What nominated a candidate. `Context`, `Boost`, and `DocPhrase` are
/// *canonical* — prepared/document terminology that beats a contained
/// fragment regardless of score.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Source {
    Context,
    Boost,
    DocPhrase,
    DocOverlap,
    Entity,
    Rarity,
    DomainCore,
    DomainExtended,
}

impl Source {
    fn label(self) -> &'static str {
        match self {
            Source::Context => "context term",
            Source::Boost => "boost",
            Source::DocPhrase => "document phrase",
            Source::DocOverlap => "document overlap",
            Source::Entity => "entity/acronym",
            Source::Rarity => "rarity",
            Source::DomainCore => "domain lexicon (core)",
            Source::DomainExtended => "domain lexicon (extended)",
        }
    }
    fn canonical(self) -> bool {
        matches!(self, Source::Context | Source::Boost | Source::DocPhrase)
    }
}

/// A scored highlight candidate, keyed (deduped) by normalized phrase key
/// (`phrase::normalize_key`: case-, hyphen- and spacing-insensitive).
struct Candidate {
    key: String,
    score: f32,
    signals: Vec<(Source, f32)>,
}

impl Candidate {
    /// Visual-weight class: the strongest reason wins. Domain applies only when
    /// the lexicon (optionally with rarity) is the *sole* reason — a proper
    /// noun that a pack also knows is still an entity.
    fn origin(&self) -> phrase::HighlightOrigin {
        use phrase::HighlightOrigin as O;
        let has = |want: &dyn Fn(Source) -> bool| self.signals.iter().any(|(s, _)| want(*s));
        if has(&|s| matches!(s, Source::Context | Source::Boost)) {
            O::Context
        } else if has(&|s| matches!(s, Source::DocPhrase | Source::DocOverlap)) {
            O::Document
        } else if has(&|s| matches!(s, Source::Entity)) {
            O::Entity
        } else if has(&|s| matches!(s, Source::DomainCore | Source::DomainExtended)) {
            O::Domain
        } else {
            O::Rarity
        }
    }

    /// The user's own vocabulary — a declared Context term or an explicit 👍.
    /// These rank ahead of every heuristic candidate whatever the summed score,
    /// so nothing the app merely *inferred* (documents, entities, rarity, the
    /// domain lexicon) can push them out under the result cap.
    fn is_user_term(&self) -> bool {
        self.signals
            .iter()
            .any(|(s, _)| matches!(s, Source::Context | Source::Boost))
    }
}

/// Lowercased word tokens of `s` (same tokenizer the signals use).
fn tokens(s: &str) -> Vec<String> {
    s.split(|c: char| !is_word_char(c))
        .filter(|w| !w.is_empty())
        .map(|w| w.to_lowercase())
        .collect()
}

/// Final, source-independent admission gate. Every candidate source — active
/// Context terms, document overlap, entity detection, rarity, and explicit
/// feedback — must contain at least one meaningful token. This prevents a
/// malformed/generated Context term or historical 👍 from bypassing the same
/// stopword and filler hygiene applied by the heuristic paths.
///
/// Phrases containing connector words remain valid when they also contain a
/// content word (for example, "state of the art").
pub(crate) fn has_content_bearing_token(phrase: &str) -> bool {
    tokens(phrase).iter().any(|token| {
        !is_noise_token(token)
            && token
                .chars()
                .any(|character| character.is_alphabetic() || character.is_numeric())
    })
}

/// Does the token sequence `needle` appear consecutively (word-bounded) in
/// `hay`? Used by the document-mining survival gates.
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

/// Accumulate `weight` onto the candidate for `phrase`. Each source counts
/// once per phrase (a term listed twice in the context is still one signal);
/// distinct sources add.
fn add_candidate(
    cands: &mut Vec<Candidate>,
    index: &mut HashMap<String, usize>,
    phrase_text: &str,
    source: Source,
    weight: f32,
) {
    let key = phrase::normalize_key(phrase_text);
    if key.is_empty() {
        return;
    }
    if let Some(&i) = index.get(&key) {
        if !cands[i].signals.iter().any(|(s, _)| *s == source) {
            cands[i].score += weight;
            cands[i].signals.push((source, weight));
        }
        return;
    }
    index.insert(key.clone(), cands.len());
    cands.push(Candidate {
        key,
        score: weight,
        signals: vec![(source, weight)],
    });
}

/// Terms in `message` worth surfacing an Ally action on, scored by a composed,
/// **context-first** model: declared context terms (strongest), then
/// RAG-grounded doc overlap, then proper nouns / acronyms, then rare words
/// (weakest — fills only the slots the others leave). Feedback overrides apply
/// (👍 boost / 👎 suppress). Phrase resolution is longest-match-first and
/// occurrence-aware (`crate::phrase`): a fragment is dropped only where a
/// longer, stronger phrase contains it. Deduped case-insensitively, highest
/// score first (ties by first appearance), capped at [`MAX_TERMS`]. Each term
/// is the transcript's own text (original casing).
pub fn relevant_terms(message: &str, ctx: &HighlightContext) -> Vec<String> {
    relevant_terms_capped(message, ctx, MAX_TERMS)
}

/// [`relevant_terms`] with an explicit result cap — the live-message path
/// keeps [`MAX_TERMS`] via the wrapper; document/JD mining passes larger
/// caps (spec 2026-08-26: the silent 12-term ceiling starved JD mining).
pub fn relevant_terms_capped(message: &str, ctx: &HighlightContext, cap: usize) -> Vec<String> {
    evaluate_terms(message, ctx, cap).terms
}

/// [`relevant_terms_capped`] plus a per-candidate trace explaining every
/// selection and rejection — the dev/debug evaluation
/// (`faner_debug_highlight`). `terms` is exactly what the production path
/// returns; the trace is never built into production payloads.
pub fn evaluate_terms(message: &str, ctx: &HighlightContext, cap: usize) -> HighlightEvaluation {
    let msg_tokens = phrase::tokenize(message);
    let mut cands: Vec<Candidate> = Vec::new();
    let mut index: HashMap<String, usize> = HashMap::new();
    let occurs = |term: &str| !phrase::find_occurrences(&msg_tokens, term).is_empty();

    // Context terms declared/derived for this conversation (strongest).
    for term in ctx.context_terms {
        if occurs(term) {
            add_candidate(
                &mut cands,
                &mut index,
                term.trim(),
                Source::Context,
                W_CONTEXT,
            );
        }
    }
    // RAG-grounded overlap with the retrieved library chunks.
    let significant = significant_terms(ctx.doc_text, ctx.rarity);
    for phrase_text in
        phrase::document_acronym_phrases(message, &msg_tokens, ctx.doc_text, &significant)
    {
        add_candidate(
            &mut cands,
            &mut index,
            &phrase_text,
            Source::DocPhrase,
            W_DOC,
        );
    }
    for phrase_text in doc_overlap_phrases(message, &significant) {
        add_candidate(
            &mut cands,
            &mut index,
            &phrase_text,
            Source::DocOverlap,
            W_DOC,
        );
    }
    // Proper nouns / acronyms — researchable regardless of the library.
    for phrase_text in proper_noun_phrases(message) {
        add_candidate(
            &mut cands,
            &mut index,
            &phrase_text,
            Source::Entity,
            W_ENTITY,
        );
    }
    // Rare words (corpus IDF via the shell oracle) — the no-context fallback.
    if let Some(idf) = ctx.rarity {
        for (start, end) in word_spans(message) {
            let token = &message[start..end];
            let lower = token.to_lowercase();
            if is_rarity_candidate(&lower) && idf(&lower) >= RARITY_MIN_IDF {
                add_candidate(&mut cands, &mut index, token, Source::Rarity, W_RARITY);
            }
        }
    }
    // Domain lexicon: vocabulary any LLM already knows for this conversation's
    // domain (`modeling data` in a technical interview). The matched SURFACE
    // text is the candidate, so the highlight is what was actually said.
    if let Some(lexicon) = ctx.lexicon {
        for m in lexicon.matches(&msg_tokens) {
            let surface = &message[m.span.start..m.span.end];
            let (source, weight) = match m.tier {
                crate::lexicon::Tier::Core => (Source::DomainCore, W_DOMAIN_CORE),
                crate::lexicon::Tier::Extended => (Source::DomainExtended, W_DOMAIN_EXTENDED),
            };
            add_candidate(&mut cands, &mut index, surface, source, weight);
        }
    }
    // Explicit 👍 (Phase 4): surface even if the heuristics missed it.
    if let Some(boost) = ctx.boost {
        for term in boost {
            if occurs(term) {
                add_candidate(&mut cands, &mut index, term.trim(), Source::Boost, W_BOOST);
            }
        }
    }

    // Strongest first; ties by earliest appearance. Score ordering makes rarity
    // (0.3) fall behind every grounded/context/entity signal automatically.
    let mut work: Vec<Work> = cands
        .into_iter()
        .map(|c| {
            let spans = phrase::find_occurrences(&msg_tokens, &c.key);
            Work {
                cand: c,
                spans,
                rejected: None,
            }
        })
        .collect();
    work.sort_by(|a, b| {
        b.cand
            .is_user_term()
            .cmp(&a.cand.is_user_term())
            .then(
                b.cand
                    .score
                    .partial_cmp(&a.cand.score)
                    .unwrap_or(std::cmp::Ordering::Equal),
            )
            .then_with(|| {
                let first = |w: &Work| w.spans.first().map_or(usize::MAX, |s| s.start);
                first(a).cmp(&first(b))
            })
    });

    // Drop 👎 terms outright (case-insensitive), whatever they scored.
    if let Some(suppress) = ctx.suppress {
        let keys: HashSet<String> = suppress.iter().map(|s| phrase::normalize_key(s)).collect();
        for w in work.iter_mut().filter(|w| keys.contains(&w.cand.key)) {
            w.rejected = Some("suppressed by 👎 feedback".into());
        }
    }
    // Defense in depth: explicit Context terms and feedback are valuable
    // signals, not permission to surface semantically empty words.
    for w in work
        .iter_mut()
        .filter(|w| w.rejected.is_none() && !has_content_bearing_token(&w.cand.key))
    {
        w.rejected = Some("no content-bearing token (stopword/noise only)".into());
    }

    // Occurrence-aware longest-match-first containment among survivors.
    let live: Vec<usize> = (0..work.len())
        .filter(|&i| work[i].rejected.is_none())
        .collect();
    let inputs: Vec<ResolveInput> = live
        .iter()
        .map(|&i| ResolveInput {
            key: work[i].cand.key.clone(),
            score: work[i].cand.score,
            canonical: work[i].cand.signals.iter().any(|(s, _)| s.canonical()),
            spans: work[i].spans.clone(),
        })
        .collect();
    let resolved = phrase::resolve_containment(&inputs);
    let mut contained_all: Vec<Vec<(Span, String)>> = vec![Vec::new(); work.len()];
    for (slot, &i) in live.iter().enumerate() {
        let r = &resolved[slot];
        contained_all[i] = r.contained.clone();
        if r.kept.is_empty() && !work[i].spans.is_empty() {
            let container = r.contained.first().map(|(_, k)| k.as_str()).unwrap_or("?");
            work[i].rejected = Some(format!("contained in longer phrase \"{container}\""));
        }
        work[i].spans = r.kept.clone();
    }
    // Re-rank on the first *surviving* occurrence so ties follow the text.
    let mut order: Vec<usize> = (0..work.len()).collect();
    order.sort_by(|&a, &b| {
        let (wa, wb) = (&work[a], &work[b]);
        (wa.rejected.is_some())
            .cmp(&wb.rejected.is_some())
            .then(wb.cand.is_user_term().cmp(&wa.cand.is_user_term()))
            .then(
                wb.cand
                    .score
                    .partial_cmp(&wa.cand.score)
                    .unwrap_or(std::cmp::Ordering::Equal),
            )
            .then_with(|| {
                let first = |w: &Work| w.spans.first().map_or(usize::MAX, |s| s.start);
                first(wa).cmp(&first(wb))
            })
    });

    let char_at = |byte: usize| message[..byte].chars().count();
    let mut terms: Vec<String> = Vec::new();
    let mut origins: Vec<phrase::HighlightOrigin> = Vec::new();
    let mut trace: Vec<CandidateTrace> = Vec::new();
    for &i in &order {
        let w = &work[i];
        let first_span = w.spans.first().copied();
        let display = first_span
            .map(|s| message[s.start..s.end].to_string())
            .unwrap_or_else(|| w.cand.key.clone());
        let mut rejected = w.rejected.clone();
        if rejected.is_none() && terms.len() >= cap {
            rejected = Some(format!("below the result cap of {cap}"));
        }
        let selected = rejected.is_none();
        if selected {
            terms.push(display.clone());
            origins.push(w.cand.origin());
        }
        let mut spans: Vec<SpanTrace> = w
            .spans
            .iter()
            .map(|s| SpanTrace {
                start: char_at(s.start),
                end: char_at(s.end),
                text: message[s.start..s.end].to_string(),
                status: "selected".into(),
                container: None,
            })
            .collect();
        for (s, container) in &contained_all[i] {
            spans.push(SpanTrace {
                start: char_at(s.start),
                end: char_at(s.end),
                text: message[s.start..s.end].to_string(),
                status: "contained".into(),
                container: Some(container.clone()),
            });
        }
        spans.sort_by_key(|s| s.start);
        let reason = match (&rejected, contained_all[i].len()) {
            (Some(r), _) => r.clone(),
            (None, 0) => "selected".into(),
            (None, n) => format!("selected; {n} nested occurrence(s) contained in a longer phrase"),
        };
        trace.push(CandidateTrace {
            term: display,
            key: w.cand.key.clone(),
            score: w.cand.score,
            signals: w
                .cand
                .signals
                .iter()
                .map(|(s, weight)| SignalTrace {
                    source: s.label().into(),
                    weight: *weight,
                })
                .collect(),
            spans,
            decision: if selected { "selected" } else { "rejected" }.into(),
            reason,
            origin: w.cand.origin(),
        });
    }
    HighlightEvaluation {
        terms,
        origins,
        trace,
    }
}

/// A candidate mid-resolution: its located occurrences and, once decided,
/// why it was rejected.
struct Work {
    cand: Candidate,
    spans: Vec<Span>,
    rejected: Option<String>,
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
    fn comma_separated_entities_stay_distinct() {
        // Real transcript bug: "IBM Watson, Claude, and ChatGPT" was merging
        // into one bogus phrase "IBM Watson Claude" because only '.', '!',
        // '?', '…' broke a run of capitalized words — a comma-separated list
        // (spoken enumeration is extremely common) didn't. A comma is a
        // clause break, not a sentence end, so it must flush the phrase
        // without making the next word "sentence-initial" (still eligible).
        let hits = terms("I have worked with IBM Watson, Claude, and ChatGPT.", "");
        assert!(hits.iter().any(|h| h == "IBM Watson"), "{hits:?}");
        assert!(hits.iter().any(|h| h == "Claude"), "{hits:?}");
        assert!(hits.iter().any(|h| h == "ChatGPT"), "{hits:?}");
        assert!(!hits.iter().any(|h| h == "IBM Watson Claude"), "{hits:?}");

        // Same bug, three-way list: "REST APIs, Python, Oracle,"
        let hits2 = terms(
            "Strong hands on experience with REST APIs, Python, Oracle.",
            "",
        );
        assert!(hits2.iter().any(|h| h == "REST APIs"), "{hits2:?}");
        assert!(hits2.iter().any(|h| h == "Python"), "{hits2:?}");
        assert!(hits2.iter().any(|h| h == "Oracle"), "{hits2:?}");
        assert!(
            !hits2.iter().any(|h| h == "REST APIs Python Oracle"),
            "{hits2:?}"
        );
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
    fn doc_overlap_ignores_common_words_the_oracle_scores_low() {
        // Reproduces the 2026-09-23 noisy-Terms-tab report: a short résumé-
        // style doc is mostly ordinary prose, so without a rarity gate every
        // shared ≥4-letter word (not just jargon) was scoring as a "term".
        let doc = "My current role is solution architect. I have strong \
            background and expertise in Python, Kafka, and Postgres.";
        let message = "So what is your current role? I'd like to know your \
            background and expertise. We'll use Python, Kafka, and Postgres.";
        let idf = |t: &str| {
            if matches!(t, "python" | "kafka" | "postgres") {
                3.0 // rare, domain-specific
            } else {
                0.0 // everything else is common
            }
        };
        let ctx = HighlightContext {
            rarity: Some(&idf),
            ..HighlightContext::from_doc_text(doc)
        };
        let hits = relevant_terms(message, &ctx);
        for common in ["current", "background", "expertise", "role"] {
            assert!(
                !hits.iter().any(|h| h.eq_ignore_ascii_case(common)),
                "{common:?} should not be highlighted: {hits:?}"
            );
        }
        // "Python" and "Kafka" are comma-adjacent in both doc and message, so
        // the existing (unchanged) phrase-merge logic folds them into one
        // "Python Kafka" hit — a substring check tolerates that merge.
        let lower_hits: Vec<String> = hits.iter().map(|h| h.to_lowercase()).collect();
        for jargon in ["python", "kafka", "postgres"] {
            assert!(
                lower_hits.iter().any(|h| h.contains(jargon)),
                "{jargon:?} should still be highlighted: {hits:?}"
            );
        }
    }

    #[test]
    fn doc_overlap_stays_oracle_free_for_document_mining_paths() {
        // salient_doc_terms/interviewer_terms never supply a rarity oracle
        // (HighlightContext::from_doc_text sets rarity: None) — the new
        // DOC_OVERLAP_MIN_IDF gate must not touch that path, only the live
        // conversation path where lib.rs's analyze_terms always wires one up.
        let doc = "DynamoDB partitioning and expand-and-contract migration.";
        let terms = salient_doc_terms(doc, 8);
        assert!(
            terms.iter().any(|t| t.to_lowercase().contains("dynamodb")),
            "{terms:?}"
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

    #[test]
    fn final_gate_rejects_stopwords_from_context_and_feedback() {
        let context_terms = vec!["the".to_string(), "this".to_string()];
        let boost: HashSet<String> = ["are".to_string(), "mhmm".to_string()]
            .into_iter()
            .collect();
        let ctx = HighlightContext {
            context_terms: &context_terms,
            boost: Some(&boost),
            ..HighlightContext::from_doc_text("")
        };

        let hits = relevant_terms("the things are this, mhmm", &ctx);
        for noise in ["the", "this", "are", "mhmm"] {
            assert!(
                !hits.iter().any(|hit| hit.eq_ignore_ascii_case(noise)),
                "{noise:?} bypassed the final gate: {hits:?}"
            );
        }
    }

    #[test]
    fn final_gate_preserves_phrases_with_connectors_and_content() {
        let context_terms = vec!["state of the art".to_string()];
        let ctx = HighlightContext {
            context_terms: &context_terms,
            ..HighlightContext::from_doc_text("")
        };

        let hits = relevant_terms("Is this state of the art?", &ctx);
        assert!(
            hits.iter()
                .any(|hit| hit.eq_ignore_ascii_case("state of the art")),
            "{hits:?}"
        );
    }
}

/// Top salient terms OF a document itself — the Terms tab's "From your
/// documents" fallback (owner, 2026-08-22): a grounded context whose owner
/// never typed key terms and never generated a digest still has real
/// documents attached, and those should surface words. Reuses the exact
/// message-side scorer: the document's opening slice plays the "message",
/// grounded against the full text, so entities, acronyms, and rare domain
/// words win the slots.
pub fn salient_doc_terms(doc_text: &str, limit: usize) -> Vec<String> {
    // Char-boundary-safe opening slice (~12k chars — a whole job description
    // fits; still not a whole book).
    let end = doc_text
        .char_indices()
        .nth(12_000)
        .map(|(i, _)| i)
        .unwrap_or(doc_text.len());
    let ctx = HighlightContext::from_doc_text(doc_text);
    relevant_terms_capped(&doc_text[..end], &ctx, limit)
}

/// Count non-overlapping word-bounded occurrences of `needle` in `hay`
/// (both already tokenized lowercase).
fn phrase_count(hay: &[String], needle: &[String]) -> usize {
    if needle.is_empty() || needle.len() > hay.len() {
        return 0;
    }
    hay.windows(needle.len()).filter(|w| *w == needle).count()
}

/// Shared survival predicate for [`sanitize_mined_terms`] and
/// [`sanitize_glossary_entries`] — kept in one place so the two filters
/// can't drift (spec 2026-08-26).
fn term_survives(
    term: &str,
    doc_toks: &[String],
    jd_toks: Option<&[String]>,
    min_occurrences: usize,
) -> bool {
    let t = term.trim();
    if t.is_empty() {
        return false;
    }
    let nt = tokens(t);
    if nt.is_empty() || nt.len() > 4 {
        return false;
    }
    if nt.len() == 1 && STOPWORDS.contains(&nt[0].as_str()) {
        return false;
    }
    let in_jd = jd_toks.is_some_and(|j| contains_phrase(j, &nt));
    in_jd || phrase_count(doc_toks, &nt) >= min_occurrences
}

/// Hygiene gate for MINED terms (never user-typed key terms) — spec B.2.
/// A term survives when it is ≤4 words, isn't a bare stopword, and either
/// occurs at least `min_occurrences` times in `doc_text` or appears in the
/// job description. One-off extraction-glue artifacts ("CloudOpenShift"
/// jammed at a PDF line break) occur once and die here; real camel-case
/// product names repeat or show up in the JD and survive.
pub fn sanitize_mined_terms(
    terms: Vec<String>,
    doc_text: &str,
    jd_text: Option<&str>,
    min_occurrences: usize,
) -> Vec<String> {
    let doc_toks = tokens(doc_text);
    let jd_toks = jd_text.map(tokens);
    terms
        .into_iter()
        .filter(|term| term_survives(term, &doc_toks, jd_toks.as_deref(), min_occurrences))
        .collect()
}

/// [`sanitize_mined_terms`], applied to `(term, definition)` pairs — a term
/// that doesn't survive drops its definition with it (spec 2026-08-26,
/// cached term definitions: only hygiene-gated terms get their answer
/// cached for instant retrieval).
pub fn sanitize_glossary_entries(
    entries: Vec<(String, String)>,
    doc_text: &str,
    jd_text: Option<&str>,
    min_occurrences: usize,
) -> Vec<(String, String)> {
    let doc_toks = tokens(doc_text);
    let jd_toks = jd_text.map(tokens);
    entries
        .into_iter()
        .filter(|(term, _)| term_survives(term, &doc_toks, jd_toks.as_deref(), min_occurrences))
        .collect()
}

/// The interviewer's own vocabulary, mined from the job description — the
/// PRIMARY term signal for interview contexts (spec B.2): the JD literally
/// is what the interviewer will say. Occurrence floor 1 — a JD is short,
/// clean, employer-curated text where a single mention matters.
pub fn interviewer_terms(jd_text: &str, limit: usize) -> Vec<String> {
    if jd_text.trim().is_empty() {
        return Vec::new();
    }
    let mined = salient_doc_terms(jd_text, limit * 2);
    let mut clean = sanitize_mined_terms(mined, jd_text, None, 1);
    clean.truncate(limit);
    clean
}

#[cfg(test)]
mod doc_terms_tests {
    use super::salient_doc_terms;

    #[test]
    fn mines_entities_and_domain_words_from_a_document() {
        let doc = "Amazon Leadership Principles interview prep. Focus areas: \
                   DynamoDB partitioning, expand-and-contract schema migration, \
                   idempotent retries, and P99 latency budgets. The STAR method \
                   structures every answer. DynamoDB throttling is a classic probe.";
        let terms = salient_doc_terms(doc, 8);
        assert!(!terms.is_empty(), "no terms mined: {terms:?}");
        assert!(terms.len() <= 8);
        let lower: Vec<String> = terms.iter().map(|t| t.to_lowercase()).collect();
        assert!(
            lower.iter().any(|t| t.contains("dynamodb")),
            "expected a domain entity in {terms:?}"
        );
    }

    #[test]
    fn empty_document_yields_nothing() {
        assert!(salient_doc_terms("", 8).is_empty());
    }
}

#[cfg(test)]
mod sanitize_mined_tests {
    use super::{sanitize_glossary_entries, sanitize_mined_terms};

    const DOC: &str = "Built DynamoDB tables and tuned DynamoDB capacity. \
        Migrated workloads to the CloudOpenShift platform once. \
        Used CloudWatch dashboards and CloudWatch alarms daily.";

    #[test]
    fn drops_a_one_occurrence_glue_token_and_keeps_repeaters() {
        let out = sanitize_mined_terms(
            vec![
                "DynamoDB".into(),
                "CloudOpenShift".into(),
                "CloudWatch".into(),
            ],
            DOC,
            None,
            2,
        );
        assert_eq!(out, vec!["DynamoDB".to_string(), "CloudWatch".to_string()]);
    }

    #[test]
    fn jd_presence_rescues_a_single_occurrence() {
        let out = sanitize_mined_terms(
            vec!["CloudOpenShift".into()],
            DOC,
            Some("Experience with CloudOpenShift required."),
            2,
        );
        assert_eq!(out, vec!["CloudOpenShift".to_string()]);
    }

    #[test]
    fn enforces_the_four_word_cap_and_drops_stopword_singles() {
        let doc = "the well architected framework twelve factor app method \
                   the well architected framework twelve factor app method";
        let out = sanitize_mined_terms(
            vec![
                "well architected framework twelve factor".into(), // 5 words
                "the".into(),                                      // stopword
                "well architected framework".into(),               // 3 words, occurs 2x
            ],
            doc,
            None,
            2,
        );
        assert_eq!(out, vec!["well architected framework".to_string()]);
    }

    #[test]
    fn floor_one_keeps_single_occurrences() {
        let out = sanitize_mined_terms(vec!["CloudOpenShift".into()], DOC, None, 1);
        assert_eq!(out, vec!["CloudOpenShift".to_string()]);
    }

    #[test]
    fn sanitize_glossary_entries_drops_failing_terms_keeps_their_definitions_paired() {
        let doc = "The team runs on Kubernetes daily. Kubernetes handles orchestration. \
            CloudOpenShift appears once here.";
        let entries = vec![
            (
                "Kubernetes".to_string(),
                "container orchestration.".to_string(),
            ),
            ("CloudOpenShift".to_string(), "glue artifact.".to_string()),
        ];
        let out = sanitize_glossary_entries(entries, doc, None, 2);
        assert!(
            out.iter()
                .any(|(t, d)| t == "Kubernetes" && d == "container orchestration."),
            "{out:?}"
        );
        assert!(
            !out.iter().any(|(t, _)| t == "CloudOpenShift"),
            "one-occurrence glue term must be dropped: {out:?}"
        );
    }

    #[test]
    fn sanitize_glossary_entries_keeps_jd_present_single_occurrence() {
        let doc = "API Gateway is mentioned once in the resume.";
        let jd = "Experience with API Gateway is required.";
        let entries = vec![(
            "API Gateway".to_string(),
            "managed API front door.".to_string(),
        )];
        let out = sanitize_glossary_entries(entries, doc, Some(jd), 2);
        assert_eq!(
            out,
            vec![(
                "API Gateway".to_string(),
                "managed API front door.".to_string()
            )]
        );
    }
}

#[cfg(test)]
mod interviewer_terms_tests {
    use super::interviewer_terms;

    #[test]
    fn mines_jd_vocabulary() {
        let jd = "Deep technical expertise with AWS core services, including \
            EC2, EKS, Lambda, IAM, VPC, S3, and CloudWatch. Define and monitor \
            SLOs, SLAs, and SLIs. Resolve Sev-1 issues and perform RCAs. \
            Design infrastructure using CloudFormation, CDK, or Terraform.";
        let terms = interviewer_terms(jd, 12);
        assert!(!terms.is_empty());
        assert!(terms.len() <= 12);
        let lower: Vec<String> = terms.iter().map(|t| t.to_lowercase()).collect();
        assert!(
            lower
                .iter()
                .any(|t| t.contains("cloudwatch") || t.contains("terraform") || t.contains("iam")),
            "expected JD vocabulary in {terms:?}"
        );
    }

    #[test]
    fn empty_jd_yields_nothing() {
        assert!(interviewer_terms("", 12).is_empty());
        assert!(interviewer_terms("   ", 12).is_empty());
    }
}

#[cfg(test)]
mod ceiling_tests {
    use super::*;

    /// A JD-like text with far more than 12 distinct entities, each
    /// repeated so every signal path can admit them.
    fn rich_jd() -> String {
        let names = [
            "Amazon EC2",
            "Amazon EKS",
            "AWS Lambda",
            "Amazon VPC",
            "AWS CloudFormation",
            "Amazon CloudWatch",
            "AWS CDK",
            "Terraform Cloud",
            "GitLab CI",
            "GitHub Actions",
            "Datadog APM",
            "Prometheus Grafana",
            "API Gateway",
            "Control Tower",
            "OpenTelemetry Collector",
            "AWS Organizations",
        ];
        let mut s = String::from("Senior DevOps Engineer role. ");
        for _ in 0..3 {
            for n in &names {
                s.push_str(&format!("Experience with {n} is required. "));
            }
        }
        s
    }

    #[test]
    fn salient_doc_terms_honors_limits_above_twelve() {
        let jd = rich_jd();
        let terms = salient_doc_terms(&jd, 16);
        assert!(
            terms.len() > 12,
            "limit above MAX_TERMS must be honored, got {} terms: {terms:?}",
            terms.len()
        );
        assert!(terms.len() <= 16, "{terms:?}");
    }

    #[test]
    fn interviewer_terms_reaches_sixteen_on_a_rich_jd() {
        let jd = rich_jd();
        let terms = interviewer_terms(&jd, 16);
        assert!(
            terms.len() > 12,
            "JD mining must not be silently capped at 12, got {}: {terms:?}",
            terms.len()
        );
    }

    #[test]
    fn live_relevant_terms_still_caps_at_twelve() {
        let jd = rich_jd();
        let ctx = HighlightContext::from_doc_text(&jd);
        let terms = relevant_terms(&jd, &ctx);
        assert!(terms.len() <= 12, "live path cap regressed: {terms:?}");
    }
}

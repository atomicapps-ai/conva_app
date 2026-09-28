//! Shared, deterministic **phrase resolution** for FANER (design:
//! `conva_core/docs/technical/faner-phrase-resolution.md`).
//!
//! One policy used by both the transcript highlighter (`highlight.rs`) and the
//! LLM capture router (`capture.rs`), so the two can never disagree about what
//! "the term" is. The motivating bug: the other party said "API Gateway" and
//! FANER surfaced only "API" — a fragment of a known phrase.
//!
//! ## The policy
//!
//! * **Word-token sequences, never raw substrings.** Text is split into
//!   alphanumeric tokens (internal apostrophes kept: `don't`), each remembering
//!   the byte span it came from and the *gap* (separator) before it.
//! * **Case-insensitive identity, transcript-cased display.** Matching uses the
//!   lowercased token sequence; callers show the transcript's own slice.
//! * **Gaps.** Two tokens are *joined* into one phrase only across a
//!   [`Gap::Join`]: plain spaces/tabs, or a single unspaced hyphen
//!   (`API-Gateway` ≡ `API Gateway`). A [`Gap::Symbol`] (`/ & + . # _ @` with no
//!   spaces — `CI/CD`, `Node.js`) joins only a known term written with the very
//!   same symbol. Everything else — sentence/clause punctuation (`. , ; : ! ?
//!   …`), a newline, brackets, quotes, or a *spaced* dash (`API - Gateway`) — is
//!   a [`Gap::Hard`] boundary: words on either side are never one phrase.
//! * **Longest match first, occurrence-aware.** A candidate occurrence is
//!   suppressed only when a *strictly longer, at-least-as-strong* occurrence
//!   contains it ([`resolve_containment`]). A separate standalone occurrence of
//!   the same fragment stays eligible.
//! * **Prepared/document terminology is canonical.** A candidate carrying a
//!   canonical signal (context term, 👍 boost, document phrase) beats any
//!   contained fragment regardless of score.
//! * **Nothing is invented.** Every span is a slice of the input text.

use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};

use crate::highlight::is_noise_token;

/// Separator class between two adjacent tokens.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Gap {
    /// Spaces/tabs or one unspaced hyphen — the words are one phrase.
    Join,
    /// A single unspaced connector symbol (`/ & + . # _ @`).
    Symbol(char),
    /// Sentence/clause punctuation, newline, bracket, quote, spaced dash.
    Hard,
}

/// One word token with its source span and preceding gap.
#[derive(Debug, Clone)]
pub struct PhraseToken {
    /// Byte offset of the first char in the source text.
    pub start: usize,
    /// Byte offset one past the last char.
    pub end: usize,
    /// Lowercased token text (curly apostrophes normalized).
    pub lower: String,
    /// Separator before this token (`Join` for the first token).
    pub gap: Gap,
    /// Trimmed separator text before this token (used to compare `Hard` gaps).
    pub gap_text: String,
}

/// A byte range in the analysed text.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Span {
    pub start: usize,
    pub end: usize,
}

impl Span {
    pub fn len(&self) -> usize {
        self.end - self.start
    }
    pub fn is_empty(&self) -> bool {
        self.end == self.start
    }
    /// Does `self` contain `other` and is it strictly longer?
    pub fn strictly_contains(&self, other: &Span) -> bool {
        self.start <= other.start && other.end <= self.end && self.len() > other.len()
    }
}

const SYMBOL_GAPS: &[char] = &['/', '&', '+', '.', '#', '_', '@'];
const HYPHENS: &[char] = &['-', '\u{2010}', '\u{2011}'];

/// Classify the raw text between two tokens.
pub fn classify_gap(gap: &str) -> Gap {
    if gap.is_empty() {
        return Gap::Join;
    }
    let trimmed = gap.trim();
    if trimmed.is_empty() {
        // Pure whitespace: a line break is a hard boundary, spaces are not.
        return if gap.contains('\n') || gap.contains('\r') {
            Gap::Hard
        } else {
            Gap::Join
        };
    }
    // Attached (unspaced) single connector: `API-Gateway`, `CI/CD`, `Node.js`.
    if trimmed == gap {
        let mut chars = gap.chars();
        if let (Some(c), None) = (chars.next(), chars.next()) {
            if HYPHENS.contains(&c) {
                return Gap::Join;
            }
            if SYMBOL_GAPS.contains(&c) {
                return Gap::Symbol(c);
            }
        }
    }
    Gap::Hard
}

fn normalize_apostrophes(s: &str) -> String {
    s.to_lowercase().replace('\u{2019}', "'")
}

/// Tokenize `text` into word tokens with spans and gap classes.
pub fn tokenize(text: &str) -> Vec<PhraseToken> {
    let chars: Vec<(usize, char)> = text.char_indices().collect();
    let mut out: Vec<PhraseToken> = Vec::new();
    let mut i = 0;
    while i < chars.len() {
        if !chars[i].1.is_alphanumeric() {
            i += 1;
            continue;
        }
        let start = chars[i].0;
        let mut j = i + 1;
        loop {
            if j < chars.len() && chars[j].1.is_alphanumeric() {
                j += 1;
                continue;
            }
            // An apostrophe between two alphanumerics stays inside the token.
            if j + 1 < chars.len()
                && (chars[j].1 == '\'' || chars[j].1 == '\u{2019}')
                && chars[j + 1].1.is_alphanumeric()
            {
                j += 2;
                continue;
            }
            break;
        }
        let end = if j < chars.len() {
            chars[j].0
        } else {
            text.len()
        };
        let (gap, gap_text) = match out.last() {
            Some(prev) => {
                let raw = &text[prev.end..start];
                (classify_gap(raw), raw.trim().to_string())
            }
            None => (Gap::Join, String::new()),
        };
        out.push(PhraseToken {
            start,
            end,
            lower: normalize_apostrophes(&text[start..end]),
            gap,
            gap_text,
        });
        i = j;
    }
    out
}

/// Canonical identity of a phrase: lowercased tokens joined by their gap
/// (`" "` for `Join`, the symbol for `Symbol`, the punctuation for `Hard`).
/// `API Gateway`, `api-gateway`, and `API  gateway` all share one key; `CI/CD`
/// keeps its slash so it never collides with `CI CD`. Empty for no tokens.
pub fn normalize_key(text: &str) -> String {
    let toks = tokenize(text);
    let mut key = String::new();
    for (i, t) in toks.iter().enumerate() {
        if i > 0 {
            match &t.gap {
                Gap::Join => key.push(' '),
                Gap::Symbol(c) => key.push(*c),
                Gap::Hard => {
                    key.push_str(&t.gap_text);
                    key.push(' ');
                }
            }
        }
        key.push_str(&t.lower);
    }
    key
}

fn gaps_compatible(known: &PhraseToken, spoken: &PhraseToken) -> bool {
    match (&known.gap, &spoken.gap) {
        (Gap::Join, Gap::Join) => true,
        (Gap::Symbol(a), Gap::Symbol(b)) => a == b,
        (Gap::Hard, Gap::Hard) => known.gap_text == spoken.gap_text,
        _ => false,
    }
}

/// Every occurrence of `phrase` in an already-tokenized text, as byte spans.
/// Word-bounded by construction (whole tokens only) and gap-aware: a phrase
/// whose words are joined by spaces never matches across a comma, period, or
/// line break.
pub fn find_occurrences(text_tokens: &[PhraseToken], phrase: &str) -> Vec<Span> {
    let needle = tokenize(phrase);
    if needle.is_empty() || needle.len() > text_tokens.len() {
        return Vec::new();
    }
    let n = needle.len();
    let mut out = Vec::new();
    'outer: for i in 0..=text_tokens.len() - n {
        for k in 0..n {
            if text_tokens[i + k].lower != needle[k].lower {
                continue 'outer;
            }
            if k > 0 && !gaps_compatible(&needle[k], &text_tokens[i + k]) {
                continue 'outer;
            }
        }
        out.push(Span {
            start: text_tokens[i].start,
            end: text_tokens[i + n - 1].end,
        });
    }
    out
}

/// One candidate phrase entering containment resolution.
#[derive(Debug, Clone)]
pub struct ResolveInput {
    pub key: String,
    pub score: f32,
    /// Carries a context/boost/document-phrase signal — canonical
    /// terminology that always beats a contained fragment.
    pub canonical: bool,
    pub spans: Vec<Span>,
}

/// Outcome for one candidate: which occurrences survive, and which were
/// swallowed by a longer phrase (with that phrase's key).
#[derive(Debug, Clone, Default)]
pub struct Resolved {
    pub kept: Vec<Span>,
    pub contained: Vec<(Span, String)>,
}

/// Occurrence-aware, longest-match-first containment. An occurrence of
/// candidate A is contained when some occurrence of a *different* candidate B
/// strictly contains it and B is at least as strong (canonical, or scores ≥ A).
/// The longest such container is reported. Deterministic in input order.
pub fn resolve_containment(inputs: &[ResolveInput]) -> Vec<Resolved> {
    inputs
        .iter()
        .enumerate()
        .map(|(ai, a)| {
            let mut res = Resolved::default();
            for span in &a.spans {
                let mut best: Option<(usize, usize)> = None; // (container len, input idx)
                for (bi, b) in inputs.iter().enumerate() {
                    if bi == ai || !(b.canonical || b.score >= a.score) {
                        continue;
                    }
                    for bs in &b.spans {
                        if bs.strictly_contains(span) && best.is_none_or(|(l, _)| bs.len() > l) {
                            best = Some((bs.len(), bi));
                        }
                    }
                }
                match best {
                    Some((_, bi)) => res.contained.push((*span, inputs[bi].key.clone())),
                    None => res.kept.push(*span),
                }
            }
            res
        })
        .collect()
}

/// Max n-gram length considered for document phrases.
const DOC_PHRASE_MAX_WORDS: usize = 4;
/// Hard cap on document-phrase candidates per message.
const DOC_PHRASE_CAP: usize = 64;
/// Standalone-token floor mirrored from `highlight::MIN_LEN` — a token shorter
/// than this is "short" (an acronym component, not a generic standalone word).
const SHORT_TOKEN_LEN: usize = 4;

fn is_acronym_like(original: &str) -> bool {
    let letters = original.chars().filter(|c| c.is_alphabetic()).count();
    let has_digit = original.chars().any(|c| c.is_numeric());
    (letters >= 2
        && original
            .chars()
            .filter(|c| c.is_alphabetic())
            .all(|c| c.is_uppercase()))
        || (letters >= 1 && has_digit)
}

/// Multiword phrases in `message` that appear **contiguously in the document
/// text** and contain a short acronym-like component (`API`, `AWS`, `S3`).
///
/// Why only acronym-adjacent phrases: runs of ordinary ≥4-letter document
/// words are already merged by the doc-overlap signal; what that signal
/// structurally cannot see is a phrase whose component is below the
/// standalone length floor. Here the floor applies to *standalone* tokens
/// only — inside a phrase the document actually contains, `API` is allowed.
///
/// A phrase needs: 2–4 tokens, all `Join` gaps in both message and document,
/// non-noise first/last tokens, at least one `significant` token (the same
/// doc-word set the overlap signal uses) and at least one short acronym-like
/// non-noise token (all-caps or letter+digit in the message, or in the
/// document — so ASR-lowercased `api gateway` still resolves).
pub fn document_acronym_phrases(
    message: &str,
    msg: &[PhraseToken],
    doc_text: &str,
    significant: &HashSet<String>,
) -> Vec<String> {
    if doc_text.is_empty() || msg.len() < 2 {
        return Vec::new();
    }
    let doc = tokenize(doc_text);
    if doc.len() < 2 {
        return Vec::new();
    }
    let mut by_first: HashMap<&str, Vec<usize>> = HashMap::new();
    let mut doc_acronyms: HashSet<&str> = HashSet::new();
    for (i, t) in doc.iter().enumerate() {
        by_first.entry(t.lower.as_str()).or_default().push(i);
        if is_acronym_like(&doc_text[t.start..t.end]) {
            doc_acronyms.insert(t.lower.as_str());
        }
    }

    let short_component = |t: &PhraseToken| {
        t.lower.chars().count() < SHORT_TOKEN_LEN
            && !is_noise_token(&t.lower)
            && (is_acronym_like(&message[t.start..t.end])
                || doc_acronyms.contains(t.lower.as_str()))
    };

    let mut seen: HashSet<String> = HashSet::new();
    let mut out: Vec<String> = Vec::new();
    for n in 2..=DOC_PHRASE_MAX_WORDS.min(msg.len()) {
        for i in 0..=msg.len() - n {
            let win = &msg[i..i + n];
            if win[1..].iter().any(|t| t.gap != Gap::Join) {
                continue;
            }
            if is_noise_token(&win[0].lower) || is_noise_token(&win[n - 1].lower) {
                continue;
            }
            if !win.iter().any(|t| significant.contains(&t.lower))
                || !win.iter().any(short_component)
            {
                continue;
            }
            let Some(starts) = by_first.get(win[0].lower.as_str()) else {
                continue;
            };
            let in_doc = starts.iter().any(|&p| {
                p + n <= doc.len()
                    && (0..n).all(|k| {
                        doc[p + k].lower == win[k].lower && (k == 0 || doc[p + k].gap == Gap::Join)
                    })
            });
            if !in_doc {
                continue;
            }
            let phrase = message[win[0].start..win[n - 1].end].to_string();
            if seen.insert(normalize_key(&phrase)) {
                out.push(phrase);
                if out.len() >= DOC_PHRASE_CAP {
                    return out;
                }
            }
        }
    }
    out
}

// ── Debug/evaluation trace (dev-only; mirrored in `src/lib/ipc.ts`) ─────────

/// One signal that nominated a candidate.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SignalTrace {
    /// `context term`, `boost`, `document phrase`, `document overlap`,
    /// `entity/acronym`, `rarity`.
    pub source: String,
    pub weight: f32,
}

/// One located occurrence of a candidate in the analysed text.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SpanTrace {
    /// Char (not byte) offsets into the analysed text.
    pub start: usize,
    pub end: usize,
    /// The transcript's own text for the span (original casing).
    pub text: String,
    /// `selected` or `contained`.
    pub status: String,
    /// The longer phrase that swallowed this occurrence, when `contained`.
    pub container: Option<String>,
}

/// Why a candidate was selected or rejected.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CandidateTrace {
    /// Display text (transcript casing of the first surviving occurrence).
    pub term: String,
    /// Normalized identity (`api gateway`).
    pub key: String,
    pub score: f32,
    pub signals: Vec<SignalTrace>,
    pub spans: Vec<SpanTrace>,
    /// `selected` or `rejected`.
    pub decision: String,
    pub reason: String,
}

/// Full result of a debug highlight evaluation.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HighlightEvaluation {
    /// Exactly what `relevant_terms` returns for the same input.
    pub terms: Vec<String>,
    pub trace: Vec<CandidateTrace>,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn occ(text: &str, phrase: &str) -> Vec<Span> {
        find_occurrences(&tokenize(text), phrase)
    }

    #[test]
    fn casing_variants_share_identity() {
        for t in [
            "API Gateway",
            "api Gateway",
            "API gateway",
            "api gateway",
            "API-Gateway",
        ] {
            assert_eq!(occ(t, "API Gateway").len(), 1, "{t}");
            assert_eq!(normalize_key(t), "api gateway", "{t}");
        }
    }

    #[test]
    fn word_boundaries_are_respected() {
        assert!(occ("rapid gateway", "api gateway").is_empty());
        assert!(occ("APIs Gateway", "api gateway").is_empty());
        assert!(occ("the apigateway", "api gateway").is_empty());
    }

    #[test]
    fn hard_boundaries_never_join_words() {
        for t in [
            "we use API. Gateway config",
            "the API, Gateway and more",
            "API; gateway",
            "API\nGateway",
            "API - Gateway",
            "API (Gateway)",
            "API \"Gateway\"",
        ] {
            assert!(occ(t, "API Gateway").is_empty(), "{t}");
        }
    }

    #[test]
    fn symbol_gaps_match_only_the_same_symbol() {
        assert_eq!(occ("we run CI/CD daily", "CI/CD").len(), 1);
        assert!(occ("we run CI CD daily", "CI/CD").is_empty());
        assert!(occ("we run CI/CD daily", "CI CD").is_empty());
        assert_eq!(occ("Node.js rocks", "node.js").len(), 1);
        assert!(occ("Node. js rocks", "node.js").is_empty());
        assert_ne!(normalize_key("CI/CD"), normalize_key("CI CD"));
    }

    #[test]
    fn hyphen_and_space_are_equivalent() {
        assert_eq!(occ("an event-driven design", "event driven").len(), 1);
        assert_eq!(occ("an event driven design", "event-driven").len(), 1);
    }

    #[test]
    fn spans_slice_the_original_text() {
        let text = "Explain how api Gateway works";
        let s = occ(text, "API Gateway")[0];
        assert_eq!(&text[s.start..s.end], "api Gateway");
    }

    #[test]
    fn containment_is_occurrence_aware() {
        let text = "API Gateway then API";
        let toks = tokenize(text);
        let inputs = vec![
            ResolveInput {
                key: "api gateway".into(),
                score: 1.0,
                canonical: true,
                spans: find_occurrences(&toks, "api gateway"),
            },
            ResolveInput {
                key: "api".into(),
                score: 0.5,
                canonical: false,
                spans: find_occurrences(&toks, "api"),
            },
        ];
        let r = resolve_containment(&inputs);
        assert_eq!(r[1].contained.len(), 1);
        assert_eq!(r[1].kept.len(), 1);
        assert_eq!(&text[r[1].kept[0].start..r[1].kept[0].end], "API");
        assert_eq!(r[1].contained[0].1, "api gateway");
        assert!(r[0].contained.is_empty());
    }

    #[test]
    fn weaker_non_canonical_container_does_not_swallow_a_stronger_fragment() {
        let text = "Kansas City";
        let toks = tokenize(text);
        let inputs = vec![
            ResolveInput {
                key: "kansas".into(),
                score: 1.0,
                canonical: true,
                spans: find_occurrences(&toks, "kansas"),
            },
            ResolveInput {
                key: "kansas city".into(),
                score: 0.5,
                canonical: false,
                spans: find_occurrences(&toks, "kansas city"),
            },
        ];
        let r = resolve_containment(&inputs);
        assert_eq!(r[0].kept.len(), 1);
    }
}

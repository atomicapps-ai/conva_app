//! Seeded, reproducible evaluation of FANER phrase resolution (dev/test only;
//! design: `conva_core/docs/technical/faner-phrase-resolution.md`).
//!
//! Not unconstrained random English: cases are **generated from known
//! phrases** by mutating capitalization, hyphenation, punctuation, sentence
//! position, filler, repetition, and adjacent competing terms — plus boundary
//! traps where a known phrase is split by a sentence break and must *not*
//! match. The same `(seed, count, known_terms)` always yields the same cases
//! and the same results, so a failure is reproducible from its fixture.
//!
//! Properties checked per case ([`evaluate_case`]):
//! 1. every contiguous known phrase in the transcript is selected;
//! 2. no fragment is selected for an occurrence nested inside one;
//! 3. a phrase split by a hard boundary is not selected (`forbidden_terms`);
//! 4. nothing is selected that is not literally in the transcript.

use serde::{Deserialize, Serialize};

use crate::highlight::{evaluate_terms, HighlightContext, MAX_TERMS};
use crate::phrase::{find_occurrences, normalize_key, tokenize, CandidateTrace};

/// One evaluation case — also the compact JSON fixture the debug panel copies.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct EvalCase {
    pub id: String,
    /// The seed that generated it (0 for hand-written cases).
    #[serde(default)]
    pub seed: u64,
    pub transcript: String,
    pub known_terms: Vec<String>,
    /// Phrases that must be selected.
    #[serde(default)]
    pub expected_terms: Vec<String>,
    /// Phrases that must NOT be selected (boundary traps).
    #[serde(default)]
    pub forbidden_terms: Vec<String>,
}

/// The outcome of one case.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct EvalResult {
    pub case: EvalCase,
    pub actual_terms: Vec<String>,
    /// `None` when the case declares no expectations (manual exploration).
    pub passed: Option<bool>,
    pub failures: Vec<String>,
    pub trace: Vec<CandidateTrace>,
}

/// The default curated phrase list: short acronyms inside phrases, connectors,
/// hyphens, symbols, and overlapping fragments.
pub const DEFAULT_PHRASES: &[&str] = &[
    "API Gateway",
    "AWS Lambda",
    "S3 bucket",
    "Kafka Streams",
    "event-driven architecture",
    "state of the art",
    "CI/CD pipeline",
    "Amazon Web Services",
    "Step Functions",
    "RDS Proxy",
];

/// Tiny deterministic PRNG (splitmix64) — no `rand` dependency, stable forever.
struct Rng(u64);

impl Rng {
    fn next(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }
    fn below(&mut self, n: usize) -> usize {
        (self.next() % n.max(1) as u64) as usize
    }
}

#[derive(Clone, Copy)]
enum Casing {
    AsWritten,
    Lower,
    Upper,
    /// First word as written, the rest lowercased ("API gateway").
    HeadOnly,
    /// First word lowercased, the rest as written ("api Gateway").
    TailOnly,
}

fn apply_casing(phrase: &str, casing: Casing) -> String {
    let words: Vec<&str> = phrase.split(' ').collect();
    words
        .iter()
        .enumerate()
        .map(|(i, w)| match (casing, i) {
            (Casing::AsWritten, _) => w.to_string(),
            (Casing::Lower, _) => w.to_lowercase(),
            (Casing::Upper, _) => w.to_uppercase(),
            (Casing::HeadOnly, 0) | (Casing::TailOnly, 1..) => w.to_string(),
            (Casing::HeadOnly, _) | (Casing::TailOnly, 0) => w.to_lowercase(),
        })
        .collect::<Vec<_>>()
        .join(" ")
}

const TEMPLATES: &[&str] = &[
    "Can you explain how {P} integrates with the rest of the stack?",
    "{P} is something we rely on heavily.",
    "So tell me, what do you know about {P}",
    "We moved everything behind {P}, and honestly it went fine.",
    "Right, {P}. Then we can talk about scaling.",
    "Have you used {P} before? And what about {Q}?",
    "I think that {P} and {Q} are both worth a look.",
];
const FILLER: &[&str] = &["", "", "Um, ", "Okay so, ", "You know, ", "Right. "];

/// Generate `count` reproducible cases from `known_terms` (or
/// [`DEFAULT_PHRASES`] when empty). Roughly one case in six is a boundary
/// trap.
pub fn generate_cases(seed: u64, count: usize, known_terms: &[String]) -> Vec<EvalCase> {
    let pool: Vec<String> = if known_terms.iter().all(|t| t.trim().is_empty()) {
        DEFAULT_PHRASES.iter().map(|s| s.to_string()).collect()
    } else {
        known_terms
            .iter()
            .map(|t| t.trim().to_string())
            .filter(|t| !t.is_empty())
            .collect()
    };
    (0..count)
        .map(|i| {
            let mut rng = Rng(seed ^ (i as u64).wrapping_mul(0xD6E8_FEB8_6659_FD93));
            let phrase = pool[rng.below(pool.len())].clone();
            let other = pool[rng.below(pool.len())].clone();
            let casing = match rng.below(5) {
                0 => Casing::AsWritten,
                1 => Casing::Lower,
                2 => Casing::Upper,
                3 => Casing::HeadOnly,
                _ => Casing::TailOnly,
            };
            let words: Vec<&str> = phrase.split(' ').collect();
            let trap = words.len() > 1 && rng.below(6) == 0;
            // Hyphen ↔ space swap: only for plain multi-word phrases, and
            // never in a trap (the trap needs the words separable).
            let plain = !phrase.contains(['/', '-', '.']) && phrase.contains(' ');
            let mut spoken = apply_casing(&phrase, casing);
            if plain && !trap && rng.below(4) == 0 {
                spoken = spoken.replace(' ', "-");
            }
            let mut transcript = String::from(FILLER[rng.below(FILLER.len())]);
            let (expected, forbidden) = if trap {
                // "…the API. Gateway settings…" — a sentence break inside the
                // phrase: it must not be joined.
                let spoken_words: Vec<&str> = spoken.split(' ').collect();
                transcript.push_str(&format!(
                    "We changed the {}. {} settings are next.",
                    spoken_words[0],
                    spoken_words[1..].join(" ")
                ));
                (Vec::new(), vec![phrase.clone()])
            } else {
                let other_spoken = apply_casing(&other, casing);
                let sentence = TEMPLATES[rng.below(TEMPLATES.len())]
                    .replace("{P}", &spoken)
                    .replace("{Q}", &other_spoken);
                transcript.push_str(&sentence);
                if rng.below(4) == 0 {
                    transcript.push(' ');
                    transcript.push_str(&sentence); // repeated occurrence
                }
                let mut expected = vec![phrase.clone()];
                if sentence.contains(&other_spoken) && other != phrase {
                    expected.push(other.clone());
                }
                (expected, Vec::new())
            };
            EvalCase {
                id: format!("seed{seed}-{i}"),
                seed,
                transcript,
                known_terms: pool.clone(),
                expected_terms: expected,
                forbidden_terms: forbidden,
            }
        })
        .collect()
}

/// Run the real highlighter on a case and check the properties.
pub fn evaluate_case(case: &EvalCase) -> EvalResult {
    let ctx = HighlightContext {
        context_terms: &case.known_terms,
        ..HighlightContext::from_doc_text("")
    };
    let eval = evaluate_terms(&case.transcript, &ctx, MAX_TERMS);
    let toks = tokenize(&case.transcript);
    let mut failures: Vec<String> = Vec::new();

    let selected_keys: Vec<String> = eval.terms.iter().map(|t| normalize_key(t)).collect();
    // 1. Expected phrases are selected.
    for want in &case.expected_terms {
        if !selected_keys.contains(&normalize_key(want)) {
            failures.push(format!("expected phrase not selected: {want:?}"));
        }
    }
    // 3. Forbidden (split-by-boundary) phrases are not selected.
    for bad in &case.forbidden_terms {
        if selected_keys.contains(&normalize_key(bad)) {
            failures.push(format!("phrase joined across a hard boundary: {bad:?}"));
        }
    }
    // 2. No selected fragment sits nested inside an occurrence of a known
    //    multiword phrase that is present in the transcript.
    let known_spans: Vec<(String, Vec<crate::phrase::Span>)> = case
        .known_terms
        .iter()
        .map(|k| (k.clone(), find_occurrences(&toks, k)))
        .collect();
    for cand in eval.trace.iter().filter(|c| c.decision == "selected") {
        for span in cand.spans.iter().filter(|s| s.status == "selected") {
            for (known, spans) in &known_spans {
                let nested = spans.iter().any(|ks| {
                    // trace spans are char offsets; compare in char space.
                    let (ks_start, ks_end) = (
                        case.transcript[..ks.start].chars().count(),
                        case.transcript[..ks.end].chars().count(),
                    );
                    ks_start <= span.start
                        && span.end <= ks_end
                        && (ks_end - ks_start) > (span.end - span.start)
                });
                if nested {
                    failures.push(format!(
                        "fragment {:?} selected inside known phrase {known:?}",
                        span.text
                    ));
                }
            }
        }
    }
    // 4. Nothing invented: every selected term is a contiguous slice of the
    //    transcript.
    for term in &eval.terms {
        if find_occurrences(&toks, term).is_empty() {
            failures.push(format!("selected term not present in transcript: {term:?}"));
        }
    }

    let has_expectations = !case.expected_terms.is_empty() || !case.forbidden_terms.is_empty();
    EvalResult {
        case: case.clone(),
        actual_terms: eval.terms,
        passed: has_expectations.then_some(failures.is_empty()),
        failures,
        trace: eval.trace,
    }
}

/// Convenience: generate and evaluate in one call.
pub fn run_seeded(seed: u64, count: usize, known_terms: &[String]) -> Vec<EvalResult> {
    generate_cases(seed, count, known_terms)
        .iter()
        .map(evaluate_case)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn known(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn same_seed_same_cases_and_results() {
        let a = generate_cases(42, 60, &[]);
        let b = generate_cases(42, 60, &[]);
        assert_eq!(a, b);
        assert_eq!(run_seeded(42, 60, &[]), run_seeded(42, 60, &[]));
        assert_ne!(generate_cases(43, 60, &[]), a, "different seeds differ");
    }

    #[test]
    fn seeded_corpus_upholds_every_property() {
        let mut failed = Vec::new();
        for seed in 0..40u64 {
            for r in run_seeded(seed, 50, &[]) {
                if r.passed == Some(false) {
                    failed.push(format!(
                        "{} {:?} -> {:?}: {:?}",
                        r.case.id, r.case.transcript, r.actual_terms, r.failures
                    ));
                }
            }
        }
        assert!(
            failed.is_empty(),
            "{} failures:\n{}",
            failed.len(),
            failed.join("\n")
        );
    }

    #[test]
    fn generator_covers_traps_and_repeats() {
        let cases = generate_cases(7, 400, &[]);
        assert!(cases.iter().any(|c| !c.forbidden_terms.is_empty()));
        assert!(cases.iter().any(|c| c.expected_terms.len() > 1));
    }

    /// The exact reported regression, as a fixed fixture: the other party
    /// said "API gateway"; FANER surfaced only "API".
    #[test]
    fn reported_regression_fixture() {
        let case = EvalCase {
            id: "reported-api-gateway".into(),
            seed: 0,
            transcript: "Can you explain how API gateway integrates with Lambda?".into(),
            known_terms: known(&["API Gateway", "AWS Lambda"]),
            expected_terms: known(&["API Gateway"]),
            forbidden_terms: vec![],
        };
        let r = evaluate_case(&case);
        assert_eq!(r.passed, Some(true), "{:?}", r.failures);
        assert!(
            r.actual_terms.iter().any(|t| t == "API gateway"),
            "{:?}",
            r.actual_terms
        );
        assert!(
            !r.actual_terms.iter().any(|t| t == "API"),
            "{:?}",
            r.actual_terms
        );
        // The trace explains the rejected nested fragment.
        let api = r.trace.iter().find(|c| c.key == "api").expect("api traced");
        assert_eq!(api.decision, "rejected");
        assert!(api.reason.contains("api gateway"), "{}", api.reason);
        // "AWS Lambda" was never spoken in full — it is not invented.
        assert!(!r
            .actual_terms
            .iter()
            .any(|t| t.to_lowercase().contains("aws")));
    }

    #[test]
    fn stopword_only_known_terms_never_win() {
        let case = EvalCase {
            id: "stopwords".into(),
            seed: 0,
            transcript: "the things are this way".into(),
            known_terms: known(&["the", "this", "are"]),
            expected_terms: vec![],
            forbidden_terms: known(&["the", "this", "are"]),
        };
        let r = evaluate_case(&case);
        assert_eq!(r.passed, Some(true), "{:?}", r.failures);
        assert!(r.actual_terms.is_empty(), "{:?}", r.actual_terms);
    }
}

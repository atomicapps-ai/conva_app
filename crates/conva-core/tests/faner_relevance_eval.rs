use std::collections::{HashMap, HashSet};

use conva_core::highlight::{relevant_terms, HighlightContext};
use serde::Deserialize;

#[derive(Debug, Deserialize)]
struct EvalSuite {
    cases: Vec<EvalCase>,
}

#[derive(Debug, Deserialize)]
struct EvalCase {
    name: String,
    category: String,
    message: String,
    doc_text: String,
    context_terms: Vec<String>,
    boost: Vec<String>,
    suppress: Vec<String>,
    idf: HashMap<String, f32>,
    relevant: Vec<String>,
    forbidden: Vec<String>,
}

fn normalized(values: impl IntoIterator<Item = String>) -> HashSet<String> {
    values
        .into_iter()
        .map(|value| value.trim().to_lowercase())
        .collect()
}

#[test]
fn labeled_relevance_suite_meets_precision_recall_and_hygiene_gates() {
    let suite: EvalSuite =
        serde_json::from_str(include_str!("fixtures/faner_relevance_cases.json"))
            .expect("the FANER relevance fixture is valid JSON");

    let mut true_positives = 0usize;
    let mut false_positives = 0usize;
    let mut false_negatives = 0usize;

    for case in suite.cases {
        let boosts: HashSet<String> = case.boost.iter().cloned().collect();
        let suppressions: HashSet<String> = case.suppress.iter().cloned().collect();
        let idf = |term: &str| case.idf.get(term).copied().unwrap_or(0.0);
        let context = HighlightContext {
            doc_text: &case.doc_text,
            context_terms: &case.context_terms,
            boost: Some(&boosts),
            suppress: Some(&suppressions),
            rarity: Some(&idf),
            lexicon: None,
        };
        let actual = normalized(relevant_terms(&case.message, &context));
        let expected = normalized(case.relevant);
        let forbidden = normalized(case.forbidden);

        let forbidden_hits: Vec<_> = actual.intersection(&forbidden).cloned().collect();
        assert!(
            forbidden_hits.is_empty(),
            "{} ({}) surfaced forbidden terms: {forbidden_hits:?}; actual={actual:?}",
            case.name,
            case.category
        );

        true_positives += actual.intersection(&expected).count();
        false_positives += actual.difference(&expected).count();
        false_negatives += expected.difference(&actual).count();
    }

    let precision = true_positives as f64 / (true_positives + false_positives).max(1) as f64;
    let recall = true_positives as f64 / (true_positives + false_negatives).max(1) as f64;
    assert!(
        precision >= 0.95,
        "labeled FANER precision {precision:.3} is below 0.95 (tp={true_positives}, fp={false_positives})"
    );
    assert!(
        recall >= 0.95,
        "labeled FANER recall {recall:.3} is below 0.95 (tp={true_positives}, fn={false_negatives})"
    );
}

//! FANER domain-lexicon acceptance tests (design:
//! `conva_core/docs/technical/faner-domain-lexicon.md`). The owner's dev-build
//! sentences are the golden cases: `modeling data` must highlight in a technical
//! interview without the user ever supplying it.

use std::collections::HashSet;

use conva_core::highlight::{evaluate_terms, relevant_terms, HighlightContext, MAX_TERMS};
use conva_core::lexicon::{select_packs, Lexicon, SelectionInput};

fn s(v: &[&str]) -> Vec<String> {
    v.iter().map(|x| x.to_string()).collect()
}

fn has_ci(terms: &[String], want: &str) -> bool {
    terms.iter().any(|t| t.eq_ignore_ascii_case(want))
}

fn software() -> Lexicon {
    Lexicon::from_pack_ids(&["software-engineering"])
}

const ORM_LINE: &str =
    "THEM: When did you work on the VPC of AWS and use an ORM for modeling data?";
const GATEWAY_LINE: &str = "THEM: Can you explain how API gateway integrates with Lambda?";

#[test]
fn owner_sentence_modeling_data_highlights_with_the_pack() {
    let lex = software();
    let ctx = HighlightContext {
        lexicon: Some(&lex),
        ..HighlightContext::from_doc_text("")
    };
    let hits = relevant_terms(ORM_LINE, &ctx);
    assert!(has_ci(&hits, "modeling data"), "{hits:?}");
    // The acronyms the entity signal already caught still highlight.
    assert!(has_ci(&hits, "ORM"), "{hits:?}");
    assert!(has_ci(&hits, "VPC"), "{hits:?}");
    assert!(has_ci(&hits, "AWS"), "{hits:?}");
}

#[test]
fn without_a_lexicon_modeling_data_is_not_highlighted() {
    // The baseline that motivated the feature: no existing signal sees it.
    let hits = relevant_terms(ORM_LINE, &HighlightContext::from_doc_text(""));
    assert!(!has_ci(&hits, "modeling data"), "{hits:?}");
}

#[test]
fn gateway_sentence_keeps_the_longest_phrase_and_never_bare_api() {
    let lex = software();
    let known = s(&["API Gateway", "AWS Lambda"]);
    let ctx = HighlightContext {
        context_terms: &known,
        lexicon: Some(&lex),
        ..HighlightContext::from_doc_text("")
    };
    let hits = relevant_terms(GATEWAY_LINE, &ctx);
    assert!(has_ci(&hits, "API gateway"), "{hits:?}");
    assert!(has_ci(&hits, "Lambda"), "{hits:?}");
    assert!(!has_ci(&hits, "API"), "{hits:?}");
}

#[test]
fn inflections_and_word_order_variants_match() {
    let lex = software();
    let ctx = HighlightContext {
        lexicon: Some(&lex),
        ..HighlightContext::from_doc_text("")
    };
    for (msg, want) in [
        ("We spent a year on data modeling.", "data modeling"),
        (
            "She modeled the data for the warehouse.",
            "modeled the data",
        ),
        (
            "How do you handle cache invalidation?",
            "cache invalidation",
        ),
        (
            "Tell me about your unit tests and integration testing.",
            "unit tests",
        ),
    ] {
        let hits = relevant_terms(msg, &ctx);
        assert!(has_ci(&hits, want), "{msg:?} → {hits:?}");
    }
}

#[test]
fn generic_conversation_is_not_lit_up_by_the_pack() {
    let lex = software();
    let ctx = HighlightContext {
        lexicon: Some(&lex),
        ..HighlightContext::from_doc_text("")
    };
    for msg in [
        "Let me explain the data to the team and the system we use.",
        "We talked about the project, the model and the release.",
    ] {
        let evaluation = evaluate_terms(msg, &ctx, MAX_TERMS);
        let domain: Vec<_> = evaluation
            .trace
            .iter()
            .filter(|c| {
                c.signals
                    .iter()
                    .any(|sig| sig.source.starts_with("domain lexicon"))
            })
            .map(|c| c.term.clone())
            .collect();
        assert!(domain.is_empty(), "{msg:?} → {domain:?}");
    }
}

#[test]
fn suppression_and_boost_still_win_over_the_pack() {
    let lex = software();
    let suppress: HashSet<String> = ["modeling data".to_string()].into_iter().collect();
    let ctx = HighlightContext {
        lexicon: Some(&lex),
        suppress: Some(&suppress),
        ..HighlightContext::from_doc_text("")
    };
    let hits = relevant_terms(ORM_LINE, &ctx);
    assert!(!has_ci(&hits, "modeling data"), "{hits:?}");
}

#[test]
fn domain_terms_never_displace_the_users_own_terms_under_the_cap() {
    let lex = software();
    let known = s(&["Zephyr Bridge"]);
    let ctx = HighlightContext {
        context_terms: &known,
        lexicon: Some(&lex),
        ..HighlightContext::from_doc_text("")
    };
    let msg =
        "Zephyr Bridge aside, we use Kubernetes, Docker, Terraform, Kafka, Redis, PostgreSQL, \
               microservices, sharding, idempotency, load balancing and circuit breakers.";
    let evaluation = evaluate_terms(msg, &ctx, 3);
    assert_eq!(evaluation.terms.len(), 3, "{:?}", evaluation.terms);
    assert!(
        has_ci(&evaluation.terms, "Zephyr Bridge"),
        "{:?}",
        evaluation.terms
    );
}

#[test]
fn trace_names_the_domain_lexicon_signal_and_tier() {
    let lex = software();
    let ctx = HighlightContext {
        lexicon: Some(&lex),
        ..HighlightContext::from_doc_text("")
    };
    let evaluation = evaluate_terms(ORM_LINE, &ctx, MAX_TERMS);
    let cand = evaluation
        .trace
        .iter()
        .find(|c| c.term.eq_ignore_ascii_case("modeling data"))
        .expect("candidate present in trace");
    assert_eq!(cand.decision, "selected", "{cand:?}");
    assert!(
        cand.signals
            .iter()
            .any(|sig| sig.source == "domain lexicon (core)"),
        "{cand:?}"
    );
}

#[test]
fn selection_from_a_realistic_interview_context_picks_the_software_pack() {
    let glossary = s(&["API Gateway", "AWS Lambda", "DynamoDB", "Terraform"]);
    let input = SelectionInput {
        title: "Amazon SDE II interview",
        purpose: "Prep for system design and backend questions",
        job_description: Some(
            "Design scalable microservices on AWS; own the database schema and REST APIs.",
        ),
        key_terms: &[],
        glossary: &glossary,
    };
    assert_eq!(select_packs(&input), vec!["software-engineering"]);
    assert!(select_packs(&SelectionInput::default()).is_empty());
}

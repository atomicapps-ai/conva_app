//! FANER phrase-resolution acceptance tests (design:
//! `conva_core/docs/technical/faner-phrase-resolution.md`). Numbers in the
//! test names match the acceptance list in that document.

use std::collections::HashSet;

use conva_core::capture::{
    resolve_capture_arguments, Action, Capture, CaptureExtraction, Trigger, CAPTURE_SYSTEM_PROMPT,
};
use conva_core::highlight::{evaluate_terms, relevant_terms, HighlightContext};

fn s(v: &[&str]) -> Vec<String> {
    v.iter().map(|x| x.to_string()).collect()
}

fn known_terms(msg: &str, known: &[&str]) -> Vec<String> {
    let known = s(known);
    let ctx = HighlightContext {
        context_terms: &known,
        ..HighlightContext::from_doc_text("")
    };
    relevant_terms(msg, &ctx)
}

fn has(terms: &[String], want: &str) -> bool {
    terms.iter().any(|t| t == want)
}

fn has_ci(terms: &[String], want: &str) -> bool {
    terms.iter().any(|t| t.eq_ignore_ascii_case(want))
}

// ── Highlighter ─────────────────────────────────────────────────────────────

#[test]
fn t01_known_api_gateway_selected_not_nested_api() {
    let hits = known_terms("Explain API Gateway please", &["API Gateway"]);
    assert!(has(&hits, "API Gateway"), "{hits:?}");
    assert!(!has_ci(&hits, "API"), "{hits:?}");
}

#[test]
fn t02_to_t04_and_t13_casing_variants_resolve_identically() {
    let variants = [
        "Can you explain how api Gateway works",
        "Can you explain how API gateway works",
        "Can you explain how api gateway works",
        "Can you explain how API Gateway works",
        "Can you explain how API GATEWAY works",
    ];
    let mut identities = Vec::new();
    for v in variants {
        let hits = known_terms(v, &["API Gateway"]);
        assert!(has_ci(&hits, "API Gateway"), "{v}: {hits:?}");
        assert!(!has_ci(&hits, "API"), "{v}: {hits:?}");
        // Display keeps the transcript's own casing.
        let shown = hits
            .iter()
            .find(|h| h.eq_ignore_ascii_case("api gateway"))
            .unwrap();
        assert!(v.contains(shown.as_str()), "{v}: {shown}");
        identities.push(
            hits.iter()
                .map(|h| h.to_lowercase())
                .collect::<Vec<_>>()
                .join("|"),
        );
    }
    assert!(
        identities.windows(2).all(|w| w[0] == w[1]),
        "{identities:?}"
    );
    // Deterministic across repeated runs.
    let a = known_terms(variants[0], &["API Gateway"]);
    let b = known_terms(variants[0], &["API Gateway"]);
    assert_eq!(a, b);
}

#[test]
fn t06_standalone_api_never_invents_gateway() {
    let hits = known_terms("Our API is slow, so what is the plan", &["API Gateway"]);
    assert!(
        !hits.iter().any(|h| h.to_lowercase().contains("gateway")),
        "{hits:?}"
    );
    // Standalone acronym stays useful.
    assert!(has(&hits, "API"), "{hits:?}");
}

#[test]
fn t07_unknown_phrase_keeps_entity_behavior_without_forced_expansion() {
    // Not a known term: lowercase "gateway" is not an entity, so only the
    // acronym surfaces — nothing is expanded.
    let hits = known_terms("Explain how API gateway works", &["Lambda"]);
    assert_eq!(hits, s(&["API"]), "{hits:?}");
    // Both capitalized: the entity merger yields the full phrase on its own.
    let hits = known_terms("Explain how API Gateway works", &["Lambda"]);
    assert!(has(&hits, "API Gateway"), "{hits:?}");
    assert!(!has(&hits, "API"), "{hits:?}");
}

#[test]
fn t07b_document_phrase_supplies_the_full_phrase_when_not_a_context_term() {
    // The gap the doc-overlap signal structurally had: "API" is below the
    // standalone length floor, so only "gateway" overlapped.
    let doc = "The API Gateway routes requests to backend services.";
    let ctx = HighlightContext::from_doc_text(doc);
    let hits = relevant_terms("How does api gateway route things", &ctx);
    assert!(has_ci(&hits, "api gateway"), "{hits:?}");
    assert!(!has_ci(&hits, "api"), "{hits:?}");
    let eval = evaluate_terms("How does api gateway route things", &ctx, 12);
    let cand = eval.trace.iter().find(|c| c.key == "api gateway").unwrap();
    assert!(cand.signals.iter().any(|sg| sg.source == "document phrase"));
}

#[test]
fn t08_aws_lambda_versus_nested_aws_and_lambda() {
    let hits = known_terms("We deploy on AWS Lambda daily", &["AWS Lambda"]);
    assert!(has(&hits, "AWS Lambda"), "{hits:?}");
    assert!(!has(&hits, "AWS"), "{hits:?}");
    assert!(!has(&hits, "Lambda"), "{hits:?}");
    // Even a *known* fragment loses to the known longer phrase it sits in.
    let hits = known_terms("We deploy on AWS Lambda daily", &["AWS Lambda", "Lambda"]);
    assert!(has(&hits, "AWS Lambda"), "{hits:?}");
    assert!(!has(&hits, "Lambda"), "{hits:?}");
}

#[test]
fn t08b_partial_known_phrase_is_not_invented() {
    // "AWS Lambda" is known but only "Lambda" was spoken.
    let hits = known_terms("How does it integrate with Lambda?", &["AWS Lambda"]);
    assert!(
        !hits.iter().any(|h| h.to_lowercase().contains("aws")),
        "{hits:?}"
    );
}

#[test]
fn t09_full_phrase_plus_separate_standalone_acronym() {
    let hits = known_terms(
        "API Gateway handles routing. Later the API times out.",
        &["API Gateway"],
    );
    assert!(has(&hits, "API Gateway"), "{hits:?}");
    assert!(
        has(&hits, "API"),
        "standalone occurrence stays eligible: {hits:?}"
    );
    let eval = evaluate_terms(
        "API Gateway handles routing. Later the API times out.",
        &{
            HighlightContext {
                context_terms: &s(&["API Gateway"]),
                ..HighlightContext::from_doc_text("")
            }
        },
        12,
    );
    let api = eval.trace.iter().find(|c| c.key == "api").unwrap();
    assert_eq!(api.decision, "selected");
    assert!(api.spans.iter().any(|sp| sp.status == "contained"));
    assert!(api.spans.iter().any(|sp| sp.status == "selected"));
}

#[test]
fn t10_word_boundaries() {
    let hits = known_terms(
        "A rapid gateway, the apigateway, and APIs gateway",
        &["API Gateway"],
    );
    assert!(
        !hits
            .iter()
            .any(|h| h.to_lowercase().contains("api gateway")),
        "{hits:?}"
    );
}

#[test]
fn t11_stopwords_from_context_feedback_and_generated_candidates_stay_rejected() {
    let context_terms = s(&["the", "this"]);
    let boost: HashSet<String> = ["are", "mhmm"].iter().map(|x| x.to_string()).collect();
    let ctx = HighlightContext {
        context_terms: &context_terms,
        boost: Some(&boost),
        ..HighlightContext::from_doc_text("")
    };
    // Generated candidates: capitalised stopwords are entity-eligible tokens.
    let hits = relevant_terms("The This Are mhmm, So, Because", &ctx);
    for noise in ["the", "this", "are", "mhmm", "so", "because"] {
        assert!(!has_ci(&hits, noise), "{noise}: {hits:?}");
    }
    let eval = evaluate_terms("the this are", &ctx, 12);
    assert!(eval.terms.is_empty());
    assert!(eval.trace.iter().all(|c| c.decision == "rejected"));
}

#[test]
fn t11b_thumbs_down_on_the_phrase_lets_the_fragment_resurface() {
    let known = s(&["API Gateway"]);
    let suppress: HashSet<String> = ["api gateway"].iter().map(|x| x.to_string()).collect();
    let ctx = HighlightContext {
        context_terms: &known,
        suppress: Some(&suppress),
        ..HighlightContext::from_doc_text("")
    };
    let hits = relevant_terms("Explain API gateway", &ctx);
    assert!(!has_ci(&hits, "API gateway"), "{hits:?}");
    assert!(has(&hits, "API"), "{hits:?}");
}

#[test]
fn t12_connector_phrases_stay_valid() {
    let hits = known_terms("Is this state of the art?", &["state of the art"]);
    assert!(has_ci(&hits, "state of the art"), "{hits:?}");
    let hits = known_terms("We partner with Bank of America now", &["Bank of America"]);
    assert!(has(&hits, "Bank of America"), "{hits:?}");
}

#[test]
fn t14_hyphen_and_punctuation_policy() {
    // Hyphen (unspaced) joins: transcript hyphenation still matches, and the
    // display is the transcript's own spelling.
    let hits = known_terms("We love API-Gateway here", &["API Gateway"]);
    assert!(has(&hits, "API-Gateway"), "{hits:?}");
    // A known hyphenated term matches the spaced spoken form.
    let hits = known_terms("It is an event driven design", &["event-driven"]);
    assert!(has_ci(&hits, "event driven"), "{hits:?}");
    // Hard boundaries never join words.
    for msg in [
        "We changed the API. Gateway settings are next",
        "We changed the API, Gateway settings are next",
        "We changed the API; Gateway settings are next",
        "We changed the API\nGateway settings are next",
        "We changed the API - Gateway settings are next",
        "We changed the (API) Gateway settings are next",
    ] {
        let hits = known_terms(msg, &["API Gateway"]);
        assert!(
            !hits.iter().any(|h| h.to_lowercase().contains("api gateway")
                || h.to_lowercase().contains("api-gateway")
                || h.to_lowercase().contains("api. gateway")),
            "{msg}: {hits:?}"
        );
    }
    // Symbol connectors match only the same symbol.
    let hits = known_terms("We run CI/CD daily", &["CI/CD"]);
    assert!(has(&hits, "CI/CD"), "{hits:?}");
    let hits = known_terms("We run CI and CD daily", &["CI/CD"]);
    assert!(!has_ci(&hits, "CI/CD"), "{hits:?}");
}

#[test]
fn trace_explains_every_candidate_for_the_manual_validation_case() {
    let known = s(&["API Gateway", "AWS Lambda"]);
    let ctx = HighlightContext {
        context_terms: &known,
        ..HighlightContext::from_doc_text("")
    };
    let msg = "Can you explain how API gateway integrates with Lambda?";
    let eval = evaluate_terms(msg, &ctx, 12);
    assert_eq!(eval.terms, s(&["API gateway", "Lambda"]));
    let by_key = |k: &str| eval.trace.iter().find(|c| c.key == k).unwrap();
    let gw = by_key("api gateway");
    assert_eq!(gw.decision, "selected");
    assert_eq!(gw.signals[0].source, "context term");
    assert_eq!(gw.spans[0].text, "API gateway");
    let api = by_key("api");
    assert_eq!(api.decision, "rejected");
    assert!(api.reason.contains("api gateway"), "{}", api.reason);
    assert_eq!(by_key("lambda").decision, "selected");
    // "AWS Lambda" was never spoken in full → not even a candidate.
    assert!(eval.trace.iter().all(|c| c.key != "aws lambda"));
}

// ── Capture routing ─────────────────────────────────────────────────────────

fn capture(action: Action, args: &[&str]) -> Capture {
    Capture {
        trigger: Trigger::Gap,
        action,
        arguments: s(args),
        tier: None,
        kind: None,
        preview: "p".into(),
    }
}

fn extraction(captures: Vec<Capture>) -> CaptureExtraction {
    CaptureExtraction { captures }
}

#[test]
fn t15_prompt_carries_the_longest_phrase_and_canonical_known_term_rules() {
    assert!(CAPTURE_SYSTEM_PROMPT.contains("LONGEST semantically complete term or noun phrase"));
    assert!(CAPTURE_SYSTEM_PROMPT.contains("'API Gateway', never the bare fragment 'API'"));
    assert!(CAPTURE_SYSTEM_PROMPT.contains("reproduce that known term EXACTLY"));
    assert!(CAPTURE_SYSTEM_PROMPT.contains("known terms are canonical"));
    assert!(CAPTURE_SYSTEM_PROMPT.contains("Never extend a term with words that were not spoken"));
}

#[test]
fn t05_raw_api_argument_resolves_to_known_api_gateway() {
    let lines = s(&["Can you explain how API gateway integrates with Lambda?"]);
    let res = resolve_capture_arguments(
        extraction(vec![capture(Action::Explain, &["API"])]),
        &lines,
        &s(&["API Gateway", "AWS Lambda"]),
    );
    assert_eq!(res.extraction.captures[0].arguments, s(&["API Gateway"]));
    let t = &res.trace[0];
    assert_eq!(t.raw, "API");
    assert_eq!(t.outcome, "rewritten");
    assert_eq!(t.container.as_deref(), Some("API Gateway"));
    assert_eq!(t.matched_text.as_deref(), Some("API gateway"));
}

#[test]
fn t16_capture_post_processing_is_deterministic_for_any_shorter_argument() {
    let lines = s(&["We deploy on aws lambda behind api gateway daily."]);
    let known = s(&["API Gateway", "AWS Lambda"]);
    for raw in [
        "API",
        "AWS",
        "Lambda",
        "api gateway",
        "AWS Lambda",
        "Gateway",
    ] {
        let a = resolve_capture_arguments(
            extraction(vec![capture(Action::Explain, &[raw])]),
            &lines,
            &known,
        );
        let b = resolve_capture_arguments(
            extraction(vec![capture(Action::Explain, &[raw])]),
            &lines,
            &known,
        );
        assert_eq!(a, b, "{raw}");
        let arg = &a.extraction.captures[0].arguments[0];
        assert!(
            known.contains(arg),
            "{raw} should resolve to a known term, got {arg}"
        );
    }
}

#[test]
fn t06b_capture_never_invents_words_absent_from_the_transcript() {
    let lines = s(&["Our API is slow today"]);
    let res = resolve_capture_arguments(
        extraction(vec![capture(Action::Explain, &["API"])]),
        &lines,
        &s(&["API Gateway"]),
    );
    assert_eq!(res.extraction.captures[0].arguments, s(&["API"]));
    assert_eq!(res.trace[0].outcome, "kept");
    // Paraphrase not in the transcript: left alone, flagged.
    let res = resolve_capture_arguments(
        extraction(vec![capture(Action::Explain, &["Gateway"])]),
        &lines,
        &s(&["API Gateway"]),
    );
    assert_eq!(res.extraction.captures[0].arguments, s(&["Gateway"]));
    assert_eq!(res.trace[0].outcome, "unverified");
}

#[test]
fn capture_standalone_occurrence_keeps_the_raw_argument() {
    let lines = s(&["API Gateway is fine. But the API itself is slow."]);
    let res = resolve_capture_arguments(
        extraction(vec![capture(Action::Explain, &["API"])]),
        &lines,
        &s(&["API Gateway"]),
    );
    assert_eq!(res.extraction.captures[0].arguments, s(&["API"]));
    assert_eq!(res.trace[0].outcome, "kept");
}

#[test]
fn capture_boundary_split_words_are_not_widened() {
    let lines = s(&["We changed the API. Gateway settings are next."]);
    let res = resolve_capture_arguments(
        extraction(vec![capture(Action::Explain, &["API"])]),
        &lines,
        &s(&["API Gateway"]),
    );
    assert_eq!(res.extraction.captures[0].arguments, s(&["API"]));
}

#[test]
fn capture_known_term_spelling_is_canonical_and_duplicates_merge() {
    let lines = s(&["how does api gateway scale"]);
    let res = resolve_capture_arguments(
        extraction(vec![
            capture(Action::Explain, &["api gateway"]),
            capture(Action::Explain, &["API"]),
        ]),
        &lines,
        &s(&["API Gateway"]),
    );
    assert_eq!(res.extraction.captures.len(), 1, "{:?}", res.extraction);
    assert_eq!(res.extraction.captures[0].arguments, s(&["API Gateway"]));
    assert_eq!(res.trace[0].outcome, "canonicalized");
    assert_eq!(res.trace[1].outcome, "rewritten");
}

#[test]
fn capture_stopword_only_explain_arguments_are_dropped_but_argless_captures_survive() {
    let lines = s(&["the this are"]);
    let mut synth = capture(Action::Synthesize, &[]);
    synth.trigger = Trigger::Question;
    let res = resolve_capture_arguments(
        extraction(vec![capture(Action::Explain, &["the"]), synth]),
        &lines,
        &[],
    );
    assert_eq!(res.extraction.captures.len(), 1);
    assert_eq!(res.extraction.captures[0].action, Action::Synthesize);
    assert_eq!(res.trace[0].outcome, "dropped");
}

//! FANER live capture & assist routing (design: `conva_core/docs/technical/
//! faner-capture-algorithm.md`, roadmap F11).
//!
//! Given the other party's finalized speech plus the user's prepared context
//! (role + résumé terms), a fast-slot LLM pass extracts **routed captures** —
//! each a `(trigger, action, arguments)` decision about what would help the
//! user answer right now: EXPLAIN a gap, RECALL their own history, ASSIST a
//! task, or SYNTHESIZE a grounded answer to a keyword-free question.
//!
//! This module owns the rubric prompt and the (defensive) parsing of the
//! model's JSON; the shell owns batching, the LLM call, and delivery. Pure and
//! unit-tested, mirroring `tracker.rs`.
//!
//! Fourth capability of the **FANER Engine** (alongside `radar.rs`,
//! `highlight.rs`, `tracker.rs`) — the routing layer that turns detected
//! triggers into actionable assists.

use std::collections::HashSet;

use serde::{Deserialize, Serialize};

use crate::asr::TranscriptSegment;
use crate::audio::StreamSide;
use crate::llm::LlmRequest;

/// The prepared context the capture pass is grounded in — the user's role and
/// the terms already on their résumé. A term IN `terms` that the other party
/// references routes to RECALL; a term NOT in it routes to EXPLAIN.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct PreparedContext {
    pub role: String,
    #[serde(default)]
    pub terms: Vec<String>,
}

/// What in the other party's speech triggered a capture.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Trigger {
    Question,
    TaskFrame,
    PrepReference,
    Gap,
}

/// The kind of help to surface — chosen by the trigger's relationship to the
/// prepared context.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum Action {
    Explain,
    Recall,
    Assist,
    Synthesize,
}

/// How likely a captured term is to actually be unknown — decides whether it
/// gets a chip at all and how much explanation it earns. A term judged
/// "fundamental" (neither tier) isn't captured. Owner design: 2026-08-20.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Tier {
    /// Assumed field-level knowledge — worth a quick refresher, not a lecture
    /// ("event-driven", "idempotency", "high-throughput").
    Field,
    /// Deep/product-specific — needs a fuller explanation ("RDS Proxy",
    /// "Step Functions").
    Specialized,
}

/// What KIND of thing a captured term names — independent of Tier, since a
/// term's obscurity and its shape are different axes. Decides what the
/// `preview` should contain: a definition, or a fix.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Kind {
    /// Names a thing — answer with a definition.
    Concept,
    /// Names a known engineering pain point with an established standard fix
    /// ("cold-start", "N+1 queries") — answer leads with the fix, not a
    /// dictionary entry.
    Problem,
}

/// One routed capture: what to help with, how, and about what.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Capture {
    pub trigger: Trigger,
    pub action: Action,
    #[serde(default)]
    pub arguments: Vec<String>,
    /// Absent for RECALL/ASSIST/SYNTHESIZE (Tier only classifies EXPLAIN
    /// gaps) or on older/stub replies — `#[serde(default)]` keeps those
    /// parseable.
    #[serde(default)]
    pub tier: Option<Tier>,
    #[serde(default)]
    pub kind: Option<Kind>,
    /// A short (<=2 sentence) preview of the actual answer — a definition,
    /// the standard fix (when `kind` is `Problem`), a recall pointer, or a
    /// SYNTHESIZE teaser. Empty string when the model didn't provide one.
    #[serde(default)]
    pub preview: String,
}

/// The model's reply shape: a list of captures.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
pub struct CaptureExtraction {
    #[serde(default)]
    pub captures: Vec<Capture>,
}

/// The FANER capture rubric — the prompt-ready algorithm. Keep in sync with
/// `faner-capture-algorithm.md` §"The LLM rubric" and `scripts/faner-eval.mjs`.
pub const CAPTURE_SYSTEM_PROMPT: &str = "You assist a user during a live \
conversation. You receive the OTHER party's latest utterance plus the user's \
PREPARED CONTEXT (their role and the terms already on their résumé). Decide \
what to surface to help the user answer right now.\n\
For the utterance:\n\
1. Find the QUESTIONS first — a question is the clearest signal of what the \
user must address.\n\
2. Extract TASK FRAMES — (verb + arguments); split a compound ask into \
separate items. Scan the WHOLE utterance for jargon, not just the words \
inside a detected question — scene-setting sentences carry real terms too \
('In high-throughput, event-driven systems...' has two gap terms before any \
question starts). Emit ONE capture per distinct term — never bundle several \
terms into one capture's arguments.\n\
3. For each item choose an ACTION by its relationship to the prepared \
context: a term NOT in the prepared context (a gap) -> EXPLAIN; a term IN the \
prepared context, referenced back ('on your résumé', 'you mentioned') -> \
RECALL; a task to perform -> ASSIST; a keyword-free behavioral/hypothetical \
question -> SYNTHESIZE.\n\
4. Choose a TRIGGER for each item: 'question', 'task_frame', 'prep_reference', \
or 'gap'.\n\
5. For every EXPLAIN capture, also set tier and kind:\n\
   - tier: 'field' (a competent practitioner in the general field should \
know this but might blank on it under pressure — quick refresher) or \
'specialized' (deep/product-specific, needs a fuller explanation). If it's \
genuinely common knowledge for this role, don't capture it at all.\n\
   - kind: 'concept' (names a thing -> define it) or 'problem' (names a \
known engineering pain point with an established standard fix, e.g. \
'cold-start', 'N+1 queries' -> the preview MUST lead with the concrete fix, \
not a definition).\n\
6. Write a `preview`: <=2 sentences, the actual short answer — a definition \
for concepts, the standard mitigation FIRST for problems, a one-line pointer \
of what to pull from the user's history for RECALL, a one-line teaser (not \
the full answer) for SYNTHESIZE. Never leave it empty for a capture you emit.\n\
7. Skip anything with no marginal value — do NOT surface a term the user \
plainly already owns unless the other party attaches something new to it.\n\
Reply with ONLY a JSON object, no prose, no code fences, matching exactly: \
{\"captures\": [{\"trigger\": \"question|task_frame|prep_reference|gap\", \
\"action\": \"EXPLAIN|RECALL|ASSIST|SYNTHESIZE\", \"arguments\": [string], \
\"tier\": \"field|specialized\"|null, \"kind\": \"concept|problem\"|null, \
\"preview\": string}]}. arguments are the operands of the item (the \
tool/topic/task) — for jargon/gap captures this is exactly one term, never \
several bundled together. tier/kind are null for RECALL/ASSIST/SYNTHESIZE \
(they only classify EXPLAIN). Empty captures array is allowed.";

/// Build one capture-pass request over newly finalized segments, grounded in
/// the prepared context. THEM lines are the other party, YOU lines the user.
pub fn build_capture_request(segments: &[TranscriptSegment], ctx: &PreparedContext) -> LlmRequest {
    let mut user = String::from("PREPARED CONTEXT\n");
    user.push_str(&format!("role: {}\n", ctx.role.trim()));
    user.push_str(&format!("résumé terms: {}\n\n", ctx.terms.join(", ")));
    user.push_str("OTHER PARTY SAID:\n");
    for segment in segments.iter().filter(|s| s.is_final) {
        let speaker = match segment.side {
            StreamSide::Inbound => "THEM",
            StreamSide::Outbound => "YOU",
        };
        user.push_str(&format!("{speaker}: {}\n", segment.text.trim()));
    }
    LlmRequest {
        system: CAPTURE_SYSTEM_PROMPT.to_string(),
        user,
        max_tokens: 700,
    }
}

/// Parse the model's reply. Tolerates code fences and surrounding prose by
/// slicing the outermost braces; returns `None` when nothing parses — captures
/// are best-effort and silently skippable.
pub fn parse_capture_reply(reply: &str) -> Option<CaptureExtraction> {
    let start = reply.find('{')?;
    let end = reply.rfind('}')?;
    if end <= start {
        return None;
    }
    serde_json::from_str(&reply[start..=end]).ok()
}

/// Session-scoped dedup of routed captures, mirroring the tracker's merge: the
/// shell accumulates every pass's captures here and re-emits the full deduped
/// list. Dedup is by `(trigger, action, arguments)`, case- and
/// order-insensitive on the arguments — so the same routed capture surfacing
/// across two passes is stored once.
#[derive(Debug, Default)]
pub struct CaptureState {
    pub captures: Vec<Capture>,
    seen: HashSet<String>,
}

impl CaptureState {
    pub fn new() -> Self {
        Self::default()
    }

    fn key(capture: &Capture) -> String {
        let mut args: Vec<String> = capture
            .arguments
            .iter()
            .map(|a| a.trim().to_lowercase())
            .filter(|a| !a.is_empty())
            .collect();
        args.sort();
        format!(
            "{:?}|{:?}|{}",
            capture.trigger,
            capture.action,
            args.join(",")
        )
    }

    /// Merge a pass's captures into the session state. Returns `true` if any
    /// new (previously unseen) capture was added.
    pub fn merge(&mut self, extraction: CaptureExtraction) -> bool {
        let mut changed = false;
        for capture in extraction.captures {
            if self.seen.insert(Self::key(&capture)) {
                self.captures.push(capture);
                changed = true;
            }
        }
        changed
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn seg(side: StreamSide, text: &str) -> TranscriptSegment {
        TranscriptSegment {
            side,
            seq: 0,
            text: text.into(),
            is_final: true,
            start_ms: 0,
            end_ms: 1,
            confidence: None,
            latency_ms: 1,
        }
    }

    #[test]
    fn request_includes_context_and_them_line() {
        let ctx = PreparedContext {
            role: "Software Engineer".into(),
            terms: vec!["AWS".into(), "Terraform".into()],
        };
        let req = build_capture_request(
            &[seg(
                StreamSide::Inbound,
                "How do you handle Terraform state?",
            )],
            &ctx,
        );
        assert!(req.user.contains("role: Software Engineer"));
        assert!(req.user.contains("Terraform"));
        assert!(req
            .user
            .contains("THEM: How do you handle Terraform state?"));
        assert_eq!(req.system, CAPTURE_SYSTEM_PROMPT);
    }

    #[test]
    fn request_renders_finals_only_and_tags_speaker() {
        let ctx = PreparedContext::default();
        let mut partial = seg(StreamSide::Inbound, "partial words");
        partial.is_final = false;
        let req = build_capture_request(&[seg(StreamSide::Outbound, "my answer"), partial], &ctx);
        assert!(req.user.contains("YOU: my answer"));
        assert!(!req.user.contains("partial words"));
    }

    #[test]
    fn parses_clean_capture_json() {
        // The T1 golden-transcript shape (faner-golden-transcript.json).
        let reply = r#"{"captures":[
            {"trigger":"prep_reference","action":"RECALL","arguments":["Terraform"]},
            {"trigger":"task_frame","action":"ASSIST","arguments":["Terraform","team state"]},
            {"trigger":"task_frame","action":"ASSIST","arguments":["Terraform","CloudFormation","Pulumi"]}
        ]}"#;
        let ex = parse_capture_reply(reply).unwrap();
        assert_eq!(ex.captures.len(), 3);
        assert_eq!(ex.captures[0].trigger, Trigger::PrepReference);
        assert_eq!(ex.captures[0].action, Action::Recall);
        assert_eq!(ex.captures[0].arguments, vec!["Terraform".to_string()]);
        assert_eq!(ex.captures[2].action, Action::Assist);
    }

    #[test]
    fn parses_fenced_json_with_prose_and_synthesize() {
        // T4: a keyword-free behavioral question routes to SYNTHESIZE.
        let reply = "Here:\n```json\n{\"captures\":[{\"trigger\":\"question\",\"action\":\"SYNTHESIZE\",\"arguments\":[]}]}\n```";
        let ex = parse_capture_reply(reply).unwrap();
        assert_eq!(ex.captures.len(), 1);
        assert_eq!(ex.captures[0].trigger, Trigger::Question);
        assert_eq!(ex.captures[0].action, Action::Synthesize);
        assert!(ex.captures[0].arguments.is_empty());
    }

    #[test]
    fn empty_captures_and_garbage() {
        assert_eq!(
            parse_capture_reply(r#"{"captures":[]}"#)
                .unwrap()
                .captures
                .len(),
            0
        );
        // Missing field defaults to empty, not an error.
        assert_eq!(parse_capture_reply(r#"{}"#).unwrap().captures.len(), 0);
        assert!(parse_capture_reply("no json here").is_none());
        assert!(parse_capture_reply("").is_none());
    }

    #[test]
    fn trigger_and_action_serde_roundtrip() {
        let c = Capture {
            trigger: Trigger::Gap,
            action: Action::Explain,
            arguments: vec!["Pulumi".into()],
            tier: Some(Tier::Specialized),
            kind: Some(Kind::Concept),
            preview: "An open-source IaC tool similar to Terraform.".into(),
        };
        let json = serde_json::to_string(&c).unwrap();
        assert!(json.contains("\"gap\""));
        assert!(json.contains("\"EXPLAIN\""));
        assert!(json.contains("\"specialized\""));
        assert!(json.contains("\"concept\""));
        assert_eq!(serde_json::from_str::<Capture>(&json).unwrap(), c);
    }

    #[test]
    fn tier_kind_preview_default_when_absent() {
        // Older/stub replies without the new fields still parse — RECALL/
        // ASSIST/SYNTHESIZE never carry tier/kind, and a bare-bones reply
        // shouldn't fail just because `preview` was omitted.
        let reply = r#"{"captures":[{"trigger":"prep_reference","action":"RECALL","arguments":["Terraform"]}]}"#;
        let ex = parse_capture_reply(reply).unwrap();
        let c = &ex.captures[0];
        assert_eq!(c.tier, None);
        assert_eq!(c.kind, None);
        assert_eq!(c.preview, "");
    }

    #[test]
    fn problem_kind_parses() {
        // The cold-start case: a field-tier problem, preview leads with the fix.
        let reply = r#"{"captures":[{"trigger":"gap","action":"EXPLAIN","arguments":["cold-start"],"tier":"field","kind":"problem","preview":"Use provisioned concurrency or SnapStart to keep instances warm."}]}"#;
        let ex = parse_capture_reply(reply).unwrap();
        let c = &ex.captures[0];
        assert_eq!(c.tier, Some(Tier::Field));
        assert_eq!(c.kind, Some(Kind::Problem));
        assert!(c.preview.contains("provisioned concurrency"));
    }

    fn cap(trigger: Trigger, action: Action, args: &[&str]) -> Capture {
        Capture {
            trigger,
            action,
            arguments: args.iter().map(|a| a.to_string()).collect(),
            tier: None,
            kind: None,
            preview: String::new(),
        }
    }

    #[test]
    fn state_merges_and_dedupes() {
        let mut state = CaptureState::new();
        let ex = CaptureExtraction {
            captures: vec![
                cap(Trigger::PrepReference, Action::Recall, &["Terraform"]),
                cap(Trigger::Question, Action::Synthesize, &[]),
            ],
        };
        assert!(state.merge(ex));
        assert_eq!(state.captures.len(), 2);

        // Re-emitting the same two captures (args reordered / recased) adds
        // nothing — dedup is order- and case-insensitive.
        let again = CaptureExtraction {
            captures: vec![
                cap(Trigger::PrepReference, Action::Recall, &["terraform"]),
                cap(Trigger::Question, Action::Synthesize, &[]),
                cap(
                    Trigger::TaskFrame,
                    Action::Assist,
                    &["Pulumi", "CloudFormation"],
                ),
            ],
        };
        assert!(again.captures.len() == 3);
        assert!(state.merge(again)); // the task_frame is new
        assert_eq!(state.captures.len(), 3);

        // A capture identical up to argument order does not re-add.
        let reordered = CaptureExtraction {
            captures: vec![cap(
                Trigger::TaskFrame,
                Action::Assist,
                &["cloudformation", "pulumi"],
            )],
        };
        assert!(!state.merge(reordered));
        assert_eq!(state.captures.len(), 3);
    }
}

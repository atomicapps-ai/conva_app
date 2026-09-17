//! Content-free behavioural telemetry — the taxonomy `/events` validates
//! against (`docs/platform/11-beta-telemetry-and-participation.md` "Event
//! taxonomy v1" + `docs/platform/15-events-implementation.md` §9's two
//! metering-derived additions, both in conva_core). This module is the
//! platform-agnostic half: the envelope shape, the per-event field schemas,
//! and a validator — no fs/OS/Tauri dependency, so it compiles and is
//! unit-tested the same way on desktop and mobile. The shell
//! (`src-tauri/src/telemetry_events.rs`) owns the durable queue (the JSONL
//! file, the cursor, the device id) and calls [`validate_event`] before ever
//! writing a line — the same defence-in-depth posture the server's own
//! validator (`conva_web/src/live/events.js`) applies a second time.
//!
//! Keep this taxonomy in lockstep with `conva_web/src/live/events.js`'s
//! `FIELD_SCHEMAS` and `conva_core/platform/supabase/migrations/
//! 0011_telemetry_events.sql`'s `ev` check constraint — a new event name
//! needs all three updated, not just one.

use serde::{Deserialize, Serialize};

pub const EVENTS_SCHEMA_VERSION: u16 = 1;

/// One taxonomy event: counts, timings, enums and booleans only — no free
/// text, no identifiers of user content. `fields`' shape is defined per `ev`
/// by [`validate_event`].
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TelemetryEvent {
    pub ev: String,
    pub seq: u64,
    /// Unix ms — when the event occurred (client clock).
    pub t: u64,
    pub schema_v: u16,
    #[serde(default)]
    pub session_id: Option<String>,
    pub app_version: String,
    /// `"desktop"` | `"web"`.
    pub platform: String,
    #[serde(default)]
    pub fields: serde_json::Value,
}

/// Every event name this taxonomy recognizes. `11`'s v1 list plus `15` §9's
/// two metering-derived additions (`research_search`, `tts_synthesized`).
pub const TAXONOMY: &[&str] = &[
    "app_started",
    "app_quit",
    "signed_in",
    "session_started",
    "session_ended",
    "asr_engine",
    "ally_asked",
    "ally_answer_action",
    "radar_question_tapped",
    "tracking_item_created",
    "context_created",
    "doc_ingested",
    "conversation_saved",
    "error",
    "log_dropped",
    "research_search",
    "tts_synthesized",
];

const ALLY_ANSWER_ACTIONS: &[&str] = &[
    "kept",
    "copied",
    "expanded",
    "opened",
    "dismissed",
    "reasked",
];
const CAPTURE_MODES: &[&str] = &["mic_only", "both_sides"];
const SIGNIN_METHODS: &[&str] = &["google", "password"];
const PLATFORM_VALUES: &[&str] = &["desktop", "web"];

/// One violation: a schema position and why — never the offending value
/// (mirrors `events.js`'s discipline: a violation path is safe to log).
#[derive(Debug, Clone, PartialEq)]
pub struct Violation {
    pub path: String,
    pub reason: &'static str,
}

fn is_code(v: &serde_json::Value) -> bool {
    // Bounded, lower_snake_case machine token — no spaces, no free text.
    match v.as_str() {
        Some(s) if !s.is_empty() && s.len() <= 48 => {
            let mut chars = s.chars();
            let first_ok = chars
                .next()
                .map(|c| c.is_ascii_lowercase())
                .unwrap_or(false);
            first_ok
                && s.chars()
                    .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_')
        }
        _ => false,
    }
}
fn is_model_id(v: &serde_json::Value) -> bool {
    // Permissive enough for real model ids ("claude-sonnet-5", "gpt-5.2")
    // without allowing free text: bounded, no spaces, restricted charset.
    match v.as_str() {
        Some(s) if !s.is_empty() && s.len() <= 64 => s
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | ':' | '-')),
        _ => false,
    }
}
fn is_num(v: &serde_json::Value) -> bool {
    v.as_f64()
        .map(|n| n.is_finite() && (0.0..=1e15).contains(&n))
        .unwrap_or(false)
}
fn is_bool(v: &serde_json::Value) -> bool {
    v.is_boolean()
}
fn is_enum(v: &serde_json::Value, allowed: &[&str]) -> bool {
    v.as_str().map(|s| allowed.contains(&s)).unwrap_or(false)
}

type FieldCheck = fn(&serde_json::Value) -> bool;

/// `(field name, validator)` pairs for one event's `fields`. A `fields` key
/// not listed here is a violation — the same closed-allow-list discipline as
/// the server validator.
fn field_schema(ev: &str) -> Option<&'static [(&'static str, FieldCheck)]> {
    match ev {
        "app_started" => Some(&[("cold_start", is_bool), ("gpu_backend", is_code)]),
        "app_quit" => Some(&[("uptime_ms", is_num)]),
        "signed_in" => Some(&[("method", |v| is_enum(v, SIGNIN_METHODS))]),
        "session_started" => Some(&[("capture_mode", |v| is_enum(v, CAPTURE_MODES))]),
        "session_ended" => Some(&[("duration_ms", is_num), ("turns", is_num)]),
        "asr_engine" => Some(&[
            ("backend", is_code),
            ("realtime_factor", is_num),
            ("dropped_frames", is_num),
        ]),
        "ally_asked" => Some(&[
            ("feature", is_code),
            ("provider", is_code),
            ("model", is_model_id),
            ("in_tokens", is_num),
            ("out_tokens", is_num),
            ("latency_ms", is_num),
            ("ok", is_bool),
        ]),
        "ally_answer_action" => Some(&[
            ("action", |v| is_enum(v, ALLY_ANSWER_ACTIONS)),
            ("ms_to_action", is_num),
        ]),
        "radar_question_tapped" => Some(&[]),
        "tracking_item_created" => Some(&[("kind", is_code)]),
        "context_created" => Some(&[("doc_count", is_num)]),
        "doc_ingested" => Some(&[("type", is_code), ("size_bucket", is_code)]),
        "conversation_saved" => Some(&[("duration_ms", is_num)]),
        // scrubbed_message is shape-checked as a bounded machine token, never
        // free text — the exact code vocabulary is 15's open question §12 Q1.
        "error" => Some(&[("code", is_code), ("scrubbed_message", is_code)]),
        "log_dropped" => Some(&[("count", is_num)]),
        "research_search" => Some(&[("count", is_num)]),
        "tts_synthesized" => Some(&[("chars_bucket", is_code)]),
        _ => None,
    }
}

/// Validate one event's envelope + `fields`. `Ok(())` when clean; otherwise
/// every violation found (paths only, never values).
pub fn validate_event(e: &TelemetryEvent) -> Result<(), Vec<Violation>> {
    let mut out = Vec::new();
    let bad = |out: &mut Vec<Violation>, path: &str, reason: &'static str| {
        out.push(Violation {
            path: path.to_string(),
            reason,
        });
    };

    let schema = field_schema(&e.ev);
    if schema.is_none() {
        bad(&mut out, "ev", "unknown taxonomy event");
    }
    if e.schema_v != EVENTS_SCHEMA_VERSION {
        bad(&mut out, "schema_v", "unsupported schema");
    }
    if e.app_version.is_empty() || e.app_version.len() > 32 {
        bad(&mut out, "app_version", "bounded version string expected");
    }
    if !PLATFORM_VALUES.contains(&e.platform.as_str()) {
        bad(&mut out, "platform", "desktop|web expected");
    }
    if let Some(sid) = &e.session_id {
        if sid.is_empty() || sid.len() > 128 {
            bad(&mut out, "session_id", "bounded id expected");
        }
    }

    if let Some(schema) = schema {
        match e.fields.as_object() {
            Some(obj) => {
                for (k, v) in obj {
                    match schema.iter().find(|(name, _)| *name == k) {
                        Some((_, check)) => {
                            if !check(v) {
                                bad(&mut out, &format!("fields.{k}"), "invalid value");
                            }
                        }
                        None => bad(
                            &mut out,
                            &format!("fields.{k}"),
                            "unknown field for this event",
                        ),
                    }
                }
            }
            None => {
                // Present-but-not-an-object is always wrong; null/absent is
                // only wrong when this event's schema actually needs fields.
                if !e.fields.is_null() || !schema.is_empty() {
                    bad(&mut out, "fields", "object expected");
                }
            }
        }
    }

    if out.is_empty() {
        Ok(())
    } else {
        Err(out)
    }
}

/// Bucket a character count the same coarse way `doc_ingested`'s
/// `size_bucket` does elsewhere — the exact boundaries are this module's own
/// choice (the server only shape-checks the string, per `15` §9), kept in
/// one place so every caller agrees.
pub fn chars_bucket(chars: u64) -> &'static str {
    match chars {
        0..=500 => "under_500",
        501..=2000 => "under_2000",
        2001..=10_000 => "under_10000",
        _ => "over_10000",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ev(name: &str, fields: serde_json::Value) -> TelemetryEvent {
        TelemetryEvent {
            ev: name.to_string(),
            seq: 1,
            t: 1_700_000_000_000,
            schema_v: EVENTS_SCHEMA_VERSION,
            session_id: Some("live_abc123".to_string()),
            app_version: "0.4.0".to_string(),
            platform: "desktop".to_string(),
            fields,
        }
    }

    #[test]
    fn every_taxonomy_event_has_a_minimal_valid_example() {
        use serde_json::json;
        let examples: &[(&str, serde_json::Value)] = &[
            (
                "app_started",
                json!({"cold_start": true, "gpu_backend": "vulkan"}),
            ),
            ("app_quit", json!({"uptime_ms": 60000})),
            ("signed_in", json!({"method": "google"})),
            ("session_started", json!({"capture_mode": "both_sides"})),
            ("session_ended", json!({"duration_ms": 60000, "turns": 4})),
            (
                "asr_engine",
                json!({"backend": "whisper_cpp", "realtime_factor": 1.2, "dropped_frames": 0}),
            ),
            (
                "ally_asked",
                json!({"feature": "ally_question", "provider": "anthropic", "model": "claude-sonnet-5", "in_tokens": 10, "out_tokens": 5, "latency_ms": 400, "ok": true}),
            ),
            (
                "ally_answer_action",
                json!({"action": "kept", "ms_to_action": 1200}),
            ),
            ("radar_question_tapped", json!({})),
            ("tracking_item_created", json!({"kind": "commitment"})),
            ("context_created", json!({"doc_count": 3})),
            (
                "doc_ingested",
                json!({"type": "pdf", "size_bucket": "under_1mb"}),
            ),
            ("conversation_saved", json!({"duration_ms": 120000})),
            (
                "error",
                json!({"code": "network", "scrubbed_message": "connect_failed"}),
            ),
            ("log_dropped", json!({"count": 2})),
            ("research_search", json!({"count": 1})),
            ("tts_synthesized", json!({"chars_bucket": "under_500"})),
        ];
        assert_eq!(
            examples.len(),
            TAXONOMY.len(),
            "every taxonomy name needs a test example"
        );
        for (name, fields) in examples {
            let v = validate_event(&ev(name, fields.clone()));
            assert_eq!(v, Ok(()), "{name}: {v:?}");
        }
    }

    #[test]
    fn rejects_unknown_event_name() {
        let v = validate_event(&ev("totally_made_up_event", serde_json::json!({})));
        assert!(v.is_err());
    }

    #[test]
    fn rejects_unknown_field_and_never_silently_drops_it() {
        let v = validate_event(&ev(
            "ally_asked",
            serde_json::json!({"feature": "ally_question", "provider": "anthropic", "model": "claude-sonnet-5", "in_tokens": 1, "out_tokens": 1, "latency_ms": 1, "ok": true, "extra": "nope"}),
        ));
        let violations = v.unwrap_err();
        assert!(violations.iter().any(|x| x.path == "fields.extra"));
    }

    #[test]
    fn rejects_free_text_shaped_like_a_sentence() {
        let smuggled = "customer said the deal is off";
        let v = validate_event(&ev(
            "error",
            serde_json::json!({"code": "network", "scrubbed_message": smuggled}),
        ));
        assert!(v.is_err());
        let msg = format!("{v:?}");
        assert!(
            !msg.contains(smuggled),
            "violation must never echo the value"
        );
    }

    #[test]
    fn rejects_wrong_schema_version_and_bad_platform() {
        let mut e = ev("app_quit", serde_json::json!({"uptime_ms": 1}));
        e.schema_v = 99;
        assert!(validate_event(&e).is_err());
        let mut e2 = ev("app_quit", serde_json::json!({"uptime_ms": 1}));
        e2.platform = "toaster".to_string();
        assert!(validate_event(&e2).is_err());
    }

    #[test]
    fn chars_bucket_boundaries() {
        assert_eq!(chars_bucket(0), "under_500");
        assert_eq!(chars_bucket(500), "under_500");
        assert_eq!(chars_bucket(501), "under_2000");
        assert_eq!(chars_bucket(2000), "under_2000");
        assert_eq!(chars_bucket(2001), "under_10000");
        assert_eq!(chars_bucket(10_001), "over_10000");
    }
}

//! Account deletion, client side: turning the server's answer into something
//! the UI can act on. Pure, so it is tested on any OS.
//!
//! The server (`DELETE /api/account`, conva_web `src/live/account.js`) answers
//! `200 { deleted: true, reference }` on success, and otherwise
//! `{ error, reason? }` with a stable `error` code. The UI maps these codes to
//! wording; this function only normalizes them.

use crate::ipc::DeleteAccountResult;

/// Codes the UI knows how to word. Anything else becomes `"upstream"`.
pub const KNOWN_ERRORS: &[&str] = &[
    "recent_sign_in_required",
    "signed_out",
    "quota_exceeded",
    "unprovisioned",
    "storage_cleanup_failed",
    "unconfigured",
    "upstream",
    "network",
];

/// `Ok` only for a `200` that says `deleted: true`. Everything else is a
/// stable error code, never a raw body: a body may name a project or a path.
pub fn interpret_delete_response(status: u16, body: &str) -> Result<DeleteAccountResult, String> {
    let json: Option<serde_json::Value> = serde_json::from_str(body).ok();
    if status == 200 {
        let deleted = json
            .as_ref()
            .and_then(|j| j.get("deleted"))
            .and_then(|v| v.as_bool())
            == Some(true);
        if deleted {
            let reference = json
                .as_ref()
                .and_then(|j| j.get("reference"))
                .and_then(|v| v.as_str())
                .map(str::to_string);
            return Ok(DeleteAccountResult { reference });
        }
        // A 200 that does not say "deleted" is not a deletion.
        return Err("upstream".into());
    }
    if let Some(code) = json
        .as_ref()
        .and_then(|j| j.get("error"))
        .and_then(|v| v.as_str())
        .filter(|c| KNOWN_ERRORS.contains(c))
    {
        return Err(code.to_string());
    }
    Err(match status {
        401 => "signed_out",
        403 => "recent_sign_in_required",
        429 => "quota_exceeded",
        503 => "unprovisioned",
        _ => "upstream",
    }
    .to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_a_200_that_says_deleted_is_a_deletion() {
        let ok = interpret_delete_response(200, r#"{"deleted":true,"reference":"DEL-ABCD-2345"}"#)
            .unwrap();
        assert_eq!(ok.reference.as_deref(), Some("DEL-ABCD-2345"));
        assert_eq!(
            interpret_delete_response(200, r#"{"deleted":true}"#)
                .unwrap()
                .reference,
            None
        );
        for body in [
            "",
            "{}",
            r#"{"deleted":false}"#,
            r#"{"deleted":"yes"}"#,
            "not json",
            r#"{"ok":true}"#,
        ] {
            assert_eq!(
                interpret_delete_response(200, body),
                Err("upstream".into()),
                "{body:?}"
            );
        }
    }

    #[test]
    fn known_error_codes_pass_through() {
        for code in KNOWN_ERRORS {
            let body = format!(r#"{{"error":"{code}","reason":"x"}}"#);
            assert_eq!(
                interpret_delete_response(400, &body),
                Err((*code).to_string())
            );
        }
    }

    #[test]
    fn unknown_codes_and_bare_statuses_map_to_a_stable_code_and_never_echo_the_body() {
        let leaky = r#"{"error":"relation hbxftjyooblxiiapaeei.documents does not exist"}"#;
        assert_eq!(
            interpret_delete_response(500, leaky),
            Err("upstream".into())
        );
        assert_eq!(interpret_delete_response(401, ""), Err("signed_out".into()));
        assert_eq!(
            interpret_delete_response(403, "<html>"),
            Err("recent_sign_in_required".into())
        );
        assert_eq!(
            interpret_delete_response(429, ""),
            Err("quota_exceeded".into())
        );
        assert_eq!(
            interpret_delete_response(503, ""),
            Err("unprovisioned".into())
        );
        assert_eq!(interpret_delete_response(502, ""), Err("upstream".into()));
    }
}

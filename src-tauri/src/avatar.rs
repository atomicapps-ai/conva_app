//! Desktop's own path to the **same** Supabase Storage `avatars` bucket
//! `conva_web`'s BFF writes to (`conva_web/src/live/avatarStorage.js`) — no
//! new backend layer, no new migration. The bucket's RLS (platform migration
//! `0010_profile_avatars.sql`) keys on `auth.uid()` from the JWT, not on
//! which client sent the request, so desktop's own already-held access
//! token (`auth::access_token`) satisfies it exactly the way the BFF's does
//! for web. Same bucket, same object path (`<user_id>/avatar`), same upsert
//! semantics — this file mirrors `avatarStorage.js` line for line, just in
//! Rust over blocking `ureq`.
//!
//! See `conva_core/docs/platform/15-avatar-editor-and-shared-storage.md` for
//! the full design (why this needed no new backend, and why it's the
//! template for the next "desktop talks to conva-core directly" feature).
//! Always run off the UI thread (`lib.rs`'s commands `spawn_blocking` this),
//! per architecture rule 5.

use std::io::Read;

use serde::{Deserialize, Serialize};

const BUCKET: &str = "avatars";

/// Downloaded avatar bytes, base64-encoded for the Tauri IPC boundary (same
/// convention as `save_screenshot`'s `png_base64`) — mirrored in
/// `src/lib/ipc.ts` as `AvatarBytes`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AvatarBytes {
    pub bytes_base64: String,
    pub mime: String,
}

fn object_path(user_id: &str) -> String {
    format!("{user_id}/avatar")
}

fn friendly_err(e: ureq::Error) -> String {
    match e {
        ureq::Error::Status(404, _) => "not_found".to_string(),
        ureq::Error::Status(code, resp) => {
            let body = resp.into_string().unwrap_or_default();
            format!("storage request failed ({code}): {body}")
        }
        ureq::Error::Transport(t) => t.to_string(),
    }
}

/// Upload (or replace, via `x-upsert`) the caller's avatar object.
pub fn upload(
    supabase_url: &str,
    anon_key: &str,
    access_token: &str,
    user_id: &str,
    bytes: Vec<u8>,
    mime: &str,
) -> Result<(), String> {
    let url = format!(
        "{supabase_url}/storage/v1/object/{BUCKET}/{}",
        object_path(user_id)
    );
    ureq::post(&url)
        .set("apikey", anon_key)
        .set("Authorization", &format!("Bearer {access_token}"))
        .set("Content-Type", mime)
        .set("x-upsert", "true")
        .send_bytes(&bytes)
        .map_err(friendly_err)?;
    Ok(())
}

/// The avatar object's bytes + Content-Type, or `None` on a 404 (no upload
/// yet — the caller falls back to the monogram, same as web).
pub fn download(
    supabase_url: &str,
    anon_key: &str,
    access_token: &str,
    user_id: &str,
) -> Result<Option<(Vec<u8>, String)>, String> {
    let url = format!(
        "{supabase_url}/storage/v1/object/{BUCKET}/{}",
        object_path(user_id)
    );
    let resp = match ureq::get(&url)
        .set("apikey", anon_key)
        .set("Authorization", &format!("Bearer {access_token}"))
        .call()
    {
        Ok(resp) => resp,
        Err(ureq::Error::Status(404, _)) => return Ok(None),
        Err(e) => return Err(friendly_err(e)),
    };
    let mime = resp.content_type().to_string();
    let mut bytes = Vec::new();
    resp.into_reader()
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    Ok(Some((bytes, mime)))
}

/// Remove the caller's avatar object. Missing is not an error (idempotent
/// delete, same as `avatarStorage.js`'s `removeAvatar`).
pub fn delete(
    supabase_url: &str,
    anon_key: &str,
    access_token: &str,
    user_id: &str,
) -> Result<(), String> {
    let url = format!("{supabase_url}/storage/v1/object/{BUCKET}");
    match ureq::delete(&url)
        .set("apikey", anon_key)
        .set("Authorization", &format!("Bearer {access_token}"))
        .set("Content-Type", "application/json")
        .send_json(serde_json::json!({ "prefixes": [object_path(user_id)] }))
    {
        Ok(_) | Err(ureq::Error::Status(404, _)) => Ok(()),
        Err(e) => Err(friendly_err(e)),
    }
}

#[cfg(test)]
mod tests {
    use super::object_path;

    #[test]
    fn object_path_is_one_fixed_object_per_user() {
        assert_eq!(object_path("abc-123"), "abc-123/avatar");
    }
}

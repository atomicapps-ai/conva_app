//! Portable `.cva` v1 contract. ZIP reading/writing and persistence belong to
//! platform adapters; these checks must run before any imported data is saved.
//!
//! MAINTENANCE CONTRACT: `.cva` is independent of app/database versions. When
//! Context, conversation, transcript, document, generated-artifact, speaker,
//! claim/review, or suggestion fields change, audit BOTH export and import DTO
//! conversions, nested ID remapping, the manifest inventory, golden fixtures,
//! and compatibility migrations. Never serialize persistence structs wholesale:
//! newly added fields may contain secrets, paths, or runtime-only state. Add a
//! new archive version only for an incompatible wire change; keep old readers
//! and fixture tests. See conva_core/docs/technical/
//! cva-context-conversation-portable-archive.md.

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};

pub const FORMAT: &str = "conva-archive";
/// Bump only for an incompatible `.cva` wire-format change. A new field in an
/// app record does NOT automatically change this version: decide explicitly
/// whether it belongs in the portable DTO and provide a migration/default.
pub const FORMAT_VERSION: u32 = 1;
pub const MAX_ARCHIVE_BYTES: u64 = 250 * 1024 * 1024;
pub const MAX_UNCOMPRESSED_BYTES: u64 = 500 * 1024 * 1024;
pub const MAX_ENTRY_BYTES: u64 = 100 * 1024 * 1024;
pub const MAX_JSON_BYTES: u64 = 10 * 1024 * 1024;
pub const MAX_ENTRIES: usize = 1_000;
pub const MAX_PATH_BYTES: usize = 240;
pub const MAX_COMPRESSION_RATIO: u64 = 100;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ArchiveCreator {
    pub app: String,
    pub app_version: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ArchiveContents {
    pub context: bool,
    pub conversation: bool,
    pub documents: usize,
    pub generated_artifacts: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ArchiveEntry {
    pub path: String,
    pub media_type: String,
    /// Uncompressed byte length.
    pub bytes: u64,
    /// Lowercase hexadecimal SHA-256 of the exact uncompressed payload.
    pub sha256: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
/// Stable archive envelope, not the app's persisted Context/conversation schema.
/// Any added payload/index path must update this inventory validation and the
/// exporter/importer in lockstep; retain old-version import fixtures.
pub struct ArchiveManifest {
    pub format: String,
    pub format_version: u32,
    pub created_at: String,
    pub created_by: ArchiveCreator,
    pub title: String,
    pub contents: ArchiveContents,
    pub entries: Vec<ArchiveEntry>,
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum ArchiveError {
    #[error("unsupported Conva archive format or version")]
    UnsupportedFormat,
    #[error("invalid archive path: {0}")]
    InvalidPath(String),
    #[error("duplicate archive path: {0}")]
    DuplicatePath(String),
    #[error("invalid archive manifest: {0}")]
    InvalidManifest(&'static str),
    #[error("archive exceeds {0} limit")]
    LimitExceeded(&'static str),
    #[error("missing or undeclared archive payload: {0}")]
    PayloadMismatch(String),
}

/// Reject unsafe names without trying to sanitize them: the archive's checksums
/// and internal references must use one canonical spelling on every platform.
pub fn validate_path(path: &str) -> Result<(), ArchiveError> {
    let invalid = path.is_empty()
        || path.len() > MAX_PATH_BYTES
        || path.starts_with('/')
        || path.contains(['\\', ':', '\0'])
        || path
            .split('/')
            .any(|part| part.is_empty() || part == "." || part == "..");
    if invalid {
        return Err(ArchiveError::InvalidPath(path.to_owned()));
    }
    Ok(())
}

/// Validate manifest invariants before looking at any payload. The ZIP reader
/// must additionally reject non-regular/encrypted entries, compare actual
/// uncompressed lengths and SHA-256, and impose compressed-size limits.
pub fn validate_manifest(manifest: &ArchiveManifest) -> Result<(), ArchiveError> {
    if manifest.format != FORMAT || manifest.format_version != FORMAT_VERSION {
        return Err(ArchiveError::UnsupportedFormat);
    }
    if !manifest.contents.context && !manifest.contents.conversation {
        return Err(ArchiveError::InvalidManifest("no Context or conversation"));
    }
    if manifest.title.trim().is_empty()
        || manifest.created_at.trim().is_empty()
        || manifest.created_by.app.trim().is_empty()
    {
        return Err(ArchiveError::InvalidManifest("missing display metadata"));
    }
    if manifest.entries.len() > MAX_ENTRIES {
        return Err(ArchiveError::LimitExceeded("entry count"));
    }
    let mut names = BTreeSet::new();
    let mut total = 0u64;
    for entry in &manifest.entries {
        validate_path(&entry.path)?;
        if entry.path == "manifest.json" {
            return Err(ArchiveError::InvalidManifest("manifest lists itself"));
        }
        // Windows treats case-only variants as one name. Reject them here so
        // the same archive has the same semantics on Windows, web and macOS.
        if !names.insert(entry.path.to_ascii_lowercase()) {
            return Err(ArchiveError::DuplicatePath(entry.path.clone()));
        }
        if entry.bytes > MAX_ENTRY_BYTES {
            return Err(ArchiveError::LimitExceeded("single entry"));
        }
        if entry.path.ends_with(".json") && entry.bytes > MAX_JSON_BYTES {
            return Err(ArchiveError::LimitExceeded("JSON payload"));
        }
        total = total
            .checked_add(entry.bytes)
            .ok_or(ArchiveError::LimitExceeded("uncompressed bytes"))?;
        if total > MAX_UNCOMPRESSED_BYTES {
            return Err(ArchiveError::LimitExceeded("uncompressed bytes"));
        }
        if entry.media_type.trim().is_empty()
            || entry.sha256.len() != 64
            || !entry
                .sha256
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        {
            return Err(ArchiveError::InvalidManifest("invalid entry metadata"));
        }
    }
    let has = |path: &str| names.contains(path);
    if manifest.contents.context != has("context/context.json")
        || manifest.contents.conversation != has("conversation/conversation.json")
    {
        return Err(ArchiveError::InvalidManifest(
            "contents do not match payloads",
        ));
    }
    if (manifest.contents.documents > 0) != has("documents/index.json")
        || (manifest.contents.generated_artifacts > 0) != has("generated/index.json")
    {
        return Err(ArchiveError::InvalidManifest("indexes do not match counts"));
    }
    Ok(())
}

/// Compare ZIP entries against the manifest before reading or persisting them.
/// Length and digest checks happen while streaming each entry's bytes.
pub fn validate_payload_names<'a>(
    manifest: &ArchiveManifest,
    zip_names: impl IntoIterator<Item = &'a str>,
) -> Result<(), ArchiveError> {
    validate_manifest(manifest)?;
    let expected: BTreeSet<_> = manifest.entries.iter().map(|e| e.path.as_str()).collect();
    let mut actual = BTreeSet::new();
    let mut folded = BTreeSet::new();
    for name in zip_names {
        validate_path(name)?;
        if !actual.insert(name) || !folded.insert(name.to_ascii_lowercase()) {
            return Err(ArchiveError::DuplicatePath(name.to_owned()));
        }
    }
    if !actual.remove("manifest.json") {
        return Err(ArchiveError::PayloadMismatch("manifest.json".to_owned()));
    }
    if let Some(name) = expected.symmetric_difference(&actual).next() {
        return Err(ArchiveError::PayloadMismatch((*name).to_owned()));
    }
    Ok(())
}

/// A caller-generated destination ID for every portable ID. Reject missing,
/// duplicate or identity mappings before a backend creates any records.
pub fn validate_id_map(
    source_ids: &[String],
    destination_ids: &BTreeMap<String, String>,
) -> Result<(), ArchiveError> {
    let source: BTreeSet<_> = source_ids.iter().collect();
    let destinations: BTreeSet<_> = destination_ids.values().collect();
    if source.len() != source_ids.len()
        || source.len() != destination_ids.len()
        || destinations.len() != destination_ids.len()
        || source_ids.iter().any(|id| id.trim().is_empty())
        || destination_ids
            .iter()
            .any(|(old, new)| !source.contains(old) || new.trim().is_empty() || old == new)
    {
        return Err(ArchiveError::InvalidManifest("invalid import ID mapping"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn valid() -> ArchiveManifest {
        ArchiveManifest {
            format: FORMAT.into(),
            format_version: 1,
            created_at: "2026-09-09T20:15:00Z".into(),
            created_by: ArchiveCreator {
                app: "conva".into(),
                app_version: "0.4.0".into(),
            },
            title: "Example".into(),
            contents: ArchiveContents {
                context: true,
                conversation: false,
                documents: 0,
                generated_artifacts: 0,
            },
            entries: vec![ArchiveEntry {
                path: "context/context.json".into(),
                media_type: "application/json".into(),
                bytes: 2,
                sha256: "a".repeat(64),
            }],
        }
    }

    #[test]
    fn minimal_contract_round_trips() {
        let decoded: ArchiveManifest =
            serde_json::from_str(&serde_json::to_string(&valid()).unwrap()).unwrap();
        validate_manifest(&decoded).unwrap();
        validate_payload_names(&decoded, ["manifest.json", "context/context.json"]).unwrap();
    }

    #[test]
    fn rejects_unsafe_paths_and_case_collisions() {
        for path in [
            "../evil",
            "/absolute",
            "C:/drive",
            "a\\b",
            "a//b",
            "a/./b",
            "a/../b",
            "a/",
            "",
        ] {
            assert!(validate_path(path).is_err(), "{path}");
        }
        let mut m = valid();
        m.entries.push(ArchiveEntry {
            path: "Context/context.json".into(),
            ..m.entries[0].clone()
        });
        assert!(matches!(
            validate_manifest(&m),
            Err(ArchiveError::DuplicatePath(_))
        ));
    }

    #[test]
    fn rejects_unknown_version_and_mismatched_payloads() {
        let mut m = valid();
        m.format_version = 2;
        assert_eq!(validate_manifest(&m), Err(ArchiveError::UnsupportedFormat));
        m.format_version = 1;
        assert!(validate_payload_names(&m, ["manifest.json", "extra.json"]).is_err());
        assert!(validate_payload_names(&m, ["context/context.json"]).is_err());
        assert!(validate_payload_names(
            &m,
            [
                "manifest.json",
                "context/context.json",
                "CONTEXT/context.json"
            ]
        )
        .is_err());
        m.contents.context = false;
        assert!(validate_manifest(&m).is_err());
    }

    #[test]
    fn rejects_oversize_and_invalid_digest() {
        let mut m = valid();
        m.entries[0].bytes = MAX_JSON_BYTES + 1;
        assert!(matches!(
            validate_manifest(&m),
            Err(ArchiveError::LimitExceeded(_))
        ));
        m.entries[0].bytes = 2;
        m.entries[0].sha256 = "G".repeat(64);
        assert!(validate_manifest(&m).is_err());
    }

    #[test]
    fn import_ids_must_be_complete_new_and_unique() {
        let source = vec!["a".into(), "b".into()];
        let valid = BTreeMap::from([("a".into(), "new-a".into()), ("b".into(), "new-b".into())]);
        validate_id_map(&source, &valid).unwrap();
        assert!(validate_id_map(&source, &BTreeMap::from([("a".into(), "new-a".into())])).is_err());
        assert!(validate_id_map(
            &source,
            &BTreeMap::from([("a".into(), "same".into()), ("b".into(), "same".into())])
        )
        .is_err());
        assert!(validate_id_map(
            &source,
            &BTreeMap::from([("a".into(), "a".into()), ("b".into(), "new-b".into())])
        )
        .is_err());
    }
}

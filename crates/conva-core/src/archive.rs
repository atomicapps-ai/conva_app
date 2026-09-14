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
use unicode_normalization::UnicodeNormalization;

pub const FORMAT: &str = "conva-archive";
/// Bump only for an incompatible `.cva` wire-format change. A new field in an
/// app record does NOT automatically change this version: decide explicitly
/// whether it belongs in the portable DTO and provide a migration/default.
pub const FORMAT_VERSION: u32 = 1;
/// Every `format_version` a reader must still accept (spec §2.2: "Readers
/// remain able to import every archive version still listed as supported").
/// Distinct from [`FORMAT_VERSION`], which is the only version a writer may
/// ever emit. MAINTENANCE: adding a new supported version means (a) adding it
/// here, (b) writing that version's migration into the current in-memory DTO
/// shape (there is nothing to migrate yet — v1 has no predecessor), (c)
/// keeping a permanent fixture/test for every version still listed, and (d)
/// never silently reinterpreting an old payload under the new shape without
/// an explicit migrator.
pub const SUPPORTED_FORMAT_VERSIONS: &[u32] = &[FORMAT_VERSION];

pub fn is_supported_format_version(version: u32) -> bool {
    SUPPORTED_FORMAT_VERSIONS.contains(&version)
}
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

/// The only entry paths a v1 archive may declare (besides `manifest.json`,
/// which is never itself a declared entry). Fixed. MAINTENANCE: a new payload
/// kind is a new canonical path added here, in the exporter, and in the
/// importer together — never let an exporter start writing a path this
/// allowlist doesn't already know about.
fn is_canonical_payload_path(path: &str) -> bool {
    matches!(
        path,
        "context/context.json"
            | "conversation/conversation.json"
            | "documents/index.json"
            | "generated/index.json"
    ) || path
        .strip_prefix("documents/files/")
        .is_some_and(|rest| !rest.is_empty() && !rest.contains('/'))
        || path.strip_prefix("generated/files/").is_some_and(|rest| {
            rest.ends_with(".md") && rest.len() > ".md".len() && !rest.contains('/')
        })
}

/// Loose RFC 3339 UTC ("Zulu") check: `YYYY-MM-DDTHH:MM:SS[.fraction]Z` with
/// each numeric field in its calendar range. Deliberately not a full calendar
/// library dependency for one display-only manifest field — this rejects
/// garbage/local-offset timestamps without claiming full RFC 3339 coverage
/// (e.g. it does not special-case February's day count or leap seconds).
fn is_plausible_utc_timestamp(value: &str) -> bool {
    let Some(body) = value.strip_suffix('Z') else {
        return false;
    };
    let bytes = body.as_bytes();
    let digits_at = |range: std::ops::Range<usize>| {
        bytes
            .get(range.clone())
            .is_some_and(|s| s.iter().all(u8::is_ascii_digit))
            && !range.is_empty()
    };
    if body.len() < 19
        || !digits_at(0..4)
        || bytes[4] != b'-'
        || !digits_at(5..7)
        || bytes[7] != b'-'
        || !digits_at(8..10)
        || bytes[10] != b'T'
        || !digits_at(11..13)
        || bytes[13] != b':'
        || !digits_at(14..16)
        || bytes[16] != b':'
        || !digits_at(17..19)
    {
        return false;
    }
    if body.len() > 19 {
        let frac = &body[19..];
        if !frac.starts_with('.')
            || frac.len() < 2
            || !frac[1..].bytes().all(|b| b.is_ascii_digit())
        {
            return false;
        }
    }
    let two = |range: std::ops::Range<usize>| body[range].parse::<u32>().unwrap_or(99);
    let month = two(5..7);
    let day = two(8..10);
    let hour = two(11..13);
    let minute = two(14..16);
    let second = two(17..19);
    (1..=12).contains(&month)
        && (1..=31).contains(&day)
        && hour <= 23
        && minute <= 59
        // A leap second (60) is valid RFC 3339; reject only clear garbage.
        && second <= 60
}

/// Format a Unix millisecond timestamp as the UTC RFC 3339 string
/// [`is_plausible_utc_timestamp`] accepts. No `chrono`/`time` dependency
/// exists in this workspace for one manifest field — pure integer
/// civil-calendar math instead (Howard Hinnant's well-known
/// `civil_from_days` algorithm: <https://howardhinnant.github.io/date_algorithms.html>).
/// MAINTENANCE: keep the emitted shape in sync with
/// [`is_plausible_utc_timestamp`]'s accepted shape.
pub fn format_utc_timestamp(unix_ms: u64) -> String {
    let secs = unix_ms / 1000;
    let ms = unix_ms % 1000;
    let days = (secs / 86_400) as i64;
    let time_of_day = secs % 86_400;
    let hour = time_of_day / 3600;
    let minute = (time_of_day % 3600) / 60;
    let second = time_of_day % 60;
    let (year, month, day) = civil_from_days(days);
    format!("{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}.{ms:03}Z")
}

/// Days-since-1970-01-01 -> (year, month, day), proleptic Gregorian.
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64; // [0, 146096]
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365; // [0, 399]
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100); // [0, 365]
    let mp = (5 * doy + 2) / 153; // [0, 11]
    let day = (doy - (153 * mp + 2) / 5 + 1) as u32; // [1, 31]
    let month = if mp < 10 { mp + 3 } else { mp - 9 } as u32; // [1, 12]
    let year = if month <= 2 { y + 1 } else { y };
    (year, month, day)
}

/// Exact media type required for the archive's own JSON payloads/indexes.
const CANONICAL_JSON_MEDIA_TYPE: &str = "application/json";

/// Loose `type/subtype` syntax check for a source document's declared media
/// type. Deliberately not a finite allowlist: the set of document types the
/// ingest pipeline supports evolves independently of the archive format, and
/// this function's job is to reject garbage, not to gatekeep new formats.
fn is_syntactically_valid_media_type(value: &str) -> bool {
    let is_token = |s: &str| {
        !s.is_empty()
            && s.bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"!#$&-^_.+".contains(&b))
    };
    value
        .split_once('/')
        .is_some_and(|(kind, sub)| is_token(kind) && is_token(sub))
}

/// Validate manifest invariants before looking at any payload. The ZIP reader
/// must additionally reject non-regular/encrypted entries, compare actual
/// uncompressed lengths and SHA-256, and impose compressed-size limits.
pub fn validate_manifest(manifest: &ArchiveManifest) -> Result<(), ArchiveError> {
    if manifest.format != FORMAT || !is_supported_format_version(manifest.format_version) {
        return Err(ArchiveError::UnsupportedFormat);
    }
    if !manifest.contents.context && !manifest.contents.conversation {
        return Err(ArchiveError::InvalidManifest("no Context or conversation"));
    }
    if manifest.title.trim().is_empty() || manifest.created_by.app.trim().is_empty() {
        return Err(ArchiveError::InvalidManifest("missing display metadata"));
    }
    if !is_plausible_utc_timestamp(&manifest.created_at) {
        return Err(ArchiveError::InvalidManifest(
            "created_at is not a UTC RFC 3339 timestamp",
        ));
    }
    if manifest.entries.len() > MAX_ENTRIES {
        return Err(ArchiveError::LimitExceeded("entry count"));
    }
    let mut names = BTreeSet::new();
    // Case-folded AND Unicode-normalized (NFC) canonical spellings, so a
    // filesystem that folds either dimension (Windows/macOS case-folding,
    // macOS HFS+/APFS Unicode normalization on write) can never end up
    // holding two entries this archive intended to keep distinct.
    let mut canonical_names = BTreeSet::new();
    let mut total = 0u64;
    for entry in &manifest.entries {
        validate_path(&entry.path)?;
        if entry.path == "manifest.json" {
            return Err(ArchiveError::InvalidManifest("manifest lists itself"));
        }
        if !is_canonical_payload_path(&entry.path) {
            return Err(ArchiveError::InvalidPath(entry.path.clone()));
        }
        if !names.insert(entry.path.clone()) {
            return Err(ArchiveError::DuplicatePath(entry.path.clone()));
        }
        let canonical: String = entry.path.nfc().collect::<String>().to_ascii_lowercase();
        if !canonical_names.insert(canonical) {
            return Err(ArchiveError::DuplicatePath(entry.path.clone()));
        }
        if entry.bytes > MAX_ENTRY_BYTES {
            return Err(ArchiveError::LimitExceeded("single entry"));
        }
        let is_json_index = entry.path.ends_with(".json");
        if is_json_index && entry.bytes > MAX_JSON_BYTES {
            return Err(ArchiveError::LimitExceeded("JSON payload"));
        }
        total = total
            .checked_add(entry.bytes)
            .ok_or(ArchiveError::LimitExceeded("uncompressed bytes"))?;
        if total > MAX_UNCOMPRESSED_BYTES {
            return Err(ArchiveError::LimitExceeded("uncompressed bytes"));
        }
        let media_type_ok = if is_json_index {
            entry.media_type == CANONICAL_JSON_MEDIA_TYPE
        } else {
            is_syntactically_valid_media_type(&entry.media_type)
        };
        if !media_type_ok
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
    let mut canonical_names = BTreeSet::new();
    for name in zip_names {
        validate_path(name)?;
        let canonical: String = name.nfc().collect::<String>().to_ascii_lowercase();
        if !actual.insert(name) || !canonical_names.insert(canonical) {
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
        // A fixed canonical path (e.g. "context/context.json") is case-exact
        // by construction — a spelling variant is simply not canonical.
        // Case/Unicode-normalization collisions matter for the
        // caller-generated ids inside "documents/files/<id>" and
        // "generated/files/<id>.md".
        let mut m = valid();
        m.entries.push(ArchiveEntry {
            path: "context/CONTEXT.json".into(),
            ..m.entries[0].clone()
        });
        assert!(matches!(
            validate_manifest(&m),
            Err(ArchiveError::InvalidPath(_))
        ));

        let mut m = valid();
        m.entries.push(ArchiveEntry {
            path: "documents/files/doc-1".into(),
            media_type: "application/pdf".into(),
            bytes: 2,
            sha256: "b".repeat(64),
        });
        m.entries.push(ArchiveEntry {
            path: "documents/files/DOC-1".into(),
            media_type: "application/pdf".into(),
            bytes: 2,
            sha256: "b".repeat(64),
        });
        assert!(matches!(
            validate_manifest(&m),
            Err(ArchiveError::DuplicatePath(_))
        ));

        // NFC vs. NFD forms of an accented character must also collide.
        let mut m = valid();
        m.entries.push(ArchiveEntry {
            path: "documents/files/caf\u{e9}".into(), // "café", precomposed (NFC)
            media_type: "application/pdf".into(),
            bytes: 2,
            sha256: "b".repeat(64),
        });
        m.entries.push(ArchiveEntry {
            path: "documents/files/cafe\u{301}".into(), // "café", decomposed (NFD)
            media_type: "application/pdf".into(),
            bytes: 2,
            sha256: "b".repeat(64),
        });
        assert!(matches!(
            validate_manifest(&m),
            Err(ArchiveError::DuplicatePath(_))
        ));
    }

    #[test]
    fn rejects_non_canonical_paths_and_bad_media_types() {
        let mut m = valid();
        m.entries[0].path = "extra/not-a-real-payload.json".into();
        assert!(matches!(
            validate_manifest(&m),
            Err(ArchiveError::InvalidPath(_))
        ));

        let mut m = valid();
        m.entries[0].media_type = "text/plain".into();
        assert!(validate_manifest(&m).is_err());

        let mut m = valid();
        m.created_at = "2026-09-09 20:15:00".into(); // missing T/Z
        assert!(validate_manifest(&m).is_err());
        m.created_at = "2026-13-09T20:15:00Z".into(); // month 13
        assert!(validate_manifest(&m).is_err());
        m.created_at = "2026-09-09T20:15:00.123Z".into(); // fractional seconds OK
        assert!(validate_manifest(&m).is_ok());
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
    fn format_utc_timestamp_matches_known_instants_and_validates() {
        assert_eq!(format_utc_timestamp(0), "1970-01-01T00:00:00.000Z");
        // A leap-day instant, to exercise the civil-calendar math's Feb 29
        // (verified against `date -u -d @1709251199`).
        assert_eq!(
            format_utc_timestamp(1_709_251_199_000),
            "2024-02-29T23:59:59.000Z"
        );
        for unix_ms in [0u64, 1_000, 1_757_448_900_123, 1_709_251_199_000] {
            let formatted = format_utc_timestamp(unix_ms);
            assert!(
                is_plausible_utc_timestamp(&formatted),
                "{formatted} (from {unix_ms}) should be a plausible UTC timestamp"
            );
        }
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

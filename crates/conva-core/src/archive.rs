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
use std::io::{Cursor, Read, Write};

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use unicode_normalization::UnicodeNormalization;

use crate::archive_conversation::PortableConversationV1;
use crate::archive_payload::{PortableContextV1, PortableDocumentV1, PortableGeneratedArtifactV1};
use crate::error::CoreError;
use crate::ipc::{
    ArchiveCompatibilityWarning, ArchiveContextPreview, ArchiveConversationPreview,
    ArchiveDocumentPreview, ArchiveInspection,
};

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

// ── ZIP container I/O (Checkpoint E) ────────────────────────────────────
//
// Moved here from `src-tauri/src/archive.rs` (Checkpoints B/C/D): these two
// functions are the entire ZIP reader/writer, and neither one touches the
// filesystem — they operate on an in-memory byte buffer in, byte buffer out.
// That was already true when they lived in `src-tauri`; putting them here
// instead means the desktop adapter (which reads/writes a real file, then
// calls through to these) and the wasm32 web adapter (`conva-core-wasm`,
// which reads/writes a browser `File`/`Blob`, then calls through to these
// too) share the literal same ZIP implementation — not a parallel "web
// dialect" of it (spec §9). `src-tauri/src/archive.rs` still owns: the
// atomic temp-file-then-rename dance, native dialogs, `RagStore` document
// staging/rollback, and the local import-provenance ledger — none of that
// is portable to a browser and none of it belongs here.

/// One archive entry to write: its declared canonical path and exact bytes.
/// `manifest.json` itself is always written first and separately — callers
/// pass every *other* entry here, already in the same order the manifest
/// declares them.
pub type PendingEntry = (String, Vec<u8>);

/// Build a complete `.cva` ZIP in memory: `manifest.json` (from `manifest`)
/// plus every entry in `entries`, Deflate-compressed. Pure — the caller
/// decides what to do with the returned bytes (write to a temp file and
/// rename over the destination on desktop; hand to the browser as a `Blob`
/// download on web).
pub fn build_archive_bytes(
    manifest: &ArchiveManifest,
    entries: &[PendingEntry],
) -> Result<Vec<u8>, CoreError> {
    let manifest_json =
        serde_json::to_vec_pretty(manifest).map_err(|e| CoreError::Archive(e.to_string()))?;
    let buf = Cursor::new(Vec::new());
    let mut zip = zip::ZipWriter::new(buf);
    let opts = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);

    zip.start_file("manifest.json", opts)
        .map_err(|e| CoreError::Archive(e.to_string()))?;
    zip.write_all(&manifest_json)
        .map_err(|e| CoreError::Archive(e.to_string()))?;

    for (path, bytes) in entries {
        zip.start_file(path, opts)
            .map_err(|e| CoreError::Archive(e.to_string()))?;
        zip.write_all(bytes)
            .map_err(|e| CoreError::Archive(e.to_string()))?;
    }
    let cursor = zip
        .finish()
        .map_err(|e| CoreError::Archive(e.to_string()))?;
    Ok(cursor.into_inner())
}

/// A validated, fully-loaded `.cva` held in memory: the parsed manifest, the
/// whole-archive SHA-256 digest, and every declared payload's bytes, keyed
/// by its canonical path. Side-effect-free by construction — building one
/// never writes anything.
#[derive(Debug)]
pub struct LoadedArchive {
    pub manifest: ArchiveManifest,
    pub archive_digest: String,
    pub payloads: BTreeMap<String, Vec<u8>>,
}

impl LoadedArchive {
    /// Decode one declared JSON payload, if present. `Ok(None)` means the
    /// archive simply doesn't declare that path (e.g. no `conversation/
    /// conversation.json` in a Context-only export) — not an error.
    pub fn json<T: DeserializeOwned>(&self, path: &str) -> Result<Option<T>, CoreError> {
        match self.payloads.get(path) {
            Some(bytes) => Ok(Some(
                serde_json::from_slice(bytes).map_err(|e| CoreError::Archive(e.to_string()))?,
            )),
            None => Ok(None),
        }
    }
}

/// Open, validate, and fully load a `.cva` from `bytes` — the one place
/// every required-rejection check from spec §6.2 is enforced before any
/// content is trusted. Side-effect-free: never writes anything, never
/// touches a Context/conversation/RAG store. `bytes` is the archive's
/// complete raw content — the desktop adapter reads it from a file, the web
/// adapter reads it from a `File`/`Blob` already in browser memory (spec
/// §9's "avoid buffering the entire uncompressed archive in React memory"
/// is about the *validated/decoded* content, not the still-compressed
/// upload itself, which the browser already held for the file picker).
pub fn load_archive_bytes(bytes: &[u8]) -> Result<LoadedArchive, CoreError> {
    if bytes.len() as u64 > MAX_ARCHIVE_BYTES {
        return Err(CoreError::Archive(
            "archive exceeds the file size limit".into(),
        ));
    }
    let archive_digest = Sha256::digest(bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect::<String>();

    let mut zip = zip::ZipArchive::new(Cursor::new(bytes))
        .map_err(|e| CoreError::Archive(format!("not a valid ZIP: {e}")))?;
    if zip.len() > MAX_ENTRIES + 1 {
        return Err(CoreError::Archive(
            "archive exceeds the entry count limit".into(),
        ));
    }

    let names: Vec<String> = (0..zip.len())
        .filter_map(|i| zip.name_for_index(i).map(str::to_string))
        .collect();

    let manifest_bytes = {
        let mut entry = zip
            .by_name("manifest.json")
            .map_err(|_| CoreError::Archive("missing manifest.json".into()))?;
        if entry.is_dir() {
            return Err(CoreError::Archive(
                "manifest.json is not a regular entry".into(),
            ));
        }
        let mut buf = Vec::new();
        entry
            .read_to_end(&mut buf)
            .map_err(|e| CoreError::Archive(e.to_string()))?;
        buf
    };
    let manifest: ArchiveManifest = serde_json::from_slice(&manifest_bytes)
        .map_err(|e| CoreError::Archive(format!("invalid manifest.json: {e}")))?;
    validate_manifest(&manifest)?;
    if !is_supported_format_version(manifest.format_version) {
        return Err(CoreError::Archive("unsupported .cva format version".into()));
    }
    validate_payload_names(&manifest, names.iter().map(String::as_str))?;

    let mut payloads = BTreeMap::new();
    let mut total = 0u64;
    for declared in &manifest.entries {
        let mut entry = zip.by_name(&declared.path).map_err(|_| {
            CoreError::Archive(format!("missing declared entry '{}'", declared.path))
        })?;
        if entry.is_dir() {
            return Err(CoreError::Archive(format!(
                "'{}' is not a regular file entry",
                declared.path
            )));
        }
        // Reject symlinks/devices via the stored Unix mode when present
        // (spec §6.2: "symlink, hard-link, device, or other non-regular
        // entry"). Archives written on platforms without Unix permission
        // bits (Windows, and a browser-built archive) carry no such bit, so
        // absence is not itself a rejection — only an explicit non-regular
        // mode is.
        if let Some(mode) = entry.unix_mode() {
            const S_IFMT: u32 = 0o170000;
            const S_IFREG: u32 = 0o100000;
            if mode & S_IFMT != 0 && mode & S_IFMT != S_IFREG {
                return Err(CoreError::Archive(format!(
                    "'{}' is not a regular file",
                    declared.path
                )));
            }
        }
        let compressed = entry.compressed_size();
        let uncompressed = entry.size();
        if uncompressed != declared.bytes {
            return Err(CoreError::Archive(format!(
                "'{}' length does not match the manifest",
                declared.path
            )));
        }
        if uncompressed > MAX_ENTRY_BYTES {
            return Err(CoreError::Archive(
                "archive entry exceeds the size limit".into(),
            ));
        }
        if compressed > 0 && uncompressed / compressed.max(1) > MAX_COMPRESSION_RATIO {
            return Err(CoreError::Archive(
                "archive entry exceeds the compression ratio limit".into(),
            ));
        }
        total = total
            .checked_add(uncompressed)
            .filter(|t| *t <= MAX_UNCOMPRESSED_BYTES)
            .ok_or_else(|| {
                CoreError::Archive("archive exceeds the uncompressed size limit".into())
            })?;

        let mut buf = Vec::with_capacity(uncompressed as usize);
        entry
            .read_to_end(&mut buf)
            .map_err(|e| CoreError::Archive(e.to_string()))?;
        let digest = Sha256::digest(&buf)
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect::<String>();
        if digest != declared.sha256 {
            return Err(CoreError::Archive(format!(
                "'{}' does not match its declared checksum",
                declared.path
            )));
        }
        payloads.insert(declared.path.clone(), buf);
    }
    let _ = total;

    Ok(LoadedArchive {
        manifest,
        archive_digest,
        payloads,
    })
}

fn context_preview(
    context: &PortableContextV1,
    has_source_documents: bool,
) -> ArchiveContextPreview {
    ArchiveContextPreview {
        title: context.title.clone(),
        category: context.category,
        key_terms_count: context.key_terms.len() as u32,
        prepared_qa_count: 0, // Q&A lives in generated text, not a countable field here.
        has_source_documents,
    }
}

fn conversation_preview(conversation: &PortableConversationV1) -> ArchiveConversationPreview {
    let mut speakers = std::collections::HashSet::new();
    let mut start = u64::MAX;
    let mut end = 0u64;
    for seg in &conversation.segments {
        speakers.insert(seg.side);
        start = start.min(seg.start_ms);
        end = end.max(seg.end_ms);
    }
    ArchiveConversationPreview {
        title: conversation.title.clone(),
        created_at_unix_ms: conversation.created_at_unix_ms,
        segment_count: conversation.segments.len() as u32,
        speaker_count: speakers.len() as u32,
        duration_ms: end.saturating_sub(if start == u64::MAX { 0 } else { start }),
        has_claim_review: conversation
            .claim_snapshots
            .iter()
            .any(|s| !s.claims.is_empty()),
    }
}

/// Side-effect-free preview (spec §8.3/Checkpoint C) of an already-loaded
/// archive. `previously_imported_digests` is this installation's local
/// import ledger — pass an empty set when there isn't one (the web adapter
/// has no local ledger yet; see the Checkpoint E handoff note).
pub fn inspect_loaded(
    loaded: &LoadedArchive,
    previously_imported_digests: &BTreeSet<String>,
) -> Result<ArchiveInspection, CoreError> {
    let context: Option<PortableContextV1> = loaded.json("context/context.json")?;
    let conversation: Option<PortableConversationV1> =
        loaded.json("conversation/conversation.json")?;
    let documents: Vec<PortableDocumentV1> =
        loaded.json("documents/index.json")?.unwrap_or_default();
    let artifacts: Vec<PortableGeneratedArtifactV1> =
        loaded.json("generated/index.json")?.unwrap_or_default();
    if let Some(context) = &context {
        crate::archive_payload::validate_document_index(context, &documents, &artifacts)?;
    }

    let artifact_doc_ids: BTreeSet<&str> =
        artifacts.iter().map(|a| a.document_id.as_str()).collect();
    let has_source_documents = documents
        .iter()
        .any(|d| d.archive_path.is_some() && !artifact_doc_ids.contains(d.id.as_str()));

    let mut warnings = Vec::new();
    if previously_imported_digests.contains(&loaded.archive_digest) {
        warnings.push(ArchiveCompatibilityWarning::DuplicateArchiveDigest);
    }
    if loaded.manifest.format_version != FORMAT_VERSION {
        warnings.push(ArchiveCompatibilityWarning::MigratedFromOlderVersion {
            from_format_version: loaded.manifest.format_version,
        });
    }
    let document_previews: Vec<ArchiveDocumentPreview> = documents
        .iter()
        .map(|d| ArchiveDocumentPreview {
            portable_id: d.id.clone(),
            file_name: d.file_name.clone(),
            bytes: d.bytes,
            included: d.archive_path.is_some() || artifact_doc_ids.contains(d.id.as_str()),
        })
        .collect();

    Ok(ArchiveInspection {
        archive_digest: loaded.archive_digest.clone(),
        format_version: loaded.manifest.format_version,
        created_by_app_version: loaded.manifest.created_by.app_version.clone(),
        created_at: loaded.manifest.created_at.clone(),
        title: loaded.manifest.title.clone(),
        context: context.map(|c| context_preview(&c, has_source_documents)),
        conversation: conversation.as_ref().map(conversation_preview),
        documents: document_previews,
        warnings,
    })
}

/// Validate + preview a `.cva` from raw bytes in one call — the shape the
/// wasm32 web adapter (`conva-core-wasm`) uses directly. `previously_
/// imported_digests` is empty on web today (no local ledger yet).
pub fn inspect_bytes(
    bytes: &[u8],
    previously_imported_digests: &BTreeSet<String>,
) -> Result<ArchiveInspection, CoreError> {
    let loaded = load_archive_bytes(bytes)?;
    inspect_loaded(&loaded, previously_imported_digests)
}

// ── Context-scope import materials (Checkpoint E, import slice) ───────────

/// Everything a Context-scope import needs from an already-loaded archive:
/// the raw portable Context DTO (still carrying source-installation IDs,
/// unlike [`ArchiveContextPreview`]'s sanitized summary), per-document/
/// per-artifact metadata, and whether the archive also declares a
/// conversation. Document/artifact *bytes* deliberately stay out of this
/// struct — a caller fetches one entry's bytes at a time from
/// [`LoadedArchive::payloads`] (by the document's own `archive_path`, or the
/// artifact's) as it stages each one, rather than holding every document's
/// content in memory at once.
///
/// This function does not itself decide policy (e.g. "refuse a Context with
/// a research profile" or "refuse when a conversation is also present") —
/// that decision lives with the caller, same as how the export slice's own
/// scope/profile refusals live in `archiveExport.ts`, not in Rust. Desktop's
/// own Context-only `import_context` (`src-tauri/src/archive.rs`) has no
/// such restriction and does not use this helper; it is new, web-adapter-
/// facing code.
#[derive(Debug)]
pub struct ContextImportMaterials {
    pub archive_digest: String,
    pub context: PortableContextV1,
    pub documents: Vec<PortableDocumentV1>,
    pub artifacts: Vec<PortableGeneratedArtifactV1>,
    pub has_conversation: bool,
}

pub fn load_context_import_materials(
    loaded: &LoadedArchive,
) -> Result<ContextImportMaterials, CoreError> {
    let context: Option<PortableContextV1> = loaded.json("context/context.json")?;
    let Some(context) = context else {
        return Err(CoreError::Archive(
            "archive has no Context to import".into(),
        ));
    };
    let has_conversation = loaded
        .json::<PortableConversationV1>("conversation/conversation.json")?
        .is_some();
    let documents: Vec<PortableDocumentV1> =
        loaded.json("documents/index.json")?.unwrap_or_default();
    let artifacts: Vec<PortableGeneratedArtifactV1> =
        loaded.json("generated/index.json")?.unwrap_or_default();
    crate::archive_payload::validate_document_index(&context, &documents, &artifacts)?;
    Ok(ContextImportMaterials {
        archive_digest: loaded.archive_digest.clone(),
        context,
        documents,
        artifacts,
        has_conversation,
    })
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

    // ── ZIP container round trip (Checkpoint E) ─────────────────────────
    //
    // `build_archive_bytes`/`load_archive_bytes` used to be desktop-only
    // (`src-tauri/src/archive.rs`), exercised only by that crate's own
    // integration tests. Now that they're pure `conva-core` logic shared by
    // both the desktop adapter and the wasm32 web adapter, they get a
    // direct unit test here too — moving code to core without a core test
    // would be exactly the "untested shell code" this repo's CLAUDE.md asks
    // authors not to leave behind.

    fn entry(path: &str, bytes: &[u8]) -> ArchiveEntry {
        ArchiveEntry {
            path: path.to_string(),
            media_type: "application/json".into(),
            bytes: bytes.len() as u64,
            sha256: Sha256::digest(bytes)
                .iter()
                .map(|b| format!("{b:02x}"))
                .collect(),
        }
    }

    #[test]
    fn build_then_load_round_trips_every_declared_entry() {
        let context_json = br#"{"hello":"world"}"#;
        let manifest = ArchiveManifest {
            format: FORMAT.into(),
            format_version: FORMAT_VERSION,
            created_at: format_utc_timestamp(0),
            created_by: ArchiveCreator {
                app: "conva".into(),
                app_version: "0.4.0".into(),
            },
            title: "Round trip".into(),
            contents: ArchiveContents {
                context: true,
                conversation: false,
                documents: 0,
                generated_artifacts: 0,
            },
            entries: vec![entry("context/context.json", context_json)],
        };
        let bytes = build_archive_bytes(
            &manifest,
            &[("context/context.json".into(), context_json.to_vec())],
        )
        .unwrap();

        let loaded = load_archive_bytes(&bytes).unwrap();
        assert_eq!(loaded.manifest, manifest);
        assert_eq!(
            loaded.payloads.get("context/context.json").unwrap(),
            context_json
        );
        // The digest is deterministic and content-derived, not incidental.
        assert_eq!(
            loaded.archive_digest,
            Sha256::digest(&bytes)
                .iter()
                .map(|b| format!("{b:02x}"))
                .collect::<String>()
        );
        // Building the identical inputs again produces byte-identical
        // output — no embedded timestamps/nondeterminism in the writer.
        let bytes_again = build_archive_bytes(
            &manifest,
            &[("context/context.json".into(), context_json.to_vec())],
        )
        .unwrap();
        assert_eq!(bytes, bytes_again);
    }

    #[test]
    fn load_rejects_a_tampered_entry() {
        let context_json = br#"{"hello":"world"}"#;
        let manifest = ArchiveManifest {
            format: FORMAT.into(),
            format_version: FORMAT_VERSION,
            created_at: format_utc_timestamp(0),
            created_by: ArchiveCreator {
                app: "conva".into(),
                app_version: "0.4.0".into(),
            },
            title: "Tampered".into(),
            contents: ArchiveContents {
                context: true,
                conversation: false,
                documents: 0,
                generated_artifacts: 0,
            },
            entries: vec![entry("context/context.json", context_json)],
        };
        let mut bytes = build_archive_bytes(
            &manifest,
            &[("context/context.json".into(), context_json.to_vec())],
        )
        .unwrap();
        // Flip one byte well past the local file headers, inside the
        // compressed entry data itself.
        let flip_at = bytes.len() - 5;
        bytes[flip_at] ^= 0xFF;

        let err = load_archive_bytes(&bytes).unwrap_err();
        assert!(matches!(err, CoreError::Archive(_)));
    }

    #[test]
    fn load_rejects_an_oversized_archive() {
        let huge = vec![0u8; (MAX_ARCHIVE_BYTES + 1) as usize];
        let err = load_archive_bytes(&huge).unwrap_err();
        assert!(matches!(err, CoreError::Archive(msg) if msg.contains("file size limit")));
    }

    // ── load_context_import_materials (Checkpoint E, import slice) ────────

    fn minimal_context(id: &str) -> crate::context::ConversationContext {
        crate::context::ConversationContext {
            id: id.into(),
            title: "Case file".into(),
            purpose: "Test".into(),
            job_description: None,
            category: crate::context::ContextCategory::Other,
            participation_lens: None,
            source_policy: None,
            status: crate::context::ContextStatus::Draft,
            created_at_unix_ms: 1,
            updated_at_unix_ms: 2,
            source_doc_ids: vec![],
            slot_doc_ids: BTreeMap::new(),
            auto_generate_context: false,
            research_enabled: false,
            key_terms: vec![],
            glossary: vec![],
            glossary_definitions: BTreeMap::new(),
            knowledge_profile_id: None,
            personas: vec![],
            chosen_persona_id: None,
            conversation_id: None,
            dossier_doc_id: None,
            research_doc_id: None,
            deep_qa_enabled: false,
            qa_doc_id: None,
            resources_stale: false,
            resources_generated_at_unix_ms: None,
            suggestion_decisions: BTreeMap::new(),
        }
    }

    #[test]
    fn load_context_import_materials_extracts_context_documents_and_artifacts() {
        use crate::archive_payload::{
            build_context_archive, ArchivePayloadFile, AssembledContextDocuments,
            GeneratedArtifactKind, PortableDocumentV1, PortableGeneratedArtifactV1,
        };
        use crate::rag::DocSource;

        let mut context = minimal_context("ctx-old");
        context.source_doc_ids = vec!["doc-file".into()];
        context.dossier_doc_id = Some("doc-dossier".into());

        let bytes = build_context_archive(
            &context,
            None,
            AssembledContextDocuments {
                documents: vec![
                    PortableDocumentV1 {
                        id: "doc-file".into(),
                        file_name: "notes.txt".into(),
                        source: DocSource::File,
                        enabled: true,
                        searchable: true,
                        ingested_at_unix_ms: 3,
                        archive_path: Some("documents/files/doc-file".into()),
                        bytes: Some(5),
                        sha256: Some(sha256_hex_for_test(b"hello")),
                    },
                    PortableDocumentV1 {
                        id: "doc-dossier".into(),
                        file_name: "dossier.md".into(),
                        source: DocSource::Generated,
                        enabled: true,
                        searchable: false,
                        ingested_at_unix_ms: 4,
                        archive_path: None,
                        bytes: None,
                        sha256: None,
                    },
                ],
                artifacts: vec![PortableGeneratedArtifactV1 {
                    document_id: "doc-dossier".into(),
                    kind: GeneratedArtifactKind::Dossier,
                    archive_path: "generated/files/doc-dossier.md".into(),
                    created_at_unix_ms: 4,
                }],
                files: vec![
                    ArchivePayloadFile {
                        path: "documents/files/doc-file".into(),
                        media_type: "text/plain".into(),
                        bytes: b"hello".to_vec(),
                    },
                    ArchivePayloadFile {
                        path: "generated/files/doc-dossier.md".into(),
                        media_type: "text/markdown".into(),
                        bytes: b"# Dossier".to_vec(),
                    },
                ],
            },
            0,
            ArchiveCreator {
                app: "conva".into(),
                app_version: "0.4.0".into(),
            },
        )
        .unwrap();

        let loaded = load_archive_bytes(&bytes).unwrap();
        let materials = load_context_import_materials(&loaded).unwrap();
        assert_eq!(materials.context.id, "ctx-old");
        assert!(!materials.has_conversation);
        assert_eq!(materials.documents.len(), 2);
        assert_eq!(materials.artifacts.len(), 1);
        assert_eq!(
            loaded
                .payloads
                .get("documents/files/doc-file")
                .map(Vec::as_slice),
            Some(b"hello".as_slice())
        );
        assert_eq!(
            loaded
                .payloads
                .get("generated/files/doc-dossier.md")
                .map(Vec::as_slice),
            Some(b"# Dossier".as_slice())
        );
    }

    /// Test-only helper — production code never hand-computes a digest to
    /// declare in a manifest entry it also controls the bytes for; real
    /// callers (`build_context_archive`) do this internally.
    pub(crate) fn sha256_hex_for_test(bytes: &[u8]) -> String {
        Sha256::digest(bytes)
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect()
    }

    #[test]
    fn load_context_import_materials_rejects_a_conversation_only_archive() {
        // A valid manifest needs at least one of context/conversation
        // (`validate_manifest`) — so "no Context to import" is reachable
        // only via a conversation-ONLY archive, not an empty one.
        let conversation_json = serde_json::to_vec(&serde_json::json!({
            "id": "conv-old",
            "title": "Call",
            "created_at_unix_ms": 1,
            "updated_at_unix_ms": 2,
            "segments": [],
        }))
        .unwrap();
        let manifest = ArchiveManifest {
            format: FORMAT.into(),
            format_version: FORMAT_VERSION,
            created_at: format_utc_timestamp(0),
            created_by: ArchiveCreator {
                app: "conva".into(),
                app_version: "0.4.0".into(),
            },
            title: "No Context".into(),
            contents: ArchiveContents {
                context: false,
                conversation: true,
                documents: 0,
                generated_artifacts: 0,
            },
            entries: vec![entry("conversation/conversation.json", &conversation_json)],
        };
        let bytes = build_archive_bytes(
            &manifest,
            &[("conversation/conversation.json".into(), conversation_json)],
        )
        .unwrap();
        let loaded = load_archive_bytes(&bytes).unwrap();
        let err = load_context_import_materials(&loaded).unwrap_err();
        assert!(matches!(err, CoreError::Archive(msg) if msg.contains("no Context")));
    }

    #[test]
    fn load_context_import_materials_reports_has_conversation_when_present() {
        let context_json = serde_json::to_vec(&minimal_portable_context("ctx-old")).unwrap();
        let conversation_json = serde_json::to_vec(&serde_json::json!({
            "id": "conv-old",
            "title": "Call",
            "created_at_unix_ms": 1,
            "updated_at_unix_ms": 2,
            "segments": [],
        }))
        .unwrap();
        let manifest = ArchiveManifest {
            format: FORMAT.into(),
            format_version: FORMAT_VERSION,
            created_at: format_utc_timestamp(0),
            created_by: ArchiveCreator {
                app: "conva".into(),
                app_version: "0.4.0".into(),
            },
            title: "Both".into(),
            contents: ArchiveContents {
                context: true,
                conversation: true,
                documents: 0,
                generated_artifacts: 0,
            },
            entries: vec![
                entry("context/context.json", &context_json),
                entry("conversation/conversation.json", &conversation_json),
            ],
        };
        let bytes = build_archive_bytes(
            &manifest,
            &[
                ("context/context.json".into(), context_json),
                ("conversation/conversation.json".into(), conversation_json),
            ],
        )
        .unwrap();
        let loaded = load_archive_bytes(&bytes).unwrap();
        let materials = load_context_import_materials(&loaded).unwrap();
        assert!(materials.has_conversation);
    }

    fn minimal_portable_context(id: &str) -> PortableContextV1 {
        PortableContextV1 {
            id: id.into(),
            title: "Case file".into(),
            purpose: "Test".into(),
            job_description: None,
            category: crate::context::ContextCategory::Other,
            participation_lens: None,
            source_policy: None,
            created_at_unix_ms: 1,
            updated_at_unix_ms: 2,
            source_doc_ids: vec![],
            slot_doc_ids: BTreeMap::new(),
            auto_generate_context: false,
            research_enabled: false,
            deep_qa_enabled: false,
            key_terms: vec![],
            glossary: vec![],
            glossary_definitions: BTreeMap::new(),
            knowledge_profile: None,
            personas: vec![],
            chosen_persona_id: None,
            conversation_id: None,
            dossier_doc_id: None,
            research_doc_id: None,
            qa_doc_id: None,
            resources_stale: false,
            resources_generated_at_unix_ms: None,
            suggestion_decisions: BTreeMap::new(),
        }
    }
}

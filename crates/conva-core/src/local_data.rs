//! What the app keeps on this computer, and what "Erase everything on this
//! computer" removes (Settings → Privacy → Your data on this computer).
//!
//! Pure: no filesystem here. The shell (`src-tauri/src/local_data.rs`) walks
//! the app-data directory and applies [`ERASE_PATHS`]; this module owns the
//! decisions that must stay testable on any OS and must never drift: which
//! paths an erase may touch, what it must keep, which file names count as a
//! call recording, and how long a recording is.

/// Where the shell writes call recordings, relative to the app-data dir.
pub const RECORDINGS_DIR: &str = "recordings";

/// Paths under the app-data dir that "Erase everything on this computer"
/// removes, relative and forward-slashed. Directories go with their contents.
/// This is the whole list: anything not named here is untouched.
pub const ERASE_PATHS: &[&str] = &[
    "recordings",
    "sessions",
    "conversations",
    "simcon",
    "rag",
    "usage.json",
    "usage_events.jsonl",
    "perf.jsonl",
    "highlight_feedback.json",
    "archive-imports.json",
    // Only the queued events; `state.json` (device id, sequence counter, the
    // beta lock) and `cursor.json` stay so the queue continues cleanly.
    "telemetry/events.jsonl",
];

/// Paths an erase must never touch. Downloaded speech and embedding models
/// are not personal and cost minutes to fetch again.
pub const KEPT_PATHS: &[&str] = &["models"];

/// A call recording file name: `call-<epoch ms>.wav`. Anything else (path
/// separators, dots, other extensions) is refused, so a recording id coming
/// from the UI can never name a file outside the recordings folder.
pub fn recording_id_valid(name: &str) -> bool {
    recording_started_ms(name).is_some()
}

/// The epoch-ms start time encoded in a recording file name.
pub fn recording_started_ms(name: &str) -> Option<u64> {
    let digits = name.strip_prefix("call-")?.strip_suffix(".wav")?;
    if digits.is_empty() || digits.len() > 16 || !digits.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    digits.parse().ok()
}

/// Length of a PCM WAV from its header and total file size, in milliseconds.
/// `header` needs at least the first 44 bytes (the canonical RIFF/fmt/data
/// layout the recorder writes). `None` when it is not a plain PCM WAV.
pub fn wav_duration_ms(header: &[u8], file_len: u64) -> Option<u64> {
    if header.len() < 44 || &header[0..4] != b"RIFF" || &header[8..12] != b"WAVE" {
        return None;
    }
    let channels = u16::from_le_bytes([header[22], header[23]]) as u64;
    let rate = u32::from_le_bytes([header[24], header[25], header[26], header[27]]) as u64;
    let bits = u16::from_le_bytes([header[34], header[35]]) as u64;
    if channels == 0 || rate == 0 || bits == 0 || bits & 7 != 0 {
        return None;
    }
    let bytes_per_frame = channels * (bits / 8);
    let data_bytes = file_len.saturating_sub(44);
    Some(data_bytes / bytes_per_frame * 1000 / rate)
}

/// Is `rel` a path an erase is allowed to remove? True only for the listed
/// paths (or something inside a listed directory), and never for a kept path
/// or anything that could climb out of the app-data directory.
pub fn erase_allows(rel: &str) -> bool {
    if rel.is_empty()
        || rel.starts_with('/')
        || rel.starts_with('\\')
        || rel.contains(':')
        || rel.split(['/', '\\']).any(|p| p == ".." || p == ".")
    {
        return false;
    }
    let within = |root: &str| rel == root || rel.starts_with(&format!("{root}/"));
    if KEPT_PATHS.iter().any(|k| within(k)) {
        return false;
    }
    ERASE_PATHS.iter().any(|e| within(e))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn wav_header(channels: u16, rate: u32, bits: u16) -> Vec<u8> {
        let mut h = vec![0u8; 44];
        h[0..4].copy_from_slice(b"RIFF");
        h[8..12].copy_from_slice(b"WAVE");
        h[22..24].copy_from_slice(&channels.to_le_bytes());
        h[24..28].copy_from_slice(&rate.to_le_bytes());
        h[34..36].copy_from_slice(&bits.to_le_bytes());
        h
    }

    #[test]
    fn recording_ids_are_call_dash_digits_wav_and_nothing_else() {
        assert!(recording_id_valid("call-1760000000000.wav"));
        assert_eq!(
            recording_started_ms("call-1760000000000.wav"),
            Some(1_760_000_000_000)
        );
        for bad in [
            "",
            "call-.wav",
            "call-12.wav.exe",
            "call-12.mp3",
            "../call-12.wav",
            "call-../x.wav",
            "call-12/../../x.wav",
            "sub\\call-12.wav",
            "call-1a.wav",
            "CALL-12.wav",
            " call-12.wav",
            "call-99999999999999999.wav",
        ] {
            assert!(!recording_id_valid(bad), "must refuse {bad:?}");
        }
    }

    #[test]
    fn wav_duration_matches_the_recorders_stereo_16khz_16bit_format() {
        // 10 s of 16 kHz stereo 16-bit = 10 * 16000 * 2 * 2 bytes of data.
        let h = wav_header(2, 16_000, 16);
        assert_eq!(wav_duration_ms(&h, 44 + 640_000), Some(10_000));
        assert_eq!(wav_duration_ms(&h, 44), Some(0));
        assert_eq!(
            wav_duration_ms(&h, 10),
            Some(0),
            "a short file never underflows"
        );
    }

    #[test]
    fn wav_duration_refuses_what_is_not_a_plain_pcm_wav() {
        assert_eq!(wav_duration_ms(&[0u8; 10], 1000), None);
        assert_eq!(wav_duration_ms(&[0u8; 44], 1000), None, "no RIFF marker");
        assert_eq!(wav_duration_ms(&wav_header(0, 16_000, 16), 1000), None);
        assert_eq!(wav_duration_ms(&wav_header(2, 0, 16), 1000), None);
        assert_eq!(wav_duration_ms(&wav_header(2, 16_000, 12), 1000), None);
    }

    #[test]
    fn the_erase_plan_never_includes_models_and_stays_inside_app_data() {
        for p in ERASE_PATHS {
            assert!(erase_allows(p), "{p} is in the plan so it must be allowed");
            assert!(
                !p.starts_with('/') && !p.contains("..") && !p.contains('\\'),
                "{p}"
            );
            assert!(
                !KEPT_PATHS
                    .iter()
                    .any(|k| p == k || p.starts_with(&format!("{k}/"))),
                "{p} hits a kept path"
            );
        }
        assert!(KEPT_PATHS.contains(&"models"));
    }

    #[test]
    fn erase_allows_only_listed_paths_and_what_is_inside_listed_directories() {
        assert!(erase_allows("recordings"));
        assert!(erase_allows("recordings/call-1.wav"));
        assert!(erase_allows("rag/originals/doc-1.pdf"));
        assert!(erase_allows("telemetry/events.jsonl"));
        // Kept or unlisted.
        assert!(!erase_allows("models"));
        assert!(!erase_allows("models/ggml-tiny.bin"));
        assert!(
            !erase_allows("telemetry"),
            "only the queue file, not the whole directory"
        );
        assert!(!erase_allows("telemetry/state.json"));
        assert!(!erase_allows("config.json"));
        assert!(
            !erase_allows("recordings-old"),
            "a prefix is not a directory match"
        );
        // Escapes.
        for bad in [
            "",
            "/",
            "/etc",
            "..",
            "../x",
            "recordings/../x",
            "recordings/./x",
            "C:/x",
            "recordings\\..\\x",
        ] {
            assert!(!erase_allows(bad), "must refuse {bad:?}");
        }
    }
}

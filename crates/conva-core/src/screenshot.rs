//! Screenshot filename formatting (Screenshot button v1). Pure — the actual
//! capture (`html2canvas` in the webview) and file write
//! (`src-tauri/src/lib.rs`'s `save_screenshot` command) are shell-side; this
//! is the one piece of that feature with no GUI/OS dependency, so it lives
//! here with a real unit test rather than going untested in the shell.

/// Formats a Unix-millisecond timestamp as
/// `conva-screenshot-YYYY-MM-DD_HH-MM-SS.png` (UTC) — sortable, and safe on
/// every target filesystem including Windows (which rejects `:` in
/// filenames, hence `HH-MM-SS` rather than `HH:MM:SS`).
///
/// No date crate: this codebase has never needed one elsewhere, and UTC
/// calendar conversion from a day count is a small, well-known,
/// dependency-free algorithm (Howard Hinnant's `civil_from_days`).
pub fn screenshot_filename(unix_ms: u64) -> String {
    let total_secs = unix_ms / 1000;
    let days = (total_secs / 86_400) as i64;
    let secs_of_day = total_secs % 86_400;
    let (y, m, d) = civil_from_days(days);
    let (hh, mm, ss) = (
        secs_of_day / 3600,
        (secs_of_day % 3600) / 60,
        secs_of_day % 60,
    );
    format!("conva-screenshot-{y:04}-{m:02}-{d:02}_{hh:02}-{mm:02}-{ss:02}.png")
}

/// Days since the Unix epoch (1970-01-01) -> (year, month, day), UTC
/// proleptic Gregorian calendar. Howard Hinnant's `civil_from_days`
/// (http://howardhinnant.github.io/date_algorithms.html) — correct for
/// every day representable by `i64`, including leap years and the
/// Dec 31/Jan 1 boundary.
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64; // [0, 146096]
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365; // [0, 399]
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100); // [0, 365]
    let mp = (5 * doy + 2) / 153; // [0, 11]
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32; // [1, 31]
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32; // [1, 12]
    let y = if m <= 2 { y + 1 } else { y };
    (y, m, d)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn epoch_zero_is_the_unix_epoch() {
        assert_eq!(
            screenshot_filename(0),
            "conva-screenshot-1970-01-01_00-00-00.png"
        );
    }

    #[test]
    fn matches_known_dates_at_year_and_leap_day_boundaries() {
        // Plain round date.
        assert_eq!(
            screenshot_filename(946_684_800_000),
            "conva-screenshot-2000-01-01_00-00-00.png"
        );
        // Leap day, and the day right after it (leap year rolls over
        // correctly into March, not a 29th that doesn't exist).
        assert_eq!(
            screenshot_filename(1_709_164_800_000),
            "conva-screenshot-2024-02-29_00-00-00.png"
        );
        assert_eq!(
            screenshot_filename(1_709_251_200_000),
            "conva-screenshot-2024-03-01_00-00-00.png"
        );
        // Year boundary, both sides, with a non-zero time-of-day.
        assert_eq!(
            screenshot_filename(1_735_689_599_000),
            "conva-screenshot-2024-12-31_23-59-59.png"
        );
        assert_eq!(
            screenshot_filename(1_735_689_600_000),
            "conva-screenshot-2025-01-01_00-00-00.png"
        );
    }

    #[test]
    fn sub_second_milliseconds_are_truncated_not_rounded() {
        // 999ms past the epoch is still second 0 of 1970-01-01.
        assert_eq!(
            screenshot_filename(999),
            "conva-screenshot-1970-01-01_00-00-00.png"
        );
    }
}

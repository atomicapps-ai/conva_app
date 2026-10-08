//! Exact decimal numbers for spreadsheet arithmetic.
//!
//! Totals shown to a user mid-call must be exact and reproducible, so nothing
//! in the table pipeline touches `f32`/`f64`. A [`Decimal`] is a scaled
//! integer (`units / 10^scale`) held in an `i128`; addition, comparison and
//! division-by-count are all integer operations. Parsing is deliberately
//! conservative: anything that could be read two ways, or that is not plainly
//! a number, is reported as [`NumberError::Malformed`] rather than guessed.

use std::cmp::Ordering;
use std::fmt;

use serde::{Deserialize, Deserializer, Serialize, Serializer};

/// Most fractional digits accepted from a source cell.
pub const MAX_SCALE: u8 = 12;
/// Most significant digits accepted from a source cell.
pub const MAX_DIGITS: usize = 30;

/// An exact base-10 number: `units / 10^scale`.
#[derive(Debug, Clone, Copy)]
pub struct Decimal {
    pub units: i128,
    pub scale: u8,
}

impl PartialEq for Decimal {
    fn eq(&self, other: &Self) -> bool {
        self.cmp(other) == Ordering::Equal
    }
}
impl Eq for Decimal {}

impl PartialOrd for Decimal {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for Decimal {
    fn cmp(&self, other: &Self) -> Ordering {
        let scale = self.scale.max(other.scale);
        match (self.rescaled(scale), other.rescaled(scale)) {
            (Some(a), Some(b)) => a.cmp(&b),
            // Only reachable near i128 limits; fall back to sign, then scale.
            _ => self.units.signum().cmp(&other.units.signum()),
        }
    }
}

/// Wire form is the plain decimal string (`"1234.50"`): exact, and safe for
/// JavaScript, which cannot hold an `i128`.
impl Serialize for Decimal {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_plain_string())
    }
}

impl<'de> Deserialize<'de> for Decimal {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let s = String::deserialize(deserializer)?;
        Decimal::from_plain(&s).ok_or_else(|| serde::de::Error::custom("invalid decimal"))
    }
}

fn pow10(exp: u8) -> Option<i128> {
    10i128.checked_pow(u32::from(exp))
}

impl Decimal {
    pub const ZERO: Decimal = Decimal { units: 0, scale: 0 };

    pub fn new(units: i128, scale: u8) -> Self {
        Self { units, scale }
    }

    pub fn from_int(n: i64) -> Self {
        Self::new(i128::from(n), 0)
    }

    /// Parse the plain form produced by [`Decimal::to_plain_string`].
    pub fn from_plain(s: &str) -> Option<Decimal> {
        let (neg, body) = match s.strip_prefix('-') {
            Some(r) => (true, r),
            None => (false, s),
        };
        let (int_part, frac_part) = body.split_once('.').unwrap_or((body, ""));
        if !all_digits(int_part) || (!frac_part.is_empty() && !all_digits(frac_part)) {
            return None;
        }
        if int_part.len() + frac_part.len() > MAX_DIGITS || frac_part.len() > usize::from(MAX_SCALE)
        {
            return None;
        }
        let units: i128 = format!("{int_part}{frac_part}").parse().ok()?;
        Some(Decimal::new(
            if neg { -units } else { units },
            frac_part.len() as u8,
        ))
    }

    fn rescaled(&self, scale: u8) -> Option<i128> {
        debug_assert!(scale >= self.scale);
        self.units.checked_mul(pow10(scale - self.scale)?)
    }

    /// Exact sum, or `None` on `i128` overflow.
    pub fn checked_add(&self, other: &Decimal) -> Option<Decimal> {
        let scale = self.scale.max(other.scale);
        let sum = self.rescaled(scale)?.checked_add(other.rescaled(scale)?)?;
        Some(Decimal::new(sum, scale))
    }

    /// `self / count`, rounded half away from zero to `scale` fractional
    /// digits. Used for averages; the divisor is always a row count.
    pub fn div_count(&self, count: u64, scale: u8) -> Option<Decimal> {
        if count == 0 {
            return None;
        }
        let scale = scale.max(self.scale);
        let numerator = self.rescaled(scale)?;
        let n = i128::from(count);
        let quotient = numerator / n;
        let remainder = numerator % n;
        let twice = remainder.abs().checked_mul(2)?;
        let bump = if twice >= n { numerator.signum() } else { 0 };
        Some(Decimal::new(quotient + bump, scale))
    }

    pub fn is_negative(&self) -> bool {
        self.units < 0
    }

    /// Plain, machine-readable form: optional `-`, digits, optional `.digits`.
    /// Keeps the value's own scale (`12.50` stays `12.50`).
    pub fn to_plain_string(&self) -> String {
        let neg = self.units < 0;
        let digits = self.units.unsigned_abs().to_string();
        let scale = usize::from(self.scale);
        let body = if scale == 0 {
            digits
        } else {
            let padded = format!("{digits:0>width$}", width = scale + 1);
            let split = padded.len() - scale;
            format!("{}.{}", &padded[..split], &padded[split..])
        };
        if neg {
            format!("-{body}")
        } else {
            body
        }
    }

    /// Human form with thousands separators and at least `min_scale`
    /// fractional digits (never fewer digits than the value carries).
    pub fn to_grouped_string(&self, min_scale: u8) -> String {
        let value = if min_scale > self.scale {
            match self.rescaled(min_scale) {
                Some(units) => Decimal::new(units, min_scale),
                None => *self,
            }
        } else {
            *self
        };
        let plain = value.to_plain_string();
        let (sign, rest) = match plain.strip_prefix('-') {
            Some(r) => ("-", r),
            None => ("", plain.as_str()),
        };
        let (int_part, frac) = match rest.split_once('.') {
            Some((i, f)) => (i, Some(f)),
            None => (rest, None),
        };
        let mut grouped = String::new();
        for (i, ch) in int_part.chars().enumerate() {
            if i > 0 && (int_part.len() - i) % 3 == 0 {
                grouped.push(',');
            }
            grouped.push(ch);
        }
        match frac {
            Some(f) => format!("{sign}{grouped}.{f}"),
            None => format!("{sign}{grouped}"),
        }
    }
}

impl fmt::Display for Decimal {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.to_plain_string())
    }
}

/// Why a cell could not be read as a number.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NumberError {
    /// Nothing there (empty, whitespace, or a placeholder such as `N/A`).
    Blank,
    /// Text that is not plainly a single number.
    Malformed,
}

/// A number read from a cell, plus the decoration it carried.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedNumber {
    pub value: Decimal,
    /// Currency symbol or code seen with the number (`$`, `EUR`, ...).
    pub currency: Option<String>,
    pub percent: bool,
}

const CURRENCY_SYMBOLS: [char; 6] = ['$', '€', '£', '¥', '₹', '₩'];
const CURRENCY_CODES: [&str; 8] = ["USD", "EUR", "GBP", "JPY", "CAD", "AUD", "CHF", "INR"];
const BLANK_MARKERS: [&str; 8] = ["n/a", "na", "null", "none", "nil", "-", "--", "—"];

/// An ISO currency code at the start or end of `s`. `get` returns `None` at a
/// non-character boundary, so text such as "Joëlle" never panics here.
fn currency_code_at_edge(s: &str) -> Option<(&'static str, bool)> {
    if s.len() <= 3 {
        return None;
    }
    let head = s.get(..3);
    let tail = s.get(s.len() - 3..);
    CURRENCY_CODES.iter().find_map(|code| {
        if head.is_some_and(|h| h.eq_ignore_ascii_case(code)) {
            Some((*code, true))
        } else if tail.is_some_and(|t| t.eq_ignore_ascii_case(code)) {
            Some((*code, false))
        } else {
            None
        }
    })
}

/// True for empty cells and common "no value" placeholders.
pub fn is_blank_marker(raw: &str) -> bool {
    let t = raw.trim();
    t.is_empty() || BLANK_MARKERS.contains(&t.to_lowercase().as_str())
}

/// Parse one cell as an exact decimal.
///
/// Accepts an optional sign (`-`, `−`, parentheses, or a trailing `-`),
/// a currency symbol or ISO code on either side, a trailing `%`, and
/// thousands grouping. `1,234` is read as one thousand two hundred and
/// thirty-four; `12,5` as twelve and a half. Scientific notation and
/// anything with stray letters is [`NumberError::Malformed`].
pub fn parse_number(raw: &str) -> Result<ParsedNumber, NumberError> {
    if is_blank_marker(raw) {
        return Err(NumberError::Blank);
    }
    let mut s: String = raw
        .trim()
        .chars()
        .map(|c| {
            if c == '\u{a0}' || c == '\u{202f}' {
                ' '
            } else {
                c
            }
        })
        .collect();
    let mut negative = false;
    let mut currency: Option<String> = None;
    let mut percent = false;

    // Peel decoration from both ends until nothing changes.
    loop {
        let before = s.clone();
        s = s.trim().to_string();
        if s.starts_with('(') && s.ends_with(')') && s.len() >= 2 {
            negative = !negative;
            s = s[1..s.len() - 1].to_string();
        } else if let Some(rest) = s.strip_prefix(['-', '−']) {
            negative = !negative;
            s = rest.to_string();
        } else if let Some(rest) = s.strip_prefix('+') {
            s = rest.to_string();
        } else if s.ends_with('-') || s.ends_with('−') {
            negative = !negative;
            s.pop();
        } else if s.ends_with('%') {
            percent = true;
            s.pop();
        } else if let Some(c) = s.chars().next().filter(|c| CURRENCY_SYMBOLS.contains(c)) {
            currency.get_or_insert_with(|| c.to_string());
            s = s[c.len_utf8()..].to_string();
        } else if let Some(c) = s.chars().last().filter(|c| CURRENCY_SYMBOLS.contains(c)) {
            currency.get_or_insert_with(|| c.to_string());
            s.truncate(s.len() - c.len_utf8());
        } else if let Some((code, at_start)) = currency_code_at_edge(&s) {
            currency.get_or_insert_with(|| code.to_string());
            if at_start {
                s = s[3..].to_string();
            } else {
                s.truncate(s.len() - 3);
            }
        }
        if s == before {
            break;
        }
    }
    let body = s.trim();
    if body.is_empty() {
        return Err(NumberError::Malformed);
    }
    let value = parse_body(body).ok_or(NumberError::Malformed)?;
    let value = if negative {
        Decimal::new(-value.units, value.scale)
    } else {
        value
    };
    Ok(ParsedNumber {
        value,
        currency,
        percent,
    })
}

fn all_digits(s: &str) -> bool {
    !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit())
}

/// True for `d{1,3}` followed by one or more `sep d{3}` groups.
fn grouped_by(s: &str, sep: char) -> bool {
    let mut parts = s.split(sep);
    let Some(first) = parts.next() else {
        return false;
    };
    if !(1..=3).contains(&first.len()) || !all_digits(first) {
        return false;
    }
    let mut n = 0;
    for p in parts {
        if p.len() != 3 || !all_digits(p) {
            return false;
        }
        n += 1;
    }
    n > 0
}

fn parse_body(body: &str) -> Option<Decimal> {
    let (int_raw, frac_raw): (String, String) = match (body.contains(','), body.contains('.')) {
        (true, true) => {
            let comma = body.rfind(',')?;
            let dot = body.rfind('.')?;
            let (thousands, decimal) = if dot > comma { (',', '.') } else { ('.', ',') };
            let at = body.rfind(decimal)?;
            let (int_part, frac_part) = (&body[..at], &body[at + 1..]);
            if !grouped_by(int_part, thousands) || !all_digits(frac_part) {
                return None;
            }
            (int_part.replace(thousands, ""), frac_part.to_string())
        }
        (true, false) => {
            if grouped_by(body, ',') {
                (body.replace(',', ""), String::new())
            } else {
                let (i, f) = body.split_once(',')?;
                if !all_digits(i) || !all_digits(f) || f.contains(',') {
                    return None;
                }
                (i.to_string(), f.to_string())
            }
        }
        (false, true) => {
            if grouped_by(body, '.') && body.matches('.').count() > 1 {
                (body.replace('.', ""), String::new())
            } else {
                let (i, f) = body.split_once('.')?;
                if !(i.is_empty() || all_digits(i)) || !all_digits(f) {
                    return None;
                }
                (
                    if i.is_empty() {
                        "0".into()
                    } else {
                        i.to_string()
                    },
                    f.to_string(),
                )
            }
        }
        (false, false) => {
            if grouped_by(body, ' ') {
                (body.replace(' ', ""), String::new())
            } else if all_digits(body) {
                (body.to_string(), String::new())
            } else {
                return None;
            }
        }
    };
    if int_raw.len() + frac_raw.len() > MAX_DIGITS || frac_raw.len() > usize::from(MAX_SCALE) {
        return None;
    }
    let digits = format!("{int_raw}{frac_raw}");
    let units: i128 = digits.parse().ok()?;
    Some(Decimal::new(units, frac_raw.len() as u8))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn p(s: &str) -> Decimal {
        parse_number(s).unwrap().value
    }

    #[test]
    fn plain_integers_and_decimals() {
        assert_eq!(p("42").to_plain_string(), "42");
        assert_eq!(p("12.50").to_plain_string(), "12.50");
        assert_eq!(p(".5").to_plain_string(), "0.5");
        assert_eq!(p("0.07").to_plain_string(), "0.07");
    }

    #[test]
    fn currency_and_grouping() {
        let n = parse_number("$1,234.50").unwrap();
        assert_eq!(n.value.to_plain_string(), "1234.50");
        assert_eq!(n.currency.as_deref(), Some("$"));
        assert_eq!(p("1,234").to_plain_string(), "1234");
        assert_eq!(p("12,5").to_plain_string(), "12.5");
        assert_eq!(p("1.234,50").to_plain_string(), "1234.50");
        assert_eq!(p("1.234.567").to_plain_string(), "1234567");
        assert_eq!(p("1 234 567").to_plain_string(), "1234567");
        assert_eq!(
            parse_number("EUR 99.90").unwrap().currency.as_deref(),
            Some("EUR")
        );
        assert!(parse_number("12.5%").unwrap().percent);
    }

    #[test]
    fn negatives_in_every_spelling() {
        assert_eq!(p("-5").to_plain_string(), "-5");
        assert_eq!(p("(5.25)").to_plain_string(), "-5.25");
        assert_eq!(p("5-").to_plain_string(), "-5");
        assert_eq!(p("-$5.00").to_plain_string(), "-5.00");
        assert_eq!(p("$(5.00)").to_plain_string(), "-5.00");
        assert_eq!(p("−7").to_plain_string(), "-7");
    }

    #[test]
    fn blanks_and_placeholders() {
        for s in ["", "   ", "N/A", "n/a", "-", "—", "null"] {
            assert_eq!(parse_number(s), Err(NumberError::Blank), "{s:?}");
        }
    }

    #[test]
    fn non_ascii_text_never_panics() {
        // Byte 3 / len-3 fall inside a multi-byte character in each of these.
        for s in [
            "Joëlle Smith",
            "naïve",
            "Zoë",
            "日本語円",
            "Ünïcödé",
            "€€€€",
            "東京 100円",
            "ééé",
            "aé",
            "éa",
        ] {
            let _ = parse_number(s);
        }
        assert_eq!(parse_number("Joëlle Smith"), Err(NumberError::Malformed));
        assert_eq!(parse_number("東京"), Err(NumberError::Malformed));
        // ...and a real code beside non-ASCII still works.
        assert_eq!(
            parse_number("USD 5").unwrap().currency.as_deref(),
            Some("USD")
        );
        assert_eq!(
            parse_number("5 EUR").unwrap().currency.as_deref(),
            Some("EUR")
        );
    }

    #[test]
    fn malformed_is_rejected_not_guessed() {
        for s in [
            "12abc",
            "1e3",
            "1,2,3",
            "1..2",
            "$",
            "abc",
            "12.3.4.5x",
            "1,23,456",
            "0x10",
        ] {
            assert_eq!(parse_number(s), Err(NumberError::Malformed), "{s:?}");
        }
    }

    #[test]
    fn addition_is_exact() {
        let mut total = Decimal::ZERO;
        for _ in 0..10 {
            total = total.checked_add(&p("0.1")).unwrap();
        }
        assert_eq!(total.to_plain_string(), "1.0");
        assert_eq!(total, Decimal::from_int(1));
        let a = p("0.1").checked_add(&p("0.2")).unwrap();
        assert_eq!(a, p("0.3"));
    }

    #[test]
    fn wire_form_round_trips_as_a_string() {
        let d = p("-1234.50");
        let json = serde_json::to_string(&d).unwrap();
        assert_eq!(json, "\"-1234.50\"");
        let back: Decimal = serde_json::from_str(&json).unwrap();
        assert_eq!(back.to_plain_string(), "-1234.50");
        assert!(serde_json::from_str::<Decimal>("\"1e3\"").is_err());
    }

    #[test]
    fn overflow_is_reported() {
        let big = Decimal::new(i128::MAX, 0);
        assert!(big.checked_add(&Decimal::from_int(1)).is_none());
    }

    #[test]
    fn ordering_across_scales() {
        assert!(p("2.5") > p("2.49"));
        assert!(p("-1") < p("0.001"));
        assert_eq!(p("3.0"), p("3.00"));
    }

    #[test]
    fn average_rounds_half_away_from_zero() {
        assert_eq!(p("10").div_count(3, 2).unwrap().to_plain_string(), "3.33");
        assert_eq!(p("20").div_count(3, 2).unwrap().to_plain_string(), "6.67");
        assert_eq!(p("-20").div_count(3, 2).unwrap().to_plain_string(), "-6.67");
        assert_eq!(p("1").div_count(2, 0).unwrap().to_plain_string(), "1");
        assert!(p("1").div_count(0, 2).is_none());
    }

    #[test]
    fn grouped_display() {
        assert_eq!(p("439519.85").to_grouped_string(2), "439,519.85");
        assert_eq!(p("1234567").to_grouped_string(0), "1,234,567");
        assert_eq!(p("-1234.5").to_grouped_string(2), "-1,234.50");
        assert_eq!(p("999").to_grouped_string(0), "999");
        assert_eq!(p("0.5").to_grouped_string(2), "0.50");
    }
}

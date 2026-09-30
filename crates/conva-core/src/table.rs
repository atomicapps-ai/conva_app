//! Typed table artifacts for CSV / XLSX documents.
//!
//! A spreadsheet is stored twice: as prose (so the normal RAG path keeps
//! working) and as a [`TableDataset`] — columns, typed cells, and the source
//! row of every record — so questions such as "total per district" can be
//! answered by exact arithmetic instead of by a model reading chunks.
//!
//! File adapters (CSV, XLSX) live in `src-tauri`; they hand this module a
//! rectangular-ish grid of [`RawCell`]s and [`BuildOptions`], and everything
//! from header detection to duplicate-row marking happens here, on any OS.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use crate::decimal::{is_blank_marker, parse_number, Decimal, NumberError};

/// Bump when the serialized shape of [`TableDataset`] changes incompatibly.
pub const TABLE_SCHEMA_VERSION: u32 = 1;
/// Longest run of source rows kept as provenance for any one figure.
pub const MAX_PROVENANCE_ROWS: usize = 20;
/// Datasets larger than this are refused rather than half-read.
pub const MAX_ROWS: usize = 200_000;
/// Rows kept (for search text only) from a sheet refused as too large.
pub const REJECTED_KEEP_ROWS: usize = 2_000;

/// What the file adapter saw in one cell before typing.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum RawKind {
    /// Text as written (every CSV cell; text and dates in XLSX).
    #[default]
    Text,
    /// A number the spreadsheet stored as a number.
    Number,
    /// A formula whose last calculated value is present in `text`.
    FormulaValue,
    /// A formula with no saved value.
    FormulaNoValue,
    /// An error value such as `#DIV/0!`.
    Error,
}

/// One cell as handed over by a file adapter.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct RawCell {
    pub text: String,
    #[serde(default)]
    pub kind: RawKind,
}

impl RawCell {
    pub fn text(s: impl Into<String>) -> Self {
        Self {
            text: s.into(),
            kind: RawKind::Text,
        }
    }
}

/// Facts about the sheet's structure that only the adapter can know.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct BuildOptions {
    pub doc_id: String,
    pub file_name: String,
    pub sheet: Option<String>,
    /// The sheet contains merged cells.
    pub has_merged_cells: bool,
    /// Sheets other than the one read (XLSX), by name, for reporting.
    pub other_sheets: Vec<String>,
}

/// How a cell was understood.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CellKind {
    Blank,
    Number,
    Text,
    /// A formula with no saved value, or an error value: unusable.
    Unusable,
}

/// One typed cell. `number` is present only when `kind == Number`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TableCell {
    pub raw: String,
    pub kind: CellKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub number: Option<Decimal>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ColumnKind {
    Number,
    Text,
    /// No non-blank values at all.
    Empty,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TableColumn {
    /// Zero-based position within the sheet.
    pub index: u32,
    /// Header text as written, or `Column N` when blank.
    pub header: String,
    pub kind: ColumnKind,
    /// Currency symbol or code most numbers carried, if any.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub currency: Option<String>,
    #[serde(default)]
    pub percent: bool,
    /// Most fractional digits any number in the column carries.
    #[serde(default)]
    pub scale: u8,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TableRow {
    /// One-based row number in the source sheet (header is usually 1).
    pub source_row: u32,
    pub cells: Vec<TableCell>,
    /// Source row of the earlier row this one exactly repeats.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub duplicate_of: Option<u32>,
    /// A `Total` / `Subtotal` line inside the data; never aggregated.
    #[serde(default)]
    pub subtotal: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum IssueCode {
    BlankValues,
    MalformedNumbers,
    FormulaWithoutValue,
    DuplicateRows,
    RaggedRows,
    DuplicateHeaders,
    BlankHeader,
    SubtotalRowSkipped,
    GroupVariantsMerged,
    BlankGroup,
    MixedCurrency,
    OtherSheetsIgnored,
}

/// A data-quality finding, always tied to the rows it concerns.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TableIssue {
    pub code: IssueCode,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub column: Option<u32>,
    /// First [`MAX_PROVENANCE_ROWS`] affected source rows.
    pub rows: Vec<u32>,
    /// True number of affected rows.
    pub count: u32,
    pub message: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum UnsupportedReason {
    MergedCells,
    NoHeaderRow,
    NoDataRows,
    TooManyRows,
    EmptySheet,
}

impl UnsupportedReason {
    pub fn describe(self) -> &'static str {
        match self {
            Self::MergedCells => "it has merged cells",
            Self::NoHeaderRow => "the first row does not look like column headings",
            Self::NoDataRows => "there are no data rows under the headings",
            Self::TooManyRows => "it has more rows than can be read safely",
            Self::EmptySheet => "the sheet is empty",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TableDataset {
    pub schema_version: u32,
    pub doc_id: String,
    pub file_name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sheet: Option<String>,
    pub columns: Vec<TableColumn>,
    pub rows: Vec<TableRow>,
    #[serde(default)]
    pub issues: Vec<TableIssue>,
    /// Empty when the sheet can be aggregated safely.
    #[serde(default)]
    pub unsupported: Vec<UnsupportedReason>,
}

impl TableDataset {
    pub fn is_supported(&self) -> bool {
        self.unsupported.is_empty()
    }

    pub fn column(&self, index: u32) -> Option<&TableColumn> {
        self.columns.iter().find(|c| c.index == index)
    }

    /// Position of a column within each row's `cells`.
    pub fn slot(&self, index: u32) -> Option<usize> {
        self.columns.iter().position(|c| c.index == index)
    }

    pub fn duplicate_count(&self) -> usize {
        self.rows
            .iter()
            .filter(|r| r.duplicate_of.is_some())
            .count()
    }
}

fn cap_rows(rows: &[u32]) -> Vec<u32> {
    rows.iter().copied().take(MAX_PROVENANCE_ROWS).collect()
}

fn normalize_cell(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// A line that is only a total label ("Total", "Grand total:"). Deliberately
/// exact: "Total Energy" or "Total Wine" are real customers, not totals.
fn is_subtotal_label(s: &str) -> bool {
    let t = s.trim().trim_end_matches(':').trim().to_lowercase();
    [
        "total",
        "totals",
        "grand total",
        "grand totals",
        "subtotal",
        "sub-total",
        "sub total",
    ]
    .contains(&t.as_str())
}

fn classify(cell: &RawCell) -> (CellKind, Option<Decimal>, Option<String>, bool) {
    match cell.kind {
        RawKind::FormulaNoValue | RawKind::Error => (CellKind::Unusable, None, None, false),
        _ => {
            if is_blank_marker(&cell.text) {
                return (CellKind::Blank, None, None, false);
            }
            match parse_number(&cell.text) {
                Ok(p) => (CellKind::Number, Some(p.value), p.currency, p.percent),
                Err(NumberError::Blank) => (CellKind::Blank, None, None, false),
                Err(NumberError::Malformed) => (CellKind::Text, None, None, false),
            }
        }
    }
}

fn row_is_blank(row: &[RawCell]) -> bool {
    row.iter().all(|c| is_blank_marker(&c.text))
}

/// Turn a raw grid into a typed dataset.
///
/// `grid[0]` is source row 1. Fully blank rows are dropped (their numbers are
/// preserved on the rows that remain). The first non-blank row is the header.
/// Nothing here fails: structure that cannot be aggregated safely is recorded
/// in [`TableDataset::unsupported`], and everything odd but survivable is
/// recorded as a [`TableIssue`].
pub fn build_dataset(grid: &[Vec<RawCell>], opts: &BuildOptions) -> TableDataset {
    let mut ds = TableDataset {
        schema_version: TABLE_SCHEMA_VERSION,
        doc_id: opts.doc_id.clone(),
        file_name: opts.file_name.clone(),
        sheet: opts.sheet.clone(),
        columns: Vec::new(),
        rows: Vec::new(),
        issues: Vec::new(),
        unsupported: Vec::new(),
    };
    if opts.has_merged_cells {
        ds.unsupported.push(UnsupportedReason::MergedCells);
    }
    if !opts.other_sheets.is_empty() {
        ds.issues.push(TableIssue {
            code: IssueCode::OtherSheetsIgnored,
            column: None,
            rows: Vec::new(),
            count: opts.other_sheets.len() as u32,
            message: format!(
                "Only the first sheet was read. Other sheets ignored: {}.",
                opts.other_sheets.join(", ")
            ),
        });
    }
    // Too large to aggregate safely. Totals are refused, but the first rows are
    // still typed so the document keeps a useful searchable text.
    let grid = if grid.len() > MAX_ROWS {
        ds.unsupported.push(UnsupportedReason::TooManyRows);
        &grid[..(REJECTED_KEEP_ROWS + 1).min(grid.len())]
    } else {
        grid
    };

    let Some(header_at) = grid.iter().position(|r| !row_is_blank(r)) else {
        ds.unsupported.push(UnsupportedReason::EmptySheet);
        return ds;
    };
    let header = &grid[header_at];
    let width = grid[header_at..].iter().map(Vec::len).max().unwrap_or(0);

    // A header row that is mostly numbers means there is no header row.
    let numeric_headers = header
        .iter()
        .filter(|c| !is_blank_marker(&c.text) && parse_number(&c.text).is_ok())
        .count();
    let filled_headers = header.iter().filter(|c| !is_blank_marker(&c.text)).count();
    if filled_headers > 0 && numeric_headers * 2 >= filled_headers {
        ds.unsupported.push(UnsupportedReason::NoHeaderRow);
    }

    // Headers: fill blanks, disambiguate duplicates.
    let mut names: Vec<String> = Vec::with_capacity(width);
    let mut seen: HashMap<String, u32> = HashMap::new();
    let mut dup_headers: Vec<String> = Vec::new();
    let mut blank_headers: Vec<u32> = Vec::new();
    for i in 0..width {
        let raw = header
            .get(i)
            .map(|c| normalize_cell(&c.text))
            .unwrap_or_default();
        let mut name = if raw.is_empty() {
            blank_headers.push(i as u32);
            format!("Column {}", i + 1)
        } else {
            raw
        };
        let key = name.to_lowercase();
        let n = seen.entry(key).or_insert(0);
        *n += 1;
        if *n > 1 {
            dup_headers.push(name.clone());
            name = format!("{name} ({n})");
        }
        names.push(name);
    }

    // Data rows.
    let mut ragged: Vec<u32> = Vec::new();
    let mut seen_rows: HashMap<Vec<String>, u32> = HashMap::new();
    for (offset, raw_row) in grid[header_at + 1..].iter().enumerate() {
        if row_is_blank(raw_row) {
            continue;
        }
        let source_row = (header_at + 1 + offset + 1) as u32;
        if raw_row.len() < width {
            ragged.push(source_row);
        }
        let cells: Vec<TableCell> = (0..width)
            .map(|i| {
                let raw = raw_row.get(i).cloned().unwrap_or_default();
                let (kind, number, _, _) = classify(&raw);
                TableCell {
                    raw: raw.text.trim().to_string(),
                    kind,
                    number,
                }
            })
            .collect();
        // A total line: a bare total label, then nothing but numbers or blanks.
        let subtotal = cells
            .first()
            .map(|c| c.kind == CellKind::Text && is_subtotal_label(&c.raw))
            .unwrap_or(false)
            && cells[1..]
                .iter()
                .all(|c| matches!(c.kind, CellKind::Blank | CellKind::Number));
        let key: Vec<String> = cells
            .iter()
            .map(|c| normalize_cell(&c.raw).to_lowercase())
            .collect();
        let duplicate_of = if subtotal {
            None
        } else {
            match seen_rows.get(&key) {
                Some(first) => Some(*first),
                None => {
                    seen_rows.insert(key, source_row);
                    None
                }
            }
        };
        ds.rows.push(TableRow {
            source_row,
            cells,
            duplicate_of,
            subtotal,
        });
    }
    if ds.rows.is_empty() {
        ds.unsupported.push(UnsupportedReason::NoDataRows);
    }

    // Column typing.
    let mut malformed: Vec<(u32, Vec<u32>)> = Vec::new();
    let mut blanks: Vec<(u32, Vec<u32>)> = Vec::new();
    let mut unusable: Vec<(u32, Vec<u32>)> = Vec::new();
    let mut mixed_currency: Vec<u32> = Vec::new();
    for (slot, name) in names.iter().enumerate() {
        let (mut nums, mut texts) = (0usize, 0usize);
        let mut scale = 0u8;
        let mut currencies: Vec<String> = Vec::new();
        let mut any_percent = false;
        let (mut bad_rows, mut blank_rows, mut unusable_rows): (Vec<u32>, Vec<u32>, Vec<u32>) =
            (Vec::new(), Vec::new(), Vec::new());
        let mut text_rows: Vec<u32> = Vec::new();
        for row in ds.rows.iter().filter(|r| !r.subtotal) {
            let cell = &row.cells[slot];
            match cell.kind {
                CellKind::Number => {
                    nums += 1;
                    if let Some(n) = cell.number {
                        scale = scale.max(n.scale);
                    }
                    if let Ok(p) = parse_number(&cell.raw) {
                        if let Some(c) = p.currency {
                            if !currencies.contains(&c) {
                                currencies.push(c);
                            }
                        }
                        any_percent |= p.percent;
                    }
                }
                CellKind::Text => {
                    texts += 1;
                    text_rows.push(row.source_row);
                }
                CellKind::Blank => blank_rows.push(row.source_row),
                CellKind::Unusable => unusable_rows.push(row.source_row),
            }
        }
        // Mostly numbers => a number column; the stragglers are malformed.
        let kind = if nums == 0 && texts == 0 {
            ColumnKind::Empty
        } else if nums > 0 && nums >= texts * 4 {
            ColumnKind::Number
        } else {
            ColumnKind::Text
        };
        if kind == ColumnKind::Number {
            bad_rows.extend(text_rows.iter().copied());
        }
        if !bad_rows.is_empty() {
            malformed.push((slot as u32, bad_rows));
        }
        if !blank_rows.is_empty() && kind != ColumnKind::Empty {
            blanks.push((slot as u32, blank_rows));
        }
        if !unusable_rows.is_empty() {
            unusable.push((slot as u32, unusable_rows));
        }
        if currencies.len() > 1 && kind == ColumnKind::Number {
            mixed_currency.push(slot as u32);
        }
        ds.columns.push(TableColumn {
            index: slot as u32,
            header: name.clone(),
            kind,
            currency: currencies.first().cloned(),
            percent: any_percent,
            scale,
        });
    }

    // Issues.
    for (slot, rows) in blanks {
        let name = &ds.columns[slot as usize].header;
        ds.issues.push(TableIssue {
            code: IssueCode::BlankValues,
            column: Some(slot),
            count: rows.len() as u32,
            message: format!("{} blank value(s) in \"{name}\".", rows.len()),
            rows: cap_rows(&rows),
        });
    }
    for (slot, rows) in malformed {
        let name = &ds.columns[slot as usize].header;
        ds.issues.push(TableIssue {
            code: IssueCode::MalformedNumbers,
            column: Some(slot),
            count: rows.len() as u32,
            message: format!(
                "{} value(s) in \"{name}\" are not valid numbers.",
                rows.len()
            ),
            rows: cap_rows(&rows),
        });
    }
    for (slot, rows) in unusable {
        let name = &ds.columns[slot as usize].header;
        ds.issues.push(TableIssue {
            code: IssueCode::FormulaWithoutValue,
            column: Some(slot),
            count: rows.len() as u32,
            message: format!(
                "{} cell(s) in \"{name}\" are formulas with no saved value, or errors.",
                rows.len()
            ),
            rows: cap_rows(&rows),
        });
    }
    for slot in mixed_currency {
        let name = &ds.columns[slot as usize].header;
        ds.issues.push(TableIssue {
            code: IssueCode::MixedCurrency,
            column: Some(slot),
            rows: Vec::new(),
            count: 0,
            message: format!("\"{name}\" mixes currencies; totals ignore the symbol."),
        });
    }
    if !ragged.is_empty() {
        ds.issues.push(TableIssue {
            code: IssueCode::RaggedRows,
            column: None,
            count: ragged.len() as u32,
            message: format!(
                "{} row(s) are shorter than the header; missing cells are blank.",
                ragged.len()
            ),
            rows: cap_rows(&ragged),
        });
    }
    if !dup_headers.is_empty() {
        ds.issues.push(TableIssue {
            code: IssueCode::DuplicateHeaders,
            column: None,
            rows: Vec::new(),
            count: dup_headers.len() as u32,
            message: format!("Repeated column heading(s): {}.", dup_headers.join(", ")),
        });
    }
    if !blank_headers.is_empty() {
        ds.issues.push(TableIssue {
            code: IssueCode::BlankHeader,
            column: None,
            rows: Vec::new(),
            count: blank_headers.len() as u32,
            message: format!("{} column(s) have no heading.", blank_headers.len()),
        });
    }
    let subtotal_rows: Vec<u32> = ds
        .rows
        .iter()
        .filter(|r| r.subtotal)
        .map(|r| r.source_row)
        .collect();
    if !subtotal_rows.is_empty() {
        ds.issues.push(TableIssue {
            code: IssueCode::SubtotalRowSkipped,
            column: None,
            count: subtotal_rows.len() as u32,
            message: format!(
                "{} total line(s) inside the data were left out so nothing is counted twice.",
                subtotal_rows.len()
            ),
            rows: cap_rows(&subtotal_rows),
        });
    }
    let dups: Vec<u32> = ds
        .rows
        .iter()
        .filter(|r| r.duplicate_of.is_some())
        .map(|r| r.source_row)
        .collect();
    if !dups.is_empty() {
        ds.issues.push(TableIssue {
            code: IssueCode::DuplicateRows,
            column: None,
            count: dups.len() as u32,
            message: format!("{} row(s) exactly repeat an earlier row.", dups.len()),
            rows: cap_rows(&dups),
        });
    }
    ds
}

/// Prose form of a dataset, for the normal RAG path: a header line and one
/// `Header: value` line per row, so questions that name a value still hit.
/// Only the first `max_rows` rows are written (a 100,000-row sheet must not
/// flood the embedder); totals always use the typed dataset, never this text.
pub fn table_prose(ds: &TableDataset, max_rows: usize) -> String {
    let mut out = String::new();
    out.push_str(&format!("Spreadsheet: {}", ds.file_name));
    if let Some(sheet) = &ds.sheet {
        out.push_str(&format!(" (sheet {sheet})"));
    }
    out.push('\n');
    let headers: Vec<&str> = ds.columns.iter().map(|c| c.header.as_str()).collect();
    out.push_str(&format!("Columns: {}\n\n", headers.join(" | ")));
    for row in ds.rows.iter().take(max_rows) {
        let parts: Vec<String> = ds
            .columns
            .iter()
            .zip(&row.cells)
            .filter(|(_, c)| c.kind != CellKind::Blank)
            .map(|(col, c)| format!("{}: {}", col.header, c.raw))
            .collect();
        out.push_str(&parts.join("; "));
        out.push('\n');
    }
    if ds.rows.len() > max_rows {
        out.push_str(&format!(
            "\n(Showing the first {max_rows} of {} rows. Totals and counts use every row.)\n",
            ds.rows.len()
        ));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn grid(rows: &[&[&str]]) -> Vec<Vec<RawCell>> {
        rows.iter()
            .map(|r| r.iter().map(|c| RawCell::text(*c)).collect())
            .collect()
    }

    fn opts() -> BuildOptions {
        BuildOptions {
            doc_id: "doc-1".into(),
            file_name: "sales.csv".into(),
            ..Default::default()
        }
    }

    fn sales() -> TableDataset {
        build_dataset(
            &grid(&[
                &["District", "Orders", "Amount"],
                &["North", "10", "$100.50"],
                &["East", "5", "$50.00"],
                &["North", "2", "$20.25"],
            ]),
            &opts(),
        )
    }

    #[test]
    fn types_columns_and_keeps_source_rows() {
        let ds = sales();
        assert!(ds.is_supported());
        assert_eq!(ds.columns.len(), 3);
        assert_eq!(ds.columns[0].kind, ColumnKind::Text);
        assert_eq!(ds.columns[2].kind, ColumnKind::Number);
        assert_eq!(ds.columns[2].currency.as_deref(), Some("$"));
        assert_eq!(ds.columns[2].scale, 2);
        assert_eq!(
            ds.rows.iter().map(|r| r.source_row).collect::<Vec<_>>(),
            vec![2, 3, 4]
        );
        assert_eq!(
            ds.rows[0].cells[2].number.unwrap().to_plain_string(),
            "100.50"
        );
        assert!(ds.issues.is_empty());
    }

    #[test]
    fn blank_rows_are_dropped_but_row_numbers_stay_true() {
        let ds = build_dataset(
            &grid(&[&["A", "B"], &["x", "1"], &["", ""], &["y", "2"]]),
            &opts(),
        );
        assert_eq!(
            ds.rows.iter().map(|r| r.source_row).collect::<Vec<_>>(),
            vec![2, 4]
        );
    }

    #[test]
    fn reports_blanks_and_malformed_numbers() {
        let ds = build_dataset(
            &grid(&[
                &["District", "Amount"],
                &["North", "10"],
                &["East", ""],
                &["West", "12abc"],
                &["South", "20"],
                &["North", "30"],
                &["East", "40"],
                &["West", "50"],
                &["South", "60"],
            ]),
            &opts(),
        );
        assert_eq!(ds.columns[1].kind, ColumnKind::Number);
        let codes: Vec<IssueCode> = ds.issues.iter().map(|i| i.code).collect();
        assert!(codes.contains(&IssueCode::BlankValues));
        assert!(codes.contains(&IssueCode::MalformedNumbers));
        let bad = ds
            .issues
            .iter()
            .find(|i| i.code == IssueCode::MalformedNumbers)
            .unwrap();
        assert_eq!(bad.rows, vec![4]);
    }

    #[test]
    fn marks_exact_duplicate_rows_with_their_first_occurrence() {
        let ds = build_dataset(
            &grid(&[&["A", "B"], &["x", "1"], &["y", "2"], &["X ", "1"]]),
            &opts(),
        );
        assert_eq!(ds.rows[2].duplicate_of, Some(2));
        assert_eq!(ds.duplicate_count(), 1);
        assert!(ds.issues.iter().any(|i| i.code == IssueCode::DuplicateRows));
    }

    #[test]
    fn subtotal_lines_are_excluded_not_duplicated() {
        let ds = build_dataset(
            &grid(&[&["District", "Amount"], &["North", "10"], &["Total", "10"]]),
            &opts(),
        );
        assert!(ds.rows[1].subtotal);
        assert!(ds
            .issues
            .iter()
            .any(|i| i.code == IssueCode::SubtotalRowSkipped));
    }

    #[test]
    fn a_customer_whose_name_starts_with_total_is_data_not_a_total_line() {
        let ds = build_dataset(
            &grid(&[
                &["Customer", "Amount"],
                &["Total Energy", "10"],
                &["Total Wine", "5"],
                &["Total", "15"],
                &["Grand total:", "15"],
            ]),
            &opts(),
        );
        let flags: Vec<bool> = ds.rows.iter().map(|r| r.subtotal).collect();
        assert_eq!(flags, vec![false, false, true, true]);
    }

    #[test]
    fn a_total_label_with_words_in_the_other_cells_is_kept() {
        let ds = build_dataset(
            &grid(&[&["Item", "Note"], &["Total", "see appendix"]]),
            &opts(),
        );
        assert!(!ds.rows[0].subtotal);
    }

    #[test]
    fn an_oversized_sheet_is_refused_for_totals_but_keeps_searchable_rows() {
        let mut g = vec![vec![RawCell::text("District"), RawCell::text("Amount")]];
        for i in 0..(MAX_ROWS + 10) {
            g.push(vec![
                RawCell::text(format!("D{}", i % 5)),
                RawCell::text("1"),
            ]);
        }
        let ds = build_dataset(&g, &opts());
        assert_eq!(ds.unsupported, vec![UnsupportedReason::TooManyRows]);
        assert_eq!(ds.columns.len(), 2);
        assert_eq!(ds.rows.len(), REJECTED_KEEP_ROWS);
        assert!(table_prose(&ds, 10).contains("District: D0"));
    }

    #[test]
    fn duplicate_and_blank_headers_are_made_distinct() {
        let ds = build_dataset(
            &grid(&[&["Amount", "Amount", ""], &["1", "2", "3"]]),
            &opts(),
        );
        let names: Vec<&str> = ds.columns.iter().map(|c| c.header.as_str()).collect();
        assert_eq!(names, vec!["Amount", "Amount (2)", "Column 3"]);
        let codes: Vec<IssueCode> = ds.issues.iter().map(|i| i.code).collect();
        assert!(codes.contains(&IssueCode::DuplicateHeaders));
        assert!(codes.contains(&IssueCode::BlankHeader));
    }

    #[test]
    fn ragged_rows_are_padded_and_reported() {
        let ds = build_dataset(
            &grid(&[&["A", "B", "C"], &["x", "1"], &["y", "2", "3"]]),
            &opts(),
        );
        assert_eq!(ds.rows[0].cells.len(), 3);
        assert_eq!(ds.rows[0].cells[2].kind, CellKind::Blank);
        assert!(ds.issues.iter().any(|i| i.code == IssueCode::RaggedRows));
    }

    #[test]
    fn formulas_without_values_are_unusable() {
        let mut g = grid(&[&["District", "Amount"], &["North", "10"], &["East", "0"]]);
        g[2][1] = RawCell {
            text: "=SUM(B2:B2)".into(),
            kind: RawKind::FormulaNoValue,
        };
        let ds = build_dataset(&g, &opts());
        assert_eq!(ds.rows[1].cells[1].kind, CellKind::Unusable);
        assert!(ds
            .issues
            .iter()
            .any(|i| i.code == IssueCode::FormulaWithoutValue));
    }

    #[test]
    fn unsupported_structures_are_named() {
        let merged = build_dataset(
            &grid(&[&["A", "B"], &["x", "1"]]),
            &BuildOptions {
                has_merged_cells: true,
                ..opts()
            },
        );
        assert_eq!(merged.unsupported, vec![UnsupportedReason::MergedCells]);
        assert!(!merged.is_supported());

        let headerless = build_dataset(&grid(&[&["1", "2"], &["3", "4"]]), &opts());
        assert!(headerless
            .unsupported
            .contains(&UnsupportedReason::NoHeaderRow));

        let no_data = build_dataset(&grid(&[&["A", "B"]]), &opts());
        assert!(no_data.unsupported.contains(&UnsupportedReason::NoDataRows));

        let empty = build_dataset(&grid(&[&["", ""]]), &opts());
        assert_eq!(empty.unsupported, vec![UnsupportedReason::EmptySheet]);
    }

    #[test]
    fn other_sheets_are_reported() {
        let ds = build_dataset(
            &grid(&[&["A"], &["1"]]),
            &BuildOptions {
                other_sheets: vec!["Notes".into()],
                ..opts()
            },
        );
        assert!(ds
            .issues
            .iter()
            .any(|i| i.code == IssueCode::OtherSheetsIgnored));
    }

    #[test]
    fn prose_keeps_values_searchable() {
        let prose = table_prose(&sales(), 100);
        assert!(prose.contains("Columns: District | Orders | Amount"));
        assert!(prose.contains("District: North; Orders: 10; Amount: $100.50"));
        assert!(!prose.contains("Showing the first"));
        let capped = table_prose(&sales(), 1);
        assert!(capped.contains("District: North"));
        assert!(!capped.contains("District: East"));
        assert!(capped.contains("Showing the first 1 of 3 rows"));
    }

    #[test]
    fn dataset_round_trips_through_json() {
        let ds = sales();
        let json = serde_json::to_string(&ds).unwrap();
        let back: TableDataset = serde_json::from_str(&json).unwrap();
        assert_eq!(ds, back);
    }
}

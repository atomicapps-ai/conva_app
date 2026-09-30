//! CSV / XLSX adapters: bytes on disk → the raw grid `conva-core` types.
//!
//! This is the only place that knows about spreadsheet *file formats*. It does
//! no arithmetic and makes no decisions about what is a number: it hands
//! `conva_core::table::build_dataset` every cell as text plus a few facts only
//! a file reader can know (formula with no saved value, merged cells, extra
//! sheets). Nothing here touches Tauri, so it is unit-testable anywhere.

use std::fs;
use std::io::Cursor;
use std::path::Path;

use calamine::{Data, Reader, SheetType, SheetVisible, Xlsx};
use conva_core::table::{build_dataset, BuildOptions, RawCell, RawKind, TableDataset, MAX_ROWS};

/// Extensions this module reads.
pub const TABLE_EXTS: [&str; 4] = ["csv", "tsv", "xlsx", "xlsm"];

pub fn is_table_ext(ext: &str) -> bool {
    TABLE_EXTS.contains(&ext)
}

/// Read a CSV / TSV / XLSX / XLSM file into a typed dataset. `doc_id` may be
/// a placeholder; the caller sets the real id once the document is stored.
pub fn import_table(path: &Path, doc_id: &str, file_name: &str) -> Result<TableDataset, String> {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_ascii_lowercase)
        .unwrap_or_default();
    let bytes = fs::read(path).map_err(|e| format!("couldn't read {file_name}: {e}"))?;
    match ext.as_str() {
        "csv" => read_csv(&bytes, doc_id, file_name, None),
        "tsv" => read_csv(&bytes, doc_id, file_name, Some(b'\t')),
        "xlsx" | "xlsm" => read_xlsx(bytes, doc_id, file_name),
        other => Err(format!("{file_name}: .{other} is not a spreadsheet type")),
    }
}

/// Pick the delimiter from the first line: whichever of `,` `;` tab appears
/// most. Ties (and single-column files) fall back to a comma.
fn sniff_delimiter(text: &str) -> u8 {
    let first = text.lines().find(|l| !l.trim().is_empty()).unwrap_or("");
    let counts = [
        (b',', first.matches(',').count()),
        (b';', first.matches(';').count()),
        (b'\t', first.matches('\t').count()),
    ];
    counts
        .iter()
        .max_by_key(|(_, n)| *n)
        .filter(|(_, n)| *n > 0)
        .map(|(d, _)| *d)
        .unwrap_or(b',')
}

pub(crate) fn read_csv(
    bytes: &[u8],
    doc_id: &str,
    file_name: &str,
    delimiter: Option<u8>,
) -> Result<TableDataset, String> {
    let bytes = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(bytes);
    let text = String::from_utf8_lossy(bytes);
    let delimiter = delimiter.unwrap_or_else(|| sniff_delimiter(&text));
    let mut reader = csv::ReaderBuilder::new()
        .has_headers(false)
        .flexible(true)
        .delimiter(delimiter)
        .from_reader(text.as_bytes());
    let mut grid: Vec<Vec<RawCell>> = Vec::new();
    for record in reader.records() {
        let record = record.map_err(|e| format!("{file_name} is not valid CSV: {e}"))?;
        grid.push(record.iter().map(RawCell::text).collect());
        // One past the limit is enough for the builder to refuse the sheet.
        if grid.len() > MAX_ROWS + 1 {
            break;
        }
    }
    Ok(build_dataset(
        &grid,
        &BuildOptions {
            doc_id: doc_id.to_string(),
            file_name: file_name.to_string(),
            ..Default::default()
        },
    ))
}

/// The number as a person sees it in Excel: at most 15 significant digits, so
/// `0.30000000000000004` reads `0.3` and `128430.5` stays `128430.5`.
pub(crate) fn excel_number_text(v: f64) -> String {
    if v == 0.0 {
        return "0".to_string();
    }
    // `{:e}` gives the shortest round-trip mantissa and an exact exponent.
    let sci = format!("{:e}", v.abs());
    let exp: i32 = sci
        .split_once('e')
        .and_then(|(_, e)| e.parse().ok())
        .unwrap_or(0);
    let decimals = (14 - exp).clamp(0, 30) as usize;
    let mut s = format!("{:.*}", decimals, v);
    if s.contains('.') {
        s = s.trim_end_matches('0').trim_end_matches('.').to_string();
    }
    if s == "-0" {
        s = "0".to_string();
    }
    s
}

fn cell_from_data(data: &Data) -> RawCell {
    match data {
        Data::Empty => RawCell::default(),
        Data::String(s) => RawCell::text(s.as_str()),
        Data::Int(i) => RawCell {
            text: i.to_string(),
            kind: RawKind::Number,
        },
        Data::Float(f) if f.is_finite() => RawCell {
            text: excel_number_text(*f),
            kind: RawKind::Number,
        },
        Data::Float(_) => RawCell {
            text: "#NUM!".to_string(),
            kind: RawKind::Error,
        },
        Data::Bool(b) => RawCell::text(if *b { "TRUE" } else { "FALSE" }),
        Data::DateTime(dt) => {
            let (y, mo, d, h, mi, s, _) = dt.to_ymd_hms_milli();
            let text = if dt.is_duration() {
                dt.to_string()
            } else if h == 0 && mi == 0 && s == 0 {
                format!("{y:04}-{mo:02}-{d:02}")
            } else {
                format!("{y:04}-{mo:02}-{d:02} {h:02}:{mi:02}:{s:02}")
            };
            RawCell::text(text)
        }
        Data::DateTimeIso(s) | Data::DurationIso(s) => RawCell::text(s.as_str()),
        Data::Error(e) => RawCell {
            text: e.to_string(),
            kind: RawKind::Error,
        },
    }
}

pub(crate) fn read_xlsx(
    bytes: Vec<u8>,
    doc_id: &str,
    file_name: &str,
) -> Result<TableDataset, String> {
    let mut workbook: Xlsx<_> = Xlsx::new(Cursor::new(bytes))
        .map_err(|e| format!("{file_name} is not a readable workbook: {e}"))?;
    let sheets: Vec<(String, bool)> = workbook
        .sheets_metadata()
        .iter()
        .filter(|s| s.typ == SheetType::WorkSheet)
        .map(|s| (s.name.clone(), s.visible == SheetVisible::Visible))
        .collect();
    let Some((sheet, _)) = sheets.iter().find(|(_, visible)| *visible) else {
        return Err(format!("{file_name} has no visible worksheet"));
    };
    let sheet = sheet.clone();
    let other_sheets: Vec<String> = sheets
        .iter()
        .filter(|(n, visible)| *visible && *n != sheet)
        .map(|(n, _)| n.clone())
        .collect();

    let range = workbook
        .worksheet_range(&sheet)
        .map_err(|e| format!("couldn't read sheet {sheet}: {e}"))?;
    let formulas = workbook.worksheet_formula(&sheet).ok();
    let merged = workbook
        .merge_cells_by_sheet_name(&sheet)
        .map(|m| !m.is_empty())
        .unwrap_or(false);

    let mut grid: Vec<Vec<RawCell>> = Vec::new();
    if let Some((start_row, start_col)) = range.start() {
        // Keep absolute row numbers: pad the rows above the used range.
        grid.resize(start_row as usize, Vec::new());
        for (i, row) in range.rows().enumerate() {
            let abs_row = start_row + i as u32;
            let cells = row
                .iter()
                .enumerate()
                .map(|(j, data)| {
                    let mut cell = cell_from_data(data);
                    let has_formula = formulas
                        .as_ref()
                        .and_then(|f| f.get_value((abs_row, start_col + j as u32)))
                        .is_some_and(|f| !f.is_empty());
                    if has_formula {
                        if matches!(data, Data::Empty) {
                            cell.kind = RawKind::FormulaNoValue;
                            cell.text = "=formula".to_string();
                        } else if cell.kind != RawKind::Error {
                            cell.kind = RawKind::FormulaValue;
                        }
                    }
                    cell
                })
                .collect();
            grid.push(cells);
            if grid.len() > MAX_ROWS + 1 {
                break;
            }
        }
    }
    Ok(build_dataset(
        &grid,
        &BuildOptions {
            doc_id: doc_id.to_string(),
            file_name: file_name.to_string(),
            sheet: Some(sheet),
            has_merged_cells: merged,
            other_sheets,
        },
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use conva_core::table::{CellKind, ColumnKind, IssueCode, UnsupportedReason};
    use std::io::Write;

    #[test]
    fn excel_numbers_read_as_a_person_sees_them() {
        assert_eq!(excel_number_text(0.1 + 0.2), "0.3");
        assert_eq!(excel_number_text(128430.5), "128430.5");
        assert_eq!(excel_number_text(1234567.891), "1234567.891");
        assert_eq!(excel_number_text(42.0), "42");
        assert_eq!(excel_number_text(-0.07), "-0.07");
        assert_eq!(excel_number_text(1e21), "1000000000000000000000");
        assert_eq!(excel_number_text(0.000123), "0.000123");
        assert_eq!(excel_number_text(-0.0), "0");
    }

    #[test]
    fn csv_with_quotes_bom_and_currency() {
        let csv =
            "\u{feff}District,Orders,Amount\nNorth,42,\"$128,430.50\"\nEast,37,\"$96,210.00\"\n";
        let ds = read_csv(csv.as_bytes(), "d", "s.csv", None).unwrap();
        assert!(ds.is_supported());
        assert_eq!(ds.columns[0].header, "District");
        assert_eq!(ds.columns[2].kind, ColumnKind::Number);
        assert_eq!(
            ds.rows[0].cells[2].number.unwrap().to_plain_string(),
            "128430.50"
        );
    }

    #[test]
    fn csv_delimiters_are_sniffed() {
        let semi = "District;Amount\nNorth;10,5\nEast;7\n";
        let ds = read_csv(semi.as_bytes(), "d", "s.csv", None).unwrap();
        assert_eq!(ds.columns.len(), 2);
        assert_eq!(
            ds.rows[0].cells[1].number.unwrap().to_plain_string(),
            "10.5"
        );
        let tab = "District\tAmount\nNorth\t10\n";
        let ds = read_csv(tab.as_bytes(), "d", "s.tsv", Some(b'\t')).unwrap();
        assert_eq!(ds.columns.len(), 2);
    }

    #[test]
    fn ragged_csv_rows_are_tolerated_and_reported() {
        let ds = read_csv(b"A,B,C\nx,1\ny,2,3\n", "d", "r.csv", None).unwrap();
        assert!(ds.issues.iter().any(|i| i.code == IssueCode::RaggedRows));
    }

    #[test]
    fn empty_csv_is_unsupported_not_an_error() {
        let ds = read_csv(b"", "d", "e.csv", None).unwrap();
        assert_eq!(ds.unsupported, vec![UnsupportedReason::EmptySheet]);
    }

    /// A minimal but valid .xlsx built by hand so the real reader is exercised.
    fn xlsx(sheet1_xml: &str, extra_sheet: bool) -> Vec<u8> {
        let mut buf = Vec::new();
        {
            let mut zip = zip::ZipWriter::new(Cursor::new(&mut buf));
            let opts = zip::write::SimpleFileOptions::default();
            let mut put = |name: &str, body: &str| {
                zip.start_file(name, opts).unwrap();
                zip.write_all(body.as_bytes()).unwrap();
            };
            let sheet2_ct = if extra_sheet {
                r#"<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>"#
            } else {
                ""
            };
            put(
                "[Content_Types].xml",
                &format!(
                    r#"<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>{sheet2_ct}</Types>"#
                ),
            );
            put(
                "_rels/.rels",
                r#"<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>"#,
            );
            let sheet2_wb = if extra_sheet {
                r#"<sheet name="Notes" sheetId="2" r:id="rId2"/>"#
            } else {
                ""
            };
            put(
                "xl/workbook.xml",
                &format!(
                    r#"<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sales" sheetId="1" r:id="rId1"/>{sheet2_wb}</sheets></workbook>"#
                ),
            );
            let sheet2_rel = if extra_sheet {
                r#"<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>"#
            } else {
                ""
            };
            put(
                "xl/_rels/workbook.xml.rels",
                &format!(
                    r#"<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>{sheet2_rel}</Relationships>"#
                ),
            );
            put("xl/worksheets/sheet1.xml", sheet1_xml);
            if extra_sheet {
                put(
                    "xl/worksheets/sheet2.xml",
                    r#"<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>note</t></is></c></row></sheetData></worksheet>"#,
                );
            }
            zip.finish().unwrap();
        }
        buf
    }

    fn sheet(rows_xml: &str, tail: &str) -> String {
        format!(
            r#"<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>{rows_xml}</sheetData>{tail}</worksheet>"#
        )
    }

    fn s(r: &str, text: &str) -> String {
        format!(r#"<c r="{r}" t="inlineStr"><is><t>{text}</t></is></c>"#)
    }

    fn n(r: &str, v: &str) -> String {
        format!(r#"<c r="{r}"><v>{v}</v></c>"#)
    }

    #[test]
    fn xlsx_numbers_text_and_source_rows() {
        let rows = format!(
            r#"<row r="1">{}{}</row><row r="2">{}{}</row><row r="3">{}{}</row>"#,
            s("A1", "District"),
            s("B1", "Amount"),
            s("A2", "North"),
            n("B2", "128430.5"),
            s("A3", "East"),
            n("B3", "0.30000000000000004"),
        );
        let ds = read_xlsx(xlsx(&sheet(&rows, ""), false), "d", "book.xlsx").unwrap();
        assert!(ds.is_supported());
        assert_eq!(ds.sheet.as_deref(), Some("Sales"));
        assert_eq!(ds.columns[1].kind, ColumnKind::Number);
        assert_eq!(
            ds.rows[0].cells[1].number.unwrap().to_plain_string(),
            "128430.5"
        );
        assert_eq!(ds.rows[1].cells[1].number.unwrap().to_plain_string(), "0.3");
        assert_eq!(
            ds.rows.iter().map(|r| r.source_row).collect::<Vec<_>>(),
            vec![2, 3]
        );
    }

    #[test]
    fn xlsx_used_range_offset_keeps_true_row_numbers() {
        // Data starts at B3; the header is row 3.
        let rows = format!(
            r#"<row r="3">{}{}</row><row r="4">{}{}</row>"#,
            s("B3", "District"),
            s("C3", "Amount"),
            s("B4", "North"),
            n("C4", "5"),
        );
        let ds = read_xlsx(xlsx(&sheet(&rows, ""), false), "d", "offset.xlsx").unwrap();
        assert_eq!(ds.columns[0].header, "District");
        assert_eq!(ds.rows[0].source_row, 4);
    }

    #[test]
    fn xlsx_formula_without_saved_value_is_unusable_and_with_value_is_used() {
        let rows = format!(
            r#"<row r="1">{}{}</row><row r="2">{}<c r="B2"><f>1+1</f><v>2</v></c></row><row r="3">{}<c r="B3"><f>SUM(B2:B2)</f></c></row>"#,
            s("A1", "District"),
            s("B1", "Amount"),
            s("A2", "North"),
            s("A3", "East"),
        );
        let ds = read_xlsx(xlsx(&sheet(&rows, ""), false), "d", "f.xlsx").unwrap();
        assert_eq!(ds.rows[0].cells[1].kind, CellKind::Number);
        assert_eq!(ds.rows[1].cells[1].kind, CellKind::Unusable);
        assert!(ds
            .issues
            .iter()
            .any(|i| i.code == IssueCode::FormulaWithoutValue));
    }

    #[test]
    fn xlsx_merged_cells_make_the_sheet_unsupported() {
        let rows = format!(
            r#"<row r="1">{}{}</row><row r="2">{}{}</row>"#,
            s("A1", "District"),
            s("B1", "Amount"),
            s("A2", "North"),
            n("B2", "5"),
        );
        let tail = r#"<mergeCells count="1"><mergeCell ref="A1:B1"/></mergeCells>"#;
        let ds = read_xlsx(xlsx(&sheet(&rows, tail), false), "d", "m.xlsx").unwrap();
        assert_eq!(ds.unsupported, vec![UnsupportedReason::MergedCells]);
    }

    #[test]
    fn xlsx_other_sheets_are_noted() {
        let rows = format!(
            r#"<row r="1">{}</row><row r="2">{}</row>"#,
            s("A1", "District"),
            s("A2", "North")
        );
        let ds = read_xlsx(xlsx(&sheet(&rows, ""), true), "d", "two.xlsx").unwrap();
        assert!(ds
            .issues
            .iter()
            .any(|i| i.code == IssueCode::OtherSheetsIgnored));
    }

    #[test]
    fn not_a_workbook_is_a_clear_error() {
        let err = read_xlsx(b"this is not a zip".to_vec(), "d", "bad.xlsx").unwrap_err();
        assert!(err.contains("bad.xlsx"), "{err}");
    }

    #[test]
    fn import_dispatches_on_extension() {
        let dir = std::env::temp_dir().join(format!("conva-table-import-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let csv_path = dir.join("a.csv");
        fs::write(&csv_path, "District,Amount\nN,1\n").unwrap();
        let ds = import_table(&csv_path, "id", "a.csv").unwrap();
        assert_eq!(ds.rows.len(), 1);
        assert!(import_table(&dir.join("a.pdf"), "id", "a.pdf").is_err());
        let _ = fs::remove_dir_all(&dir);
        assert!(is_table_ext("xlsx") && is_table_ext("csv") && !is_table_ext("pdf"));
    }
}

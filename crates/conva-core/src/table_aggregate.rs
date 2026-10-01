//! Deterministic aggregation over a [`TableDataset`].
//!
//! Given an [`AggregatePlan`], produce grouped totals with exact decimal
//! arithmetic. The result does not depend on row order (groups are sorted by
//! name), never calls a model, and reports every row it skipped and why.

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};

use crate::decimal::Decimal;
use crate::table::{
    CellKind, ColumnKind, IssueCode, TableDataset, TableIssue, MAX_PROVENANCE_ROWS,
    TABLE_SCHEMA_VERSION,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AggFunc {
    Sum,
    Count,
    Average,
    Min,
    Max,
}

impl AggFunc {
    pub fn label(self) -> &'static str {
        match self {
            Self::Sum => "Total",
            Self::Count => "Count",
            Self::Average => "Average",
            Self::Min => "Lowest",
            Self::Max => "Highest",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ColumnRef {
    pub index: u32,
    pub header: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum DuplicatePolicy {
    /// Count every row in the file, exactly as it is written. The default:
    /// identical rows are sometimes genuinely separate records.
    #[default]
    KeepAll,
    /// Count an exactly repeated row once.
    ExcludeExact,
}

/// What to compute. Built by the request resolver, executed here.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AggregatePlan {
    pub schema_version: u32,
    pub doc_id: String,
    pub func: AggFunc,
    /// The numeric column. `None` only for [`AggFunc::Count`].
    pub measure: Option<ColumnRef>,
    /// Grouping columns. One is supported today; the shape allows more.
    pub group_by: Vec<ColumnRef>,
    #[serde(default)]
    pub duplicates: DuplicatePolicy,
}

impl AggregatePlan {
    pub fn new(doc_id: &str, func: AggFunc) -> Self {
        Self {
            schema_version: TABLE_SCHEMA_VERSION,
            doc_id: doc_id.to_string(),
            func,
            measure: None,
            group_by: Vec::new(),
            duplicates: DuplicatePolicy::KeepAll,
        }
    }
}

/// One output line: a group, or the overall figure.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GroupResult {
    /// Display label (`North`, or `Total` for the overall line).
    pub label: String,
    /// `None` when nothing numeric fell in the group.
    pub value: Option<Decimal>,
    /// Rows belonging to the group.
    pub rows_in_group: u32,
    /// Rows that contributed a number (or, for Count, every row).
    pub rows_used: u32,
    /// First few source rows that actually contributed to `value` (rows whose
    /// measure was blank, malformed or unusable are not listed), for provenance.
    pub source_rows: Vec<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AggregateResult {
    pub plan: AggregatePlan,
    pub groups: Vec<GroupResult>,
    pub overall: GroupResult,
    pub issues: Vec<TableIssue>,
    /// Rows left out because of [`DuplicatePolicy::ExcludeExact`].
    pub excluded_duplicates: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum AggregateError {
    #[error("this calculation needs a numeric column")]
    NeedsMeasure,
    #[error("column \"{0}\" is not numeric")]
    NotNumeric(String),
    #[error("column {0} is not in this sheet")]
    UnknownColumn(u32),
    #[error("grouping by more than one column is not supported yet")]
    TooManyGroupColumns,
    #[error("the total is too large to hold exactly")]
    Overflow,
}

#[derive(Default)]
struct Acc {
    spellings: BTreeSet<String>,
    rows: Vec<u32>,
    /// Rows that contributed to the figure (a subset of `rows`).
    used: Vec<u32>,
    rows_used: u32,
    values: u32,
    sum: Decimal2,
    min: Option<Decimal>,
    max: Option<Decimal>,
}

/// `Decimal` accumulator that starts at zero.
struct Decimal2(Decimal);
impl Default for Decimal2 {
    fn default() -> Self {
        Decimal2(Decimal::ZERO)
    }
}

fn norm(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn capped(rows: &[u32]) -> Vec<u32> {
    rows.iter().copied().take(MAX_PROVENANCE_ROWS).collect()
}

fn finish(func: AggFunc, acc: &Acc, scale: u8) -> Result<Option<Decimal>, AggregateError> {
    Ok(match func {
        AggFunc::Count => Some(Decimal::from_int(i64::from(acc.rows_used))),
        _ if acc.values == 0 => None,
        AggFunc::Sum => Some(acc.sum.0),
        AggFunc::Average => Some(
            acc.sum
                .0
                .div_count(u64::from(acc.values), scale.max(2))
                .ok_or(AggregateError::Overflow)?,
        ),
        AggFunc::Min => acc.min,
        AggFunc::Max => acc.max,
    })
}

/// Run a plan against a dataset.
pub fn aggregate(
    ds: &TableDataset,
    plan: &AggregatePlan,
) -> Result<AggregateResult, AggregateError> {
    if plan.group_by.len() > 1 {
        return Err(AggregateError::TooManyGroupColumns);
    }
    let group_slot = match plan.group_by.first() {
        Some(g) => Some(
            ds.slot(g.index)
                .ok_or(AggregateError::UnknownColumn(g.index))?,
        ),
        None => None,
    };
    let measure_slot = match (&plan.measure, plan.func) {
        (None, AggFunc::Count) => None,
        (None, _) => return Err(AggregateError::NeedsMeasure),
        (Some(m), _) => {
            let slot = ds
                .slot(m.index)
                .ok_or(AggregateError::UnknownColumn(m.index))?;
            if ds.columns[slot].kind != ColumnKind::Number {
                return Err(AggregateError::NotNumeric(ds.columns[slot].header.clone()));
            }
            Some(slot)
        }
    };
    let scale = measure_slot.map(|s| ds.columns[s].scale).unwrap_or(0);

    let mut groups: BTreeMap<String, Acc> = BTreeMap::new();
    let mut overall = Acc::default();
    let mut excluded = 0u32;
    let mut blanks: Vec<u32> = Vec::new();
    let mut bad: Vec<u32> = Vec::new();
    let mut unusable: Vec<u32> = Vec::new();
    let mut blank_group: Vec<u32> = Vec::new();

    for row in ds.rows.iter().filter(|r| !r.subtotal) {
        if plan.duplicates == DuplicatePolicy::ExcludeExact && row.duplicate_of.is_some() {
            excluded += 1;
            continue;
        }
        let key_text = group_slot
            .map(|s| norm(&row.cells[s].raw))
            .unwrap_or_default();
        let key = key_text.to_lowercase();
        if group_slot.is_some() && key.is_empty() {
            blank_group.push(row.source_row);
        }
        let mut number: Option<Decimal> = None;
        if let Some(slot) = measure_slot {
            let cell = &row.cells[slot];
            match cell.kind {
                CellKind::Number => number = cell.number,
                CellKind::Blank => blanks.push(row.source_row),
                CellKind::Text => bad.push(row.source_row),
                CellKind::Unusable => unusable.push(row.source_row),
            }
        }
        let apply = |acc: &mut Acc| -> Result<(), AggregateError> {
            acc.rows.push(row.source_row);
            match plan.func {
                AggFunc::Count => {
                    acc.rows_used += 1;
                    acc.used.push(row.source_row);
                }
                _ => {
                    if let Some(n) = number {
                        acc.rows_used += 1;
                        acc.used.push(row.source_row);
                        acc.values += 1;
                        acc.sum.0 = acc.sum.0.checked_add(&n).ok_or(AggregateError::Overflow)?;
                        acc.min = Some(acc.min.map_or(n, |m| m.min(n)));
                        acc.max = Some(acc.max.map_or(n, |m| m.max(n)));
                    }
                }
            }
            Ok(())
        };
        apply(&mut overall)?;
        if group_slot.is_some() {
            let acc = groups.entry(key).or_default();
            acc.spellings.insert(key_text);
            apply(acc)?;
        }
    }

    let mut issues: Vec<TableIssue> = Vec::new();
    let mut push = |code: IssueCode, rows: &[u32], message: String| {
        if !rows.is_empty() {
            issues.push(TableIssue {
                code,
                column: None,
                rows: capped(rows),
                count: rows.len() as u32,
                message,
            });
        }
    };
    let mname = plan
        .measure
        .as_ref()
        .map(|m| m.header.clone())
        .unwrap_or_default();
    push(
        IssueCode::BlankValues,
        &blanks,
        format!(
            "{} blank value(s) in \"{mname}\" were left out.",
            blanks.len()
        ),
    );
    push(
        IssueCode::MalformedNumbers,
        &bad,
        format!(
            "{} value(s) in \"{mname}\" are not valid numbers and were left out.",
            bad.len()
        ),
    );
    push(
        IssueCode::FormulaWithoutValue,
        &unusable,
        format!(
            "{} formula(s) in \"{mname}\" have no saved value and were left out.",
            unusable.len()
        ),
    );
    push(
        IssueCode::BlankGroup,
        &blank_group,
        format!(
            "{} row(s) have no group name; shown as (blank).",
            blank_group.len()
        ),
    );

    let mut out_groups = Vec::with_capacity(groups.len());
    for acc in groups.values() {
        if acc.spellings.len() > 1 {
            let names: Vec<&str> = acc.spellings.iter().map(String::as_str).collect();
            issues.push(TableIssue {
                code: IssueCode::GroupVariantsMerged,
                column: None,
                rows: capped(&acc.rows),
                count: acc.rows.len() as u32,
                message: format!(
                    "Grouped together despite different spelling: {}.",
                    names.join(" / ")
                ),
            });
        }
        let label = match acc.spellings.iter().next().map(String::as_str) {
            Some("") | None => "(blank)".to_string(),
            Some(first) => first.to_string(),
        };
        out_groups.push(GroupResult {
            label,
            value: finish(plan.func, acc, scale)?,
            rows_in_group: acc.rows.len() as u32,
            rows_used: acc.rows_used,
            source_rows: capped(&acc.used),
        });
    }
    let overall_result = GroupResult {
        label: "Total".to_string(),
        value: finish(plan.func, &overall, scale)?,
        rows_in_group: overall.rows.len() as u32,
        rows_used: overall.rows_used,
        source_rows: capped(&overall.used),
    };
    Ok(AggregateResult {
        plan: plan.clone(),
        groups: out_groups,
        overall: overall_result,
        issues,
        excluded_duplicates: excluded,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::table::{build_dataset, BuildOptions, RawCell, RawKind};

    fn ds(rows: &[&[&str]]) -> TableDataset {
        let grid: Vec<Vec<RawCell>> = rows
            .iter()
            .map(|r| r.iter().map(|c| RawCell::text(*c)).collect())
            .collect();
        build_dataset(
            &grid,
            &BuildOptions {
                doc_id: "d".into(),
                file_name: "f.csv".into(),
                ..Default::default()
            },
        )
    }

    fn plan(
        d: &TableDataset,
        func: AggFunc,
        measure: Option<&str>,
        group: Option<&str>,
    ) -> AggregatePlan {
        let col = |h: &str| {
            let c = d.columns.iter().find(|c| c.header == h).unwrap();
            ColumnRef {
                index: c.index,
                header: c.header.clone(),
            }
        };
        let mut p = AggregatePlan::new("d", func);
        p.measure = measure.map(col);
        if let Some(g) = group {
            p.group_by = vec![col(g)];
        }
        p
    }

    fn base() -> TableDataset {
        ds(&[
            &["District", "Orders", "Amount"],
            &["North", "1", "$0.10"],
            &["East", "1", "$0.20"],
            &["North", "1", "$0.20"],
            &["East", "1", "$0.10"],
        ])
    }

    fn total_of(r: &AggregateResult, label: &str) -> String {
        r.groups
            .iter()
            .find(|g| g.label == label)
            .and_then(|g| g.value)
            .map(|v| v.to_plain_string())
            .unwrap_or_default()
    }

    #[test]
    fn exact_totals_where_floats_would_drift() {
        let d = base();
        let r = aggregate(
            &d,
            &plan(&d, AggFunc::Sum, Some("Amount"), Some("District")),
        )
        .unwrap();
        assert_eq!(total_of(&r, "North"), "0.30");
        assert_eq!(total_of(&r, "East"), "0.30");
        assert_eq!(r.overall.value.unwrap().to_plain_string(), "0.60");
    }

    #[test]
    fn currency_and_decimal_values_sum_exactly() {
        let d = ds(&[
            &["District", "Amount"],
            &["North", "$128,430.50"],
            &["North", "$0.25"],
            &["East", "(96,210.00)"],
            &["East", "96210.005"],
        ]);
        let r = aggregate(
            &d,
            &plan(&d, AggFunc::Sum, Some("Amount"), Some("District")),
        )
        .unwrap();
        assert_eq!(total_of(&r, "North"), "128430.75");
        assert_eq!(total_of(&r, "East"), "0.005");
    }

    #[test]
    fn row_order_never_changes_the_answer() {
        let a = ds(&[&["D", "A"], &["x", "1.5"], &["y", "2.5"], &["x", "3"]]);
        let b = ds(&[&["D", "A"], &["x", "3"], &["x", "1.5"], &["y", "2.5"]]);
        let ra = aggregate(&a, &plan(&a, AggFunc::Sum, Some("A"), Some("D"))).unwrap();
        let rb = aggregate(&b, &plan(&b, AggFunc::Sum, Some("A"), Some("D"))).unwrap();
        let vals = |r: &AggregateResult| -> Vec<(String, Option<Decimal>)> {
            r.groups
                .iter()
                .map(|g| (g.label.clone(), g.value))
                .collect()
        };
        assert_eq!(vals(&ra), vals(&rb));
        assert_eq!(ra.overall.value, rb.overall.value);
    }

    #[test]
    fn reordered_columns_resolve_by_heading() {
        let a = ds(&[&["District", "Amount"], &["N", "5"], &["N", "6"]]);
        let b = ds(&[&["Amount", "District"], &["5", "N"], &["6", "N"]]);
        let ra = aggregate(
            &a,
            &plan(&a, AggFunc::Sum, Some("Amount"), Some("District")),
        )
        .unwrap();
        let rb = aggregate(
            &b,
            &plan(&b, AggFunc::Sum, Some("Amount"), Some("District")),
        )
        .unwrap();
        assert_eq!(total_of(&ra, "N"), "11");
        assert_eq!(total_of(&rb, "N"), "11");
    }

    #[test]
    fn blanks_and_bad_values_are_skipped_and_reported() {
        let mut rows: Vec<Vec<&str>> = vec![vec!["District", "Amount"]];
        for _ in 0..6 {
            rows.push(vec!["N", "10"]);
        }
        rows.push(vec!["N", ""]);
        rows.push(vec!["N", "12abc"]);
        let refs: Vec<&[&str]> = rows.iter().map(|r| r.as_slice()).collect();
        let d = ds(&refs);
        let r = aggregate(
            &d,
            &plan(&d, AggFunc::Sum, Some("Amount"), Some("District")),
        )
        .unwrap();
        assert_eq!(total_of(&r, "N"), "60");
        let codes: Vec<IssueCode> = r.issues.iter().map(|i| i.code).collect();
        assert!(codes.contains(&IssueCode::BlankValues));
        assert!(codes.contains(&IssueCode::MalformedNumbers));
        assert_eq!(r.groups[0].rows_in_group, 8);
        assert_eq!(r.groups[0].rows_used, 6);
    }

    #[test]
    fn duplicates_are_kept_by_default_and_excludable() {
        let d = ds(&[
            &["District", "Amount"],
            &["N", "10"],
            &["N", "10"],
            &["S", "5"],
        ]);
        let mut p = plan(&d, AggFunc::Sum, Some("Amount"), Some("District"));
        let keep = aggregate(&d, &p).unwrap();
        assert_eq!(total_of(&keep, "N"), "20");
        assert_eq!(keep.excluded_duplicates, 0);
        p.duplicates = DuplicatePolicy::ExcludeExact;
        let once = aggregate(&d, &p).unwrap();
        assert_eq!(total_of(&once, "N"), "10");
        assert_eq!(once.excluded_duplicates, 1);
    }

    #[test]
    fn subtotal_lines_do_not_double_count() {
        let d = ds(&[
            &["District", "Amount"],
            &["N", "10"],
            &["S", "5"],
            &["Total", "15"],
        ]);
        let r = aggregate(
            &d,
            &plan(&d, AggFunc::Sum, Some("Amount"), Some("District")),
        )
        .unwrap();
        assert_eq!(r.overall.value.unwrap().to_plain_string(), "15");
        assert_eq!(r.groups.len(), 2);
    }

    #[test]
    fn group_names_merge_case_and_spacing_and_say_so() {
        let d = ds(&[
            &["District", "Amount"],
            &["North", "1"],
            &["north ", "2"],
            &["NORTH", "3"],
        ]);
        let r = aggregate(
            &d,
            &plan(&d, AggFunc::Sum, Some("Amount"), Some("District")),
        )
        .unwrap();
        assert_eq!(r.groups.len(), 1);
        assert_eq!(r.groups[0].value.unwrap().to_plain_string(), "6");
        assert!(r
            .issues
            .iter()
            .any(|i| i.code == IssueCode::GroupVariantsMerged));
    }

    #[test]
    fn count_average_min_max() {
        let d = ds(&[
            &["District", "Amount"],
            &["N", "10"],
            &["N", "20"],
            &["N", "25"],
            &["S", "7"],
        ]);
        let count = aggregate(&d, &plan(&d, AggFunc::Count, None, Some("District"))).unwrap();
        assert_eq!(total_of(&count, "N"), "3");
        let avg = aggregate(
            &d,
            &plan(&d, AggFunc::Average, Some("Amount"), Some("District")),
        )
        .unwrap();
        assert_eq!(total_of(&avg, "N"), "18.33");
        assert_eq!(avg.overall.value.unwrap().to_plain_string(), "15.50");
        let max = aggregate(
            &d,
            &plan(&d, AggFunc::Max, Some("Amount"), Some("District")),
        )
        .unwrap();
        assert_eq!(total_of(&max, "N"), "25");
        let min = aggregate(&d, &plan(&d, AggFunc::Min, Some("Amount"), None)).unwrap();
        assert_eq!(min.overall.value.unwrap().to_plain_string(), "7");
        assert!(min.groups.is_empty());
    }

    #[test]
    fn plan_errors_are_explicit() {
        let d = base();
        let mut p = plan(&d, AggFunc::Sum, Some("Amount"), Some("District"));
        p.measure = None;
        assert_eq!(aggregate(&d, &p), Err(AggregateError::NeedsMeasure));
        let p = plan(&d, AggFunc::Sum, Some("District"), None);
        assert!(matches!(
            aggregate(&d, &p),
            Err(AggregateError::NotNumeric(_))
        ));
        let mut p = plan(&d, AggFunc::Sum, Some("Amount"), Some("District"));
        p.group_by.push(p.group_by[0].clone());
        assert_eq!(aggregate(&d, &p), Err(AggregateError::TooManyGroupColumns));
    }

    #[test]
    fn provenance_lists_only_the_rows_that_contributed() {
        let d = ds(&[
            &["D", "A"],
            &["x", "10"],
            &["x", ""],
            &["x", "12abc"],
            &["x", "20"],
            &["x", "30"],
            &["x", "40"],
            &["x", "50"],
            &["x", "60"],
        ]);
        let r = aggregate(&d, &plan(&d, AggFunc::Sum, Some("A"), Some("D"))).unwrap();
        assert_eq!(r.groups[0].rows_in_group, 8);
        assert_eq!(r.groups[0].rows_used, 6);
        // Sheet rows 3 (blank) and 4 (malformed) are not sources of the total.
        assert_eq!(r.groups[0].source_rows, vec![2, 5, 6, 7, 8, 9]);
        assert_eq!(r.overall.source_rows, r.groups[0].source_rows);
    }

    #[test]
    fn provenance_is_capped_but_counted() {
        let mut rows: Vec<Vec<String>> = vec![vec!["D".into(), "A".into()]];
        for i in 0..50 {
            rows.push(vec!["x".into(), format!("{i}")]);
        }
        let refs: Vec<Vec<&str>> = rows
            .iter()
            .map(|r| r.iter().map(String::as_str).collect())
            .collect();
        let slices: Vec<&[&str]> = refs.iter().map(|r| r.as_slice()).collect();
        let d = ds(&slices);
        let r = aggregate(&d, &plan(&d, AggFunc::Sum, Some("A"), Some("D"))).unwrap();
        assert_eq!(r.groups[0].source_rows.len(), MAX_PROVENANCE_ROWS);
        assert_eq!(r.groups[0].rows_in_group, 50);
        assert_eq!(r.groups[0].source_rows[0], 2);
    }

    #[test]
    fn formula_cells_without_values_are_left_out() {
        let mut grid: Vec<Vec<RawCell>> = vec![
            vec![RawCell::text("D"), RawCell::text("A")],
            vec![RawCell::text("x"), RawCell::text("5")],
            vec![RawCell::text("x"), RawCell::text("5")],
            vec![RawCell::text("x"), RawCell::text("6")],
            vec![RawCell::text("x"), RawCell::text("7")],
            vec![RawCell::text("x"), RawCell::text("8")],
        ];
        grid.push(vec![
            RawCell::text("x"),
            RawCell {
                text: "=B2*2".into(),
                kind: RawKind::FormulaNoValue,
            },
        ]);
        let d = build_dataset(&grid, &BuildOptions::default());
        let r = aggregate(&d, &plan(&d, AggFunc::Sum, Some("A"), Some("D"))).unwrap();
        assert_eq!(total_of(&r, "x"), "31");
        assert!(r
            .issues
            .iter()
            .any(|i| i.code == IssueCode::FormulaWithoutValue));
    }
}

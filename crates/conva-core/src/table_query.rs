//! Turn a spoken or typed sentence into an [`AggregatePlan`].
//!
//! Two steps, both pure and model-free:
//!
//! 1. [`parse_request`] recognises "total / how many / average / highest ...
//!    per / by / for each ..." phrasing and pulls out what to compute and how
//!    to group it. Most sentences are not data requests and return `None`.
//! 2. [`plan_request`] resolves those phrases against the columns of the
//!    datasets attached to the active Context. It never guesses: when two
//!    columns fit equally well, or a named column does not exist, it returns
//!    a choice for the user instead of a plan.

use serde::{Deserialize, Serialize};

use crate::table::{ColumnKind, TableColumn, TableDataset, UnsupportedReason};
use crate::table_aggregate::{AggFunc, AggregatePlan, ColumnRef};

/// What the sentence asked for, before any column is chosen.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DataRequest {
    pub func: AggFunc,
    /// Words that name the measure ("net amount"), possibly empty.
    pub measure_words: Vec<String>,
    /// Words that name the grouping column ("district"), if any.
    pub group_words: Vec<String>,
    /// Words after "and" that might name a second grouping column ("by region
    /// **and month**"). Only acted on when they match a real column.
    #[serde(default)]
    pub extra_group_words: Vec<String>,
    /// The sentence as heard, for display.
    pub text: String,
}

const STOP: &[&str] = &[
    "the",
    "a",
    "an",
    "of",
    "all",
    "our",
    "my",
    "your",
    "their",
    "for",
    "what",
    "whats",
    "is",
    "are",
    "me",
    "us",
    "you",
    "can",
    "could",
    "please",
    "tell",
    "give",
    "show",
    "list",
    "do",
    "does",
    "we",
    "have",
    "it",
    "s",
    "to",
    "get",
    "need",
    "up",
    "out",
    "overall",
    "in",
    "that",
    "this",
    "these",
    "those",
    "and",
    "then",
    "so",
    "now",
    "just",
    "i",
    "im",
    "would",
    "will",
    "with",
    "on",
    "from",
    "how",
    "much",
    "many",
    "number",
    "count",
    "whichever",
    "there",
    "be",
    "was",
    "were",
    "at",
];

/// Phrases that name the operation, longest first. `(phrase, function)`.
const FUNCS: &[(&str, AggFunc)] = &[
    ("how many", AggFunc::Count),
    ("number of", AggFunc::Count),
    ("count of", AggFunc::Count),
    ("count", AggFunc::Count),
    ("average", AggFunc::Average),
    ("avg", AggFunc::Average),
    ("mean", AggFunc::Average),
    ("highest", AggFunc::Max),
    ("largest", AggFunc::Max),
    ("biggest", AggFunc::Max),
    ("maximum", AggFunc::Max),
    ("max", AggFunc::Max),
    ("most", AggFunc::Max),
    ("lowest", AggFunc::Min),
    ("smallest", AggFunc::Min),
    ("minimum", AggFunc::Min),
    ("min", AggFunc::Min),
    ("least", AggFunc::Min),
    ("cheapest", AggFunc::Min),
    ("grand total", AggFunc::Sum),
    ("totals", AggFunc::Sum),
    ("total", AggFunc::Sum),
    ("sum", AggFunc::Sum),
    ("add up", AggFunc::Sum),
    ("adds up", AggFunc::Sum),
    ("adding up", AggFunc::Sum),
    ("combined", AggFunc::Sum),
    ("altogether", AggFunc::Sum),
    ("how much", AggFunc::Sum),
];

/// Group markers, longest first.
const MARKERS: &[&str] = &[
    "broken down by",
    "breakdown by",
    "grouped by",
    "group by",
    "organized by",
    "split by",
    "for each",
    "for every",
    "in each",
    "in every",
    "across",
    "per",
    "by",
    "each",
];

const GROUP_END: &[&str] = &[
    "and", "then", "please", "so", "for", "in", "from", "that", "we", "i", "you", "can", "on",
    "is", "are", "with", "if", "so", "since", "because", "but", "or", "when",
];

fn tokens(text: &str) -> Vec<String> {
    let cleaned: String = text
        .to_lowercase()
        .chars()
        .filter(|c| *c != '\'' && *c != '’')
        .map(|c| if c.is_alphanumeric() { c } else { ' ' })
        .collect();
    cleaned.split_whitespace().map(str::to_string).collect()
}

fn find_seq(hay: &[String], needle: &[&str], from: usize) -> Option<usize> {
    if needle.is_empty() || hay.len() < needle.len() {
        return None;
    }
    (from..=hay.len() - needle.len())
        .find(|&i| needle.iter().enumerate().all(|(k, w)| hay[i + k] == *w))
}

fn split_words(phrase: &str) -> Vec<&str> {
    phrase.split(' ').collect()
}

/// Split what was said into its sentences, at `?`, `!` and a full stop that is
/// followed by a space ("3.5" and "sales.csv" stay whole).
fn sentences(text: &str) -> Vec<&str> {
    let mut out = Vec::new();
    let mut start = 0;
    let bytes = text.as_bytes();
    for (i, b) in bytes.iter().enumerate() {
        let ends = matches!(b, b'?' | b'!')
            || (*b == b'.' && bytes.get(i + 1).is_none_or(|n| n.is_ascii_whitespace()));
        if ends {
            let s = text[start..=i].trim();
            if !s.is_empty() {
                out.push(s);
            }
            start = i + 1;
        }
    }
    let tail = text[start..].trim();
    if !tail.is_empty() {
        out.push(tail);
    }
    out
}

/// Recognise a data request. `None` means "not one" — the sentence goes to the
/// normal Ally path untouched. People often say two things at once ("Does the
/// trial balance balance? What's the total debit?"), so the request is taken
/// from the latest sentence that is one, falling back to the whole utterance.
pub fn parse_request(text: &str) -> Option<DataRequest> {
    let parts = sentences(text);
    if parts.len() > 1 {
        if let Some(mut req) = parts.iter().rev().find_map(|s| parse_sentence(s)) {
            req.text = text.trim().to_string();
            return Some(req);
        }
    }
    parse_sentence(text)
}

fn parse_sentence(text: &str) -> Option<DataRequest> {
    let toks = tokens(text);
    if toks.len() < 2 {
        return None;
    }
    // Operation: earliest phrase wins; ties go to the longer phrase (list order).
    let mut func: Option<(usize, usize, AggFunc)> = None;
    for (phrase, f) in FUNCS {
        let words = split_words(phrase);
        if let Some(at) = find_seq(&toks, &words, 0) {
            let better = match func {
                None => true,
                Some((cur_at, cur_len, _)) => {
                    at < cur_at || (at == cur_at && words.len() > cur_len)
                }
            };
            if better {
                func = Some((at, words.len(), *f));
            }
        }
    }
    let (fn_at, fn_len, mut func) = func?;
    // "total number of orders" is a count, not a sum.
    if func == AggFunc::Sum && find_seq(&toks, &["number", "of"], 0).is_some() {
        func = AggFunc::Count;
    }

    // Grouping.
    let mut marker: Option<(usize, usize)> = None;
    for m in MARKERS {
        let words = split_words(m);
        if let Some(at) = find_seq(&toks, &words, 0) {
            if marker.is_none_or(|(a, l)| at < a || (at == a && words.len() > l)) {
                marker = Some((at, words.len()));
            }
        }
    }
    let mut group_words: Vec<String> = Vec::new();
    let mut extra_group_words: Vec<String> = Vec::new();
    let mut consumed: Vec<usize> = Vec::new();
    if let Some((at, len)) = marker {
        consumed.extend(at..at + len);
        let mut i = at + len;
        while i < toks.len() && group_words.len() < 3 {
            let w = &toks[i];
            if GROUP_END.contains(&w.as_str()) {
                break;
            }
            if w == "the" || w == "a" || w == "an" {
                consumed.push(i);
                i += 1;
                continue;
            }
            group_words.push(w.clone());
            consumed.push(i);
            i += 1;
        }
        if i < toks.len() && (toks[i] == "and" || toks[i] == "then") {
            let mut j = i + 1;
            while j < toks.len() && extra_group_words.len() < 3 {
                let w = &toks[j];
                if STOP.contains(&w.as_str()) || GROUP_END.contains(&w.as_str()) {
                    break;
                }
                extra_group_words.push(w.clone());
                consumed.push(j);
                j += 1;
            }
        }
    }

    // Measure: the words right after the operation, up to the grouping marker
    // ("total FEES per office"). Lead-in chatter ("Before we go on, what's the
    // total ...") is never part of it. When nothing follows the operation
    // ("the amount totals for each district") the words just before it are used.
    let content_words = |range: std::ops::Range<usize>| -> Vec<String> {
        range
            .filter(|i| !(fn_at..fn_at + fn_len).contains(i) && !consumed.contains(i))
            .filter_map(|i| toks.get(i))
            .filter(|w| !STOP.contains(&w.as_str()) && !FUNCS.iter().any(|(p, _)| p == w))
            .cloned()
            .collect()
    };
    let after_end = match marker {
        Some((at, _)) if at >= fn_at + fn_len => at,
        _ => toks.len(),
    };
    let mut measure_words = content_words(fn_at + fn_len..after_end);
    if measure_words.is_empty() {
        let before = content_words(fn_at.saturating_sub(6)..fn_at);
        let skip = before.len().saturating_sub(3);
        measure_words = before[skip..].to_vec();
    }
    // A pile of words is a sentence about something else, not the name of a column.
    if measure_words.len() > 3 {
        measure_words.clear();
    }
    if group_words.is_empty() && measure_words.is_empty() {
        return None;
    }
    Some(DataRequest {
        func,
        measure_words,
        group_words,
        extra_group_words,
        text: text.trim().to_string(),
    })
}

fn singular(w: &str) -> String {
    if let Some(stem) = w.strip_suffix("ies") {
        if !stem.is_empty() {
            return format!("{stem}y");
        }
    }
    if let Some(stem) = w.strip_suffix("ses") {
        return format!("{stem}s");
    }
    if w.len() > 3 && w.ends_with('s') && !w.ends_with("ss") {
        return w[..w.len() - 1].to_string();
    }
    w.to_string()
}

fn header_tokens(header: &str) -> Vec<String> {
    tokens(header).iter().map(|t| singular(t)).collect()
}

/// How well `words` names `header`; 0 means not at all. Everything the person
/// said must be in the heading ("amount" fits "Net amount"), so "net fees" does
/// **not** fit a plain "Fees" column: that is a different figure, and adding up
/// the wrong one under the right-looking title is the worst thing to do here.
fn match_score(words: &[String], header: &str) -> u32 {
    let p: Vec<String> = words.iter().map(|w| singular(w)).collect();
    let h = header_tokens(header);
    if p.is_empty() || h.is_empty() {
        return 0;
    }
    let p_in_h = p.iter().all(|w| h.contains(w));
    let h_in_p = h.iter().all(|w| p.contains(w));
    match (p_in_h, h_in_p) {
        (true, true) => 100,
        (true, false) => 50 + 10 * p.len() as u32,
        _ => 0,
    }
}

/// Like [`match_score`] but also true when the heading is only *part* of what
/// was said. Used to decide which **file** a request is about (so the answer can
/// then say "I don't see a ‘net fees’ column"), never to pick a column.
fn loose_score(words: &[String], header: &str) -> u32 {
    let strong = match_score(words, header);
    if strong > 0 {
        return strong;
    }
    let p: Vec<String> = words.iter().map(|w| singular(w)).collect();
    let h = header_tokens(header);
    if !p.is_empty() && !h.is_empty() && h.iter().all(|w| p.contains(w)) {
        30 + 10 * h.len() as u32
    } else {
        0
    }
}

const IDENTIFIER_WORDS: &[&str] = &[
    "id", "year", "zip", "postcode", "code", "phone", "sku", "index", "no",
];

fn looks_like_identifier(header: &str) -> bool {
    header_tokens(header)
        .iter()
        .any(|t| IDENTIFIER_WORDS.contains(&t.as_str()))
}

fn col_ref(c: &TableColumn) -> ColumnRef {
    ColumnRef {
        index: c.index,
        header: c.header.clone(),
    }
}

/// Which slot of a plan a choice fills.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ChoiceSlot {
    Measure,
    Group,
    Dataset,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ChoiceOption {
    /// Column index (Measure/Group) or document id (Dataset), as text.
    pub id: String,
    pub label: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

/// A question waiting on the user, plus everything needed to continue.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PendingChoice {
    pub slot: ChoiceSlot,
    pub request: DataRequest,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub doc_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub group: Option<ColumnRef>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub measure: Option<ColumnRef>,
    pub options: Vec<ChoiceOption>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PlanOutcome {
    /// Not a data request, or nothing attached can answer it: hand it on.
    NotTableRequest,
    Plan(AggregatePlan),
    NeedsChoice {
        question: String,
        pending: PendingChoice,
    },
    Unsupported {
        doc_id: String,
        file_name: String,
        reasons: Vec<UnsupportedReason>,
    },
    /// The request names something the sheet does not have.
    NoMatchingColumn {
        doc_id: String,
        file_name: String,
        message: String,
    },
    /// The request needs more than this version can do.
    TooComplex {
        message: String,
    },
}

enum Slot {
    Resolved(ColumnRef),
    Ambiguous(Vec<ColumnRef>),
    Missing,
}

fn resolve_slot(words: &[String], columns: &[TableColumn], need_numeric: bool) -> Slot {
    let mut scored: Vec<(u32, &TableColumn)> = columns
        .iter()
        .filter(|c| !need_numeric || c.kind == ColumnKind::Number)
        .filter(|c| c.kind != ColumnKind::Empty)
        .map(|c| (match_score(words, &c.header), c))
        .filter(|(s, _)| *s > 0)
        .collect();
    scored.sort_by_key(|a| std::cmp::Reverse(a.0));
    let Some(top) = scored.first().map(|(s, _)| *s) else {
        return Slot::Missing;
    };
    let winners: Vec<&TableColumn> = scored
        .iter()
        .filter(|(s, _)| *s == top)
        .map(|(_, c)| *c)
        .collect();
    if winners.len() == 1 {
        Slot::Resolved(col_ref(winners[0]))
    } else {
        Slot::Ambiguous(winners.into_iter().map(col_ref).collect())
    }
}

fn options_for(ds: &TableDataset, cols: &[ColumnRef]) -> Vec<ChoiceOption> {
    cols.iter()
        .map(|c| ChoiceOption {
            id: c.index.to_string(),
            label: c.header.clone(),
            detail: ds
                .column(c.index)
                .map(|col| format!("column {}", col.index + 1)),
        })
        .collect()
}

enum DatasetPlan {
    Plan(AggregatePlan),
    Choice(String, PendingChoice),
    NoMatch(String),
}

/// How relevant a dataset is to a request: `None` = not at all.
fn relevance(req: &DataRequest, ds: &TableDataset) -> Option<u32> {
    if !req.group_words.is_empty() {
        let g = best_score(&req.group_words, &ds.columns, false)?;
        let m = if req.measure_words.is_empty() {
            0
        } else {
            best_score(&req.measure_words, &ds.columns, true).unwrap_or(0)
        };
        Some(g + m)
    } else if req.func == AggFunc::Count {
        // "How many people are on your team?" must never turn into a row count.
        None
    } else {
        best_score(&req.measure_words, &ds.columns, true)
    }
}

fn best_score(words: &[String], columns: &[TableColumn], numeric_only: bool) -> Option<u32> {
    // Every column counts for deciding *which file* a request is about, even one
    // with nothing usable in it: a person who names it means this file, and the
    // answer should explain why it can't be added up.
    columns
        .iter()
        .filter(|c| !numeric_only || c.kind != ColumnKind::Text)
        .map(|c| loose_score(words, &c.header))
        .max()
        .filter(|s| *s > 0)
}

fn plan_for_dataset(
    req: &DataRequest,
    ds: &TableDataset,
    pinned_group: Option<&ColumnRef>,
    pinned_measure: Option<&ColumnRef>,
) -> DatasetPlan {
    let mut plan = AggregatePlan::new(&ds.doc_id, req.func);

    // Group column.
    if let Some(g) = pinned_group {
        plan.group_by = vec![g.clone()];
    } else if !req.group_words.is_empty() {
        match resolve_slot(&req.group_words, &ds.columns, false) {
            Slot::Resolved(c) => plan.group_by = vec![c],
            Slot::Ambiguous(cols) => {
                return DatasetPlan::Choice(
                    format!("Which column do you want to group by in {}?", ds.file_name),
                    PendingChoice {
                        slot: ChoiceSlot::Group,
                        request: req.clone(),
                        doc_id: Some(ds.doc_id.clone()),
                        group: None,
                        measure: pinned_measure.cloned(),
                        options: options_for(ds, &cols),
                    },
                );
            }
            Slot::Missing => {
                return DatasetPlan::NoMatch(format!(
                    "I can't find a \"{}\" column in {}.",
                    req.group_words.join(" "),
                    ds.file_name
                ));
            }
        }
    }

    // Measure.
    if req.func == AggFunc::Count {
        return DatasetPlan::Plan(plan);
    }
    if let Some(m) = pinned_measure {
        plan.measure = Some(m.clone());
        return DatasetPlan::Plan(plan);
    }
    let group_index = plan.group_by.first().map(|g| g.index);
    let numeric: Vec<ColumnRef> = ds
        .columns
        .iter()
        .filter(|c| c.kind == ColumnKind::Number && Some(c.index) != group_index)
        .map(col_ref)
        .collect();
    let choice = |question: String, cols: &[ColumnRef]| {
        DatasetPlan::Choice(
            question,
            PendingChoice {
                slot: ChoiceSlot::Measure,
                request: req.clone(),
                doc_id: Some(ds.doc_id.clone()),
                group: plan.group_by.first().cloned(),
                measure: None,
                options: options_for(ds, cols),
            },
        )
    };
    if !req.measure_words.is_empty() {
        match resolve_slot(&req.measure_words, &ds.columns, true) {
            Slot::Resolved(c) => {
                plan.measure = Some(c);
                DatasetPlan::Plan(plan)
            }
            Slot::Ambiguous(cols) => choice(
                format!(
                    "Which \"{}\" column do you mean?",
                    req.measure_words.join(" ")
                ),
                &cols,
            ),
            Slot::Missing => {
                // The column exists but holds nothing usable (typically formulas
                // that were never calculated and saved): say that, don't pretend
                // it is absent and offer other columns.
                if let Some(empty) = ds.columns.iter().find(|c| {
                    c.kind == ColumnKind::Empty && loose_score(&req.measure_words, &c.header) > 0
                }) {
                    return DatasetPlan::NoMatch(format!(
                        "The \"{}\" column in {} has no usable numbers. If it holds formulas, open the file in Excel, save it so the results are stored, and attach it again.",
                        empty.header, ds.file_name
                    ));
                }
                if numeric.is_empty() {
                    DatasetPlan::NoMatch(format!(
                        "{} has no numeric columns to work with.",
                        ds.file_name
                    ))
                } else {
                    choice(
                        format!(
                            "I don't see a \"{}\" column in {}. Which number column do you want?",
                            req.measure_words.join(" "),
                            ds.file_name
                        ),
                        &numeric,
                    )
                }
            }
        }
    } else {
        // No measure named: use the only sensible number column, else ask.
        let sensible: Vec<ColumnRef> = numeric
            .iter()
            .filter(|c| !looks_like_identifier(&c.header))
            .cloned()
            .collect();
        match sensible.len() {
            1 => {
                plan.measure = sensible.into_iter().next();
                DatasetPlan::Plan(plan)
            }
            0 if numeric.len() == 1 => {
                plan.measure = numeric.into_iter().next();
                DatasetPlan::Plan(plan)
            }
            0 => DatasetPlan::NoMatch(format!(
                "{} has no numeric columns to work with.",
                ds.file_name
            )),
            _ => choice(
                format!("Which column do you want to {}?", verb(req.func)),
                &sensible,
            ),
        }
    }
}

fn verb(f: AggFunc) -> &'static str {
    match f {
        AggFunc::Sum => "add up",
        AggFunc::Average => "average",
        AggFunc::Min => "find the lowest of",
        AggFunc::Max => "find the highest of",
        AggFunc::Count => "count",
    }
}

fn finish_dataset(req: &DataRequest, ds: &TableDataset) -> PlanOutcome {
    if !ds.is_supported() {
        return PlanOutcome::Unsupported {
            doc_id: ds.doc_id.clone(),
            file_name: ds.file_name.clone(),
            reasons: ds.unsupported.clone(),
        };
    }
    match plan_for_dataset(req, ds, None, None) {
        DatasetPlan::Plan(p) => PlanOutcome::Plan(p),
        DatasetPlan::Choice(question, pending) => PlanOutcome::NeedsChoice { question, pending },
        DatasetPlan::NoMatch(message) => PlanOutcome::NoMatchingColumn {
            doc_id: ds.doc_id.clone(),
            file_name: ds.file_name.clone(),
            message,
        },
    }
}

/// Resolve a request against the datasets attached to the active Context.
pub fn plan_request(req: &DataRequest, datasets: &[&TableDataset]) -> PlanOutcome {
    let mut ranked: Vec<(u32, &TableDataset)> = datasets
        .iter()
        .filter_map(|ds| relevance(req, ds).map(|s| (s, *ds)))
        .collect();
    if ranked.is_empty() {
        return PlanOutcome::NotTableRequest;
    }
    ranked.sort_by_key(|a| std::cmp::Reverse(a.0));
    let top = ranked[0].0;
    let leaders: Vec<&TableDataset> = ranked
        .iter()
        .filter(|(s, _)| *s == top)
        .map(|(_, d)| *d)
        .collect();
    // "by district and month": two grouping columns are not supported yet. Say
    // so only when the second phrase really names a column of a matching file;
    // otherwise it is just more of the sentence ("...and which rep closed most").
    if !req.extra_group_words.is_empty()
        && leaders
            .iter()
            .any(|d| best_score(&req.extra_group_words, &d.columns, false).is_some())
    {
        return PlanOutcome::TooComplex {
            message: "Grouping by two things at once isn't supported yet. Ask for one at a time."
                .into(),
        };
    }
    if leaders.len() == 1 {
        return finish_dataset(req, leaders[0]);
    }
    // Several files fit equally: ask which one.
    let options = leaders
        .iter()
        .map(|d| ChoiceOption {
            id: d.doc_id.clone(),
            label: d.file_name.clone(),
            detail: d.sheet.clone().map(|s| format!("sheet {s}")),
        })
        .collect();
    PlanOutcome::NeedsChoice {
        question: "Which file do you mean?".into(),
        pending: PendingChoice {
            slot: ChoiceSlot::Dataset,
            request: req.clone(),
            doc_id: None,
            group: None,
            measure: None,
            options,
        },
    }
}

/// Continue after the user picks one of a [`PendingChoice`]'s options.
/// An unknown option id yields `NotTableRequest` (a stale or forged answer).
pub fn resolve_choice(
    pending: &PendingChoice,
    option_id: &str,
    datasets: &[&TableDataset],
) -> PlanOutcome {
    if !pending.options.iter().any(|o| o.id == option_id) {
        return PlanOutcome::NotTableRequest;
    }
    let find = |doc: &str| datasets.iter().find(|d| d.doc_id == doc).copied();
    match pending.slot {
        ChoiceSlot::Dataset => match find(option_id) {
            Some(ds) => finish_dataset(&pending.request, ds),
            None => PlanOutcome::NotTableRequest,
        },
        ChoiceSlot::Group | ChoiceSlot::Measure => {
            let Some(ds) = pending.doc_id.as_deref().and_then(find) else {
                return PlanOutcome::NotTableRequest;
            };
            let Some(col) = option_id
                .parse::<u32>()
                .ok()
                .and_then(|i| ds.column(i))
                .map(col_ref)
            else {
                return PlanOutcome::NotTableRequest;
            };
            let (group, measure) = if pending.slot == ChoiceSlot::Group {
                (Some(col), pending.measure.clone())
            } else {
                (pending.group.clone(), Some(col))
            };
            match plan_for_dataset(&pending.request, ds, group.as_ref(), measure.as_ref()) {
                DatasetPlan::Plan(p) => PlanOutcome::Plan(p),
                DatasetPlan::Choice(question, pending) => {
                    PlanOutcome::NeedsChoice { question, pending }
                }
                DatasetPlan::NoMatch(message) => PlanOutcome::NoMatchingColumn {
                    doc_id: ds.doc_id.clone(),
                    file_name: ds.file_name.clone(),
                    message,
                },
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::table::{build_dataset, BuildOptions, RawCell};

    fn ds(doc: &str, file: &str, rows: &[&[&str]]) -> TableDataset {
        let grid: Vec<Vec<RawCell>> = rows
            .iter()
            .map(|r| r.iter().map(|c| RawCell::text(*c)).collect())
            .collect();
        build_dataset(
            &grid,
            &BuildOptions {
                doc_id: doc.into(),
                file_name: file.into(),
                ..Default::default()
            },
        )
    }

    fn sales() -> TableDataset {
        ds(
            "d1",
            "sales.csv",
            &[
                &["District", "Orders", "Amount"],
                &["North", "1", "10.00"],
                &["East", "2", "20.00"],
            ],
        )
    }

    fn plan(text: &str, datasets: &[&TableDataset]) -> PlanOutcome {
        match parse_request(text) {
            Some(r) => plan_request(&r, datasets),
            None => PlanOutcome::NotTableRequest,
        }
    }

    fn expect_plan(o: PlanOutcome) -> AggregatePlan {
        match o {
            PlanOutcome::Plan(p) => p,
            other => panic!("expected a plan, got {other:?}"),
        }
    }

    #[test]
    fn many_phrasings_reach_the_same_plan() {
        let d = sales();
        let phrasings = [
            "What's the total amount per district?",
            "Can you give me the total amount by district",
            "sum of amount for each district",
            "add up the amounts by district please",
            "give me the amount totals for each district",
            "amount grouped by district in total",
            "I need the combined amount across district",
        ];
        for p in phrasings {
            let plan = expect_plan(plan(p, &[&d]));
            assert_eq!(plan.func, AggFunc::Sum, "{p}");
            assert_eq!(plan.measure.as_ref().unwrap().header, "Amount", "{p}");
            assert_eq!(plan.group_by[0].header, "District", "{p}");
        }
    }

    #[test]
    fn other_operations() {
        let d = sales();
        let c = expect_plan(plan("How many orders per district?", &[&d]));
        assert_eq!(c.func, AggFunc::Count);
        assert!(c.measure.is_none());
        let a = expect_plan(plan("What is the average amount by district", &[&d]));
        assert_eq!(a.func, AggFunc::Average);
        let h = expect_plan(plan("highest amount for each district", &[&d]));
        assert_eq!(h.func, AggFunc::Max);
        let l = expect_plan(plan("lowest amount per district", &[&d]));
        assert_eq!(l.func, AggFunc::Min);
        let n = expect_plan(plan("total number of orders by district", &[&d]));
        assert_eq!(n.func, AggFunc::Count);
    }

    #[test]
    fn ungrouped_total_when_the_measure_is_named() {
        let d = sales();
        let p = expect_plan(plan("what is the total amount", &[&d]));
        assert!(p.group_by.is_empty());
        assert_eq!(p.measure.unwrap().header, "Amount");
    }

    #[test]
    fn only_sensible_number_column_is_used_when_unnamed() {
        let d = ds(
            "d",
            "f.csv",
            &[
                &["District", "Year", "Amount"],
                &["N", "2024", "5"],
                &["S", "2025", "6"],
            ],
        );
        let p = expect_plan(plan("total per district", &[&d]));
        assert_eq!(p.measure.unwrap().header, "Amount");
    }

    #[test]
    fn ambiguous_measure_asks_instead_of_guessing() {
        let d = ds(
            "d",
            "f.csv",
            &[
                &["District", "Amount", "Net amount"],
                &["N", "5", "4"],
                &["S", "6", "5"],
            ],
        );
        match plan("what's the total per district", &[&d]) {
            PlanOutcome::NeedsChoice { pending, .. } => {
                assert_eq!(pending.slot, ChoiceSlot::Measure);
                let labels: Vec<&str> = pending.options.iter().map(|o| o.label.as_str()).collect();
                assert_eq!(labels, vec!["Amount", "Net amount"]);
                // Choosing continues to a plan.
                let chosen = resolve_choice(&pending, &pending.options[1].id, &[&d]);
                let p = expect_plan(chosen);
                assert_eq!(p.measure.unwrap().header, "Net amount");
                assert_eq!(p.group_by[0].header, "District");
            }
            other => panic!("expected a choice, got {other:?}"),
        }
    }

    #[test]
    fn two_equally_good_columns_for_a_named_measure_ask() {
        let d = ds(
            "d",
            "f.csv",
            &[
                &["District", "Gross amount", "Net amount"],
                &["N", "5", "4"],
                &["S", "6", "5"],
            ],
        );
        assert!(matches!(
            plan("total amount per district", &[&d]),
            PlanOutcome::NeedsChoice { .. }
        ));
    }

    #[test]
    fn exact_heading_beats_partial_match() {
        let d = ds(
            "d",
            "f.csv",
            &[
                &["District", "Amount", "Net amount"],
                &["N", "5", "4"],
                &["S", "6", "5"],
            ],
        );
        let p = expect_plan(plan("total amount per district", &[&d]));
        assert_eq!(p.measure.unwrap().header, "Amount");
    }

    #[test]
    fn lead_in_chatter_never_becomes_part_of_the_measure() {
        let d = ds(
            "d",
            "billing.csv",
            &[
                &["Office", "Hours", "Fees"],
                &["Boston", "5", "10"],
                &["Hartford", "6", "20"],
            ],
        );
        let p = expect_plan(plan(
            "Before we go on, what's the total fees per office from the billing workbook?",
            &[&d],
        ));
        assert_eq!(p.measure.unwrap().header, "Fees");
        assert_eq!(p.group_by[0].header, "Office");
        let q = expect_plan(plan(
            "Great, thanks for that. So what are the total hours for each office?",
            &[&d],
        ));
        assert_eq!(q.measure.unwrap().header, "Hours");
    }

    #[test]
    fn a_different_measure_is_never_answered_with_a_similar_looking_column() {
        let d = ds(
            "d",
            "billing.csv",
            &[
                &["Office", "Hours", "Fees"],
                &["Boston", "5", "10"],
                &["Hartford", "6", "20"],
            ],
        );
        for (q, missing) in [
            ("what are the total net fees per office", "net fee"),
            (
                "what are the total extended fees per office",
                "extended fee",
            ),
            ("what are the total staff hours per office", "staff hour"),
        ] {
            match plan(q, &[&d]) {
                PlanOutcome::NeedsChoice { question, pending } => {
                    assert!(question.contains("don't see"), "{q}: {question}");
                    assert!(question.to_lowercase().contains(missing), "{q}: {question}");
                    let labels: Vec<&str> =
                        pending.options.iter().map(|o| o.label.as_str()).collect();
                    assert_eq!(labels, vec!["Hours", "Fees"], "{q}");
                }
                other => panic!("{q}: expected a question, got {other:?}"),
            }
        }
        // The exact heading still resolves, and a fuller heading accepts the short phrase.
        let e = ds(
            "e",
            "gross.csv",
            &[
                &["Office", "Net Fees"],
                &["Boston", "10"],
                &["Hartford", "20"],
            ],
        );
        assert!(matches!(
            plan("total net fees per office", &[&e]),
            PlanOutcome::Plan(_)
        ));
        assert!(matches!(
            plan("total fees per office", &[&e]),
            PlanOutcome::Plan(_)
        ));
    }

    #[test]
    fn a_bare_count_or_a_text_only_match_is_never_a_data_request() {
        let d = ds(
            "d",
            "people.csv",
            &[
                &["Team", "Region", "Amount"],
                &["A", "N", "5"],
                &["B", "S", "6"],
            ],
        );
        for s in [
            "How many people are on your team?",
            "How many regions do you cover?",
            "so what do you think about the total for the region we discussed earlier",
        ] {
            assert_eq!(plan(s, &[&d]), PlanOutcome::NotTableRequest, "{s}");
        }
        // Grouped counts are still fine.
        assert!(matches!(
            plan("how many rows per team", &[&d]),
            PlanOutcome::Plan(_)
        ));
    }

    #[test]
    fn a_request_inside_a_longer_utterance_is_still_found() {
        let d = sales();
        for s in [
            "Does the sales file actually balance? What's the total amount per district?",
            "Great, thanks. Before we go on, what's the total amount per district?",
            "What's the total amount per district? I want to compare it with last year.",
        ] {
            let p = expect_plan(plan(s, &[&d]));
            assert_eq!(p.measure.as_ref().unwrap().header, "Amount", "{s}");
            assert_eq!(p.group_by[0].header, "District", "{s}");
        }
        // Decimals and file names do not split a sentence.
        let r = parse_request("total amount per district in Q3-district-sales.csv for 3.5 percent")
            .unwrap();
        assert_eq!(r.group_words, vec!["district"]);
        // The full text is kept for display.
        assert!(parse_request("Ok. Total amount per district?")
            .unwrap()
            .text
            .starts_with("Ok."));
    }

    #[test]
    fn a_column_of_uncalculated_formulas_is_named_not_called_missing() {
        use crate::table::RawKind;
        let mut grid: Vec<Vec<RawCell>> = vec![vec![
            RawCell::text("Client"),
            RawCell::text("Hours"),
            RawCell::text("Extended Fees"),
        ]];
        for (c, h) in [("A", "5"), ("B", "6")] {
            grid.push(vec![
                RawCell::text(c),
                RawCell::text(h),
                RawCell {
                    text: "=B2*10".into(),
                    kind: RawKind::FormulaNoValue,
                },
            ]);
        }
        let d = build_dataset(
            &grid,
            &BuildOptions {
                doc_id: "d".into(),
                file_name: "wip.xlsx".into(),
                ..Default::default()
            },
        );
        match plan("total extended fees per client", &[&d]) {
            PlanOutcome::NoMatchingColumn { message, .. } => {
                assert!(message.contains("Extended Fees"), "{message}");
                assert!(message.contains("save it"), "{message}");
            }
            other => panic!("{other:?}"),
        }
        // Other columns of the same sheet still work.
        assert!(matches!(
            plan("total hours per client", &[&d]),
            PlanOutcome::Plan(_)
        ));
    }

    #[test]
    fn unknown_measure_offers_the_number_columns() {
        let d = sales();
        match plan("total budget per district", &[&d]) {
            PlanOutcome::NeedsChoice { pending, question } => {
                assert!(question.contains("budget"));
                assert!(pending.options.iter().any(|o| o.label == "Amount"));
            }
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn unknown_group_is_not_ours_when_no_file_fits() {
        let d = sales();
        assert_eq!(
            plan("total amount per planet", &[&d]),
            PlanOutcome::NotTableRequest
        );
    }

    #[test]
    fn ordinary_conversation_is_left_alone() {
        let d = sales();
        for s in [
            "Thanks for joining today",
            "We should total this up later",
            "What time works for you?",
            "How many people are on your team?",
            "Tell me about your experience",
        ] {
            assert_eq!(plan(s, &[&d]), PlanOutcome::NotTableRequest, "{s}");
        }
    }

    #[test]
    fn no_datasets_means_nothing_to_do() {
        assert_eq!(
            plan("total amount per district", &[]),
            PlanOutcome::NotTableRequest
        );
    }

    #[test]
    fn unsupported_sheets_are_named() {
        let mut d = sales();
        d.unsupported.push(UnsupportedReason::MergedCells);
        match plan("total amount per district", &[&d]) {
            PlanOutcome::Unsupported {
                reasons, file_name, ..
            } => {
                assert_eq!(reasons, vec![UnsupportedReason::MergedCells]);
                assert_eq!(file_name, "sales.csv");
            }
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn two_files_that_both_fit_ask_which() {
        let a = sales();
        let mut b = sales();
        b.doc_id = "d2".into();
        b.file_name = "sales-old.csv".into();
        match plan("total amount per district", &[&a, &b]) {
            PlanOutcome::NeedsChoice { pending, .. } => {
                assert_eq!(pending.slot, ChoiceSlot::Dataset);
                let p = expect_plan(resolve_choice(&pending, "d2", &[&a, &b]));
                assert_eq!(p.doc_id, "d2");
            }
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn the_better_fitting_file_wins_without_asking() {
        let a = sales();
        let b = ds(
            "d2",
            "hr.csv",
            &[&["Team", "Headcount"], &["A", "3"], &["B", "4"]],
        );
        let p = expect_plan(plan("total amount per district", &[&a, &b]));
        assert_eq!(p.doc_id, "d1");
        let q = expect_plan(plan("total headcount per team", &[&a, &b]));
        assert_eq!(q.doc_id, "d2");
    }

    #[test]
    fn stale_or_forged_choices_do_nothing() {
        let d = ds(
            "d",
            "f.csv",
            &[&["District", "Amount", "Net amount"], &["N", "5", "4"]],
        );
        if let PlanOutcome::NeedsChoice { pending, .. } = plan("total per district", &[&d]) {
            assert_eq!(
                resolve_choice(&pending, "99", &[&d]),
                PlanOutcome::NotTableRequest
            );
            assert_eq!(
                resolve_choice(&pending, "1", &[]),
                PlanOutcome::NotTableRequest
            );
        } else {
            panic!("expected a choice");
        }
    }

    #[test]
    fn a_long_rambling_question_is_not_a_data_request_even_when_it_says_and() {
        let d = sales();
        // No table attached: nothing to decline, nothing to swallow.
        for s in [
            "average deal size by region and which rep closed most",
            "how many people per team and which tools do they use",
        ] {
            assert_eq!(plan(s, &[]), PlanOutcome::NotTableRequest, "{s}");
        }
        // With a table attached the trailing clause is ignored unless it is a column.
        let p = expect_plan(plan(
            "total amount by district and which rep closed most",
            &[&d],
        ));
        assert_eq!(p.group_by[0].header, "District");
    }

    #[test]
    fn so_many_leftover_words_is_not_a_measure() {
        let r = parse_request(
            "so what do you think about the total for the region we discussed earlier",
        );
        // Nothing here names a column; the parser must not invent one.
        assert!(r.is_none() || r.unwrap().measure_words.len() <= 3);
        let d = ds(
            "d",
            "f.csv",
            &[&["Region", "Amount"], &["N", "5"], &["S", "6"]],
        );
        assert_eq!(
            plan(
                "so what do you think about the total for the region we discussed earlier",
                &[&d]
            ),
            PlanOutcome::NotTableRequest
        );
    }

    #[test]
    fn two_grouping_columns_are_declined_politely() {
        let d = sales();
        assert!(matches!(
            plan("total amount by district and orders", &[&d]),
            PlanOutcome::TooComplex { .. }
        ));
    }

    #[test]
    fn plural_headings_match_singular_speech() {
        let d = ds(
            "d",
            "f.csv",
            &[&["Regions", "Sales"], &["N", "5"], &["S", "6"]],
        );
        let p = expect_plan(plan("total sales per region", &[&d]));
        assert_eq!(p.group_by[0].header, "Regions");
        assert_eq!(p.measure.unwrap().header, "Sales");
    }
}

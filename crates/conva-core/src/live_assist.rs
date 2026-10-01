//! Live assist — the pure state machine behind "ask Conva to add that up".
//!
//! The shell's coordinator thread owns an [`AssistCoordinator`] and feeds it
//! finalized turns. For each turn it gets back results to emit right away (a
//! holding response, a question, or a polite decline) and, when real work is
//! needed, a [`Job`] to run off the audio and UI paths. Everything here is
//! deterministic and clock-free (time is passed in), so the whole holding →
//! grid progression, supersession and choice flow is unit-tested without
//! threads, files or a UI.

use std::collections::BTreeMap;

use crate::decimal::Decimal;
use crate::ipc::{
    GridAlign, GridCell, GridColumn, GridNotice, GridPayload, GridRow, GridRowKind, LiveAssistKind,
    LiveAssistLifecycle, LiveAssistPayload, LiveAssistResult, LiveAssistTiming, NoticeLevel,
    SourceRef, LIVE_ASSIST_CONTRACT_VERSION,
};
use crate::table::{IssueCode, TableColumn, TableDataset, TableIssue};
use crate::table_aggregate::{
    aggregate, AggFunc, AggregateError, AggregatePlan, AggregateResult, DuplicatePolicy,
    GroupResult,
};
use crate::table_query::{parse_request, plan_request, resolve_choice, PendingChoice, PlanOutcome};

/// Most group rows drawn in a grid; the rest fold into an exact "Other" line.
pub const MAX_GRID_GROUPS: usize = 200;

/// Cheap pre-check: could this sentence be a data request at all? The shell
/// calls this before touching any file.
pub fn looks_like_data_request(text: &str) -> bool {
    parse_request(text).is_some()
}

/// Would [`AssistCoordinator::on_turn`] do anything with this sentence?
/// The shell's typed-question path uses it to decide whether to answer with a
/// grid or hand the question to Ally untouched.
pub fn would_handle(text: &str, datasets: &[&TableDataset]) -> bool {
    parse_request(text)
        .map(|req| plan_request(&req, datasets) != PlanOutcome::NotTableRequest)
        .unwrap_or(false)
}

/// One finalized turn (or typed question) handed to the coordinator.
#[derive(Debug, Clone)]
pub struct TurnInput {
    pub session_id: String,
    pub context_id: Option<String>,
    /// `{session}:them:{seq}` or `{session}:ask:{n}`.
    pub correlation_id: String,
    pub text: String,
    /// Unix ms when the turn was queued for the coordinator.
    pub enqueued_at_unix_ms: u64,
    /// Unix ms when the coordinator started handling it.
    pub now_unix_ms: u64,
}

/// Work to run on the coordinator thread after the immediate results are out.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Job {
    pub result_id: String,
    pub plan: AggregatePlan,
}

/// What the coordinator wants done for a turn.
#[derive(Debug, Default)]
pub struct Step {
    /// Emit these, in order, right away.
    pub emit: Vec<LiveAssistResult>,
    pub job: Option<Job>,
}

struct Entry {
    latest: LiveAssistResult,
    pending: Option<PendingChoice>,
}

/// Tracks every live-assist result of one session.
pub struct AssistCoordinator {
    session_id: String,
    counter: u32,
    entries: BTreeMap<String, Entry>,
}

impl AssistCoordinator {
    pub fn new(session_id: &str) -> Self {
        Self {
            session_id: session_id.to_string(),
            counter: 0,
            entries: BTreeMap::new(),
        }
    }

    pub fn latest(&self, result_id: &str) -> Option<&LiveAssistResult> {
        self.entries.get(result_id).map(|e| &e.latest)
    }

    /// Handle a finalized turn. `datasets` must already be limited to the
    /// active Context's attached documents.
    pub fn on_turn(&mut self, turn: &TurnInput, datasets: &[&TableDataset]) -> Step {
        let Some(req) = parse_request(&turn.text) else {
            return Step::default();
        };
        let outcome = plan_request(&req, datasets);
        if outcome == PlanOutcome::NotTableRequest {
            return Step::default();
        }
        self.counter += 1;
        let result_id = format!("la-{}-{}", self.session_id, self.counter);
        let mut step = Step::default();

        // A new request replaces anything older that is still waiting.
        step.emit
            .extend(self.supersede_open(&result_id, turn.now_unix_ms));

        let base = LiveAssistResult {
            contract_version: LIVE_ASSIST_CONTRACT_VERSION,
            result_id: result_id.clone(),
            correlation_id: turn.correlation_id.clone(),
            session_id: turn.session_id.clone(),
            context_id: turn.context_id.clone(),
            revision: 0,
            kind: LiveAssistKind::TableAggregate,
            lifecycle: LiveAssistLifecycle::Provisional,
            question: turn.text.trim().to_string(),
            say_now: None,
            payload: None,
            timing: LiveAssistTiming {
                enqueued_at_unix_ms: turn.enqueued_at_unix_ms,
                ..Default::default()
            },
            superseded_by: None,
        };
        let (result, pending, job) = self.first_response(base, outcome, datasets, turn.now_unix_ms);
        self.entries.insert(
            result_id.clone(),
            Entry {
                latest: result.clone(),
                pending,
            },
        );
        step.emit.push(result);
        step.job = job.map(|plan| Job { result_id, plan });
        step
    }

    /// The user picked an option on a `needs_choice` result.
    pub fn choose(
        &mut self,
        result_id: &str,
        option_id: &str,
        now_unix_ms: u64,
        datasets: &[&TableDataset],
    ) -> Step {
        let Some(entry) = self.entries.get_mut(result_id) else {
            return Step::default();
        };
        if entry.latest.lifecycle != LiveAssistLifecycle::NeedsChoice {
            return Step::default();
        }
        let Some(pending) = entry.pending.take() else {
            return Step::default();
        };
        let outcome = resolve_choice(&pending, option_id, datasets);
        if outcome == PlanOutcome::NotTableRequest {
            // Stale or unknown option: keep waiting for a valid pick.
            entry.pending = Some(pending);
            return Step::default();
        }
        // The choice restarts the clock: latency is measured from the tap.
        let mut base = entry.latest.clone();
        base.timing = LiveAssistTiming {
            enqueued_at_unix_ms: now_unix_ms,
            ..Default::default()
        };
        base.lifecycle = LiveAssistLifecycle::Provisional;
        let (result, pending, job) = self.first_response(base, outcome, datasets, now_unix_ms);
        if let Some(entry) = self.entries.get_mut(result_id) {
            entry.latest = result.clone();
            entry.pending = pending;
        }
        Step {
            emit: vec![result],
            job: job.map(|plan| Job {
                result_id: result_id.to_string(),
                plan,
            }),
        }
    }

    /// Run a job's computation and produce its final result. Returns nothing
    /// if the result was superseded while it waited.
    pub fn complete(
        &mut self,
        job: &Job,
        ds: &TableDataset,
        clock: &mut dyn FnMut() -> u64,
    ) -> Vec<LiveAssistResult> {
        let Some(entry) = self.entries.get(&job.result_id) else {
            return Vec::new();
        };
        if entry.latest.lifecycle != LiveAssistLifecycle::Provisional {
            return Vec::new();
        }
        let started = clock();
        let computed = compute(ds, &job.plan);
        let finished = clock();
        let mut result = entry.latest.clone();
        result.revision += 1;
        result.timing.compute_ms = Some(finished.saturating_sub(started));
        result.timing.emitted_ms = Some(finished.saturating_sub(result.timing.enqueued_at_unix_ms));
        match computed {
            Ok(done) => {
                result.lifecycle = LiveAssistLifecycle::Complete;
                result.say_now = Some(done.say_now);
                result.payload = Some(LiveAssistPayload::Grid(done.grid));
            }
            Err(err) => {
                result.lifecycle = LiveAssistLifecycle::Failed;
                result.say_now = Some("I couldn't work that out.".to_string());
                result.payload = Some(LiveAssistPayload::Text {
                    text: format!("I couldn't calculate that: {err}."),
                });
            }
        }
        if let Some(entry) = self.entries.get_mut(&job.result_id) {
            entry.latest = result.clone();
        }
        vec![result]
    }

    /// A job cannot run (its spreadsheet is no longer attached to the active
    /// Context, or could not be loaded). End the result honestly instead of
    /// leaving the holding response on screen forever.
    pub fn abandon(&mut self, job: &Job, reason: &str, now_unix_ms: u64) -> Vec<LiveAssistResult> {
        let Some(entry) = self.entries.get_mut(&job.result_id) else {
            return Vec::new();
        };
        if entry.latest.lifecycle != LiveAssistLifecycle::Provisional {
            return Vec::new();
        }
        let mut r = entry.latest.clone();
        r.revision += 1;
        r.lifecycle = LiveAssistLifecycle::Declined;
        r.say_now = Some("I can't get to that spreadsheet right now.".to_string());
        r.payload = Some(LiveAssistPayload::Text {
            text: reason.to_string(),
        });
        r.timing.emitted_ms = Some(now_unix_ms.saturating_sub(r.timing.enqueued_at_unix_ms));
        entry.latest = r.clone();
        vec![r]
    }

    fn supersede_open(&mut self, new_id: &str, now_unix_ms: u64) -> Vec<LiveAssistResult> {
        let mut out = Vec::new();
        for (id, entry) in self.entries.iter_mut() {
            if id == new_id || entry.latest.lifecycle.is_final() {
                continue;
            }
            let mut r = entry.latest.clone();
            r.revision += 1;
            r.lifecycle = LiveAssistLifecycle::Superseded;
            r.superseded_by = Some(new_id.to_string());
            r.timing.emitted_ms = Some(now_unix_ms.saturating_sub(r.timing.enqueued_at_unix_ms));
            entry.pending = None;
            entry.latest = r.clone();
            out.push(r);
        }
        out
    }

    fn first_response(
        &self,
        mut base: LiveAssistResult,
        outcome: PlanOutcome,
        datasets: &[&TableDataset],
        now: u64,
    ) -> (
        LiveAssistResult,
        Option<PendingChoice>,
        Option<AggregatePlan>,
    ) {
        base.revision += 1;
        let since = now.saturating_sub(base.timing.enqueued_at_unix_ms);
        base.timing.holding_ms = Some(since);
        base.timing.emitted_ms = Some(since);
        let mut pending = None;
        let mut job = None;
        match outcome {
            PlanOutcome::Plan(plan) => {
                let file = datasets
                    .iter()
                    .find(|d| d.doc_id == plan.doc_id)
                    .map(|d| d.file_name.as_str())
                    .unwrap_or("your spreadsheet");
                base.lifecycle = LiveAssistLifecycle::Provisional;
                base.say_now = Some(format!("One moment, I'm working that out from {file}."));
                base.payload = Some(LiveAssistPayload::Text {
                    text: holding_text(&plan, file),
                });
                job = Some(plan);
            }
            PlanOutcome::NeedsChoice {
                question,
                pending: p,
            } => {
                base.lifecycle = LiveAssistLifecycle::NeedsChoice;
                base.say_now = Some("Let me check which one you mean.".to_string());
                base.payload = Some(LiveAssistPayload::Choice {
                    question,
                    options: p.options.clone(),
                });
                pending = Some(p);
            }
            PlanOutcome::Unsupported {
                file_name, reasons, ..
            } => {
                base.lifecycle = LiveAssistLifecycle::Declined;
                let why: Vec<&str> = reasons.iter().map(|r| r.describe()).collect();
                base.say_now = Some("I can't total that sheet safely yet.".to_string());
                base.payload = Some(LiveAssistPayload::Text {
                    text: format!(
                        "I can't total {file_name} safely because {}. Export one sheet as a CSV with a single heading row and attach that instead.",
                        why.join(" and ")
                    ),
                });
            }
            PlanOutcome::NoMatchingColumn { message, .. } => {
                base.lifecycle = LiveAssistLifecycle::Declined;
                base.say_now = Some("I don't see that column in the file.".to_string());
                base.payload = Some(LiveAssistPayload::Text { text: message });
            }
            PlanOutcome::TooComplex { message } => {
                base.lifecycle = LiveAssistLifecycle::Declined;
                base.say_now = Some("Let me do that one piece at a time.".to_string());
                base.payload = Some(LiveAssistPayload::Text { text: message });
            }
            PlanOutcome::NotTableRequest => {}
        }
        (base, pending, job)
    }
}

fn holding_text(plan: &AggregatePlan, file: &str) -> String {
    let verb = match plan.func {
        AggFunc::Sum => "Adding up",
        AggFunc::Count => "Counting rows in",
        AggFunc::Average => "Averaging",
        AggFunc::Max => "Finding the highest in",
        AggFunc::Min => "Finding the lowest in",
    };
    let measure = plan.measure.as_ref().map(|m| m.header.as_str());
    let group = plan.group_by.first().map(|g| g.header.as_str());
    match (measure, group) {
        (Some(m), Some(g)) => format!("{verb} {m} by {g} from {file}…"),
        (Some(m), None) => format!("{verb} {m} from {file}…"),
        (None, Some(g)) => format!("{verb} {file} by {g}…"),
        (None, None) => format!("{verb} {file}…"),
    }
}

/// A finished answer.
pub struct Completed {
    pub grid: GridPayload,
    pub say_now: String,
}

fn currency_parts(col: Option<&TableColumn>) -> (Option<String>, Option<String>) {
    match col.and_then(|c| c.currency.clone()) {
        Some(c) if c.chars().count() == 1 => (Some(c), None),
        Some(code) => (None, Some(code)),
        None => (None, None),
    }
}

fn format_value(v: Decimal, func: AggFunc, col: Option<&TableColumn>) -> String {
    if func == AggFunc::Count {
        return v.to_grouped_string(0);
    }
    let min_scale = col.map(|c| c.scale).unwrap_or(0);
    let (prefix, suffix) = currency_parts(col);
    let negative = v.is_negative();
    let abs = Decimal::new(v.units.abs(), v.scale);
    let body = abs.to_grouped_string(min_scale);
    let mut out = String::new();
    if negative {
        out.push('-');
    }
    if let Some(p) = prefix {
        out.push_str(&p);
    }
    out.push_str(&body);
    if col.map(|c| c.percent).unwrap_or(false) {
        out.push('%');
    }
    if let Some(s) = suffix {
        out.push(' ');
        out.push_str(&s);
    }
    out
}

fn func_label(func: AggFunc) -> &'static str {
    func.label()
}

fn value_label(func: AggFunc, measure: Option<&str>) -> String {
    match (func, measure) {
        (AggFunc::Count, _) => "Rows".to_string(),
        (AggFunc::Sum, Some(m)) => m.to_string(),
        (f, Some(m)) => format!("{} {m}", func_label(f)),
        (f, None) => func_label(f).to_string(),
    }
}

fn source_for(ds: &TableDataset, column: Option<&str>, g: &GroupResult) -> SourceRef {
    SourceRef {
        doc_id: ds.doc_id.clone(),
        file_name: ds.file_name.clone(),
        sheet: ds.sheet.clone(),
        column: column.map(str::to_string),
        rows: g.source_rows.clone(),
        // Rows that contributed, not every row in the group: skipped blanks
        // are reported in the notices instead of being claimed as sources.
        row_count: g.rows_used,
    }
}

fn notice(level: NoticeLevel, text: String, rows: &[u32]) -> GridNotice {
    GridNotice {
        level,
        text,
        rows: rows
            .iter()
            .copied()
            .take(crate::table::MAX_PROVENANCE_ROWS)
            .collect(),
    }
}

/// Compute a plan and build its grid, say-now line and notices.
pub fn compute(ds: &TableDataset, plan: &AggregatePlan) -> Result<Completed, AggregateError> {
    let result = aggregate(ds, plan)?;
    // What the answer would be without exact repeats, when there are any.
    let alt = if plan.duplicates == DuplicatePolicy::KeepAll && ds.duplicate_count() > 0 {
        let mut p = plan.clone();
        p.duplicates = DuplicatePolicy::ExcludeExact;
        Some(aggregate(ds, &p)?)
    } else {
        None
    };
    Ok(build_completed(ds, &result, alt.as_ref()))
}

fn build_completed(
    ds: &TableDataset,
    r: &AggregateResult,
    alt: Option<&AggregateResult>,
) -> Completed {
    let plan = &r.plan;
    let measure_name = plan.measure.as_ref().map(|m| m.header.as_str());
    let measure_col = plan.measure.as_ref().and_then(|m| ds.column(m.index));
    let group_name = plan.group_by.first().map(|g| g.header.as_str());
    let vlabel = value_label(plan.func, measure_name);
    let show_rows = plan.func != AggFunc::Count;

    let mut hidden_groups = 0usize;
    let value_cell = |g: &GroupResult| -> GridCell {
        match g.value {
            Some(v) => GridCell {
                text: format_value(v, plan.func, measure_col),
                value: Some(v.to_plain_string()),
                sources: vec![source_for(ds, measure_name, g)],
            },
            None => GridCell {
                text: "—".to_string(),
                value: None,
                sources: vec![source_for(ds, measure_name, g)],
            },
        }
    };
    let label_cell = |s: &str| GridCell {
        text: s.to_string(),
        value: None,
        sources: Vec::new(),
    };
    let rows_cell = |g: &GroupResult| GridCell {
        text: g.rows_used.to_string(),
        value: Some(g.rows_used.to_string()),
        sources: Vec::new(),
    };

    let (columns, rows, title) = if let Some(group) = group_name {
        let mut columns = vec![
            GridColumn {
                key: "group".into(),
                label: group.to_string(),
                align: GridAlign::Left,
            },
            GridColumn {
                key: "value".into(),
                label: vlabel.clone(),
                align: GridAlign::Right,
            },
        ];
        if show_rows {
            columns.push(GridColumn {
                key: "rows".into(),
                label: "Rows".into(),
                align: GridAlign::Right,
            });
        }
        // A sheet with tens of thousands of distinct groups must not become a
        // tens-of-thousands-row grid: keep the largest and fold the rest.
        let (shown, hidden): (Vec<&GroupResult>, Vec<&GroupResult>) =
            if r.groups.len() > MAX_GRID_GROUPS {
                let mut sorted: Vec<&GroupResult> = r.groups.iter().collect();
                sorted.sort_by(|a, b| b.value.cmp(&a.value).then_with(|| a.label.cmp(&b.label)));
                let hidden = sorted.split_off(MAX_GRID_GROUPS);
                (sorted, hidden)
            } else {
                (r.groups.iter().collect(), Vec::new())
            };
        hidden_groups = hidden.len();
        let mut rows: Vec<GridRow> = shown
            .iter()
            .map(|g| {
                let mut cells = vec![label_cell(&g.label), value_cell(g)];
                if show_rows {
                    cells.push(rows_cell(g));
                }
                GridRow {
                    kind: GridRowKind::Body,
                    cells,
                }
            })
            .collect();
        if !hidden.is_empty() && matches!(plan.func, AggFunc::Sum | AggFunc::Count) {
            // Exact "everything else" line, so the visible rows still add up.
            let other = hidden
                .iter()
                .try_fold((Decimal::ZERO, 0u32), |(sum, used), g| {
                    Some((
                        sum.checked_add(&g.value.unwrap_or(Decimal::ZERO))?,
                        used + g.rows_used,
                    ))
                });
            if let Some((sum, used)) = other {
                let mut cells = vec![
                    label_cell(&format!("Other ({} groups)", hidden.len())),
                    GridCell {
                        text: format_value(sum, plan.func, measure_col),
                        value: Some(sum.to_plain_string()),
                        sources: Vec::new(),
                    },
                ];
                if show_rows {
                    cells.push(GridCell {
                        text: used.to_string(),
                        value: Some(used.to_string()),
                        sources: Vec::new(),
                    });
                }
                rows.push(GridRow {
                    kind: GridRowKind::Body,
                    cells,
                });
            }
        }
        let total_label = if matches!(plan.func, AggFunc::Sum | AggFunc::Count) {
            "Total"
        } else {
            "All rows"
        };
        let mut cells = vec![label_cell(total_label), value_cell(&r.overall)];
        if show_rows {
            cells.push(rows_cell(&r.overall));
        }
        rows.push(GridRow {
            kind: GridRowKind::Total,
            cells,
        });
        let title = match measure_name {
            Some(m) => format!("{} by {group}", titled(plan.func, m)),
            None => format!("{} by {group}", func_label(plan.func)),
        };
        (columns, rows, title)
    } else {
        let columns = vec![
            GridColumn {
                key: "label".into(),
                label: "Result".into(),
                align: GridAlign::Left,
            },
            GridColumn {
                key: "value".into(),
                label: "Value".into(),
                align: GridAlign::Right,
            },
        ];
        let title = match measure_name {
            Some(m) => titled(plan.func, m),
            None => func_label(plan.func).to_string(),
        };
        let rows = vec![GridRow {
            kind: GridRowKind::Total,
            cells: vec![label_cell(&title), value_cell(&r.overall)],
        }];
        (columns, rows, title)
    };

    // Notices: everything skipped or worth checking, tied to source rows.
    let mut notices: Vec<GridNotice> = Vec::new();
    for issue in &r.issues {
        notices.push(notice(
            NoticeLevel::Caution,
            issue.message.clone(),
            &issue.rows,
        ));
    }
    if let Some(alt_r) = alt {
        let dups: Vec<u32> = ds
            .rows
            .iter()
            .filter(|row| row.duplicate_of.is_some() && !row.subtotal)
            .map(|row| row.source_row)
            .collect();
        let alt_text = alt_r
            .overall
            .value
            .map(|v| format_value(v, plan.func, measure_col))
            .unwrap_or_else(|| "—".into());
        notices.push(notice(
            NoticeLevel::Caution,
            format!(
                "{} row(s) exactly repeat an earlier row. They are all counted, as the file has them. Without the repeats the {} would be {alt_text}.",
                dups.len(),
                overall_noun(plan.func, measure_name)
            ),
            &dups,
        ));
    }
    for issue in dataset_notices(ds, plan) {
        notices.push(issue);
    }
    if hidden_groups > 0 {
        notices.push(notice(
            NoticeLevel::Info,
            format!(
                "{} groups in all. The {MAX_GRID_GROUPS} largest are shown, in order of size.",
                r.groups.len()
            ),
            &[],
        ));
    }

    let say_now = say_now_line(ds, r, measure_name, measure_col);
    Completed {
        grid: GridPayload {
            title,
            columns,
            rows,
            notices,
            source_files: vec![ds.file_name.clone()],
        },
        say_now,
    }
}

/// "Total Amount" for a sum of `Amount`; a heading that already says "Total"
/// ("Total Due") is not prefixed a second time.
fn titled(func: AggFunc, measure: &str) -> String {
    if func == AggFunc::Sum && measure.to_lowercase().starts_with("total") {
        measure.to_string()
    } else {
        format!("{} {measure}", func_label(func))
    }
}

fn overall_noun(func: AggFunc, measure: Option<&str>) -> String {
    let m = measure.unwrap_or("rows").to_lowercase();
    match func {
        AggFunc::Sum => format!("total {m}"),
        AggFunc::Count => "count".to_string(),
        AggFunc::Average => format!("average {m}"),
        AggFunc::Max => format!("highest {m}"),
        AggFunc::Min => format!("lowest {m}"),
    }
}

fn dataset_notices(ds: &TableDataset, plan: &AggregatePlan) -> Vec<GridNotice> {
    let measure_index = plan.measure.as_ref().map(|m| m.index);
    ds.issues
        .iter()
        .filter(|i: &&TableIssue| match i.code {
            IssueCode::SubtotalRowSkipped | IssueCode::OtherSheetsIgnored => true,
            IssueCode::MixedCurrency => i.column == measure_index,
            _ => false,
        })
        .map(|i| {
            // Dropping rows silently is worth a "Check": left-out total lines
            // and mixed currencies both change what the number means.
            let level = if matches!(
                i.code,
                IssueCode::MixedCurrency | IssueCode::SubtotalRowSkipped
            ) {
                NoticeLevel::Caution
            } else {
                NoticeLevel::Info
            };
            notice(level, i.message.clone(), &i.rows)
        })
        .collect()
}

fn say_now_line(
    ds: &TableDataset,
    r: &AggregateResult,
    measure: Option<&str>,
    col: Option<&TableColumn>,
) -> String {
    let func = r.plan.func;
    let fmt = |v: Decimal| format_value(v, func, col);
    let overall = r.overall.value.map(fmt);
    let m = measure.map(str::to_lowercase).unwrap_or_default();
    let Some(overall) = overall else {
        return format!(
            "I couldn't find any numbers to work with in {}.",
            ds.file_name
        );
    };
    // The group that best illustrates the answer, first in name order on ties.
    let pick = |better: fn(&Decimal, &Decimal) -> bool| -> Option<&GroupResult> {
        let mut best: Option<&GroupResult> = None;
        for g in &r.groups {
            let Some(v) = g.value else { continue };
            if best.is_none_or(|b| better(&v, &b.value.unwrap())) {
                best = Some(g);
            }
        }
        best
    };
    let grouped = !r.groups.is_empty();
    match func {
        AggFunc::Sum => {
            let mut s = if m.starts_with("total") {
                format!("The {m} is {overall}.")
            } else {
                format!("The total {m} is {overall}.")
            };
            if let Some(top) = pick(|a, b| a > b).filter(|_| r.groups.len() > 1) {
                s.push_str(&format!(
                    " {} is the largest at {}.",
                    top.label,
                    fmt(top.value.unwrap())
                ));
            }
            s
        }
        AggFunc::Count => {
            let mut s = format!("There are {overall} rows in total.");
            if let Some(top) = pick(|a, b| a > b).filter(|_| r.groups.len() > 1) {
                s.push_str(&format!(
                    " {} has the most at {}.",
                    top.label,
                    fmt(top.value.unwrap())
                ));
            }
            s
        }
        AggFunc::Average => {
            let mut s = format!("The overall average {m} is {overall}.");
            if let Some(top) = pick(|a, b| a > b).filter(|_| r.groups.len() > 1) {
                s.push_str(&format!(
                    " {} is highest at {}.",
                    top.label,
                    fmt(top.value.unwrap())
                ));
            }
            s
        }
        AggFunc::Max => match pick(|a, b| a > b).filter(|_| grouped) {
            Some(top) => format!("The highest {m} is {overall}, in {}.", top.label),
            None => format!("The highest {m} is {overall}."),
        },
        AggFunc::Min => match pick(|a, b| a < b).filter(|_| grouped) {
            Some(top) => format!("The lowest {m} is {overall}, in {}.", top.label),
            None => format!("The lowest {m} is {overall}."),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::table::{build_dataset, BuildOptions, RawCell};

    fn ds(rows: &[&[&str]]) -> TableDataset {
        let grid: Vec<Vec<RawCell>> = rows
            .iter()
            .map(|r| r.iter().map(|c| RawCell::text(*c)).collect())
            .collect();
        build_dataset(
            &grid,
            &BuildOptions {
                doc_id: "d1".into(),
                file_name: "Q3-district-sales.csv".into(),
                ..Default::default()
            },
        )
    }

    fn sales() -> TableDataset {
        ds(&[
            &["District", "Orders", "Amount"],
            &["North", "42", "$128,430.50"],
            &["East", "37", "$96,210.00"],
            &["South", "51", "$141,875.25"],
            &["West", "29", "$73,004.10"],
        ])
    }

    fn turn(text: &str, at: u64, now: u64) -> TurnInput {
        TurnInput {
            session_id: "s1".into(),
            context_id: Some("c1".into()),
            correlation_id: format!("s1:them:{at}"),
            text: text.into(),
            enqueued_at_unix_ms: at,
            now_unix_ms: now,
        }
    }

    fn run(
        c: &mut AssistCoordinator,
        job: &Job,
        d: &TableDataset,
        t: &mut u64,
    ) -> Vec<LiveAssistResult> {
        let mut clock = || {
            *t += 5;
            *t
        };
        c.complete(job, d, &mut clock)
    }

    #[test]
    fn holding_then_grid_share_one_result_id_and_rising_revisions() {
        let d = sales();
        let mut c = AssistCoordinator::new("s1");
        let step = c.on_turn(
            &turn("What's the total amount per district?", 1000, 1004),
            &[&d],
        );
        assert_eq!(step.emit.len(), 1);
        let hold = &step.emit[0];
        assert_eq!(hold.lifecycle, LiveAssistLifecycle::Provisional);
        assert_eq!(hold.revision, 1);
        assert_eq!(hold.timing.holding_ms, Some(4));
        assert!(hold
            .say_now
            .as_deref()
            .unwrap()
            .contains("Q3-district-sales.csv"));
        match &hold.payload {
            Some(LiveAssistPayload::Text { text }) => {
                assert!(text.starts_with("Adding up Amount by District"))
            }
            other => panic!("{other:?}"),
        }
        let job = step.job.expect("a job");
        let mut t = 1010;
        let done = run(&mut c, &job, &d, &mut t);
        assert_eq!(done.len(), 1);
        let fin = &done[0];
        assert_eq!(fin.result_id, hold.result_id);
        assert_eq!(fin.correlation_id, hold.correlation_id);
        assert_eq!(fin.revision, 2);
        assert_eq!(fin.lifecycle, LiveAssistLifecycle::Complete);
        assert_eq!(fin.timing.compute_ms, Some(5));
        assert_eq!(fin.timing.holding_ms, Some(4));
        assert_eq!(fin.timing.emitted_ms, Some(1020 - 1000));
        assert!(fin.lifecycle.is_final());
    }

    #[test]
    fn the_grid_is_exact_sorted_and_source_linked() {
        let d = sales();
        let mut c = AssistCoordinator::new("s1");
        let step = c.on_turn(&turn("total amount per district", 0, 0), &[&d]);
        let mut t = 0;
        let fin = run(&mut c, step.job.as_ref().unwrap(), &d, &mut t).remove(0);
        let Some(LiveAssistPayload::Grid(g)) = &fin.payload else {
            panic!("expected a grid");
        };
        assert_eq!(g.title, "Total Amount by District");
        let labels: Vec<&str> = g.columns.iter().map(|c| c.label.as_str()).collect();
        assert_eq!(labels, vec!["District", "Amount", "Rows"]);
        let names: Vec<&str> = g.rows.iter().map(|r| r.cells[0].text.as_str()).collect();
        assert_eq!(names, vec!["East", "North", "South", "West", "Total"]);
        let total = g.rows.last().unwrap();
        assert_eq!(total.kind, GridRowKind::Total);
        assert_eq!(total.cells[1].text, "$439,519.85");
        assert_eq!(total.cells[1].value.as_deref(), Some("439519.85"));
        let north = &g.rows[1].cells[1];
        assert_eq!(north.text, "$128,430.50");
        assert_eq!(north.sources[0].file_name, "Q3-district-sales.csv");
        assert_eq!(north.sources[0].column.as_deref(), Some("Amount"));
        assert_eq!(north.sources[0].rows, vec![2]);
        assert_eq!(g.source_files, vec!["Q3-district-sales.csv"]);
        assert_eq!(
            fin.say_now.as_deref(),
            Some("The total amount is $439,519.85. South is the largest at $141,875.25.")
        );
    }

    #[test]
    fn blanks_duplicates_and_currency_show_up_as_notices() {
        let mut rows: Vec<Vec<&str>> = vec![vec!["District", "Amount"]];
        for _ in 0..5 {
            rows.push(vec!["North", "$10.00"]);
        }
        rows.push(vec!["North", ""]);
        rows.push(vec!["South", "$5.00"]);
        let refs: Vec<&[&str]> = rows.iter().map(Vec::as_slice).collect();
        let d = ds(&refs);
        let mut c = AssistCoordinator::new("s1");
        let step = c.on_turn(&turn("total amount by district", 0, 0), &[&d]);
        let mut t = 0;
        let fin = run(&mut c, step.job.as_ref().unwrap(), &d, &mut t).remove(0);
        let Some(LiveAssistPayload::Grid(g)) = &fin.payload else {
            panic!()
        };
        let texts: Vec<&str> = g.notices.iter().map(|n| n.text.as_str()).collect();
        assert!(texts.iter().any(|t| t.contains("blank value")), "{texts:?}");
        let dup = texts
            .iter()
            .find(|t| t.contains("exactly repeat"))
            .expect("duplicate note");
        assert!(dup.contains("all counted"));
        assert!(dup.contains("$15.00") || dup.contains("would be"), "{dup}");
        assert_eq!(g.rows.last().unwrap().cells[1].text, "$55.00");
        assert!(g.notices.iter().all(|n| n.level == NoticeLevel::Caution));
    }

    #[test]
    fn plain_counts_and_averages_format_sensibly() {
        let d = sales();
        let mut c = AssistCoordinator::new("s1");
        let step = c.on_turn(&turn("how many orders per district", 0, 0), &[&d]);
        let mut t = 0;
        let fin = run(&mut c, step.job.as_ref().unwrap(), &d, &mut t).remove(0);
        let Some(LiveAssistPayload::Grid(g)) = &fin.payload else {
            panic!()
        };
        assert_eq!(g.columns.len(), 2);
        assert_eq!(g.rows.last().unwrap().cells[1].text, "4");

        let step = c.on_turn(&turn("average amount by district", 1, 1), &[&d]);
        let fin = run(&mut c, step.job.as_ref().unwrap(), &d, &mut t).remove(0);
        let Some(LiveAssistPayload::Grid(g)) = &fin.payload else {
            panic!()
        };
        assert_eq!(g.rows.last().unwrap().cells[0].text, "All rows");
        assert_eq!(g.rows.last().unwrap().cells[1].text, "$109,879.96");
    }

    #[test]
    fn ordinary_talk_produces_nothing() {
        let d = sales();
        let mut c = AssistCoordinator::new("s1");
        for s in [
            "Thanks for joining",
            "What time works for you?",
            "Tell me about yourself",
        ] {
            let step = c.on_turn(&turn(s, 0, 0), &[&d]);
            assert!(step.emit.is_empty() && step.job.is_none(), "{s}");
        }
    }

    #[test]
    fn a_newer_request_supersedes_an_unfinished_one_and_drops_its_job() {
        let d = sales();
        let mut c = AssistCoordinator::new("s1");
        let first = c.on_turn(&turn("total amount per district", 0, 0), &[&d]);
        let first_id = first.emit[0].result_id.clone();
        let second = c.on_turn(&turn("average amount by district", 50, 51), &[&d]);
        assert_eq!(second.emit.len(), 2);
        assert_eq!(second.emit[0].result_id, first_id);
        assert_eq!(second.emit[0].lifecycle, LiveAssistLifecycle::Superseded);
        assert_eq!(
            second.emit[0].superseded_by.as_deref(),
            Some(second.emit[1].result_id.as_str())
        );
        assert_eq!(second.emit[0].revision, 2);
        // The first job finishes late: dropped, nothing emitted.
        let mut t = 100;
        assert!(run(&mut c, first.job.as_ref().unwrap(), &d, &mut t).is_empty());
        // The second still completes.
        assert_eq!(
            run(&mut c, second.job.as_ref().unwrap(), &d, &mut t).len(),
            1
        );
    }

    #[test]
    fn a_finished_answer_is_not_superseded_by_the_next_question() {
        let d = sales();
        let mut c = AssistCoordinator::new("s1");
        let first = c.on_turn(&turn("total amount per district", 0, 0), &[&d]);
        let mut t = 0;
        run(&mut c, first.job.as_ref().unwrap(), &d, &mut t);
        let second = c.on_turn(&turn("average amount by district", 9, 9), &[&d]);
        assert_eq!(second.emit.len(), 1);
    }

    #[test]
    fn ambiguity_waits_for_a_choice_then_continues_on_the_same_result() {
        let d = ds(&[
            &["District", "Amount", "Net amount"],
            &["N", "10", "8"],
            &["S", "20", "15"],
        ]);
        let mut c = AssistCoordinator::new("s1");
        let step = c.on_turn(&turn("what's the total per district", 0, 2), &[&d]);
        assert!(step.job.is_none());
        let asked = &step.emit[0];
        assert_eq!(asked.lifecycle, LiveAssistLifecycle::NeedsChoice);
        let Some(LiveAssistPayload::Choice { options, .. }) = &asked.payload else {
            panic!()
        };
        assert_eq!(options.len(), 2);

        // A bogus option changes nothing.
        assert!(c.choose(&asked.result_id, "99", 500, &[&d]).emit.is_empty());
        let picked = c.choose(&asked.result_id, &options[1].id, 500, &[&d]);
        assert_eq!(picked.emit[0].result_id, asked.result_id);
        assert_eq!(picked.emit[0].revision, 2);
        assert_eq!(picked.emit[0].lifecycle, LiveAssistLifecycle::Provisional);
        assert_eq!(picked.emit[0].timing.enqueued_at_unix_ms, 500);
        let mut t = 500;
        let fin = run(&mut c, picked.job.as_ref().unwrap(), &d, &mut t).remove(0);
        assert_eq!(fin.revision, 3);
        let Some(LiveAssistPayload::Grid(g)) = &fin.payload else {
            panic!()
        };
        assert_eq!(g.rows.last().unwrap().cells[1].text, "23");
        // Choosing again does nothing: the result is no longer waiting.
        assert!(c
            .choose(&asked.result_id, &options[0].id, 900, &[&d])
            .emit
            .is_empty());
    }

    #[test]
    fn unsupported_and_unknown_requests_are_declined_with_reasons() {
        let mut d = sales();
        d.unsupported
            .push(crate::table::UnsupportedReason::MergedCells);
        let mut c = AssistCoordinator::new("s1");
        let step = c.on_turn(&turn("total amount per district", 0, 0), &[&d]);
        let r = &step.emit[0];
        assert_eq!(r.lifecycle, LiveAssistLifecycle::Declined);
        assert!(step.job.is_none());
        let Some(LiveAssistPayload::Text { text }) = &r.payload else {
            panic!()
        };
        assert!(text.contains("merged cells"), "{text}");

        let good = sales();
        let step = c.on_turn(&turn("total amount by district and orders", 1, 1), &[&good]);
        assert_eq!(
            step.emit.last().unwrap().lifecycle,
            LiveAssistLifecycle::Declined
        );
    }

    #[test]
    fn a_calculation_error_becomes_a_failed_result_not_a_wrong_number() {
        let d = sales();
        let mut c = AssistCoordinator::new("s1");
        let step = c.on_turn(&turn("total amount per district", 0, 0), &[&d]);
        let mut job = step.job.unwrap();
        job.plan.measure = Some(crate::table_aggregate::ColumnRef {
            index: 99,
            header: "Ghost".into(),
        });
        let mut t = 0;
        let fin = run(&mut c, &job, &d, &mut t).remove(0);
        assert_eq!(fin.lifecycle, LiveAssistLifecycle::Failed);
        assert!(matches!(fin.payload, Some(LiveAssistPayload::Text { .. })));
    }

    #[test]
    fn a_job_whose_table_went_away_ends_declined_not_stuck() {
        let d = sales();
        let mut c = AssistCoordinator::new("s1");
        let step = c.on_turn(&turn("total amount per district", 0, 0), &[&d]);
        let job = step.job.unwrap();
        let out = c.abandon(
            &job,
            "That spreadsheet is no longer attached to this Context.",
            500,
        );
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].lifecycle, LiveAssistLifecycle::Declined);
        assert_eq!(out[0].revision, 2);
        assert_eq!(out[0].result_id, step.emit[0].result_id);
        assert!(out[0].lifecycle.is_final());
        // Nothing more can be emitted for it, and finished results are left alone.
        let mut t = 0;
        assert!(run(&mut c, &job, &d, &mut t).is_empty());
        assert!(c.abandon(&job, "again", 900).is_empty());
    }

    #[test]
    fn thousands_of_groups_fold_into_an_exact_other_row() {
        let mut rows: Vec<Vec<String>> = vec![vec!["Customer".into(), "Amount".into()]];
        for i in 0..1000 {
            rows.push(vec![format!("C{i:04}"), format!("{}.50", i + 1)]);
        }
        let refs: Vec<Vec<&str>> = rows
            .iter()
            .map(|r| r.iter().map(String::as_str).collect())
            .collect();
        let slices: Vec<&[&str]> = refs.iter().map(Vec::as_slice).collect();
        let d = ds(&slices);
        let mut c = AssistCoordinator::new("s1");
        let step = c.on_turn(&turn("total amount per customer", 0, 0), &[&d]);
        let mut t = 0;
        let fin = run(&mut c, step.job.as_ref().unwrap(), &d, &mut t).remove(0);
        let Some(LiveAssistPayload::Grid(g)) = &fin.payload else {
            panic!()
        };
        // 200 shown + "Other" + Total.
        assert_eq!(g.rows.len(), MAX_GRID_GROUPS + 2);
        assert_eq!(g.rows[0].cells[0].text, "C0999"); // largest first
        let other = &g.rows[MAX_GRID_GROUPS];
        assert_eq!(other.cells[0].text, "Other (800 groups)");
        // The visible rows plus "Other" add up to the total, to the cent.
        let sum = g.rows[..=MAX_GRID_GROUPS]
            .iter()
            .map(|r| Decimal::from_plain(r.cells[1].value.as_deref().unwrap()).unwrap())
            .fold(Decimal::ZERO, |a, b| a.checked_add(&b).unwrap());
        let total =
            Decimal::from_plain(g.rows.last().unwrap().cells[1].value.as_deref().unwrap()).unwrap();
        assert_eq!(sum, total);
        // sum of (i + 0.5) for i in 1..=1000
        assert_eq!(total.to_plain_string(), "501000.00");
        assert!(g
            .notices
            .iter()
            .any(|n| n.text.contains("1000 groups in all")));
    }

    #[test]
    fn skipped_total_lines_are_a_caution_not_a_footnote() {
        let d = ds(&[
            &["District", "Amount"],
            &["North", "10"],
            &["South", "5"],
            &["Total", "15"],
        ]);
        let mut c = AssistCoordinator::new("s1");
        let step = c.on_turn(&turn("total amount per district", 0, 0), &[&d]);
        let mut t = 0;
        let fin = run(&mut c, step.job.as_ref().unwrap(), &d, &mut t).remove(0);
        let Some(LiveAssistPayload::Grid(g)) = &fin.payload else {
            panic!()
        };
        let n = g
            .notices
            .iter()
            .find(|n| n.text.contains("total line"))
            .expect("note");
        assert_eq!(n.level, NoticeLevel::Caution);
        assert_eq!(n.rows, vec![4]);
    }

    #[test]
    fn a_heading_that_already_says_total_is_not_prefixed_twice() {
        let d = ds(&[
            &["Industry", "Total Due"],
            &["Tech", "$10.00"],
            &["Health", "$5.00"],
        ]);
        let mut c = AssistCoordinator::new("s1");
        let step = c.on_turn(&turn("what's the total due per industry", 0, 0), &[&d]);
        let mut t = 0;
        let fin = run(&mut c, step.job.as_ref().unwrap(), &d, &mut t).remove(0);
        let Some(LiveAssistPayload::Grid(g)) = &fin.payload else {
            panic!()
        };
        assert_eq!(g.title, "Total Due by Industry");
        assert_eq!(
            fin.say_now.as_deref(),
            Some("The total due is $15.00. Tech is the largest at $10.00.")
        );
    }

    #[test]
    fn would_handle_needs_a_matching_table() {
        let d = sales();
        assert!(would_handle("total amount per district", &[&d]));
        assert!(!would_handle("total amount per district", &[]));
        assert!(!would_handle("see you tomorrow", &[&d]));
    }

    #[test]
    fn looks_like_data_request_is_a_cheap_gate() {
        assert!(looks_like_data_request("total amount per district"));
        assert!(!looks_like_data_request("see you tomorrow"));
    }
}

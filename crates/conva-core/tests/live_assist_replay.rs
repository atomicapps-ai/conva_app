//! Replay fixtures and timing for live-assist table answers (Step 0).
//!
//! `fixtures/live_assist_cases.json` describes spreadsheets and the sentences
//! heard about them; this test replays each through the coordinator exactly as
//! the shell does (turn in, holding out, job run, grid out) and checks the
//! figures character for character. The second half measures how long each
//! stage takes on a large table, printing a `[perf]` line the CI log keeps.

use std::collections::BTreeMap;
use std::time::Instant;

use conva_core::ipc::{GridRowKind, LiveAssistLifecycle, LiveAssistPayload, LiveAssistResult};
use conva_core::live_assist::{AssistCoordinator, TurnInput};
use conva_core::table::{build_dataset, BuildOptions, RawCell, TableDataset};
use serde::Deserialize;

#[derive(Deserialize)]
struct Fixture {
    cases: Vec<Case>,
}

#[derive(Deserialize)]
struct Case {
    name: String,
    file_name: String,
    csv: String,
    #[serde(default)]
    merged_cells: bool,
    turns: Vec<Turn>,
}

#[derive(Deserialize)]
struct Turn {
    text: String,
    expect: Expect,
    #[serde(default)]
    then_choose: Option<Choose>,
}

#[derive(Deserialize)]
struct Choose {
    option: String,
    expect: Expect,
}

#[derive(Deserialize, Default)]
struct Expect {
    kind: String,
    #[serde(default)]
    lifecycles: Vec<String>,
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    total: Option<String>,
    #[serde(default)]
    groups: BTreeMap<String, String>,
    #[serde(default)]
    say_now: Option<String>,
    #[serde(default)]
    notices_contain: Vec<String>,
    #[serde(default)]
    options: Vec<String>,
    #[serde(default)]
    text_contains: Option<String>,
}

/// Minimal RFC 4180 reader for fixtures (quotes and doubled quotes).
fn parse_csv(text: &str) -> Vec<Vec<RawCell>> {
    let mut rows = Vec::new();
    let mut row: Vec<RawCell> = Vec::new();
    let mut cell = String::new();
    let mut quoted = false;
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        match (c, quoted) {
            ('"', true) if chars.peek() == Some(&'"') => {
                cell.push('"');
                chars.next();
            }
            ('"', _) => quoted = !quoted,
            (',', false) => row.push(RawCell::text(std::mem::take(&mut cell))),
            ('\n', false) => {
                row.push(RawCell::text(std::mem::take(&mut cell)));
                rows.push(std::mem::take(&mut row));
            }
            (c, _) => cell.push(c),
        }
    }
    if !cell.is_empty() || !row.is_empty() {
        row.push(RawCell::text(cell));
        rows.push(row);
    }
    rows
}

fn dataset(case: &Case) -> TableDataset {
    build_dataset(
        &parse_csv(&case.csv),
        &BuildOptions {
            doc_id: format!("doc-{}", case.name),
            file_name: case.file_name.clone(),
            has_merged_cells: case.merged_cells,
            ..Default::default()
        },
    )
}

fn lifecycle_name(l: LiveAssistLifecycle) -> &'static str {
    match l {
        LiveAssistLifecycle::Provisional => "provisional",
        LiveAssistLifecycle::NeedsChoice => "needs_choice",
        LiveAssistLifecycle::Complete => "complete",
        LiveAssistLifecycle::Declined => "declined",
        LiveAssistLifecycle::Failed => "failed",
        LiveAssistLifecycle::Superseded => "superseded",
    }
}

fn check(case: &str, text: &str, e: &Expect, results: &[LiveAssistResult]) {
    let ctx = format!("{case}: {text:?}");
    if e.kind == "ignore" {
        assert!(results.is_empty(), "{ctx}: expected no result");
        return;
    }
    assert!(!results.is_empty(), "{ctx}: expected a result");
    let last = results.last().unwrap();
    if !e.lifecycles.is_empty() {
        let got: Vec<&str> = results
            .iter()
            .map(|r| lifecycle_name(r.lifecycle))
            .collect();
        assert_eq!(got, e.lifecycles, "{ctx}: lifecycle sequence");
        let ids: Vec<&str> = results.iter().map(|r| r.result_id.as_str()).collect();
        assert!(
            ids.windows(2).all(|w| w[0] == w[1]),
            "{ctx}: one result id throughout"
        );
        let revs: Vec<u32> = results.iter().map(|r| r.revision).collect();
        assert!(
            revs.windows(2).all(|w| w[0] < w[1]),
            "{ctx}: revisions rise {revs:?}"
        );
    }
    match e.kind.as_str() {
        "grid" => {
            assert_eq!(last.lifecycle, LiveAssistLifecycle::Complete, "{ctx}");
            let Some(LiveAssistPayload::Grid(g)) = &last.payload else {
                panic!("{ctx}: expected a grid, got {:?}", last.payload);
            };
            if let Some(t) = &e.title {
                assert_eq!(&g.title, t, "{ctx}: title");
            }
            let body: BTreeMap<String, String> = g
                .rows
                .iter()
                .filter(|r| r.kind == GridRowKind::Body)
                .map(|r| {
                    (
                        r.cells[0].text.clone(),
                        r.cells[1].value.clone().unwrap_or_default(),
                    )
                })
                .collect();
            for (name, want) in &e.groups {
                let got = body
                    .get(name)
                    .unwrap_or_else(|| panic!("{ctx}: no group {name}: {body:?}"));
                assert_eq!(&normalize(got), &normalize(want), "{ctx}: group {name}");
            }
            if !e.groups.is_empty() {
                assert_eq!(body.len(), e.groups.len(), "{ctx}: group count {body:?}");
            }
            if let Some(t) = &e.total {
                let total = g
                    .rows
                    .iter()
                    .find(|r| r.kind == GridRowKind::Total)
                    .expect("total row");
                let got = total.cells[1].value.clone().unwrap_or_default();
                assert_eq!(normalize(&got), normalize(t), "{ctx}: total");
            }
            for needle in &e.notices_contain {
                assert!(
                    g.notices.iter().any(|n| n.text.contains(needle.as_str())),
                    "{ctx}: no notice containing {needle:?} in {:?}",
                    g.notices
                );
            }
            if let Some(s) = &e.say_now {
                assert_eq!(last.say_now.as_deref(), Some(s.as_str()), "{ctx}: say_now");
            }
            // Every figure must be traceable to its rows.
            for row in g.rows.iter().filter(|r| r.kind == GridRowKind::Body) {
                assert!(
                    !row.cells[1].sources.is_empty(),
                    "{ctx}: value cell has provenance"
                );
                assert!(row.cells[1].sources[0].row_count > 0);
            }
        }
        "choice" => {
            assert_eq!(last.lifecycle, LiveAssistLifecycle::NeedsChoice, "{ctx}");
            let Some(LiveAssistPayload::Choice { options, .. }) = &last.payload else {
                panic!("{ctx}: expected a choice");
            };
            let labels: Vec<&str> = options.iter().map(|o| o.label.as_str()).collect();
            assert_eq!(labels, e.options, "{ctx}: options");
        }
        "declined" => {
            assert_eq!(last.lifecycle, LiveAssistLifecycle::Declined, "{ctx}");
            let Some(LiveAssistPayload::Text { text }) = &last.payload else {
                panic!("{ctx}: expected text");
            };
            if let Some(n) = &e.text_contains {
                assert!(text.contains(n.as_str()), "{ctx}: {text:?} lacks {n:?}");
            }
        }
        other => panic!("{ctx}: unknown expectation {other}"),
    }
}

/// `749.50` and `749.5` are the same number.
fn normalize(s: &str) -> String {
    conva_core::decimal::Decimal::from_plain(s)
        .map(|d| d.to_plain_string())
        .map(|p| {
            if p.contains('.') {
                p.trim_end_matches('0').trim_end_matches('.').to_string()
            } else {
                p
            }
        })
        .unwrap_or_else(|| s.to_string())
}

/// Replay one heard turn: everything the shell would emit, in order.
fn replay(
    c: &mut AssistCoordinator,
    ds: &TableDataset,
    text: &str,
    at: u64,
) -> Vec<LiveAssistResult> {
    let step = c.on_turn(
        &TurnInput {
            session_id: "s1".into(),
            context_id: Some("ctx".into()),
            correlation_id: format!("s1:them:{at}"),
            text: text.into(),
            enqueued_at_unix_ms: at,
            now_unix_ms: at + 1,
        },
        &[ds],
    );
    let mut out = step.emit;
    if let Some(job) = step.job {
        let mut t = at + 2;
        out.extend(c.complete(&job, ds, &mut || {
            t += 1;
            t
        }));
    }
    out
}

#[test]
fn replay_fixtures() {
    let fixture: Fixture = serde_json::from_str(include_str!("fixtures/live_assist_cases.json"))
        .expect("fixture parses");
    assert!(fixture.cases.len() >= 10);
    for case in &fixture.cases {
        let ds = dataset(case);
        let mut c = AssistCoordinator::new("s1");
        let mut at = 1_000u64;
        for turn in &case.turns {
            at += 10_000;
            let results = replay(&mut c, &ds, &turn.text, at);
            check(&case.name, &turn.text, &turn.expect, &results);
            if let Some(choose) = &turn.then_choose {
                let asked = results.last().unwrap();
                let Some(LiveAssistPayload::Choice { options, .. }) = &asked.payload else {
                    panic!("{}: no choice to answer", case.name);
                };
                let option = options
                    .iter()
                    .find(|o| o.label == choose.option)
                    .unwrap_or_else(|| panic!("{}: option {}", case.name, choose.option));
                let step = c.choose(&asked.result_id, &option.id, at + 500, &[&ds]);
                let mut out = step.emit;
                if let Some(job) = step.job {
                    let mut t = at + 501;
                    out.extend(c.complete(&job, &ds, &mut || {
                        t += 1;
                        t
                    }));
                }
                check(&case.name, &choose.option, &choose.expect, &out);
                assert!(out.iter().all(|r| r.result_id == asked.result_id));
            }
        }
    }
}

#[test]
fn backward_compatible_result_json_ignores_unknown_fields() {
    // A newer emitter may add fields; an older reader must still parse.
    let json = serde_json::json!({
        "contract_version": 1, "result_id": "r", "correlation_id": "c", "session_id": "s",
        "revision": 1, "kind": "table_aggregate", "lifecycle": "provisional", "question": "q",
        "timing": { "enqueued_at_unix_ms": 1, "future_field": true },
        "future_top_level": [1, 2, 3]
    });
    let r: LiveAssistResult = serde_json::from_value(json).unwrap();
    assert_eq!(r.revision, 1);
    assert!(r.payload.is_none() && r.say_now.is_none() && r.context_id.is_none());
}

/// A large table, built without any file parsing.
fn big_grid(rows: usize) -> Vec<Vec<RawCell>> {
    let mut grid = vec![vec![
        RawCell::text("District"),
        RawCell::text("Orders"),
        RawCell::text("Amount"),
        RawCell::text("Note"),
    ]];
    for i in 0..rows {
        grid.push(vec![
            RawCell::text(format!("District {}", i % 40)),
            RawCell::text(((i % 9) + 1).to_string()),
            RawCell::text(format!("${}.{:02}", (i * 37) % 5000, i % 100)),
            RawCell::text(format!("row {i}")),
        ]);
    }
    grid
}

#[test]
fn stage_timings_stay_inside_the_live_budget() {
    const ROWS: usize = 100_000;
    let grid = big_grid(ROWS);

    let t = Instant::now();
    let ds = build_dataset(
        &grid,
        &BuildOptions {
            doc_id: "big".into(),
            file_name: "big.csv".into(),
            ..Default::default()
        },
    );
    let build_ms = t.elapsed().as_secs_f64() * 1000.0;

    let turn = TurnInput {
        session_id: "perf".into(),
        context_id: None,
        correlation_id: "perf:them:1".into(),
        text: "What's the total amount per district?".into(),
        enqueued_at_unix_ms: 0,
        now_unix_ms: 0,
    };
    // Cheap gate that runs before any file is touched.
    let t = Instant::now();
    assert!(conva_core::live_assist::looks_like_data_request(&turn.text));
    let gate_ms = t.elapsed().as_secs_f64() * 1000.0;

    // Holding response: parse + resolve columns. It never reads a row, so it
    // must not scale with table size. Best of several runs, because the first
    // allocation after building a huge table can pay for the allocator
    // returning memory to the OS, which is noise rather than cost.
    let mut holding: Vec<f64> = Vec::new();
    let mut step = None;
    for _ in 0..7 {
        let mut c = AssistCoordinator::new("perf");
        let t = Instant::now();
        let s = c.on_turn(&turn, &[&ds]);
        holding.push(t.elapsed().as_secs_f64() * 1000.0);
        step = Some((c, s));
    }
    let holding_best = holding.iter().cloned().fold(f64::MAX, f64::min);
    let holding_worst = holding.iter().cloned().fold(0.0, f64::max);
    let (mut c, step) = step.unwrap();
    assert_eq!(step.emit[0].lifecycle, LiveAssistLifecycle::Provisional);

    // Completion: exact aggregation over every row.
    let job = step.job.unwrap();
    let t = Instant::now();
    let done = c.complete(&job, &ds, &mut || 0);
    let complete_ms = t.elapsed().as_secs_f64() * 1000.0;
    assert_eq!(done[0].lifecycle, LiveAssistLifecycle::Complete);

    let line = serde_json::json!({
        "stage": "live_assist_replay", "rows": ROWS,
        "gate_ms": gate_ms, "holding_best_ms": holding_best, "holding_worst_ms": holding_worst,
        "build_dataset_ms": build_ms,
        "aggregate_ms": complete_ms,
    });
    eprintln!("[perf] {line}");

    // Budgets are deliberately loose so a slow shared CI runner does not flake,
    // and tight enough to catch an accidental quadratic step.
    assert!(gate_ms < 5.0, "gate {gate_ms} ms");
    assert!(
        holding_best < 5.0,
        "holding {holding_best} ms (must not scale with rows)"
    );
    assert!(
        holding_worst < 250.0,
        "holding worst case {holding_worst} ms"
    );
    assert!(
        complete_ms < 1500.0,
        "aggregate {complete_ms} ms for {ROWS} rows"
    );
    assert!(build_ms < 3000.0, "build {build_ms} ms for {ROWS} rows");
}

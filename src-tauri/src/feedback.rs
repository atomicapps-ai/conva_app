//! Local highlight feedback store (Phase 4) — the on-device 👍/👎 the user gives
//! transcript research terms. Persisted to `<app-data>/highlight_feedback.json`
//! as `{ "<lowercased term>": "boost" | "suppress" }` and loaded into the
//! highlighter's boost/suppress sets so an explicit signal always wins
//! (decision 4). Best-effort, mirroring `metering.rs`.
//!
//! This is the first, per-term tier of the learning loop; few-shot examples and
//! a distilled research profile layer on top later, and Phase 5 aggregates
//! anonymized patterns into the global relevance DB (patterns, never content).

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

/// The user's verdict on a highlight term.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Signal {
    /// 👍 — always surface this term when it appears.
    Boost,
    /// 👎 — never surface this term.
    Suppress,
}

fn path(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .app_data_dir()
        .ok()
        .map(|d| d.join("highlight_feedback.json"))
}

/// The stored map, lowercased term → signal. Empty (never an error) when the
/// file is absent or unreadable.
pub fn load(app: &AppHandle) -> HashMap<String, Signal> {
    path(app)
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save(app: &AppHandle, map: &HashMap<String, Signal>) {
    let Some(path) = path(app) else {
        return;
    };
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if let Ok(json) = serde_json::to_string_pretty(map) {
        let _ = fs::write(&path, json);
    }
}

/// Record `signal` for `term`, or clear it with `None`. Keyed lowercased so
/// matching is case-insensitive.
pub fn record(app: &AppHandle, term: &str, signal: Option<Signal>) {
    let key = term.trim().to_lowercase();
    if key.is_empty() {
        return;
    }
    let mut map = load(app);
    match signal {
        Some(s) => {
            map.insert(key, s);
        }
        None => {
            map.remove(&key);
        }
    }
    save(app, &map);
}

/// The stored feedback split into `(boost, suppress)` term sets for the
/// highlighter's [`HighlightContext`](conva_core::highlight::HighlightContext).
pub fn sets(app: &AppHandle) -> (HashSet<String>, HashSet<String>) {
    let mut boost = HashSet::new();
    let mut suppress = HashSet::new();
    for (term, sig) in load(app) {
        match sig {
            Signal::Boost => {
                boost.insert(term);
            }
            Signal::Suppress => {
                suppress.insert(term);
            }
        }
    }
    (boost, suppress)
}

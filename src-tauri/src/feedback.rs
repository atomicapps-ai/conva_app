//! Local highlight feedback store (Phase 4) — the on-device learning signal for
//! transcript highlighting, persisted to `<app-data>/highlight_feedback.json`.
//!
//! Two tiers of signal per term:
//! - **explicit** 👍/👎 ([`Signal`]) — the user's direct verdict; always wins
//!   (decision 4).
//! - **implicit** picks — how many times the user *researched* the term (Phase
//!   4b). A term researched [`IMPLICIT_BOOST_PICKS`] times auto-boosts, unless
//!   explicitly suppressed. One-off lookups don't move it, so precision holds.
//!
//! Both feed the highlighter's boost/suppress sets. Best-effort, mirroring
//! `metering.rs`. Later slices distill these into few-shot examples + a per-user
//! research profile, and Phase 5 aggregates anonymized patterns into the global
//! relevance DB (patterns, never content).

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

/// The user's explicit verdict on a highlight term.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Signal {
    /// 👍 — always surface this term when it appears.
    Boost,
    /// 👎 — never surface this term.
    Suppress,
}

/// Research selections before an (un-suppressed) term auto-boosts (Phase 4b).
const IMPLICIT_BOOST_PICKS: u32 = 2;

/// Per-term feedback: an optional explicit signal plus an implicit
/// research-selection count.
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize)]
struct TermRecord {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    signal: Option<Signal>,
    #[serde(default, skip_serializing_if = "is_zero")]
    picks: u32,
}

fn is_zero(n: &u32) -> bool {
    *n == 0
}

type Store = HashMap<String, TermRecord>;

fn path(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .app_data_dir()
        .ok()
        .map(|d| d.join("highlight_feedback.json"))
}

/// The stored map, lowercased term → record. Empty (never an error) when the
/// file is absent or unreadable.
fn load(app: &AppHandle) -> Store {
    path(app)
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save(app: &AppHandle, store: &Store) {
    let Some(path) = path(app) else {
        return;
    };
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if let Ok(json) = serde_json::to_string_pretty(store) {
        let _ = fs::write(&path, json);
    }
}

/// Normalized key: trimmed + lowercased so matching is case-insensitive.
fn key_of(term: &str) -> String {
    term.trim().to_lowercase()
}

/// Set `signal` for `term`, or clear the explicit signal with `None` (implicit
/// picks are kept). Drops the record entirely when nothing is left on it.
pub fn record(app: &AppHandle, term: &str, signal: Option<Signal>) {
    let key = key_of(term);
    if key.is_empty() {
        return;
    }
    let mut store = load(app);
    store.entry(key.clone()).or_default().signal = signal;
    if store
        .get(&key)
        .is_some_and(|r| r.signal.is_none() && r.picks == 0)
    {
        store.remove(&key);
    }
    save(app, &store);
}

/// Record an implicit 👍: the user researched `term` (Phase 4b).
pub fn record_pick(app: &AppHandle, term: &str) {
    let key = key_of(term);
    if key.is_empty() {
        return;
    }
    let mut store = load(app);
    let rec = store.entry(key).or_default();
    rec.picks = rec.picks.saturating_add(1);
    save(app, &store);
}

/// Split the stored feedback into `(boost, suppress)` term sets for the
/// highlighter. Explicit signals win; an un-suppressed term auto-boosts once it
/// has been researched [`IMPLICIT_BOOST_PICKS`] times.
fn partition(store: &Store) -> (HashSet<String>, HashSet<String>) {
    let mut boost = HashSet::new();
    let mut suppress = HashSet::new();
    for (term, rec) in store {
        match rec.signal {
            Some(Signal::Suppress) => {
                suppress.insert(term.clone());
            }
            Some(Signal::Boost) => {
                boost.insert(term.clone());
            }
            None if rec.picks >= IMPLICIT_BOOST_PICKS => {
                boost.insert(term.clone());
            }
            None => {}
        }
    }
    (boost, suppress)
}

/// The stored feedback as `(boost, suppress)` term sets for the highlighter's
/// [`HighlightContext`](conva_core::highlight::HighlightContext).
pub fn sets(app: &AppHandle) -> (HashSet<String>, HashSet<String>) {
    partition(&load(app))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn explicit_signals_and_implicit_threshold() {
        let mut store = Store::new();
        store.insert(
            "gaap".into(),
            TermRecord {
                signal: Some(Signal::Boost),
                picks: 0,
            },
        );
        store.insert(
            "noise".into(),
            TermRecord {
                signal: Some(Signal::Suppress),
                picks: 9,
            },
        );
        store.insert(
            "looked-once".into(),
            TermRecord {
                signal: None,
                picks: 1,
            },
        );
        store.insert(
            "looked-twice".into(),
            TermRecord {
                signal: None,
                picks: 2,
            },
        );

        let (boost, suppress) = partition(&store);
        assert!(boost.contains("gaap"), "explicit 👍 boosts");
        assert!(suppress.contains("noise"), "explicit 👎 suppresses");
        assert!(
            !boost.contains("noise"),
            "explicit 👎 wins over implicit picks"
        );
        assert!(
            !boost.contains("looked-once"),
            "one pick is below threshold"
        );
        assert!(boost.contains("looked-twice"), "two picks auto-boost");
    }
}

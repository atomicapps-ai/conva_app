//! Live Intelligence Coordinator — runs "add that up" style requests.
//!
//! One named worker thread owns a [`AssistCoordinator`]. The transcript sink
//! only ever does a non-blocking channel send into it (like the Question
//! Radar and Tracker workers), so ASR delivery, the audio callback and the UI
//! thread never wait on file reads or arithmetic. The worker loads the typed
//! tables of the active Context's attached documents, emits a holding
//! response at once, computes exactly, and emits the finished grid under the
//! same result id.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Mutex};

use conva_core::ipc::{events, LiveAssistAck, LiveAssistResult};
use conva_core::live_assist::{
    looks_like_data_request, would_handle, AssistCoordinator, Step, TurnInput,
};
use conva_core::table::TableDataset;
use tauri::{AppHandle, Emitter, Manager};

use crate::session::now_unix_ms;

/// A finalized turn, or a typed question, waiting for the coordinator.
pub struct LiveTurn {
    pub session_id: String,
    /// `{session}:them:{seq}` for heard speech, `{session}:ask:{n}` for typed.
    pub correlation_id: String,
    pub text: String,
    pub enqueued_at_unix_ms: u64,
}

pub enum LiveMsg {
    Turn(LiveTurn),
    /// The user picked an option on a `needs_choice` result.
    Choose {
        result_id: String,
        option_id: String,
    },
}

/// Handle kept in `AppState`. The worker starts once, after the app state and
/// library exist, and lives for the whole run.
pub struct LiveAssist {
    tx: Sender<LiveMsg>,
    rx: Mutex<Option<Receiver<LiveMsg>>>,
    ask_seq: AtomicU64,
}

impl LiveAssist {
    pub fn new() -> Self {
        let (tx, rx) = mpsc::channel();
        Self {
            tx,
            rx: Mutex::new(Some(rx)),
            ask_seq: AtomicU64::new(0),
        }
    }

    /// A sender for the transcript sink. Sending never blocks.
    pub fn sender(&self) -> Sender<LiveMsg> {
        self.tx.clone()
    }

    /// Spawn the worker. Safe to call more than once; only the first call starts it.
    pub fn start(&self, app: AppHandle) {
        let Some(rx) = self.rx.lock().expect("live assist lock").take() else {
            return;
        };
        if let Err(error) = std::thread::Builder::new()
            .name("faner-live-assist".into())
            .spawn(move || run(app, rx))
        {
            eprintln!("[conva] live assist worker unavailable: {error}");
        }
    }

    /// A typed question (the Ask box). Returns `handled: false` when it is not
    /// a data request for any table in the active Context, so the caller can
    /// hand it to Ally as usual.
    pub fn submit(&self, app: &AppHandle, text: &str) -> LiveAssistAck {
        let text = text.trim();
        if !looks_like_data_request(text) {
            return LiveAssistAck {
                handled: false,
                result_id: None,
            };
        }
        let (datasets, _) = active_tables(app);
        let refs: Vec<&TableDataset> = datasets.iter().map(|d| d.as_ref()).collect();
        if !would_handle(text, &refs) {
            return LiveAssistAck {
                handled: false,
                result_id: None,
            };
        }
        let n = self.ask_seq.fetch_add(1, Ordering::Relaxed) + 1;
        let now = now_unix_ms();
        let _ = self.tx.send(LiveMsg::Turn(LiveTurn {
            session_id: "ask".to_string(),
            correlation_id: format!("ask:ask:{n}"),
            text: text.to_string(),
            enqueued_at_unix_ms: now,
        }));
        LiveAssistAck {
            handled: true,
            result_id: None,
        }
    }

    pub fn choose(&self, result_id: String, option_id: String) {
        let _ = self.tx.send(LiveMsg::Choose {
            result_id,
            option_id,
        });
    }
}

/// The typed tables attached to the active Context, plus its id. With no
/// Context (or none with tables) this is empty and nothing is answered.
pub(crate) fn active_tables(app: &AppHandle) -> (Vec<Arc<TableDataset>>, Option<String>) {
    let Some(state) = app.try_state::<crate::AppState>() else {
        return (Vec::new(), None);
    };
    let scope = state
        .active_context_doc_ids
        .lock()
        .expect("ctx lock")
        .clone();
    let context_id = state.active_context_id.lock().expect("ctx lock").clone();
    (state.rag.tables().datasets_for(&scope), context_id)
}

fn run(app: AppHandle, rx: Receiver<LiveMsg>) {
    let mut coordinator = AssistCoordinator::new(&format!("a{}", now_unix_ms()));
    while let Ok(msg) = rx.recv() {
        match msg {
            LiveMsg::Turn(turn) => {
                // Cheap textual gate first: most speech is never a data request
                // and must cost nothing (no file is touched).
                if !looks_like_data_request(&turn.text) {
                    continue;
                }
                let (datasets, context_id) = active_tables(&app);
                if datasets.is_empty() {
                    continue;
                }
                let refs: Vec<&TableDataset> = datasets.iter().map(|d| d.as_ref()).collect();
                let step = coordinator.on_turn(
                    &TurnInput {
                        session_id: turn.session_id,
                        context_id,
                        correlation_id: turn.correlation_id,
                        text: turn.text,
                        enqueued_at_unix_ms: turn.enqueued_at_unix_ms,
                        now_unix_ms: now_unix_ms(),
                    },
                    &refs,
                );
                deliver(&app, &mut coordinator, step, &datasets);
            }
            LiveMsg::Choose {
                result_id,
                option_id,
            } => {
                let (datasets, _) = active_tables(&app);
                let refs: Vec<&TableDataset> = datasets.iter().map(|d| d.as_ref()).collect();
                let step = coordinator.choose(&result_id, &option_id, now_unix_ms(), &refs);
                deliver(&app, &mut coordinator, step, &datasets);
            }
        }
    }
}

fn emit(app: &AppHandle, result: LiveAssistResult) {
    crate::trace::record(
        "live_assist",
        result.timing.emitted_ms.unwrap_or(0),
        serde_json::json!({
            "result_id": result.result_id,
            "correlation_id": result.correlation_id,
            "revision": result.revision,
            "lifecycle": result.lifecycle,
            "holding_ms": result.timing.holding_ms,
            "compute_ms": result.timing.compute_ms,
        }),
    );
    let _ = app.emit(events::LIVE_ASSIST, result);
}

/// Emit a step's immediate results, then run its job and emit the outcome.
fn deliver(
    app: &AppHandle,
    coordinator: &mut AssistCoordinator,
    step: Step,
    datasets: &[Arc<TableDataset>],
) {
    for result in step.emit {
        emit(app, result);
    }
    let Some(job) = step.job else {
        return;
    };
    let Some(dataset) = datasets.iter().find(|d| d.doc_id == job.plan.doc_id) else {
        // The Context changed or the document was detached while this waited:
        // end the result honestly rather than leave "working on it" on screen.
        for result in coordinator.abandon(
            &job,
            "That spreadsheet is no longer attached to this Context, so I can't add it up.",
            now_unix_ms(),
        ) {
            emit(app, result);
        }
        return;
    };
    let mut clock = now_unix_ms;
    for result in coordinator.complete(&job, dataset, &mut clock) {
        emit(app, result);
    }
}

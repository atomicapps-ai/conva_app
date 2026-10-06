//! "Send nothing to an AI provider" (config `offline_mode`).
//!
//! One process-wide flag, set at startup and on every `save_config`, read at
//! the choke points where content would leave the device: `llm::resolve_key`
//! (every hosted LLM call and Anthropic web search), the Deepgram engine
//! choice and TTS, and the Firecrawl/Tavily research calls. Gating those few
//! places — not each feature — means a new feature built on them cannot
//! bypass the switch. The decision itself is `conva_core::config::remote_call_allowed`.

use std::sync::atomic::{AtomicBool, Ordering};

use conva_core::config::{remote_call_allowed, OFFLINE_MODE_ERROR};
use conva_core::CoreError;

static OFFLINE: AtomicBool = AtomicBool::new(false);

pub fn set(offline: bool) {
    OFFLINE.store(offline, Ordering::SeqCst);
}

pub fn is_offline() -> bool {
    OFFLINE.load(Ordering::SeqCst)
}

/// True when a call to a third party may go out right now.
pub fn remote_allowed() -> bool {
    remote_call_allowed(is_offline(), true)
}

/// `Err(offline_mode)` when a remote call is refused, for `CoreError` paths.
pub fn guard_remote() -> Result<(), CoreError> {
    if remote_allowed() {
        Ok(())
    } else {
        Err(CoreError::Llm(OFFLINE_MODE_ERROR.into()))
    }
}

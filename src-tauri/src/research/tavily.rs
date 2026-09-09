//! Tavily adapter — the original research integration, kept as one of the
//! three so it can be compared against Firecrawl/Anthropic web search rather
//! than deleted outright.
//!
//! Reuses `crate::web::tavily_search` (the same HTTP call the live Ally
//! `web_search` tool uses) instead of re-duplicating the Tavily request —
//! `web.rs`'s own doc comment flagged this exact duplication as a safe
//! follow-up once the two call sites were confirmed independent.

use conva_core::research::{ResearchOutcome, ResearchProvider, ResearchProviderId};
use conva_core::CoreError;

use crate::context::load_tavily_key;
use crate::web::tavily_search;

/// Results fetched per query — matches the original `context::research`'s
/// query budget. One difference from that removed implementation: snippets
/// come back at `web::tavily_search`'s 500-char cap rather than the old
/// inline 1,200-char one, since that helper is shared with the live Ally
/// tool call and this adapter is the legacy/comparison option, not the
/// default — not worth a second HTTP implementation to preserve exactly.
const RESULTS_PER_QUERY: usize = 3;

pub struct TavilyProvider;

impl ResearchProvider for TavilyProvider {
    fn id(&self) -> ResearchProviderId {
        ResearchProviderId::Tavily
    }

    /// No key configured → empty outcome, not an error (the profile stays
    /// docs-only) — same contract the original inline implementation had.
    fn research(&self, queries: Vec<String>, max_sources: usize) -> Result<ResearchOutcome, CoreError> {
        let Some(key) = load_tavily_key() else {
            return Ok(ResearchOutcome::default());
        };
        let mut outcome = ResearchOutcome::default();
        for query in queries {
            if outcome.sources.len() >= max_sources {
                break;
            }
            outcome.billed_units += 1;
            let Ok(results) = tavily_search(&key, &query, RESULTS_PER_QUERY) else {
                // A single failed query is skipped, never fatal — the same
                // best-effort contract the original loop had.
                continue;
            };
            for source in results {
                if outcome.sources.len() >= max_sources {
                    break;
                }
                outcome.sources.push(source);
            }
        }
        Ok(outcome)
    }
}

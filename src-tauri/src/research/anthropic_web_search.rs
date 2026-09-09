//! Anthropic web search adapter (the "upgrade" option, owner decision
//! 2026-09-09). Runs Claude's server-side `web_search` tool in ONE request:
//! Claude decides how many searches to run (up to `max_uses`) and can follow
//! up on a thin first pass — unlike the other two adapters' fixed,
//! pre-built query list executed one HTTP call at a time.
//!
//! Reuses the SAME Anthropic key already required for the app's own LLM
//! calls (`crate::llm::resolve_key`) — no separate credential, which is the
//! whole point of offering it as a zero-setup upgrade.
//!
//! Important limitation this adapter works around: `web_search_tool_result`
//! blocks carry `encrypted_content` (replay-only, opaque to this app), so
//! the full page text is NOT extractable for storage/RAG-indexing. What IS
//! plain text: each citation's `cited_text` (up to 150 chars) plus its
//! `title`/`url` — that's what gets stored as this adapter's `ResearchSource`
//! snippets. Shallower per-source than Firecrawl's full-page scrape, but
//! real, storable text, and the agentic search behavior can still surface
//! sources the fixed query list would have missed.

use std::time::Duration;

use conva_core::context::ResearchSource;
use conva_core::llm::ProviderId;
use conva_core::research::{ResearchOutcome, ResearchProvider, ResearchProviderId};
use conva_core::CoreError;

use crate::llm::resolve_key;
use crate::session::now_unix_ms;

const MESSAGES_URL: &str = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION: &str = "2023-06-01";
/// The app's own established "quality slot" default (`AppConfig::default`) —
/// a good cost/quality balance for a bounded, metered research pass, not the
/// priciest model available.
const MODEL: &str = "claude-sonnet-5";

pub struct AnthropicWebSearchProvider;

impl ResearchProvider for AnthropicWebSearchProvider {
    fn id(&self) -> ResearchProviderId {
        ResearchProviderId::AnthropicWebSearch
    }

    /// No Anthropic key configured → empty outcome, not an error — same
    /// "docs-only" degrade every other adapter uses. `queries` are folded
    /// into ONE instruction rather than issued one call per query, so Claude
    /// can plan its own searches against the whole topic at once.
    fn research(&self, queries: Vec<String>, max_sources: usize) -> Result<ResearchOutcome, CoreError> {
        if queries.is_empty() {
            return Ok(ResearchOutcome::default());
        }
        let key = match resolve_key(ProviderId::Anthropic) {
            Ok(key) => key,
            Err(_) => return Ok(ResearchOutcome::default()),
        };

        let instruction = format!(
            "Research the web for each of the following and report back what you find, citing sources:\n{}",
            queries
                .iter()
                .enumerate()
                .map(|(i, q)| format!("{}. {q}", i + 1))
                .collect::<Vec<_>>()
                .join("\n")
        );
        let body = serde_json::json!({
            "model": MODEL,
            "max_tokens": 4096,
            "tools": [{
                "type": "web_search_20250305",
                "name": "web_search",
                "max_uses": max_sources.max(1),
            }],
            "messages": [{"role": "user", "content": instruction}],
        });
        let resp = ureq::post(MESSAGES_URL)
            .set("x-api-key", &key)
            .set("anthropic-version", ANTHROPIC_VERSION)
            .timeout(Duration::from_secs(90))
            .send_json(body);
        let val: serde_json::Value = match resp {
            Ok(r) => match r.into_json() {
                Ok(v) => v,
                Err(e) => return Err(CoreError::Llm(e.to_string())),
            },
            Err(e) => return Err(CoreError::Llm(e.to_string())),
        };

        let billed_units = val
            .get("usage")
            .and_then(|u| u.get("server_tool_use"))
            .and_then(|s| s.get("web_search_requests"))
            .and_then(|v| v.as_u64())
            .unwrap_or(0);

        let mut outcome = ResearchOutcome { sources: Vec::new(), billed_units };
        let mut seen = std::collections::HashSet::new();
        let Some(blocks) = val.get("content").and_then(|c| c.as_array()) else {
            return Ok(outcome);
        };
        for block in blocks {
            let Some(citations) = block.get("citations").and_then(|c| c.as_array()) else {
                continue;
            };
            for citation in citations {
                if outcome.sources.len() >= max_sources {
                    return Ok(outcome);
                }
                let url = citation.get("url").and_then(|v| v.as_str()).unwrap_or("");
                if url.is_empty() || !seen.insert(url.to_string()) {
                    continue;
                }
                outcome.sources.push(ResearchSource {
                    title: citation.get("title").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                    url: url.to_string(),
                    snippet: citation.get("cited_text").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                    fetched_at_unix_ms: now_unix_ms(),
                });
            }
        }
        Ok(outcome)
    }
}

//! Firecrawl adapter (default research provider, owner decision 2026-09-09).
//!
//! Unlike Tavily's snippet-only search, Firecrawl's `/search` endpoint can
//! scrape the full page content of every result in the same call
//! (`scrapeOptions`) — real, storable markdown text, not a short excerpt.
//! Verified pricing (2026-09): ~$1 per 1,000 fully-scraped results at the
//! Standard tier ($0.83/1,000 credits; search = 2 credits/10 results,
//! scrape = 1 credit/page).

use std::time::Duration;

use conva_core::context::ResearchSource;
use conva_core::research::{ResearchOutcome, ResearchProvider, ResearchProviderId};
use conva_core::CoreError;

use crate::session::now_unix_ms;

const KEYRING_SERVICE: &str = "conva";
const KEYRING_USER: &str = "api-key-firecrawl";
const SEARCH_URL: &str = "https://api.firecrawl.dev/v2/search";
/// Results fetched per query — same shape as the other adapters' per-query
/// cap, kept small since each result here also costs a full-page scrape.
const RESULTS_PER_QUERY: usize = 3;
/// A page's markdown can run long; the findings-synthesis prompt needs
/// substance, not the whole page — same intent as Tavily's snippet cap, just
/// a larger budget since this is real page content, not a search snippet.
const CONTENT_CHAR_CAP: usize = 4_000;

pub fn store_firecrawl_key(key: &str) -> Result<(), CoreError> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER)
        .map_err(|e| CoreError::Audio(e.to_string()))?;
    if key.trim().is_empty() {
        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(CoreError::Audio(e.to_string())),
        }
    } else {
        entry
            .set_password(key.trim())
            .map_err(|e| CoreError::Audio(e.to_string()))
    }
}

pub fn load_firecrawl_key() -> Option<String> {
    keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER)
        .ok()?
        .get_password()
        .ok()
}

pub struct FirecrawlProvider;

impl ResearchProvider for FirecrawlProvider {
    fn id(&self) -> ResearchProviderId {
        ResearchProviderId::Firecrawl
    }

    /// No key configured → empty outcome, not an error — same "docs-only"
    /// degrade the other adapters use.
    fn research(
        &self,
        queries: Vec<String>,
        max_sources: usize,
    ) -> Result<ResearchOutcome, CoreError> {
        let Some(key) = load_firecrawl_key() else {
            return Ok(ResearchOutcome::default());
        };
        let mut outcome = ResearchOutcome::default();
        for query in queries {
            if outcome.sources.len() >= max_sources {
                break;
            }
            let body = serde_json::json!({
                "query": query,
                "limit": RESULTS_PER_QUERY,
                "scrapeOptions": {
                    "formats": [{"type": "markdown"}],
                    "onlyMainContent": true,
                },
            });
            let resp = ureq::post(SEARCH_URL)
                .set("Authorization", &format!("Bearer {key}"))
                .timeout(Duration::from_secs(30))
                .send_json(body);
            let val: serde_json::Value = match resp {
                Ok(r) => match r.into_json() {
                    Ok(v) => v,
                    Err(_) => continue,
                },
                // A failed request is skipped, never fatal — the same
                // best-effort contract every other adapter has.
                Err(_) => continue,
            };
            // Firecrawl reports actual spend per call; fall back to the
            // per-query estimate (2 credits/10 results + 1/scrape) only if
            // the field is ever absent, so metering stays honest either way.
            let credits = val
                .get("creditsUsed")
                .and_then(|v| v.as_u64())
                .unwrap_or(2 + RESULTS_PER_QUERY as u64);
            outcome.billed_units += credits;
            let Some(results) = val
                .get("data")
                .and_then(|d| d.get("web"))
                .and_then(|w| w.as_array())
            else {
                continue;
            };
            for r in results {
                if outcome.sources.len() >= max_sources {
                    break;
                }
                let url = r.get("url").and_then(|v| v.as_str()).unwrap_or("");
                if url.is_empty() {
                    continue;
                }
                // Prefer the scraped full page; fall back to the search
                // result's own description if scraping produced nothing
                // (e.g. a PDF or a page that refused the fetch).
                let content = r
                    .get("markdown")
                    .and_then(|v| v.as_str())
                    .filter(|s| !s.is_empty())
                    .or_else(|| r.get("description").and_then(|v| v.as_str()))
                    .unwrap_or("");
                outcome.sources.push(ResearchSource {
                    title: r
                        .get("title")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string(),
                    url: url.to_string(),
                    snippet: content.chars().take(CONTENT_CHAR_CAP).collect(),
                    fetched_at_unix_ms: now_unix_ms(),
                });
            }
        }
        Ok(outcome)
    }
}

//! Research-provider abstraction for Context resource generation (owner
//! decision 2026-09-09, following up on the "Nolan well case" investigation:
//! Tavily's fixed 6-query/1,200-char-snippet pass was too shallow for a real,
//! well-covered topic, and the missing-key failure was silent).
//!
//! Mirrors [`crate::llm`]'s provider-registry pattern exactly, so adding a
//! research provider is the same shape as adding an LLM provider: one
//! `ResearchProvider` implementation file in `src-tauri/src/research/` plus
//! one `ResearchProviderInfo` entry in the registry below. Callers never
//! branch on which provider is active — `research_queries()`/
//! `qa_research_queries()` (in [`crate::context`]) build the SAME
//! provider-agnostic query list regardless of which adapter executes it.
//!
//! Three adapters ship at launch:
//! - **Firecrawl** (default) — search + full-page scrape in one call, ~$1 per
//!   1,000 fully-scraped results. Real, storable page text — feeds the RAG
//!   index like any other source.
//! - **Anthropic web search** (upgrade) — server-side tool on the SAME
//!   Anthropic key the app already requires, so it needs no separate
//!   credential. Agentic (Claude decides how many searches to run and can
//!   follow up on a thin first pass) but its raw result content is
//!   encrypted/replay-only; only the plain-text citation excerpts
//!   (`cited_text`, ≤150 chars) are usable as storable `ResearchSource` text.
//! - **Tavily** — the original integration, kept so the three can be
//!   compared side by side rather than deleted outright.
use serde::{Deserialize, Serialize};

use crate::context::ResearchSource;
use crate::CoreError;

/// Stable identifiers for the research providers (registry below).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ResearchProviderId {
    Firecrawl,
    AnthropicWebSearch,
    Tavily,
}

/// Registry metadata driving the Settings dropdown.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResearchProviderInfo {
    pub id: ResearchProviderId,
    /// Display name for the provider dropdown.
    pub name: &'static str,
    /// One line of Settings copy explaining the trade-off.
    pub description: &'static str,
    /// Whether this provider needs its own stored API key. `false` for
    /// Anthropic web search, which reuses the Anthropic LLM key already
    /// required elsewhere in the app — Settings must not prompt for a
    /// second, redundant key.
    pub requires_own_api_key: bool,
}

/// The launch registry — order here is dropdown order; the first entry is
/// the application default.
pub fn research_provider_registry() -> Vec<ResearchProviderInfo> {
    vec![
        ResearchProviderInfo {
            id: ResearchProviderId::Firecrawl,
            name: "Firecrawl",
            description: "Searches the web and reads the full source pages — the deepest, cheapest option (~$1 per 1,000 fully-read results).",
            requires_own_api_key: true,
        },
        ResearchProviderInfo {
            id: ResearchProviderId::AnthropicWebSearch,
            name: "Claude web search (upgrade)",
            description: "Claude runs its own search-and-follow-up loop using the Anthropic key already configured — no separate key needed.",
            requires_own_api_key: false,
        },
        ResearchProviderInfo {
            id: ResearchProviderId::Tavily,
            name: "Tavily",
            description: "The original integration — shallow snippets, kept only so it can be compared against the two above.",
            requires_own_api_key: true,
        },
    ]
}

/// The application default research provider (first registry entry).
pub const DEFAULT_RESEARCH_PROVIDER: ResearchProviderId = ResearchProviderId::Firecrawl;

/// What one `ResearchProvider::research()` call returns: the sources to fold
/// into the KnowledgeProfile, plus how many billable units (searches,
/// credits — the provider's own unit) it spent, for usage metering.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct ResearchOutcome {
    pub sources: Vec<ResearchSource>,
    pub billed_units: u64,
}

/// A bounded web-research provider. Implementations live in
/// `src-tauri/src/research/` (one file per provider — network calls need
/// `AppHandle`/keyring/`ureq`, which `conva-core` cannot depend on).
///
/// Every implementation must be safe to call with an unconfigured/missing
/// key: return `Ok(ResearchOutcome::default())`, never an `Err`, so a
/// forgotten key degrades to "no research" rather than failing generation
/// outright (the same contract the original Tavily-only `research()` had).
pub trait ResearchProvider: Send + Sync {
    fn id(&self) -> ResearchProviderId;

    /// Run bounded research for the given queries, returning at most
    /// `max_sources` results. `queries` is built by
    /// [`crate::context::research_queries`] or
    /// [`crate::context::qa_research_queries`] — the same list regardless of
    /// which provider executes it.
    fn research(
        &self,
        queries: Vec<String>,
        max_sources: usize,
    ) -> Result<ResearchOutcome, CoreError>;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn registry_default_is_firecrawl_and_first() {
        let registry = research_provider_registry();
        assert_eq!(registry[0].id, DEFAULT_RESEARCH_PROVIDER);
        assert_eq!(registry[0].id, ResearchProviderId::Firecrawl);
    }

    #[test]
    fn registry_has_three_providers() {
        assert_eq!(research_provider_registry().len(), 3);
    }

    #[test]
    fn only_anthropic_web_search_skips_its_own_key() {
        for p in research_provider_registry() {
            let expects_own_key = p.id != ResearchProviderId::AnthropicWebSearch;
            assert_eq!(
                p.requires_own_api_key, expects_own_key,
                "provider {:?}",
                p.id
            );
        }
    }

    #[test]
    fn provider_ids_serialize_snake_case() {
        assert_eq!(
            serde_json::to_string(&ResearchProviderId::Firecrawl).unwrap(),
            "\"firecrawl\""
        );
        assert_eq!(
            serde_json::to_string(&ResearchProviderId::AnthropicWebSearch).unwrap(),
            "\"anthropic_web_search\""
        );
        assert_eq!(
            serde_json::to_string(&ResearchProviderId::Tavily).unwrap(),
            "\"tavily\""
        );
    }

    #[test]
    fn outcome_defaults_to_empty_no_charge() {
        let outcome = ResearchOutcome::default();
        assert!(outcome.sources.is_empty());
        assert_eq!(outcome.billed_units, 0);
    }
}

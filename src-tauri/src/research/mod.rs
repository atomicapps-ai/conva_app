//! Research-provider adapters (owner decision 2026-09-09). Each submodule
//! implements [`conva_core::research::ResearchProvider`] for one vendor;
//! `provider_for` is the only thing call sites touch — swapping the active
//! provider (Settings → `AppConfig::research_provider`) never changes a call
//! site, only which adapter this factory hands back. Adding a fourth
//! provider later is exactly: one new file implementing the trait, one match
//! arm here, one `ResearchProviderInfo` entry in `conva_core::research`.

mod anthropic_web_search;
mod firecrawl;
mod tavily;

pub use firecrawl::{load_firecrawl_key, store_firecrawl_key};

use conva_core::research::{ResearchProvider, ResearchProviderId};

/// Offline mode: every hosted research provider degrades to an empty outcome,
/// the same "docs-only" result a missing key gives, and nothing is sent.
struct OfflineProvider(ResearchProviderId);

impl ResearchProvider for OfflineProvider {
    fn id(&self) -> ResearchProviderId {
        self.0
    }

    fn research(
        &self,
        _queries: Vec<String>,
        _max_sources: usize,
    ) -> Result<conva_core::research::ResearchOutcome, conva_core::CoreError> {
        Ok(conva_core::research::ResearchOutcome::default())
    }
}

/// Resolve the configured provider id to its adapter.
pub fn provider_for(id: ResearchProviderId) -> Box<dyn ResearchProvider> {
    if !crate::offline::remote_allowed() {
        return Box::new(OfflineProvider(id));
    }
    match id {
        ResearchProviderId::Firecrawl => Box::new(firecrawl::FirecrawlProvider),
        ResearchProviderId::AnthropicWebSearch => {
            Box::new(anthropic_web_search::AnthropicWebSearchProvider)
        }
        ResearchProviderId::Tavily => Box::new(tavily::TavilyProvider),
    }
}

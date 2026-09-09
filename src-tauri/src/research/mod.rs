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

/// Resolve the configured provider id to its adapter.
pub fn provider_for(id: ResearchProviderId) -> Box<dyn ResearchProvider> {
    match id {
        ResearchProviderId::Firecrawl => Box::new(firecrawl::FirecrawlProvider),
        ResearchProviderId::AnthropicWebSearch => {
            Box::new(anthropic_web_search::AnthropicWebSearchProvider)
        }
        ResearchProviderId::Tavily => Box::new(tavily::TavilyProvider),
    }
}

//! Model picker catalog: what a provider's live model list is turned into
//! before a dropdown shows it.
//!
//! The live list comes from the provider's own API (so new models appear
//! without an app release). It is noisy: OpenAI lists embeddings, speech and
//! image models next to chat models. This pure module keeps only models that
//! can answer a chat prompt, removes duplicates, and always keeps the curated
//! default present and first, so the screen has a sensible preselection even
//! when the list is empty or the network is down.

use std::collections::HashSet;

use crate::llm::{ModelInfo, ProviderId};

/// Substrings that mark a model id as not a chat model. Matched on the
/// lowercased id, after any `models/` prefix is stripped.
const NOT_CHAT: &[&str] = &[
    "embedding",
    "embed-",
    "whisper",
    "tts",
    "transcribe",
    "dall-e",
    "imagen",
    "veo",
    "gpt-image",
    "moderation",
    "realtime",
    "audio",
    "davinci",
    "babbage",
    "aqa",
    "computer-use",
    "-search-",
];

/// Strip the `models/` prefix Gemini puts on ids.
pub fn normalize_id(id: &str) -> &str {
    id.strip_prefix("models/").unwrap_or(id)
}

/// Whether `id` looks like a model that can answer a chat prompt.
pub fn is_chat_model(provider: ProviderId, id: &str) -> bool {
    let id = normalize_id(id).trim().to_ascii_lowercase();
    if id.is_empty() {
        return false;
    }
    match provider {
        // Anthropic's list is chat-only; a local server lists what the user pulled.
        ProviderId::Anthropic | ProviderId::OllamaLocal => true,
        ProviderId::Openai | ProviderId::Xai | ProviderId::Deepseek | ProviderId::Google => {
            !NOT_CHAT.iter().any(|bad| id.contains(bad))
        }
    }
}

/// Build the dropdown list: the curated `default_model` first, then the live
/// chat models in the provider's own order (newest first for the providers
/// that sort that way), without duplicates.
pub fn build_catalog(
    provider: ProviderId,
    default_model: &str,
    live: Vec<ModelInfo>,
) -> Vec<ModelInfo> {
    let mut seen: HashSet<String> = HashSet::new();
    let mut out: Vec<ModelInfo> = Vec::with_capacity(live.len() + 1);
    let mut push = |id: &str, name: &str, out: &mut Vec<ModelInfo>| {
        let id = normalize_id(id).to_string();
        if seen.insert(id.clone()) {
            let display_name = if name.trim().is_empty() {
                id.clone()
            } else {
                name.to_string()
            };
            out.push(ModelInfo { id, display_name });
        }
    };

    // Reserve the default's slot with its live display name when the provider
    // returned one, so the first row reads the same as it would further down.
    let default_name = live
        .iter()
        .find(|m| normalize_id(&m.id) == default_model)
        .map(|m| m.display_name.clone())
        .unwrap_or_default();
    push(default_model, &default_name, &mut out);

    for m in &live {
        if is_chat_model(provider, &m.id) {
            push(&m.id, &m.display_name, &mut out);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn m(id: &str) -> ModelInfo {
        ModelInfo {
            id: id.into(),
            display_name: id.into(),
        }
    }

    #[test]
    fn openai_list_drops_non_chat_models() {
        let live = vec![
            m("gpt-5.2"),
            m("text-embedding-3-large"),
            m("whisper-1"),
            m("tts-1-hd"),
            m("dall-e-3"),
            m("gpt-image-1"),
            m("gpt-4o-realtime-preview"),
            m("omni-moderation-latest"),
            m("gpt-5-mini"),
        ];
        let ids: Vec<_> = build_catalog(ProviderId::Openai, "gpt-5.2", live)
            .into_iter()
            .map(|x| x.id)
            .collect();
        assert_eq!(ids, ["gpt-5.2", "gpt-5-mini"]);
    }

    #[test]
    fn default_is_first_even_when_the_live_list_omits_it() {
        let live = vec![m("claude-opus-5-5"), m("claude-haiku-4-5")];
        let cat = build_catalog(ProviderId::Anthropic, "claude-sonnet-5-5", live);
        assert_eq!(cat[0].id, "claude-sonnet-5-5");
        assert_eq!(cat.len(), 3);
    }

    #[test]
    fn default_moves_to_the_front_without_duplicating() {
        let live = vec![m("claude-opus-5-5"), m("claude-sonnet-5-5")];
        let cat = build_catalog(ProviderId::Anthropic, "claude-sonnet-5-5", live);
        let ids: Vec<_> = cat.iter().map(|x| x.id.as_str()).collect();
        assert_eq!(ids, ["claude-sonnet-5-5", "claude-opus-5-5"]);
    }

    #[test]
    fn an_empty_live_list_still_offers_the_default() {
        let cat = build_catalog(ProviderId::Google, "gemini-3-pro", vec![]);
        assert_eq!(cat.len(), 1);
        assert_eq!(cat[0].id, "gemini-3-pro");
    }

    #[test]
    fn gemini_prefix_is_stripped_and_embedding_models_dropped() {
        let live = vec![
            m("models/gemini-3-pro"),
            m("models/text-embedding-004"),
            m("models/gemini-3-flash"),
            m("models/aqa"),
        ];
        let ids: Vec<_> = build_catalog(ProviderId::Google, "gemini-3-pro", live)
            .into_iter()
            .map(|x| x.id)
            .collect();
        assert_eq!(ids, ["gemini-3-pro", "gemini-3-flash"]);
    }

    #[test]
    fn local_server_lists_everything_that_was_pulled() {
        let live = vec![m("llama3.1:8b"), m("nomic-embed-text:latest")];
        let cat = build_catalog(ProviderId::OllamaLocal, "llama3.1:8b", live);
        assert_eq!(cat.len(), 2);
    }

    #[test]
    fn a_live_display_name_is_kept() {
        let live = vec![ModelInfo {
            id: "claude-sonnet-5-5".into(),
            display_name: "Claude Sonnet 5.5".into(),
        }];
        let cat = build_catalog(ProviderId::Anthropic, "claude-sonnet-5-5", live);
        assert_eq!(cat[0].display_name, "Claude Sonnet 5.5");
    }

    #[test]
    fn blank_ids_are_ignored() {
        let live = vec![m(""), m("  ")];
        let cat = build_catalog(ProviderId::Openai, "gpt-5.2", live);
        assert_eq!(cat.len(), 1);
    }
}

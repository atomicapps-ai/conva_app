//! Usage metering — the pure ledger behind the Settings → Usage panel.
//!
//! conva is bring-your-own-key on the desktop, so metering here is about
//! **visibility**: the owner sees exactly what their keys are being spent on
//! (LLM tokens per provider, plus Tavily web searches — Tavily bills per
//! *search*, not per token). Every LLM completion is also attributed to a
//! **feature × provider × model** bucket ([`LlmFeatureUsage`]) so token spend
//! is answerable per app feature, not just per provider — the counts-only
//! local precursor of the platform's `usage_events` ledger (roadmap F8b,
//! `docs/platform/04-billing-credits.md`). This module stays pure so both
//! surfaces share one accounting model.
//!
//! The shell (`src-tauri/src/metering.rs`) owns persistence and calls
//! [`UsageLedger::record_llm`] / [`UsageLedger::record_tavily_search`] at each
//! metered call site. Everything here is fs/OS-free and unit-tested.

use serde::{Deserialize, Serialize};

use crate::llm::{ProviderId, TokenUsage};

/// Running usage for a single LLM provider.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProviderUsage {
    pub provider: ProviderId,
    pub input_tokens: u64,
    pub output_tokens: u64,
    /// Number of completions attributed to this provider.
    pub requests: u64,
}

impl ProviderUsage {
    fn new(provider: ProviderId) -> Self {
        Self {
            provider,
            input_tokens: 0,
            output_tokens: 0,
            requests: 0,
        }
    }
}

/// Running LLM usage for one **feature × provider × model** bucket — the
/// "what was this spent on" axis of the ledger. `feature` is a stable
/// snake_case label owned by the call site (e.g. `ally_question`, `tracker`,
/// `context_knowledge`); the full set lives with the shell's recorder.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LlmFeatureUsage {
    pub feature: String,
    pub provider: ProviderId,
    pub model: String,
    pub input_tokens: u64,
    pub output_tokens: u64,
    /// Completion attempts (successful or not) attributed to this bucket.
    pub requests: u64,
    /// Attempts whose stream ended in an error. Their tokens above still
    /// count — the provider billed whatever streamed before the failure.
    #[serde(default)]
    pub failed_requests: u64,
}

impl LlmFeatureUsage {
    fn new(feature: &str, provider: ProviderId, model: &str) -> Self {
        Self {
            feature: feature.to_string(),
            provider,
            model: model.to_string(),
            input_tokens: 0,
            output_tokens: 0,
            requests: 0,
            failed_requests: 0,
        }
    }
}

/// The persisted usage ledger. One per machine; the shell mirrors it to
/// `<app-data>/usage.json`.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct UsageLedger {
    /// Per-provider LLM token totals.
    #[serde(default)]
    pub providers: Vec<ProviderUsage>,
    /// Per feature × provider × model LLM token totals.
    #[serde(default)]
    pub llm_features: Vec<LlmFeatureUsage>,
    /// Tavily web searches (each Tavily query is one billed search).
    #[serde(default)]
    pub tavily_searches: u64,
    /// Text-to-speech characters synthesized (Deepgram Aura bills per character).
    #[serde(default)]
    pub tts_characters: u64,
    /// When the current accounting window opened (first record, or last reset).
    /// `0` means "not started yet".
    #[serde(default)]
    pub since_unix_ms: u64,
    /// Last time any counter moved.
    #[serde(default)]
    pub updated_at_unix_ms: u64,
}

impl UsageLedger {
    fn start_window(&mut self, now_unix_ms: u64) {
        if self.since_unix_ms == 0 {
            self.since_unix_ms = now_unix_ms;
        }
        self.updated_at_unix_ms = now_unix_ms;
    }

    /// Attribute one completion attempt's token usage to `provider` and to
    /// its `feature` × `model` bucket. A zero-token usage (provider reported
    /// nothing) still counts as one request, so the request tally stays
    /// honest even when token counts are unavailable. `ok = false` marks a
    /// failed attempt — its tokens are still added, because the provider
    /// billed whatever streamed before the failure.
    pub fn record_llm(
        &mut self,
        feature: &str,
        provider: ProviderId,
        model: &str,
        usage: TokenUsage,
        ok: bool,
        now_unix_ms: u64,
    ) {
        self.start_window(now_unix_ms);
        let entry = match self.providers.iter_mut().find(|p| p.provider == provider) {
            Some(e) => e,
            None => {
                self.providers.push(ProviderUsage::new(provider));
                self.providers
                    .last_mut()
                    .expect("just pushed a provider entry")
            }
        };
        entry.input_tokens = entry.input_tokens.saturating_add(usage.input_tokens);
        entry.output_tokens = entry.output_tokens.saturating_add(usage.output_tokens);
        entry.requests = entry.requests.saturating_add(1);

        let bucket = match self
            .llm_features
            .iter_mut()
            .find(|b| b.feature == feature && b.provider == provider && b.model == model)
        {
            Some(b) => b,
            None => {
                self.llm_features
                    .push(LlmFeatureUsage::new(feature, provider, model));
                self.llm_features
                    .last_mut()
                    .expect("just pushed a feature bucket")
            }
        };
        bucket.input_tokens = bucket.input_tokens.saturating_add(usage.input_tokens);
        bucket.output_tokens = bucket.output_tokens.saturating_add(usage.output_tokens);
        bucket.requests = bucket.requests.saturating_add(1);
        if !ok {
            bucket.failed_requests = bucket.failed_requests.saturating_add(1);
        }
    }

    /// Count `count` Tavily searches (one per bounded research query issued).
    pub fn record_tavily_search(&mut self, count: u64, now_unix_ms: u64) {
        if count == 0 {
            return;
        }
        self.start_window(now_unix_ms);
        self.tavily_searches = self.tavily_searches.saturating_add(count);
    }

    /// Count `chars` synthesized by text-to-speech (Aura bills per character).
    pub fn record_tts_characters(&mut self, chars: u64, now_unix_ms: u64) {
        if chars == 0 {
            return;
        }
        self.start_window(now_unix_ms);
        self.tts_characters = self.tts_characters.saturating_add(chars);
    }

    /// Clear all counters, reopening the window at `now`.
    pub fn reset(&mut self, now_unix_ms: u64) {
        *self = UsageLedger {
            since_unix_ms: now_unix_ms,
            updated_at_unix_ms: now_unix_ms,
            ..Default::default()
        };
    }

    /// A UI-ready snapshot with cross-provider totals precomputed and the
    /// feature buckets sorted heaviest-first (by total tokens).
    pub fn summary(&self) -> UsageSummary {
        let total_input_tokens = self.providers.iter().map(|p| p.input_tokens).sum();
        let total_output_tokens = self.providers.iter().map(|p| p.output_tokens).sum();
        let total_requests = self.providers.iter().map(|p| p.requests).sum();
        let mut llm_features = self.llm_features.clone();
        llm_features.sort_by(|a, b| {
            (b.input_tokens.saturating_add(b.output_tokens))
                .cmp(&a.input_tokens.saturating_add(a.output_tokens))
        });
        UsageSummary {
            providers: self.providers.clone(),
            llm_features,
            total_input_tokens,
            total_output_tokens,
            total_requests,
            tavily_searches: self.tavily_searches,
            tts_characters: self.tts_characters,
            since_unix_ms: self.since_unix_ms,
            updated_at_unix_ms: self.updated_at_unix_ms,
        }
    }
}

/// What the Settings → Usage panel renders — the ledger plus running totals.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct UsageSummary {
    pub providers: Vec<ProviderUsage>,
    /// Feature × provider × model buckets, heaviest (total tokens) first.
    #[serde(default)]
    pub llm_features: Vec<LlmFeatureUsage>,
    pub total_input_tokens: u64,
    pub total_output_tokens: u64,
    pub total_requests: u64,
    pub tavily_searches: u64,
    pub tts_characters: u64,
    pub since_unix_ms: u64,
    pub updated_at_unix_ms: u64,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tok(input: u64, output: u64) -> TokenUsage {
        TokenUsage {
            input_tokens: input,
            output_tokens: output,
        }
    }

    #[test]
    fn first_record_opens_the_window() {
        let mut led = UsageLedger::default();
        assert_eq!(led.since_unix_ms, 0);
        led.record_llm(
            "ally_question",
            ProviderId::Anthropic,
            "claude-sonnet-5",
            tok(10, 5),
            true,
            1_000,
        );
        assert_eq!(led.since_unix_ms, 1_000);
        assert_eq!(led.updated_at_unix_ms, 1_000);
    }

    #[test]
    fn llm_usage_accumulates_per_provider() {
        let mut led = UsageLedger::default();
        led.record_llm(
            "ally_question",
            ProviderId::Anthropic,
            "claude-sonnet-5",
            tok(10, 5),
            true,
            1,
        );
        led.record_llm(
            "tracker",
            ProviderId::Anthropic,
            "claude-haiku-4-5",
            tok(3, 7),
            true,
            2,
        );
        led.record_llm(
            "ally_question",
            ProviderId::Openai,
            "gpt-5.2",
            tok(100, 20),
            true,
            3,
        );

        let sum = led.summary();
        assert_eq!(sum.providers.len(), 2);
        let anthropic = sum
            .providers
            .iter()
            .find(|p| p.provider == ProviderId::Anthropic)
            .unwrap();
        assert_eq!(anthropic.input_tokens, 13);
        assert_eq!(anthropic.output_tokens, 12);
        assert_eq!(anthropic.requests, 2);

        assert_eq!(sum.total_input_tokens, 113);
        assert_eq!(sum.total_output_tokens, 32);
        assert_eq!(sum.total_requests, 3);
    }

    #[test]
    fn llm_usage_buckets_by_feature_provider_and_model() {
        let mut led = UsageLedger::default();
        // Same feature+provider+model twice → one bucket, summed.
        led.record_llm(
            "ally_question",
            ProviderId::Anthropic,
            "claude-sonnet-5",
            tok(10, 5),
            true,
            1,
        );
        led.record_llm(
            "ally_question",
            ProviderId::Anthropic,
            "claude-sonnet-5",
            tok(2, 3),
            true,
            2,
        );
        // Same feature, different model → its own bucket.
        led.record_llm(
            "ally_question",
            ProviderId::Anthropic,
            "claude-haiku-4-5",
            tok(1, 1),
            true,
            3,
        );
        // Different feature entirely.
        led.record_llm(
            "tracker",
            ProviderId::Anthropic,
            "claude-haiku-4-5",
            tok(500, 100),
            true,
            4,
        );

        let sum = led.summary();
        assert_eq!(sum.llm_features.len(), 3);
        // Heaviest bucket (tracker, 600 tokens) sorts first.
        assert_eq!(sum.llm_features[0].feature, "tracker");
        let ally = sum
            .llm_features
            .iter()
            .find(|b| b.feature == "ally_question" && b.model == "claude-sonnet-5")
            .unwrap();
        assert_eq!(ally.input_tokens, 12);
        assert_eq!(ally.output_tokens, 8);
        assert_eq!(ally.requests, 2);
        assert_eq!(ally.failed_requests, 0);
    }

    #[test]
    fn failed_attempts_keep_their_tokens_and_are_counted() {
        let mut led = UsageLedger::default();
        led.record_llm(
            "ally_question",
            ProviderId::Anthropic,
            "claude-sonnet-5",
            tok(40, 12),
            false,
            1,
        );
        let sum = led.summary();
        let bucket = &sum.llm_features[0];
        assert_eq!(bucket.requests, 1);
        assert_eq!(bucket.failed_requests, 1);
        // Tokens streamed before the failure were billed — they stay counted.
        assert_eq!(bucket.input_tokens, 40);
        assert_eq!(bucket.output_tokens, 12);
        assert_eq!(sum.total_requests, 1);
    }

    #[test]
    fn zero_token_usage_still_counts_a_request() {
        let mut led = UsageLedger::default();
        led.record_llm(
            "tracker",
            ProviderId::OllamaLocal,
            "llama3.1:8b",
            TokenUsage::default(),
            true,
            1,
        );
        let p = &led.summary().providers[0];
        assert_eq!(p.requests, 1);
        assert_eq!(p.input_tokens, 0);
        assert_eq!(led.summary().llm_features[0].requests, 1);
    }

    #[test]
    fn tavily_searches_count_and_ignore_zero() {
        let mut led = UsageLedger::default();
        led.record_tavily_search(0, 1);
        assert_eq!(led.tavily_searches, 0);
        assert_eq!(
            led.since_unix_ms, 0,
            "a zero count must not open the window"
        );
        led.record_tavily_search(3, 5);
        led.record_tavily_search(2, 6);
        assert_eq!(led.tavily_searches, 5);
        assert_eq!(led.since_unix_ms, 5);
    }

    #[test]
    fn reset_clears_everything_and_reopens() {
        let mut led = UsageLedger::default();
        led.record_llm(
            "ally_question",
            ProviderId::Anthropic,
            "claude-sonnet-5",
            tok(1, 1),
            true,
            1,
        );
        led.record_tavily_search(4, 2);
        led.record_tts_characters(120, 3);
        assert_eq!(led.tts_characters, 120);
        led.reset(50);
        assert!(led.providers.is_empty());
        assert!(led.llm_features.is_empty());
        assert_eq!(led.tavily_searches, 0);
        assert_eq!(led.tts_characters, 0);
        assert_eq!(led.since_unix_ms, 50);
        assert_eq!(led.updated_at_unix_ms, 50);
    }
}

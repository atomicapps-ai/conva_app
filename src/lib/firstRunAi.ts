import type { AppConfig, ModelInfo, ProviderId, ProviderInfo } from "@/lib/ipc";

/**
 * First-run "How should Ally think?" decisions, kept pure so they are unit
 * tested without a window. Plan: conva_core `first-run-local-ai-ollama.md`.
 */

/**
 * Show the screen once, on a desktop that can hold keys, after the recording
 * consent (so two dialogs never stack), when no model has been chosen and no
 * provider key is already saved. A user who already has a key is never asked.
 */
export function shouldShowFirstRunAi(input: {
  config: AppConfig | null;
  keyStatus: Partial<Record<ProviderId, boolean>>;
  byoKeys: boolean;
}): boolean {
  const { config, keyStatus, byoKeys } = input;
  if (!config || !byoKeys) return false;
  if (!config.consent_acknowledged) return false;
  if (config.ai_setup_completed) return false;
  return !Object.values(keyStatus).some(Boolean);
}

/** Providers a user can paste a key for (everything that is not on-device). */
export function keyProviders(registry: ProviderInfo[]): ProviderInfo[] {
  return registry.filter((p) => p.requires_api_key);
}

/**
 * Where a person without a key creates one, by provider. Shown as plain text
 * (the key is created on the provider's own site, in the person's own account).
 * A provider not listed here shows no hint.
 */
const KEY_CONSOLE: Partial<Record<ProviderId, string>> = {
  anthropic: "console.anthropic.com",
  openai: "platform.openai.com",
  google: "aistudio.google.com",
  xai: "console.x.ai",
  deepseek: "platform.deepseek.com",
};

/** "Create one at console.anthropic.com", or null when we don't know the site. */
export function keyHelp(providerId: ProviderId): string | null {
  const host = KEY_CONSOLE[providerId];
  return host ? `No key yet? Create one in your account at ${host}.` : null;
}

/**
 * Dropdown options: the curated defaults, then the provider's live list. The
 * shell already puts the curated default first and drops non-chat models; this
 * keeps the UI correct if it is handed a raw list or an empty one, and always
 * includes the current selection so the control never shows a blank.
 */
export function mergeModelOptions(
  provider: Pick<ProviderInfo, "default_quality_model" | "default_fast_model">,
  live: ModelInfo[],
  selected?: string,
): ModelInfo[] {
  const out: ModelInfo[] = [];
  const seen = new Set<string>();
  const add = (id: string, name?: string) => {
    if (!id || seen.has(id)) return;
    seen.add(id);
    out.push({ id, display_name: name && name.trim() ? name : id });
  };
  const liveName = (id: string) => live.find((m) => m.id === id)?.display_name;
  add(provider.default_quality_model, liveName(provider.default_quality_model));
  add(provider.default_fast_model, liveName(provider.default_fast_model));
  for (const m of live) add(m.id, m.display_name);
  if (selected) add(selected, liveName(selected));
  return out;
}

/** "Claude Sonnet 5.5 (claude-sonnet-5-5)", or just the id when it is the name. */
export function modelLabel(m: ModelInfo): string {
  return m.display_name === m.id ? m.id : `${m.display_name} (${m.id})`;
}

/**
 * The config patch that completes setup with a working key: both slots move to
 * the chosen provider so a provider change never leaves a slot pointing at
 * another vendor. Quality = the picked model; fast = the picked fast model, or
 * that provider's fast default when none was picked.
 */
export function completeWithKeyPatch(
  provider: ProviderInfo,
  model: string,
  fastModel?: string,
): Partial<AppConfig> {
  return {
    llm_quality: { provider: provider.id, model },
    llm_fast: { provider: provider.id, model: fastModel || provider.default_fast_model },
    ai_setup_completed: true,
  };
}

/** Skipping keeps every default and just records that the choice was offered. */
export const SKIP_PATCH: Partial<AppConfig> = { ai_setup_completed: true };

/**
 * Copy for the free on-device card. Owner decision 2026-10-01: it must say
 * plainly that a local model is slower and weaker than a cloud model, and it
 * is never preselected. Wording is a draft pending owner approval.
 */
export const LOCAL_CARD = {
  title: "Free, on this device",
  tagline: "Basic answers, runs offline, no key needed",
  disclosure:
    "A model running on this computer is slower and gives noticeably weaker answers than a cloud model, and it can miss or get details wrong. Best for trying conva; use your own key for answers you rely on.",
  unavailable: "Not available in this build yet",
} as const;

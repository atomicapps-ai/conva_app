import { describe, expect, it } from "vitest";

import {
  completeWithKeyPatch,
  keyHelp,
  keyProviders,
  LOCAL_CARD,
  mergeModelOptions,
  modelLabel,
  shouldShowFirstRunAi,
  SKIP_PATCH,
} from "@/lib/firstRunAi";
import type { AppConfig, ProviderInfo } from "@/lib/ipc";

const anthropic: ProviderInfo = {
  id: "anthropic",
  name: "Anthropic Claude",
  default_quality_model: "claude-sonnet-5-5",
  default_fast_model: "claude-haiku-4-5",
  requires_api_key: true,
  is_local: false,
};
const ollama: ProviderInfo = {
  id: "ollama_local",
  name: "Ollama (local)",
  default_quality_model: "llama3.1:8b",
  default_fast_model: "llama3.1:8b",
  requires_api_key: false,
  is_local: true,
};

function cfg(over: Partial<AppConfig> = {}): AppConfig {
  return {
    consent_acknowledged: true,
    ai_setup_completed: false,
    llm_quality: { provider: "anthropic", model: "claude-sonnet-5-5" },
    llm_fast: null,
    ...over,
  } as AppConfig;
}

describe("shouldShowFirstRunAi", () => {
  const base = { config: cfg(), keyStatus: {}, byoKeys: true };

  it("shows once on a fresh desktop install", () => {
    expect(shouldShowFirstRunAi(base)).toBe(true);
  });
  it("waits for the recording consent so dialogs never stack", () => {
    expect(
      shouldShowFirstRunAi({ ...base, config: cfg({ consent_acknowledged: false }) }),
    ).toBe(false);
  });
  it("never shows again after it was answered or skipped", () => {
    expect(
      shouldShowFirstRunAi({ ...base, config: cfg({ ai_setup_completed: true }) }),
    ).toBe(false);
  });
  it("does not ask a user who already has a key saved", () => {
    expect(shouldShowFirstRunAi({ ...base, keyStatus: { openai: true } })).toBe(false);
  });
  it("a provider reported as no key does not count as a key", () => {
    expect(shouldShowFirstRunAi({ ...base, keyStatus: { openai: false } })).toBe(true);
  });
  it("never shows where keys are unsupported (web) or before config loads", () => {
    expect(shouldShowFirstRunAi({ ...base, byoKeys: false })).toBe(false);
    expect(shouldShowFirstRunAi({ ...base, config: null })).toBe(false);
  });
});

describe("keyProviders", () => {
  it("offers only providers that take a key", () => {
    expect(keyProviders([anthropic, ollama]).map((p) => p.id)).toEqual(["anthropic"]);
  });
});

describe("keyHelp", () => {
  it("names the provider's own site for creating a key, and nothing for a local provider", () => {
    expect(keyHelp("anthropic")).toMatch(/console\.anthropic\.com/);
    expect(keyHelp("openai")).toMatch(/platform\.openai\.com/);
    expect(keyHelp("ollama_local")).toBeNull();
  });
});

describe("mergeModelOptions", () => {
  it("lists the curated defaults first, recommended model leading", () => {
    const ids = mergeModelOptions(anthropic, []).map((m) => m.id);
    expect(ids).toEqual(["claude-sonnet-5-5", "claude-haiku-4-5"]);
  });
  it("adds the live list after the defaults without duplicates", () => {
    const ids = mergeModelOptions(anthropic, [
      { id: "claude-opus-5-5", display_name: "Claude Opus 5.5" },
      { id: "claude-sonnet-5-5", display_name: "Claude Sonnet 5.5" },
    ]).map((m) => m.id);
    expect(ids).toEqual(["claude-sonnet-5-5", "claude-haiku-4-5", "claude-opus-5-5"]);
  });
  it("uses the live friendly name for a curated default", () => {
    const first = mergeModelOptions(anthropic, [
      { id: "claude-sonnet-5-5", display_name: "Claude Sonnet 5.5" },
    ])[0];
    expect(first.display_name).toBe("Claude Sonnet 5.5");
  });
  it("always includes the current selection, even if retired from the live list", () => {
    const ids = mergeModelOptions(anthropic, [], "claude-old-4").map((m) => m.id);
    expect(ids).toContain("claude-old-4");
  });
});

describe("modelLabel", () => {
  it("shows name and id, or just the id when they match", () => {
    expect(modelLabel({ id: "a", display_name: "A Model" })).toBe("A Model (a)");
    expect(modelLabel({ id: "a", display_name: "a" })).toBe("a");
  });
});

describe("completeWithKeyPatch", () => {
  it("moves both slots to the chosen provider and records setup as done", () => {
    expect(completeWithKeyPatch(anthropic, "claude-opus-5-5")).toEqual({
      llm_quality: { provider: "anthropic", model: "claude-opus-5-5" },
      llm_fast: { provider: "anthropic", model: "claude-haiku-4-5" },
      ai_setup_completed: true,
    });
  });
  it("uses the picked fast model, and falls back to the provider's fast default", () => {
    expect(completeWithKeyPatch(anthropic, "claude-sonnet-5-5", "claude-sonnet-5-5")).toEqual({
      llm_quality: { provider: "anthropic", model: "claude-sonnet-5-5" },
      llm_fast: { provider: "anthropic", model: "claude-sonnet-5-5" },
      ai_setup_completed: true,
    });
    expect(completeWithKeyPatch(anthropic, "claude-sonnet-5-5", "").llm_fast).toEqual({
      provider: "anthropic",
      model: "claude-haiku-4-5",
    });
  });
  it("skipping only records that the choice was offered", () => {
    expect(SKIP_PATCH).toEqual({ ai_setup_completed: true });
  });
});

describe("local card copy", () => {
  it("states the quality and speed trade-off plainly", () => {
    expect(LOCAL_CARD.disclosure).toMatch(/slower/i);
    expect(LOCAL_CARD.disclosure).toMatch(/weaker/i);
    expect(LOCAL_CARD.tagline).toMatch(/basic answers/i);
  });
});

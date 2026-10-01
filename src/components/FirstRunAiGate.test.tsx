import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FirstRunAiGate } from "@/components/FirstRunAiGate";
import { BackendProvider } from "@/lib/backend";
import { DESKTOP_CAPABILITIES, WEB_CAPABILITIES } from "@/lib/backend/capabilities";
import type { ConvaBackend } from "@/lib/backend/ConvaBackend";
import type { AppConfig, ModelInfo, ProviderInfo } from "@/lib/ipc";
import { useAppStore } from "@/state/app";

afterEach(cleanup);

const registry: ProviderInfo[] = [
  {
    id: "anthropic",
    name: "Anthropic Claude",
    default_quality_model: "claude-sonnet-5-5",
    default_fast_model: "claude-haiku-4-5",
    requires_api_key: true,
    is_local: false,
  },
  {
    id: "openai",
    name: "OpenAI",
    default_quality_model: "gpt-5.2",
    default_fast_model: "gpt-5-mini",
    requires_api_key: true,
    is_local: false,
  },
  {
    id: "ollama_local",
    name: "Ollama (local)",
    default_quality_model: "llama3.1:8b",
    default_fast_model: "llama3.1:8b",
    requires_api_key: false,
    is_local: true,
  },
];

function config(over: Partial<AppConfig> = {}): AppConfig {
  return {
    consent_acknowledged: true,
    ai_setup_completed: false,
    llm_quality: { provider: "anthropic", model: "claude-sonnet-5-5" },
    llm_fast: null,
    ...over,
  } as AppConfig;
}

function backend(over: Partial<ConvaBackend["providers"]> = {}, web = false) {
  return {
    capabilities: vi.fn().mockResolvedValue(web ? WEB_CAPABILITIES : DESKTOP_CAPABILITIES),
    providers: {
      setKey: vi.fn().mockResolvedValue(undefined),
      test: vi.fn().mockResolvedValue(420),
      listModels: vi.fn().mockResolvedValue([]),
      ...over,
    },
  } as unknown as ConvaBackend;
}

const updateConfig = vi.fn().mockResolvedValue(undefined);
const refreshKeyStatus = vi.fn().mockResolvedValue(undefined);

beforeEach(() => {
  updateConfig.mockClear();
  refreshKeyStatus.mockClear();
  useAppStore.setState({
    config: config(),
    registry,
    keyStatus: {},
    updateConfig,
    refreshKeyStatus,
  });
});

function mount(b: ConvaBackend) {
  return render(
    <BackendProvider backend={b}>
      <FirstRunAiGate />
    </BackendProvider>,
  );
}

describe("FirstRunAiGate", () => {
  it("offers the three choices with the key path preselected", async () => {
    mount(backend());
    await screen.findByRole("heading", { name: "How should Ally think?" });
    expect(screen.getByRole("radio", { name: /use my own key/i })).toBeChecked();
    expect(screen.getByRole("radio", { name: /not now/i })).not.toBeChecked();
    // The free card is shown, honest, and cannot be chosen yet.
    const local = screen.getByText(/free, on this device/i).closest("label")!;
    expect(local.querySelector("input")).toBeDisabled();
    expect(screen.getByText(/slower and gives noticeably weaker answers/i)).toBeInTheDocument();
    expect(screen.getByText(/basic answers, runs offline/i)).toBeInTheDocument();
  });

  it("defaults the model to Sonnet 5.5 and never lists the local provider for keys", async () => {
    mount(backend());
    await screen.findByRole("heading", { name: "How should Ally think?" });
    const model = screen.getByLabelText("Model") as HTMLSelectElement;
    expect(model.value).toBe("claude-sonnet-5-5");
    expect(model.selectedOptions[0].textContent).toMatch(/recommended/);
    const provider = screen.getByLabelText("Provider") as HTMLSelectElement;
    expect([...provider.options].map((o) => o.value)).toEqual(["anthropic", "openai"]);
  });

  it("saves the key, tests it, then completes setup with the chosen model", async () => {
    const b = backend();
    mount(b);
    await screen.findByRole("heading", { name: "How should Ally think?" });
    fireEvent.change(screen.getByPlaceholderText("Paste API key…"), {
      target: { value: "  sk-test  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save key and continue" }));
    await waitFor(() => expect(updateConfig).toHaveBeenCalled());
    expect(b.providers.setKey).toHaveBeenCalledWith("anthropic", "sk-test");
    expect(b.providers.test).toHaveBeenCalledWith("anthropic", "claude-sonnet-5-5");
    expect(updateConfig).toHaveBeenCalledWith({
      llm_quality: { provider: "anthropic", model: "claude-sonnet-5-5" },
      llm_fast: { provider: "anthropic", model: "claude-haiku-4-5" },
      ai_setup_completed: true,
    });
  });

  it("does not complete setup when the key fails its test, and keeps showing why", async () => {
    // Saving the key flips keyStatus, as in the real app.
    refreshKeyStatus.mockImplementationOnce(async () => {
      useAppStore.setState({ keyStatus: { anthropic: true } });
    });
    const b = backend({ test: vi.fn().mockRejectedValue("HTTP 401: bad key") });
    mount(b);
    await screen.findByRole("heading", { name: "How should Ally think?" });
    fireEvent.change(screen.getByPlaceholderText("Paste API key…"), {
      target: { value: "bad" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save key and continue" }));
    expect(await screen.findByText(/401/)).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(updateConfig).not.toHaveBeenCalled();
  });

  it("loads the provider's live model list once the key is saved", async () => {
    refreshKeyStatus.mockImplementationOnce(async () => {
      useAppStore.setState({ keyStatus: { anthropic: true } });
    });
    const live: ModelInfo[] = [{ id: "claude-opus-5-5", display_name: "Claude Opus 5.5" }];
    const b = backend({
      listModels: vi.fn().mockResolvedValue(live),
      test: vi.fn().mockRejectedValue("HTTP 500"),
    });
    mount(b);
    await screen.findByRole("heading", { name: "How should Ally think?" });
    expect(b.providers.listModels).not.toHaveBeenCalled();
    fireEvent.change(screen.getByPlaceholderText("Paste API key…"), {
      target: { value: "k" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save key and continue" }));
    await waitFor(() => expect(b.providers.listModels).toHaveBeenCalledWith("anthropic"));
    const model = screen.getByLabelText("Model") as HTMLSelectElement;
    await waitFor(() =>
      expect([...model.options].map((o) => o.value)).toContain("claude-opus-5-5"),
    );
    // The recommended default stays first and selected.
    expect(model.value).toBe("claude-sonnet-5-5");
  });

  it("Not now records the choice and changes nothing else", async () => {
    mount(backend());
    await screen.findByRole("heading", { name: "How should Ally think?" });
    fireEvent.click(screen.getByRole("radio", { name: /not now/i }));
    fireEvent.click(screen.getByRole("button", { name: "Continue without a model" }));
    expect(updateConfig).toHaveBeenCalledWith({ ai_setup_completed: true });
  });

  it("stays hidden on web, before consent, once done, or when a key already exists", async () => {
    mount(backend({}, true));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    cleanup();

    useAppStore.setState({ config: config({ consent_acknowledged: false }) });
    mount(backend());
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    cleanup();

    useAppStore.setState({ config: config({ ai_setup_completed: true }) });
    mount(backend());
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    cleanup();

    useAppStore.setState({ config: config(), keyStatus: { openai: true } });
    mount(backend());
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});

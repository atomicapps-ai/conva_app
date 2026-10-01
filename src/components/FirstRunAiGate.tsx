import { useEffect, useMemo, useState } from "react";

import { useBackend, useCapabilities } from "@/lib/backend";
import {
  completeWithKeyPatch,
  keyProviders,
  LOCAL_CARD,
  mergeModelOptions,
  modelLabel,
  shouldShowFirstRunAi,
  SKIP_PATCH,
} from "@/lib/firstRunAi";
import type { ModelInfo, ProviderId } from "@/lib/ipc";
import { useAppStore } from "@/state/app";

type Choice = "key" | "later";

/**
 * First-launch "How should Ally think?" (roadmap 1.8). Three honest choices:
 * your own key (preselected), a free on-device model (not offered until a
 * model is pinned; the card says so), or not now. Shown once, after the
 * recording consent; the same controls live on in Settings → Ally.
 */
export function FirstRunAiGate() {
  const backend = useBackend();
  const caps = useCapabilities();
  const config = useAppStore((s) => s.config);
  const registry = useAppStore((s) => s.registry);
  const keyStatus = useAppStore((s) => s.keyStatus);
  const updateConfig = useAppStore((s) => s.updateConfig);
  const refreshKeyStatus = useAppStore((s) => s.refreshKeyStatus);

  const providers = useMemo(() => keyProviders(registry), [registry]);
  const [choice, setChoice] = useState<Choice>("key");
  const [providerId, setProviderId] = useState<ProviderId>("anthropic");
  const [model, setModel] = useState<string | null>(null);
  const [keyInput, setKeyInput] = useState("");
  const [live, setLive] = useState<ModelInfo[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  // Saving the key flips `keyStatus`, which would hide the gate mid-flow and
  // swallow a failed test; hold it open until setup actually completes.
  const [inFlow, setInFlow] = useState(false);

  const provider = providers.find((p) => p.id === providerId) ?? providers[0];
  const options = provider ? mergeModelOptions(provider, live, model ?? undefined) : [];
  const selectedModel = model ?? provider?.default_quality_model ?? "";

  // Reset the model when the provider changes; the list is re-fetched below.
  useEffect(() => {
    setModel(null);
    setLive([]);
    setStatus(null);
  }, [providerId]);

  // The live list needs a key, so it only loads once one is saved.
  const hasKey = keyStatus[providerId] ?? false;
  useEffect(() => {
    if (!hasKey) return;
    let cancelled = false;
    backend.providers
      .listModels(providerId)
      .then((list) => {
        if (!cancelled) setLive(list);
      })
      .catch(() => {
        /* the curated defaults stay */
      });
    return () => {
      cancelled = true;
    };
  }, [backend, providerId, hasKey]);

  const eligible = shouldShowFirstRunAi({
    config,
    keyStatus,
    byoKeys: caps?.llm.byoKeys ?? false,
  });
  if (!(eligible || (inFlow && !config?.ai_setup_completed)) || !provider) {
    return null;
  }

  const saveAndContinue = async () => {
    setBusy(true);
    setInFlow(true);
    setStatus("Checking your key…");
    try {
      await backend.providers.setKey(provider.id, keyInput.trim());
      setKeyInput("");
      await refreshKeyStatus();
      const ms = await backend.providers.test(provider.id, selectedModel);
      setStatus(`✓ Connected — first answer in ${ms} ms`);
      await updateConfig(completeWithKeyPatch(provider, selectedModel));
      setInFlow(false);
    } catch (e) {
      setStatus(String(e));
    } finally {
      setBusy(false);
    }
  };

  const skip = () => void updateConfig(SKIP_PATCH);

  return (
    <div
      className="absolute inset-0 z-50 flex items-center justify-center bg-bg/80 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="first-run-ai-title"
    >
      <div className="mx-4 max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-lg border border-border bg-panel p-6">
        <h2 id="first-run-ai-title" className="text-sm font-semibold">
          How should Ally think?
        </h2>
        <p className="mt-2 text-xs leading-relaxed text-fg-muted">
          Ally answers questions during your conversations. Pick where those
          answers come from. You can change this any time in Settings → Ally.
        </p>

        <div role="radiogroup" aria-label="How Ally thinks" className="mt-4 flex flex-col gap-2">
          <div
            className={`rounded-md border p-3 ${
              choice === "key" ? "border-primary/60 bg-primary/5" : "border-border"
            }`}
          >
            <label className="flex cursor-pointer items-start gap-2">
              <input
                type="radio"
                name="first-run-ai"
                checked={choice === "key"}
                onChange={() => setChoice("key")}
                className="mt-0.5"
              />
              <span>
                <span className="block text-sm font-semibold">Use my own key</span>
                <span className="block text-xs text-fg-muted">
                  Best answers. Your key goes straight to the provider and is
                  stored in your computer&apos;s credential vault, never in a file.
                </span>
              </span>
            </label>

            {choice === "key" && (
              <div className="mt-3 flex flex-col gap-2">
                <label className="field">
                  Provider
                  <select
                    className="select"
                    value={provider.id}
                    onChange={(e) => setProviderId(e.target.value as ProviderId)}
                  >
                    {providers.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  Model
                  <select
                    className="select"
                    value={selectedModel}
                    onChange={(e) => setModel(e.target.value)}
                  >
                    {options.map((m) => (
                      <option key={m.id} value={m.id}>
                        {modelLabel(m)}
                        {m.id === provider.default_quality_model ? " — recommended" : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  {provider.name} API key
                  <input
                    type="password"
                    className="input"
                    value={keyInput}
                    onChange={(e) => setKeyInput(e.target.value)}
                    placeholder="Paste API key…"
                    autoComplete="off"
                  />
                </label>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busy || keyInput.trim() === ""}
                  onClick={() => void saveAndContinue()}
                >
                  Save key and continue
                </button>
                {status && (
                  <p
                    role="status"
                    className={`text-xs ${status.startsWith("✓") ? "text-ok" : "text-fg-muted"}`}
                  >
                    {status}
                  </p>
                )}
              </div>
            )}
          </div>

          <div
            className="rounded-md border border-border p-3 opacity-70"
            aria-disabled="true"
          >
            <label className="flex items-start gap-2">
              <input type="radio" name="first-run-ai" disabled className="mt-0.5" />
              <span>
                <span className="block text-sm font-semibold">
                  {LOCAL_CARD.title}{" "}
                  <span className="ml-1 rounded-full border border-border px-2 py-0.5 text-[10px] font-normal text-fg-faint">
                    {LOCAL_CARD.unavailable}
                  </span>
                </span>
                <span className="block text-xs text-fg-muted">{LOCAL_CARD.tagline}</span>
                <span className="mt-1 block text-[11px] text-fg-faint">
                  {LOCAL_CARD.disclosure}
                </span>
              </span>
            </label>
          </div>

          <div
            className={`rounded-md border p-3 ${
              choice === "later" ? "border-primary/60 bg-primary/5" : "border-border"
            }`}
          >
            <label className="flex cursor-pointer items-start gap-2">
              <input
                type="radio"
                name="first-run-ai"
                checked={choice === "later"}
                onChange={() => setChoice("later")}
                className="mt-0.5"
              />
              <span>
                <span className="block text-sm font-semibold">Not now</span>
                <span className="block text-xs text-fg-muted">
                  Transcription, your library and exact spreadsheet totals still
                  work. Ally&apos;s written answers stay off until you choose a model.
                </span>
              </span>
            </label>
            {choice === "later" && (
              <button type="button" className="btn mt-3" onClick={skip}>
                Continue without a model
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

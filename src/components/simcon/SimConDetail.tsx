import { useCallback, useEffect, useState } from "react";

import { Section, ViewShell } from "@/components/studio/ViewShell";
import { Icon } from "@/components/ui/Icon";
import { useBackend } from "@/lib/backend";
import type { SimConSession } from "@/lib/ipc";

/**
 * Sim Con detail — the persona step (Step 3) and the launch point for the live
 * session (Step 4, next phase). Generate 3 counterparty personas from the
 * knowledge base, pick one, then Start. Edit reopens the setup wizard.
 */
export function SimConDetail({
  id,
  onEdit,
  onBack,
}: {
  id: string;
  onEdit: () => void;
  onBack: () => void;
}) {
  const backend = useBackend();
  const [session, setSession] = useState<SimConSession | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    backend.simcon
      .load(id)
      .then(setSession)
      .catch(() => setError("Couldn't load this Sim Con."));
  }, [backend, id]);

  useEffect(() => {
    load();
  }, [load]);

  const generate = async () => {
    setBusy(true);
    setError(null);
    try {
      setSession(await backend.simcon.generatePersonas(id));
    } catch {
      setError(
        "Couldn't generate personas — check your Ally provider key in Settings.",
      );
    } finally {
      setBusy(false);
    }
  };

  const choose = async (pid: string) => {
    try {
      setSession(await backend.simcon.choosePersona(id, pid));
    } catch {
      /* best-effort */
    }
  };

  const personas = session?.personas ?? [];
  const chosen = session?.chosen_persona_id ?? null;

  return (
    <ViewShell
      icon="simicon"
      title={session?.title || "Sim Con"}
      subtitle={session?.purpose || "Rehearse a high-stakes call."}
      actions={
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onEdit}
            title="Edit setup"
            aria-label="Edit setup"
            className="rounded-sm p-1.5 text-fg-faint transition hover:bg-panel-raised/60 hover:text-fg"
          >
            <Icon name="edit" size={15} />
          </button>
          <button type="button" className="btn" onClick={onBack}>
            Back
          </button>
        </div>
      }
    >
      {error && (
        <Section title="Sim Con">
          <p className="text-sm text-rec">{error}</p>
        </Section>
      )}

      <Section
        title="Counterparty"
        description="Choose who you'll rehearse against — the AI plays this persona, grounded in your knowledge base."
      >
        {personas.length === 0 ? (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-fg-muted">
              Generate the personas conva thinks you should be ready to face.
            </p>
            <button
              type="button"
              className="btn btn-primary self-start"
              disabled={busy}
              onClick={() => void generate()}
            >
              {busy ? "Generating…" : "Generate personas"}
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <ul className="flex flex-col gap-2">
              {personas.map((p) => {
                const isChosen = chosen === p.id;
                return (
                  <li
                    key={p.id}
                    className={`rounded border p-3 transition ${
                      isChosen
                        ? "border-outbound/50 bg-outbound/[0.08]"
                        : "border-border"
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      <h3 className="min-w-0 flex-1 text-sm font-bold tracking-tight text-fg">
                        {p.title}
                      </h3>
                      {p.recommended && (
                        <span className="shrink-0 rounded-full border border-ai/40 bg-ai/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ai">
                          ★ Recommended
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-[12px] leading-relaxed text-fg-muted">
                      {p.summary}
                    </p>
                    {p.style_tags.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {p.style_tags.map((t) => (
                          <span
                            key={t}
                            className="rounded-sm border border-border px-1.5 py-0.5 text-[10px] text-fg-faint"
                          >
                            {t}
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="mt-2">
                      <button
                        type="button"
                        className={`btn ${isChosen ? "btn-primary" : ""}`}
                        onClick={() => void choose(p.id)}
                      >
                        {isChosen ? "Chosen ✓" : "Choose"}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
            <button
              type="button"
              className="btn self-start"
              disabled={busy}
              onClick={() => void generate()}
            >
              {busy ? "Regenerating…" : "Regenerate"}
            </button>
          </div>
        )}
      </Section>

      <Section title="Rehearse">
        <button
          type="button"
          className="btn btn-primary"
          disabled
          title="The live session arrives in the next phase"
        >
          Start rehearsal — coming soon
        </button>
      </Section>
    </ViewShell>
  );
}

import { useCallback, useEffect, useState } from "react";

import { Section, ViewShell } from "@/components/studio/ViewShell";
import { useBackend } from "@/lib/backend";
import type { SimiconCategory, SimiconStatus, SimiconSummary } from "@/lib/ipc";
import { isDesktop } from "@/lib/platform";

const CATEGORY_LABEL: Record<SimiconCategory, string> = {
  interview: "Interview",
  financial_review: "Financial review",
  performance_review: "Performance review",
  sales_pitch: "Sales pitch",
  other: "Other",
};

const STATUS_LABEL: Record<SimiconStatus, string> = {
  draft: "Draft",
  ingesting: "Preparing…",
  ready: "Ready",
  running: "Running",
  ended: "Ended",
};

/**
 * Simicon — Simulated Conversation. Rehearse a high-stakes call (interview,
 * review, pitch) with the AI playing the counterparty. This is the list + entry
 * point (Phase A.2); the setup form, knowledge pipeline, generated personas,
 * and the live session engine are Phases B–E. Desktop-first (records are stored
 * locally); on web it shows the honest degraded state.
 */
export function SimiconView() {
  const backend = useBackend();
  const [items, setItems] = useState<SimiconSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    backend.simicon
      .list()
      .then((list) => {
        setItems(list);
        setError(null);
      })
      .catch(() => setError("Simicon runs on the desktop app for now."));
  }, [backend]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const createDraft = async () => {
    setBusy(true);
    try {
      await backend.simicon.save({
        id: "",
        title: "Untitled Simicon",
        purpose: "",
        category: "interview",
        status: "draft",
        created_at_unix_ms: 0,
        updated_at_unix_ms: 0,
        knowledge_profile_id: null,
        personas: [],
        chosen_persona_id: null,
        conversation_id: null,
      });
      refresh();
    } catch {
      setError("Couldn't create a Simicon here — use the desktop app.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    try {
      await backend.simicon.delete(id);
      refresh();
    } catch {
      /* best-effort; the list refresh reflects the real state */
    }
  };

  return (
    <ViewShell
      icon="persona"
      title="Simicon"
      subtitle="Rehearse a high-stakes call — the AI plays the other side."
      badge={
        <span className="inline-flex items-center rounded-full border border-border-strong bg-panel-raised/60 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-fg-faint">
          Preview
        </span>
      }
      actions={
        isDesktop ? (
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy}
            onClick={() => void createDraft()}
          >
            New Simicon
          </button>
        ) : undefined
      }
    >
      {error && (
        <Section title="Simicon">
          <p className="text-sm text-fg-muted">{error}</p>
        </Section>
      )}

      {!error && items.length === 0 && (
        <Section title="No Simicons yet">
          <p className="text-sm leading-relaxed text-fg-muted">
            Create a Simicon to rehearse an interview, review, or pitch. conva
            builds a reusable knowledge base from your library and plays the
            counterparty. Setup, autonomous research, generated personas, and the
            live session land in the next phases.
          </p>
        </Section>
      )}

      {!error && items.length > 0 && (
        <Section title="Your Simicons">
          <ul className="flex flex-col divide-y divide-border">
            {items.map((s) => (
              <li
                key={s.id}
                className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-fg">
                    {s.title}
                  </p>
                  <p className="text-[11px] text-fg-faint">
                    {CATEGORY_LABEL[s.category]} · {STATUS_LABEL[s.status]}
                  </p>
                </div>
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() => void remove(s.id)}
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </ViewShell>
  );
}

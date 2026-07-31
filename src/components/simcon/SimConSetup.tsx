import { useEffect, useState } from "react";

import { Section, ViewShell } from "@/components/studio/ViewShell";
import { useBackend } from "@/lib/backend";
import type { RagDocument, SimConCategory } from "@/lib/ipc";

const CATEGORIES: { value: SimConCategory; label: string; hint: string }[] = [
  { value: "interview", label: "Interview", hint: "Job or panel interview" },
  { value: "financial_review", label: "Financial review", hint: "Numbers, GAAP, forecasts" },
  { value: "performance_review", label: "Performance review", hint: "1:1, feedback, promotion" },
  { value: "sales_pitch", label: "Sales pitch", hint: "Demo, objection handling" },
  { value: "other", label: "Other", hint: "Anything high-stakes" },
];

const STEP_LABEL = ["the basics", "context & documents", "review"];

/**
 * Sim Con setup wizard (Step 1). Collects the name, goal, and type, plus the
 * context sources: Path A (attach library documents) and Path B (ask Ally to
 * auto-generate context). Finishing saves a draft SimConSession with those
 * inputs; the ingestion + research phase (C) consumes `source_doc_ids` +
 * `auto_generate_context` to build the KnowledgeProfile.
 */
export function SimConSetup({
  onDone,
  onCancel,
}: {
  onDone: () => void;
  onCancel: () => void;
}) {
  const backend = useBackend();
  const [step, setStep] = useState(1);
  const [title, setTitle] = useState("");
  const [purpose, setPurpose] = useState("");
  const [category, setCategory] = useState<SimConCategory>("interview");
  const [docs, setDocs] = useState<RagDocument[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [autoGen, setAutoGen] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    backend.rag
      .list()
      .then(setDocs)
      .catch(() => setDocs([]));
  }, [backend]);

  const toggleDoc = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const canNext = step === 1 ? title.trim().length > 0 : true;

  const finish = async () => {
    setSaving(true);
    setError(null);
    try {
      await backend.simcon.save({
        id: "",
        title: title.trim(),
        purpose: purpose.trim(),
        category,
        status: "draft",
        created_at_unix_ms: 0,
        updated_at_unix_ms: 0,
        source_doc_ids: selected,
        auto_generate_context: autoGen,
        knowledge_profile_id: null,
        personas: [],
        chosen_persona_id: null,
        conversation_id: null,
      });
      onDone();
    } catch {
      setError("Couldn't save — Sim Con runs on the desktop app.");
      setSaving(false);
    }
  };

  return (
    <ViewShell
      icon="simicon"
      title="New Sim Con"
      subtitle={`Step ${step} of 3 — ${STEP_LABEL[step - 1]}`}
      actions={
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
      }
    >
      {step === 1 && (
        <Section title="What are you rehearsing?">
          <div className="flex flex-col gap-3">
            <label className="field">
              Name
              <input
                className="input"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Senior Accountant interview with the CFO"
              />
            </label>
            <label className="field">
              Goal
              <textarea
                className="input"
                rows={3}
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
                placeholder="Prep for technical GAAP questions and leadership scenarios"
              />
            </label>
            <div className="field">
              Type
              <div className="flex flex-wrap gap-2">
                {CATEGORIES.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    title={c.hint}
                    onClick={() => setCategory(c.value)}
                    className={`btn ${category === c.value ? "btn-primary" : ""}`}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </Section>
      )}

      {step === 2 && (
        <>
          <Section
            title="Attach from your library"
            description="conva grounds the counterparty and its questions in these documents."
          >
            {docs.length === 0 ? (
              <p className="text-sm text-fg-muted">
                No library documents yet — add some in Library, or let Ally
                research context below.
              </p>
            ) : (
              <ul className="flex flex-col divide-y divide-border">
                {docs.map((d) => (
                  <li key={d.id} className="flex items-center gap-3 py-2">
                    <input
                      type="checkbox"
                      checked={selected.includes(d.id)}
                      onChange={() => toggleDoc(d.id)}
                      aria-label={`Attach ${d.file_name}`}
                    />
                    <span className="min-w-0 flex-1 truncate text-sm text-fg">
                      {d.file_name}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
          <Section
            title="Let Ally research"
            description="Ally searches the web for relevant background — standard questions, company profile, market rates — and indexes it alongside your docs."
          >
            <label className="flex items-center gap-2 text-sm text-fg">
              <input
                type="checkbox"
                checked={autoGen}
                onChange={(e) => setAutoGen(e.target.checked)}
              />
              Auto-generate context for this Sim Con
            </label>
          </Section>
        </>
      )}

      {step === 3 && (
        <Section title="Review">
          <dl className="grid grid-cols-[7rem_1fr] gap-x-4 gap-y-1.5 text-sm">
            <dt className="text-fg-faint">Name</dt>
            <dd className="text-fg">{title || "—"}</dd>
            <dt className="text-fg-faint">Goal</dt>
            <dd className="text-fg-muted">{purpose || "—"}</dd>
            <dt className="text-fg-faint">Type</dt>
            <dd className="text-fg">
              {CATEGORIES.find((c) => c.value === category)?.label}
            </dd>
            <dt className="text-fg-faint">Documents</dt>
            <dd className="text-fg">{selected.length} attached</dd>
            <dt className="text-fg-faint">Ally research</dt>
            <dd className="text-fg">{autoGen ? "On" : "Off"}</dd>
          </dl>
          <p className="mt-3 text-[12px] leading-relaxed text-fg-faint">
            Finishing saves this Sim Con. Building the knowledge base, generating
            personas, and the live session come next.
          </p>
          {error && <p className="mt-2 text-sm text-rec">{error}</p>}
        </Section>
      )}

      <div className="mt-4 flex items-center gap-2">
        {step > 1 && (
          <button
            type="button"
            className="btn"
            onClick={() => setStep((s) => s - 1)}
          >
            Back
          </button>
        )}
        <span className="ml-auto" />
        {step < 3 ? (
          <button
            type="button"
            className="btn btn-primary"
            disabled={!canNext}
            onClick={() => setStep((s) => s + 1)}
          >
            Next
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-primary"
            disabled={saving}
            onClick={() => void finish()}
          >
            Finish
          </button>
        )}
      </div>
    </ViewShell>
  );
}

import { useEffect, useState } from "react";

import { CATEGORY_ICON } from "@/components/contexts/ContextsPane";
import { Section, ViewShell } from "@/components/studio/ViewShell";
import { Icon } from "@/components/ui/Icon";
import { useBackend } from "@/lib/backend";
import { useCapabilities } from "@/lib/backend/context";
import { splitDocuments } from "@/components/context/documentSplit";
import { buildQaMarkdown, parseQaImport } from "@/components/transcript/qaPairs";
import type { RagDocument, ContextCategory, ConversationContext } from "@/lib/ipc";
import { isDesktop } from "@/lib/platform";

// Mirrors conva_core::context templates. `research` = the web-research default
// for the type (decision 2 — on for interview/sales, off for internal meetings).
const CATEGORIES: {
  value: ContextCategory;
  label: string;
  hint: string;
  research: boolean;
}[] = [
  { value: "interview", label: "Interview", hint: "Job or panel interview", research: true },
  {
    value: "company_meeting",
    label: "Company meeting",
    hint: "Internal — financials, reviews, planning",
    research: false,
  },
  { value: "sales_call", label: "Sales call", hint: "Demo, objection handling", research: true },
  {
    value: "live_stream",
    label: "Live stream",
    hint: "Podcast, stream, live-commerce broadcast",
    research: true,
  },
  { value: "other", label: "Other", hint: "Anything high-stakes", research: false },
];

const researchDefault = (c: ContextCategory): boolean =>
  CATEGORIES.find((x) => x.value === c)?.research ?? false;

const DOC_EXTENSIONS = ["pdf", "docx", "md", "txt", "html"];
const STEP_LABEL = ["the basics", "context & documents", "review"];

/**
 * Context setup wizard (Step 1). Collects name, goal, type (and, for interviews,
 * the job description), plus context: Path A attaches library documents — you can
 * add new files directly, which land in a folder named after the Context — and
 * Path B asks Ally to auto-generate context. Finishing saves a draft
 * ConversationContext; the ingestion + research phase (C) consumes it.
 */
export function ContextSetup({
  initial,
  onDone,
  onCancel,
}: {
  initial?: ConversationContext;
  onDone: () => void;
  onCancel: () => void;
}) {
  const backend = useBackend();
  const caps = useCapabilities();
  const [regenerating, setRegenerating] = useState(false);
  const [step, setStep] = useState(1);
  const [title, setTitle] = useState(initial?.title ?? "");
  const [purpose, setPurpose] = useState(initial?.purpose ?? "");
  const [category, setCategory] = useState<ContextCategory>(
    initial?.category ?? "interview",
  );
  const [jobDescription, setJobDescription] = useState(
    initial?.job_description ?? "",
  );
  const [keyTerms, setKeyTerms] = useState((initial?.key_terms ?? []).join("\n"));
  const [docs, setDocs] = useState<RagDocument[]>([]);
  const [selected, setSelected] = useState<string[]>(
    initial?.source_doc_ids ?? [],
  );
  const [research, setResearch] = useState(
    initial?.research_enabled ??
      initial?.auto_generate_context ??
      researchDefault(initial?.category ?? "interview"),
  );
  const [deepQa, setDeepQa] = useState(initial?.deep_qa_enabled ?? false);
  // Fields Stage 1-3 (generateDossier) derives and owns — seeded from
  // `initial`, refreshed after each successful regenerate. Kept separate
  // from `initial` (a prop, frozen at mount) so a second regenerate/save in
  // the same wizard session builds its save payload from the LATEST
  // generated docs rather than reusing a stale snapshot — reusing `initial`
  // directly here would silently revert a just-regenerated dossier/Q&A doc
  // id back to the old one on the next save, re-creating the duplicate/
  // orphaned-doc bug the generated-docs-display fix closed.
  const [generatedFields, setGeneratedFields] = useState({
    dossier_doc_id: initial?.dossier_doc_id ?? null,
    research_doc_id: initial?.research_doc_id ?? null,
    qa_doc_id: initial?.qa_doc_id ?? null,
    glossary: initial?.glossary ?? [],
    glossary_definitions: initial?.glossary_definitions ?? {},
    resources_stale: initial?.resources_stale ?? false,
  });

  // Picking a type resets research to that type's default (user-overridable).
  const pickCategory = (c: ContextCategory) => {
    setCategory(c);
    setResearch(researchDefault(c));
    setDeepQa(false);
  };

  // Deep Q&A depends on research being on — turning research off clears it.
  const toggleResearch = (checked: boolean) => {
    setResearch(checked);
    if (!checked) setDeepQa(false);
  };
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Import Q&A (owner, 2026-08-27): paste one "question|answer" per line;
  // Import stores them as an attached library document in the canonical
  // Q&A form, so the live cockpit's Questions → Prep mode (and RAG) pick
  // them up like any other prep source.
  const [qaImport, setQaImport] = useState("");
  const [importing, setImporting] = useState(false);
  const [importNotice, setImportNotice] = useState<string | null>(null);
  const importQa = async () => {
    const { pairs, skipped } = parseQaImport(qaImport);
    if (pairs.length === 0) {
      setImportNotice(
        'No valid lines — one pair per line as "question|answer".',
      );
      return;
    }
    setImporting(true);
    setError(null);
    try {
      const name = `${title.trim() || "Context"} QA import`;
      const report = await backend.rag.ingestText(name, buildQaMarkdown(pairs));
      setDocs(await backend.rag.list());
      setSelected((s) => Array.from(new Set([...s, report.document.id])));
      setQaImport("");
      setImportNotice(
        `Imported ${pairs.length} pair${pairs.length === 1 ? "" : "s"}` +
          (skipped ? ` (${skipped} line${skipped === 1 ? "" : "s"} skipped)` : "") +
          ` — attached as "${report.document.file_name}".`,
      );
    } catch {
      setError("Couldn't import Q&A.");
    } finally {
      setImporting(false);
    }
  };
  const pasteQa = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) setQaImport((cur) => (cur ? `${cur}\n${text}` : text));
    } catch {
      setImportNotice("Couldn't read the clipboard — paste into the box instead.");
    }
  };

  useEffect(() => {
    backend.rag
      .list()
      .then(setDocs)
      .catch(() => setDocs([]));
  }, [backend]);

  const toggleDoc = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const { attachable, generated } = splitDocuments(docs, initial?.id);

  const regenerate = async () => {
    if (!initial) return;
    setRegenerating(true);
    setError(null);
    try {
      // Persist pending wizard edits first (e.g. a just-checked deep-QA
      // box) — generateDossier reads the SAVED session from disk, so
      // regenerating against unsaved form state silently used the old
      // values (this was the "checked deep Q&A, regenerated, still no
      // questions" bug: the checkbox never made it to disk before the
      // dossier pipeline read `deep_qa_enabled` back off it).
      await backend.context.save(buildSavePayload());
      const updated = await backend.context.generateDossier(initial.id);
      setGeneratedFields({
        dossier_doc_id: updated.dossier_doc_id,
        research_doc_id: updated.research_doc_id ?? null,
        qa_doc_id: updated.qa_doc_id ?? null,
        glossary: updated.glossary ?? [],
        glossary_definitions: updated.glossary_definitions ?? {},
        resources_stale: updated.resources_stale ?? false,
      });
      setDocs(await backend.rag.list());
    } catch {
      setError("Couldn't regenerate.");
    } finally {
      setRegenerating(false);
    }
  };

  // Path A — add files directly: copy them into this Context's folder, then
  // ingest into the RAG library so the counterparty is grounded in them.
  const addDocuments = async () => {
    setAdding(true);
    setError(null);
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const picked = await open({
        multiple: true,
        filters: [{ name: "Documents", extensions: DOC_EXTENSIONS }],
      });
      const paths = Array.isArray(picked) ? picked : picked ? [picked] : [];
      if (paths.length === 0) return;
      const stored = await backend.context.storeDocs(title.trim() || "untitled", paths);
      const reports = await backend.rag.ingest(stored);
      const newIds = reports.map((r) => r.document.id);
      setDocs(await backend.rag.list());
      setSelected((s) => Array.from(new Set([...s, ...newIds])));
    } catch {
      setError("Couldn't add documents.");
    } finally {
      setAdding(false);
    }
  };

  const canNext = step === 1 ? title.trim().length > 0 : true;

  // Shared by `finish` and `regenerate` — the latter needs this to persist
  // pending edits (e.g. the deep-QA checkbox) before the dossier pipeline
  // reads the session back off disk.
  const buildSavePayload = () => ({
    id: initial?.id ?? "",
    title: title.trim(),
    purpose: purpose.trim(),
    job_description: jobDescription.trim() ? jobDescription.trim() : null,
    category,
    status: initial?.status ?? "draft",
    created_at_unix_ms: initial?.created_at_unix_ms ?? 0,
    updated_at_unix_ms: 0,
    source_doc_ids: selected,
    auto_generate_context: research,
    research_enabled: research,
    deep_qa_enabled: deepQa,
    key_terms: keyTerms
      .split(/[\n,]/)
      .map((t) => t.trim())
      .filter(Boolean),
    knowledge_profile_id: initial?.knowledge_profile_id ?? null,
    personas: initial?.personas ?? [],
    chosen_persona_id: initial?.chosen_persona_id ?? null,
    conversation_id: initial?.conversation_id ?? null,
    // Stage 1-3 derived fields — from `generatedFields`, not `initial`
    // directly, so this stays correct across a regenerate in the same
    // wizard session (see the `generatedFields` state's doc comment).
    glossary: generatedFields.glossary,
    dossier_doc_id: generatedFields.dossier_doc_id,
    research_doc_id: generatedFields.research_doc_id,
    qa_doc_id: generatedFields.qa_doc_id,
    glossary_definitions: generatedFields.glossary_definitions,
    resources_stale: generatedFields.resources_stale,
  });

  const finish = async () => {
    setSaving(true);
    setError(null);
    try {
      const saved = await backend.context.save(buildSavePayload());
      // Build the knowledge base (attached docs + research) and mark it ready.
      await backend.context.prepare(saved.id);
      onDone();
    } catch {
      setError("Couldn't save — Context runs on the desktop app.");
      setSaving(false);
    }
  };

  return (
    <ViewShell
      icon={CATEGORY_ICON[category].icon}
      iconColor={CATEGORY_ICON[category].color}
      breadcrumb="Contexts"
      title={initial ? "Edit Context" : "New Context"}
      subtitle={`Step ${step} of 3 — ${STEP_LABEL[step - 1]}`}
      onBack={onCancel}
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
                    onClick={() => pickCategory(c.value)}
                    className={`btn ${category === c.value ? "btn-primary" : ""}`}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            </div>
            {category === "interview" && (
              <label className="field">
                Job description
                <textarea
                  className="input"
                  rows={4}
                  value={jobDescription}
                  onChange={(e) => setJobDescription(e.target.value)}
                  placeholder="Paste the role's job description — conva grounds the interviewer's questions in it."
                />
              </label>
            )}
          </div>
        </Section>
      )}

      {step === 2 && (
        <>
          <Section
            title="Attached documents"
            description="conva grounds the counterparty and its questions in these. Add files directly (they're kept in a folder named after this Context) or pick from your library."
          >
            {isDesktop && (
              <div className="mb-3">
                <button
                  type="button"
                  className="btn"
                  disabled={adding}
                  onClick={() => void addDocuments()}
                >
                  {adding ? "Adding…" : "Add documents…"}
                </button>
              </div>
            )}
            {attachable.length === 0 ? (
              <p className="text-sm text-fg-muted">
                No documents yet — add some above, or let Ally research context
                below.
              </p>
            ) : (
              <ul className="flex flex-col divide-y divide-border">
                {attachable.map((d) => (
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
          {initial && (
            <Section
              title="Generated by Ally"
              description="Auto-included in this context's grounding — not something you attach or detach by hand. Regenerate any time to refresh from your current documents and settings."
            >
              <div className="mb-3">
                <button
                  type="button"
                  className="btn"
                  disabled={regenerating}
                  onClick={() => void regenerate()}
                >
                  {regenerating ? "Regenerating…" : "Regenerate resources"}
                </button>
              </div>
              {generated.length === 0 ? (
                <p className="text-sm text-fg-muted">Nothing generated yet.</p>
              ) : (
                <ul className="flex flex-col divide-y divide-border">
                  {generated.map((d) => (
                    <li key={d.id} className="flex items-center gap-2 py-2">
                      <Icon name="sparkle" size={13} className="shrink-0 text-ai" />
                      <span className="min-w-0 flex-1 truncate text-sm text-fg">
                        {d.file_name}
                      </span>
                      <span className="shrink-0 rounded-full bg-ai/10 px-1.5 py-0.5 text-[9px] font-semibold text-ai">
                        conva
                      </span>
                      {caps?.system.partnerWindow && (
                        <button
                          type="button"
                          onClick={() =>
                            void backend.partner.open(d.file_name, null, null, null, [], d.id)
                          }
                          title="View"
                          aria-label={`View ${d.file_name}`}
                          className="shrink-0 rounded-sm px-2 py-0.5 text-[11px] font-semibold text-ai hover:bg-ai/10"
                        >
                          View
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          )}
          <Section
            title="Key terms"
            description="Terms or points that matter most in this conversation — conva highlights these when they come up. One per line. (The digest's glossary is added automatically.)"
          >
            <textarea
              className="input"
              rows={3}
              value={keyTerms}
              onChange={(e) => setKeyTerms(e.target.value)}
              placeholder={"pensive theory\ndeferred revenue\nSOC 2"}
            />
          </Section>
          {isDesktop && (
            <Section
              title="Import Q&A"
              description='Questions you expect, with your answers — one per line as "question|answer". Import attaches them as a document; they show in the live session under Questions → Prep and ground Ally like any other doc.'
            >
              <textarea
                className="input font-mono text-[12px]"
                rows={4}
                value={qaImport}
                onChange={(e) => setQaImport(e.target.value)}
                placeholder={
                  "Why do you want this role?|Mission fit — I've built exactly this kind of platform.\nBiggest weakness?|Over-engineering early drafts; I timebox design now."
                }
              />
              <div className="mt-2 flex items-center gap-2">
                <button
                  type="button"
                  className="btn"
                  onClick={() => void pasteQa()}
                >
                  Paste from clipboard
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={importing || !qaImport.trim()}
                  onClick={() => void importQa()}
                >
                  {importing ? "Importing…" : "Import"}
                </button>
              </div>
              {importNotice && (
                <p className="mt-1.5 text-[12px] text-fg-muted">{importNotice}</p>
              )}
            </Section>
          )}
          <Section
            title="Let Ally research"
            description="Ally searches the web for relevant background — standard questions, company profile, market rates — and indexes it alongside your docs."
          >
            <label className="flex items-center gap-2 text-sm text-fg">
              <input
                type="checkbox"
                checked={research}
                onChange={(e) => toggleResearch(e.target.checked)}
              />
              Research the web for context
              <span className="text-fg-faint">
                (default for {CATEGORIES.find((c) => c.value === category)?.label})
              </span>
            </label>
          </Section>
          {category === "interview" && (
            <Section
              title="Deep interview Q&A research"
              description="Ally searches the web broadly for common interview questions for this role and writes strong answers into your Context knowledge document — uses meaningfully more searches and tokens than standard research."
            >
              <label className="flex items-center gap-2 text-sm text-fg">
                <input
                  type="checkbox"
                  checked={deepQa}
                  disabled={!research}
                  onChange={(e) => setDeepQa(e.target.checked)}
                />
                Research common interview questions + answers
              </label>
              {!research && (
                <p className="mt-1 text-[11px] text-fg-faint">
                  Needs "Let Ally research" enabled above.
                </p>
              )}
            </Section>
          )}
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
            {category === "interview" && (
              <>
                <dt className="text-fg-faint">Job description</dt>
                <dd className="text-fg-muted">
                  {jobDescription.trim() ? "Provided" : "—"}
                </dd>
              </>
            )}
            <dt className="text-fg-faint">Documents</dt>
            <dd className="text-fg">{selected.length} attached</dd>
            <dt className="text-fg-faint">Web research</dt>
            <dd className="text-fg">{research ? "On" : "Off"}</dd>
            {category === "interview" && (
              <>
                <dt className="text-fg-faint">Deep Q&A</dt>
                <dd className="text-fg">{deepQa ? "On" : "Off"}</dd>
              </>
            )}
          </dl>
          <p className="mt-3 text-[12px] leading-relaxed text-fg-faint">
            Finishing saves this Context. Building the knowledge base, generating
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
            {saving ? "Preparing…" : "Finish"}
          </button>
        )}
      </div>
    </ViewShell>
  );
}

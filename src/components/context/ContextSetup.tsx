import { useEffect, useState } from "react";

import { CATEGORY_ICON } from "@/components/contexts/ContextsPane";
import { CATEGORIES, categoryTemplate, researchDefault } from "@/components/context/categoryTemplates";
import {
  ClaimPolicyControls,
  ParticipationLensControl,
} from "@/components/context/ClaimPolicyControls";
import {
  createContextSourcePolicyId,
  defaultParticipationLens,
  defaultSourcePolicy,
  effectiveParticipationLens,
  normalizeSourcePolicy,
  participationLensLabel,
  sourcePolicyDisclosure,
} from "@/components/context/claimPolicy";
import { Section, ViewShell } from "@/components/studio/ViewShell";
import { Icon } from "@/components/ui/Icon";
import {
  ContextResourceLibrary,
  OTHER_RESOURCE_TARGET,
} from "@/components/context/ContextResourceLibrary";
import { GenerationStatus } from "@/components/context/ResourceGenerationStatus";
import {
  generationStages,
  researchStage,
  type GenerationStage,
} from "@/components/context/generationStatus";
import { DOC_DRAG_MIME } from "@/components/contexts/LibraryPane";
import { documentIcon } from "@/components/contexts/documentVisual";
import { useBackend } from "@/lib/backend";
import { useCapabilities } from "@/lib/backend/context";
import { groupBySlot, splitDocuments } from "@/components/context/documentSplit";
import { buildQaMarkdown, parseQaImport } from "@/components/transcript/qaPairs";
import type {
  RagDocument,
  ContextCategory,
  ConversationContext,
  SourcePolicy,
} from "@/lib/ipc";
import { isDesktop } from "@/lib/platform";
import { useAppStore } from "@/state/app";

const DOC_EXTENSIONS = [
  "pdf", "docx", "md", "txt", "html",
  "png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "tif", "tiff", "heic",
];
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
  const [generationReport, setGenerationReport] = useState<GenerationStage[]>([]);
  // Proactive "no key" advisory — checked on mount and whenever the active
  // provider changes, so the Generate section can warn *before* a run wastes
  // an LLM pass on research that's guaranteed to come back empty (the report
  // below the button only ever showed this after the fact). null = still
  // checking, so the warning doesn't flash on for an instant while loading.
  const activeResearchProvider = useAppStore((s) => s.config?.research_provider) ?? "firecrawl";
  const [hasResearchKey, setHasResearchKey] = useState<boolean | null>(null);
  useEffect(() => {
    // Only the "Generate Context resources" section (rendered for an
    // existing Context, i.e. `initial` is set) shows this advisory, so skip
    // the check entirely in creation mode — also keeps this a no-op against
    // a minimal backend fake that doesn't stub `context` at all.
    if (!initial) return;
    if (activeResearchProvider === "anthropic_web_search") {
      setHasResearchKey(true); // reuses the Anthropic key, no separate key to check
      return;
    }
    let cancelled = false;
    setHasResearchKey(null);
    const check = backend.context.researchKeyStatus
      ? backend.context.researchKeyStatus(activeResearchProvider)
      : Promise.resolve(false);
    check
      .then((ok) => {
        if (!cancelled) setHasResearchKey(ok);
      })
      .catch(() => {
        if (!cancelled) setHasResearchKey(false);
      });
    return () => {
      cancelled = true;
    };
  }, [backend, activeResearchProvider, initial]);
  const [libraryDrawerOpen, setLibraryDrawerOpen] = useState(false);
  const [step, setStep] = useState(1);
  const [title, setTitle] = useState(initial?.title ?? "");
  const [purpose, setPurpose] = useState(initial?.purpose ?? "");
  const [category, setCategory] = useState<ContextCategory>(
    initial?.category ?? "interview",
  );
  const [participationLens, setParticipationLens] = useState(() =>
    effectiveParticipationLens(
      initial?.category ?? "interview",
      initial?.participation_lens,
    ),
  );
  const [sourcePolicy, setSourcePolicy] = useState(() =>
    normalizeSourcePolicy(
      initial?.category ?? "interview",
      initial?.source_policy,
      createContextSourcePolicyId(initial?.id),
    ),
  );
  const [jobDescription, setJobDescription] = useState(
    initial?.job_description ?? "",
  );
  const [keyTerms, setKeyTerms] = useState((initial?.key_terms ?? []).join("\n"));
  const [docs, setDocs] = useState<RagDocument[]>([]);
  const [selected, setSelected] = useState<string[]>(
    initial?.source_doc_ids ?? [],
  );
  const [slotDocIds, setSlotDocIds] = useState<Record<string, string[]>>(
    initial?.slot_doc_ids ?? {},
  );
  const [libraryTarget, setLibraryTarget] = useState(
    categoryTemplate(initial?.category ?? "interview").fileSlots[0]?.key ?? OTHER_RESOURCE_TARGET,
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
    setParticipationLens(defaultParticipationLens(c));
    setSourcePolicy((current) => ({
      ...defaultSourcePolicy(c, current.id),
      version: current.version + 1,
    }));
    setResearch(researchDefault(c));
    setDeepQa(false);
    setLibraryTarget(categoryTemplate(c).fileSlots[0]?.key ?? OTHER_RESOURCE_TARGET);
  };

  const changeSourcePolicy = (next: SourcePolicy) => {
    setSourcePolicy((current) => ({
      ...normalizeSourcePolicy(category, next, current.id),
      id: current.id,
      version: current.version + 1,
    }));
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

  const assignDocument = (target: string, docId: string) => {
    setSelected((current) => (current.includes(docId) ? current : [...current, docId]));
    setSlotDocIds((current) => {
      const withoutDoc = Object.fromEntries(
        Object.entries(current).map(([key, ids]) => [key, ids.filter((id) => id !== docId)]),
      );
      if (target === OTHER_RESOURCE_TARGET) return withoutDoc;
      return { ...withoutDoc, [target]: [...(withoutDoc[target] ?? []), docId] };
    });
  };

  const removeDocument = (target: string, docId: string) => {
    if (target === OTHER_RESOURCE_TARGET) {
      setSelected((current) => current.filter((id) => id !== docId));
      return;
    }
    setSlotDocIds((current) => {
      const next = {
        ...current,
        [target]: (current[target] ?? []).filter((id) => id !== docId),
      };
      const stillAssigned = Object.values(next).some((ids) => ids.includes(docId));
      if (!stillAssigned) {
        setSelected((selectedIds) => selectedIds.filter((id) => id !== docId));
      }
      return next;
    });
  };

  const { attachable, generated } = splitDocuments(docs, initial?.id);
  const { slots: slotGroups, other: otherDocs } = groupBySlot(
    attachable,
    categoryTemplate(category).fileSlots,
    slotDocIds,
  );
  const assignedOtherDocs = otherDocs.filter((doc) => selected.includes(doc.id));

  const regenerate = async () => {
    if (!initial) return;
    setRegenerating(true);
    setError(null);
    setGenerationReport([]);
    try {
      // Persist pending wizard edits first (e.g. a just-checked deep-QA
      // box) — generateDossier reads the SAVED session from disk, so
      // regenerating against unsaved form state silently used the old
      // values (this was the "checked deep Q&A, regenerated, still no
      // questions" bug: the checkbox never made it to disk before the
      // dossier pipeline read `deep_qa_enabled` back off it).
      await backend.context.save(buildSavePayload());
      // Re-checked fresh here (not just the mount-time `hasResearchKey`
      // advisory above) so a key just saved in Settings a moment ago is
      // picked up before this run actually gates on it.
      const provider = useAppStore.getState().config?.research_provider ?? "firecrawl";
      const keyReady =
        provider === "anthropic_web_search"
          ? true // reuses the Anthropic key, no separate key to check
          : backend.context.researchKeyStatus
            ? await backend.context.researchKeyStatus(provider).catch(() => false)
            : false;
      const updated = await backend.context.generateDossier(initial.id);
      setGeneratedFields({
        dossier_doc_id: updated.dossier_doc_id,
        research_doc_id: updated.research_doc_id ?? null,
        qa_doc_id: updated.qa_doc_id ?? null,
        glossary: updated.glossary ?? [],
        glossary_definitions: updated.glossary_definitions ?? {},
        resources_stale: updated.resources_stale ?? false,
      });
      setGenerationReport(generationStages(updated, keyReady, provider));
      setDocs(await backend.rag.list());
      setHasResearchKey(keyReady); // refresh the pre-run advisory from this authoritative check too
    } catch {
      setError("Couldn't regenerate.");
    } finally {
      setRegenerating(false);
    }
  };

  // Path A — add files directly: copy them into this Context's folder, then
  // ingest into the RAG library so the counterparty is grounded in them.
  // `slotKey` files the newly-added doc(s) under that slot too (when added
  // from a slot's own "Add documents…" button); omitted (the "Other
  // documents" section's button) leaves them unslotted.
  const addDocuments = async (target: string) => {
    setAdding(true);
    setError(null);
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const picked = await open({
        multiple: true,
        filters: [{ name: "Documents and images", extensions: DOC_EXTENSIONS }],
      });
      const paths = Array.isArray(picked) ? picked : picked ? [picked] : [];
      if (paths.length === 0) return;
      const stored = await backend.context.storeDocs(title.trim() || "untitled", paths);
      const reports = await backend.rag.ingest(stored);
      const newIds = reports.map((r) => r.document.id);
      setDocs(await backend.rag.list());
      setSelected((s) => Array.from(new Set([...s, ...newIds])));
      newIds.forEach((id) => assignDocument(target, id));
    } catch {
      setError("Couldn't add documents.");
    } finally {
      setAdding(false);
    }
  };

  const pasteResource = async (name: string, text: string, target: string) => {
    setError(null);
    try {
      const report = await backend.rag.ingestText(name, text);
      setDocs(await backend.rag.list());
      assignDocument(target, report.document.id);
    } catch {
      setError("Couldn't add pasted text.");
      throw new Error("Couldn't add pasted text.");
    }
  };

  const canNext =
    step === 1
      ? title.trim().length > 0
      : step === 2
        ? sourcePolicy.allowed_classes.length > 0
        : true;

  // Shared by `finish` and `regenerate` — the latter needs this to persist
  // pending edits (e.g. the deep-QA checkbox) before the dossier pipeline
  // reads the session back off disk.
  const buildSavePayload = () => ({
    id: initial?.id ?? "",
    title: title.trim(),
    purpose: purpose.trim(),
    job_description: jobDescription.trim() ? jobDescription.trim() : null,
    category,
    participation_lens: participationLens,
    source_policy: normalizeSourcePolicy(category, sourcePolicy, sourcePolicy.id),
    status: initial?.status ?? "draft",
    created_at_unix_ms: initial?.created_at_unix_ms ?? 0,
    updated_at_unix_ms: 0,
    source_doc_ids: selected,
    slot_doc_ids: slotDocIds,
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
      wide={step === 2}
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
              {initial ? "Type" : "Start with a template"}
              {!initial && (
                <span className="text-[11px] font-normal normal-case tracking-normal text-fg-faint">
                  Choose the conversation pattern Ally should prepare for. You can refine it below.
                </span>
              )}
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
            <p className="text-[11px] text-fg-faint">
              Ally will generate: {categoryTemplate(category).digestSections.join(", ")}
            </p>
            <ParticipationLensControl
              category={category}
              value={participationLens}
              onChange={setParticipationLens}
            />
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
        <div className="grid min-h-0 gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
          <div className="flex min-w-0 flex-col gap-4">
          <button
            type="button"
            onClick={() => setLibraryDrawerOpen(true)}
            className="btn btn-primary self-start xl:hidden"
          >
            <Icon name="library" size={14} /> Open Library
            <span className="rounded-full bg-primary-ink/15 px-1.5 text-[10px]">{selected.length}</span>
          </button>
          {slotGroups.map(({ slot, docs: assignedDocs }) => (
            <div
              key={slot.key}
              onClick={() => setLibraryTarget(slot.key)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                const docId = event.dataTransfer.getData(DOC_DRAG_MIME);
                if (docId) assignDocument(slot.key, docId);
              }}
              className={libraryTarget === slot.key ? "rounded-xl ring-1 ring-primary/50" : ""}
            >
              <Section
                title={slot.label + (slot.multiple ? " (multiple)" : "")}
                description="Select this section, then add from the Library column or drag a resource here."
              >
                {assignedDocs.length === 0 ? (
                  <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-[11px] text-fg-faint">
                    Drop resources here · selected Library destination
                  </p>
                ) : (
                  <ul className="divide-y divide-border">
                    {assignedDocs.map((doc) => (
                      <li key={doc.id} className="flex items-center gap-2 py-2">
                        <Icon name={documentIcon(doc)} size={15} className="shrink-0 text-fg-faint" />
                        <span className="min-w-0 flex-1 truncate text-sm text-fg">{doc.file_name}</span>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            removeDocument(slot.key, doc.id);
                          }}
                          aria-label={`Remove ${doc.file_name} from ${slot.label}`}
                          className="rounded-sm p-1 text-fg-faint hover:bg-rec/10 hover:text-rec"
                        >
                          <Icon name="close" size={12} />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>
            </div>
          ))}
          <div
            onClick={() => setLibraryTarget(OTHER_RESOURCE_TARGET)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              const docId = event.dataTransfer.getData(DOC_DRAG_MIME);
              if (docId) assignDocument(OTHER_RESOURCE_TARGET, docId);
            }}
            className={libraryTarget === OTHER_RESOURCE_TARGET ? "rounded-xl ring-1 ring-primary/50" : ""}
          >
            <Section
              title="Other documents"
              description="Anything that does not fit a section above still grounds this Context."
            >
              {assignedOtherDocs.length === 0 ? (
                <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-[11px] text-fg-faint">
                  Drop other supporting resources here
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {assignedOtherDocs.map((doc) => (
                    <li key={doc.id} className="flex items-center gap-2 py-2">
                      <Icon name={documentIcon(doc)} size={15} className="shrink-0 text-fg-faint" />
                      <span className="min-w-0 flex-1 truncate text-sm text-fg">{doc.file_name}</span>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          removeDocument(OTHER_RESOURCE_TARGET, doc.id);
                        }}
                        aria-label={`Remove ${doc.file_name} from Other documents`}
                        className="rounded-sm p-1 text-fg-faint hover:bg-rec/10 hover:text-rec"
                      >
                        <Icon name="close" size={12} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          </div>
          {initial && (
            <Section
              title="Generate Context resources"
              description="Creates Context Knowledge, then runs optional web research and Interview Q&A when configured. Every stage reports its result."
            >
              <div className="mb-3">
                <button
                  type="button"
                  className="btn btn-accent min-w-48 justify-center shadow-sm disabled:opacity-70"
                  disabled={regenerating}
                  onClick={() => void regenerate()}
                >
                  {regenerating && (
                    <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-ai/30 border-t-ai" />
                  )}
                  {regenerating ? "Generating resources…" : "Regenerate resources"}
                </button>
              </div>
              {generationReport.length > 0 ? (
                <GenerationStatus stages={generationReport} />
              ) : (
                hasResearchKey !== null &&
                (() => {
                  const preStage = researchStage(research, hasResearchKey, activeResearchProvider);
                  return preStage.state === "blocked" && <GenerationStatus stages={[preStage]} />;
                })()
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
          <Section
            title="Claim checks & source policy"
            description="Controls which live claims Conva may check, which evidence can count, and what may leave this device. This is separate from the preparation research above."
          >
            <ClaimPolicyControls policy={sourcePolicy} onChange={changeSourcePolicy} />
          </Section>
          </div>

          <div className="hidden min-h-[36rem] xl:block">
            <div className="sticky top-2 h-[calc(100vh-10rem)]">
              <ContextResourceLibrary
                attachable={attachable}
                generated={generated}
                selectedIds={selected}
                slots={categoryTemplate(category).fileSlots}
                target={libraryTarget}
                adding={adding}
                canAddFiles={isDesktop}
                onTargetChange={setLibraryTarget}
                onAssign={assignDocument}
                onAddFiles={(target) => void addDocuments(target)}
                onPaste={pasteResource}
                canViewGenerated={Boolean(caps?.system.partnerWindow)}
                onViewGenerated={(doc) => void backend.partner.open(doc.file_name, null, null, null, [], doc.id)}
              />
            </div>
          </div>

          {libraryDrawerOpen && (
            <div className="fixed inset-0 z-50 xl:hidden">
              <button
                type="button"
                aria-label="Close Library"
                onClick={() => setLibraryDrawerOpen(false)}
                className="absolute inset-0 bg-black/55"
              />
              <div className="absolute inset-y-0 right-0 w-[min(88vw,340px)] border-l border-border bg-bg p-3 shadow-2xl">
                <div className="mb-2 flex justify-end">
                  <button
                    type="button"
                    onClick={() => setLibraryDrawerOpen(false)}
                    className="rounded-sm p-1 text-fg-muted hover:bg-panel-raised"
                    aria-label="Close Context Library"
                  >
                    <Icon name="close" size={16} />
                  </button>
                </div>
                <div className="h-[calc(100%-2rem)]">
                  <ContextResourceLibrary
                    attachable={attachable}
                    generated={generated}
                    selectedIds={selected}
                    slots={categoryTemplate(category).fileSlots}
                    target={libraryTarget}
                    adding={adding}
                    canAddFiles={isDesktop}
                    onTargetChange={setLibraryTarget}
                    onAssign={assignDocument}
                    onAddFiles={(target) => void addDocuments(target)}
                    onPaste={pasteResource}
                    canViewGenerated={Boolean(caps?.system.partnerWindow)}
                    onViewGenerated={(doc) => void backend.partner.open(doc.file_name, null, null, null, [], doc.id)}
                  />
                </div>
              </div>
            </div>
          )}
        </div>
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
            <dt className="text-fg-faint">Your role</dt>
            <dd className="text-fg">
              {participationLensLabel(category, participationLens)}
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
            <dt className="text-fg-faint">Claim checks</dt>
            <dd className="text-fg">
              {sourcePolicy.allow_automatic_checks ? "Automatic" : "Manual"}
            </dd>
            <dt className="text-fg-faint">Allowed evidence</dt>
            <dd className="text-fg">
              {sourcePolicy.allowed_classes.length} source class
              {sourcePolicy.allowed_classes.length === 1 ? "" : "es"}
            </dd>
            <dt className="text-fg-faint">Claim web research</dt>
            <dd className="text-fg">{sourcePolicy.allow_open_web ? "Allowed" : "Off"}</dd>
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
          <p className="mt-2 rounded border border-border px-3 py-2 text-[11px] leading-relaxed text-fg-muted">
            {sourcePolicyDisclosure(sourcePolicy)}
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

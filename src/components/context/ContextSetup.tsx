import { useEffect, useState } from "react";

import { CATEGORY_ICON } from "@/components/contexts/ContextsPane";
import { CATEGORIES, categoryTemplate, researchDefault } from "@/components/context/categoryTemplates";
import { contextStarter } from "@/components/context/contextStarters";
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
import { Section, ViewActionFooter, ViewShell } from "@/components/studio/ViewShell";
import { Icon } from "@/components/ui/Icon";
import {
  ContextResourceLibrary,
  OTHER_RESOURCE_TARGET,
} from "@/components/context/ContextResourceLibrary";
import { GenerationProgressBar, GenerationStatus } from "@/components/context/ResourceGenerationStatus";
import {
  generationStages,
  researchStage,
  type GenerationStage,
} from "@/components/context/generationStatus";
import { useGenerationProgress } from "@/components/context/useGenerationProgress";
import { DOC_DRAG_MIME } from "@/components/contexts/LibraryPane";
import { DocumentTypeIcon } from "@/components/ui/DocumentTypeIcon";
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

/**
 * A Context resource slot that accepts documents three ways: an in-app
 * Library-row drag (`DOC_DRAG_MIME`), an OS file drop from Explorer/Finder, and
 * a clipboard paste (Ctrl/Cmd+V) of either text or files.
 *
 * The OS-file and paste paths exist because the window runs with
 * `dragDropEnabled: false` (CLAUDE.md rule 8) so in-page HTML5 drag-drop works
 * at all. That setting also means Tauri's `onDragDropEvent` never fires, so a
 * dropped file arrives as a `File` with no filesystem path — handled by
 * `context.storeDocFile` on desktop and `rag.upload` on web. Before this,
 * these zones read only `DOC_DRAG_MIME`, so an Explorer drop silently did
 * nothing at all.
 */
/**
 * One component for every way a document gets into a Context slot: the Upload
 * picker, an OS file drop, an in-app Library-row drag, and the clipboard
 * (Paste button or Ctrl/Cmd+V). Owner, 2026-09-22 — the Upload and Paste
 * buttons sit in the CENTRE of the drop rectangle so the whole affordance is
 * one thing to look at, which supersedes the earlier "compact Upload control in
 * the section header" placement (CLAUDE.md rule 9, updated alongside this).
 *
 * The OS-file and paste paths exist because the window runs with
 * `dragDropEnabled: false` (rule 8) so in-page HTML5 drag-drop works at all.
 * That also means Tauri's `onDragDropEvent` never fires, so a dropped file
 * arrives as a `File` with no filesystem path — handled by
 * `context.storeDocFile` on desktop and `rag.upload` on web.
 */
function ResourceIntake({
  title,
  label,
  description,
  docs,
  active,
  busy,
  canUpload,
  onSelect,
  onUpload,
  onPasteClipboard,
  onDropDoc,
  onDropFiles,
  onPasteText,
  onRemove,
}: {
  /** Heading shown to the user (may carry a "(multiple)" suffix). */
  title: string;
  /** Plain slot name used in aria-labels — stable even when the heading gains
   *  a suffix, so assistive tech and tests name the same thing. */
  label: string;
  description: string;
  docs: readonly RagDocument[];
  active: boolean;
  busy: boolean;
  canUpload: boolean;
  onSelect: () => void;
  onUpload: () => void;
  onPasteClipboard: () => void;
  onDropDoc: (docId: string) => void;
  onDropFiles: (files: File[]) => void;
  onPasteText: (text: string) => void;
  onRemove: (docId: string) => void;
}) {
  const [over, setOver] = useState(false);
  return (
    <div
      onClick={onSelect}
      onDragEnter={(event) => {
        event.preventDefault();
        setOver(true);
      }}
      onDragOver={(event) => {
        // Both are required for a drop to fire at all, and `dropEffect` is what
        // gives the cursor its copy affordance over the zone.
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={(event) => {
        // Ignore bubbling leaves from children, or the highlight flickers as
        // the pointer crosses the rows inside the zone.
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setOver(false);
        const docId = event.dataTransfer.getData(DOC_DRAG_MIME);
        if (docId) {
          onDropDoc(docId);
          return;
        }
        const files = Array.from(event.dataTransfer.files ?? []);
        if (files.length > 0) onDropFiles(files);
      }}
      onPaste={(event) => {
        const files = Array.from(event.clipboardData?.files ?? []);
        if (files.length > 0) {
          event.preventDefault();
          onDropFiles(files);
          return;
        }
        const text = event.clipboardData?.getData("text/plain")?.trim();
        if (text) {
          event.preventDefault();
          onPasteText(text);
        }
      }}
      // Focusable so a Ctrl+V has somewhere to land: `onPaste` only fires for
      // the focused element (or its ancestors), and a plain <div> never is.
      tabIndex={0}
      className={[
        "rounded-xl outline-none transition",
        active ? "ring-1 ring-primary/50" : "",
        over ? "ring-2 ring-primary bg-primary/5" : "",
        "focus-visible:ring-2 focus-visible:ring-primary/60",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <Section title={title} description={description}>
        {docs.length > 0 && (
          <ul className="mb-3 divide-y divide-border">
            {docs.map((doc) => (
              <li key={doc.id} className="flex items-center gap-2 py-2">
                <DocumentTypeIcon doc={doc} size={15} />
                <span className="min-w-0 flex-1 truncate text-sm text-fg">{doc.file_name}</span>
                {doc.source === "pasted" && (
                  <span className="shrink-0 rounded-full bg-panel-raised px-1.5 py-0.5 text-[10px] text-fg-faint">
                    From clipboard
                  </span>
                )}
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onRemove(doc.id);
                  }}
                  aria-label={`Remove ${doc.file_name} from ${label} — stays in your Library`}
                  title="Remove from this Context (stays in your Library)"
                  className="rounded-sm p-1 text-fg-faint hover:bg-rec/10 hover:text-rec"
                >
                  <Icon name="close" size={12} />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-col items-center gap-2 rounded-md border border-dashed border-border px-3 py-4 text-center">
          <p className="text-[11px] text-fg-faint">
            Drop files here, paste with Ctrl+V, or drag a row from the Library
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <button
              type="button"
              className="btn h-7 px-2 py-1 text-[10px]"
              disabled={busy || !canUpload}
              aria-label={`Upload files to ${label}`}
              onClick={(event) => {
                event.stopPropagation();
                onSelect();
                onUpload();
              }}
            >
              <Icon name="upload" size={12} />
              Upload
            </button>
            <button
              type="button"
              className="btn h-7 px-2 py-1 text-[10px]"
              disabled={busy}
              aria-label={`Paste clipboard into ${label}`}
              onClick={(event) => {
                event.stopPropagation();
                onSelect();
                onPasteClipboard();
              }}
            >
              <Icon name="clipboard" size={12} />
              Paste
            </button>
          </div>
        </div>
      </Section>
    </div>
  );
}

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
  /** Called with the saved Context's id + title so a fresh creation can be
   *  auto-activated as the grounding context (owner: "if I create a context
   *  and go to live session, automatically select it as the default context
   *  for the next live session"). */
  onDone: (id: string, title: string) => void;
  onCancel: () => void;
}) {
  const backend = useBackend();
  const caps = useCapabilities();
  const [regenerating, setRegenerating] = useState(false);
  const generationProgress = useGenerationProgress(regenerating, initial?.id);
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

  /** Detaches a document from this Context's slot/Other list only — it stays
   *  in the Library. Non-destructive is the safer default; the remove
   *  control's label/tooltip say so explicitly so it never reads as delete. */
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

  /** Ingest `File`s that arrived without a filesystem path — an OS drop onto a
   *  slot, or a clipboard paste. Desktop stores each into the Context folder
   *  and ingests it by path (same two steps as the file picker); web uploads to
   *  the cloud library. Either way the new docs land in `target`. */
  const ingestFiles = async (files: readonly File[], target: string) => {
    if (files.length === 0) return;
    setAdding(true);
    setError(null);
    try {
      const contextTitle = title.trim() || "untitled";
      let reports;
      if (isDesktop) {
        const stored: string[] = [];
        for (const file of files) stored.push(await backend.context.storeDocFile(contextTitle, file));
        reports = await backend.rag.ingest(stored);
      } else {
        reports = await backend.rag.upload(files);
      }
      const newIds = reports.map((r) => r.document.id);
      setDocs(await backend.rag.list());
      setSelected((current) => Array.from(new Set([...current, ...newIds])));
      newIds.forEach((id) => assignDocument(target, id));
    } catch {
      setError(files.length === 1 ? "Couldn't add that file." : "Couldn't add those files.");
    } finally {
      setAdding(false);
    }
  };

  /** Read the clipboard on demand (the Paste button) and save it as a file in
   *  `target`. An image lands as a real image file; otherwise the text is
   *  stored as a `.txt`, which `rag.ingest_text` marks `DocSource::Pasted` so
   *  the row shows a "From clipboard" badge. Ctrl+V still works separately via
   *  the zone's own onPaste — this is the button path, which needs the async
   *  Clipboard API because there is no paste event to read from. */
  const pasteFromClipboard = async (target: string, label: string) => {
    const stamp = new Date().toISOString().slice(0, 16).replace("T", " ").replace(":", "-");
    try {
      // Images first: a screenshot has no useful text form.
      if (navigator.clipboard?.read) {
        const items = await navigator.clipboard.read();
        const files: File[] = [];
        for (const item of items) {
          const type = item.types.find((t) => t.startsWith("image/"));
          if (!type) continue;
          const blob = await item.getType(type);
          files.push(new File([blob], `clipboard ${stamp}.${type.split("/")[1] || "png"}`, { type }));
        }
        if (files.length > 0) {
          await ingestFiles(files, target);
          return;
        }
      }
    } catch {
      // read() is unavailable or permission was refused — fall through to text.
    }
    try {
      const text = (await navigator.clipboard.readText())?.trim();
      if (!text) {
        setError("The clipboard is empty.");
        return;
      }
      await pasteResource(`${label} (clipboard ${stamp})`, text, target);
    } catch {
      setError("Couldn't read the clipboard — click the section and press Ctrl+V instead.");
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

  const nextStepLabel = step < 3 ? STEP_LABEL[step] : null;
  const nextStepDisplay = nextStepLabel
    ? nextStepLabel.charAt(0).toUpperCase() + nextStepLabel.slice(1)
    : null;
  const advance = () => {
    if (step < 3) {
      setStep((current) => current + 1);
    } else {
      void finish();
    }
  };
  const advanceDisabled = step < 3 ? !canNext : saving;

  const advanceButton = (location: "header" | "footer") => (
    <button
      type="button"
      className="btn btn-primary"
      disabled={advanceDisabled}
      onClick={advance}
      aria-label={
        step < 3
          ? location === "header"
            ? `Next to ${nextStepDisplay}`
            : "Next"
          : location === "header"
            ? "Finish Context"
            : "Finish"
      }
    >
      {step < 3
        ? location === "footer"
          ? `Next: ${nextStepDisplay}`
          : "Next"
        : saving
          ? "Preparing…"
          : "Finish"}
      <Icon name="chevron" size={14} className="-rotate-90" />
    </button>
  );

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
      onDone(saved.id, saved.title);
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
      actions={advanceButton("header")}
      footer={
        <ViewActionFooter
          previous={
            step > 1
              ? { label: "Previous", onClick: () => setStep((current) => current - 1) }
              : undefined
          }
          status={<>Step {step} of 3</>}
        >
          {advanceButton("footer")}
        </ViewActionFooter>
      }
      wide={step === 2}
      bodyScrollable={step !== 2}
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
                placeholder={contextStarter(category).namePlaceholder}
              />
            </label>
            <label className="field">
              Goal
              <textarea
                className="input"
                rows={3}
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
                placeholder={contextStarter(category).purposePlaceholder}
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
        <div className="grid h-full min-h-0 gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
          <div className="flex min-h-0 min-w-0 flex-col gap-4 overflow-y-auto pb-4 pr-1">
          <button
            type="button"
            onClick={() => setLibraryDrawerOpen(true)}
            className="btn btn-primary self-start xl:hidden"
          >
            <Icon name="library" size={14} /> Open Library
            <span className="rounded-full bg-primary-ink/15 px-1.5 text-[10px]">{selected.length}</span>
          </button>
          {slotGroups.map(({ slot, docs: assignedDocs }) => (
            <ResourceIntake
              key={slot.key}
              title={slot.label + (slot.multiple ? " (multiple)" : "")}
              label={slot.label}
              description="Select this section, then upload, drop, or paste a resource — or drag one from the Library column."
              docs={assignedDocs}
              active={libraryTarget === slot.key}
              busy={adding}
              canUpload={isDesktop}
              onSelect={() => setLibraryTarget(slot.key)}
              onUpload={() => void addDocuments(slot.key)}
              onPasteClipboard={() => void pasteFromClipboard(slot.key, slot.label)}
              onDropDoc={(docId) => assignDocument(slot.key, docId)}
              onDropFiles={(files) => void ingestFiles(files, slot.key)}
              onPasteText={(text) => void pasteResource(slot.label, text, slot.key).catch(() => {})}
              onRemove={(docId) => removeDocument(slot.key, docId)}
            />
          ))}
          <ResourceIntake
            title="Other documents"
            label="Other documents"
            description="Anything that does not fit a section above still grounds this Context."
            docs={assignedOtherDocs}
            active={libraryTarget === OTHER_RESOURCE_TARGET}
            busy={adding}
            canUpload={isDesktop}
            onSelect={() => setLibraryTarget(OTHER_RESOURCE_TARGET)}
            onUpload={() => void addDocuments(OTHER_RESOURCE_TARGET)}
            onPasteClipboard={() => void pasteFromClipboard(OTHER_RESOURCE_TARGET, "Other documents")}
            onDropDoc={(docId) => assignDocument(OTHER_RESOURCE_TARGET, docId)}
            onDropFiles={(files) => void ingestFiles(files, OTHER_RESOURCE_TARGET)}
            onPasteText={(text) =>
              void pasteResource("Pasted note", text, OTHER_RESOURCE_TARGET).catch(() => {})
            }
            onRemove={(docId) => removeDocument(OTHER_RESOURCE_TARGET, docId)}
          />
          {initial && (
            <Section
              title="Generate Context resources"
              description="Creates Context Knowledge, then runs optional web research and Interview Q&A when configured. Every stage reports its result."
            >
              <div className="mb-3">
                {regenerating && <GenerationProgressBar {...generationProgress} />}
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
              placeholder={contextStarter(category).keyTermsPlaceholder}
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

          <div className="hidden min-h-0 xl:block">
            <div className="h-full min-h-0 pb-4">
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

    </ViewShell>
  );
}

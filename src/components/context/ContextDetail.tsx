import { useCallback, useEffect, useState } from "react";

import { type DetailSectionId, toggleDetailSection } from "@/components/context/detailSections";
import { Section, ViewShell } from "@/components/studio/ViewShell";
import { Icon } from "@/components/ui/Icon";
import { useBackend } from "@/lib/backend";
import { useCapabilities } from "@/lib/backend/context";
import { formatBytes } from "@/lib/formatBytes";
import { formatRelativeTime } from "@/lib/relativeTime";
import { DEFAULT_CONTEXT_ID, type KnowledgeProfile, type RagDocument, type ConversationContext } from "@/lib/ipc";
import { useNavStore } from "@/state/nav";
import { useRehearsalStore } from "@/state/rehearsal";

/** One accordion section (Contexts-screen-redesign spec, requirement 8) —
 *  collapsed to a one-line summary by default, tap to expand. Local to
 *  this file rather than a change to the shared `Section` in
 *  `ViewShell.tsx`, which many unrelated views also use. Mirrors
 *  `Section`'s own card/title styling so it reads as the same visual
 *  family, just with a toggle. */
function CollapsibleSection({
  id,
  open,
  onToggle,
  title,
  summary,
  children,
}: {
  id: DetailSectionId;
  open: boolean;
  onToggle: (id: DetailSectionId) => void;
  title: string;
  summary: string;
  children: React.ReactNode;
}) {
  return (
    <div className="card p-4">
      <button
        type="button"
        onClick={() => onToggle(id)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 text-left"
      >
        <span className="min-w-0 flex-1">
          <span className="text-xs font-semibold uppercase tracking-wider text-fg-muted">
            {title}
          </span>
          {!open && (
            <span className="ml-2 truncate text-[11px] text-fg-faint">{summary}</span>
          )}
        </span>
        <Icon
          name="chevron"
          size={13}
          className={`shrink-0 text-fg-faint transition ${open ? "" : "-rotate-90"}`}
        />
      </button>
      {open && <div className="mt-3">{children}</div>}
    </div>
  );
}

function formatDate(unixMs: number): string {
  return new Date(unixMs).toLocaleString();
}

/**
 * Context detail — the persona step (Step 3) and the launch point for the live
 * session (Step 4, next phase). Generate 3 counterparty personas from the
 * knowledge base, pick one, then Start. Edit reopens the setup wizard.
 */
export function ContextDetail({
  id,
  onEdit,
  onBack,
}: {
  id: string;
  onEdit: () => void;
  onBack: () => void;
}) {
  const backend = useBackend();
  const caps = useCapabilities();
  const [openSection, setOpenSection] = useState<DetailSectionId | null>(null);
  const [session, setSession] = useState<ConversationContext | null>(null);
  const [profile, setProfile] = useState<KnowledgeProfile | null>(null);
  const [docs, setDocs] = useState<RagDocument[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    backend.context
      .load(id)
      .then(setSession)
      .catch(() => setError("Couldn't load this Context."));
  }, [backend, id]);

  useEffect(() => {
    load();
  }, [load]);

  // Load the knowledge base (attached docs + researched sources) so the user
  // can see exactly what grounds the rehearsal — including what Ally found.
  const profileId = session?.knowledge_profile_id ?? null;
  useEffect(() => {
    if (!profileId) {
      setProfile(null);
      return;
    }
    void backend.context.loadProfile(profileId).then(setProfile).catch(() => {});
    void backend.rag.list().then(setDocs).catch(() => {});
  }, [backend, profileId]);

  const docName = (docId: string) =>
    docs.find((d) => d.id === docId)?.file_name ?? docId;

  // ── Ally documents ────────────────────────────────────────────────────────
  const dossierId = session?.dossier_doc_id ?? null;
  const [dossierBusy, setDossierBusy] = useState(false);
  const [dossierText, setDossierText] = useState<string | null>(null);
  const [showDossier, setShowDossier] = useState(false);

  const researchDocId = session?.research_doc_id ?? null;
  const [researchText, setResearchText] = useState<string | null>(null);
  const [showResearch, setShowResearch] = useState(false);

  const qaDocId = session?.qa_doc_id ?? null;
  const [qaText, setQaText] = useState<string | null>(null);
  const [showQa, setShowQa] = useState(false);

  const generateDossier = async () => {
    setDossierBusy(true);
    setError(null);
    try {
      const updated = await backend.context.generateDossier(id);
      setSession(updated);
      setShowDossier(true);
      // Load the freshly written document so it shows inline right away.
      if (updated.dossier_doc_id) {
        setDossierText(
          (await backend.rag.documentText(updated.dossier_doc_id)) ?? "",
        );
      }
      // Refresh (or clear) the research findings so a regenerate shows the
      // new document immediately.
      if (updated.research_doc_id) {
        setResearchText(
          (await backend.rag.documentText(updated.research_doc_id)) ?? "",
        );
      } else {
        setResearchText(null);
      }
      // Refresh (or clear) the Interview Q&A document too.
      if (updated.qa_doc_id) {
        setQaText(
          (await backend.rag.documentText(updated.qa_doc_id)) ?? "",
        );
      } else {
        setQaText(null);
      }
      // Refresh the knowledge base doc list — non-fatal if it fails.
      if (updated.knowledge_profile_id) {
        try {
          setProfile(
            await backend.context.loadProfile(updated.knowledge_profile_id),
          );
          setDocs(await backend.rag.list());
        } catch {
          /* the dossier still generated; ignore a refresh hiccup */
        }
      }
    } catch (e) {
      setError(
        `Couldn't generate the prep document: ${String(e).replace(/^Error:\s*/, "")}`,
      );
    } finally {
      setDossierBusy(false);
    }
  };

  const toggleDossier = async () => {
    const next = !showDossier;
    setShowDossier(next);
    if (next && dossierText === null && dossierId) {
      setDossierText((await backend.rag.documentText(dossierId)) ?? "");
    }
  };

  const toggleResearch = async () => {
    const next = !showResearch;
    setShowResearch(next);
    if (next && researchText === null && researchDocId) {
      setResearchText((await backend.rag.documentText(researchDocId)) ?? "");
    }
  };

  const toggleQa = async () => {
    const next = !showQa;
    setShowQa(next);
    if (next && qaText === null && qaDocId) {
      setQaText((await backend.rag.documentText(qaDocId)) ?? "");
    }
  };

  const generate = async () => {
    setBusy(true);
    setError(null);
    try {
      setSession(await backend.context.generatePersonas(id));
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
      setSession(await backend.context.choosePersona(id, pid));
    } catch {
      /* best-effort */
    }
  };

  const personas = session?.personas ?? [];
  const chosen = session?.chosen_persona_id ?? null;
  const chosenPersona = personas.find((p) => p.id === chosen) ?? null;

  // ── Live rehearsal (Step 4) ───────────────────────────────────────────────
  // Launches into the real cockpit (transcript · spine · Ally); the floating
  // RehearsalBar carries the live controls from there.
  const setView = useNavStore((s) => s.setView);
  const beginRehearsal = useRehearsalStore((s) => s.begin);
  const [starting, setStarting] = useState(false);
  const [rehearsalError, setRehearsalError] = useState<string | null>(null);

  const startRehearsal = async () => {
    setStarting(true);
    setRehearsalError(null);
    try {
      await backend.context.startRehearsal(id);
      beginRehearsal(chosenPersona?.title ?? "Counterparty");
      setView("live");
    } catch (e) {
      setRehearsalError(String(e).replace(/^Error:\s*/, ""));
    } finally {
      setStarting(false);
    }
  };

  return (
    <ViewShell
      icon="simicon"
      breadcrumb="Contexts"
      title={session?.title || "Context"}
      subtitle={session?.purpose || "Rehearse a high-stakes call."}
      onBack={onBack}
      actions={
        // The default context is system-managed — no Edit (matches the
        // same guard on its ContextsPane row).
        session && session.id !== DEFAULT_CONTEXT_ID ? (
          <button
            type="button"
            onClick={onEdit}
            title="Edit setup"
            aria-label="Edit setup"
            className="rounded-sm p-1.5 text-fg-faint transition hover:bg-panel-raised/60 hover:text-fg"
          >
            <Icon name="edit" size={15} />
          </button>
        ) : null
      }
    >
      {error && (
        <Section title="Context">
          <p className="text-sm text-rec">{error}</p>
        </Section>
      )}

      <CollapsibleSection
        id="counterparty"
        open={openSection === "counterparty"}
        onToggle={(id) => setOpenSection((cur) => toggleDetailSection(cur, id))}
        title="Counterparty"
        summary={
          personas.length === 0
            ? "No personas generated yet"
            : chosenPersona
              ? `${personas.length} persona${personas.length === 1 ? "" : "s"} — ${chosenPersona.title} chosen`
              : `${personas.length} persona${personas.length === 1 ? "" : "s"} — none chosen`
        }
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
                        ? "border-primary/50 bg-primary/[0.08]"
                        : "border-border"
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      <h3 className="min-w-0 flex-1 text-sm font-bold tracking-tight text-fg">
                        {p.title}
                      </h3>
                      {p.recommended && (
                        <span className="pill pill-sm pill-ally shrink-0">★ Recommended</span>
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
      </CollapsibleSection>

      <CollapsibleSection
        id="knowledge"
        open={openSection === "knowledge"}
        onToggle={(id) => setOpenSection((cur) => toggleDetailSection(cur, id))}
        title="Knowledge base"
        summary={
          profile
            ? `${profile.doc_ids.length} document${profile.doc_ids.length === 1 ? "" : "s"}, updated ${formatRelativeTime(profile.updated_at_unix_ms)}`
            : "Not prepared yet"
        }
      >
        {!profile ? (
          <p className="text-[12px] text-fg-faint">
            {profileId
              ? "Loading…"
              : "Not prepared yet — finish setup to build the knowledge base."}
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {/* Ally documents — the documents Ally writes from the material. */}
            <div className="rounded-lg border border-ai/30 bg-ai/[0.06] p-3">
              {/* Row 1 — Context knowledge (Stage 1) */}
              <div className="flex items-center gap-2">
                <span
                  title="Stage 1 — Ally reads the role, job description, and your documents together and writes a structured knowledge document (role profile, core vocabulary, likely Q&A). Saved to your Library and indexed for grounding."
                  className="shrink-0"
                >
                  <Icon name="simicon" size={15} className="text-ai" />
                </span>
                <span className="text-[12px] font-semibold text-fg">
                  Context knowledge
                </span>
                <div className="flex-1" />
                {dossierId && (
                  <button
                    type="button"
                    onClick={() => void toggleDossier()}
                    className="rounded-sm px-2 py-0.5 text-[11px] font-semibold text-ai hover:bg-ai/10"
                  >
                    {showDossier ? "Hide" : "View"}
                  </button>
                )}
                <button
                  type="button"
                  disabled={dossierBusy}
                  onClick={() => void generateDossier()}
                  className="rounded-sm border border-ai/40 px-2 py-0.5 text-[11px] font-semibold text-ai hover:bg-ai/10 disabled:opacity-40"
                >
                  {dossierBusy
                    ? "Writing…"
                    : dossierId
                      ? "Regenerate"
                      : "Generate"}
                </button>
              </div>
              {session?.resources_stale && (
                <p className="mt-1 text-[11px] font-semibold text-ai">
                  Inputs changed since this was generated — Regenerate to
                  refresh.
                </p>
              )}
              {dossierId && showDossier && (
                <pre className="mt-2 max-h-[40vh] overflow-y-auto whitespace-pre-wrap rounded border border-border bg-bg/50 p-2.5 text-[12px] leading-relaxed text-fg-muted">
                  {dossierText === null
                    ? "Loading…"
                    : dossierText.trim() === ""
                      ? "(No content returned — try Regenerate.)"
                      : dossierText}
                </pre>
              )}

              {/* Row 2 — Research findings (Stage 2) */}
              <div className="mt-3 flex items-center gap-2 border-t border-border/60 pt-3">
                <span
                  title={
                    session?.research_enabled
                      ? researchDocId
                        ? "Stage 2 — what Ally found on the web for this context, with sources cited. Regenerating resources refreshes it."
                        : "Stage 2 — runs with Generate when web research is enabled (needs a search key in Settings)."
                      : "Web research is off for this context — enable it in Edit setup to generate findings."
                  }
                  className="shrink-0"
                >
                  <Icon name="search" size={15} className="text-ai" />
                </span>
                <span className="text-[12px] font-semibold text-fg">
                  Research findings
                </span>
                <div className="flex-1" />
                {researchDocId && (
                  <button
                    type="button"
                    onClick={() => void toggleResearch()}
                    className="rounded-sm px-2 py-0.5 text-[11px] font-semibold text-ai hover:bg-ai/10"
                  >
                    {showResearch ? "Hide" : "View"}
                  </button>
                )}
              </div>
              {researchDocId && showResearch && (
                <pre className="mt-2 max-h-[40vh] overflow-y-auto whitespace-pre-wrap rounded border border-border bg-bg/50 p-2.5 text-[12px] leading-relaxed text-fg-muted">
                  {researchText === null
                    ? "Loading…"
                    : researchText.trim() === ""
                      ? "(No content returned — try Regenerate.)"
                      : researchText}
                </pre>
              )}

              {/* Row 3 — Interview Q&A (Stage 3, interview category only) */}
              {session?.category === "interview" && (
                <>
                  <div className="mt-3 flex items-center gap-2 border-t border-border/60 pt-3">
                    <span
                      title={
                        qaDocId
                          ? "Common interview questions Ally found online, with strong answers."
                          : session?.deep_qa_enabled
                            ? "Runs with Generate — deep Q&A research is on for this context."
                            : 'Turn on "Deep interview Q&A research" in Edit setup to generate this.'
                      }
                      className="shrink-0"
                    >
                      <Icon name="question" size={15} className="text-ai" />
                    </span>
                    <span className="text-[12px] font-semibold text-fg">
                      Interview Q&A
                    </span>
                    <div className="flex-1" />
                    {qaDocId && (
                      <button
                        type="button"
                        onClick={() => void toggleQa()}
                        className="rounded-sm px-2 py-0.5 text-[11px] font-semibold text-ai hover:bg-ai/10"
                      >
                        {showQa ? "Hide" : "View"}
                      </button>
                    )}
                  </div>
                  {qaDocId && showQa && (
                    <pre className="mt-2 max-h-[40vh] overflow-y-auto whitespace-pre-wrap rounded border border-border bg-bg/50 p-2.5 text-[12px] leading-relaxed text-fg-muted">
                      {qaText === null
                        ? "Loading…"
                        : qaText.trim() === ""
                          ? "(No content returned — try Regenerate.)"
                          : qaText}
                    </pre>
                  )}
                </>
              )}
            </div>

            {/* Attached documents (these live in your Library too). The generated
                Ally documents are shown above, so they're excluded here. */}
            {(() => {
              const attached = profile.doc_ids.filter(
                (d) => d !== dossierId && d !== researchDocId && d !== qaDocId,
              );
              const docMeta = (docId: string): string => {
                const d = docs.find((x) => x.id === docId);
                if (!d) return docName(docId);
                const kind =
                  d.source === "generated"
                    ? "By conva"
                    : d.source === "pasted"
                      ? "Pasted note"
                      : "File";
                return [
                  docName(docId),
                  `${kind} · ${d.chunk_count} chunk${d.chunk_count === 1 ? "" : "s"} · ${formatBytes(d.size_bytes)}`,
                  `Added ${formatDate(d.ingested_at_unix_ms)}`,
                ].join("\n");
              };
              return (
                <div>
                  <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-fg-faint">
                    Documents ({attached.length})
                  </h3>
                  {attached.length === 0 ? (
                    <p className="text-[12px] text-fg-faint">
                      No documents attached.
                    </p>
                  ) : (
                    <ul className="flex flex-col gap-0.5">
                      {attached.map((docId) =>
                        caps?.system.partnerWindow ? (
                          <li key={docId}>
                            <button
                              type="button"
                              onClick={() =>
                                void backend.partner.open(
                                  docName(docId),
                                  null,
                                  null,
                                  null,
                                  [],
                                  docId,
                                )
                              }
                              title={docMeta(docId)}
                              aria-label={`View "${docName(docId)}"`}
                              className="flex w-full items-center gap-1.5 rounded-sm text-left text-[12px] text-fg-muted transition hover:text-ai"
                            >
                              <Icon
                                name="book"
                                size={13}
                                className="shrink-0 text-fg-faint"
                              />
                              <span className="truncate">{docName(docId)}</span>
                            </button>
                          </li>
                        ) : (
                          <li
                            key={docId}
                            title={docMeta(docId)}
                            className="flex items-center gap-1.5 text-[12px] text-fg-muted"
                          >
                            <Icon
                              name="book"
                              size={13}
                              className="shrink-0 text-fg-faint"
                            />
                            <span className="truncate">{docName(docId)}</span>
                          </li>
                        ),
                      )}
                    </ul>
                  )}
                </div>
              );
            })()}

            {/* Web research Ally collected — links out to each source. */}
            <div>
              <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-fg-faint">
                Ally research ({profile.research.length})
              </h3>
              {profile.research.length === 0 ? (
                <p className="text-[12px] text-fg-faint">
                  No web research — grounded on your documents only.
                </p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {profile.research.map((src, i) => (
                    <li key={`${src.url}-${i}`} className="text-[12px]">
                      <button
                        type="button"
                        onClick={() => void backend.auth.openUrl(src.url)}
                        title={src.url}
                        className="text-left font-medium text-ai hover:underline"
                      >
                        {src.title || src.url}
                      </button>
                      {src.snippet && (
                        <p className="mt-0.5 line-clamp-2 text-fg-faint">
                          {src.snippet}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </CollapsibleSection>

      <CollapsibleSection
        id="rehearse"
        open={openSection === "rehearse"}
        onToggle={(id) => setOpenSection((cur) => toggleDetailSection(cur, id))}
        title="Rehearse"
        summary={chosen ? "Ready to start" : "Choose a persona first"}
      >
        <div className="flex flex-col gap-2">
          <button
            type="button"
            className="btn btn-primary self-start"
            disabled={!chosen || starting}
            onClick={() => void startRehearsal()}
          >
            {starting ? "Starting…" : "Start rehearsal"}
          </button>
          {!chosen && (
            <p className="text-[11px] text-fg-faint">
              Choose a persona above to rehearse against.
            </p>
          )}
          {rehearsalError && (
            <p className="text-[12px] text-rec" role="alert">
              {rehearsalError}
            </p>
          )}
        </div>
      </CollapsibleSection>
    </ViewShell>
  );
}

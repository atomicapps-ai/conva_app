import { useCallback, useEffect, useState } from "react";

import {
  CATEGORY_LABEL,
  missingForSetup,
  type PracticeTemplate,
} from "@/components/coaching/coachingModel";
import { ContextSetup } from "@/components/context/ContextSetup";
import {
  EmptyState,
  ErrorState,
  Eyebrow,
  Panel,
  PrimaryButton,
  SecondaryButton,
  Skeleton,
  StatusPill,
} from "@/components/studio/PageView";
import { ViewShell } from "@/components/studio/ViewShell";
import { Icon } from "@/components/ui/Icon";
import { useBackend } from "@/lib/backend";
import { useCapabilities } from "@/lib/backend/context";
import {
  DEFAULT_CONTEXT_ID,
  type ContextSummary,
  type ConversationContext,
} from "@/lib/ipc";
import { useNavStore } from "@/state/nav";
import { useRehearsalStore } from "@/state/rehearsal";

/**
 * "+ New coaching setup" — AppUI V5.0 §5's flow, mapped onto the commands the
 * app already has, with nothing faked in between:
 *
 * | Spec step                     | What runs                                   |
 * | ----------------------------- | ------------------------------------------- |
 * | 1 Choose or create a Context  | `context.list` / the existing `ContextSetup` |
 * | 2 Choose mode & persona       | mode = the Context's category (real field);  |
 * |                               | `generatePersonas` + `choosePersona`         |
 * | 3 Select practice goals       | — see the note below                         |
 * | 4 Prepare / generate resources| `prepare` + `generateDossier`                |
 * | 5 Save the reusable setup     | the Context IS the setup; saved by step 1    |
 * | 6 Optionally start a session  | `startRehearsal` → the Live cockpit          |
 *
 * **Step 3 is deliberately not implemented as its own field.** There is no
 * `practice_goals` anywhere in the IPC contract or the Rust context record, so
 * a goals input here would collect text and silently drop it. The Context's
 * own "key terms / points to cover" (Step 1 of `ContextSetup`) is the nearest
 * real field and is where goals belong until a dedicated one is designed —
 * adding one means Rust + `ipc.rs` + `ipc.ts` + the typed wrapper + tests
 * together, which is a decision for the owner, not a silent extension here.
 *
 * This is a SUB-VIEW of Coaching, so it wears `ViewShell`'s breadcrumb + back
 * chevron (CLAUDE.md rule 9), not `PageView`'s crown.
 */
export function CoachingSetupView({
  template,
  onDone,
  onCancel,
}: {
  /** The practice template that started this, if any. */
  template: PracticeTemplate | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const backend = useBackend();
  const caps = useCapabilities();
  const setView = useNavStore((s) => s.setView);
  const beginRehearsal = useRehearsalStore((s) => s.begin);

  const [stage, setStage] = useState<"choose" | "create" | "configure">(
    // A template goes straight into the Context wizard, prefilled.
    template ? "create" : "choose",
  );
  const [contexts, setContexts] = useState<ContextSummary[]>([]);
  const [chosenId, setChosenId] = useState<string | null>(null);
  const [full, setFull] = useState<ConversationContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | "personas" | "resources" | "start">(null);

  const loadList = useCallback(() => {
    setLoading(true);
    backend.context
      .list()
      .then((list) => {
        setContexts(list.filter((c) => c.id !== DEFAULT_CONTEXT_ID));
        setError(null);
      })
      .catch(() => setError("Contexts run on the desktop app for now."))
      .finally(() => setLoading(false));
  }, [backend]);

  useEffect(loadList, [loadList]);

  const loadFull = useCallback(
    (id: string) => {
      backend.context
        .load(id)
        .then(setFull)
        .catch(() => setError("Couldn't open that context."));
    },
    [backend],
  );

  useEffect(() => {
    if (chosenId) loadFull(chosenId);
  }, [chosenId, loadFull]);

  const summary = chosenId ? contexts.find((c) => c.id === chosenId) : undefined;
  const missing = summary ? missingForSetup(summary, full) : null;

  const generatePersonas = async () => {
    if (!chosenId) return;
    setBusy("personas");
    try {
      setFull(await backend.context.generatePersonas(chosenId));
      setError(null);
    } catch (e) {
      setError(String(e).replace(/^Error:\s*/, ""));
    } finally {
      setBusy(null);
    }
  };

  const choosePersona = async (personaId: string) => {
    if (!chosenId) return;
    try {
      setFull(await backend.context.choosePersona(chosenId, personaId));
    } catch (e) {
      setError(String(e).replace(/^Error:\s*/, ""));
    }
  };

  const generateResources = async () => {
    if (!chosenId) return;
    setBusy("resources");
    setError(null);
    try {
      await backend.context.prepare(chosenId);
      await backend.context.generateDossier(chosenId);
      loadList();
      loadFull(chosenId);
    } catch (e) {
      setError(String(e).replace(/^Error:\s*/, ""));
    } finally {
      setBusy(null);
    }
  };

  const startSession = async () => {
    if (!chosenId) return;
    setBusy("start");
    setError(null);
    try {
      await backend.context.startRehearsal(chosenId);
      beginRehearsal(
        full?.personas.find((p) => p.id === full.chosen_persona_id)?.title ?? "Counterparty",
      );
      setView("live");
    } catch (e) {
      setError(String(e).replace(/^Error:\s*/, ""));
    } finally {
      setBusy(null);
    }
  };

  if (stage === "create") {
    return (
      <ContextSetup
        initial={
          template
            ? ({
                // id "" marks an unsaved record — ContextSetup's own save
                // payload treats it as "create", so this only prefills.
                id: "",
                title: template.name,
                purpose: template.purpose,
                job_description: null,
                category: template.category,
                status: "draft",
                created_at_unix_ms: 0,
                updated_at_unix_ms: 0,
                source_doc_ids: [],
                auto_generate_context: false,
                knowledge_profile_id: null,
                personas: [],
                chosen_persona_id: null,
                conversation_id: null,
                dossier_doc_id: null,
              } satisfies ConversationContext)
            : undefined
        }
        onDone={() => {
          // The wizard saved; come back and pick the newest context up.
          backend.context
            .list()
            .then((list) => {
              const mine = list.filter((c) => c.id !== DEFAULT_CONTEXT_ID);
              setContexts(mine);
              const newest = [...mine].sort(
                (a, b) => b.created_at_unix_ms - a.created_at_unix_ms,
              )[0];
              if (newest) setChosenId(newest.id);
              setStage("configure");
            })
            .catch(() => setStage("choose"));
        }}
        onCancel={() => (template ? onCancel() : setStage("choose"))}
      />
    );
  }

  return (
    <ViewShell
      icon="rehearsal"
      breadcrumb="Coaching"
      title="New coaching setup"
      subtitle="A setup is a Context plus a counterparty persona and its prepared resources."
      onBack={onCancel}
    >
      <Steps
        current={stage === "choose" || !chosenId ? 1 : missing ? 2 : 3}
      />

      {error && (
        <ErrorState
          title="Something went wrong"
          description={error}
          onRetry={() => {
            setError(null);
            loadList();
          }}
        />
      )}

      {stage === "choose" || !chosenId ? (
        <Panel className="p-5">
          <Eyebrow className="mb-3">Step 1 · Choose or create a Context</Eyebrow>
          {loading ? (
            <Skeleton rows={4} />
          ) : contexts.length === 0 ? (
            <EmptyState
              title="No contexts yet"
              description="A coaching setup is built on a Context — the material Ally practises from."
              action={<PrimaryButton onClick={() => setStage("create")}>Create context</PrimaryButton>}
            />
          ) : (
            <>
              <div className="flex flex-col gap-2">
                {contexts.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => {
                      setChosenId(c.id);
                      setStage("configure");
                    }}
                    className="flex items-center gap-3 rounded-[var(--radius)] border border-border bg-panel-raised px-3.5 py-3 text-left transition hover:border-border-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-fg">{c.title}</span>
                      <span className="mt-1 block font-mono text-[11px] text-fg-faint">
                        {CATEGORY_LABEL[c.category]} · {c.source_doc_count} source
                        {c.source_doc_count === 1 ? "" : "s"}
                      </span>
                    </span>
                    <Icon name="chevron" size={16} className="-rotate-90 shrink-0 text-fg-faint" />
                  </button>
                ))}
              </div>
              <div className="mt-4">
                <SecondaryButton onClick={() => setStage("create")}>
                  Create a new Context instead
                </SecondaryButton>
              </div>
            </>
          )}
        </Panel>
      ) : (
        <>
          <Panel className="p-5">
            <Eyebrow className="mb-3">Step 2 · Mode &amp; persona</Eyebrow>
            <p className="mb-4 text-sm text-fg-muted">
              Mode comes from the Context&apos;s own type —{" "}
              <span className="font-semibold text-fg">
                {summary ? CATEGORY_LABEL[summary.category] : "—"}
              </span>
              . Pick the counterparty Ally should play.
            </p>
            {!full ? (
              <Skeleton rows={3} />
            ) : full.personas.length === 0 ? (
              <EmptyState
                title="No personas generated yet"
                description="Ally builds three counterparty options from this Context's material."
                action={
                  <PrimaryButton onClick={() => void generatePersonas()} disabled={busy !== null}>
                    {busy === "personas" ? "Generating…" : "Generate personas"}
                  </PrimaryButton>
                }
              />
            ) : (
              <div className="grid gap-2.5 sm:grid-cols-3">
                {full.personas.map((p) => {
                  const chosen = p.id === full.chosen_persona_id;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => void choosePersona(p.id)}
                      aria-pressed={chosen}
                      className={[
                        "rounded-[var(--radius)] border p-3.5 text-left transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
                        chosen
                          ? "border-primary/60 bg-primary/[0.08]"
                          : "border-border bg-panel-raised hover:border-border-strong",
                      ].join(" ")}
                    >
                      <span className="flex items-center gap-2">
                        <Icon
                          name={p.gender === "female" ? "personaFemale" : "personaMale"}
                          size={18}
                          className={chosen ? "text-primary" : "text-fg-muted"}
                        />
                        <span className="min-w-0 flex-1 truncate text-sm font-bold text-fg">
                          {p.title}
                        </span>
                        {chosen && <Icon name="check" size={15} className="text-primary" />}
                      </span>
                      <span className="mt-2 block text-[11px] leading-relaxed text-fg-muted">
                        {p.summary}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </Panel>

          <Panel className="p-5">
            <Eyebrow className="mb-3">Step 3 · Prepare resources</Eyebrow>
            <div className="flex flex-wrap items-center gap-3">
              {summary?.has_generated_resources ? (
                summary.resources_stale ? (
                  <StatusPill tone="notice">Stale</StatusPill>
                ) : (
                  <StatusPill tone="ready">Ready</StatusPill>
                )
              ) : (
                <StatusPill tone="idle">Not prepared</StatusPill>
              )}
              <span className="text-sm text-fg-muted">
                {summary?.has_generated_resources
                  ? "Briefing, glossary and prepared Q&A are built from this Context's sources."
                  : "Build the briefing, glossary and prepared Q&A before the first session."}
              </span>
              <SecondaryButton
                onClick={() => void generateResources()}
                disabled={busy !== null}
                className="ml-auto"
              >
                {busy === "resources"
                  ? "Generating…"
                  : summary?.has_generated_resources
                    ? "Regenerate"
                    : "Generate resources"}
              </SecondaryButton>
            </div>
          </Panel>

          <Panel className="flex flex-wrap items-center gap-3 p-5">
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-bold text-fg">
                {missing ?? "This setup is ready to run."}
              </span>
              <span className="mt-1 block text-xs text-fg-muted">
                The setup is saved with the Context — it stays reusable for every
                future session.
              </span>
            </span>
            <SecondaryButton onClick={onDone}>Done</SecondaryButton>
            <PrimaryButton
              onClick={() => void startSession()}
              disabled={missing !== null || busy !== null || !(caps?.capture.mic ?? false)}
              title={
                caps?.capture.mic
                  ? undefined
                  : "Coaching sessions need audio capture — open the desktop app"
              }
            >
              {busy === "start" ? "Starting…" : "Start session"}
            </PrimaryButton>
          </Panel>
        </>
      )}
    </ViewShell>
  );
}

/** The flow's own progress — three steps, current one highlighted. */
function Steps({ current }: { current: 1 | 2 | 3 }) {
  const labels = ["Choose a Context", "Mode & persona", "Prepare & start"];
  return (
    <ol className="flex flex-wrap gap-2" aria-label="Setup progress">
      {labels.map((label, i) => {
        const n = i + 1;
        const state = n < current ? "done" : n === current ? "current" : "todo";
        return (
          <li
            key={label}
            aria-current={state === "current" ? "step" : undefined}
            className={[
              "inline-flex items-center gap-2 rounded-[var(--radius)] border px-3 py-2 text-xs font-medium",
              state === "current"
                ? "border-primary/50 bg-primary/[0.08] text-fg"
                : state === "done"
                  ? "border-border bg-panel-raised text-fg-muted"
                  : "border-border text-fg-faint",
            ].join(" ")}
          >
            <span className="font-mono text-[10px] font-bold text-primary">{n}</span>
            {label}
          </li>
        );
      })}
    </ol>
  );
}

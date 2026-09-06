import { useCallback, useEffect, useState } from "react";

import {
  draftSetups,
  PRACTICE_TEMPLATES,
  preparedSetups,
  toCoachingSessions,
  toSetups,
  type CoachingSession,
  type CoachingSetup,
  type PracticeTemplate,
} from "@/components/coaching/coachingModel";
import { CoachingSetupView } from "@/components/coaching/CoachingSetupView";
import {
  EmptyState,
  ErrorState,
  Eyebrow,
  PageView,
  Panel,
  PrimaryButton,
  SecondaryButton,
  Skeleton,
  StatusPill,
} from "@/components/studio/PageView";
import { Icon } from "@/components/ui/Icon";
import { LockedIcon } from "@/components/ui/LockedIcon";
import { useBackend } from "@/lib/backend";
import { useCapabilities } from "@/lib/backend/context";
import type { ContextSummary, ConversationContext, SessionSummary } from "@/lib/ipc";
import { formatRelativeTime } from "@/lib/relativeTime";
import { useContextsQuickOpen } from "@/state/contextsQuickOpen";
import { useNavStore } from "@/state/nav";

/**
 * Coaching — the umbrella destination (AppUI V5.0 §5). Rehearsals is renamed
 * Coaching everywhere; this page distinguishes generic **practice templates**,
 * reusable Context-connected **coaching setups**, and individual **sessions**.
 *
 * > …with no fabricated analytics or scores.
 *
 * Owner decision 7 says the same thing more bluntly: **coaching analytics stay
 * hidden until real session data exists.** So there is no score, streak,
 * trend, or progress bar anywhere on this page — only counts of things that
 * were actually recorded. When analytics land, they arrive as their own
 * section; do not seed one with placeholders in the meantime. (What's Coming
 * already lists "Coaching analytics" as a private preview.)
 *
 * The object model → real data mapping lives in `coachingModel.ts`.
 */
export function CoachingView() {
  const backend = useBackend();
  const caps = useCapabilities();
  const setView = useNavStore((s) => s.setView);

  const [setups, setSetups] = useState<CoachingSetup[]>([]);
  const [sessions, setSessions] = useState<CoachingSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState<PracticeTemplate | null | "blank">(null);
  const [refreshToken, setRefreshToken] = useState(0);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([backend.context.list(), backend.sessions.list()])
      .then(async ([summaries, sessionList]: [ContextSummary[], SessionSummary[]]) => {
        // A setup's persona lives on the FULL record, so load the ones we
        // list. Failures degrade to "persona unknown" rather than blocking
        // the page — `missingForSetup` deliberately doesn't invent a blocker
        // from a record that didn't load.
        const fulls = await Promise.all(
          summaries.map((s) =>
            backend.context.load(s.id).catch(() => undefined),
          ),
        );
        const fullById: Record<string, ConversationContext | undefined> = {};
        summaries.forEach((s, i) => (fullById[s.id] = fulls[i]));
        setSetups(toSetups(summaries, fullById));
        setSessions(toCoachingSessions(sessionList));
        setError(null);
      })
      .catch(() => setError("Coaching runs on the desktop app for now."))
      .finally(() => setLoading(false));
  }, [backend]);

  useEffect(load, [load, refreshToken]);

  if (creating !== null) {
    return (
      <CoachingSetupView
        template={creating === "blank" ? null : creating}
        onDone={() => {
          setCreating(null);
          setRefreshToken((t) => t + 1);
        }}
        onCancel={() => setCreating(null)}
      />
    );
  }

  const prepared = preparedSetups(setups);
  const drafts = draftSetups(setups);
  const openSetup = (id: string) => {
    useContextsQuickOpen.getState().request(id);
    setView("context");
  };

  return (
    <PageView
      title="Coaching"
      subtitle="Reusable, Context-connected coaching setups and their sessions."
      actions={
        <PrimaryButton onClick={() => setCreating("blank")}>+ New coaching setup</PrimaryButton>
      }
    >
      {error ? (
        <ErrorState
          title="Coaching unavailable"
          description={error}
          onRetry={() => setRefreshToken((t) => t + 1)}
        />
      ) : loading ? (
        <Panel className="p-5">
          <Skeleton rows={5} />
        </Panel>
      ) : (
        <>
          <section>
            <div className="mb-3.5 flex items-baseline justify-between gap-4">
              <Eyebrow>Prepared coaching</Eyebrow>
              <span className="font-mono text-[11px] text-fg-faint">
                Reusable setups with sufficient resources
              </span>
            </div>
            {prepared.length === 0 ? (
              <EmptyState
                title="No prepared setups yet"
                description="A setup becomes prepared once its Context has generated resources and a counterparty persona. Start from a practice template below, or build one from scratch."
                action={
                  <PrimaryButton onClick={() => setCreating("blank")}>
                    + New coaching setup
                  </PrimaryButton>
                }
              />
            ) : (
              <div className="flex flex-col gap-2.5">
                {prepared.map((s) => (
                  <SetupRow
                    key={s.id}
                    setup={s}
                    canStart={caps?.capture.mic ?? false}
                    onOpen={() => openSetup(s.id)}
                  />
                ))}
              </div>
            )}
          </section>

          {drafts.length > 0 && (
            <section>
              <Eyebrow className="mb-3.5">Draft setups</Eyebrow>
              <div className="flex flex-col gap-2.5">
                {drafts.map((s) => (
                  <div
                    key={s.id}
                    className="flex flex-wrap items-center gap-4 rounded-lg border border-dashed border-border-strong bg-panel px-[18px] py-4"
                  >
                    <span
                      className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-panel-raised text-fg-muted"
                      aria-hidden
                    >
                      <LockedIcon name="nav-coaching" size={22} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-bold leading-tight text-fg">
                        {s.title}
                      </span>
                      <span className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 font-mono text-xs">
                        <span className="text-primary">{s.modeLabel}</span>
                        <span className="text-fg-faint" aria-hidden>
                          ·
                        </span>
                        <span className="text-notice">{s.missing}</span>
                      </span>
                    </div>
                    <SecondaryButton onClick={() => openSetup(s.id)}>
                      Continue setup
                      <Icon name="chevron" size={15} className="-rotate-90" />
                    </SecondaryButton>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section>
            <Eyebrow className="mb-3.5">Recent coaching sessions</Eyebrow>
            {sessions.length === 0 ? (
              <EmptyState
                title="No coaching sessions yet"
                description="Start a session from a prepared setup and it will show up here with its transcript."
              />
            ) : (
              <Panel className="overflow-hidden">
                {sessions.slice(0, 6).map((s, i) => (
                  <div
                    key={s.id}
                    className={`flex flex-wrap items-center gap-3.5 px-[18px] py-3.5 ${
                      i > 0 ? "border-t border-border" : ""
                    }`}
                  >
                    <span
                      className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-[var(--radius)] bg-primary/10 text-primary"
                      aria-hidden
                    >
                      <LockedIcon name="nav-coaching" size={18} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold leading-tight text-fg">
                        {s.title}
                      </span>
                      <span className="mt-1 block font-mono text-[11px] text-fg-faint">
                        {s.segmentCount} exchange{s.segmentCount === 1 ? "" : "s"}
                      </span>
                    </span>
                    <span className="shrink-0 font-mono text-[11px] text-fg-faint">
                      {formatRelativeTime(s.startedAtUnixMs)}
                    </span>
                  </div>
                ))}
              </Panel>
            )}
            {/* No analytics here — decision 7. See this file's header. */}
          </section>

          <section>
            <Eyebrow className="mb-3.5">
              Practice templates{" "}
              <span className="font-sans text-[11px] font-medium normal-case tracking-normal text-fg-faint">
                · generic starters for a new setup
              </span>
            </Eyebrow>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {PRACTICE_TEMPLATES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setCreating(t)}
                  className="flex items-center gap-3 rounded-lg border border-border bg-panel px-4 py-3.5 text-left transition hover:border-border-strong hover:bg-panel-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                >
                  <span
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius)] bg-panel-raised text-fg-muted"
                    aria-hidden
                  >
                    <LockedIcon name="nav-coaching" size={20} />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold text-fg">
                    {t.name}
                  </span>
                  <span className="shrink-0 text-xs font-semibold text-primary">Use</span>
                </button>
              ))}
            </div>
          </section>
        </>
      )}
    </PageView>
  );
}

function SetupRow({
  setup,
  canStart,
  onOpen,
}: {
  setup: CoachingSetup;
  canStart: boolean;
  onOpen: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-4 rounded-lg border border-border bg-panel px-[18px] py-4">
      <span
        className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"
        aria-hidden
      >
        <LockedIcon name="nav-coaching" size={22} />
      </span>
      <div className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-bold leading-tight text-fg">
          {setup.title}
        </span>
        <span className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 font-mono text-xs text-fg-muted">
          <span className="text-primary">{setup.modeLabel}</span>
          {setup.personaTitle && (
            <>
              <span className="text-fg-faint" aria-hidden>
                ·
              </span>
              <span>{setup.personaTitle} persona</span>
            </>
          )}
          <span className="text-fg-faint" aria-hidden>
            ·
          </span>
          <span>
            {setup.sourceDocCount} source{setup.sourceDocCount === 1 ? "" : "s"}
          </span>
        </span>
      </div>
      {setup.stale && <StatusPill tone="notice">Stale</StatusPill>}
      <SecondaryButton
        onClick={onOpen}
        title={
          canStart
            ? "Open this setup to start a coaching session"
            : "Coaching sessions need audio capture — open the desktop app"
        }
      >
        {canStart ? "Start session" : "Open setup"}
        <Icon name="chevron" size={15} className="-rotate-90" />
      </SecondaryButton>
    </div>
  );
}

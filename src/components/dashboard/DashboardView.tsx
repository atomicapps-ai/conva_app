import { useCallback, useEffect, useMemo, useState } from "react";

import fieldArtwork from "@/assets/brand/raster/conva-intelligence-field-reference@2x.png";
import { CATEGORY_ICON } from "@/components/contexts/ContextsPane";
import {
  addedThisWeek,
  heroState,
  type HeroState,
} from "@/components/dashboard/homeState";
import {
  EmptyState,
  ErrorState,
  Eyebrow,
  Panel,
  PageView,
  PrimaryButton,
  SecondaryButton,
  Skeleton,
  StartListeningButton,
  StatusPill,
} from "@/components/studio/PageView";
import { Icon, type IconName } from "@/components/ui/Icon";
import { ListRow } from "@/components/ui/ListRow";
import { LockedIcon, LockedMarkBadge } from "@/components/ui/LockedIcon";
import { greetingFor } from "@/lib/account";
import { useBackend } from "@/lib/backend";
import { useCapabilities } from "@/lib/backend/context";
import {
  DEFAULT_CONTEXT_ID,
  type ContextSummary,
  type ConversationSummary,
  type RagDocument,
} from "@/lib/ipc";
import { formatTranscriptForViewer } from "@/lib/formatTranscript";
import { formatRelativeTime } from "@/lib/relativeTime";
import { useAccount } from "@/lib/useAccount";
import { useAppStore } from "@/state/app";
import { useContextsQuickOpen } from "@/state/contextsQuickOpen";
import { useConversationStore } from "@/state/conversation";
import { useGroundingStore } from "@/state/grounding";
import { useLibraryQuickAdd } from "@/state/libraryQuickAdd";
import { useNavStore } from "@/state/nav";

/**
 * Home — the readiness dashboard (AppUI V5.0 §2).
 *
 * > Answers three things in one scan: is Conva ready now, which context will
 * > it use, and what to resume next. One solid azure primary — Start
 * > Listening. **Every metric is real or omitted.**
 *
 * That last clause is the rule this file lives by (owner decision 7). Every
 * number below is measured from the backend — context count, source-document
 * count, library size, "added this week" — and when a number isn't knowable
 * the whole stat is dropped rather than filled in. There is no fixture data
 * in this component; "Maya Chen · Senior Product Manager · 42 prepared Q&A"
 * belongs to the design package and to `lib/fixtures/`, not here.
 *
 * The hero artwork is the locked intelligence field: right-aligned at its
 * intrinsic aspect ratio, ≤359×147, with the **complete incoming tail and the
 * empty left lead-in preserved** and blended into the hero's own ground. The
 * hero panel supplies the ONLY border — the image has none, and is never
 * cropped, recolored, or redrawn.
 */
export function DashboardView() {
  const backend = useBackend();
  const caps = useCapabilities();
  const setView = useNavStore((s) => s.setView);
  const openConversationInStore = useConversationStore((s) => s.openConversation);
  const { account } = useAccount();
  const activeId = useGroundingStore((s) => s.activeId);
  const startSession = useAppStore((s) => s.start);
  const sessionBusy = useAppStore((s) => s.busy);

  const [contexts, setContexts] = useState<ContextSummary[]>([]);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [documents, setDocuments] = useState<RagDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  /** Prepared Q&A pairs for the hero context — counted, never guessed. */
  const [preparedQa, setPreparedQa] = useState<number | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      backend.context.list(),
      backend.conversations.list(),
      backend.rag.list(),
    ])
      .then(([ctx, convs, docs]) => {
        setContexts(ctx);
        setConversations(convs);
        setDocuments(docs);
        setError(null);
      })
      .catch(() =>
        setError(
          "Conva couldn't read your contexts and library. They run on the desktop app for now.",
        ),
      )
      .finally(() => setLoading(false));
  }, [backend]);

  useEffect(load, [load]);

  const hero = heroState({
    loading,
    error,
    contexts,
    documentCount: documents.length,
    activeId,
    generatingId,
    failure,
  });

  // Count the prepared Q&A for the hero context by parsing its generated Q&A
  // document — the same parser the Live cockpit's Prep mode uses. If there is
  // no Q&A document, the stat is omitted entirely (never shown as 0-as-value
  // or invented).
  const heroContextId = hero.kind === "active" ? hero.context.id : null;
  useEffect(() => {
    if (!heroContextId) {
      setPreparedQa(null);
      return;
    }
    let live = true;
    void (async () => {
      try {
        const full = await backend.context.load(heroContextId);
        if (!full.qa_doc_id) {
          if (live) setPreparedQa(null);
          return;
        }
        const text = await backend.rag.documentText(full.qa_doc_id);
        if (!text) {
          if (live) setPreparedQa(null);
          return;
        }
        const { parseQaPairs } = await import("@/components/transcript/qaPairs");
        const pairs = parseQaPairs(text, "ally");
        if (live) setPreparedQa(pairs.length > 0 ? pairs.length : null);
      } catch {
        if (live) setPreparedQa(null);
      }
    })();
    return () => {
      live = false;
    };
  }, [backend, heroContextId]);

  const openContext = (id?: string) => {
    if (id) useContextsQuickOpen.getState().request(id);
    setView("context");
  };

  // Open a Recent-conversations row in the Live cockpit (owner bug report,
  // 2026-09-04: clicking a row here only navigated to the Conversations
  // page — it never actually loaded the conversation into the bubbles, the
  // way the same row click already does on the Conversations page itself,
  // `ConversationsPanel.tsx`'s `open`). Same fix here: load the full
  // record into the conversation store, then navigate.
  const openConversation = async (id: string) => {
    try {
      openConversationInStore(await backend.conversations.load(id));
      setView("live");
    } catch {
      /* best-effort — the row stays clickable, nothing else to degrade to */
    }
  };

  // Read-only transcript viewer (owner request, 2026-09-04) — same partner-
  // window surface every other "open in viewer" affordance in the app uses
  // (CLAUDE.md rule 10, "it IS the viewer"); falls back to opening in Live
  // on web (no partner window) rather than inventing a second surface.
  const openConversationViewer = async (id: string, title: string) => {
    try {
      if (!caps?.system.partnerWindow) return void (await openConversation(id));
      const conv = await backend.conversations.load(id);
      await backend.partner.open(title, null, null, formatTranscriptForViewer(conv.segments), []);
    } catch {
      /* best-effort, see openConversation above */
    }
  };

  const startListening = () => {
    setView("live");
    void startSession();
  };

  const retryGeneration = async (id: string) => {
    setGeneratingId(id);
    setFailure(null);
    try {
      await backend.context.prepare(id);
      await backend.context.generateDossier(id);
    } catch (e) {
      setFailure(String(e));
    } finally {
      setGeneratingId(null);
      load();
    }
  };

  const userContexts = useMemo(
    () => contexts.filter((c) => c.id !== DEFAULT_CONTEXT_ID),
    [contexts],
  );

  // Capture is what "ready to listen" actually means — branch on the
  // capability, never on `isTauri` (AGENTS.md).
  const canListen = caps?.capture.mic ?? false;

  return (
    <PageView
      large
      title={`${greetingFor()}${account.signedIn ? `, ${firstName(account.displayName)}` : ""}`}
      subtitle={
        canListen
          ? "Your conversation intelligence is ready."
          : "This surface can't capture audio — open the desktop app to listen to a call."
      }
      actions={
        <StartListeningButton
          onClick={startListening}
          disabled={!canListen || sessionBusy}
        />
      }
    >
      <Hero
        state={hero}
        preparedQa={preparedQa}
        onOpenContext={openContext}
        onChooseContext={() => setView("context")}
        onCreateContext={() => {
          useLibraryQuickAdd.getState().request("new_context");
          setView("context");
        }}
        onAddDocuments={() => {
          useLibraryQuickAdd.getState().request("upload");
          setView("library");
        }}
        onRetry={retryGeneration}
        onReload={load}
      />

      <div className="grid gap-4 min-[960px]:grid-cols-[1.5fr_1fr]">
        <Panel className="p-4">
          <div className="mb-2 flex items-center justify-between gap-3">
            <h3 className="text-[15px] font-bold leading-none text-fg">Recent conversations</h3>
            {/* Always shown once loaded (not gated on conversations.length) —
                it's the only way back to history from Home when nothing's
                been named yet, and backend.sessions.list() may still have
                real content behind it even at zero saved conversations. */}
            {!loading && <ViewAll label="View all" onClick={() => setView("conversations")} />}
          </div>
          {loading ? (
            <Skeleton rows={3} />
          ) : conversations.length === 0 ? (
            <EmptyState
              title="No conversations yet"
              description="Saved calls land here once you name one. Your raw session log is still there:"
              action={
                <ViewAll label="View all activity" onClick={() => setView("conversations")} />
              }
            />
          ) : (
            <div className="flex flex-col gap-1">
              {conversations.slice(0, 3).map((c) => (
                <ListRow
                  key={c.id}
                  accent="primary"
                  icon={{ icon: "live", color: "var(--color-primary)" }}
                  title={c.title}
                  date={formatRelativeTime(c.updated_at_unix_ms)}
                  onOpenViewer={() => void openConversationViewer(c.id, c.title)}
                  onOpenLive={() => void openConversation(c.id)}
                  onClick={() => void openConversation(c.id)}
                />
              ))}
            </div>
          )}
        </Panel>

        <Panel className="p-4">
          <div className="mb-2 flex items-center justify-between gap-3">
            <h3 className="text-[15px] font-bold leading-none text-fg">Contexts</h3>
            {!loading && userContexts.length > 0 && (
              <ViewAll label="View all" onClick={() => setView("context")} />
            )}
          </div>
          {loading ? (
            <Skeleton rows={3} />
          ) : userContexts.length === 0 ? (
            <EmptyState
              title="No contexts yet"
              description="Create one to prepare for a conversation."
              action={
                <PrimaryButton
                  onClick={() => {
                    useLibraryQuickAdd.getState().request("new_context");
                    setView("context");
                  }}
                >
                  Create context
                </PrimaryButton>
              }
            />
          ) : (
            <div className="flex flex-col gap-1">
              {userContexts.slice(0, 3).map((c) => (
                <ListRow
                  key={c.id}
                  accent="ai"
                  icon={CATEGORY_ICON[c.category]}
                  title={c.title}
                  date={formatRelativeTime(c.updated_at_unix_ms)}
                  onClick={() => openContext(c.id)}
                />
              ))}
            </div>
          )}
        </Panel>
      </div>

      <Panel className="flex flex-wrap items-center gap-4 px-6 py-5">
        {/* Sized to match the ListRow icon chip below, not a bespoke size of
            its own — same 16%-tint treatment (owner, 2026-09-02: "align the
            icon with the recent conversations..."; owner, 2026-09-03: "all
            of the icons should be much larger, nearly the height of the
            row they are in" — 28px chip, 18px glyph, same as ListRow's). */}
        <span
          className="grid h-[28px] w-[28px] shrink-0 place-items-center rounded-md bg-primary/[0.16] text-primary"
          aria-hidden
        >
          <LockedIcon name="nav-library" size={18} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-bold leading-tight text-fg">Library</span>
          <span className="mt-1 block font-mono text-xs text-fg-faint">
            {loading
              ? "…"
              : documents.length === 0
                ? "No documents yet"
                : `${documents.length} document${documents.length === 1 ? "" : "s"}${
                    addedThisWeek(documents) > 0
                      ? ` · ${addedThisWeek(documents)} added this week`
                      : ""
                  }`}
          </span>
        </span>
        <SecondaryButton onClick={() => setView("library")}>
          Open Library
          <Icon name="chevron" size={15} className="-rotate-90" />
        </SecondaryButton>
      </Panel>

      {/* conva Lite honesty — the Layer-4 features a browser tab can't do,
          named plainly, with the way to get them. Kept from the pre-V5 Home
          (it isn't in the mockup because the mockup only draws the desktop
          app); gated on the CAPABILITY, not on `isTauri`. */}
      {caps && caps.capture.systemAudio === "none" && !caps.system.keyring && (
        <Panel className="p-5">
          <Eyebrow className="mb-1">Desktop superpowers</Eyebrow>
          <p className="mb-4 text-sm text-fg-muted">
            The desktop app hears both sides of the call and runs on-device.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <DesktopOnlyCard
              icon="system"
              title="Both-sides capture"
              desc="Hear the other party via system loopback"
            />
            <DesktopOnlyCard
              icon="compact"
              title="Incog & HUD"
              desc="Invisible overlay, on-device ASR, local-first"
            />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3 rounded-[var(--radius)] border border-dashed border-border-strong p-3.5">
            <p className="min-w-0 flex-1 text-xs text-fg-muted">
              <span className="font-bold text-fg">Get the desktop app</span> — the
              full conva: both-sides audio, on-device transcription, Incog.
            </p>
            <PrimaryButton onClick={() => void backend.auth.openUrl(DOWNLOAD_URL)}>
              Download for Windows
            </PrimaryButton>
          </div>
        </Panel>
      )}
    </PageView>
  );
}

/** Current Windows installers (roadmap 1.7 formalizes distribution). */
const DOWNLOAD_URL = "https://github.com/atomicapps-ai/conva_app/releases";

/** A Layer-4 capability this surface doesn't have — shown honestly, not
 *  hidden (web only; see the conva-Lite framing in CONVA_ARCHITECTURE.md). */
function DesktopOnlyCard({
  icon,
  title,
  desc,
}: {
  icon: IconName;
  title: string;
  desc: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-[var(--radius)] border border-border bg-panel-raised px-3.5 py-3 text-left">
      <span
        className="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius)] text-primary ring-1 ring-inset ring-primary/30"
        aria-hidden
      >
        <Icon name={icon} size={18} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-bold tracking-tight text-fg">{title}</span>
        <span className="block truncate text-[11px] text-fg-faint">{desc}</span>
      </span>
      <span className="pill pill-sm pill-accent shrink-0">Desktop</span>
    </div>
  );
}

/** "Maya Chen" → "Maya"; a single-word or email-derived name is used as-is. */
function firstName(displayName: string): string {
  return displayName.split(/\s+/)[0] || displayName;
}

function Hero({
  state,
  preparedQa,
  onOpenContext,
  onChooseContext,
  onCreateContext,
  onAddDocuments,
  onRetry,
  onReload,
}: {
  state: HeroState;
  preparedQa: number | null;
  onOpenContext: (id?: string) => void;
  onChooseContext: () => void;
  onCreateContext: () => void;
  onAddDocuments: () => void;
  onRetry: (id: string) => void;
  onReload: () => void;
}) {
  return (
    <section className="relative flex min-h-[150px] items-center gap-5 overflow-hidden rounded-lg border border-border bg-panel px-5 py-5">
      {/* The locked intelligence field. Right-aligned, intrinsic aspect ratio,
          capped at its 359×147 CSS maximum (scaled with the 2026-09-02 hero
          shrink — owner: "the general conversation banner can also lose some
          height at least .25 including padding"), complete tail + left
          lead-in intact (`object-position: right center` with
          `object-fit: contain` never crops it). No border on the image —
          this panel supplies the only one. `select-none`/`draggable=false`
          keep it from being dragged out as a file.

          It is HIDDEN below ~940px of window rather than shown behind the
          copy. The locked-artwork rules forbid cropping, masking, filtering or
          shrinking it to fit, and a narrow hero would otherwise run the
          headline straight across the waves — unreadable, and a violation of
          "the empty left lead-in must blend into the hero background and must
          not be cropped behind content". Not drawing it is the one honest
          option left; the hero keeps its full meaning without it. */}
      <img
        src={fieldArtwork}
        alt=""
        aria-hidden
        draggable={false}
        className="pointer-events-none absolute right-0 top-1/2 hidden h-[147px] w-[359px] max-w-full -translate-y-1/2 select-none object-contain object-right [@media(min-width:940px)]:block"
      />

      {state.kind === "loading" ? (
        <div className="relative flex-1">
          <Skeleton rows={4} className="max-w-[420px]" />
        </div>
      ) : state.kind === "error" ? (
        <div className="relative flex-1">
          <ErrorState
            title="Couldn't load your workspace"
            description={state.message}
            onRetry={onReload}
          />
        </div>
      ) : (
        <>
          {/* Blue-rimmed glowing badge around the mark (owner reference
              image, 2026-09-02): the border/glow trace the mark's OWN
              bubble silhouette, not a generic circle — a round badge
              wrapper was wrong (round-tripped, corrected same day). The
              bubble itself is dark; the "C" is bright — not the other way
              around. See `LockedMarkBadge` in `LockedIcon.tsx`. */}
          <span className="relative hidden h-20 w-20 shrink-0 items-center justify-center sm:flex" aria-hidden>
            <LockedMarkBadge size={80} />
          </span>
          <div className="relative min-w-0 flex-1">
            {state.kind === "starter" ? (
              <>
                <h3 className="text-2xl font-bold leading-tight tracking-[-0.01em] text-fg">
                  Set Conva up for your first conversation
                </h3>
                <p className="mt-3 max-w-[52ch] text-sm leading-relaxed text-fg-muted">
                  A Context tells Ally what the call is about; the Library is what
                  it answers from. You can still start listening right now —
                  Conva will use general conversation grounding.
                </p>
                <div className="mt-5 flex flex-wrap gap-3">
                  <PrimaryButton onClick={onCreateContext}>Create context</PrimaryButton>
                  <SecondaryButton onClick={onAddDocuments}>Add to Library</SecondaryButton>
                </div>
              </>
            ) : state.kind === "none" ? (
              <>
                <h3 className="text-2xl font-bold leading-tight tracking-[-0.01em] text-fg">
                  General conversation
                </h3>
                <p className="mt-3 max-w-[52ch] text-sm leading-relaxed text-fg-muted">
                  No context is grounding the next session. Conva will still
                  transcribe and answer — just without your prepared material.
                </p>
                <div className="mt-5 flex flex-wrap gap-3">
                  <SecondaryButton onClick={onChooseContext}>Choose a context</SecondaryButton>
                </div>
              </>
            ) : (
              <>
                <h3 className="truncate text-2xl font-bold leading-tight tracking-[-0.01em] text-fg">
                  {state.context.title}
                </h3>
                <div className="mt-3">
                  {state.kind === "generating" ? (
                    <StatusPill tone="progress">Preparing</StatusPill>
                  ) : state.kind === "failed" ? (
                    <StatusPill tone="error">Needs attention</StatusPill>
                  ) : state.readiness === "ready" ? (
                    <StatusPill tone="ready">Ready</StatusPill>
                  ) : state.readiness === "stale" ? (
                    <StatusPill tone="notice">Stale</StatusPill>
                  ) : (
                    <StatusPill tone="idle">Not prepared</StatusPill>
                  )}
                </div>

                {state.kind === "failed" ? (
                  <ErrorState
                    className="mt-4 max-w-[60ch]"
                    title="Generation failed"
                    description={
                      <>
                        Conva couldn&apos;t build this briefing. Your sources are
                        unchanged. <span className="text-fg-faint">{state.message}</span>
                      </>
                    }
                    onRetry={() => onRetry(state.context.id)}
                  />
                ) : (
                  <>
                    <div className="mt-4 flex flex-wrap items-center gap-x-8 gap-y-3">
                      <Stat icon="file" value={state.context.source_doc_count} label="source files" />
                      {preparedQa !== null && (
                        <Stat icon="question" value={preparedQa} label="prepared Q&A" divided />
                      )}
                      {state.kind === "generating" ? (
                        <span className="self-center border-l border-border-strong pl-8 font-mono text-xs text-fg-faint">
                          preparing resources…
                        </span>
                      ) : (
                        state.context.resources_generated_at_unix_ms != null && (
                          <span className="self-center border-l border-border-strong pl-8 font-mono text-xs text-fg-faint">
                            refreshed{" "}
                            {formatRelativeTime(state.context.resources_generated_at_unix_ms)}
                          </span>
                        )
                      )}
                    </div>
                    <div className="mt-5 flex flex-wrap items-center gap-3">
                      <SecondaryButton onClick={() => onOpenContext(state.context.id)}>
                        Open context
                      </SecondaryButton>
                      <button
                        type="button"
                        onClick={onChooseContext}
                        className="rounded-[var(--radius)] px-2 py-2 text-[13px] font-semibold text-fg-muted underline underline-offset-4 transition hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                      >
                        Change context
                      </button>
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </>
      )}
    </section>
  );
}

/** Reference image (2026-09-02): each stat carries a small leading icon —
 *  a file glyph for source files, a question-bubble glyph for prepared Q&A. */
function Stat({
  icon,
  value,
  label,
  divided = false,
}: {
  icon: IconName;
  value: number;
  label: string;
  divided?: boolean;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 ${divided ? "border-l border-border-strong pl-8" : ""}`}
    >
      <Icon name={icon} size={14} className="text-fg-faint" aria-hidden />
      <span className="text-[22px] font-bold leading-none text-primary">{value}</span>
      <span className="text-[13px] font-medium leading-none text-fg-muted">{label}</span>
    </span>
  );
}

/** A panel header's "see everything" link — lives beside the h3, top-right
 *  (owner screenshot feedback, 2026-09-02: "move this up and to the right"),
 *  not below the row list as a fourth row-shaped affordance. */
function ViewAll({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex shrink-0 items-center gap-0.5 rounded-[var(--radius)] px-1.5 py-1 text-[12px] font-semibold text-primary transition hover:brightness-125 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
    >
      {label}
      <Icon name="chevron" size={13} className="-rotate-90" />
    </button>
  );
}

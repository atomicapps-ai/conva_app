import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useBackend } from "@/lib/backend";
import { Notice, ViewShell } from "@/components/studio/ViewShell";
import { Icon } from "@/components/ui/Icon";
import { ListRow } from "@/components/ui/ListRow";
import {
  DEFAULT_CONTEXT_ID,
  type Conversation,
  type ConversationSummary,
  type RagDocument,
  type SessionSummary,
  type ContextSummary,
  type TranscriptSegment,
} from "@/lib/ipc";
import { groupTurns } from "@/lib/turns";
import { useConversationStore } from "@/state/conversation";
import { useContextsQuickOpen } from "@/state/contextsQuickOpen";
import { useNavStore } from "@/state/nav";
import { useTranscriptStore } from "@/state/transcript";
import { useTranscriptJump } from "@/state/transcriptJump";

function formatDate(unixMs: number): string {
  if (!unixMs) return "—";
  return new Date(unixMs).toLocaleString();
}

const STATUS_LABEL: Record<ContextSummary["status"], string> = {
  draft: "Draft",
  ingesting: "Preparing…",
  ready: "Ready",
  running: "Running",
  ended: "Ended",
};

type Filter = "saved" | "all" | "rehearse" | "search";

// Order + default + labels per owner, 2026-08-17: All activity leads (it's
// the honest default — everything, saved or not) and is what the page opens
// on; History (was "Saved") and Rehearsals (was "Rehearse") follow. Search is
// new the same day (owner request — file/context/keyword search across
// transcripts). Filter `key`s for the first three stay as-is — only the
// order and copy changed, so nothing else in this file (or anything reading
// `filter`) needed to change for those.
const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All activity" },
  { key: "saved", label: "History" },
  { key: "rehearse", label: "Rehearsals" },
  { key: "search", label: "Search" },
];

type Row =
  | { kind: "conversation"; id: string; ts: number; data: ConversationSummary }
  | { kind: "session"; id: string; ts: number; data: SessionSummary };

/** One search hit: a matched turn inside one conversation/session, with a
 *  short excerpt around the match for the results list. */
interface SearchHit {
  rowKind: "conversation" | "session";
  rowId: string;
  rowTitle: string;
  rowTs: number;
  /** Turn key to scroll to + flash once the transcript is open — see
   *  `state/transcriptJump.ts` and `lib/turns.ts`. */
  turnKey: string;
  before: string;
  match: string;
  after: string;
}

const SNIPPET_WORDS = 6;
const MAX_SEARCH_CANDIDATES = 150;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Build a "few words either side" excerpt around the first match of `query`
 *  in `text` (owner spec: "a few words from the bubble near where it
 *  matched"), case-insensitive. Returns null if `text` doesn't match. */
function excerpt(
  text: string,
  query: string,
): { before: string; match: string; after: string } | null {
  const re = new RegExp(escapeRegExp(query), "i");
  const m = re.exec(text);
  if (!m) return null;
  const words = text.split(/\s+/);
  // Find which word index the match starts in by walking cumulative length.
  let idx = 0;
  let acc = 0;
  for (let i = 0; i < words.length; i++) {
    const wordEnd = acc + words[i]!.length;
    if (m.index < wordEnd + 1) {
      idx = i;
      break;
    }
    acc = wordEnd + 1; // +1 for the space
  }
  const start = Math.max(0, idx - SNIPPET_WORDS);
  const end = Math.min(words.length, idx + SNIPPET_WORDS + 1);
  return {
    before: (start > 0 ? "…" : "") + words.slice(start, idx).join(" "),
    match: m[0],
    after:
      words.slice(idx, end).join(" ").slice(m[0].length).trimStart() +
      (end < words.length ? "…" : ""),
  };
}

const MAX_HITS_PER_ROW = 5;

/** Scan one row's full segments for turns matching `query` (up to
 *  `MAX_HITS_PER_ROW`, so one chatty conversation can't flood the results
 *  list). Turn keys come from the shared `groupTurns` — the same grouping
 *  TranscriptView renders — so every hit is guaranteed scrollable-to. */
function findMatches(
  segments: TranscriptSegment[],
  query: string,
): { turnKey: string; before: string; match: string; after: string }[] {
  const hits: { turnKey: string; before: string; match: string; after: string }[] = [];
  for (const turn of groupTurns(segments)) {
    if (hits.length >= MAX_HITS_PER_ROW) break;
    const text = turn.segments
      .map((s) => s.text)
      .join(" ")
      .trim();
    if (!text) continue;
    const hit = excerpt(text, query);
    if (hit) hits.push({ turnKey: turn.key, ...hit });
  }
  return hits;
}

/**
 * Open/save menu for conversations (owner request) — merged with the former
 * standalone "History" rail page (owner decision, 2026-08-17): every
 * listening run is still logged automatically underneath, unchanged
 * (`session.rs`/`backend.sessions`), but it stopped being a second rail
 * destination competing with this one for the same "reopen something I
 * listened to" job — nothing in the UI explained the difference between
 * them, which is exactly why it read as two menu items for one thing.
 *
 * "Saved" (default) shows only what you've explicitly named — the original
 * Conversations behavior, unchanged. "All activity" additionally pulls in
 * the raw, unnamed sessions (ex-History) and interleaves both lists by
 * time, so the page reads as one activity feed instead of two disjoint
 * ones. Sessions carry an "Unsaved" pill and have no delete action (they're
 * an automatic log, not a user record); conversations keep their existing
 * delete/rename-by-resave behavior.
 *
 * "Rehearse" (owner decision, 2026-08-17) lists Contexts instead — picking
 * one jumps straight to its detail page (personas → start rehearsal) via
 * `state/contextsQuickOpen.ts`'s one-shot intent. Grouped here rather than
 * given its own rail item because rehearsing IS a kind of conversation (it
 * saves as one, tagged Context rehearsal, and shows up right there in "All
 * activity") — Contexts is the prep material, this tab is the act of
 * using it. The always-present default context is excluded; there's
 * nothing to rehearse against without a real context's personas.
 *
 * "Search" (owner request, 2026-08-17) scopes a keyword search by file
 * and/or context, then lists matched turns as snippet results — click one to
 * open its conversation/session and land on that exact bubble, scrolled +
 * flashed + highlighted (`state/transcriptJump.ts`). No backend full-text
 * index exists yet, so this is a client-side scan: candidates are narrowed
 * by the file/context scope first, their full segments are fetched (and
 * cached in-memory for the session) only once a query is typed, then
 * scanned in JS. Fine at today's per-user conversation counts; if that stops
 * being true, the fix is a backend index, not a bigger client-side scan.
 *
 * The "context" scope is necessarily approximate: a conversation doesn't
 * record which Context grounded it (only `linked_docs`), so it qualifies via
 * its linked docs being attached to that Context; a rehearsal session
 * qualifies by its `simcon_title` matching the Context's title. Both are
 * best-effort matches, not a stored link — a real fix needs a backend
 * schema change (out of scope here).
 */
export function ConversationsPanel({ onClose }: { onClose: () => void }) {
  const backend = useBackend();
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [contexts, setContexts] = useState<ContextSummary[]>([]);
  const [docs, setDocs] = useState<RagDocument[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [analyzing, setAnalyzing] = useState(false);
  const openId = useConversationStore((s) => s.openId);
  const title = useConversationStore((s) => s.title);
  const notice = useConversationStore((s) => s.notice);
  const setNotice = useConversationStore((s) => s.setNotice);
  const openConversation = useConversationStore((s) => s.openConversation);
  const newConversation = useConversationStore((s) => s.newConversation);
  const setSavePromptOpen = useConversationStore((s) => s.setSavePromptOpen);
  const loadPastSession = useTranscriptStore((s) => s.loadPastSession);
  const liveSegments = useTranscriptStore((s) => s.segments);
  const archived = useTranscriptStore((s) => s.archived);
  const shownSegments = [...archived, ...liveSegments];
  const viewingSession = useTranscriptStore((s) => s.viewingPastSessionId);
  const setView = useNavStore((s) => s.setView);

  // Search (owner request, 2026-08-17). Query text + optional file/context
  // scope; results are computed by the debounced effect below. Full
  // conversation/session bodies are fetched lazily and cached per row id so
  // re-running or widening a query doesn't re-fetch what's already local.
  const [searchQuery, setSearchQuery] = useState("");
  const [fileScope, setFileScope] = useState("");
  const [contextScope, setContextScope] = useState("");
  const [searchHits, setSearchHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchTruncated, setSearchTruncated] = useState(false);
  const convoBodyCache = useRef(new Map<string, Conversation>());
  const sessionBodyCache = useRef(new Map<string, TranscriptSegment[]>());

  const refresh = useCallback(async () => {
    try {
      const [c, s, x, d] = await Promise.all([
        backend.conversations.list(),
        backend.sessions.list(),
        backend.context.list(),
        backend.rag.list(),
      ]);
      setConversations(c);
      setSessions(s);
      setContexts(x.filter((ctx) => ctx.id !== DEFAULT_CONTEXT_ID));
      setDocs(d);
    } catch (e) {
      setNotice(String(e));
    }
  }, [backend, setNotice]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Candidate rows for search — every conversation + session, independent of
  // the currently-selected list filter (search is its own mode).
  const allRows: Row[] = useMemo(
    () =>
      [
        ...conversations.map(
          (c): Row => ({ kind: "conversation", id: c.id, ts: c.updated_at_unix_ms, data: c }),
        ),
        ...sessions.map(
          (s): Row => ({ kind: "session", id: s.id, ts: s.started_at_unix_ms, data: s }),
        ),
      ].sort((a, b) => b.ts - a.ts),
    [conversations, sessions],
  );

  // Doc ids attached to the selected context scope, for the approximate
  // conversation→context match (see the class doc comment above).
  const docsInContextScope = useMemo(() => {
    if (!contextScope) return null;
    return new Set(docs.filter((d) => d.context_ids.includes(contextScope)).map((d) => d.id));
  }, [docs, contextScope]);
  const contextScopeTitle = contexts.find((c) => c.id === contextScope)?.title ?? null;

  const inScope = useCallback(
    (row: Row): boolean => {
      if (fileScope) {
        if (row.kind !== "conversation") return false;
        if (!row.data.linked_docs.includes(fileScope)) return false;
      }
      if (docsInContextScope) {
        if (row.kind === "conversation") {
          if (!row.data.linked_docs.some((id) => docsInContextScope.has(id))) return false;
        } else if (!row.data.is_rehearsal || row.data.simcon_title !== contextScopeTitle) {
          return false;
        }
      }
      return true;
    },
    [fileScope, docsInContextScope, contextScopeTitle],
  );

  // Debounced keyword scan — narrows candidates by scope, lazily fetches
  // (and caches) their full segments, then matches client-side.
  useEffect(() => {
    if (filter !== "search") return;
    const q = searchQuery.trim();
    if (q.length < 2) {
      setSearchHits([]);
      setSearchTruncated(false);
      return;
    }
    let cancelled = false;
    const t = setTimeout(() => {
      void (async () => {
        setSearching(true);
        try {
          const candidates = allRows.filter(inScope);
          const truncated = candidates.length > MAX_SEARCH_CANDIDATES;
          const scanned = candidates.slice(0, MAX_SEARCH_CANDIDATES);
          const bodies = await Promise.all(
            scanned.map(async (row): Promise<TranscriptSegment[]> => {
              if (row.kind === "conversation") {
                const cached = convoBodyCache.current.get(row.id);
                if (cached) return cached.segments;
                const full = await backend.conversations.load(row.id);
                convoBodyCache.current.set(row.id, full);
                return full.segments;
              }
              const cached = sessionBodyCache.current.get(row.id);
              if (cached) return cached;
              const full = await backend.sessions.load(row.id);
              sessionBodyCache.current.set(row.id, full);
              return full;
            }),
          );
          if (cancelled) return;
          const hits: SearchHit[] = [];
          scanned.forEach((row, i) => {
            const rowTitle =
              row.kind === "conversation" ? row.data.title : row.data.preview || "(empty)";
            for (const m of findMatches(bodies[i]!, q)) {
              hits.push({ rowKind: row.kind, rowId: row.id, rowTitle, rowTs: row.ts, ...m });
            }
          });
          setSearchHits(hits);
          setSearchTruncated(truncated);
        } catch (e) {
          if (!cancelled) setNotice(String(e));
        } finally {
          if (!cancelled) setSearching(false);
        }
      })();
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [filter, searchQuery, allRows, inScope, backend, setNotice]);

  const openSearchHit = async (hit: SearchHit) => {
    try {
      if (hit.rowKind === "conversation") {
        const cached = convoBodyCache.current.get(hit.rowId);
        openConversation(cached ?? (await backend.conversations.load(hit.rowId)));
      } else {
        const cached = sessionBodyCache.current.get(hit.rowId);
        loadPastSession(hit.rowId, cached ?? (await backend.sessions.load(hit.rowId)));
      }
      useTranscriptJump.getState().request(hit.turnKey, searchQuery.trim());
      setView("live");
      onClose();
    } catch (e) {
      setNotice(String(e));
    }
  };

  const open = async (id: string) => {
    try {
      openConversation(await backend.conversations.load(id));
      onClose();
    } catch (e) {
      setNotice(String(e));
    }
  };

  const openPastSession = async (id: string) => {
    try {
      loadPastSession(id, await backend.sessions.load(id));
      onClose();
    } catch (e) {
      setNotice(String(e));
    }
  };

  const rehearse = (id: string) => {
    useContextsQuickOpen.getState().request(id);
    setView("context");
  };

  const remove = async (id: string) => {
    try {
      await backend.conversations.delete(id);
      if (openId === id) newConversation();
      await refresh();
    } catch (e) {
      setNotice(String(e));
    }
  };

  const deleteSelected = async () => {
    const ids = Array.from(selected);
    try {
      await Promise.all(
        ids.map((key) =>
          key.startsWith("c-")
            ? backend.conversations.delete(key.slice(2))
            : backend.sessions.delete(key.slice(2)),
        ),
      );
    } catch (e) {
      setNotice(String(e));
    } finally {
      if (selected.has(`c-${openId}`)) newConversation();
      setSelected(new Set());
      await refresh();
    }
  };

  const exportShown = async () => {
    try {
      const { save } = await import("@tauri-apps/plugin-dialog");
      const path = await save({
        defaultPath: "conva-transcript.md",
        filters: [{ name: "Markdown", extensions: ["md"] }],
      });
      if (!path) return;
      await backend.sessions.exportTranscript(path, shownSegments);
      setNotice(`Exported to ${path}`);
    } catch (e) {
      setNotice(String(e));
    }
  };

  // Analytical performance report (spec 2026-08-26, Part B) — a distinct,
  // explicitly-requested LLM call, unlike the free instant transcript
  // export above. Same native save-dialog flow as `exportShown`:
  // `analyzeConversation` returns Markdown text (it doesn't write a file
  // itself, unlike `exportTranscript`), so it's written via the generic
  // `sessions.writeTextFile` counterpart to the caller-chosen path.
  const analyzeAndDownload = async () => {
    if (!openId) return;
    setAnalyzing(true);
    try {
      const report = await backend.sessions.analyzeConversation(openId);
      const { save } = await import("@tauri-apps/plugin-dialog");
      const path = await save({
        defaultPath: "conva-analysis.md",
        filters: [{ name: "Markdown", extensions: ["md"] }],
      });
      if (!path) return;
      await backend.sessions.writeTextFile(path, report);
      setNotice(`Analysis saved to ${path}`);
    } catch (e) {
      setNotice(String(e));
    } finally {
      setAnalyzing(false);
    }
  };

  // Merge + interleave by time for "All activity"; "Saved" stays exactly the
  // original conversations-only list/order.
  const rows: Row[] =
    filter === "saved"
      ? conversations.map((c) => ({
          kind: "conversation",
          id: c.id,
          ts: c.updated_at_unix_ms,
          data: c,
        }))
      : allRows;

  return (
    <ViewShell
      icon="conversations"
      title="Conversations"
      subtitle="Every listening run is saved automatically — name one to keep it as a conversation you can reopen and continue."
      badge={
        openId ? (
          <span className="pill pill-sm pill-ally max-w-[14rem] truncate">open: {title}</span>
        ) : viewingSession ? (
          <span className="pill pill-sm pill-ally">viewing past session</span>
        ) : undefined
      }
      actions={
        <>
          <button
            type="button"
            disabled={shownSegments.length === 0}
            onClick={() => void exportShown()}
            title="Export shown transcript…"
            aria-label="Export shown transcript"
            className="rounded-sm p-1.5 text-fg-faint transition hover:bg-panel-raised/60 hover:text-fg disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-fg-faint"
          >
            <Icon name="download" size={16} />
          </button>
          <button
            type="button"
            onClick={() => void analyzeAndDownload()}
            disabled={analyzing || !openId}
            title="Analyze performance & download…"
            aria-label="Analyze performance and download"
            className="rounded-sm p-1.5 text-ai transition hover:bg-ai/10 disabled:opacity-40"
          >
            <Icon name={analyzing ? "sparkle" : "ally"} size={16} />
          </button>
          <button
            type="button"
            onClick={() => setSavePromptOpen(true)}
            title="Save current conversation…"
            aria-label="Save current conversation"
            className="rounded-sm p-1.5 text-ai transition hover:bg-ai/10"
          >
            <Icon name="save" size={16} />
          </button>
          <button
            type="button"
            onClick={() => {
              newConversation();
              setNotice("Started a new conversation.");
            }}
            title="New conversation"
            aria-label="Start a new conversation"
            className="rounded-sm p-1.5 text-fg-faint transition hover:bg-panel-raised/60 hover:text-fg"
          >
            <Icon name="add" size={16} />
          </button>
        </>
      }
    >
      {notice && <Notice>{notice}</Notice>}

      <div className="mb-2 flex gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => {
              setFilter(f.key);
              setSelected(new Set());
            }}
            className={[
              "rounded-full border px-2 py-0.5 text-[11px] transition",
              filter === f.key
                ? "border-primary/50 bg-primary/[0.12] text-fg"
                : "border-border text-fg-faint hover:text-fg",
            ].join(" ")}
          >
            {f.label}
          </button>
        ))}
      </div>

      {filter === "search" ? (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <div className="relative min-w-0 flex-1">
              <Icon
                name="search"
                size={13}
                className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-fg-faint"
              />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search the transcript…"
                aria-label="Search conversations and sessions"
                className="w-full rounded-md border border-border bg-panel py-1 pl-6 pr-2 text-xs text-fg placeholder:text-fg-faint focus:outline-none focus:ring-1 focus:ring-primary/50"
              />
            </div>
            <select
              value={fileScope}
              onChange={(e) => setFileScope(e.target.value)}
              aria-label="Limit search to a file"
              className="max-w-[9rem] rounded-md border border-border bg-panel px-1.5 py-1 text-[11px] text-fg-muted focus:outline-none focus:ring-1 focus:ring-primary/50"
            >
              <option value="">Any file</option>
              {docs.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.file_name}
                </option>
              ))}
            </select>
            <select
              value={contextScope}
              onChange={(e) => setContextScope(e.target.value)}
              aria-label="Limit search to a context"
              className="max-w-[9rem] rounded-md border border-border bg-panel px-1.5 py-1 text-[11px] text-fg-muted focus:outline-none focus:ring-1 focus:ring-primary/50"
            >
              <option value="">Any context</option>
              {contexts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
          </div>

          {searchQuery.trim().length < 2 ? (
            <div className="card grid place-items-center px-6 py-16 text-center text-xs text-fg-faint">
              Type at least 2 characters to search — optionally narrow by file
              or context above first.
            </div>
          ) : searching ? (
            <div className="px-1 py-8 text-center text-xs text-fg-faint">Searching…</div>
          ) : searchHits.length === 0 ? (
            <div className="card grid place-items-center px-6 py-16 text-center text-xs text-fg-faint">
              No matches for “{searchQuery.trim()}”.
            </div>
          ) : (
            <>
              {searchTruncated && (
                <p className="px-1 text-[10px] text-fg-faint">
                  Showing matches from the {MAX_SEARCH_CANDIDATES} most recent items in scope —
                  narrow with a file or context filter to search further back.
                </p>
              )}
              <ul className="flex flex-col gap-1.5">
                {searchHits.map((hit, i) => (
                  <li key={`${hit.rowKind}-${hit.rowId}-${hit.turnKey}-${i}`}>
                    <button
                      type="button"
                      onClick={() => void openSearchHit(hit)}
                      className="row w-full flex-col items-start gap-0.5 border-l-[3px] !py-1.5"
                      style={{
                        borderLeftColor:
                          hit.rowKind === "conversation"
                            ? "var(--color-primary)"
                            : "var(--color-fg-faint)",
                      }}
                    >
                      <div className="flex w-full min-w-0 items-center gap-2">
                        <Icon
                          name={hit.rowKind === "conversation" ? "conversations" : "live"}
                          size={12}
                          className="shrink-0 text-fg-faint"
                        />
                        <span className="truncate text-[11px] font-semibold text-fg">
                          {hit.rowTitle}
                        </span>
                        <span className="ml-auto shrink-0 font-mono text-[10px] text-fg-faint">
                          {formatDate(hit.rowTs)}
                        </span>
                      </div>
                      <p className="w-full truncate text-left text-xs text-fg-muted">
                        {hit.before}{" "}
                        <mark className="rounded-[2px] bg-primary/25 px-0.5 text-fg">
                          {hit.match}
                        </mark>{" "}
                        {hit.after}
                      </p>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      ) : filter === "rehearse" ? (
        contexts.length === 0 ? (
          <div className="card grid place-items-center px-6 py-16 text-center text-xs text-fg-faint">
            No contexts yet — create one in Contexts, then come back here to
            rehearse against it.
          </div>
        ) : (
          <ul className="flex flex-col gap-1">
            {contexts.map((c) => (
              <li key={c.id}>
                <ListRow
                  accent="ai"
                  title={c.title}
                  badge={{ text: STATUS_LABEL[c.status], tone: "ai" }}
                  date={`${c.source_doc_count} doc${c.source_doc_count === 1 ? "" : "s"}`}
                  onClick={() => rehearse(c.id)}
                />
              </li>
            ))}
          </ul>
        )
      ) : rows.length === 0 ? (
        <div className="card grid place-items-center px-6 py-16 text-center text-xs text-fg-faint">
          {filter === "saved"
            ? "No saved conversations yet — press Stop after listening and choose Save, or use “Save current…”."
            : "Nothing recorded yet — start a live session to begin."}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <div
            className={`flex items-center justify-between gap-2 overflow-hidden rounded-md border px-2.5 transition-all ${
              selected.size > 0
                ? "h-[30px] border-rec/35 bg-rec/[0.12] opacity-100"
                : "h-0 border-transparent opacity-0"
            }`}
          >
            <span className="font-mono text-[11px] text-fg">{selected.size} selected</span>
            <span className="flex gap-2">
              <button
                type="button"
                onClick={() => setSelected(new Set())}
                className="text-[10.5px] font-bold text-fg-faint hover:text-fg"
              >
                Clear
              </button>
              <button
                type="button"
                onClick={() => void deleteSelected()}
                className="rounded bg-rec px-2 py-0.5 text-[10.5px] font-bold text-bg"
              >
                Delete selected
              </button>
            </span>
          </div>

          <ul className="flex flex-col gap-1">
            {rows.map((row) => {
              const key = row.kind === "conversation" ? `c-${row.id}` : `s-${row.id}`;
              const toggle = (checked: boolean) =>
                setSelected((prev) => {
                  const next = new Set(prev);
                  if (checked) next.add(key);
                  else next.delete(key);
                  return next;
                });
              if (row.kind === "conversation") {
                return (
                  <li key={key}>
                    <ListRow
                      accent="primary"
                      title={row.data.title}
                      date={`${formatDate(row.data.updated_at_unix_ms)} · ${row.data.segment_count} segment${row.data.segment_count === 1 ? "" : "s"}${row.data.linked_docs.length > 0 ? ` · ${row.data.linked_docs.length} linked doc(s)` : ""}`}
                      open={row.id === openId}
                      selected={selected.has(key)}
                      onSelectChange={toggle}
                      onDelete={() => void remove(row.id)}
                      onClick={() => void open(row.id)}
                    />
                  </li>
                );
              }
              return (
                <li key={key}>
                  <ListRow
                    accent={row.data.is_rehearsal ? "ai" : "muted"}
                    title={
                      row.data.is_rehearsal && row.data.simcon_title
                        ? row.data.simcon_title
                        : row.data.preview || "(empty)"
                    }
                    badge={
                      row.data.is_rehearsal
                        ? { text: "Context", tone: "ai" }
                        : { text: "Unsaved", tone: "muted" }
                    }
                    date={`${formatDate(row.data.started_at_unix_ms)} · ${row.data.segment_count} segment${row.data.segment_count === 1 ? "" : "s"}`}
                    selected={selected.has(key)}
                    onSelectChange={toggle}
                    onDelete={() => void backend.sessions.delete(row.id).then(refresh)}
                    onClick={() => void openPastSession(row.id)}
                  />
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </ViewShell>
  );
}

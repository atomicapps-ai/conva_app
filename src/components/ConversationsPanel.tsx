import { useCallback, useEffect, useState } from "react";

import { useBackend } from "@/lib/backend";
import { Notice, ViewShell } from "@/components/studio/ViewShell";
import { Icon } from "@/components/ui/Icon";
import type { ConversationSummary, SessionSummary } from "@/lib/ipc";
import { useConversationStore } from "@/state/conversation";
import { useTranscriptStore } from "@/state/transcript";

function formatDate(unixMs: number): string {
  if (!unixMs) return "—";
  return new Date(unixMs).toLocaleString();
}

type Filter = "saved" | "all";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "saved", label: "Saved" },
  { key: "all", label: "All activity" },
];

type Row =
  | { kind: "conversation"; id: string; ts: number; data: ConversationSummary }
  | { kind: "session"; id: string; ts: number; data: SessionSummary };

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
 */
export function ConversationsPanel({ onClose }: { onClose: () => void }) {
  const backend = useBackend();
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [filter, setFilter] = useState<Filter>("saved");
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

  const refresh = useCallback(async () => {
    try {
      const [c, s] = await Promise.all([
        backend.conversations.list(),
        backend.sessions.list(),
      ]);
      setConversations(c);
      setSessions(s);
    } catch (e) {
      setNotice(String(e));
    }
  }, [backend, setNotice]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

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

  const remove = async (id: string) => {
    try {
      await backend.conversations.delete(id);
      if (openId === id) newConversation();
      await refresh();
    } catch (e) {
      setNotice(String(e));
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
      : [
          ...conversations.map(
            (c): Row => ({ kind: "conversation", id: c.id, ts: c.updated_at_unix_ms, data: c }),
          ),
          ...sessions.map(
            (s): Row => ({ kind: "session", id: s.id, ts: s.started_at_unix_ms, data: s }),
          ),
        ].sort((a, b) => b.ts - a.ts);

  return (
    <ViewShell
      icon="conversations"
      title="Conversations"
      subtitle="Every listening run is saved automatically — name one to keep it as a conversation you can reopen and continue."
      onBack={onClose}
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
            onClick={() => setFilter(f.key)}
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

      {rows.length === 0 ? (
        <div className="card grid place-items-center px-6 py-16 text-center text-xs text-fg-faint">
          {filter === "saved"
            ? "No saved conversations yet — press Stop after listening and choose Save, or use “Save current…”."
            : "Nothing recorded yet — start a live session to begin."}
        </div>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {rows.map((row) =>
            row.kind === "conversation" ? (
              <li key={`c-${row.id}`} className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void open(row.id)}
                  className={`row min-w-0 flex-1 ${row.id === openId ? "border-ai/60" : ""}`}
                >
                  <span className="truncate text-xs text-fg">{row.data.title}</span>
                  <span className="font-mono text-[11px] text-fg-muted">
                    {formatDate(row.data.updated_at_unix_ms)}
                  </span>
                  <span className="ml-auto shrink-0 font-mono text-[10px] text-fg-faint">
                    {row.data.segment_count} segments
                    {row.data.linked_docs.length > 0 &&
                      ` · ${row.data.linked_docs.length} linked doc(s)`}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => void remove(row.id)}
                  aria-label={`Delete conversation ${row.data.title}`}
                  title="Delete"
                  className="shrink-0 rounded-sm p-1 text-fg-faint transition hover:bg-rec/10 hover:text-rec"
                >
                  <Icon name="trash" size={13} />
                </button>
              </li>
            ) : (
              <li key={`s-${row.id}`}>
                <button
                  type="button"
                  onClick={() => void openPastSession(row.id)}
                  className="row w-full"
                >
                  <span className="font-mono text-[11px] text-fg-muted">
                    {formatDate(row.data.started_at_unix_ms)}
                  </span>
                  {row.data.is_rehearsal && (
                    <span
                      title={
                        row.data.simcon_title
                          ? `Sim Con rehearsal: ${row.data.simcon_title}`
                          : "Sim Con rehearsal"
                      }
                      className="pill pill-sm pill-ally shrink-0"
                    >
                      Sim Con
                    </span>
                  )}
                  <span className="truncate text-xs text-fg">
                    {row.data.is_rehearsal && row.data.simcon_title
                      ? row.data.simcon_title
                      : row.data.preview || "(empty)"}
                  </span>
                  <span className="pill pill-sm pill-idle shrink-0">Unsaved</span>
                  <span className="ml-auto shrink-0 font-mono text-[10px] text-fg-faint">
                    {row.data.segment_count} segments
                  </span>
                </button>
              </li>
            ),
          )}
        </ul>
      )}
    </ViewShell>
  );
}

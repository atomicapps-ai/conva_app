import { useCallback, useEffect, useState } from "react";

import { useBackend } from "@/lib/backend";
import { Notice, ViewShell } from "@/components/studio/ViewShell";
import { Icon } from "@/components/ui/Icon";
import type { ConversationSummary } from "@/lib/ipc";
import { useConversationStore } from "@/state/conversation";

function formatDate(unixMs: number): string {
  if (!unixMs) return "—";
  return new Date(unixMs).toLocaleString();
}

/**
 * Open/save menu for named conversations (owner request): open one to view
 * and continue it (new runs append), save the current one, start fresh.
 */
export function ConversationsPanel({ onClose }: { onClose: () => void }) {
  const backend = useBackend();
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const openId = useConversationStore((s) => s.openId);
  const title = useConversationStore((s) => s.title);
  const notice = useConversationStore((s) => s.notice);
  const setNotice = useConversationStore((s) => s.setNotice);
  const openConversation = useConversationStore((s) => s.openConversation);
  const newConversation = useConversationStore((s) => s.newConversation);
  const setSavePromptOpen = useConversationStore((s) => s.setSavePromptOpen);

  const refresh = useCallback(async () => {
    try {
      setConversations(await backend.conversations.list());
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

  const remove = async (id: string) => {
    try {
      await backend.conversations.delete(id);
      if (openId === id) newConversation();
      await refresh();
    } catch (e) {
      setNotice(String(e));
    }
  };

  return (
    <ViewShell
      icon="conversations"
      title="Conversations"
      subtitle="Named threads you can reopen and continue — new listening runs append to the open one."
      badge={
        openId ? (
          <span className="max-w-[14rem] truncate rounded-full border border-ai/40 px-2 py-0.5 text-[10px] text-ai">
            open: {title}
          </span>
        ) : undefined
      }
      actions={
        <>
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
          <button type="button" onClick={onClose} className="btn">
            Done
          </button>
        </>
      }
    >
      {notice && <Notice>{notice}</Notice>}

      {conversations.length === 0 ? (
        <div className="card grid place-items-center px-6 py-16 text-center text-xs text-fg-faint">
          No saved conversations yet — press Stop after listening and choose
          Save, or use “Save current…”.
        </div>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {conversations.map((c) => (
            <li key={c.id} className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void open(c.id)}
                className={`row min-w-0 flex-1 ${c.id === openId ? "border-ai/60" : ""}`}
              >
                <span className="truncate text-xs text-fg">{c.title}</span>
                <span className="font-mono text-[11px] text-fg-muted">
                  {formatDate(c.updated_at_unix_ms)}
                </span>
                <span className="ml-auto shrink-0 font-mono text-[10px] text-fg-faint">
                  {c.segment_count} segments
                  {c.linked_docs.length > 0 &&
                    ` · ${c.linked_docs.length} linked doc(s)`}
                </span>
              </button>
              <button
                type="button"
                onClick={() => void remove(c.id)}
                aria-label={`Delete conversation ${c.title}`}
                title="Delete"
                className="shrink-0 rounded-sm p-1 text-fg-faint transition hover:bg-rec/10 hover:text-rec"
              >
                <Icon name="trash" size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </ViewShell>
  );
}

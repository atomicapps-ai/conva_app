import { useCallback, useEffect, useMemo, useState } from "react";

import { Icon } from "@/components/ui/Icon";
import { useBackend } from "@/lib/backend";
import type { RagDocument } from "@/lib/ipc";
import { isTauri } from "@/lib/ipc";
import { useConversationStore } from "@/state/conversation";

const SUPPORTED = ["pdf", "docx", "md", "markdown", "txt", "html", "htm"];
/** The custom drag payload MIME a library row carries — read by ContextsPane
 * rows to attach the dragged document (native HTML5 DnD, no OS file path). */
export const DOC_DRAG_MIME = "application/x-conva-doc-id";

/** Name a pasted note from its first non-empty line (else a fallback). */
function deriveNoteName(text: string): string {
  const firstLine = text
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (!firstLine) return "Pasted note";
  return firstLine.length > 60 ? `${firstLine.slice(0, 60)}…` : firstLine;
}

type Filter = "all" | "context" | "pasted" | "generated";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "context", label: "In this context" },
  { key: "pasted", label: "Pasted" },
  { key: "generated", label: "By conva" },
];

/**
 * The Library pane of the unified Contexts & Library page (Conversation
 * Context UI design): search + filter chips, drag-drop or pick files,
 * paste-as-note, and — new — each row is a native drag SOURCE carrying its
 * doc id, so dropping it on a context row (ContextsPane) attaches it.
 * `selectedContextId` narrows the "In this context" filter and labels the
 * paste/attach flow; `contextTitles` renders a doc's context tags by name.
 */
export function LibraryPane({
  selectedContextId,
  selectedContextTitle,
  contextTitles,
  onAttachToSelected,
  refreshToken,
}: {
  selectedContextId: string | null;
  selectedContextTitle: string | null;
  contextTitles: Record<string, string>;
  onAttachToSelected: (docId: string) => void;
  /** Bump this to force a refresh from outside (e.g. after generating). */
  refreshToken?: number;
}) {
  const backend = useBackend();
  const [documents, setDocuments] = useState<RagDocument[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const conversationOpen = useConversationStore((s) => s.openId !== null);
  const conversationTitle = useConversationStore((s) => s.title);
  const linkedDocs = useConversationStore((s) => s.linkedDocs);
  const toggleLinkedDoc = useConversationStore((s) => s.toggleLinkedDoc);

  const refresh = useCallback(async () => {
    try {
      setDocuments(await backend.rag.list());
    } catch (e) {
      setNotice(String(e));
    }
  }, [backend]);

  useEffect(() => {
    void refresh();
  }, [refresh, refreshToken]);

  const ingest = useCallback(
    async (paths: string[]) => {
      const usable = paths.filter((p) =>
        SUPPORTED.includes(p.split(".").pop()?.toLowerCase() ?? ""),
      );
      if (usable.length === 0) {
        setNotice("No supported files (pdf, docx, md, txt, html).");
        return;
      }
      setBusy(true);
      setNotice(`Adding ${usable.length} file(s)…`);
      try {
        const reports = await backend.rag.ingest(usable);
        const warnings = reports.flatMap((r) => r.warnings);
        setNotice(
          warnings.length > 0
            ? `Done with warnings: ${warnings.join("; ")}`
            : `Added ${reports.length} document(s).`,
        );
        await refresh();
      } catch (e) {
        setNotice(String(e));
      } finally {
        setBusy(false);
      }
    },
    [backend, refresh],
  );

  // Native OS drag-drop delivers file paths through the webview (desktop-only).
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    void (async () => {
      const { getCurrentWebview } = await import("@tauri-apps/api/webview");
      const stop = await getCurrentWebview().onDragDropEvent((event) => {
        if (event.payload.type === "over") setDragOver(true);
        if (event.payload.type === "leave") setDragOver(false);
        if (event.payload.type === "drop") {
          setDragOver(false);
          void ingest(event.payload.paths);
        }
      });
      if (cancelled) stop();
      else unlisten = stop;
    })();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [ingest]);

  const pickFiles = async () => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const picked = await open({
      multiple: true,
      filters: [{ name: "Documents", extensions: [...SUPPORTED] }],
    });
    if (picked) void ingest(Array.isArray(picked) ? picked : [picked]);
  };

  const readClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text.trim()) {
        setPasteText(text);
        setNotice(null);
      } else {
        setNotice("Clipboard is empty.");
      }
    } catch {
      setNotice("Couldn't read the clipboard automatically — paste into the box with Ctrl+V.");
    }
  };

  const downloadDoc = async (doc: RagDocument) => {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const dest = await save({ defaultPath: doc.file_name });
    if (!dest) return;
    try {
      await backend.rag.download(doc.id, dest);
      setNotice(`Downloaded ${doc.file_name}.`);
    } catch (e) {
      setNotice(String(e));
    }
  };

  const savePaste = async () => {
    const text = pasteText.trim();
    if (!text) {
      setNotice("Nothing to add — paste or type some text first.");
      return;
    }
    setBusy(true);
    setNotice("Adding pasted text…");
    try {
      const report = await backend.rag.ingestText(deriveNoteName(text), text);
      setNotice(
        report.warnings.length > 0
          ? `Added with warnings: ${report.warnings.join("; ")}`
          : `Added "${report.document.file_name}".`,
      );
      if (selectedContextId) onAttachToSelected(report.document.id);
      setPasteText("");
      setPasteOpen(false);
      await refresh();
    } catch (e) {
      setNotice(String(e));
    } finally {
      setBusy(false);
    }
  };

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return documents.filter((d) => {
      if (q && !d.file_name.toLowerCase().includes(q)) return false;
      if (filter === "context") {
        return selectedContextId ? d.context_ids.includes(selectedContextId) : false;
      }
      if (filter === "pasted") return d.source === "pasted";
      if (filter === "generated") return d.source === "generated";
      return true;
    });
  }, [documents, search, filter, selectedContextId]);

  const rowIcon = (d: RagDocument) =>
    d.source === "generated" ? "sparkle" : d.source === "pasted" ? "clipboard" : "file";

  return (
    <div
      className={[
        "card flex min-h-0 flex-col p-3",
        dragOver ? "outline outline-2 -outline-offset-2 outline-ai/60" : "",
      ].join(" ")}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-fg-muted">
          Library
        </h3>
        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setPasteOpen((v) => !v);
              setNotice(null);
            }}
            title="Paste as a note"
            aria-label="Paste as a note"
            className="rounded-sm p-1.5 text-fg-faint transition hover:bg-panel-raised/60 hover:text-fg"
          >
            <Icon name="clipboard" size={16} />
          </button>
          {isTauri() && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void pickFiles()}
              title="Add documents…"
              aria-label="Add documents"
              className="rounded-sm p-1.5 text-fg-faint transition hover:bg-panel-raised/60 hover:text-fg"
            >
              <Icon name="upload" size={16} />
            </button>
          )}
        </div>
      </div>

      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search documents"
        aria-label="Search documents"
        className="input mb-2 h-[30px] text-xs"
      />

      <div className="mb-2 flex flex-wrap gap-1.5">
        {FILTERS.map((f) => {
          const disabled = f.key === "context" && !selectedContextId;
          return (
            <button
              key={f.key}
              type="button"
              disabled={disabled}
              onClick={() => setFilter(f.key)}
              title={
                disabled ? "Select a context to filter its documents" : undefined
              }
              className={[
                "rounded-full border px-2 py-0.5 text-[11px] transition disabled:opacity-40",
                filter === f.key
                  ? "border-outbound/50 bg-outbound/[0.12] text-fg"
                  : "border-border text-fg-faint hover:text-fg",
              ].join(" ")}
            >
              {f.key === "context" && selectedContextTitle
                ? selectedContextTitle
                : f.label}
            </button>
          );
        })}
      </div>

      {pasteOpen && (
        <div className="mb-2 rounded-md border border-border p-2">
          <div className="mb-1.5 flex items-center gap-2">
            <span className="text-[10px] text-fg-faint">
              Saved as a named .txt{selectedContextTitle ? ` · attaches to "${selectedContextTitle}"` : ""}
            </span>
            <button
              type="button"
              onClick={() => void readClipboard()}
              className="btn ml-auto px-2 py-0.5 text-[10px]"
            >
              Paste from clipboard
            </button>
          </div>
          <textarea
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
            rows={4}
            placeholder="Paste notes, a snippet, an email…"
            className="input resize-y text-xs"
          />
          <div className="mt-1.5 flex items-center gap-2">
            <button
              type="button"
              disabled={busy || pasteText.trim().length === 0}
              onClick={() => void savePaste()}
              className="btn btn-accent px-2 py-1 text-[11px]"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => {
                setPasteOpen(false);
                setPasteText("");
              }}
              className="btn px-2 py-1 text-[11px]"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {notice && (
        <p className="mb-2 text-[10px] text-fg-muted" role="status">
          {notice}
        </p>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {visible.length === 0 ? (
          <p className="px-1 py-6 text-center text-[11px] text-fg-faint">
            {documents.length === 0
              ? "No documents yet — add files or paste a note."
              : "No documents match."}
          </p>
        ) : (
          <ul className="flex flex-col">
            {visible.map((doc) => {
              // A local const (not repeated array indexing) so TS narrows it
              // for every use below.
              const firstContextId = doc.context_ids[0];
              return (
              <li
                key={doc.id}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData(DOC_DRAG_MIME, doc.id);
                  e.dataTransfer.effectAllowed = "link";
                }}
                className="flex items-center gap-1.5 border-b border-border py-1.5 text-[12px] last:border-0"
              >
                <span className="cursor-grab text-fg-faint" aria-hidden>
                  <Icon name="dragHandle" size={13} />
                </span>
                <input
                  type="checkbox"
                  checked={doc.enabled}
                  onChange={(e) =>
                    void backend.rag.setEnabled(doc.id, e.target.checked).then(refresh)
                  }
                  aria-label={`Include ${doc.file_name} in retrieval`}
                />
                <Icon
                  name={rowIcon(doc)}
                  size={14}
                  className={doc.source === "generated" ? "text-ai shrink-0" : "text-fg-faint shrink-0"}
                />
                <span
                  className={[
                    "min-w-0 flex-1 truncate",
                    doc.enabled ? "text-fg" : "text-fg-faint line-through",
                  ].join(" ")}
                  title={doc.file_name}
                >
                  {doc.file_name}
                </span>
                {doc.source === "generated" && (
                  <span className="shrink-0 rounded-full bg-ai/10 px-1.5 py-0.5 text-[9px] font-semibold text-ai">
                    conva
                  </span>
                )}
                {firstContextId && (
                  <span
                    className="shrink-0 truncate text-[10px] text-fg-faint"
                    title={doc.context_ids.map((id) => contextTitles[id] ?? id).join(", ")}
                  >
                    {contextTitles[firstContextId] ?? firstContextId}
                    {doc.context_ids.length > 1 ? ` +${doc.context_ids.length - 1}` : ""}
                  </span>
                )}
                {selectedContextId && !doc.context_ids.includes(selectedContextId) && (
                  <button
                    type="button"
                    onClick={() => onAttachToSelected(doc.id)}
                    title={`Attach to "${selectedContextTitle ?? "selected context"}"`}
                    aria-label={`Attach ${doc.file_name} to the selected context`}
                    className="shrink-0 grid h-4 w-4 place-items-center rounded-sm text-[13px] leading-none text-fg-faint transition hover:bg-panel-raised/60 hover:text-ai"
                  >
                    +
                  </button>
                )}
                {conversationOpen && (
                  <button
                    type="button"
                    onClick={() => void toggleLinkedDoc(doc.id)}
                    aria-pressed={linkedDocs.includes(doc.id)}
                    title={
                      linkedDocs.includes(doc.id)
                        ? `Unlink from "${conversationTitle}"`
                        : `Link to "${conversationTitle}"`
                    }
                    className={[
                      "shrink-0 rounded-full border px-1.5 py-0.5 text-[9px]",
                      linkedDocs.includes(doc.id)
                        ? "border-ai/60 text-ai"
                        : "border-border text-fg-faint hover:text-fg",
                    ].join(" ")}
                  >
                    {linkedDocs.includes(doc.id) ? "Linked" : "Link"}
                  </button>
                )}
                {isTauri() && (
                  <button
                    type="button"
                    onClick={() => void downloadDoc(doc)}
                    aria-label={`Download ${doc.file_name}`}
                    title="Download"
                    className="shrink-0 rounded-sm p-1 text-fg-faint transition hover:bg-panel-raised/60 hover:text-fg"
                  >
                    <Icon name="download" size={12} />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void backend.rag.delete(doc.id).then(refresh)}
                  aria-label={`Delete ${doc.file_name}`}
                  title="Delete"
                  className="shrink-0 rounded-sm p-1 text-fg-faint transition hover:bg-rec/10 hover:text-rec"
                >
                  <Icon name="trash" size={12} />
                </button>
              </li>
              );
            })}
          </ul>
        )}
      </div>

      {isTauri() && (
        <p className="mt-2 text-[10px] text-fg-faint">
          <button
            type="button"
            onClick={() =>
              void backend.rag
                .syncLibrary()
                .then(setNotice)
                .catch((e) => setNotice(String(e)))
            }
            className="hover:text-fg"
          >
            Sync to repo…
          </button>
        </p>
      )}
    </div>
  );
}

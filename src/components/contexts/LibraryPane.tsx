import { useCallback, useEffect, useMemo, useState } from "react";

import { Icon } from "@/components/ui/Icon";
import { useBackend } from "@/lib/backend";
import { useCapabilities } from "@/lib/backend/context";
import type { RagDocument } from "@/lib/ipc";
import { isTauri } from "@/lib/ipc";
import { useConversationStore } from "@/state/conversation";

const SUPPORTED = ["pdf", "docx", "md", "markdown", "txt", "html", "htm"];
/** The custom drag payload MIME a library row carries — read by ContextsPane
 * rows to attach the dragged document. Reinstated (owner decision,
 * 2026-08-16) now that Library sits next to Contexts on one screen again —
 * `LibraryRowMenu` below (its "Attach to a context…" item) is still there
 * as the click alternative. */
export const DOC_DRAG_MIME = "application/x-conva-doc-id";

/** Default title for a pasted note (owner spec): words + numbers only — no
 *  punctuation/symbols — spaces replaced with underscores, capped at the
 *  first few whole words that fit in 20 chars (trimmed at a word boundary,
 *  not mid-word). Still just a *default*: the title field is editable
 *  before saving. */
const NOTE_TITLE_MAX = 20;
function deriveNoteName(text: string): string {
  const firstLine = text
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (!firstLine) return "Pasted_note";
  const cleaned = firstLine
    .replace(/[^\p{L}\p{N}\s]/gu, "") // drop everything but letters/numbers/whitespace
    .trim()
    .replace(/\s+/g, " ");
  if (!cleaned) return "Pasted_note";
  let out = "";
  for (const word of cleaned.split(" ")) {
    const next = out ? `${out} ${word}` : word;
    if (next.length > NOTE_TITLE_MAX) break;
    out = next;
  }
  // A single word longer than the cap (e.g. a long compound word) — hard-truncate it.
  const words = out || cleaned.slice(0, NOTE_TITLE_MAX);
  return words.replace(/\s+/g, "_");
}

type Filter = "all" | "pasted" | "generated";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "pasted", label: "Pasted" },
  { key: "generated", label: "By conva" },
];

/** A row's "attach to a context" control — click, pick a context, done.
 *  Already-attached contexts show a check and are unclickable. Replaces
 *  the earlier drag-to-attach gesture (see the doc comment on
 *  `LibraryPane` for why). */
/**
 * The row's overflow ⋮ menu (owner, 2026-08-28 — the row shows only
 * checkbox/source-icon/name/context-icon/download/trash inline now; every
 * other action lives here): Attach to a context… (a second "page" of the
 * same popover — the former standalone `AttachMenu`, folded in), View
 * (partner window, when supported), and Link/Unlink to the open
 * conversation (when one is open). Renders nothing when none apply. Same
 * open/close-on-outside-{click,resize,scroll} shape the old `AttachMenu`
 * used (and `ContextInfoPopover` in `ContextsPane.tsx` mirrors too).
 */
function LibraryRowMenu({
  doc,
  contextTitles,
  onAttach,
  canView,
  onView,
  conversationOpen,
  conversationTitle,
  linked,
  onToggleLink,
}: {
  doc: RagDocument;
  contextTitles: Record<string, string>;
  onAttach: (docId: string, contextId: string) => void;
  canView: boolean;
  onView: () => void;
  conversationOpen: boolean;
  conversationTitle: string | null;
  linked: boolean;
  onToggleLink: () => void;
}) {
  const [view, setView] = useState<"menu" | "attach" | null>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const entries = Object.entries(contextTitles);

  useEffect(() => {
    if (!view) return;
    const close = () => setView(null);
    window.addEventListener("click", close);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [view]);

  if (entries.length === 0 && !canView && !conversationOpen) return null;

  return (
    <span className="relative shrink-0">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          const r = e.currentTarget.getBoundingClientRect();
          const MARGIN = 8;
          const MENU_W = 220;
          const x = Math.max(MARGIN, Math.min(r.right - MENU_W, window.innerWidth - MENU_W - MARGIN));
          setPos({ x, y: r.bottom + 4 });
          setView((v) => (v ? null : "menu"));
        }}
        title="More actions"
        aria-label={`More actions for ${doc.file_name}`}
        aria-haspopup="menu"
        aria-expanded={view !== null}
        className="shrink-0 rounded-sm p-1 text-fg-faint transition hover:bg-panel-raised/60 hover:text-fg"
      >
        <Icon name="more" size={13} />
      </button>
      {view && pos && (
        <div
          role="menu"
          aria-label={`Actions for ${doc.file_name}`}
          onClick={(e) => e.stopPropagation()}
          style={{ position: "fixed", left: pos.x, top: pos.y, zIndex: 60 }}
          className="glass-raised max-h-[320px] min-w-[180px] max-w-[220px] overflow-y-auto rounded-lg border border-border p-1 shadow-[var(--shadow-lg)]"
        >
          {view === "menu" ? (
            <>
              {entries.length > 0 && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => setView("attach")}
                  className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-[12px] text-fg transition hover:bg-white/[0.06]"
                >
                  Attach to a context…
                  <Icon name="chevron" size={12} className="-rotate-90 shrink-0 text-fg-faint" />
                </button>
              )}
              {canView && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setView(null);
                    onView();
                  }}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[12px] text-fg transition hover:bg-white/[0.06]"
                >
                  <Icon name="expand" size={13} className="text-fg-faint" />
                  View
                </button>
              )}
              {conversationOpen && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setView(null);
                    onToggleLink();
                  }}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[12px] text-fg transition hover:bg-white/[0.06]"
                >
                  <Icon name="link" size={13} className={linked ? "text-ai" : "text-fg-faint"} />
                  {linked ? `Unlink from "${conversationTitle}"` : `Link to "${conversationTitle}"`}
                </button>
              )}
            </>
          ) : (
            entries.map(([id, title]) => {
              const attached = doc.context_ids.includes(id);
              return (
                <button
                  key={id}
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={attached}
                  disabled={attached}
                  onClick={() => {
                    onAttach(doc.id, id);
                    setView(null);
                  }}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[12px] text-fg transition hover:bg-white/[0.06] disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent"
                >
                  <Icon
                    name="check"
                    size={12}
                    className={attached ? "text-ok" : "invisible"}
                  />
                  <span className="min-w-0 flex-1 truncate">{title}</span>
                </button>
              );
            })
          )}
        </div>
      )}
    </span>
  );
}

/**
 * The Library pane: search + filter chips, add/paste documents, each row a
 * drag SOURCE (`DOC_DRAG_MIME`) for dropping onto a context in
 * `ContextsPane`, plus a click-to-pick popover (`LibraryRowMenu`'s "Attach
 * to a context…" item) as the
 * always-available alternative — dragging a webview element can fail in
 * ways that are hard to diagnose remotely (this pairing was dropped once
 * this session over exactly that, then reinstated per owner decision,
 * 2026-08-16, now that Library sits next to Contexts on one screen again).
 * Requires `dragDropEnabled: false` on the window (`tauri.conf.json`) —
 * see that file and CLAUDE.md's drag-and-drop note for the real trade-off
 * this carries for Library's own OS file-drop ingest. `contextTitles`
 * (id → title) drives both the picker and a doc's own context-tag label.
 */
export function LibraryPane({
  contextTitles,
  onAttach,
  refreshToken,
  quickAction,
}: {
  contextTitles: Record<string, string>;
  /** Attach `docId` to `contextId` — the real mutation
   *  (`backend.rag.attachContext`) lives with the caller. */
  onAttach: (docId: string, contextId: string) => void;
  /** Bump this to force a refresh from outside (e.g. after generating). */
  refreshToken?: number;
  /** One-shot: open the file picker or the paste box on mount — driven by
   *  ⌘K's quick-add commands (`useLibraryQuickAdd`), consumed by the
   *  caller before it ever reaches here, so this only ever fires once. */
  quickAction?: "upload" | "paste" | null;
}) {
  const backend = useBackend();
  const caps = useCapabilities();
  const [documents, setDocuments] = useState<RagDocument[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [pasteTitle, setPasteTitle] = useState("");
  // Once the owner edits the title by hand, stop overwriting it as the text
  // changes — auto-derive is a default, not a fight for control of the field.
  const [titleTouched, setTitleTouched] = useState(false);
  useEffect(() => {
    if (!titleTouched) setPasteTitle(deriveNoteName(pasteText));
  }, [pasteText, titleTouched]);
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

  // Quick-add, run once on mount (see the prop doc comment above).
  useEffect(() => {
    if (quickAction === "upload" && isTauri()) void pickFiles();
    else if (quickAction === "paste") {
      setPasteOpen(true);
      setNotice(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quickAction]);

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
    const title = pasteTitle.trim() || deriveNoteName(text);
    setBusy(true);
    setNotice("Adding pasted text…");
    try {
      const report = await backend.rag.ingestText(title, text);
      setNotice(
        report.warnings.length > 0
          ? `Added with warnings: ${report.warnings.join("; ")}`
          : `Added "${report.document.file_name}".`,
      );
      setPasteText("");
      setPasteTitle("");
      setTitleTouched(false);
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
      if (filter === "pasted") return d.source === "pasted";
      if (filter === "generated") return d.source === "generated";
      return true;
    });
  }, [documents, search, filter]);

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
          {/* Same "+" + glyph pattern as Contexts' New Context button
              (owner decision, 2026-08-17) — one consistent "add something
              new" affordance app-wide, not a bare icon per surface. */}
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setPasteOpen((v) => !v);
              setNotice(null);
            }}
            title="Add a pasted note"
            aria-label="Add a pasted note"
            className="flex items-center gap-0.5 rounded-sm p-1.5 text-fg-faint transition hover:bg-panel-raised/60 hover:text-fg"
          >
            <Icon name="add" size={13} />
            <Icon name="clipboard" size={16} />
          </button>
          {isTauri() && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void pickFiles()}
              title="Add a document…"
              aria-label="Add a document"
              className="flex items-center gap-0.5 rounded-sm p-1.5 text-fg-faint transition hover:bg-panel-raised/60 hover:text-fg"
            >
              <Icon name="add" size={13} />
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

      {pasteOpen && (
        <div className="mb-2 rounded-md border border-border p-2">
          <div className="mb-1.5 flex items-center gap-2">
            <span className="text-[10px] text-fg-faint">
              Saved as a named .txt — attach it to a context after, from its row
            </span>
            <button
              type="button"
              onClick={() => void readClipboard()}
              className="btn ml-auto px-2 py-0.5 text-[10px]"
            >
              Paste from clipboard
            </button>
          </div>
          <input
            value={pasteTitle}
            onChange={(e) => {
              setPasteTitle(e.target.value);
              setTitleTouched(true);
            }}
            placeholder="Title"
            aria-label="Note title"
            title="Defaults to the first few words of the text — edit to rename"
            className="input mb-1.5 h-[26px] text-xs font-semibold"
          />
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
                setPasteTitle("");
                setTitleTouched(false);
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
                {/* Passive "which context(s) is this doc in" hint — an icon
                    now, not the old text chip, since the row has less room.
                    Wrapped in a <span title=…> rather than passing title to
                    Icon directly (it doesn't forward one — same pattern as
                    ContextDetail.tsx's stage icons). */}
                {firstContextId && (
                  <span
                    className="shrink-0"
                    title={doc.context_ids.map((id) => contextTitles[id] ?? id).join(", ")}
                  >
                    <Icon name="book" size={13} className="text-fg-faint" />
                  </span>
                )}
                <LibraryRowMenu
                  doc={doc}
                  contextTitles={contextTitles}
                  onAttach={onAttach}
                  canView={caps?.system.partnerWindow === true}
                  onView={() =>
                    void backend.partner.open(doc.file_name, null, null, null, [], doc.id)
                  }
                  conversationOpen={conversationOpen}
                  conversationTitle={conversationTitle}
                  linked={linkedDocs.includes(doc.id)}
                  onToggleLink={() => void toggleLinkedDoc(doc.id)}
                />
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

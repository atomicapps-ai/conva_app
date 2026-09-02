import { useCallback, useEffect, useMemo, useState } from "react";

import { FilterPopover } from "@/components/contexts/FilterPopover";
import {
  documentTypeLabel,
  filterDocuments,
  LIBRARY_FILTERS,
  type LibraryFilter,
} from "@/components/contexts/libraryFilter";
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

/** The top-level Library page's table grid (AppUI V5.0 §4's column set). */
const PAGE_ROW_GRID =
  "grid grid-cols-[24px_minmax(0,2.4fr)_minmax(0,1fr)_minmax(0,2fr)_minmax(0,0.8fr)_40px] gap-3.5";

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


/** A row's "attach to a context" control — click, pick a context, done.
 *  Already-attached contexts show a check and are unclickable. Replaces
 *  the earlier drag-to-attach gesture (see the doc comment on
 *  `LibraryPane` for why). */
/**
 * The row's overflow ⋮ menu (owner, 2026-08-28/29 — the row shows only
 * checkbox/source-icon/name/context-icon inline now; every other action
 * lives here): Attach to a context… (a second "page" of the same popover —
 * the former standalone `AttachMenu`, folded in), View (partner window,
 * when supported), Download (desktop only), and Link/Unlink to the open
 * conversation (when one is open) — Delete always shows. Same
 * open/close-on-outside-{click,resize,scroll} shape the old `AttachMenu`
 * used (and `ContextInfoPopover` in `ContextsPane.tsx` mirrors too).
 */
function LibraryRowMenu({
  doc,
  contextTitles,
  onAttach,
  canView,
  onView,
  canDownload,
  onDownload,
  conversationOpen,
  conversationTitle,
  linked,
  onToggleLink,
  onDelete,
}: {
  doc: RagDocument;
  contextTitles: Record<string, string>;
  onAttach: (docId: string, contextId: string) => void;
  canView: boolean;
  onView: () => void;
  /** Desktop-only (there's no filesystem to save to in the web preview) —
   *  moved in here from its own standalone row icon (owner, 2026-08-29:
   *  "move the download icon into the 3 dots menu"). */
  canDownload: boolean;
  onDownload: () => void;
  conversationOpen: boolean;
  conversationTitle: string | null;
  linked: boolean;
  onToggleLink: () => void;
  onDelete: () => void;
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

  // Delete lives here unconditionally now (owner, 2026-08-29 — "put the 3
  // dots to the far right and include the trashcan inside that 3dot
  // menu"), so — unlike before — this never has nothing to show.

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
              {canDownload && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setView(null);
                    onDownload();
                  }}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[12px] text-fg transition hover:bg-white/[0.06]"
                >
                  <Icon name="download" size={13} className="text-fg-faint" />
                  Download
                </button>
              )}
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setView(null);
                  onDelete();
                }}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[12px] text-rec transition hover:bg-rec/10"
              >
                <Icon name="trash" size={13} />
                Delete
              </button>
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
 * `focusContextId` (set from a context's doc-count control in
 * `ContextsPane`) filters the list to that context's documents, with a
 * dismissible banner as the "show everything again" affordance.
 */
export function LibraryPane({
  contextTitles,
  onAttach,
  refreshToken,
  quickAction,
  focusContextId,
  onClearFocus,
  variant = "dock",
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
  /** Set by clicking a context's doc-count control in `ContextsPane`
   *  (owner, 2026-08-29: "when I click the document icon in the context
   *  card it doesn't auto select the documents on the library") — filters
   *  the list to documents attached to this context. */
  focusContextId?: string | null;
  /** Clears `focusContextId` — the banner's ✕, and clicking the same
   *  doc-count control again (`ContextsView`'s toggle). */
  onClearFocus?: () => void;
  /**
   * `"dock"` (default) is the narrow contextual pane inside Contexts —
   * relationship-focused, one line per document. `"page"` is the top-level
   * Library destination (AppUI V5.0 §4): the same component and the same
   * actions, presented as the management table the spec asks for — visible
   * filter chips plus Name / Type / In contexts / Added columns. Same
   * documents, different job; one implementation, so ingest/attach/delete
   * can't drift between the two.
   */
  variant?: "dock" | "page";
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
  const [filter, setFilter] = useState<LibraryFilter>("all");
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

  const visible = useMemo(
    () => filterDocuments(documents, { search, filter, focusContextId }),
    [documents, search, filter, focusContextId],
  );

  const page = variant === "page";
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

      <div className="mb-2 flex items-center gap-1.5">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={page ? "Search files, notes, and briefs" : "Search documents"}
          aria-label="Search documents"
          className={page ? "input h-[38px] flex-1 text-[13px]" : "input h-[30px] flex-1 text-xs"}
        />
        {!page && (
          <FilterPopover
            groups={[
              {
                key: "source",
                label: "Source",
                options: LIBRARY_FILTERS.map((f) => ({ value: f.key, label: f.label })),
                selected: filter,
                onChange: (v) => setFilter(v as LibraryFilter),
              },
            ]}
          />
        )}
      </div>

      {page && (
        <div className="mb-3 flex flex-wrap gap-2" role="group" aria-label="Filter documents">
          {LIBRARY_FILTERS.map((f) => {
            const on = filter === f.key;
            return (
              <button
                key={f.key}
                type="button"
                aria-pressed={on}
                onClick={() => setFilter(f.key)}
                className={[
                  "rounded-full px-4 py-2 text-xs transition",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
                  on
                    ? "bg-primary font-bold text-primary-ink"
                    : "border border-border bg-panel font-semibold text-fg-muted hover:text-fg",
                ].join(" ")}
              >
                {f.label}
              </button>
            );
          })}
        </div>
      )}

      {focusContextId && (
        <div className="mb-2 flex items-center gap-1.5 rounded-md border border-primary/30 bg-primary/[0.06] px-2 py-1 text-[11px] text-fg">
          <Icon name="file" size={11} className="shrink-0 text-primary" />
          <span className="min-w-0 flex-1 truncate">
            Showing documents for{" "}
            <span className="font-semibold">{contextTitles[focusContextId] ?? "this context"}</span>
          </span>
          <button
            type="button"
            onClick={onClearFocus}
            aria-label="Clear filter"
            title="Show all documents"
            className="shrink-0 rounded-sm p-0.5 text-fg-faint transition hover:bg-panel-raised/60 hover:text-fg"
          >
            <Icon name="close" size={12} />
          </button>
        </div>
      )}

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

      {page && visible.length > 0 && (
        <div className={`${PAGE_ROW_GRID} shrink-0 items-center border-b border-border bg-bg-2 px-4 py-2.5 font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-fg-faint`}>
          <span aria-hidden />
          <span>Name</span>
          <span>Type</span>
          <span>In contexts</span>
          <span>Added</span>
          <span aria-hidden />
        </div>
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
                className={
                  page
                    ? `${PAGE_ROW_GRID} items-center border-b border-border px-4 py-3 text-[13.5px] last:border-0`
                    : "flex items-center gap-1.5 border-b border-border py-1.5 text-[12px] last:border-0"
                }
              >
                <input
                  type="checkbox"
                  checked={doc.enabled}
                  onChange={(e) =>
                    void backend.rag.setEnabled(doc.id, e.target.checked).then(refresh)
                  }
                  aria-label={`Include ${doc.file_name} in retrieval`}
                />
                <span className="flex min-w-0 items-center gap-2.5">
                <Icon
                  name={rowIcon(doc)}
                  size={page ? 18 : 14}
                  className={doc.source === "generated" ? "text-ai shrink-0" : "text-fg-faint shrink-0"}
                />
                <span
                  className={[
                    "min-w-0 flex-1 truncate",
                    page ? "font-semibold" : "",
                    doc.enabled ? "text-fg" : "text-fg-faint",
                  ].join(" ")}
                  title={
                    doc.enabled
                      ? doc.file_name
                      : `${doc.file_name} — not included in retrieval`
                  }
                >
                  {doc.file_name}
                </span>
                </span>

                {page && (
                  <>
                    <span className="truncate font-mono text-xs text-fg-muted">
                      {documentTypeLabel(doc)}
                    </span>
                    <span className="flex min-w-0 flex-wrap gap-1.5">
                      {doc.context_ids.length === 0 ? (
                        <span className="font-mono text-[11px] text-fg-faint">—</span>
                      ) : (
                        doc.context_ids.map((id) => (
                          <span
                            key={id}
                            className="max-w-[180px] truncate rounded-[5px] bg-primary/10 px-2 py-1 text-[11px] font-semibold text-primary"
                          >
                            {contextTitles[id] ?? id}
                          </span>
                        ))
                      )}
                    </span>
                    <span className="font-mono text-xs text-fg-faint">
                      {new Date(doc.ingested_at_unix_ms).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                      })}
                    </span>
                  </>
                )}
                {/* Passive "which context(s) is this doc in" hint — an icon
                    now, not the old text chip, since the row has less room.
                    Wrapped in a <span title=…> rather than passing title to
                    Icon directly (it doesn't forward one — same pattern as
                    ContextDetail.tsx's stage icons). */}
                {!page && firstContextId && (
                  <span
                    className="shrink-0"
                    title={doc.context_ids.map((id) => contextTitles[id] ?? id).join(", ")}
                  >
                    <Icon name="book" size={13} className="text-fg-faint" />
                  </span>
                )}
                {/* Far right (owner, 2026-08-29) — the row's one remaining
                    "more" surface; Delete and Download both live here now
                    rather than staying standalone icons. */}
                <LibraryRowMenu
                  doc={doc}
                  contextTitles={contextTitles}
                  onAttach={onAttach}
                  canView={caps?.system.partnerWindow === true}
                  onView={() =>
                    void backend.partner.open(doc.file_name, null, null, null, [], doc.id)
                  }
                  canDownload={isTauri()}
                  onDownload={() => void downloadDoc(doc)}
                  conversationOpen={conversationOpen}
                  conversationTitle={conversationTitle}
                  linked={linkedDocs.includes(doc.id)}
                  onToggleLink={() => void toggleLinkedDoc(doc.id)}
                  onDelete={() => void backend.rag.delete(doc.id).then(refresh)}
                />
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

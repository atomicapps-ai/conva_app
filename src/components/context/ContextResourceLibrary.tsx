import { useEffect, useMemo, useState } from "react";

import type { ContextFileSlot } from "@/components/context/categoryTemplates";
import { isImageDocument } from "@/components/contexts/documentVisual";
import { documentTypeLabel } from "@/components/contexts/libraryFilter";
import { DOC_DRAG_MIME } from "@/components/contexts/LibraryPane";
import { Icon } from "@/components/ui/Icon";
import { DocumentTypeIcon } from "@/components/ui/DocumentTypeIcon";
import type { RagDocument } from "@/lib/ipc";

export const OTHER_RESOURCE_TARGET = "__other__";

function ResourceRow({
  doc,
  action,
  draggable = false,
}: {
  doc: RagDocument;
  action?: React.ReactNode;
  draggable?: boolean;
}) {
  return (
    <li
      draggable={draggable}
      onDragStart={(event) => {
        if (!draggable) return;
        event.dataTransfer.setData(DOC_DRAG_MIME, doc.id);
        event.dataTransfer.effectAllowed = "link";
      }}
      className="flex items-center gap-2 border-b border-border/70 py-2 last:border-0"
    >
      <DocumentTypeIcon doc={doc} size={16} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[11px] font-semibold text-fg" title={doc.file_name}>
          {doc.file_name}
        </span>
        <span className="block text-[9px] text-fg-faint">
          {documentTypeLabel(doc)}
          {isImageDocument(doc) ? " · visual asset" : doc.chunk_count > 0 ? ` · ${doc.chunk_count} indexed` : ""}
        </span>
      </span>
      {action}
    </li>
  );
}

/** The one reusable Library surface beside Context setup (wide column / compact drawer). */
export function ContextResourceLibrary({
  attachable,
  generated,
  selectedIds,
  slots,
  target,
  adding,
  canAddFiles,
  onTargetChange,
  onAssign,
  onAddFiles,
  onPaste,
  canViewGenerated,
  onViewGenerated,
}: {
  attachable: RagDocument[];
  generated: RagDocument[];
  selectedIds: string[];
  slots: ContextFileSlot[];
  target: string;
  adding: boolean;
  canAddFiles: boolean;
  onTargetChange: (target: string) => void;
  onAssign: (target: string, docId: string) => void;
  onAddFiles: (target: string) => void;
  onPaste: (title: string, text: string, target: string) => Promise<void>;
  canViewGenerated: boolean;
  onViewGenerated: (doc: RagDocument) => void;
}) {
  const [usedOpen, setUsedOpen] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteTitle, setPasteTitle] = useState("");
  const [pasteText, setPasteText] = useState("");
  const [pasting, setPasting] = useState(false);
  // The full Library list used to sit here permanently, showing every
  // unattached document for every section (owner, 2026-09-23: "the document
  // uploader is annoying showing all documents for every section to be
  // selected. Remove that entirely."). It's now an on-demand popover, scoped
  // to the section currently selected via `target` — nothing browsable until
  // asked for.
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerPos, setPickerPos] = useState<{ x: number; y: number } | null>(null);
  const [pickerSearch, setPickerSearch] = useState("");

  useEffect(() => {
    if (!pickerOpen) return;
    const close = () => setPickerOpen(false);
    window.addEventListener("click", close);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [pickerOpen]);

  const used = useMemo(
    () => [
      ...attachable.filter((doc) => selectedIds.includes(doc.id)),
      ...generated,
    ],
    [attachable, generated, selectedIds],
  );
  const available = useMemo(() => {
    const query = pickerSearch.trim().toLowerCase();
    return attachable.filter(
      (doc) => !selectedIds.includes(doc.id) && (!query || doc.file_name.toLowerCase().includes(query)),
    );
  }, [attachable, pickerSearch, selectedIds]);
  const targetLabel =
    slots.find((slot) => slot.key === target)?.label ?? "Other documents";

  const readClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) setPasteText(text);
    } catch {
      // The textarea remains available when clipboard permission is denied.
    }
  };

  const savePaste = async () => {
    if (!pasteText.trim()) return;
    setPasting(true);
    try {
      await onPaste(pasteTitle.trim() || "Context note", pasteText.trim(), target);
      setPasteTitle("");
      setPasteText("");
      setPasteOpen(false);
    } finally {
      setPasting(false);
    }
  };

  return (
    <aside className="card flex min-h-0 flex-col p-3" aria-label="Context Library">
      <div className="flex items-center gap-2">
        <Icon name="library" size={16} className="text-primary" />
        <h3 className="text-xs font-bold uppercase tracking-wider text-fg-muted">Library</h3>
      </div>
      <p className="mt-1 text-[10px] leading-relaxed text-fg-faint">
        Pick a destination, then add or drag a resource into a section.
      </p>

      <button
        type="button"
        aria-expanded={usedOpen}
        onClick={() => setUsedOpen((open) => !open)}
        className="mt-3 flex w-full items-center gap-2 rounded-md border border-primary/25 bg-primary/[0.05] px-2.5 py-2 text-left"
      >
        <Icon name="folder" size={15} className="shrink-0 text-primary" />
        <span className="min-w-0 flex-1 truncate text-[11px] font-bold text-fg">
          Used by this Context ({used.length})
        </span>
        <Icon
          name="chevron"
          size={11}
          className={`shrink-0 text-fg-faint transition ${usedOpen ? "" : "-rotate-90"}`}
        />
      </button>
      {usedOpen && (
        <ul className="max-h-44 overflow-y-auto px-1">
          {used.length ? (
            used.map((doc) => (
              <ResourceRow
                key={doc.id}
                doc={doc}
                action={doc.source === "generated" && canViewGenerated ? (
                  <button
                    type="button"
                    onClick={() => onViewGenerated(doc)}
                    aria-label={`View ${doc.file_name}`}
                    className="shrink-0 rounded-sm px-1.5 py-0.5 text-[9px] font-bold text-ai hover:bg-ai/10"
                  >
                    View
                  </button>
                ) : undefined}
              />
            ))
          ) : (
            <li className="py-3 text-center text-[10px] text-fg-faint">No resources assigned yet.</li>
          )}
        </ul>
      )}

      <label className="field mt-3 text-[10px]">
        Add to
        <select
          value={target}
          onChange={(event) => onTargetChange(event.target.value)}
          aria-label="Resource destination"
          className="input h-8 text-[11px]"
        >
          {slots.map((slot) => (
            <option key={slot.key} value={slot.key}>{slot.label}</option>
          ))}
          <option value={OTHER_RESOURCE_TARGET}>Other documents</option>
        </select>
      </label>

      <div className="mt-2 flex gap-1.5">
        <button
          type="button"
          className="btn flex-1 px-2 py-1.5 text-[10px]"
          disabled={adding || !canAddFiles}
          onClick={() => onAddFiles(target)}
        >
          <Icon name="upload" size={12} />
          {adding ? "Adding…" : canAddFiles ? "Add files" : "Files unavailable"}
        </button>
        <button
          type="button"
          className="btn flex-1 px-2 py-1.5 text-[10px]"
          onClick={() => setPasteOpen((open) => !open)}
        >
          <Icon name="clipboard" size={12} /> Paste
        </button>
      </div>

      {/* Existing Library documents — a button-triggered popover, scoped to
          `target`, rather than a permanent wall of every unattached document
          (owner, 2026-09-23). */}
      <button
        type="button"
        className="btn mt-1.5 w-full px-2 py-1.5 text-[10px]"
        disabled={available.length === 0 && pickerSearch.trim().length === 0}
        onClick={(event) => {
          event.stopPropagation();
          const r = event.currentTarget.getBoundingClientRect();
          setPickerPos({ x: r.left, y: r.bottom + 4 });
          setPickerOpen((open) => !open);
        }}
      >
        <Icon name="library" size={12} />
        Add from library…
      </button>

      {pickerOpen && pickerPos && (
        <div
          role="dialog"
          aria-label={`Add an existing document to ${targetLabel}`}
          onClick={(event) => event.stopPropagation()}
          style={{ position: "fixed", left: pickerPos.x, top: pickerPos.y, zIndex: 60 }}
          className="glass-raised flex max-h-[320px] w-[260px] flex-col overflow-hidden rounded-lg border border-border shadow-[var(--shadow-lg)]"
        >
          <input
            value={pickerSearch}
            onChange={(event) => setPickerSearch(event.target.value)}
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
            className="input m-1.5 h-7 text-[11px]"
            aria-label="Search Library"
            placeholder={`Search Library to add to ${targetLabel}`}
          />
          <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-1">
            {available.length ? (
              <ul>
                {available.map((doc) => (
                  <ResourceRow
                    key={doc.id}
                    doc={doc}
                    draggable
                    action={
                      <button
                        type="button"
                        onClick={() => onAssign(target, doc.id)}
                        aria-label={`Add ${doc.file_name} to ${targetLabel}`}
                        title={`Add to ${targetLabel}`}
                        className="shrink-0 rounded-sm p-1 text-primary transition hover:bg-primary/10"
                      >
                        <Icon name="add" size={14} />
                      </button>
                    }
                  />
                ))}
              </ul>
            ) : (
              <p className="px-1 py-4 text-center text-[10px] text-fg-faint">
                {attachable.length === selectedIds.length
                  ? "All Library resources are in this Context."
                  : "No resources match."}
              </p>
            )}
          </div>
        </div>
      )}

      {pasteOpen && (
        <div className="mt-2 rounded-md border border-border p-2">
          <div className="mb-1 flex items-center gap-1">
            <span className="text-[9px] text-fg-faint">Saved to {targetLabel}</span>
            <button type="button" onClick={() => void readClipboard()} className="ml-auto text-[9px] font-semibold text-primary">
              Read clipboard
            </button>
          </div>
          <input
            value={pasteTitle}
            onChange={(event) => setPasteTitle(event.target.value)}
            className="input mb-1 h-7 text-[10px]"
            aria-label="Pasted resource title"
            placeholder="Title"
          />
          <textarea
            value={pasteText}
            onChange={(event) => setPasteText(event.target.value)}
            className="input text-[10px]"
            rows={4}
            placeholder="Paste text here…"
          />
          <button
            type="button"
            disabled={pasting || !pasteText.trim()}
            onClick={() => void savePaste()}
            className="btn btn-primary mt-1.5 w-full px-2 py-1 text-[10px]"
          >
            {pasting ? "Saving…" : "Save and assign"}
          </button>
        </div>
      )}

    </aside>
  );
}

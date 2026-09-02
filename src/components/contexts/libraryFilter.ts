import type { RagDocument } from "@/lib/ipc";

/**
 * Library filtering — pure, so the chip set and the search behaviour can be
 * tested without a render.
 *
 * AppUI V5.0 §4 ("Library rules") fixes the chip set:
 *
 * > Filters: All / Files / Pasted / Generated / Unattached.
 *
 * "Generated" is documents Conva wrote (briefings, research, Q&A);
 * "Unattached" is documents no Context is using — the ones most likely to be
 * dead weight. `focusContextId` is separate from the chips: it is the
 * Contexts dock's "In this Context" scope, applied on top of whatever chip is
 * selected.
 */

export type LibraryFilter = "all" | "files" | "pasted" | "generated" | "unattached";

export const LIBRARY_FILTERS: { key: LibraryFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "files", label: "Files" },
  { key: "pasted", label: "Pasted" },
  { key: "generated", label: "Generated" },
  { key: "unattached", label: "Unattached" },
];

export function matchesFilter(doc: RagDocument, filter: LibraryFilter): boolean {
  switch (filter) {
    case "files":
      return doc.source === "file";
    case "pasted":
      return doc.source === "pasted";
    case "generated":
      return doc.source === "generated";
    case "unattached":
      return doc.context_ids.length === 0;
    case "all":
    default:
      return true;
  }
}

export function filterDocuments(
  documents: RagDocument[],
  {
    search = "",
    filter = "all",
    focusContextId = null,
  }: { search?: string; filter?: LibraryFilter; focusContextId?: string | null } = {},
): RagDocument[] {
  const q = search.trim().toLowerCase();
  return documents.filter((d) => {
    if (focusContextId && !d.context_ids.includes(focusContextId)) return false;
    if (q && !d.file_name.toLowerCase().includes(q)) return false;
    return matchesFilter(d, filter);
  });
}

/** Human label for a document's type column — shape + label, never colour
 *  alone (§12). Derived from the extension for files; provenance otherwise. */
export function documentTypeLabel(doc: RagDocument): string {
  if (doc.source === "pasted") return "Pasted";
  if (doc.source === "generated") return "Generated";
  const dot = doc.file_name.lastIndexOf(".");
  // No extension at all → "File", not the whole name shouted back.
  const ext = dot > 0 ? doc.file_name.slice(dot + 1).toLowerCase() : "";
  const map: Record<string, string> = {
    pdf: "PDF",
    docx: "Word",
    doc: "Word",
    md: "Markdown",
    markdown: "Markdown",
    txt: "Text",
    html: "HTML",
    htm: "HTML",
    xlsx: "Spreadsheet",
    xls: "Spreadsheet",
    csv: "Spreadsheet",
  };
  return map[ext] ?? (ext ? ext.toUpperCase() : "File");
}

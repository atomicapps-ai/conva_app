import type { RagDocument } from "@/lib/ipc";
import { documentExtension, isImageDocument } from "@/components/contexts/documentVisual";

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
 * dead weight.
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
  { search = "", filter = "all" }: { search?: string; filter?: LibraryFilter } = {},
): RagDocument[] {
  const q = search.trim().toLowerCase();
  return documents.filter((d) => {
    if (q && !d.file_name.toLowerCase().includes(q)) return false;
    return matchesFilter(d, filter);
  });
}

/**
 * Pins documents attached to `pinnedContextId` to the top, otherwise
 * preserving order (a stable partition, not a re-sort) — the Contexts dock's
 * "selected a context, its documents float to the top" behaviour (owner,
 * 2026-09-23: "each time I click I want to see the document rearrange
 * properly"). `null` (nothing selected) is a no-op, so the Library's default
 * state pins nothing.
 */
export function sortPinnedFirst(
  documents: RagDocument[],
  pinnedContextId: string | null,
): RagDocument[] {
  if (!pinnedContextId) return documents;
  const pinned: RagDocument[] = [];
  const rest: RagDocument[] = [];
  for (const d of documents) {
    (d.context_ids.includes(pinnedContextId) ? pinned : rest).push(d);
  }
  return pinned.length === 0 ? documents : [...pinned, ...rest];
}

/** Human label for a document's type column — shape + label, never colour
 *  alone (§12). Derived from the extension for files; provenance otherwise. */
export function documentTypeLabel(doc: RagDocument): string {
  if (doc.source === "pasted") return "Pasted";
  if (doc.source === "generated") return "Generated";
  if (isImageDocument(doc)) return "Image";
  // No extension at all → "File", not the whole name shouted back.
  const ext = documentExtension(doc.file_name);
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

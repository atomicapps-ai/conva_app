import { describe, expect, it } from "vitest";

import {
  documentTypeLabel,
  filterDocuments,
  LIBRARY_FILTERS,
  matchesFilter,
} from "@/components/contexts/libraryFilter";
import type { RagDocument } from "@/lib/ipc";

function doc(over: Partial<RagDocument> = {}): RagDocument {
  return {
    id: "d1",
    file_name: "Maya_Chen_Resume.pdf",
    enabled: true,
    chunk_count: 4,
    ingested_at_unix_ms: 1,
    source: "file",
    context_ids: ["c1"],
    size_bytes: 1024,
    ...over,
  };
}

describe("LIBRARY_FILTERS", () => {
  it("is exactly the approved chip set, in order", () => {
    expect(LIBRARY_FILTERS.map((f) => f.label)).toEqual([
      "All",
      "Files",
      "Pasted",
      "Generated",
      "Unattached",
    ]);
  });
});

describe("matchesFilter", () => {
  it("splits by provenance", () => {
    expect(matchesFilter(doc({ source: "file" }), "files")).toBe(true);
    expect(matchesFilter(doc({ source: "pasted" }), "files")).toBe(false);
    expect(matchesFilter(doc({ source: "pasted" }), "pasted")).toBe(true);
    expect(matchesFilter(doc({ source: "generated" }), "generated")).toBe(true);
  });

  it("finds documents no context is using", () => {
    expect(matchesFilter(doc({ context_ids: [] }), "unattached")).toBe(true);
    expect(matchesFilter(doc({ context_ids: ["c1"] }), "unattached")).toBe(false);
  });

  it("lets everything through on All", () => {
    expect(matchesFilter(doc({ source: "generated", context_ids: [] }), "all")).toBe(true);
  });
});

describe("filterDocuments", () => {
  const docs = [
    doc({ id: "a", file_name: "Maya_Chen_Resume.pdf", source: "file", context_ids: ["c1"] }),
    doc({ id: "b", file_name: "Interview notes", source: "pasted", context_ids: [] }),
    doc({ id: "c", file_name: "Context Brief", source: "generated", context_ids: ["c1"] }),
  ];

  it("returns everything by default", () => {
    expect(filterDocuments(docs).map((d) => d.id)).toEqual(["a", "b", "c"]);
  });

  it("searches the file name, case-insensitively", () => {
    expect(filterDocuments(docs, { search: "  RESUME " }).map((d) => d.id)).toEqual(["a"]);
  });

  it("combines search with a chip", () => {
    expect(filterDocuments(docs, { search: "e", filter: "pasted" }).map((d) => d.id)).toEqual(["b"]);
  });

  it("applies the context scope on top of the chip", () => {
    expect(filterDocuments(docs, { filter: "all", focusContextId: "c1" }).map((d) => d.id)).toEqual([
      "a",
      "c",
    ]);
    expect(filterDocuments(docs, { filter: "generated", focusContextId: "c1" }).map((d) => d.id)).toEqual(
      ["c"],
    );
  });

  it("returns an empty list rather than throwing when nothing matches", () => {
    expect(filterDocuments(docs, { search: "zzz" })).toEqual([]);
  });
});

describe("documentTypeLabel", () => {
  it("names provenance for pasted and generated documents", () => {
    expect(documentTypeLabel(doc({ source: "pasted", file_name: "Interview notes" }))).toBe("Pasted");
    expect(documentTypeLabel(doc({ source: "generated", file_name: "Brief" }))).toBe("Generated");
  });

  it("maps common file extensions to readable names", () => {
    expect(documentTypeLabel(doc({ file_name: "a.pdf" }))).toBe("PDF");
    expect(documentTypeLabel(doc({ file_name: "a.docx" }))).toBe("Word");
    expect(documentTypeLabel(doc({ file_name: "a.MD" }))).toBe("Markdown");
    expect(documentTypeLabel(doc({ file_name: "a.xlsx" }))).toBe("Spreadsheet");
  });

  it("falls back to the raw extension, then to 'File'", () => {
    expect(documentTypeLabel(doc({ file_name: "a.rtf" }))).toBe("RTF");
    expect(documentTypeLabel(doc({ file_name: "README" }))).toBe("File");
  });
});

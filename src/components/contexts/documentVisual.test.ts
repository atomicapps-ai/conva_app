import { describe, expect, it } from "vitest";

import { documentIcon, documentTypeColor, isImageDocument } from "@/components/contexts/documentVisual";
import type { RagDocument } from "@/lib/ipc";

const doc = (file_name: string, source: RagDocument["source"] = "file") =>
  ({ id: file_name, file_name, source, enabled: true, chunk_count: 1, ingested_at_unix_ms: 0, context_ids: [], size_bytes: 0 }) as RagDocument;

describe("documentVisual", () => {
  it("uses distinct file-type icons, including visual assets", () => {
    expect(documentIcon(doc("report.pdf"))).toBe("filePdf");
    expect(documentIcon(doc("brief.docx"))).toBe("fileWord");
    expect(documentIcon(doc("evidence.png"))).toBe("fileImage");
    expect(isImageDocument(doc("photo.WEBP"))).toBe(true);
  });

  it("keeps provenance stronger than the extension", () => {
    expect(documentIcon(doc("answer.txt", "generated"))).toBe("sparkle");
    expect(documentIcon(doc("note.txt", "pasted"))).toBe("clipboard");
  });
});

describe("documentTypeColor", () => {
  it("gives every type its own distinct hue, matching documentIcon's branches", () => {
    const colors = [
      documentTypeColor(doc("report.pdf")),
      documentTypeColor(doc("brief.docx")),
      documentTypeColor(doc("evidence.png")),
      documentTypeColor(doc("page.html")),
      documentTypeColor(doc("budget.xlsx")),
      documentTypeColor(doc("notes.txt")),
      documentTypeColor(doc("mystery.zip")), // falls through to the generic default
    ];
    expect(new Set(colors).size).toBe(colors.length); // no two types share a color
    colors.forEach((c) => expect(c).toMatch(/^#[0-9a-f]{6}$/));
  });

  it("colors by provenance first, ahead of the extension — same precedence as documentIcon", () => {
    expect(documentTypeColor(doc("answer.txt", "generated"))).toBe("#ffc24b");
    expect(documentTypeColor(doc("note.txt", "pasted"))).not.toBe(documentTypeColor(doc("note.txt")));
  });
});
